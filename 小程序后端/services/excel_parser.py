from pathlib import Path
import pandas as pd


def parse_excel(file_path: Path):

    extension = file_path.suffix.lower()

    if extension == ".csv":

        df = pd.read_csv(file_path)

    else:

        df = pd.read_excel(file_path)

    data = df.fillna("").to_dict(
        orient="records"
    )

    return {
        "file_name": file_path.name,
        "file_type": "table",
        "extension": extension,
        "columns": list(df.columns),
        "row_count": len(df),
        "data": data
    }