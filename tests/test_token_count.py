"""Unit tests for token counting and logging functionality in chaos_eater/utils/llms.py"""
import os
import tempfile
import pytest
from unittest.mock import Mock, MagicMock, patch


class TestTokenUsage:
    """Tests for TokenUsage model"""

    def test_create_token_usage(self):
        from chaos_eater.utils.llms import TokenUsage

        usage = TokenUsage(input_tokens=100, output_tokens=50, total_tokens=150)
        assert usage.input_tokens == 100
        assert usage.output_tokens == 50
        assert usage.total_tokens == 150

    def test_token_usage_defaults(self):
        from chaos_eater.utils.llms import TokenUsage

        usage = TokenUsage(input_tokens=0, output_tokens=0, total_tokens=0)
        assert usage.input_tokens == 0
        assert usage.output_tokens == 0
        assert usage.total_tokens == 0


class TestLLMLog:
    """Tests for LLMLog model"""

    def test_create_llm_log(self):
        from chaos_eater.utils.llms import LLMLog, TokenUsage

        token_usage = TokenUsage(input_tokens=100, output_tokens=50, total_tokens=150)
        log = LLMLog(
            agent_name="test_agent",
            token_usage=token_usage,
            message_history=["prompt1", "response1"]
        )
        assert log.agent_name == "test_agent"
        assert log.token_usage.total_tokens == 150
        assert len(log.message_history) == 2

    def test_llm_log_empty_history(self):
        from chaos_eater.utils.llms import LLMLog, TokenUsage

        token_usage = TokenUsage(input_tokens=0, output_tokens=0, total_tokens=0)
        log = LLMLog(
            agent_name="empty_agent",
            token_usage=token_usage,
            message_history=[]
        )
        assert log.message_history == []


class TestLogBundle:
    """Tests for LogBundle model"""

    def test_create_log_bundle(self):
        from chaos_eater.utils.llms import LogBundle

        bundle = LogBundle(logs={}, updated_at=1234567890.0)
        assert bundle.logs == {}
        assert bundle.updated_at == 1234567890.0

    def test_log_bundle_with_logs(self):
        from chaos_eater.utils.llms import LogBundle, LLMLog, TokenUsage

        token_usage = TokenUsage(input_tokens=10, output_tokens=5, total_tokens=15)
        log = LLMLog(agent_name="test", token_usage=token_usage, message_history=[])

        bundle = LogBundle(logs={"phase1": [log]}, updated_at=0.0)
        assert "phase1" in bundle.logs
        assert len(bundle.logs["phase1"]) == 1


class TestLoggingCallback:
    """Tests for LoggingCallback class"""

    def test_logging_callback_openai_model(self):
        from chaos_eater.utils.llms import LoggingCallback

        mock_llm = Mock()
        mock_llm.__fields__ = {"model_name": Mock()}
        mock_llm.model_name = "gpt-4o"

        callback = LoggingCallback(agent_name="test_agent", llm=mock_llm, streaming=False)
        assert callback.agent_name == "test_agent"
        assert callback.model_provider == "openai"
        assert callback.token_usage.total_tokens == 0

    def test_logging_callback_anthropic_model(self):
        from chaos_eater.utils.llms import LoggingCallback

        mock_llm = Mock()
        mock_llm.__fields__ = {"model": Mock()}
        mock_llm.model = "claude-3-5-sonnet"

        callback = LoggingCallback(agent_name="test_agent", llm=mock_llm, streaming=False)
        assert callback.model_provider == "anthropic"

    def test_logging_callback_google_model(self):
        from chaos_eater.utils.llms import LoggingCallback

        mock_llm = Mock()
        mock_llm.__fields__ = {"model": Mock()}
        mock_llm.model = "gemini-1.5-pro"

        callback = LoggingCallback(agent_name="test_agent", llm=mock_llm, streaming=False)
        assert callback.model_provider == "google"

    def test_logging_callback_on_llm_start(self):
        from chaos_eater.utils.llms import LoggingCallback

        mock_llm = Mock()
        mock_llm.__fields__ = {"model_name": Mock()}
        mock_llm.model_name = "gpt-4o"

        callback = LoggingCallback(agent_name="test_agent", llm=mock_llm, streaming=False)
        callback.on_llm_start(serialized={}, prompts=["Hello, world!"])

        assert len(callback.message_history) == 1
        assert callback.message_history[0] == ["Hello, world!"]

    def test_logging_callback_invalid_llm(self):
        from chaos_eater.utils.llms import LoggingCallback

        mock_llm = Mock()
        mock_llm.__fields__ = {}

        with pytest.raises(TypeError, match="Invalid llm"):
            LoggingCallback(agent_name="test_agent", llm=mock_llm, streaming=False)


