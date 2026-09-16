from pathlib import Path


def parse_audio(file_path: Path):

    # TODO:
    # 后面在这里调用语音识别 API
    # 例如：
    #
    # mp3 / wav / m4a
    #       ↓
    # 语音识别
    #       ↓
    # text

    return {
        "file_name": file_path.name,
        "file_type": "audio",
        "extension": file_path.suffix.lower(),
        "content": "",
        "status": "waiting_for_speech_recognition"
    }