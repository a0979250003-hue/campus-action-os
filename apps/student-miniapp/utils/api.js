// 数据来源标记：真实 API 结果与本地示例数据必须可区分。
// 没有这个标记，页面无法判断"看到的是解析结果还是示例"，
// 这正是"点了生成却出现示例内容、又看不出为什么"的根源。
const DATA_ORIGIN_API = 'api';
const DATA_ORIGIN_MOCK = 'mock';

let mockWarningEmitted = false;
function warnMockOnce() {
  if (mockWarningEmitted) return;
  mockWarningEmitted = true;
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(
      '[campus-action-os] useMock=true：当前返回本地示例数据，与输入内容无关。正式验收请把 app.js 的 useMock 置为 false。',
    );
  }
}

function appConfig() {
  const app = getApp();
  const globalData = (app && app.globalData) || {};
  // 严格等于 true 才算开启示例模式。
  // 旧写法 Boolean(globalData.useMock) 会把字符串 'false' 判成真值，
  // 一次配置失误就会让整个应用悄悄跑在示例数据上且毫无提示。
  const useMock = globalData.useMock === true;
  if (useMock) warnMockOnce();
  return {
    baseUrl: globalData.apiBaseUrl || 'http://127.0.0.1:3000',
    userId: globalData.userId || 'dev-user',
    useMock,
    demoMode: globalData.demoMode === true,
  };
}

const { formatDeadline, homeBucket } = require('./deadline');

function apiError(code, message, details) {
  return { error: { code, message, details } };
}

function unsupportedRealCapability(capability) {
  return Promise.reject(
    apiError('REAL_API_NOT_AVAILABLE', `${capability} 当前没有可用的学生端真实 API。`, {
      capability,
    }),
  );
}

function tagOrigin(payload, origin) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (payload.data_origin === origin) return payload;
  return Object.assign({}, payload, { data_origin: origin });
}

// 来源标记可能挂在 payload 顶层，也可能在 payload.result 里，
// 两条路径都要认，否则页面会漏判并退回"看不出来源"的状态。
function dataOrigin(payload) {
  if (!payload || typeof payload !== 'object') return 'unknown';
  if (payload.data_origin) return payload.data_origin;
  if (payload.result && payload.result.data_origin) return payload.result.data_origin;
  return 'unknown';
}

function mockProvenance(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.mock) return payload.mock;
  if (payload.result && payload.result.mock) return payload.result.mock;
  return null;
}

function httpError(response) {
  const body = response.data && response.data.error ? response.data.error : null;
  const statusCode = response.statusCode;
  if (body) {
    return {
      error: Object.assign({}, body, {
        details: Object.assign({}, body.details || {}, { status_code: statusCode }),
      }),
    };
  }
  return apiError('HTTP_ERROR', `服务端返回 HTTP ${statusCode}。`, { status_code: statusCode });
}

// 错误码映射成能指导下一步动作的说明。
// 旧实现把任何失败都压成"解析任务读取失败，请稍后重试"，
// 于是"请求没发出去""解析器没配置""域名被拦"全长得一模一样，根本没法排查。
const ERROR_HINTS = {
  NETWORK_ERROR: '无法连接解析服务。请确认 API 地址可访问；微信开发者工具需勾选「不校验合法域名」。',
  PARSER_NOT_CONFIGURED: '后端解析器未配置（HTTP 503 PARSER_NOT_CONFIGURED），无法生成真实解析结果。',
  REAL_API_NOT_AVAILABLE: '该能力目前没有可用的学生端真实 API。',
  HTTP_ERROR: '服务端返回了错误响应。',
};

function normalizeError(error) {
  const body = (error && error.error) || {};
  const details = body.details || {};
  const code = body.code || (error && error.code) || 'UNKNOWN_ERROR';
  const status = details.status_code || details.statusCode || null;
  return {
    code,
    status,
    message: ERROR_HINTS[code] || body.message || '请求失败，请稍后重试。',
    server_message: body.message || '',
  };
}

