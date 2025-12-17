"""Unit tests for chaos_eater/utils/schemas.py"""
import pytest

from chaos_eater.utils.schemas import File


class TestFileSchema:
    """Tests for File schema"""

    def test_create_file_with_string_content(self):
        file = File(
            path="/app/test.py",
            content="print('hello')",
            work_dir="/app",
            fname="test.py"
        )
        assert file.path == "/app/test.py"
        assert file.content == "print('hello')"
        assert file.work_dir == "/app"
        assert file.fname == "test.py"

    def test_create_file_with_bytes_content(self):
        file = File(
            path="/app/image.png",
            content=b"\x89PNG\r\n\x1a\n",
            work_dir="/app",
            fname="image.png"
        )
        assert file.path == "/app/image.png"
        assert isinstance(file.content, bytes)

    def test_create_file_with_optional_fields_none(self):
        file = File(
            path="/app/test.py",
            content="content",
            work_dir=None,
            fname=None
        )
        assert file.path == "/app/test.py"
        assert file.work_dir is None
        assert file.fname is None

    def test_file_dict_conversion(self):
        file = File(
            path="/app/test.py",
            content="content",
            work_dir="/app",
            fname="test.py"
        )
        file_dict = file.dict()
        assert file_dict["path"] == "/app/test.py"
        assert file_dict["content"] == "content"
        assert file_dict["work_dir"] == "/app"
        assert file_dict["fname"] == "test.py"

    def test_file_with_nested_path(self):
        file = File(
            path="/app/src/components/Button.tsx",
            content="export const Button = () => {}",
            work_dir="/app",
            fname="src/components/Button.tsx"
        )
        assert file.path == "/app/src/components/Button.tsx"
        assert file.fname == "src/components/Button.tsx"

    def test_file_with_empty_content(self):
        file = File(
            path="/app/empty.txt",
            content="",
            work_dir="/app",
            fname="empty.txt"
        )
        assert file.content == ""

    def test_file_with_multiline_content(self):
        content = """line 1
line 2
line 3"""
        file = File(
            path="/app/multiline.txt",
            content=content,
            work_dir="/app",
            fname="multiline.txt"
        )
        assert file.content == content
        assert file.content.count("\n") == 2

    def test_file_with_unicode_content(self):
        file = File(
            path="/app/unicode.txt",
            content="日本語テスト 🚀",
            work_dir="/app",
            fname="unicode.txt"
        )
        assert "日本語" in file.content
        assert "🚀" in file.content

    def test_file_with_special_characters_in_path(self):
        file = File(
            path="/app/test file (1).txt",
            content="content",
            work_dir="/app",
            fname="test file (1).txt"
        )
        assert file.path == "/app/test file (1).txt"
