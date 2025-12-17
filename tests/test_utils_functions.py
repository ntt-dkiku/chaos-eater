"""Unit tests for chaos_eater/utils/functions.py"""
import os
import json
import tempfile
import shutil
import pytest

from chaos_eater.utils.functions import (
    remove_spaces,
    write_file,
    read_file,
    copy_file,
    delete_file,
    copy_dir,
    save_json,
    load_json,
    save_jsonl,
    load_jsonl,
    extract_fname_wo_suffix,
    remove_files_in,
    make_artifact,
    get_timestamp,
    list_to_bullet_points,
    add_code_fences,
    sum_time,
    parse_time,
    add_timeunit,
    int_to_ordinal,
    dict_to_str,
    remove_curly_braces,
    get_file_extension,
    sanitize_k8s_name,
    sanitize_filename,
    limit_string_length,
    is_binary,
    CLIDisplayHandler,
    StreamDebouncer,
    MessageLogger,
)


class TestRemoveSpaces:
    def test_removes_leading_spaces(self):
        text = "  hello\n  world"
        assert remove_spaces(text) == "hello\nworld"

    def test_removes_trailing_spaces(self):
        text = "hello  \nworld  "
        assert remove_spaces(text) == "hello\nworld"

    def test_removes_both_spaces(self):
        text = "  hello  \n  world  "
        assert remove_spaces(text) == "hello\nworld"

    def test_empty_string(self):
        assert remove_spaces("") == ""

    def test_only_spaces(self):
        assert remove_spaces("   \n   ") == "\n"


