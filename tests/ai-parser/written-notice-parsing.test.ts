import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  validateTextParseResponseAgainstText,
  type TextParseRequest,
} from '@campus-action-os/protocol';
import { parseText } from '../../services/ai-parser/src/rule-parser.js';

// 一篇真实的书面招募通知：中文编号（1）（2）（3）、小节标题（“2 招募要求：”“报名方式”），
// 以及一个不写年份的报名截止时间（9月17日 20:00）。改动前这段文本会被当成语音转写处理。
const notice = [
  '网络空间安全学院（研究院）启明支教团“寻找小小密码学家”成果视频志愿者招募通知',
  '',
  '2026年暑期，我院启明支教团开展了“寻找小小密码学家”网络安全科普活动，为将本次活动整理成一支成果视频，现公开招募视频制作志愿者。',
  '',
  '活动时间',
  '集中拍摄：2026年9月19日 8:30-12:00',
  '',
  '志愿岗位：',
  '【脚本与文案组】',
  '【拍摄与现场组】',
  '【出镜组】',
  '【剪辑与后期组】',
  '',
  '（二）招募说明',
  '招募对象：',
  '山东大学网络空间安全学院在校本科生、研究生',
  '',
  '2 招募要求：',
  '（1）接受组织的统一管理，服从岗位调剂，能够保证参与拍摄及相关活动；',
  '（2）具备相应岗位所需的基本能力',
  '脚本与文案岗：文字组织能力',
  '拍摄与现场岗：有摄影摄像经验者优先',
  '剪辑与后期岗：掌握剪辑软件的基本操作',
  '出镜岗：形象气质良好、语言表达自然，能自然面对镜头',
  '参与过本次活动的志愿者优先；',
  '（3）请确认有充足时间参与活动，一经录取，不得无故退出。',
  '',
  '3 其他：',
  '拍摄所需设备由启明支教团统一协调，如有个人设备可自带并在报名时备注。',
  '根据志愿者实际工作时长计入志愿时长。',
  '',
  '报名方式',
  '请于【9月17日 20:00】前点击下方链接填写问卷报名',
].join('\n');

function request(text: string): TextParseRequest {
  return {
    schema_version: 'text-parse-request/v1',
    request_id: 'written-notice-request',
    idempotency_key: 'written-notice',
    protocol_version: '1.0.0',
    document: {
      document_id: 'written-notice-doc',
      content_type: 'text/plain',
      text,
      content_sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
    },
    user_profile: { education_level: '本科', college: '网络空间安全学院' },
    execution_context: {
      environment: 'test',
      deadline_ms: 5000,
      requested_at: '2026-09-18T00:00:00+08:00',
    },
  };
}

test('written notice with Chinese numbering yields clean action titles', () => {
  const result = parseText(request(notice));
  assert.equal('code' in result, false);
  if ('code' in result) return;

  // 编号必须被剥掉，不能出现“确认（3）请”这种编号与动词错位的碎片。
  assert.deepEqual(
    result.verified_actions.map((action) => action.title),
    [
      '接受组织的统一管理，服从岗位调剂，能够保证参与拍摄及相关活动；',
      '具备相应岗位所需的基本能力',
      '请确认有充足时间参与活动，一经录取，不得无故退出。',
      '请于【9月17日 20:00】前点击下方链接填写问卷报名',
    ],
  );

  // 小节名不是行动。
  for (const action of result.verified_actions)
    assert.ok(!/^报名方式$|^招募说明$|^其他$/.test(action.title), action.title);

  assert.equal(validateTextParseResponseAgainstText(result, notice).ok, true);
});

test('named-deadline without a year is preserved and flagged for confirmation', () => {
  const result = parseText(request(notice));
  assert.equal('code' in result, false);
  if ('code' in result) return;

  // 报名截止时间必须保住（改动前整条丢失，deadline 为 null）。
  for (const action of result.verified_actions) {
    assert.equal(action.deadline.value, '2026-09-17T20:00:00+08:00', action.title);
    assert.equal(action.deadline.precision, 'minute', action.title);
    assert.equal(action.deadline.boundary_semantics, 'before', action.title);
  }

  const codes = result.warnings.map((warning) => warning.code);
  assert.ok(codes.includes('DEADLINE_AMBIGUOUS'));
  assert.ok(!codes.includes('DEADLINE_UNKNOWN'));
  assert.ok(!codes.some((code) => code === 'CRITICAL_DEADLINE_UNSAFE'));
  assert.equal(result.status, 'needs_confirmation');
  assert.equal(result.action_graph?.nodes.length, 4);
  assert.equal(result.action_graph?.edges.length, 3);
});

test('written notices keep the spoken splitter out of the pipeline', () => {
  const result = parseText(request(notice));
  assert.equal('code' in result, false);
  if ('code' in result) return;
  // 语音切分器会剥掉标点并重排词序；书面通知不应出现任何无标点的碎片标题。
  for (const action of result.verified_actions)
    assert.ok(!/[，。；、]/.test(action.title) || action.title.length > 12, action.title);
});