class TestAgentLogger:
    """Tests for AgentLogger class"""

    def test_agent_logger_init(self):
        from chaos_eater.utils.llms import AgentLogger

        mock_llm = Mock()

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "logs", "test.jsonl")
            logger = AgentLogger(llm=mock_llm, log_path=log_path)

            assert logger.llm == mock_llm
            assert logger.log_path == log_path
            assert os.path.exists(os.path.dirname(log_path))

    def test_agent_logger_add_log(self):
        from chaos_eater.utils.llms import AgentLogger, LLMLog, TokenUsage

        mock_llm = Mock()
        token_usage = TokenUsage(input_tokens=10, output_tokens=5, total_tokens=15)
        log = LLMLog(agent_name="test", token_usage=token_usage, message_history=[])

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "logs", "test.jsonl")
            logger = AgentLogger(llm=mock_llm, log_path=log_path)
            logger.add_log("hypothesis", log)

            bundle = logger.get_bundle()
            assert "hypothesis" in bundle.logs
            assert len(bundle.logs["hypothesis"]) == 1

    def test_agent_logger_add_logs(self):
        from chaos_eater.utils.llms import AgentLogger, LLMLog, TokenUsage

        mock_llm = Mock()
        token_usage = TokenUsage(input_tokens=10, output_tokens=5, total_tokens=15)
        logs = [
            LLMLog(agent_name="test1", token_usage=token_usage, message_history=[]),
            LLMLog(agent_name="test2", token_usage=token_usage, message_history=[])
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "logs", "test.jsonl")
            logger = AgentLogger(llm=mock_llm, log_path=log_path)
            logger.add_logs("experiment", logs)

            bundle = logger.get_bundle()
            assert len(bundle.logs["experiment"]) == 2

    def test_agent_logger_get_phase(self):
        from chaos_eater.utils.llms import AgentLogger, LLMLog, TokenUsage

        mock_llm = Mock()
        token_usage = TokenUsage(input_tokens=10, output_tokens=5, total_tokens=15)
        log = LLMLog(agent_name="test", token_usage=token_usage, message_history=[])

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "logs", "test.jsonl")
            logger = AgentLogger(llm=mock_llm, log_path=log_path)
            logger.add_log("analysis", log)

            phase_logs = logger.get_phase("analysis")
            assert len(phase_logs) == 1

            empty_logs = logger.get_phase("nonexistent")
            assert len(empty_logs) == 0

    def test_agent_logger_jsonl_output(self):
        from chaos_eater.utils.llms import AgentLogger, LLMLog, TokenUsage
        import json

        mock_llm = Mock()
        token_usage = TokenUsage(input_tokens=10, output_tokens=5, total_tokens=15)
        log = LLMLog(agent_name="test", token_usage=token_usage, message_history=["hello"])

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "logs", "test.jsonl")
            logger = AgentLogger(llm=mock_llm, log_path=log_path)
            logger.add_log("improvement", log)

            with open(log_path, "r") as f:
                line = f.readline()
                event = json.loads(line)
                assert event["type"] == "add_log"
                assert event["phase"] == "improvement"
                assert event["log"]["agent_name"] == "test"


class TestAggregatingCallback:
    """Tests for AggregatingCallback class"""

    def test_aggregating_callback_on_llm_end(self):
        from chaos_eater.utils.llms import AggregatingCallback, LoggingCallback, AgentLogger

        mock_llm = Mock()
        mock_llm.__fields__ = {"model_name": Mock()}
        mock_llm.model_name = "gpt-4o"

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "logs", "test.jsonl")
            logger = AgentLogger(llm=mock_llm, log_path=log_path)

            inner = LoggingCallback(agent_name="test", llm=mock_llm, streaming=False)
            callback = AggregatingCallback(inner=inner, aggregator=logger, phase="hypothesis")

            # Simulate on_llm_start
            callback.on_llm_start(serialized={}, prompts=["test prompt"])

            # Simulate on_llm_end with mock response
            mock_generation = Mock()
            mock_generation.text = "test response"
            mock_generation.message = Mock()
            mock_generation.message.response_metadata = {
                "token_usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15
                }
            }

            mock_response = Mock()
            mock_response.generations = [[mock_generation]]

            callback.on_llm_end(mock_response)

            # Check that log was added to aggregator
            phase_logs = logger.get_phase("hypothesis")
            assert len(phase_logs) == 1


