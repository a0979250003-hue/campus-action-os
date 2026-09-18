import { createHash, randomUUID } from 'node:crypto';
import {
  validateTextParseRequest,
  validateTextParseResponseAgainstText,
  type ActionGraph,
  type ActionStep,
  type Claim,
  type Evidence,
  type TextParseRequest,
  type TextParseResponse,
  type VerifiedActionObject,
} from '@campus-action-os/protocol';
import { inspectCriticalErrors } from './error-shield.js';
import { normalizeSpokenText, type SpokenActionCandidate } from './spoken-normalizer.js';

export type ParserFailure = {
  code: 'INVALID_REQUEST' | 'UNSUPPORTED_CONTENT_TYPE';
  message: string;
};

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function lineFor(text: string, pattern: RegExp): string | undefined {
  return text.split('\n').find((line) => pattern.test(line.trim()));
}

function profileValues(profile: TextParseRequest['user_profile']): string[] {
  return Object.values(profile).flatMap((value) =>
    Array.isArray(value) ? value : typeof value === 'string' ? [value] : [],
  );
}

function relevanceForAudience(
  audience: string,
  profile: TextParseRequest['user_profile'],
): 'relevant' | 'irrelevant' | 'uncertain' {
  const values = profileValues(profile);
  const has = (pattern: RegExp) => values.some((value) => pattern.test(value));

  if (/校外|访客|非本校/.test(audience)) return 'irrelevant';
  if (/全体学生|所有学生|全体在校生/.test(audience)) return 'relevant';
  if (/本科生|本科/.test(audience)) return has(/本科/) ? 'relevant' : 'uncertain';
  if (/研究生|硕士|博士/.test(audience)) return has(/研究生|硕士|博士/) ? 'relevant' : 'uncertain';
  if (/大一|大二|大三|大四/.test(audience))
    return has(new RegExp(audience.match(/大[一二三四]/)?.[0] ?? '大[一二三四]'))
      ? 'relevant'
      : 'uncertain';

  const normalizedAudience = audience.replace(/^(仅限|面向)\s*/, '').trim();
  if (
    values.some(
      (value) => value.includes(normalizedAudience) || normalizedAudience.includes(value.trim()),
    )
  )
    return 'relevant';

  return 'uncertain';
}

function claim(
  value: string | null,
  epistemicStatus: Claim['epistemic_status'],
  evidenceIds: string[],
): Claim {
  return { value, epistemic_status: epistemicStatus, evidence_ids: evidenceIds };
}

function naturalDeadline(
  value: string,
  reference: string,
): {
  value: string | null;
  precision: VerifiedActionObject['deadline']['precision'];
  boundary: VerifiedActionObject['deadline']['boundary_semantics'];
  ambiguous: boolean;
} {
  const referenceDate = new Date(reference);
  if (Number.isNaN(referenceDate.getTime()))
    return { value: null, precision: 'unknown', boundary: 'unknown', ambiguous: true };
  const shanghaiReference = new Date(referenceDate.getTime() + 8 * 60 * 60 * 1000);
  const date = new Date(
    Date.UTC(
      shanghaiReference.getUTCFullYear(),
      shanghaiReference.getUTCMonth(),
      shanghaiReference.getUTCDate(),
      12,
    ),
  );
  const weekdayMatch = value.match(/周([一二三四五六日天])/u);
  if (weekdayMatch) {
    const weekdayMap: Record<string, number> = {
      日: 0,
      天: 0,
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
    };
    const target = weekdayMap[weekdayMatch[1]];
    const current = date.getUTCDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0 && !/今天|本周|这周/u.test(value)) delta = 7;
    date.setUTCDate(date.getUTCDate() + delta);
  } else if (/明天/u.test(value)) date.setUTCDate(date.getUTCDate() + 1);
  else if (/后天/u.test(value)) date.setUTCDate(date.getUTCDate() + 2);
  const timeMatch = value.match(/(\d{1,2})(?::(\d{2}))?点?(?:([0-9]{1,2})分)?/u);
  let precision: VerifiedActionObject['deadline']['precision'] = 'day';
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] ?? timeMatch[3] ?? 0);
    if (/下午|晚上/u.test(value) && hour < 12) hour += 12;
    date.setUTCHours(hour, minute, 0, 0);
    precision = timeMatch[2] || timeMatch[3] ? 'minute' : 'hour';
  }
  const dateText = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  const iso = timeMatch
    ? `${dateText}T${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:00+08:00`
    : dateText;
  return { value: iso, precision, boundary: 'before', ambiguous: !timeMatch };
}

