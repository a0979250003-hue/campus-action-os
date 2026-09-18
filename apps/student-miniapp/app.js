App({
  globalData: {
    apiBaseUrl: 'http://127.0.0.1:3000',
    userId: 'dev-user',
    // 克隆仓库后开箱即跑：默认使用本地示例数据，不需要先启动任何后端服务，
    // 首页 → 导入 → 解析 → 行动结果 → 任务 → 证据 全流程都可点通。
    //
    // 示例数据会在页面上显示「示例数据 · 不是解析结果」横幅，不会被误当成解析结果。
    // 需要真实解析时，到「我的 → 设置」把「数据模式」切换到真实解析服务，
    // 并先在仓库根目录运行 `npm run dev:ai` 与 `npm run dev:api`（Windows 可双击 start-backend.bat）。
    useMock: true,
    demoMode: false,
  },
  onLaunch() {
    const storedUserId = wx.getStorageSync('devUserId');
    if (storedUserId) this.globalData.userId = storedUserId;
    // 「设置」页切换的数据模式写入本地存储，重启小程序后仍然生效。
    const storedUseMock = wx.getStorageSync('useMock');
    if (typeof storedUseMock === 'boolean') this.globalData.useMock = storedUseMock;
  },
});
