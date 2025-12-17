"""Unit tests for chaos_eater/utils/llms.py"""
import os
import tempfile
import shutil
from unittest.mock import Mock, patch, MagicMock
import pytest

from chaos_eater.utils.llms import (
    load_llm,
    verify_model_name,
    verify_api_key,
    get_env_key_name,
    check_existing_key,
    TokenUsage,
    LLMLog,
    LogBundle,
    AgentLogger,
    LoggingCallback,
    AggregatingCallback,
    PRICING_PER_TOKEN,
)


class TestLoadLLM:
    """Tests for load_llm function"""

    @patch('chaos_eater.utils.llms.ChatOpenAI')
    def test_load_openai_model(self, mock_openai):
        mock_openai.return_value = Mock()
        llm = load_llm("openai/gpt-4o", temperature=0.5, seed=123)
        mock_openai.assert_called_once()
        call_kwargs = mock_openai.call_args.kwargs
        assert call_kwargs['model'] == 'gpt-4o'
        assert call_kwargs['temperature'] == 0.5
        assert call_kwargs['seed'] == 123

    @patch('chaos_eater.utils.llms.ChatGoogleGenerativeAI')
    def test_load_google_model(self, mock_google):
        mock_google.return_value = Mock()
        llm = load_llm("google/gemini-1.5-pro", temperature=0.3)
        mock_google.assert_called_once()
        call_kwargs = mock_google.call_args.kwargs
        assert call_kwargs['model'] == 'gemini-1.5-pro'
        assert call_kwargs['temperature'] == 0.3

    @patch('chaos_eater.utils.llms.ChatAnthropic')
    def test_load_anthropic_model(self, mock_anthropic):
        mock_anthropic.return_value = Mock()
        llm = load_llm("anthropic/claude-3-5-sonnet-20241022", temperature=0.7)
        mock_anthropic.assert_called_once()
        call_kwargs = mock_anthropic.call_args.kwargs
        assert call_kwargs['model'] == 'claude-3-5-sonnet-20241022'
        assert call_kwargs['temperature'] == 0.7

    @patch('chaos_eater.utils.llms.verify_model_name')
    @patch('chaos_eater.utils.llms.ChatOllama')
    def test_load_ollama_model(self, mock_ollama, mock_verify):
        mock_verify.return_value = True
        mock_ollama.return_value = Mock()
        llm = load_llm("ollama/llama3", temperature=0.0)
        mock_ollama.assert_called_once()
        call_kwargs = mock_ollama.call_args.kwargs
        assert call_kwargs['model'] == 'llama3'

    @patch('chaos_eater.utils.llms.verify_model_name')
    def test_load_ollama_model_not_found(self, mock_verify):
        mock_verify.return_value = False
        from chaos_eater.utils.exceptions import ModelNotFoundError
        with pytest.raises(ModelNotFoundError):
            load_llm("ollama/nonexistent-model")

    @patch('chaos_eater.utils.llms.ChatOpenAI')
    def test_load_vllm_model(self, mock_openai):
        """Test loading a custom VLLM model (no prefix)"""
        mock_openai.return_value = Mock()
        llm = load_llm("custom-model", port=8001)
        mock_openai.assert_called_once()
        call_kwargs = mock_openai.call_args.kwargs
        assert call_kwargs['model'] == 'custom-model'
        assert 'localhost:8001' in call_kwargs['openai_api_base']


class TestVerifyModelName:
    """Tests for verify_model_name function"""

    @patch('chaos_eater.utils.llms.requests.get')
    def test_model_exists(self, mock_get):
        mock_response = Mock()
        mock_response.json.return_value = {
            "models": [{"name": "llama3"}, {"name": "mistral"}]
        }
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response

        result = verify_model_name("llama3")
        assert result is True

    @patch('chaos_eater.utils.llms.requests.get')
    def test_model_not_exists(self, mock_get):
        mock_response = Mock()
        mock_response.json.return_value = {
            "models": [{"name": "llama3"}]
        }
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response

        result = verify_model_name("nonexistent")
        assert result is False

    @patch('chaos_eater.utils.llms.requests.get')
    def test_with_custom_base_url(self, mock_get):
        mock_response = Mock()
        mock_response.json.return_value = {"models": [{"name": "test"}]}
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response

        verify_model_name("test", base_url="http://custom:11434")
        mock_get.assert_called_with("http://custom:11434/api/tags")


