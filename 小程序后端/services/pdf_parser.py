from pathlib import Path
from pypdf import PdfReader


def parse_pdf(file_path: Path):

    reader = PdfReader(str(file_path))

    pages = []

    for page in reader.pages:

        text = page.extract_text()

        if text:
            pages.append(text)

    content = "\n".join(pages)

    return {
        "file_name": file_path.name,
        "file_type": "pdf",
        "extension": ".pdf",
        "page_count": len(reader.pages),
        "content": content
    }