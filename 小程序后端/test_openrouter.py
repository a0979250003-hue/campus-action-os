import httpx
from openai import OpenAI

api_key = "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"

http_client = httpx.Client(
    trust_env=False,
    timeout=60.0
)

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=api_key,
    http_client=http_client
)

print("1. OpenRouter客户端创建成功")
print("2. 开始调用AI")

response = client.chat.completions.create(
    model="openrouter/free",
    messages=[
        {
            "role": "user",
            "content": "请只回答：OpenRouter连接成功"
        }
    ]
)

print("3. AI返回成功")
print("回答：", response.choices[0].message.content)