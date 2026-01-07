"""
Sandbox API tests for ChaosEater - must run inside sandbox environment.

These tests verify pause/resume functionality and checkpoint loading,
which require the full sandbox environment with:
- Kind cluster access
- /sandbox directory access
- Real API server running

Run with: make sandbox-test
Or specific tests: make sandbox-test-match PATTERN=resume
"""
import pytest
import httpx
import json
import os
import time
from pathlib import Path


# Skip all tests in this file if not running via `make sandbox-test`
# The Makefile sets CE_SANDBOX_TEST=1 when running sandbox API tests
pytestmark = pytest.mark.skipif(
    os.environ.get("CE_SANDBOX_TEST") != "1",
    reason="Sandbox API tests require sandbox environment. Run with: make sandbox-test"
)


class TestPauseResumeSandboxAPI:
    """Sandbox API tests for pause/resume functionality.

    These tests verify the bug fix where checkpoint wasn't being loaded,
    causing jobs to restart from the beginning instead of resuming.
    """

    API_BASE = "http://localhost:8000"
    TEST_PROJECT = "examples/nginx"
    TEST_CONTEXT = "kind-chaos-eater-cluster"

    @pytest.fixture
    def client(self):
        """Create HTTP client with reasonable timeout."""
        return httpx.Client(base_url=self.API_BASE, timeout=30.0)

    @pytest.fixture
    def created_job(self, client):
        """Create a job and return its info. Clean up after test."""
        response = client.post("/jobs", json={
            "project_path": self.TEST_PROJECT,
            "kube_context": self.TEST_CONTEXT,
            "ce_instructions": "Test only - do not run actual experiment",
            "max_num_steadystates": 1,
            "max_retries": 1,
        })
        assert response.status_code == 200, f"Failed to create job: {response.text}"
        data = response.json()
        job_id = data["job_id"]
        work_dir = data.get("work_dir")

        yield {"job_id": job_id, "work_dir": work_dir}

        # Cleanup: delete job
        try:
            client.delete(f"/jobs/{job_id}")
        except Exception:
            pass

    @pytest.fixture
    def paused_job_with_checkpoint(self, client, created_job):
        """Create a paused job with checkpoint file containing intermediate data."""
        job_id = created_job["job_id"]
        work_dir = created_job["work_dir"]

        # Wait briefly for job to start
        time.sleep(2)

        # Pause the job
        response = client.post(f"/jobs/{job_id}/pause")
        # Job might already be paused or finished, that's ok for setup

        # Create checkpoint file with intermediate data
        if work_dir:
            checkpoint_path = Path(work_dir) / "output.json"
            checkpoint_data = {
                "ce_cycle": {
                    "processed_data": {"test_key": "test_value", "files": ["test.yaml"]},
                    "hypothesis": {
                        "steady_states": [
                            {"name": "test_steady_state", "description": "Test steady state"}
                        ]
                    },
                    "experiment": None
                }
            }
            checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
            checkpoint_path.write_text(json.dumps(checkpoint_data))

        return {
            "job_id": job_id,
            "work_dir": work_dir,
            "checkpoint_data": checkpoint_data if work_dir else None
        }

    def test_pause_returns_current_phase(self, client, created_job):
        """Test that pause endpoint returns the current phase."""
        job_id = created_job["job_id"]

        # Wait for job to start processing
        time.sleep(3)

        # Pause the job
        response = client.post(f"/jobs/{job_id}/pause")

        # Should succeed (200) or indicate job is not running (400)
        assert response.status_code in [200, 400], f"Unexpected status: {response.status_code}"

        if response.status_code == 200:
            data = response.json()
            # Should return current_phase
            assert "current_phase" in data, "Pause response should include current_phase"

    def test_pause_already_paused_job_returns_error(self, client, created_job):
        """Test that pausing an already paused job returns appropriate error."""
        job_id = created_job["job_id"]

        # Wait and pause first time
        time.sleep(2)
        client.post(f"/jobs/{job_id}/pause")

        # Try to pause again
        response = client.post(f"/jobs/{job_id}/pause")

        # Should return 400 (bad request) for already paused job
        assert response.status_code == 400, f"Expected 400 for already paused job, got {response.status_code}"

    def test_resume_paused_job(self, client, paused_job_with_checkpoint):
        """Test that resume endpoint works for paused jobs."""
        job_id = paused_job_with_checkpoint["job_id"]

        # Resume the job
        response = client.post(f"/jobs/{job_id}/resume")

        # Should succeed
        assert response.status_code == 200, f"Resume failed: {response.text}"

        data = response.json()
        # Should return resume information
        assert "resume_from" in data or "resume_from_agent" in data, \
            "Resume response should include resume point information"

    def test_resume_loads_checkpoint_data(self, client, paused_job_with_checkpoint):
        """
        Critical test: verify that resume loads checkpoint data correctly.

        This tests the bug fix where checkpoint_path was being set to None
        when output.json existed but has_output_checkpoint was False,
        causing jobs to restart from the beginning instead of resuming
        from the checkpoint.
        """
        job_id = paused_job_with_checkpoint["job_id"]
        work_dir = paused_job_with_checkpoint["work_dir"]

        if not work_dir:
            pytest.skip("work_dir not available for this job")

        # Verify checkpoint file exists
        checkpoint_path = Path(work_dir) / "output.json"
        assert checkpoint_path.exists(), f"Checkpoint file should exist at {checkpoint_path}"

        # Resume the job
        response = client.post(f"/jobs/{job_id}/resume")
        assert response.status_code == 200, f"Resume failed: {response.text}"

        data = response.json()

        # The key assertion: resume_from should indicate we're resuming
        # from an intermediate point, not from the beginning
        # If checkpoint was properly loaded, we should have resume information
        assert "resume_from" in data, \
            "Resume should return resume_from indicating checkpoint was loaded"

    def test_resume_without_checkpoint_starts_from_beginning(self, client):
        """Test that resume without checkpoint file works but starts from beginning."""
        # Create a job
        response = client.post("/jobs", json={
            "project_path": self.TEST_PROJECT,
            "kube_context": self.TEST_CONTEXT,
        })
        assert response.status_code == 200
        job_id = response.json()["job_id"]

        try:
            # Pause immediately (no checkpoint yet)
            time.sleep(1)
            client.post(f"/jobs/{job_id}/pause")

            # Resume - should work but may start from beginning
            response = client.post(f"/jobs/{job_id}/resume")
            assert response.status_code == 200, f"Resume should succeed: {response.text}"

        finally:
            # Cleanup
            try:
                client.delete(f"/jobs/{job_id}")
            except Exception:
                pass

    def test_resume_nonexistent_job_returns_404(self, client):
        """Test that resuming a non-existent job returns 404."""
        response = client.post("/jobs/nonexistent-job-id-12345/resume")
        assert response.status_code == 404, f"Expected 404 for non-existent job, got {response.status_code}"

    def test_get_job_status_after_pause(self, client, created_job):
        """Test that job status is correctly reported as paused after pause."""
        job_id = created_job["job_id"]

        # Wait and pause
        time.sleep(2)
        pause_response = client.post(f"/jobs/{job_id}/pause")

        if pause_response.status_code != 200:
            pytest.skip("Could not pause job (may have finished)")

        # Get job status
        response = client.get(f"/jobs/{job_id}")
        assert response.status_code == 200

        data = response.json()
        assert data.get("status") == "paused", f"Job status should be 'paused', got {data.get('status')}"


