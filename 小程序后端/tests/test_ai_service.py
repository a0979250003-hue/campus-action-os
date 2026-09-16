"""services/ai_service.py 的纯函数单元测试。

只依赖标准库：不发起网络请求，也不要求安装 httpx / openai。
"""

import os
import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services import ai_service  # noqa: E402


class ExtractContentTest(unittest.TestCase):

    def test_text_type_uses_content_field(self):

        data = {
            "file_name": "通知.txt",
            "file_type": "text",
            "content": "选课通知正文"
        }

        self.assertEqual(ai_service.extract_content(data), "选课通知正文")

    def test_table_type_uses_data_field(self):

        data = {
            "file_name": "名单.xlsx",
            "file_type": "table",
            "data": [{"学号": "001"}]
        }

        self.assertEqual(ai_service.extract_content(data), "[{'学号': '001'}]")

    def test_unknown_type_falls_back_to_whole_payload(self):

        data = {"file_type": "unknown", "raw": "x"}

        self.assertIn("raw", ai_service.extract_content(data))

    def test_missing_content_is_empty_string(self):

        self.assertEqual(ai_service.extract_content({"file_type": "text"}), "")

    def test_long_content_is_truncated_with_marker(self):

        data = {"file_type": "text", "content": "a" * 12000}

        result = ai_service.extract_content(data)

        self.assertTrue(result.startswith("a" * 100))
        self.assertIn("[文件内容过长，后续内容已截断]", result)
        self.assertEqual(
            len(result),
            ai_service.MAX_CONTENT_LENGTH + len("\n\n[文件内容过长，后续内容已截断]")
        )

    def test_content_at_limit_is_not_truncated(self):

        data = {"file_type": "text", "content": "a" * ai_service.MAX_CONTENT_LENGTH}

        self.assertNotIn("已截断", ai_service.extract_content(data))


class BuildPromptTest(unittest.TestCase):

    def test_prompt_carries_name_type_and_content(self):

        prompt = ai_service.build_prompt("通知.pdf", "pdf", "正文内容")

        self.assertIn("通知.pdf", prompt)
        self.assertIn("pdf", prompt)
        self.assertIn("正文内容", prompt)


class ApiKeyTest(unittest.TestCase):

    def test_missing_api_key_raises_instead_of_faking_result(self):

        saved = os.environ.pop("OPENROUTER_API_KEY", None)

        try:

            with self.assertRaises(RuntimeError):

                ai_service._get_api_key()

        finally:

            if saved is not None:
                os.environ["OPENROUTER_API_KEY"] = saved

    def test_configured_api_key_is_returned(self):

        saved = os.environ.get("OPENROUTER_API_KEY")
        os.environ["OPENROUTER_API_KEY"] = "unit-test-value"

        try:

            self.assertEqual(ai_service._get_api_key(), "unit-test-value")

        finally:

            if saved is None:
                os.environ.pop("OPENROUTER_API_KEY", None)
            else:
                os.environ["OPENROUTER_API_KEY"] = saved

    def test_blank_api_key_counts_as_missing(self):

        saved = os.environ.get("OPENROUTER_API_KEY")
        os.environ["OPENROUTER_API_KEY"] = "   "

        try:

            with self.assertRaises(RuntimeError):

                ai_service._get_api_key()

        finally:

            if saved is None:
                os.environ.pop("OPENROUTER_API_KEY", None)
            else:
                os.environ["OPENROUTER_API_KEY"] = saved


class FallbackModelsTest(unittest.TestCase):

    def test_default_when_unset(self):

        saved = os.environ.pop("OPENROUTER_FALLBACK_MODELS", None)

        try:

            self.assertEqual(
                ai_service._get_fallback_models(),
                ai_service.DEFAULT_FALLBACK_MODELS
            )

        finally:

            if saved is not None:
                os.environ["OPENROUTER_FALLBACK_MODELS"] = saved

    def test_comma_separated_list_is_parsed(self):

        saved = os.environ.get("OPENROUTER_FALLBACK_MODELS")
        os.environ["OPENROUTER_FALLBACK_MODELS"] = "a/free, b/free ,, c/free"

        try:

            self.assertEqual(
                ai_service._get_fallback_models(),
                ["a/free", "b/free", "c/free"]
            )

        finally:

            if saved is None:
                os.environ.pop("OPENROUTER_FALLBACK_MODELS", None)
            else:
                os.environ["OPENROUTER_FALLBACK_MODELS"] = saved


class BaseUrlTest(unittest.TestCase):

    def test_default_base_url(self):

        saved = os.environ.pop("OPENROUTER_BASE_URL", None)

        try:

            self.assertEqual(
                ai_service._get_base_url(),
                ai_service.DEFAULT_BASE_URL
            )

        finally:

            if saved is not None:
                os.environ["OPENROUTER_BASE_URL"] = saved

    def test_model_default(self):

        saved = os.environ.pop("OPENROUTER_MODEL", None)

        try:

            self.assertEqual(ai_service._get_model(), ai_service.DEFAULT_MODEL)

        finally:

            if saved is not None:
                os.environ["OPENROUTER_MODEL"] = saved


if __name__ == "__main__":

    unittest.main()
