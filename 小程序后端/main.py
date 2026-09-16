from fastapi import FastAPI, UploadFile, File
from pathlib import Path
from contextlib import asynccontextmanager
import shutil
import json
import uvicorn

from services.file_parser import parse_file
from services.ai_service import analyze_json


# ==============================
# 项目目录
# ==============================

UPLOAD_DIR = Path("uploads")
JSON_DIR = Path("json_data")

UPLOAD_DIR.mkdir(exist_ok=True)
JSON_DIR.mkdir(exist_ok=True)


# ==============================
# 后端启动与关闭
# ==============================

@asynccontextmanager
async def lifespan(app: FastAPI):

    print("=" * 60)
    print("文件智能分析后端启动成功")
    print("=" * 60)
    print("后端地址：   http://127.0.0.1:8000")
    print("接口文档：   http://127.0.0.1:8000/docs")
    print("健康检查：   http://127.0.0.1:8000/health")
    print("文件上传：   POST http://127.0.0.1:8000/upload")
    print("=" * 60)

    yield

    print("后端正在关闭...")


# ==============================
# 创建 FastAPI
# ==============================

app = FastAPI(
    title="文件智能分析后端",
    description="自动识别文件类型、解析文件、转换JSON并调用AI进行分析",
    version="1.0.0",
    lifespan=lifespan
)


# ==============================
# 首页
# ==============================

@app.get("/")
def root():
    return {
        "success": True,
        "message": "文件智能分析后端运行正常",
        "docs": "http://127.0.0.1:8000/docs",
        "upload_api": "POST http://127.0.0.1:8000/upload"
    }


# ==============================
# 健康检查
# ==============================

@app.get("/health")
def health_check():
    return {
        "success": True,
        "message": "后端运行正常"
    }


# ==============================
# 文件上传
# ==============================

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):

    # ------------------------------
    # 1. 检查文件
    # ------------------------------

    if not file.filename:
        return {
            "success": False,
            "message": "没有检测到文件"
        }

    print()
    print("=" * 60)
    print(f"收到文件：{file.filename}")
    print("=" * 60)

    # ------------------------------
    # 2. 保存原始文件
    # ------------------------------

    file_path = UPLOAD_DIR / file.filename

    try:

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        print(f"文件保存成功：{file_path}")

    except Exception as e:

        print(f"文件保存失败：{e}")

        return {
            "success": False,
            "message": f"文件保存失败：{str(e)}"
        }

    # ------------------------------
    # 3. 自动识别并解析文件
    # ------------------------------

    try:

        print("开始解析文件...")

        result = parse_file(file_path)

        print("文件解析成功")

    except Exception as e:

        print(f"文件解析失败：{e}")

        return {
            "success": False,
            "message": f"文件解析失败：{str(e)}"
        }

    # ------------------------------
    # 4. 保存 JSON
    # ------------------------------

    try:

        json_filename = file_path.stem + ".json"
        json_path = JSON_DIR / json_filename

        with open(json_path, "w", encoding="utf-8") as f:

            json.dump(
                result,
                f,
                ensure_ascii=False,
                indent=4
            )

        print(f"JSON保存成功：{json_path}")

    except Exception as e:

        print(f"JSON保存失败：{e}")

        return {
            "success": False,
            "message": f"JSON保存失败：{str(e)}"
        }

    # ------------------------------
    # 5. 调用 AI
    # ------------------------------

    print("开始调用AI分析...")

    try:

        analysis = analyze_json(result)

        print("AI分析完成")

    except Exception as e:

        print(f"AI分析失败：{e}")

        analysis = {
            "status": "error",
            "analysis": "",
            "message": f"AI分析失败：{str(e)}"
        }

    # ------------------------------
    # 6. 返回结果
    # ------------------------------

    print("=" * 60)
    print("文件处理完成")
    print("=" * 60)

    return {
        "success": True,
        "message": "文件处理成功",

        # 解析后的统一JSON数据
        "data": result,

        # AI分析结果
        "analysis": analysis
    }


# ==============================
# 直接运行 main.py 时启动服务器
# ==============================

if __name__ == "__main__":

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True
    )