class TestPricingPerToken:
    """Tests for PRICING_PER_TOKEN dictionary"""

    def test_pricing_dict_exists(self):
        from chaos_eater.utils.llms import PRICING_PER_TOKEN

        assert isinstance(PRICING_PER_TOKEN, dict)
        assert len(PRICING_PER_TOKEN) > 0

    def test_pricing_openai_gpt4o(self):
        from chaos_eater.utils.llms import PRICING_PER_TOKEN

        assert "openai/gpt-4o-2024-08-06" in PRICING_PER_TOKEN
        pricing = PRICING_PER_TOKEN["openai/gpt-4o-2024-08-06"]
        assert "input" in pricing
        assert "output" in pricing
        assert pricing["input"] > 0
        assert pricing["output"] > 0

    def test_pricing_anthropic_claude(self):
        from chaos_eater.utils.llms import PRICING_PER_TOKEN

        assert "anthropic/claude-3-5-sonnet-20241022" in PRICING_PER_TOKEN
        pricing = PRICING_PER_TOKEN["anthropic/claude-3-5-sonnet-20241022"]
        assert pricing["input"] > 0
        assert pricing["output"] > 0

    def test_pricing_google_gemini(self):
        from chaos_eater.utils.llms import PRICING_PER_TOKEN

        assert "google/gemini-1.5-pro" in PRICING_PER_TOKEN


class TestVerifyApiKey:
    """Tests for verify_api_key function"""

    def test_verify_empty_key(self):
        from chaos_eater.utils.llms import verify_api_key

        assert verify_api_key("openai", "") is False
        assert verify_api_key("openai", None) is False

    @patch("chaos_eater.utils.llms.openai.OpenAI")
    def test_verify_openai_invalid_key(self, mock_openai):
        from chaos_eater.utils.llms import verify_api_key
        import openai

        mock_client = Mock()
        mock_client.models.list.side_effect = openai.AuthenticationError(
            message="Invalid API key",
            response=Mock(),
            body=None
        )
        mock_openai.return_value = mock_client

        assert verify_api_key("openai", "invalid-key") is False

    @patch("chaos_eater.utils.llms.openai.OpenAI")
    def test_verify_openai_valid_key(self, mock_openai):
        from chaos_eater.utils.llms import verify_api_key

        mock_client = Mock()
        mock_client.models.list.return_value = []
        mock_openai.return_value = mock_client

        assert verify_api_key("openai", "valid-key") is True


class TestGetEnvKeyName:
    """Tests for get_env_key_name function"""

    def test_get_openai_key_name(self):
        from chaos_eater.utils.llms import get_env_key_name

        assert get_env_key_name("openai") == "OPENAI_API_KEY"

    def test_get_google_key_name(self):
        from chaos_eater.utils.llms import get_env_key_name

        assert get_env_key_name("google") == "GOOGLE_API_KEY"

    def test_get_anthropic_key_name(self):
        from chaos_eater.utils.llms import get_env_key_name

        assert get_env_key_name("anthropic") == "ANTHROPIC_API_KEY"

    def test_get_unknown_provider(self):
        from chaos_eater.utils.llms import get_env_key_name

        assert get_env_key_name("unknown") == "API_KEY"


class TestCheckExistingKey:
    """Tests for check_existing_key function"""

    @patch("chaos_eater.utils.llms.verify_api_key")
    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"})
    def test_check_existing_valid_key(self, mock_verify):
        from chaos_eater.utils.llms import check_existing_key

        mock_verify.return_value = True
        assert check_existing_key("openai") is True

    @patch("chaos_eater.utils.llms.verify_api_key")
    @patch.dict(os.environ, {"OPENAI_API_KEY": "invalid-key"})
    def test_check_existing_invalid_key(self, mock_verify):
        from chaos_eater.utils.llms import check_existing_key

        mock_verify.return_value = False
        assert check_existing_key("openai") is False

    @patch.dict(os.environ, {}, clear=True)
    def test_check_no_existing_key(self):
        from chaos_eater.utils.llms import check_existing_key

        # Remove the key if it exists
        os.environ.pop("OPENAI_API_KEY", None)
        assert check_existing_key("openai") is False
