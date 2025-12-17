"""Unit tests for chaos_eater/backend/api.py"""
import pytest
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime
import asyncio

from fastapi.testclient import TestClient


class TestAPIModels:
    """Tests for API Pydantic models"""

    def test_job_status_enum(self):
        from chaos_eater.backend.api import JobStatus
        assert JobStatus.PENDING == "pending"
        assert JobStatus.RUNNING == "running"
        assert JobStatus.COMPLETED == "completed"
        assert JobStatus.FAILED == "failed"
        assert JobStatus.CANCELLED == "cancelled"
        assert JobStatus.PAUSED == "paused"

    def test_chaos_eater_job_request_with_project_path(self):
        from chaos_eater.backend.api import ChaosEaterJobRequest
        request = ChaosEaterJobRequest(
            project_path="/path/to/project",
            kube_context="kind-chaos-eater-cluster"
        )
        assert request.project_path == "/path/to/project"
        assert request.input_data is None
        assert request.kube_context == "kind-chaos-eater-cluster"

    def test_chaos_eater_job_request_with_input_data(self):
        from chaos_eater.backend.api import ChaosEaterJobRequest
        request = ChaosEaterJobRequest(
            input_data={"skaffold_yaml": {}, "files": []},
            kube_context="kind-chaos-eater-cluster"
        )
        assert request.project_path is None
        assert request.input_data is not None

    def test_chaos_eater_job_request_validation_error(self):
        from chaos_eater.backend.api import ChaosEaterJobRequest
        from pydantic import ValidationError

        # Both provided - should raise error
        with pytest.raises(ValidationError):
            ChaosEaterJobRequest(
                project_path="/path",
                input_data={"data": "test"},
                kube_context="context"
            )

        # Neither provided - should raise error
        with pytest.raises(ValidationError):
            ChaosEaterJobRequest(kube_context="context")

    def test_job_info_model(self):
        from chaos_eater.backend.api import JobInfo, JobStatus
        job = JobInfo(
            job_id="test-123",
            status=JobStatus.PENDING,
            created_at=datetime.now(),
            updated_at=datetime.now(),
            progress="Test progress"
        )
        assert job.job_id == "test-123"
        assert job.status == JobStatus.PENDING

    def test_job_response_model(self):
        from chaos_eater.backend.api import JobResponse, JobStatus
        response = JobResponse(
            job_id="test-123",
            status=JobStatus.PENDING,
            message="Job created",
            work_dir="/sandbox/test"
        )
        assert response.job_id == "test-123"
        assert response.work_dir == "/sandbox/test"


class TestHelperFunctions:
    """Tests for helper functions"""

    def test_is_binary_bytes_text(self):
        from chaos_eater.backend.api import _is_binary_bytes
        text = b"Hello World\nThis is text content"
        assert _is_binary_bytes(text) is False

    def test_is_binary_bytes_binary(self):
        from chaos_eater.backend.api import _is_binary_bytes
        binary = b"\x00\x01\x02\x03\x04"
        assert _is_binary_bytes(binary) is True

    def test_read_text_or_binary_text(self, tmp_path):
        from chaos_eater.backend.api import _read_text_or_binary
        test_file = tmp_path / "test.txt"
        test_file.write_text("Hello World")
        result = _read_text_or_binary(test_file)
        assert isinstance(result, str)
        assert result == "Hello World"

    def test_read_text_or_binary_binary(self, tmp_path):
        from chaos_eater.backend.api import _read_text_or_binary
        test_file = tmp_path / "test.bin"
        test_file.write_bytes(b"\x00\x01\x02\x03")
        result = _read_text_or_binary(test_file)
        assert isinstance(result, bytes)


class TestJobManager:
    """Tests for JobManager class"""

    @pytest.fixture
    def job_manager(self):
        from chaos_eater.backend.api import JobManager
        return JobManager()

    @pytest.mark.asyncio
    async def test_create_job(self, job_manager, tmp_path):
        from chaos_eater.backend.api import ChaosEaterJobRequest
        request = ChaosEaterJobRequest(
            input_data={"skaffold_yaml": {}, "files": [], "ce_instructions": ""},
            kube_context="test-context"
        )

        with patch.object(job_manager, '_save_job_to_disk'):
            job_id = await job_manager.create_job(request)

        assert job_id is not None
        assert len(job_id) == 36  # UUID format

    @pytest.mark.asyncio
    async def test_get_job(self, job_manager):
        from chaos_eater.backend.api import ChaosEaterJobRequest
        request = ChaosEaterJobRequest(
            input_data={"skaffold_yaml": {}, "files": [], "ce_instructions": ""},
            kube_context="test-context"
        )

        with patch.object(job_manager, '_save_job_to_disk'):
            job_id = await job_manager.create_job(request)

        job = await job_manager.get_job(job_id)
        assert job is not None
        assert job.job_id == job_id

    @pytest.mark.asyncio
    async def test_get_nonexistent_job(self, job_manager):
        job = await job_manager.get_job("nonexistent-id")
        assert job is None

    @pytest.mark.asyncio
    async def test_list_jobs(self, job_manager):
        from chaos_eater.backend.api import ChaosEaterJobRequest
        request = ChaosEaterJobRequest(
            input_data={"skaffold_yaml": {}, "files": [], "ce_instructions": ""},
            kube_context="test-context"
        )

        with patch.object(job_manager, '_save_job_to_disk'):
            await job_manager.create_job(request)
            await job_manager.create_job(request)

        jobs = await job_manager.list_jobs()
        assert len(jobs) == 2

    @pytest.mark.asyncio
    async def test_list_jobs_with_status_filter(self, job_manager):
        from chaos_eater.backend.api import ChaosEaterJobRequest, JobStatus
        request = ChaosEaterJobRequest(
            input_data={"skaffold_yaml": {}, "files": [], "ce_instructions": ""},
            kube_context="test-context"
        )

        with patch.object(job_manager, '_save_job_to_disk'):
            await job_manager.create_job(request)

        # Filter by PENDING status
        jobs = await job_manager.list_jobs(status=JobStatus.PENDING)
        assert len(jobs) == 1

        # Filter by RUNNING status - should be empty
        jobs = await job_manager.list_jobs(status=JobStatus.RUNNING)
        assert len(jobs) == 0