class TestVerifyApiKey:
    """Tests for verify_api_key function"""

    def test_empty_api_key(self):
        assert verify_api_key("openai", "") is False
        assert verify_api_key("openai", None) is False

    @patch('chaos_eater.utils.llms.openai.OpenAI')
    def test_openai_valid_key(self, mock_openai_class):
        mock_client = Mock()
        mock_client.models.list.return_value = []
        mock_openai_class.return_value = mock_client

        result = verify_api_key("openai", "sk-valid-key")
        assert result is True

    @patch('chaos_eater.utils.llms.openai.OpenAI')
    def test_openai_invalid_key(self, mock_openai_class):
        import openai
        mock_client = Mock()
        mock_client.models.list.side_effect = openai.AuthenticationError(
            message="Invalid API key",
            response=Mock(status_code=401),
            body=None
        )
        mock_openai_class.return_value = mock_client

        result = verify_api_key("openai", "sk-invalid-key")
        assert result is False

    @patch('chaos_eater.utils.llms.requests.get')
    def test_anthropic_valid_key(self, mock_get):
        mock_response = Mock()
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        result = verify_api_key("anthropic", "sk-ant-valid")
        assert result is True

    @patch('chaos_eater.utils.llms.requests.get')
    def test_anthropic_invalid_key(self, mock_get):
        mock_response = Mock()
        mock_response.status_code = 401
        mock_get.return_value = mock_response

        result = verify_api_key("anthropic", "sk-ant-invalid")
        assert result is False

    @patch('chaos_eater.utils.llms.requests.get')
    def test_google_valid_key(self, mock_get):
        mock_response = Mock()
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        result = verify_api_key("google", "valid-google-key")
        assert result is True

    @patch('chaos_eater.utils.llms.requests.get')
    def test_google_invalid_key(self, mock_get):
        mock_response = Mock()
        mock_response.status_code = 400
        mock_get.return_value = mock_response

        result = verify_api_key("google", "invalid-key")
        assert result is False


class TestGetEnvKeyName:
    """Tests for get_env_key_name function"""

    def test_openai(self):
        assert get_env_key_name("openai") == "OPENAI_API_KEY"

    def test_google(self):
        assert get_env_key_name("google") == "GOOGLE_API_KEY"

    def test_anthropic(self):
        assert get_env_key_name("anthropic") == "ANTHROPIC_API_KEY"

    def test_unknown_provider(self):
        assert get_env_key_name("unknown") == "API_KEY"


class TestCheckExistingKey:
    """Tests for check_existing_key function"""

    @patch('chaos_eater.utils.llms.verify_api_key')
    @patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test-key"})
    def test_existing_valid_key(self, mock_verify):
        mock_verify.return_value = True
        result = check_existing_key("openai")
        assert result is True
        mock_verify.assert_called_with("openai", "sk-test-key")

    @patch('chaos_eater.utils.llms.verify_api_key')
    @patch.dict(os.environ, {"OPENAI_API_KEY": "sk-invalid"})
    def test_existing_invalid_key(self, mock_verify):
        mock_verify.return_value = False
        result = check_existing_key("openai")
        assert result is False

    @patch.dict(os.environ, {}, clear=True)
    def test_no_existing_key(self):
        # Clear the environment variable if it exists
        os.environ.pop("OPENAI_API_KEY", None)
        result = check_existing_key("openai")
        assert result is False


class TestTokenUsage:
    """Tests for TokenUsage model"""

    def test_create_token_usage(self):
        usage = TokenUsage(input_tokens=100, output_tokens=50, total_tokens=150)
        assert usage.input_tokens == 100
        assert usage.output_tokens == 50
        assert usage.total_tokens == 150

    def test_default_values(self):
        usage = TokenUsage(input_tokens=0, output_tokens=0, total_tokens=0)
        assert usage.input_tokens == 0


class TestLLMLog:
    """Tests for LLMLog model"""

    def test_create_llm_log(self):
        usage = TokenUsage(input_tokens=100, output_tokens=50, total_tokens=150)
        log = LLMLog(
            agent_name="test_agent",
            token_usage=usage,
            message_history=[["user message"], "assistant response"]
        )
        assert log.agent_name == "test_agent"
        assert log.token_usage.total_tokens == 150
        assert len(log.message_history) == 2


class TestLogBundle:
    """Tests for LogBundle model"""

    def test_create_empty_bundle(self):
        bundle = LogBundle()
        assert bundle.logs == {}
        assert bundle.updated_at == 0.0

    def test_create_bundle_with_logs(self):
        usage = TokenUsage(input_tokens=10, output_tokens=5, total_tokens=15)
        log = LLMLog(agent_name="test", token_usage=usage, message_history=[])
        bundle = LogBundle(logs={"phase1": [log]}, updated_at=1234567890.0)
        assert "phase1" in bundle.logs
        assert len(bundle.logs["phase1"]) == 1


