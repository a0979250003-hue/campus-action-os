import httpx
from openai import OpenAI


# ==============================
# OpenRouter API Key
# ==============================

API_KEY = "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"


# ==============================
# 网络配置
# ==============================

http_client = httpx.Client(
    trust_env=False,
    timeout=60.0
)


# ==============================
# 创建 OpenRouter 客户端
# ==============================

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=API_KEY,
    http_client=http_client
)


# ==============================
# AI 文件分析
# ==============================

def analyze_json(data):

    file_name = data.get("file_name", "未知文件")
    file_type = data.get("file_type", "未知类型")

    # ==============================
    # 获取文件内容
    # ==============================

    if file_type in ["text", "pdf", "word"]:

        content = data.get("content", "")

    elif file_type == "table":

        content = str(data.get("data", ""))

    elif file_type in ["audio", "image"]:

        content = data.get("content", "")

    else:

        content = str(data)

    content = str(content)

    # 防止文件内容太长
    max_length = 10000

    if len(content) > max_length:

        content = content[:max_length]

        content += "\n\n[文件内容过长，后续内容已截断]"


    # ==============================
    # 构造提示词
    # ==============================

    prompt = f"""
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
    # 调用 OpenRouter
    # ==============================

    try:

        print()
        print("=" * 60)
        print("开始调用 OpenRouter AI")
        print("=" * 60)

        response = client.chat.completions.create(

            # 主模型
            model="openrouter/free",

            # 免费模型备用列表
            extra_body={
                "models": [
                    "google/gemma-4-31b-it:free",
                    "google/gemma-4-26b-a4b-it:free"
                ]
            },

            messages=[
                {
                    "role": "system",
                    "content": "你是一名专业的中文文件分析助手。"
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],

            temperature=0.3,

            max_tokens=2000
        )


        # ==============================
        # 获取结果
        # ==============================

        if not response.choices:

            return {
                "status": "error",
                "analysis": "",
                "message": "AI没有返回有效结果"
            }


        analysis = response.choices[0].message.content

        print("AI分析成功")

        # 打印实际使用的模型
        print("实际使用模型：", response.model)

        print("=" * 60)


        return {
            "status": "success",
            "analysis": analysis,
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