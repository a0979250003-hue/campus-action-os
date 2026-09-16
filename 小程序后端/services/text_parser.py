from pathlib import Path


def parse_txt(file_path: Path):

    with open(
        file_path,
        "r",
        encoding="utf-8"
    ) as f:

        content = f.read()

    return {
        "file_name": file_path.name,
        "file_type": "text",
        "extension": ".txt",
        "content": content
    }