type DeadlineReading = {
  value: string | null;
  precision: VerifiedActionObject['deadline']['precision'];
  boundary: VerifiedActionObject['deadline']['boundary_semantics'];
  ambiguous: boolean;
};

function boundaryOf(line: string): VerifiedActionObject['deadline']['boundary_semantics'] {
  if (/截至|不晚于/u.test(line)) return 'no_later_than';
  if (/之后|以后/u.test(line)) return 'after';
  if (/当天|当日/u.test(line)) return 'on';
  return 'before';
}

// 通知里常写“9月17日 20:00”而不写年份（原实现要求四位年份，于是把报名截止整条丢掉）。
// 这里按参考时间的年份补全；若据此推出的日期已过去，则标为有歧义，交给用户确认。
function yearlessDeadline(match: RegExpMatchArray, line: string, reference: string): DeadlineReading {
  const referenceDate = new Date(reference);
  if (Number.isNaN(referenceDate.getTime()))
    return { value: null, precision: 'unknown', boundary: 'unknown', ambiguous: true };
  const shanghaiReference = new Date(referenceDate.getTime() + 8 * 60 * 60 * 1000);
  const [, rawMonth, rawDay, rawHour, rawMinute] = match;
  const date = `${shanghaiReference.getUTCFullYear()}-${rawMonth.padStart(2, '0')}-${rawDay.padStart(2, '0')}`;
  if (Number.isNaN(new Date(`${date}T12:00:00+08:00`).getTime()))
    return { value: null, precision: 'unknown', boundary: 'unknown', ambiguous: true };
  if (rawHour === undefined)
    return {
      value: date,
      precision: 'day',
      boundary: boundaryOf(line),
      ambiguous: new Date(`${date}T23:59:00+08:00`).getTime() < referenceDate.getTime(),
    };
  const value = `${date}T${rawHour.padStart(2, '0')}:${rawMinute}:00+08:00`;
  return {
    value,
    precision: 'minute',
    boundary: boundaryOf(line),
    ambiguous: new Date(value).getTime() < referenceDate.getTime(),
  };
}

function isoDeadline(line: string | undefined, reference: string): DeadlineReading {
  if (!line || /尽快|另行通知|待确认|工作日/.test(line)) {
    return { value: null, precision: 'unknown', boundary: 'unknown', ambiguous: Boolean(line) };
  }
  const match = line.match(
    /(20\d{2})[-年](\d{1,2})[-月](\d{1,2})日?(?:[ T]?(\d{1,2})[:：](\d{2}))?/,
  );
  if (!match) {
    const natural = line.match(
      /(?:今天|今晚|今早|明天|后天|(?:本周|这周|下周)[一二三四五六日天]|周[一二三四五六日天])(?:早上|上午|中午|下午|晚上)?(?:\d{1,2}(?::\d{2})?点?(?:\d{1,2}分)?)?/u,
    )?.[0];
    if (natural) return naturalDeadline(natural, reference);
    const yearless = line.match(
      /(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*(?:[ T]?(\d{1,2})\s*[:：]\s*(\d{2}))?/u,
    );
    return yearless
      ? yearlessDeadline(yearless, line, reference)
      : { value: null, precision: 'unknown', boundary: 'unknown', ambiguous: false };
  }
  const [, year, month, day, hour, minute] = match;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const value = hour === undefined ? date : `${date}T${hour.padStart(2, '0')}:${minute}:00+08:00`;
  const boundary = boundaryOf(line);
  return {
    value,
    precision: hour === undefined ? 'day' : 'minute',
    boundary,
    ambiguous: /前|之前/.test(line) && hour === undefined,
  };
}

type ActionInput = { text: string; line: string; spoken?: SpokenActionCandidate };

// 书面通知的中文编号（（1）（一）①②等）、半角编号与项目符号。原实现只认 “\d+.” 一种，
// 导致中文编号的通知一条都匹配不上，整体掉进为语音转写设计的切分逻辑。
const actionMarker =
  /^(?:[（(]\s*(?:\d{1,3}|[一二三四五六七八九十]{1,3})\s*[）)]|\d{1,3}\s*[.、)]|[一二三四五六七八九十]{1,3}\s*[.、)]|[①②③④⑤⑥⑦⑧⑨⑩]|[-*•])\s*(.+)$/u;