class TestFileOperations:
    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for tests"""
        dirpath = tempfile.mkdtemp()
        yield dirpath
        shutil.rmtree(dirpath)

    def test_write_and_read_file(self, temp_dir):
        filepath = os.path.join(temp_dir, "test.txt")
        content = "Hello, World!"
        write_file(filepath, content)
        assert read_file(filepath) == content

    def test_write_file_unicode(self, temp_dir):
        filepath = os.path.join(temp_dir, "unicode.txt")
        content = "こんにちは世界"
        write_file(filepath, content)
        assert read_file(filepath) == content

    def test_copy_file(self, temp_dir):
        src = os.path.join(temp_dir, "source.txt")
        dst = os.path.join(temp_dir, "subdir", "dest.txt")
        content = "Copy me"
        write_file(src, content)
        copy_file(src, dst)
        assert read_file(dst) == content

    def test_delete_file_existing(self, temp_dir, capsys):
        filepath = os.path.join(temp_dir, "delete_me.txt")
        write_file(filepath, "delete")
        delete_file(filepath)
        assert not os.path.exists(filepath)
        captured = capsys.readouterr()
        assert "has been deleted" in captured.out

    def test_delete_file_nonexistent(self, temp_dir, capsys):
        filepath = os.path.join(temp_dir, "nonexistent.txt")
        delete_file(filepath)
        captured = capsys.readouterr()
        assert "does not exist" in captured.out

    def test_copy_dir_success(self, temp_dir, capsys):
        src = os.path.join(temp_dir, "src_dir")
        dst = os.path.join(temp_dir, "dst_dir")
        os.makedirs(src)
        write_file(os.path.join(src, "file.txt"), "content")
        result = copy_dir(src, dst)
        assert result is True
        assert os.path.exists(os.path.join(dst, "file.txt"))

    def test_copy_dir_source_not_exists(self, temp_dir, capsys):
        src = os.path.join(temp_dir, "nonexistent")
        dst = os.path.join(temp_dir, "dst")
        result = copy_dir(src, dst)
        assert result is False

    def test_copy_dir_dest_exists(self, temp_dir, capsys):
        src = os.path.join(temp_dir, "src")
        dst = os.path.join(temp_dir, "dst")
        os.makedirs(src)
        os.makedirs(dst)
        result = copy_dir(src, dst)
        assert result is False


class TestJsonOperations:
    @pytest.fixture
    def temp_dir(self):
        dirpath = tempfile.mkdtemp()
        yield dirpath
        shutil.rmtree(dirpath)

    def test_save_and_load_json(self, temp_dir):
        filepath = os.path.join(temp_dir, "test.json")
        data = {"key": "value", "number": 42, "nested": {"a": 1}}
        save_json(filepath, data)
        loaded = load_json(filepath)
        assert loaded == data

    def test_save_and_load_json_list(self, temp_dir):
        filepath = os.path.join(temp_dir, "list.json")
        data = [1, 2, 3, {"key": "value"}]
        save_json(filepath, data)
        loaded = load_json(filepath)
        assert loaded == data

    def test_save_and_load_jsonl(self, temp_dir):
        filepath = os.path.join(temp_dir, "test.jsonl")
        data = [
            {"id": 1, "name": "Alice"},
            {"id": 2, "name": "Bob"},
            {"id": 3, "name": "日本語"},
        ]
        save_jsonl(filepath, data)
        loaded = load_jsonl(filepath)
        assert loaded == data

    def test_jsonl_empty_list(self, temp_dir):
        filepath = os.path.join(temp_dir, "empty.jsonl")
        save_jsonl(filepath, [])
        loaded = load_jsonl(filepath)
        assert loaded == []


class TestExtractFnameWoSuffix:
    def test_simple_filename(self):
        assert extract_fname_wo_suffix("/path/to/file.txt") == "file"

    def test_multiple_dots(self):
        assert extract_fname_wo_suffix("/path/to/file.test.py") == "file.test"

    def test_no_extension(self):
        assert extract_fname_wo_suffix("/path/to/file") == "file"

    def test_hidden_file(self):
        assert extract_fname_wo_suffix("/path/to/.gitignore") == ".gitignore"


class TestMakeArtifact:
    @pytest.fixture
    def temp_dir(self):
        dirpath = tempfile.mkdtemp()
        yield dirpath
        shutil.rmtree(dirpath)

    def test_make_artifact_creates_zip(self, temp_dir):
        src_dir = os.path.join(temp_dir, "source")
        os.makedirs(src_dir)
        write_file(os.path.join(src_dir, "file.txt"), "content")
        dest_zip = os.path.join(temp_dir, "output", "archive.zip")
        result = make_artifact(src_dir, dest_zip)
        assert result.endswith(".zip")
        assert os.path.exists(result)


class TestRemoveFilesIn:
    @pytest.fixture
    def temp_dir(self):
        dirpath = tempfile.mkdtemp()
        yield dirpath
        shutil.rmtree(dirpath)

    def test_removes_all_files(self, temp_dir):
        # Create nested structure
        subdir = os.path.join(temp_dir, "sub")
        os.makedirs(subdir)
        write_file(os.path.join(temp_dir, "file1.txt"), "1")
        write_file(os.path.join(subdir, "file2.txt"), "2")
        remove_files_in(temp_dir)
        # Files should be gone, directories remain
        assert not os.path.exists(os.path.join(temp_dir, "file1.txt"))
        assert not os.path.exists(os.path.join(subdir, "file2.txt"))
        assert os.path.isdir(subdir)


class TestGetTimestamp:
    def test_format(self):
        ts = get_timestamp()
        # Should be YYYYMMDD_HHMMSS format
        assert len(ts) == 15
        assert ts[8] == "_"
        assert ts[:8].isdigit()
        assert ts[9:].isdigit()


class TestTimeOperations:
    class TestParseTime:
        def test_seconds(self):
            assert parse_time("30s") == 30

        def test_minutes(self):
            assert parse_time("5m") == 300

        def test_hours(self):
            assert parse_time("2h") == 7200

        def test_combined(self):
            assert parse_time("1h30m45s") == 5445

        def test_zero(self):
            assert parse_time("0") == 0

    class TestAddTimeunit:
        def test_zero(self):
            assert add_timeunit(0) == "0"

        def test_seconds_only(self):
            assert add_timeunit(45) == "45s"

        def test_minutes_and_seconds(self):
            assert add_timeunit(125) == "2m5s"

        def test_hours_minutes_seconds(self):
            assert add_timeunit(3665) == "1h1m5s"

        def test_days(self):
            assert add_timeunit(90061) == "1d1h1m1s"

    class TestSumTime:
        def test_simple_sum(self):
            assert sum_time("30s", "30s") == "1m"

        def test_mixed_units(self):
            assert sum_time("1h", "30m") == "1h30m"

        def test_with_zero(self):
            assert sum_time("5m", "0") == "5m"


class TestIntToOrdinal:
    def test_first(self):
        assert int_to_ordinal(1) == "1st"

    def test_second(self):
        assert int_to_ordinal(2) == "2nd"

    def test_third(self):
        assert int_to_ordinal(3) == "3rd"

    def test_fourth(self):
        assert int_to_ordinal(4) == "4th"

    def test_eleventh(self):
        assert int_to_ordinal(11) == "11th"

    def test_twelfth(self):
        assert int_to_ordinal(12) == "12th"

    def test_thirteenth(self):
        assert int_to_ordinal(13) == "13th"

    def test_twenty_first(self):
        assert int_to_ordinal(21) == "21st"

    def test_twenty_second(self):
        assert int_to_ordinal(22) == "22nd"

    def test_hundred_eleventh(self):
        assert int_to_ordinal(111) == "111th"


class TestStringOperations:
    def test_dict_to_str(self):
        result = dict_to_str({"key": "value"})
        assert "{" not in result or "{{" in result
        assert "}" not in result or "}}" in result

    def test_remove_curly_braces(self):
        text = "Hello {name}!"
        result = remove_curly_braces(text)
        assert result == "Hello {{name}}!"

    def test_get_file_extension(self):
        assert get_file_extension("file.txt") == ".txt"
        assert get_file_extension("file.tar.gz") == ".gz"
        assert get_file_extension("file") == ""

    def test_list_to_bullet_points(self):
        lst = ["item1", "item2", "item3"]
        result = list_to_bullet_points(lst)
        assert result == "- item1\n- item2\n- item3"

    def test_list_to_bullet_points_empty(self):
        assert list_to_bullet_points([]) == ""

    def test_add_code_fences_no_header(self):
        code = "print('hello')"
        result = add_code_fences(code)
        assert result == "```\nprint('hello')\n```"

    def test_add_code_fences_with_header(self):
        code = "print('hello')"
        result = add_code_fences(code, "python")
        assert result == "```python\nprint('hello')\n```"


class TestSanitizeK8sName:
    def test_lowercase(self):
        assert sanitize_k8s_name("MyService") == "myservice"

    def test_removes_invalid_chars(self):
        assert sanitize_k8s_name("my_service@123") == "myservice123"

    def test_removes_spaces(self):
        assert sanitize_k8s_name("my service") == "myservice"

    def test_removes_consecutive_hyphens(self):
        assert sanitize_k8s_name("my--service") == "my-service"

    def test_strips_leading_trailing_hyphens(self):
        assert sanitize_k8s_name("-myservice-") == "myservice"

    def test_empty_becomes_default(self):
        assert sanitize_k8s_name("@#$%") == "default-name"

    def test_truncates_to_63(self):
        long_name = "a" * 100
        result = sanitize_k8s_name(long_name)
        assert len(result) == 63


class TestSanitizeFilename:
    def test_removes_invalid_chars(self):
        assert sanitize_filename('file<>:"/\\|?*name.txt') == "filename.txt"

    def test_removes_brackets(self):
        assert sanitize_filename("file[test].txt") == "filetest.txt"

    def test_removes_spaces(self):
        assert sanitize_filename("my file.txt") == "myfile.txt"

    def test_removes_consecutive_hyphens(self):
        assert sanitize_filename("my--file.txt") == "my-file.txt"

    def test_empty_becomes_default(self):
        assert sanitize_filename("<>:?*") == "default-filename"

    def test_truncates_to_255(self):
        long_name = "a" * 300 + ".txt"
        result = sanitize_filename(long_name)
        assert len(result) == 255


class TestLimitStringLength:
    def test_short_string_unchanged(self):
        s = "hello"
        assert limit_string_length(s, 100) == s

    def test_long_string_truncated(self):
        s = "a" * 100
        result = limit_string_length(s, 20)
        assert len(result) <= 20
        assert "..." in result

    def test_preserves_start_and_end(self):
        s = "START" + "x" * 100 + "END"
        result = limit_string_length(s, 20)
        assert result.startswith("STAR") or "START" in result[:10]

    def test_suffix_longer_than_max(self):
        result = limit_string_length("hello", 2, suffix="...")
        assert result == "..."


class TestIsBinary:
    def test_text_content(self):
        assert is_binary(b"Hello, World!") is False

    def test_binary_with_null(self):
        assert is_binary(b"Hello\x00World") is True

    def test_high_byte_values(self):
        assert is_binary(bytes([128, 129, 130])) is True

    def test_empty_bytes(self):
        assert is_binary(b"") is False


class TestCLIDisplayHandler:
    def test_on_start(self, capsys):
        handler = CLIDisplayHandler()
        handler.on_start("test command")
        captured = capsys.readouterr()
        assert "$ test command" in captured.out

    def test_on_output(self, capsys):
        handler = CLIDisplayHandler()
        handler.on_output("output line")
        captured = capsys.readouterr()
        assert "output line" in captured.out

    def test_on_error(self, capsys):
        handler = CLIDisplayHandler()
        handler.on_error("error message")
        captured = capsys.readouterr()
        assert "Error: error message" in captured.out


class TestStreamDebouncer:
    def test_first_call_returns_true(self):
        debouncer = StreamDebouncer(interval=1.0)
        assert debouncer.should_update() is True

    def test_immediate_second_call_with_interval(self):
        debouncer = StreamDebouncer(interval=1.0)
        debouncer.should_update()
        # Immediate second call should return False
        assert debouncer.should_update() is False

    def test_zero_interval_always_true(self):
        debouncer = StreamDebouncer(interval=0)
        assert debouncer.should_update() is True
        assert debouncer.should_update() is True

    def test_reset(self):
        debouncer = StreamDebouncer(interval=1.0)
        debouncer.should_update()
        debouncer.reset()
        assert debouncer.last_update_time == 0


class TestMessageLogger:
    @pytest.fixture
    def temp_dir(self):
        dirpath = tempfile.mkdtemp()
        yield dirpath
        shutil.rmtree(dirpath)

    def test_save_empty(self, temp_dir):
        logger = MessageLogger()
        filepath = os.path.join(temp_dir, "messages.json")
        logger.save(filepath)
        with open(filepath) as f:
            data = json.load(f)
        assert data == []

    def test_save_with_messages(self, temp_dir):
        logger = MessageLogger()
        logger.messages = [{"role": "user", "content": "hello"}]
        filepath = os.path.join(temp_dir, "messages.json")
        logger.save(filepath)
        with open(filepath) as f:
            data = json.load(f)
        assert data == [{"role": "user", "content": "hello"}]
