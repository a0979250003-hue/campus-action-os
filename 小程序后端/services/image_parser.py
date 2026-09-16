from pathlib import Path


def parse_image(file_path: Path):

    # TODO:
    # 后面接 OCR
    # 图片 → OCR → 文字

    return {
        "file_name": file_path.name,
        "file_type": "image",
        "extension": file_path.suffix.lower(),
        "content": "",
        "status": "waiting_for_ocr"
    }