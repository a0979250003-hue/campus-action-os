import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

// 这一组用例锁住一条约束：小程序端任何数据出口都必须自报来源。
// 背景：点击"生成行动图"后出现的其实是打包在客户端的示例数据，
// 但它不带任何标记，页面也就无法提示，用户只能看到一份与输入无关的结果。
const require = createRequire(import.meta.url);

const MOCK_PATH = '../../apps/student-miniapp/utils/mock.js';
const API_PATH = '../../apps/student-miniapp/utils/api.js';
const BASE_URL = 'http://127.0.0.1:3000';

type Globals = Record<string, unknown>;
const globals = globalThis as unknown as Globals;
type AnyModule = Record<string, any>;

function setGlobals(values: Globals): void {
  for (const [name, value] of Object.entries(values)) globals[name] = value;
}

function freshRequire(modulePath: string): AnyModule {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

function storageRuntime() {
  const storage = new Map<string, unknown>();
  return {
    storage,
    wx: {
      getStorageSync: (key: string) => (storage.has(key) ? storage.get(key) : ''),
      setStorageSync: (key: string, value: unknown) => {
        storage.set(key, value);
      },
    },
  };
}

function realApiRuntime(handler: (options: any) => void) {
  const sent: Array<{ url: string; data: any }> = [];
  setGlobals({
    wx: {
      request: (options: any) => {
        sent.push({ url: options.url, data: options.data });
        handler(options);
      },
      getStorageSync: () => '',
      setStorageSync: () => undefined,
    },
    getApp: () => ({
      globalData: { apiBaseUrl: BASE_URL, userId: 'dev-user', useMock: false },
    }),
  });
  return { sent, api: freshRequire(API_PATH) };
}

function loadMock() {
  const runtime = storageRuntime();
  setGlobals({ wx: runtime.wx });
  return { storage: runtime.storage, mock: freshRequire(MOCK_PATH) };
}

async function settle(mock: AnyModule, text: string) {
  const created = await mock.createDocument(text);
  const started = await mock.parseDocument(created.document.document_id);
  await mock.getParseJob(started.parse_job_id);
  const job = await mock.getParseJob(started.parse_job_id);
  return { created, job };
}

test('未命中示例场景时必须显式标记为兜底，而不是悄悄当成命中', async () => {
  const { mock } = loadMock();
  const { created, job } = await settle(
    mock,
    '网络空间安全学院「寻找小小密码学家」成果视频志愿者招募通知：请于 9 月 17 日 20:00 前填写问卷报名。',
  );

  assert.equal(created.data_origin, 'mock');
  assert.equal(created.document.scenario_matched, false);
  assert.equal(created.document.scenario_keyword, null);

  assert.equal(job.status, 'succeeded');
  assert.equal(job.data_origin, 'mock');
  assert.equal(job.result.data_origin, 'mock');
  assert.equal(job.result.mock.matched, false);
  assert.equal(job.result.mock.scenario, 'student');
  assert.match(job.result.mock.notice, /兜底示例/);

  // 原始输入必须随结果带出，页面才能把"你输入的"和"示例内容"摆在一起对照
  assert.match(job.result.input_text, /志愿者招募/);
  // 而示例正文与输入毫无关系——这正是当时观察到的现象
  assert.doesNotMatch(job.result.source_text, /志愿者/);
});

test('命中示例场景时同样标注来源，并记录命中的关键词', async () => {
  const { mock } = loadMock();
  const { created, job } = await settle(
    mock,
    '关于开展 2025—2026 学年国家奖学金评审工作的通知，请符合条件的同学提交材料。',
  );

  assert.equal(created.document.scenario_matched, true);
  assert.equal(created.document.scenario_keyword, '奖学金');
  assert.equal(job.result.mock.matched, true);
  assert.equal(job.result.mock.keyword, '奖学金');
  assert.match(job.result.mock.notice, /命中关键词/);
});

test('mock 的每个出口都带 data_origin，示例数据无法伪装成真实结果', async () => {
  const { mock } = loadMock();
  await settle(mock, '国家奖学金申请截止 9 月 18 日');

  const probes: Array<[string, unknown[]]> = [
    ['getTasks', []],
    ['getPendingChanges', []],
    ['getProfile', []],
    ['getDemoScenario', ['student']],
    ['getOrchestrationSummary', []],
    ['getOrchestrationResult', []],
    ['getTask', ['task-orientation']],
    ['uploadMediaDocument', ['/tmp/a.png', 'image/png', 'a.png']],
    ['exportUserData', []],
    ['resetDemoState', []],
    ['enterDemoScenario', ['student']],
  ];

  for (const [name, args] of probes) {
    const payload = await mock[name](...args);
    assert.equal(payload.data_origin, 'mock', `${name} 的返回值缺少 data_origin 标记`);
  }
});

test('真实 API 响应带 data_origin=api，且通知原文确实发给了后端', async () => {
  const { sent, api } = realApiRuntime((options) => {
    options.success({ statusCode: 201, data: { document: { document_id: 'doc-real' } } });
  });

  const result = await api.createDocument('明天下午三点在学院楼开会');

  assert.equal(result.data_origin, 'api');
  assert.equal(api.isMockPayload(result), false);
  assert.equal(api.isMockMode(), false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, `${BASE_URL}/documents`);
  assert.equal(sent[0].data.text, '明天下午三点在学院楼开会');
});

test('useMock 只有严格等于 true 才启用示例模式', () => {
  setGlobals({
    wx: { getStorageSync: () => '', setStorageSync: () => undefined },
    // 字符串 'false' 会被布尔强转判成真值，不能让一次配置失误把整个应用切到示例数据
    getApp: () => ({ globalData: { useMock: 'false' } }),
  });
  const api = freshRequire(API_PATH);
  assert.equal(api.isMockMode(), false);
});

test('503 PARSER_NOT_CONFIGURED 不再被压成通用失败文案', async () => {
  const { api } = realApiRuntime((options) => {
    options.success({
      statusCode: 503,
      data: { error: { code: 'PARSER_NOT_CONFIGURED', message: 'parser not configured' } },
    });
  });

  const error = await api.parseDocument('doc-1').then(
    () => null,
    (value: unknown) => value,
  );
  const normalized = api.normalizeError(error);

  assert.equal(normalized.code, 'PARSER_NOT_CONFIGURED');
  assert.equal(normalized.status, 503);
  assert.match(normalized.message, /PARSER_NOT_CONFIGURED/);
});

test('网络失败保留 NETWORK_ERROR 错误码，便于区分域名白名单问题', async () => {
  const { api } = realApiRuntime((options) => {
    options.fail({ errMsg: 'request:fail url not in domain list' });
  });

  const error = await api.getParseJob('job-1').then(
    () => null,
    (value: unknown) => value,
  );
  const normalized = api.normalizeError(error);

  assert.equal(normalized.code, 'NETWORK_ERROR');
  assert.equal(normalized.status, null);
  assert.match(normalized.message, /不校验合法域名/);
});
