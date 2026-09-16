# 小程序后端：文件智能分析原型

`apps/student-miniapp` 的文件上传后端原型。链路是：上传文件 → 按扩展名识别类型 → 解析为统一 JSON → 可选调用 AI 生成中文分析。

本目录是**独立于已冻结 M2 文本契约**的早期原型，见 `docs/interfaces/m2-text-boundary.md`。它只承担“文件进、JSON 出”这一段，**不产生 Verified Action Object，不写产品业务状态，也不参与 `npm run test:m2`**。M2 契约只接受 `text/plain`；本目录额外支持 PDF、Word、Excel、音频和图片。

## 与仓库其它边界的关系

| 位置                                  | 关系                                                  |
| ------------------------------------- | ----------------------------------------------------- |
| `services/ai-parser`                  | M2 解析边界骨架，当前按设计返回 501，与本目录互相独立 |
| `apps/student-miniapp`                | 本服务预期的小程序调用方                              |
| `docs/interfaces/m2-text-boundary.md` | 冻结的文本接口契约，本目录不实现它                    |

## 目录结构

```text
小程序后端/
├── main.py                    FastAPI 应用与 POST /upload
├── requirements.txt
├── .env.example               环境变量清单（复制为 .env.local 后填写）
├── services/
│   ├── file_parser.py         按扩展名分发到具体解析器
│   ├── text_parser.py         .txt
│   ├── pdf_parser.py          .pdf
│   ├── word_parser.py         .docx
│   ├── excel_parser.py        .xlsx / .xls / .csv
│   ├── audio_parser.py        .mp3 / .wav / .m4a / .aac / .flac（占位）
│   ├── image_parser.py        .jpg / .jpeg / .png / .bmp / .webp（占位）
│   └── ai_service.py          OpenRouter 调用与提示词
├── tests/                     纯函数单元测试，不依赖第三方库
├── uploads/                   运行时上传目录（不纳入版本控制）
└── json_data/                 运行时解析产物（不纳入版本控制）
```

## 安装与启动

```text
cd 小程序后端
py -3 -m venv .venv
.venv\Scripts\activate
py -3 -m pip install -r requirements.txt
copy .env.example .env.local
py -3 main.py
```

也可以从仓库根目录运行：`py -3 小程序后端/main.py`。`uploads/` 与 `json_data/` 固定相对于本目录，不随当前工作目录变化。

启动后默认监听 `http://127.0.0.1:8000`。

## 接口

| 方法 | 路径      | 说明                                       |
| ---- | --------- | ------------------------------------------ |
| GET  | `/`       | 服务信息                                   |
| GET  | `/health` | 健康检查                                   |
| POST | `/upload` | 上传单个文件，返回解析 JSON 与 AI 分析结果 |

`POST /upload` 的响应形如：

```json
{
  "success": true,
  "message": "文件处理成功",
  "data": { "file_name": "通知.pdf", "file_type": "pdf", "content": "..." },
  "analysis": { "status": "success", "analysis": "...", "model": "..." }
}
```

AI 未配置或调用失败时，解析结果照常返回，`analysis.status` 为 `error` 并带 `message`，**不会伪造分析内容**。

## 环境变量

见 `.env.example`。应用启动时按 `.env.local` → `.env` 的顺序加载（依赖 `python-dotenv`，未安装时直接读进程环境变量）。

| 变量                         | 必填 | 说明                                |
| ---------------------------- | ---- | ----------------------------------- |
| `OPENROUTER_API_KEY`         | 是   | 未配置时 AI 分析返回明确错误        |
| `OPENROUTER_BASE_URL`        | 否   | 默认 `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL`           | 否   | 默认 `openrouter/free`              |
| `OPENROUTER_FALLBACK_MODELS` | 否   | 备用模型，英文逗号分隔              |

密钥只从环境变量读取。**禁止把真实密钥写进仓库**，`npm run scan:secrets` 会拦截。

## 解析结果形态

`data` 字段按文件类型给出不同结构，公共字段是 `file_name`、`file_type`、`extension`。

- 文本 / PDF / Word：`content`；PDF 额外有 `page_count`
- 表格：`columns`、`row_count`、`data`（按行记录的列表）
- 音频 / 图片：`content` 为空，`status` 为 `waiting_for_speech_recognition` 或 `waiting_for_ocr`

音频和图片目前是占位实现。它们会正常返回 JSON，但因为 `content` 为空，此时调用 AI 得不到有效分析。

## 测试

```text
npm run test:analyzer
```

测试只覆盖纯函数（内容截断、提示词构造、密钥缺失时的行为），不发起网络请求，也不要求安装 `httpx` / `openai`。

## 尚未实现

身份认证、上传大小与类型白名单、并发与限流、音频转写、图片 OCR、解析结果持久化、与 M2 契约（`TextParseRequest` / `Verified Action Object`）的对接均未实现。本目录尚未纳入 `services/` 的 M2 边界，若要与冻结契约对齐，需按仓库约定另行提案。
