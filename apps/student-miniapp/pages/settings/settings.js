const api = require('../../utils/api');

Page({
  data: { exporting: false, error: '', useMock: false, originLabel: '', apiBaseUrl: '' },
  onShow() {
    this.refreshMode();
  },
  refreshMode() {
    const useMock = api.isMockMode();
    this.setData({
      useMock,
      originLabel: useMock ? '本地示例数据（不连接后端）' : '真实解析服务',
      apiBaseUrl: getApp().globalData.apiBaseUrl,
    });
  },
  toggleMock(event) {
    const useMock = Boolean(event.detail.value);
    const app = getApp();
    app.globalData.useMock = useMock;
    wx.setStorageSync('useMock', useMock);
    this.refreshMode();
    wx.showToast({
      title: useMock ? '已切换为示例数据' : '已切换为真实解析',
      icon: 'none',
    });
  },
  exportData() {
    wx.showModal({
      title: '导出本地数据',
      content: '将读取当前账号的画像、通知原文、解析结果和任务，并复制为 JSON。确认继续吗？',
      confirmText: '确认导出',
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ exporting: true, error: '' });
        api
          .exportUserData()
          .then(
            (data) =>
              new Promise((resolve, reject) => {
                wx.setClipboardData({
                  data: JSON.stringify(data),
                  success: resolve,
                  fail: reject,
                });
              }),
          )
          .then(() => wx.showToast({ title: '数据已复制', icon: 'success' }))
          .catch(() => this.setData({ error: '数据导出失败，请稍后重试。' }))
          .finally(() => this.setData({ exporting: false }));
      },
    });
  },
});