function enrichTask(task, action) {
  const precision = action && action.deadline && action.deadline.precision;
  return {
    ...task,
    action,
    home_bucket: homeBucket(task.due_at, precision),
    due_display: formatDeadline(task.due_at, precision),
    source: '通知原文',
    platform: action && action.platform && action.platform.value ? action.platform.value : '待确认',
  };
}

function changeTypeLabel(changeType) {
  if (changeType === 'postponed') return '截止时间延期，待确认';
  if (changeType === 'revoked') return '通知撤回，待确认';
  return '通知内容发生变化，待确认';
}

function request(path, options) {
  const config = appConfig();
  const input = options || {};
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.baseUrl}${path}`,
      method: input.method || 'GET',
      data: input.data,
      header: {
        'content-type': 'application/json',
        'x-dev-user-id': config.userId,
        ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
      },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(tagOrigin(response.data, DATA_ORIGIN_API));
          return;
        }
        reject(httpError(response));
      },
      fail(error) {
        reject(apiError('NETWORK_ERROR', '无法连接真实 API。', error));
      },
    });
  });
}

function key(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

module.exports = {
  getTasks() {
    if (appConfig().useMock) return require('./mock').getTasks();
    return request('/tasks').then((result) =>
      Promise.all(
        (result.tasks || []).map((task) =>
          request(`/actions/${task.action_id}`).then((actionResult) =>
            enrichTask(task, actionResult.action),
          ),
        ),
      ).then((tasks) => ({ ...result, tasks })),
    );
  },
  getPendingChanges() {
    if (appConfig().useMock) return require('./mock').getPendingChanges();
    return this.getTasks().then(({ tasks }) =>
      Promise.all(
        tasks.map((task) =>
          request(`/tasks/${task.task_id}/notice-sync`).then((result) =>
            (result.sync || [])
              .filter((event) => event.status === 'pending_review')
              .map((event) => ({
                change_event_id: event.sync_event_id,
                sync_event_id: event.sync_event_id,
                task_id: task.task_id,
                task_title: task.title,
                change_label: changeTypeLabel(event.change_type),
                old_value: '',
                new_value: '',
                source: '关联通知',
                status: 'pending',
                change_type: event.change_type,
              })),
          ),
        ),
      ).then((groups) => ({ changes: groups.reduce((all, group) => all.concat(group), []) })),
    );
  },
  getOrchestrationSummary() {
    if (appConfig().useMock) return require('./mock').getOrchestrationSummary();
    return unsupportedRealCapability('行动编排');
  },
  getOrchestrationResult() {
    if (appConfig().useMock) return require('./mock').getOrchestrationResult();
    return unsupportedRealCapability('行动编排');
  },
  resetDemoState() {
    if (appConfig().useMock) return require('./mock').resetDemoState();
    return unsupportedRealCapability('Demo 状态重置');
  },
  enterDemoScenario(name) {
    if (appConfig().useMock) return require('./mock').enterDemoScenario(name);
    return unsupportedRealCapability('Demo 场景');
  },
  getDemoState() {
    if (appConfig().useMock) return require('./mock').getDemoState();
    return unsupportedRealCapability('Demo 状态读取');
  },
  createDocument(text) {
    if (appConfig().useMock) return require('./mock').createDocument(text);
    return request('/documents', {
      method: 'POST',
      idempotencyKey: key('document'),
      data: { title: '微信导入通知', text, data_origin: 'user_provided' },
    });
  },
  uploadMediaDocument(filePath, contentType, title) {
    if (appConfig().useMock)
      return require('./mock').uploadMediaDocument(filePath, contentType, title);
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'base64',
        success(file) {
          request('/documents/upload', {
            method: 'POST',
            idempotencyKey: key('document-upload'),
            data: {
              title: title || '微信导入通知',
              contentType,
              content_base64: file.data,
              data_origin: 'user_provided',
            },
          }).then(resolve, reject);
        },
        fail: reject,
      });
    });
  },
  uploadAudioDocument(filePath, contentType, title) {
    if (appConfig().useMock)
      return require('./mock').uploadMediaDocument(filePath, contentType, title);
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'base64',
        success(file) {
          request('/documents/audio', {
            method: 'POST',
            idempotencyKey: key('audio-upload'),
            data: {
              title: title || '微信录音通知',
              filename: title || 'voice.wav',
              contentType: contentType || 'audio/wav',
              content_base64: file.data,
              data_origin: 'user_provided',
            },
          }).then(resolve, reject);
        },
        fail: reject,
      });
    });
  },
  parseDocument(documentId) {
    if (appConfig().useMock) return require('./mock').parseDocument(documentId);
    return request(`/documents/${documentId}/parse`, {
      method: 'POST',
      idempotencyKey: key('parse'),
      data: {},
    });
  },
  getParseJob(parseJobId) {
    if (appConfig().useMock) return require('./mock').getParseJob(parseJobId);
    return request(`/parse-jobs/${parseJobId}`);
  },
  confirmAction(actionId) {
    if (appConfig().useMock) return require('./mock').confirmAction(actionId);
    return request(`/actions/${actionId}/confirm`, {
      method: 'POST',
      idempotencyKey: key('confirm'),
      data: { confirmed: true },
    });
  },
  rejectAction(actionId) {
    if (appConfig().useMock) return require('./mock').rejectAction(actionId);
    return request(`/actions/${actionId}/reject`, {
      method: 'POST',
      idempotencyKey: key('reject'),
      data: { rejected: true },
    });
  },
  createTask(actionId) {
    if (appConfig().useMock) return require('./mock').createTask(actionId);
    return request('/tasks', {
      method: 'POST',
      idempotencyKey: key('task'),
      data: { actionId },
    });
  },
  createManualTask(documentId, title, dueAt) {
    if (appConfig().useMock) return require('./mock').createManualTask(documentId, title, dueAt);
    return request('/tasks/manual', {
      method: 'POST',
      idempotencyKey: key('manual-task'),
      data: { documentId, title, due_at: dueAt || null, confirmed: true },
    });
  },
  linkTaskNotice(taskId, noticeId) {
    if (appConfig().useMock) return Promise.resolve({ ok: true, taskId, noticeId });
    return request(`/tasks/${taskId}/notices`, {
      method: 'POST',
      idempotencyKey: key('task-notice-link'),
      data: { noticeId, confirmed: true },
    });
  },
  getTaskNoticeSync(taskId) {
    if (appConfig().useMock) return Promise.resolve({ sync: [] });
    return request(`/tasks/${taskId}/notice-sync`);
  },
  resolveTaskNoticeSync(taskId, syncEventId, decision) {
    if (appConfig().useMock) return Promise.resolve({ ok: true, taskId, syncEventId, decision });
    return request(`/tasks/${taskId}/notice-sync/${syncEventId}/resolve`, {
      method: 'POST',
      idempotencyKey: key('task-notice-sync'),
      data: { decision, confirmed: true },
    });
  },
  completeTask(taskId) {
    if (appConfig().useMock) return require('./mock').completeTask(taskId);
    return request(`/tasks/${taskId}/complete`, {
      method: 'POST',
      idempotencyKey: key('complete'),
      data: { confirmed: true },
    });
  },
  getProfile() {
    if (appConfig().useMock) return require('./mock').getProfile();
    return request('/users/me');
  },
  exportUserData() {
    if (appConfig().useMock) return require('./mock').exportUserData();
    return request('/users/me/export');
  },
  updateProfile(data) {
    if (appConfig().useMock) return require('./mock').updateProfile(data);
    return request('/users/me/profile', {
      method: 'PATCH',
      idempotencyKey: key('profile'),
      data,
    });
  },
  getAction(actionId) {
    if (appConfig().useMock) return require('./mock').getAction(actionId);
    return request(`/actions/${actionId}`);
  },
  getEvidence(actionId) {
    if (appConfig().useMock) return require('./mock').getEvidence(actionId);
    return request(`/actions/${actionId}`).then((result) => ({
      action: result.action,
      source_text: (result.action.evidence || [])
        .map((item) => item.source_text)
        .filter(Boolean)
        .join('\n'),
    }));
  },
  getAudioEvidence(actionId) {
    if (appConfig().useMock)
      return Promise.reject(apiError('AUDIO_EVIDENCE_NOT_FOUND', '当前行动没有语音依据。'));
    return request(`/actions/${actionId}/audio-evidence`);
  },
  downloadAudioEvidence(audioId) {
    if (appConfig().useMock)
      return Promise.reject(apiError('AUDIO_NOT_FOUND', '当前没有可播放的语音。'));
    const config = appConfig();
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: `${config.baseUrl}/audio/${audioId}`,
        header: { 'x-dev-user-id': config.userId },
        success(result) {
          if (result.statusCode >= 200 && result.statusCode < 300) resolve(result.tempFilePath);
          else reject(apiError('AUDIO_NOT_FOUND', '语音依据读取失败。'));
        },
        fail: reject,
      });
    });
  },
  getTask(taskId) {
    if (appConfig().useMock) return require('./mock').getTask(taskId);
    return request(`/tasks/${taskId}`).then((result) =>
      request(`/actions/${result.task.action_id}`).then((actionResult) => ({
        ...result,
        task: enrichTask(result.task, actionResult.action),
        action: actionResult.action,
      })),
    );
  },
  getNotificationDiff(changeEventId) {
    if (appConfig().useMock) return require('./mock').getNotificationDiff(changeEventId);
    if (!this._diffTaskId || !changeEventId) return unsupportedRealCapability('通知变化详情');
    return request(`/tasks/${this._diffTaskId}/notice-sync`).then((result) => {
      const event = (result.sync || []).find((item) => item.sync_event_id === changeEventId);
      if (!event)
        return Promise.reject(apiError('SYNC_EVENT_NOT_FOUND', '待处理的通知变化不存在。'));
      return tagOrigin(
        {
          ...event,
          change_event_id: event.sync_event_id,
          task_id: this._diffTaskId,
          title: '关联通知发生变化',
          source: '关联通知',
          fields: [],
          impacts: [],
          details_available: false,
        },
        DATA_ORIGIN_API,
      );
    });
  },
  applyNotificationDiff(changeEventId) {
    if (appConfig().useMock) return require('./mock').applyNotificationDiff(changeEventId);
    if (!this._diffTaskId || !changeEventId) return unsupportedRealCapability('通知变化更新');
    return this.resolveTaskNoticeSync(this._diffTaskId, changeEventId, 'accept');
  },
  dismissNotificationDiff(changeEventId) {
    if (appConfig().useMock) return require('./mock').dismissNotificationDiff(changeEventId);
    return this.resolveTaskNoticeSync(this._diffTaskId, changeEventId, 'reject');
  },
  getDemoScenario(name) {
    if (appConfig().useMock) return require('./mock').getDemoScenario(name);
    return unsupportedRealCapability('Demo 示例通知');
  },
  setDiffContext(taskId) {
    this._diffTaskId = taskId;
  },
  isDemoMode() {
    return appConfig().useMock && appConfig().demoMode;
  },
  isMockMode() {
    return appConfig().useMock;
  },
  dataOrigin,
  mockProvenance,
  normalizeError,
  isMockPayload(payload) {
    return dataOrigin(payload) === DATA_ORIGIN_MOCK;
  },
  dataOrigins: { API: DATA_ORIGIN_API, MOCK: DATA_ORIGIN_MOCK },
};