// 带年份或不带年份的日期表达式：2026年9月19日 / 9月17日 / 2026-09-19。
const dateExpression =
  /(?:20\d{2}\s*[-年]\s*\d{1,2}\s*(?:[-月]\s*\d{1,2}\s*日)?)|(?:\d{1,2}\s*月\s*\d{1,2}\s*日)/u;
// 判断一行是否“值得成为一个行动”，用于把标题/小节名与真正的指令区分开。
const actionVerb =
  /请|需|须|务必|应当|报名|填写|填报|提交|上交|上传|确认|参加|参与|完成|发送|缴费|领取|联系|加入|扫码|关注|携带|准备|拍摄|服从|接受|具备|更新|核对|打印|下载|登录|交|填|传|发|做|拿/u;
const headingTail = /[：:]\s*$/u;
const headingWords =
  /^(?:活动时间|活动安排|活动简介|志愿岗位|招募说明|招募对象|招募要求|报名方式|报名渠道|联系方式|注意事项|其他|说明|须知|流程|岗位要求|岗位职责|工作内容|时间安排|材料清单)$/u;
// 语音转写里不会出现明确的日历日期（“9月17日”“2026年9月19日”），用的是“周三/明天/今晚”这类相对表达。
// 一旦原文出现明确日历日期，就按书面通知处理，避免把书面语句按口语的动词位置切碎重组。
const explicitCalendarDate =
  /(?:\d{1,2}\s*月\s*\d{1,2}\s*日)|(?:20\d{2}\s*[-年]\s*\d{1,2})/u;
const directiveStart = /^(?:请|需|须|务必|应当)/u;

function isHeadingLike(text: string): boolean {
  if (headingTail.test(text)) return true;
  const stripped = text.replace(headingTail, '').trim();
  if (!stripped) return true;
  if (headingWords.test(stripped)) return true;
  return stripped.length <= 6 && !actionVerb.test(stripped);
}

function hasDateExpression(line: string): boolean {
  return dateExpression.test(line);
}

function spokenSplitIsSafe(text: string): boolean {
  return !explicitCalendarDate.test(text);
}

function findActions(
  lines: string[],
  spoken: ReturnType<typeof normalizeSpokenText>,
  looksSpoken: boolean,
): ActionInput[] {
  const marked = lines
    .map((line) => ({ line, match: line.trim().match(actionMarker) }))
    .filter((item): item is { line: string; match: RegExpMatchArray } => Boolean(item.match))
    .map(({ line, match }) => ({ text: match[1].trim(), line }))
    .filter(({ text }) => !isHeadingLike(text));
  // 没有编号、但以“请/需/务必”开头的行同样是明确指令（例如“报名方式”下面那一句）。
  const directives = lines
    .filter((line) => !line.trim().match(actionMarker))
    .map((line) => ({ text: line.trim(), line: line.trim() }))
    .filter(({ text }) => !isHeadingLike(text) && directiveStart.test(text));
  if (marked.length > 0) {
    const seen = new Set(marked.map((item) => item.line));
    return [...marked, ...directives.filter((item) => !seen.has(item.line))];
  }
  if (looksSpoken && spoken.candidates.length > 0)
    return spoken.candidates.map((candidate) => ({
      text: candidate.action_text,
      line: candidate.source_text,
      spoken: candidate,
    }));
  if (directives.length > 0) return directives;
  return lines
    .filter(
      (line) =>
        /请|需|完成|提交|报名|参加|上传|填写|预约|交|传|发|确认|缴费|领取/.test(line) &&
        !/适用|截止|材料|地点|平台|条件/.test(line),
    )
    .slice(0, 8)
    .map((line) => ({ text: line.trim(), line }));
}