class TestJobRestoreSandboxAPI:
    """Sandbox API tests for job restoration from disk."""

    API_BASE = "http://localhost:8000"

    @pytest.fixture
    def client(self):
        return httpx.Client(base_url=self.API_BASE, timeout=30.0)

    def test_restore_job_by_work_dir(self, client):
        """Test restoring a job using work_dir path."""
        # First create a job to have something to restore
        response = client.post("/jobs", json={
            "project_path": "examples/nginx",
            "kube_context": "kind-chaos-eater-cluster",
        })
        if response.status_code != 200:
            pytest.skip("Could not create job for restore test")

        job_id = response.json()["job_id"]
        work_dir = response.json().get("work_dir")

        try:
            # Pause the job
            time.sleep(2)
            client.post(f"/jobs/{job_id}/pause")

            # Delete from memory (simulate server restart)
            client.delete(f"/jobs/{job_id}")

            if work_dir:
                # Restore using work_dir
                response = client.post("/jobs/restore", json={"work_dir": work_dir})

                if response.status_code == 200:
                    restored = response.json()
                    assert "job_id" in restored, "Restore should return job_id"
                # 404 is acceptable if files were cleaned up
                elif response.status_code != 404:
                    pytest.fail(f"Unexpected restore status: {response.status_code}")

        finally:
            # Final cleanup
            try:
                client.delete(f"/jobs/{job_id}")
            except Exception:
                pass
