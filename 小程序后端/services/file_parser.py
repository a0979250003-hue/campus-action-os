from pathlib import Path

from services.text_parser import parse_txt
from services.pdf_parser import parse_pdf
from services.word_parser import parse_docx
from services.excel_parser import parse_excel
from services.audio_parser import parse_audio
from services.image_parser import parse_image


def parse_file(file_path: Path):

    extension = file_path.suffix.lower()

    print(f"检测到文件类型：{extension}")

    # TXT
    if extension == ".txt":
        return parse_txt(file_path)

    # PDF
    elif extension == ".pdf":
        return parse_pdf(file_path)

    # Word
    elif extension == ".docx":
        return parse_docx(file_path)

    # Excel
    elif extension in [".xlsx", ".xls", ".csv"]:
        return parse_excel(file_path)

    # 音频
    elif extension in [
        ".mp3",
        ".wav",
        ".m4a",
        ".aac",
        ".flac"
    ]:
        return parse_audio(file_path)

    # 图片
    elif extension in [
        ".jpg",
        ".jpeg",
        ".png",
        ".bmp",
        ".webp"
    ]:
        return parse_image(file_path)

    else:
        raise ValueError(
            f"暂不支持的文件类型：{extension}"
        )