function evidence(id: string, sourceText: string, fieldName: Evidence['field_name']): Evidence {
  return {
    evidence_id: id,
    source_text: sourceText,
    page_or_image: 'text:1',
    field_name: fieldName,
    epistemic_status: 'explicit',
  };
}

function deadlineLineForAction(
  actionLine: string,
  allLines: string[],
  deadlineLines: string[],
): string | undefined {
  if (/截止|截至|报名时间/u.test(actionLine) || hasDateExpression(actionLine)) return actionLine;
  const position = allLines.indexOf(actionLine);
  // 通知里的时间行通常写在被修饰的指令之后；后面找不到就退回之前最近的一条。
  const following = deadlineLines.find((line) => allLines.indexOf(line) > position);
  if (following) return following;
  const preceding = [...deadlineLines].reverse().find((line) => allLines.indexOf(line) < position);
  return preceding ?? deadlineLines[0];
}

export function parseText(request: TextParseRequest): TextParseResponse | ParserFailure {
  const validRequest = validateTextParseRequest(request);
  if (!validRequest.ok)
    return { code: 'INVALID_REQUEST', message: '请求不符合 text-parse-request/v1' };
  if (request.document.content_type !== 'text/plain')
    return { code: 'UNSUPPORTED_CONTENT_TYPE', message: 'rule parser 目前只接受标准化 text/plain' };
  const startedAt = new Date().toISOString();
  const source = normalize(request.document.text);
  const spoken = normalizeSpokenText(source);
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const title = (lines[0] ?? '未命名校园通知').replace(/^【|】$/g, '').slice(0, 300);
  const audienceLine = lineFor(source, /适用对象|面向|仅限|本科生|研究生|全体学生/);
  const audience =
    audienceLine?.replace(/^(适用对象|面向)[:：]?\s*/, '').trim() || '未明确适用对象';
  const userRelevance =
    audience === '未明确适用对象'
      ? 'uncertain'
      : relevanceForAudience(audience, request.user_profile);
  const relevanceEvidence = audienceLine
    ? evidence('ev-relevance', audienceLine, 'user_relevance')
    : undefined;
  const actionInputs = findActions(lines, spoken, spokenSplitIsSafe(source));
  const deadlineLines = lines.filter(
    (line) => /^(?:截止|截至|报名时间|时间|日期)/u.test(line) || hasDateExpression(line),
  );
  const materialsLine =
    lineFor(source, /^(?:材料|材料清单|需准备|需携带|携带)[:：]/) ??
    lineFor(source, /^提交.*(?:证件|证明|附件)/);
  const locationLine = lineFor(source, /^(?:地点|地址|教室|现场)[:：]/);
  const platformLine = lineFor(source, /^(?:平台|系统|线上平台|在线平台|线上|邮箱|链接|网址)[:：]/);
  const conditionLine = lineFor(source, /^(?:条件|要求|仅限|须知|须满足|如果|若)/);
  const exceptionLine = lineFor(source, /^(?:除.*外|不适用于|例外)/);
  const actionDeadlineLines = actionInputs.map(({ line, spoken: spokenAction }, index) => {
    if (spokenAction?.deadline_text) return line;
    const inherited = actionInputs[index - 1]?.spoken?.deadline_text
      ? actionInputs[index - 1].line
      : undefined;
    return deadlineLineForAction(line, lines, deadlineLines) ?? inherited;
  });
  const actionDeadlines = actionDeadlineLines.map((line) =>
    isoDeadline(line, request.execution_context.requested_at),
  );
  const warnings: TextParseResponse['warnings'] = [];
  if (actionDeadlines.some((deadline) => !deadline.value))
    warnings.push({
      code: 'DEADLINE_UNKNOWN',
      message: '截止时间缺失或无法安全解析，需要用户确认',
      paths: ['/verified_actions/*/deadline'],
    });
  if (actionDeadlines.some((deadline) => deadline.ambiguous))
    warnings.push({
      code: 'DEADLINE_AMBIGUOUS',
      message: '日期精度或边界语义存在歧义，需要用户确认',
      paths: ['/verified_actions/*/deadline'],
    });
  if (userRelevance === 'uncertain')
    warnings.push({
      code: 'RELEVANCE_UNCERTAIN',
      message: '无法仅凭通知和用户画像确定相关性',
      paths: ['/document_assessment/user_relevance'],
    });
  if (actionInputs.length === 0)
    warnings.push({
      code: 'ACTION_MISSING',
      message: '未找到明确可执行行动',
      paths: ['/verified_actions'],
    });
  const parsedActions = actionInputs.map(({ text, line, spoken: spokenAction }, index): VerifiedActionObject => {
    const actionId = `${request.document.document_id}:action:${index + 1}`;
    const deadlineLine = actionDeadlineLines[index];
    const deadline = actionDeadlines[index];
    const evidenceId = (kind: string) =>
      `${request.document.document_id}:evidence:${kind}:${index + 1}`;
    const actionAudienceLine = spokenAction?.audience_text ?? audienceLine;
    const actionAudience = spokenAction?.audience_text ?? audience;
    const actionPlatformLine = spokenAction?.platform_source_text ? line : platformLine;
    const actionPlatform = spokenAction?.platform ?? null;
    const actionConditionLine = spokenAction?.condition_text ?? conditionLine;
    const actionRelevanceEvidence = relevanceEvidence
      ? evidence(evidenceId('relevance'), relevanceEvidence.source_text, 'user_relevance')
      : undefined;
    const populationEvidence = actionAudienceLine
      ? evidence(evidenceId('population'), actionAudienceLine, 'target_population')
      : undefined;
    const stepEvidenceId = evidenceId('step');
    const actionEvidence: Evidence[] = [evidence(stepEvidenceId, line, 'steps')];
    const step: ActionStep = {
      step_id: `${actionId}:step:1`,
      instruction: text,
      epistemic_status: 'explicit',
      evidence_ids: [stepEvidenceId],
    };
    const materials = materialsLine
      ? materialsLine
          .replace(/^.*?(材料|携带|提交)[:：]?\s*/, '')
          .split(/[、,，;；]/)
          .map((description, materialIndex) => ({
            material_id: `${actionId}:material:${materialIndex + 1}`,
            description: description.trim(),
            epistemic_status: 'explicit' as const,
            evidence_ids: [evidenceId('material')],
          }))
          .filter((item) => item.description)
      : [];
    if (materialsLine)
      actionEvidence.push(evidence(evidenceId('material'), materialsLine, 'required_materials'));
    const location = locationLine
      ? claim(locationLine.replace(/^.*?(地点|地址)[:：]?\s*/, ''), 'explicit', [
          evidenceId('location'),
        ])
      : null;
    if (locationLine)
      actionEvidence.push(evidence(evidenceId('location'), locationLine, 'location'));
    const platform = actionPlatformLine || actionPlatform
      ? claim(
          actionPlatform ?? actionPlatformLine?.replace(/^.*?(平台|系统)[:：]?\s*/, '') ?? '',
          'explicit',
          [evidenceId('platform')],
        )
      : null;
    if (actionPlatformLine || actionPlatform)
      actionEvidence.push(evidence(evidenceId('platform'), line, 'platform'));
    const link = source.match(/https?:\/\/[^\s)]+/)?.[0] ?? null;
    const entryLink = link ? claim(link, 'explicit', [evidenceId('entry')]) : null;
    if (link)
      actionEvidence.push(evidence(evidenceId('entry'), platformLine ?? link, 'entry_link'));
    const condition = actionConditionLine
      ? [
          {
            condition_id: `${actionId}:condition:1`,
            statement: actionConditionLine,
            outcomes: [
              { label: '满足条件', step_ids: [step.step_id] },
              { label: '不满足条件', step_ids: [] },
            ],
            epistemic_status: 'explicit' as const,
            evidence_ids: [evidenceId('condition')],
          },
        ]
      : [];
    if (actionConditionLine)
      actionEvidence.push(evidence(evidenceId('condition'), line, 'conditions'));
    const exception = exceptionLine
      ? [
          {
            exception_id: `${actionId}:exception:1`,
            statement: exceptionLine,
            epistemic_status: 'explicit' as const,
            evidence_ids: [evidenceId('exception')],
          },
        ]
      : [];
    if (exceptionLine)
      actionEvidence.push(evidence(evidenceId('exception'), exceptionLine, 'exceptions'));
    if (deadlineLine)
      actionEvidence.push(evidence(evidenceId('deadline'), deadlineLine, 'deadline'));
    if (actionRelevanceEvidence) actionEvidence.push(actionRelevanceEvidence);
    if (populationEvidence) actionEvidence.push(populationEvidence);
    const status =
      userRelevance === 'relevant' && warnings.length === 0
        ? 'passed'
        : 'user_confirmation_required';
    const fieldStatus = {
      user_relevance: actionRelevanceEvidence ? 'explicit' : 'unknown',
      target_population: populationEvidence ? 'explicit' : 'unknown',
      steps: 'explicit',
      deadline: deadlineLine && deadline.value ? 'explicit' : 'unknown',
      required_materials: materialsLine ? 'explicit' : 'unknown',
      location: locationLine ? 'explicit' : 'unknown',
      platform: actionPlatformLine || actionPlatform ? 'explicit' : 'unknown',
      conditions: actionConditionLine ? 'explicit' : 'unknown',
      exceptions: exceptionLine ? 'explicit' : 'unknown',
    } as const;
    return {
      schema_version: 'verified-action-object/v1',
      action_id: actionId,
      document_id: request.document.document_id,
      title: text.slice(0, 300),
      target_population: [actionAudience],
      user_relevance: userRelevance,
      relevance_reason:
        userRelevance === 'relevant'
          ? '用户画像与通知适用对象匹配'
          : userRelevance === 'irrelevant'
            ? '用户画像未匹配通知适用对象'
            : '通知或用户画像存在无法安全消解的不确定性',
      action_type: 'campus_notice_action',
      steps: [step],
      dependencies: [],
      conditions: condition,
      exceptions: exception,
      deadline: {
        value: deadline.value,
        precision: deadline.precision,
        boundary_semantics: deadline.boundary,
        timezone: 'Asia/Shanghai',
        epistemic_status: deadline.value ? 'explicit' : 'unknown',
        evidence_ids: deadline.value ? [evidenceId('deadline')] : [],
      },
      location,
      platform,
      entry_link: entryLink,
      required_materials: materials,
      consequence: null,
      obligation:
        /必须|须|截止|务必|要|需要|得|记得|别忘了|请/.test(text) ||
        Boolean(spokenAction?.obligation_text)
          ? 'mandatory'
          : 'unknown',
      evidence: actionEvidence,
      confidence: { score: warnings.length === 0 ? 0.9 : 0.45, basis: 'rule_review' },
      epistemic_status: 'explicit',
      field_status: fieldStatus,
      result_stage: 'rule_reviewed',
      verification_status: status,
      task_status: 'pending',
      change_history: [
        {
          change_id: randomUUID(),
          occurred_at: startedAt,
          actor: 'rule_engine',
          change_type: 'created',
          reason: 'Deterministic rule parser output',
        },
      ],
    };
  });
  const shieldErrors = parsedActions.flatMap((action) => inspectCriticalErrors(action));
  for (const shieldError of shieldErrors) {
    const code = `CRITICAL_${shieldError.code}`;
    if (!warnings.some((warning) => warning.code === code)) {
      warnings.push({
        code,
        message: shieldError.message,
        paths: [`/verified_actions/*/${shieldError.field}`],
      });
    }
  }
  const assessmentEvidence = relevanceEvidence
    ? [
        {
          evidence_id: relevanceEvidence.evidence_id,
          source_text: relevanceEvidence.source_text,
          field_name: 'user_relevance' as const,
        },
      ]
    : [
        {
          evidence_id: `${request.document.document_id}:evidence:assessment`,
          source_text: lines[0] ?? source,
          field_name: 'other' as const,
        },
      ];
  const executableActions = userRelevance === 'irrelevant' ? [] : parsedActions;
  const completedAt = new Date().toISOString();
  const response: TextParseResponse = {
    schema_version: 'text-parse-response/v1',
    request_id: request.request_id,
    document_id: request.document.document_id,
    status:
      actionInputs.length === 0
        ? 'rejected'
        : warnings.length > 0
          ? 'needs_confirmation'
          : 'succeeded',
    document_assessment: {
      schema_version: 'document-assessment/v1',
      document_id: request.document.document_id,
      user_relevance: userRelevance,
      relevance_reason:
        userRelevance === 'relevant'
          ? '用户画像匹配适用对象'
          : userRelevance === 'irrelevant'
            ? '用户画像未匹配适用对象'
            : '相关性需要用户确认',
      evidence: assessmentEvidence,
      verification_status:
        userRelevance === 'relevant' && warnings.length === 0
          ? 'passed'
          : userRelevance === 'irrelevant'
            ? 'passed'
            : 'user_confirmation_required',
    },
    verified_actions: executableActions,
    action_graph:
      executableActions.length > 0
        ? buildGraph(executableActions, request.document.document_id)
        : null,
    warnings,
    parser_metadata: {
      parser_version: 'rule-parser/1.0.0',
      model_provider: 'deterministic-rule-engine',
      model_version: 'not_applicable',
      prompt_version: 'not_applicable',
      rule_version: 'rule-set/1.0.0',
      ocr_version: 'not_applicable',
      started_at: startedAt,
      completed_at: completedAt,
      latency_ms: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    },
    ...(request.execution_context.environment === 'production'
      ? {}
      : { provenance: { development_only: true, synthetic: true, not_model_output: true } }),
  };
  const validResponse = validateTextParseResponseAgainstText(response, source);
  if (!validResponse.ok)
    return {
      code: 'INVALID_REQUEST',
      message: `rule parser generated invalid response: ${validResponse.errors[0]?.message ?? 'unknown error'}`,
    };
  return validResponse.value;
}

