from fastapi import FastAPI, UploadFile, File
from pathlib import Path
import shutil
import json

from services.file_parser import parse_file


app = FastAPI(
    title="文件智能分析后端",
    description="自动识别文件类型，解析文件并转换为JSON",
    version="1.0.0"
)


UPLOAD_DIR = Path("uploads")
JSON_DIR = Path("json_data")

UPLOAD_DIR.mkdir(exist_ok=True)
JSON_DIR.mkdir(exist_ok=True)


@app.get("/health")
def health_check():
    return {
        "success": True,
        "message": "后端运行正常"
    }


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):

    # 1. 检查文件名
    if not file.filename:
        return {
            "success": False,
            "message": "没有检测到文件"
        }

    # 2. 保存原始文件
    file_path = UPLOAD_DIR / file.filename

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:

        # 3. 根据文件类型解析
        result = parse_file(file_path)

        # 4. 保存JSON
        json_filename = file_path.stem + ".json"
        json_path = JSON_DIR / json_filename

        with open(
            json_path,
            "w",
            encoding="utf-8"
        ) as f:

            json.dump(
                result,
                f,
                ensure_ascii=False,
                indent=4
            )

        # 5. 返回结果
        return {
            "success": True,
            "message": "文件处理成功",
            "data": result
        }

    except Exception as e:

        return {
            "success": False,
            "message": f"文件处理失败：{str(e)}"
        }