class TestAgentLogger:
    """Tests for AgentLogger class"""

    @pytest.fixture
    def temp_dir(self):
        dirpath = tempfile.mkdtemp()
        yield dirpath
        shutil.rmtree(dirpath)

    @pytest.fixture
    def mock_llm(self):
        llm = Mock()
        llm.__fields__ = {"model_name": Mock()}
        llm.model_name = "gpt-4o"
        return llm

    def test_init_creates_log_dir(self, temp_dir, mock_llm):
        log_path = os.path.join(temp_dir, "subdir", "agent_log.jsonl")
        logger = AgentLogger(llm=mock_llm, log_path=log_path)
        assert os.path.exists(os.path.dirname(log_path))

    def test_add_log(self, temp_dir, mock_llm):
        log_path = os.path.join(temp_dir, "agent_log.jsonl")
        logger = AgentLogger(llm=mock_llm, log_path=log_path)

        usage = TokenUsage(input_tokens=10, output_tokens=5, total_tokens=15)
        log = LLMLog(agent_name="test", token_usage=usage, message_history=[])

        logger.add_log("phase1", log)

        assert "phase1" in logger.bundle.logs
        assert len(logger.bundle.logs["phase1"]) == 1

    def test_add_logs(self, temp_dir, mock_llm):
        log_path = os.path.join(temp_dir, "agent_log.jsonl")
        logger = AgentLogger(llm=mock_llm, log_path=log_path)

        usage = TokenUsage(input_tokens=10, output_tokens=5, total_tokens=15)
        logs = [
            LLMLog(agent_name="test1", token_usage=usage, message_history=[]),
            LLMLog(agent_name="test2", token_usage=usage, message_history=[]),
        ]

        logger.add_logs("phase1", logs)

        assert len(logger.bundle.logs["phase1"]) == 2

    def test_get_phase(self, temp_dir, mock_llm):
        log_path = os.path.join(temp_dir, "agent_log.jsonl")
        logger = AgentLogger(llm=mock_llm, log_path=log_path)

        usage = TokenUsage(input_tokens=10, output_tokens=5, total_tokens=15)
        log = LLMLog(agent_name="test", token_usage=usage, message_history=[])
        logger.add_log("phase1", log)

        phase_logs = logger.get_phase("phase1")
        assert len(phase_logs) == 1

        empty_logs = logger.get_phase("nonexistent")
        assert len(empty_logs) == 0

    def test_get_bundle(self, temp_dir, mock_llm):
        log_path = os.path.join(temp_dir, "agent_log.jsonl")
        logger = AgentLogger(llm=mock_llm, log_path=log_path)

        bundle = logger.get_bundle()
        assert isinstance(bundle, LogBundle)


class TestLoggingCallback:
    """Tests for LoggingCallback class"""

    def test_init_with_openai_model(self):
        llm = Mock()
        llm.__fields__ = {"model_name": Mock()}
        llm.model_name = "gpt-4o"

        callback = LoggingCallback(agent_name="test", llm=llm, streaming=False)
        assert callback.model_provider == "openai"
        assert callback.agent_name == "test"

    def test_init_with_google_model(self):
        llm = Mock()
        llm.__fields__ = {"model": Mock()}
        llm.model = "gemini-1.5-pro"

        callback = LoggingCallback(agent_name="test", llm=llm, streaming=False)
        assert callback.model_provider == "google"

    def test_init_with_anthropic_model(self):
        llm = Mock()
        llm.__fields__ = {"model": Mock()}
        llm.model = "claude-3-5-sonnet"

        callback = LoggingCallback(agent_name="test", llm=llm, streaming=False)
        assert callback.model_provider == "anthropic"

    def test_on_llm_start(self):
        llm = Mock()
        llm.__fields__ = {"model_name": Mock()}
        llm.model_name = "gpt-4o"

        callback = LoggingCallback(agent_name="test", llm=llm, streaming=False)
        callback.on_llm_start(serialized={}, prompts=["Hello"])

        assert len(callback.message_history) == 1
        assert callback.message_history[0] == ["Hello"]


class TestPricingPerToken:
    """Tests for PRICING_PER_TOKEN constant"""

    def test_openai_models_exist(self):
        assert "openai/gpt-4o-2024-08-06" in PRICING_PER_TOKEN
        assert "openai/gpt-4o-mini-2024-07-18" in PRICING_PER_TOKEN

    def test_google_models_exist(self):
        assert "google/gemini-1.5-pro-latest" in PRICING_PER_TOKEN

    def test_anthropic_models_exist(self):
        assert "anthropic/claude-3-5-sonnet-20241022" in PRICING_PER_TOKEN

    def test_pricing_structure(self):
        for model, pricing in PRICING_PER_TOKEN.items():
            assert "input" in pricing
            assert "output" in pricing
            assert pricing["input"] > 0
            assert pricing["output"] > 0
