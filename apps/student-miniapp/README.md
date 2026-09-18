# Student mini-program boundary

## 快速开始（克隆后即可运行）

1. 微信开发者工具 →「导入项目」，目录选择本目录（`apps/student-miniapp`）。工程已自带 `project.config.json`：AppID 填的是测试号 `touristappid`，且 `setting.urlCheck` 为 `false`（等价于手工勾选「不校验合法域名」）。要用自己的 AppID，改 `project.config.json` 的 `appid` 即可。
2. 直接编译预览。默认走**本地示例数据**，不需要启动任何后端，首页 → 导入 → 解析 → 行动结果 → 任务 → 证据 全流程可点通。页面会显示「示例数据 · 不是解析结果」横幅，这是刻意保留的，用来区分示例与真实解析结果。
3. 需要真实解析结果时，在仓库根目录双击 `start-backend.bat`（非 Windows 依次运行 `npm run dev:ai`、`npm run dev:api`），再在小程序里进「我的 → 设置 → 数据模式」把开关切到真实解析服务。

> 数据模式会写入本地存储，重启小程序后仍然生效；默认值定义在 `app.js` 的 `globalData.useMock`（当前为 `true`）。

微信小程序宿主目录。这里提供本地开发用的原生最小页面和 API client；页面、AppSecret 和模型密钥尚未接入，客户端只允许调用 API 服务。

微信开发者工具运行、设备兼容性、网络配置和页面交互仍必须按 `docs/manual-wechat-verification.md` 人工验证，当前状态是 `MANUAL_VERIFICATION_REQUIRED`。

当前前端 MVP 的 `app.js` 中 `globalData.useMock` **默认开启**（`true`），克隆后无需后端即可跑通 Action Center → Import → Parsing → Action Result → Evidence → Task Detail 以及 Notification Diff 全链路；此时界面会标注「示例数据」。需要真实 API 时在「设置 → 数据模式」切换（或把该开关改为 `false`），页面始终通过 `utils/api.js` 的统一 adapter 调用后端。

数据来源必须可识别：`utils/mock.js` 的每个返回值都带 `data_origin: 'mock'`，`utils/api.js` 给真实响应打 `data_origin: 'api'`；示例结果还会在 `result.mock` 里记录命中的示例场景、命中关键词，以及是否只是兜底示例。Import / Parse / Action Result 页面据此显示「示例数据」横幅并透出错误码，避免把打包在客户端的示例内容误当成解析结果。这条约束由 `tests/miniapp/mock-provenance.test.ts` 守住。

Demo 状态支持 `BASELINE`、`DEMO_A`、`DEMO_B`、`DEMO_C` 隔离；开发验收可调用 `utils/api.js` 的 `resetDemoState()` 重置为仅含普通任务的基线，进入 Demo C 时才会注入延期通知对应的旧任务和 `pending` change event。首页 Changed 区域只由 pending change event 驱动，确认后 event 变为 `resolved`。

`src/protocol.ts` 是客户端与共享协议包的唯一边界；它不在小程序包内保存模型服务密钥。