function buildGraph(actions: VerifiedActionObject[], documentId: string): ActionGraph {
  const nodes: ActionGraph['nodes'] = actions.map((action) => ({
    node_id: `${action.action_id}:node`,
    node_type: 'action' as const,
    action_id: action.action_id,
  }));
  const edges: ActionGraph['edges'] = nodes.slice(1).map((node, index) => ({
    edge_id: `${documentId}:edge:${index + 1}`,
    from_node_id: nodes[index].node_id,
    to_node_id: node.node_id,
    edge_type: 'blocks' as const,
  }));
  let branchIndex = 0;
  for (const action of actions) {
    for (const condition of action.conditions) {
      branchIndex += 1;
      const decisionNodeId = `${action.action_id}:decision:${condition.condition_id}`;
      nodes.push({
        node_id: decisionNodeId,
        node_type: 'decision',
        condition_ids: [condition.condition_id],
      });
      edges.push({
        edge_id: `${documentId}:branch:${branchIndex}`,
        from_node_id: decisionNodeId,
        to_node_id: `${action.action_id}:node`,
        edge_type: 'branches_to',
        condition_id: condition.condition_id,
      });
    }
  }
  return { schema_version: 'action-graph/v1', graph_id: `${documentId}:graph`, nodes, edges };
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
