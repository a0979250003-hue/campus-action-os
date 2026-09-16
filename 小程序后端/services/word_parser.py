from pathlib import Path
from docx import Document


def parse_docx(file_path: Path):

    document = Document(str(file_path))

    paragraphs = []

    for paragraph in document.paragraphs:

        text = paragraph.text.strip()

        if text:
            paragraphs.append(text)

    content = "\n".join(paragraphs)

    return {
        "file_name": file_path.name,
        "file_type": "word",
        "extension": ".docx",
        "content": content
    }