class TestAPIEndpoints:
    """Integration tests for API endpoints using TestClient"""

    @pytest.fixture
    def mock_job_manager(self):
        from chaos_eater.backend.api import JobManager, JobInfo, JobStatus
        manager = JobManager()
        return manager

    @pytest.fixture
    def client(self, mock_job_manager):
        from chaos_eater.backend.api import app, get_job_manager, get_llm, get_ce_tool

        # Override dependencies
        app.dependency_overrides[get_job_manager] = lambda: mock_job_manager
        app.dependency_overrides[get_llm] = lambda: Mock()
        app.dependency_overrides[get_ce_tool] = lambda: Mock()

        client = TestClient(app)
        yield client

        # Clean up
        app.dependency_overrides.clear()

    def test_health_endpoint(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"

    def test_list_jobs_empty(self, client):
        response = client.get("/jobs")
        assert response.status_code == 200
        assert response.json() == []

    def test_get_nonexistent_job(self, client):
        response = client.get("/jobs/nonexistent-job-id")
        assert response.status_code == 404

    @pytest.mark.skip(reason="Requires kubeconfig which is not available in test environment")
    def test_get_clusters(self, client):
        response = client.get("/clusters")
        assert response.status_code == 200
        data = response.json()
        assert "available" in data
        assert "claimed" in data


class TestBuildInputFromProjectPath:
    """Tests for build_input_from_project_path function"""

    def test_project_path_not_found(self, tmp_path):
        from chaos_eater.backend.api import build_input_from_project_path
        with pytest.raises(FileNotFoundError):
            build_input_from_project_path("/nonexistent/path")

    def test_no_skaffold_yaml(self, tmp_path):
        from chaos_eater.backend.api import build_input_from_project_path
        # Create empty directory
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        with pytest.raises(FileNotFoundError):
            build_input_from_project_path(str(project_dir))

    def test_skaffold_no_manifests(self, tmp_path):
        from chaos_eater.backend.api import build_input_from_project_path
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        skaffold = project_dir / "skaffold.yaml"
        skaffold.write_text("apiVersion: skaffold/v2beta29\nkind: Config\n")

        with pytest.raises(ValueError, match="no manifests.rawYaml"):
            build_input_from_project_path(str(project_dir))

    def test_valid_project_path(self, tmp_path):
        from chaos_eater.backend.api import build_input_from_project_path
        import yaml

        # Create project structure
        project_dir = tmp_path / "project"
        k8s_dir = project_dir / "k8s"
        project_dir.mkdir()
        k8s_dir.mkdir()

        # Create manifest
        manifest_file = k8s_dir / "deployment.yaml"
        manifest_file.write_text("apiVersion: apps/v1\nkind: Deployment\n")

        # Create skaffold.yaml
        skaffold_content = {
            "apiVersion": "skaffold/v2beta29",
            "kind": "Config",
            "manifests": {
                "rawYaml": ["k8s/deployment.yaml"]
            }
        }
        skaffold = project_dir / "skaffold.yaml"
        skaffold.write_text(yaml.dump(skaffold_content))

        result = build_input_from_project_path(str(project_dir))

        assert "skaffold_yaml" in result
        assert "files" in result
        assert len(result["files"]) == 1


class TestSafeRmtree:
    """Tests for _safe_rmtree function"""

    def test_delete_outside_allowed_base(self, tmp_path):
        from chaos_eater.backend.api import _safe_rmtree
        result = _safe_rmtree("/some/random/path")
        assert result["deleted"] is False
        assert "denied" in result.get("reason", "")

    def test_delete_nonexistent_path(self, tmp_path):
        from chaos_eater.backend.api import _safe_rmtree
        result = _safe_rmtree("/tmp/nonexistent-dir-12345")
        assert result["deleted"] is False
        assert "not found" in result.get("reason", "")
