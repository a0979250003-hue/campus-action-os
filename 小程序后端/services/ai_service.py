import os

# httpx / openai 只在真正调用 AI 时导入，保证本模块可以被单独导入和测试。


# ==============================
# 默认配置
# ==============================

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "openrouter/free"
DEFAULT_FALLBACK_MODELS = [
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
]

# 文件内容截断长度，避免超出上下文限制
MAX_CONTENT_LENGTH = 10000

SYSTEM_PROMPT = "你是一名专业的中文文件分析助手。"


# ==============================
# 运行时配置（全部来自环境变量，禁止写入仓库）
# ==============================

def _get_api_key() -> str:
    """从环境变量读取 API Key；未配置时给出明确错误，不返回伪造结果。"""

    value = os.environ.get("OPENROUTER_API_KEY", "").strip()

    if not value:

        raise RuntimeError(
            "未配置 OPENROUTER_API_KEY 环境变量，"
            "AI 分析不可用。请复制 .env.example 为 .env.local 并填写密钥。"
        )

    return value


def _get_base_url() -> str:

    return os.environ.get("OPENROUTER_BASE_URL", "").strip() or DEFAULT_BASE_URL


def _get_model() -> str:

    return os.environ.get("OPENROUTER_MODEL", "").strip() or DEFAULT_MODEL


def _get_fallback_models() -> list:

    raw = os.environ.get("OPENROUTER_FALLBACK_MODELS", "").strip()

    if not raw:

        return DEFAULT_FALLBACK_MODELS

    return [item.strip() for item in raw.split(",") if item.strip()]


# ==============================
# 创建 OpenRouter 客户端（按需创建）
# ==============================

def create_client():
    """创建 OpenRouter 客户端。仅在真正调用 AI 时创建，导入本模块不会失败。"""

    import httpx
    from openai import OpenAI

    http_client = httpx.Client(
        trust_env=False,
        timeout=60.0
    )

    return OpenAI(
        base_url=_get_base_url(),
        api_key=_get_api_key(),
        http_client=http_client
    )


# ==============================
# 提取用于分析的文件内容
# ==============================

def extract_content(data: dict) -> str:

    file_type = data.get("file_type", "未知类型")

    if file_type in ["text", "pdf", "word"]:

        content = data.get("content", "")

    elif file_type == "table":

        content = data.get("data", "")

    elif file_type in ["audio", "image"]:

        content = data.get("content", "")

    else:

        content = data

    content = str(content)

    if len(content) > MAX_CONTENT_LENGTH:

        content = content[:MAX_CONTENT_LENGTH]

        content += "\n\n[文件内容过长，后续内容已截断]"

    return content


# ==============================
# 构造提示词
# ==============================

def build_prompt(file_name: str, file_type: str, content: str) -> str:

    return f"""
你是一名专业的中文文件分析助手。

请分析用户上传的文件。

【文件名称】
{file_name}

【文件类型】
{file_type}

【文件内容】
{content}

请严格根据文件内容进行分析。

请按照以下格式回答：

一、文件概述
说明这个文件主要讲了什么。

二、关键信息
列出文件中的重要信息。

三、内容结构
分析文件的主要结构。

四、重点内容
指出文件中值得重点关注的内容。

五、问题分析
如果文件存在明显的问题、缺失信息或者逻辑问题，请指出。
如果没有明显问题，请写“暂未发现明显问题”。

六、总结
用简洁的语言总结整个文件。

要求：

1. 使用中文回答。
2. 必须真正分析文件内容。
3. 不要只进行安全分类。
4. 不要回答与文件无关的问题。
5. 不要编造文件中不存在的信息。
"""


# ==============================
# AI 文件分析
# ==============================

def analyze_json(data: dict) -> dict:

    file_name = data.get("file_name", "未知文件")
    file_type = data.get("file_type", "未知类型")

    content = extract_content(data)

    prompt = build_prompt(file_name, file_type, content)

    try:

        print()
        print("=" * 60)
        print("开始调用 OpenRouter AI")
        print("=" * 60)

        client = create_client()

        response = client.chat.completions.create(

            # 主模型
            model=_get_model(),

            # 免费模型备用列表
            extra_body={
                "models": _get_fallback_models()
            },

            messages=[
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],

            temperature=0.3,

            max_tokens=2000
        )

        if not response.choices:

            return {
                "status": "error",
                "analysis": "",
                "message": "AI没有返回有效结果"
            }

        print("AI分析成功")

        # 打印实际使用的模型
        print("实际使用模型：", response.model)

        print("=" * 60)

        return {
            "status": "success",
            "analysis": response.choices[0].message.content,
            "model": response.model
        }

    except Exception as e:

        print()
        print("=" * 60)
        print("AI分析失败")
        print("=" * 60)

        print("错误类型：", type(e).__name__)
        print("错误信息：", str(e))

        print("=" * 60)

        return {
            "status": "error",
            "analysis": "",
            "message": f"AI分析失败：{str(e)}"
        }
