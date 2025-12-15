import os
import time
import uuid
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from enum import Enum
from contextlib import asynccontextmanager
import logging
from pathlib import Path

import uvicorn
import yaml
from fastapi import FastAPI, HTTPException, Depends, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator

from ..chaos_eater import ChaosEater, ChaosEaterInput, ChaosEaterOutput
from ..ce_tools.ce_tool import CEToolType, CETool
from ..utils.llms import load_llm
from ..utils.functions import make_artifact, get_timestamp


# ---------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chaos_eater_api")


# ---------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------
class JobStatus(str, Enum):
    PENDING   = "pending"
    RUNNING   = "running"
    PAUSED    = "paused"
    COMPLETED = "completed"
    FAILED    = "failed"
    CANCELLED = "cancelled"


class ChaosEaterJobRequest(BaseModel):
    """
    Either provide:
      - project_path: server-local path to a folder containing skaffold.yaml
    OR
      - input_data: a JSON shape compatible with ChaosEaterInput(**input_data)

    Exactly one of {project_path, input_data} must be provided.
    """
    # model setting
    model_name: str = Field(default="openai/gpt-4o-2024-08-06")
    temperature: float = Field(default=0.0, ge=0.0, le=1.0)
    seed: int = Field(default=42)

    # One-of:
    project_path: Optional[str] = Field(None, description="Local folder containing skaffold.yaml")
    input_data: Optional[Dict[str, Any]] = Field(None, description="ChaosEaterInput data")

    # Optional extra for project_path flows:
    ce_instructions: Optional[str] = Field(None, description="Instructions to inject into the built input")

    # Common CE params:
    kube_context: str = Field(..., description="Kubernetes context")
    project_name: str = Field(default="chaos-eater", description="Project name")
    work_dir: Optional[str] = Field(None, description="Working directory")
    clean_cluster_before_run: bool = Field(default=True)
    clean_cluster_after_run: bool = Field(default=True)
    is_new_deployment: bool = Field(default=True)
    max_num_steadystates: int = Field(default=2, ge=1, le=10)
    max_retries: int = Field(default=3, ge=0, le=10)
    namespace: str = Field(default="chaos-eater", description="K8s namespace")

    @model_validator(mode="after")
    def _require_exactly_one(self):
        if bool(self.project_path) == bool(self.input_data):
            raise ValueError("Provide exactly one of {project_path, input_data}.")
        return self


class JobInfo(BaseModel):
    job_id: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    progress: Optional[str] = None
    error: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    work_dir: Optional[str] = None
    current_phase: Optional[str] = None   # Track which phase the job is in for resume
    current_agent: Optional[str] = None   # Track which agent within the phase for resume


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    message: str
    work_dir: Optional[str] = None


# ---------------------------------------------------------------------
# Helpers for project_path loading
# ---------------------------------------------------------------------
def _is_binary_bytes(b: bytes) -> bool:
    # Simple heuristic; replace with your project's util if you have one
    textchars = bytearray({7, 8, 9, 10, 12, 13, 27} | set(range(0x20, 0x100)) - {0x7F})
    return bool(b.translate(None, textchars))


def _read_text_or_binary(fp: Path) -> str | bytes:
    data = fp.read_bytes()
    if _is_binary_bytes(data):
        return data  # return bytes
    return data.decode("utf-8", errors="replace")


def _enforce_allowed_base(root: Path):
    """
    Optional safety: limit accessible project paths to an allowed base.
    Set ALLOWED_PROJECT_BASE=/abs/path to enable.
    """
    base = os.getenv("ALLOWED_PROJECT_BASE", "").strip()
    if not base:
        return
    base_path = Path(base).resolve()
    root_resolved = root.resolve()
    try:
        root_resolved.relative_to(base_path)
    except ValueError:
        raise PermissionError(f"project_path is outside allowed base: {base_path}")


def build_input_from_project_path(project_path: str, override_instructions: Optional[str] = None) -> Dict[str, Any]:
    """
    Build a dict compatible with ChaosEaterInput(**...) by reading:
      - skaffold.yaml
      - manifests.rawYaml entries
    under the given project folder.
    """
    root = Path(project_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"Project path not found or not a directory: {root}")

    _enforce_allowed_base(root)

    # 1) locate skaffold.yaml (prefer root/skaffold.yaml; fallback to first match)
    skaffold_file = root / "skaffold.yaml"
    if not skaffold_file.exists():
        matches = list(root.rglob("skaffold.yaml"))
        if not matches:
            raise FileNotFoundError(f"skaffold.yaml not found under: {root}")
        skaffold_file = matches[0]

    skaffold_content = _read_text_or_binary(skaffold_file)
    if isinstance(skaffold_content, bytes):
        raise ValueError("skaffold.yaml appears to be binary; expected text.")

    try:
        sk = yaml.safe_load(skaffold_content) or {}
    except Exception as e:
        raise ValueError(f"Failed to parse skaffold.yaml: {e}")

    # 2) collect k8s YAMLs from manifests.rawYaml
    work_dir = skaffold_file.parent.parent
    manifests = (sk.get("manifests") or {})
    raw_list = manifests.get("rawYaml") or []
    if not isinstance(raw_list, list) or not raw_list:
        raise ValueError("skaffold.yaml has no manifests.rawYaml list.")

    files: List[Dict[str, Any]] = []
    for rel in raw_list:
        rel_path = Path(rel)
        abs_path = (skaffold_file.parent / rel_path).resolve()
        if not abs_path.exists() or not abs_path.is_file():
            raise FileNotFoundError(f"Referenced manifest not found: {rel} (resolved to {abs_path})")
        content = _read_text_or_binary(abs_path)
        files.append({
            "path": str(abs_path),
            "content": content,                 # Union[str, bytes] supported by your File schema
            "work_dir": str(work_dir),
            "fname": str(abs_path.relative_to(work_dir))
        })

    ce_input = {
        "skaffold_yaml": {
            "path": str(skaffold_file),
            "content": skaffold_content,
            "work_dir": str(work_dir),
            "fname": str(skaffold_file.relative_to(work_dir))
        },
        "files": files,
        "ce_instructions": override_instructions or ""
    }
    return ce_input

ALLOWED_DELETE_BASES = [
    Path("sandbox").resolve(),
    Path("/tmp").resolve(),
    Path(os.getenv("CE_TEMP_BASE", "/tmp/chaos-eater")).resolve(),
]

def _safe_rmtree(target: str | Path) -> dict:
    """
    Safely delete a work_dir.
    - Only allowed if under one of the ALLOWED_DELETE_BASES
    - No-op if the path does not exist
    """
    p = Path(target).resolve()
    logger.info(f"[PURGE] try delete: {p}")
    # Check if it's under one of the allowed base directories
    if not any(str(p).startswith(str(base) + os.sep) or p == base for base in ALLOWED_DELETE_BASES):
        return {"deleted": False, "reason": f"denied: {p} is outside allowed bases"}

    # Return if path not found
    if not p.exists():
        return {"deleted": False, "reason": "path not found", "path": str(p)}

    # Return if not a directory
    if not p.is_dir():
        return {"deleted": False, "reason": "not a directory", "path": str(p)}

    try:
        shutil.rmtree(p)
        logger.info(f"[PURGE OK] {p}")
        return {"deleted": True, "path": str(p)}
    except Exception as e:
        logger.exception(f"[PURGE FAIL] {p}: {e}")
        return {"deleted": False, "reason": str(e), "path": str(p)}

# ---------------------------------------------------------------------
# Job Manager
# ---------------------------------------------------------------------
class JobManager:
    """In-memory job registry. For production, consider a persistent store."""
    def __init__(self):
        self.jobs: Dict[str, JobInfo] = {}
        self.tasks: Dict[str, asyncio.Task] = {}
        self.chaos_eaters: Dict[str, ChaosEater] = {}
        self.events: Dict[str, List[dict]] = {}
        self.callbacks: Dict[str, CancellableAPICallback] = {}  # Keep reference to callbacks
        self.requests: Dict[str, ChaosEaterJobRequest] = {}  # Store requests for resume
        self.lock = asyncio.Lock()

    async def create_job(self, request: ChaosEaterJobRequest) -> str:
        job_id = str(uuid.uuid4())
        work_dir = f"sandbox/cycle_{get_timestamp()}"
        async with self.lock:
            self.jobs[job_id] = JobInfo(
                job_id=job_id,
                status=JobStatus.PENDING,
                created_at=datetime.now(),
                updated_at=datetime.now(),
                progress="Job created",
                work_dir=work_dir
            )
            self.requests[job_id] = request  # Store for resume
        # Persist job info to disk for recovery after restart
        self._save_job_to_disk(job_id, work_dir, request)
        return job_id

    def _save_job_to_disk(self, job_id: str, work_dir: str, request: ChaosEaterJobRequest):
        """Save job info to work_dir for persistence across server restarts"""
        import json
        os.makedirs(work_dir, exist_ok=True)
        job_info_path = f"{work_dir}/job_info.json"
        job_data = {
            "job_id": job_id,
            "request": request.model_dump(),
            "created_at": datetime.now().isoformat()
        }
        with open(job_info_path, 'w') as f:
            json.dump(job_data, f, indent=2)
        logger.info(f"Saved job info to {job_info_path}")

    async def restore_job_from_disk(self, work_dir: str) -> str:
        """Restore job from work_dir after server restart"""
        import json
        job_info_path = f"{work_dir}/job_info.json"
        if not os.path.exists(job_info_path):
            raise FileNotFoundError(f"Job info not found at {job_info_path}")

        with open(job_info_path, 'r') as f:
            job_data = json.load(f)

        job_id = job_data["job_id"]
        request_data = job_data["request"]
        created_at = datetime.fromisoformat(job_data["created_at"])

        # Check if already restored
        if job_id in self.jobs:
            logger.info(f"Job {job_id} already in memory")
            return job_id

        # Restore request
        request = ChaosEaterJobRequest(**request_data)

        # Determine status, current_phase, and current_agent from checkpoints
        output_checkpoint_path = f"{work_dir}/outputs/output.json"
        agent_checkpoint_path = f"{work_dir}/checkpoints/agent_checkpoint.json"
        current_phase = None
        current_agent = None

        # First check agent-level checkpoint (more granular)
        if os.path.exists(agent_checkpoint_path):
            try:
                with open(agent_checkpoint_path, 'r') as f:
                    agent_cp = json.load(f)
                # New checkpoint structure: global.current_phase and phases.<phase>.next_agent
                global_state = agent_cp.get("global", {})
                current_phase = global_state.get("current_phase")
                # Get next_agent from the current phase's data
                phase_data = agent_cp.get("phases", {}).get(current_phase, {})
                current_agent = phase_data.get("next_agent")  # Next agent to run

                # If next_agent is None and completed_agents exist, phase is complete
                # Move to the next phase in the workflow
                if current_agent is None and phase_data.get("completed_agents"):
                    # Phase order for determining next phase
                    phase_order = ["preprocess", "hypothesis", "experiment_plan", "experiment", "analysis", "improvement", "postprocess"]
                    try:
                        phase_idx = phase_order.index(current_phase)
                        if phase_idx + 1 < len(phase_order):
                            current_phase = phase_order[phase_idx + 1]
                            current_agent = None  # Start from beginning of next phase
                            logger.info(f"Job {job_id}: phase {phase_order[phase_idx]} complete, advancing to {current_phase}")
                    except ValueError:
                        pass  # Unknown phase, keep current

                status = JobStatus.PAUSED
                if current_agent:
                    progress = f"Restored from disk (resume from {current_phase}/{current_agent})"
                else:
                    progress = f"Restored from disk (resume from {current_phase})"
                logger.info(f"Job {job_id}: agent checkpoint found, resume from {current_phase}/{current_agent}")
            except Exception as e:
                logger.warning(f"Failed to parse agent checkpoint: {e}")

        # Fall back to output.json if no agent checkpoint or parsing failed
        if current_phase is None and os.path.exists(output_checkpoint_path):
            status = JobStatus.PAUSED
            try:
                with open(output_checkpoint_path, 'r') as f:
                    checkpoint = json.load(f)
                run_time = checkpoint.get("run_time", {})
                # Determine the next phase to run based on what's completed
                # Phase order: preprocess -> hypothesis -> experiment_plan -> experiment -> analysis -> improvement
                if "improvement" in run_time and run_time["improvement"]:
                    current_phase = "experiment"  # Loop back to experiment
                elif "analysis" in run_time and run_time["analysis"]:
                    current_phase = "improvement"
                elif "experiment_execution" in run_time and run_time["experiment_execution"]:
                    current_phase = "analysis"
                elif "experiment_plan" in run_time:
                    current_phase = "experiment"
                elif "hypothesis" in run_time:
                    current_phase = "experiment_plan"
                elif "preprocess" in run_time:
                    current_phase = "hypothesis"
                else:
                    current_phase = "preprocess"
                progress = f"Restored from disk (resume from {current_phase})"
                logger.info(f"Job {job_id}: output checkpoint found, resume from {current_phase}")
            except Exception as e:
                logger.warning(f"Failed to parse checkpoint: {e}")
                current_phase = "preprocess"
                progress = "Restored from disk (checkpoint parse error, restart)"
        elif current_phase is None:
            status = JobStatus.PAUSED
            current_phase = "preprocess"
            progress = "Restored from disk (no checkpoint, restart)"

        async with self.lock:
            self.jobs[job_id] = JobInfo(
                job_id=job_id,
                status=status,
                created_at=created_at,
                updated_at=datetime.now(),
                progress=progress,
                work_dir=work_dir,
                current_phase=current_phase,
                current_agent=current_agent
            )
            self.requests[job_id] = request

        logger.info(f"Restored job {job_id} from {work_dir}, current_phase={current_phase}, current_agent={current_agent}")
        return job_id

    async def restore_job_by_id(self, job_id: str) -> str:
        """Find and restore a job by its ID by scanning sandbox directories"""
        import json
        import glob

        # Check if already in memory
        if job_id in self.jobs:
            logger.info(f"Job {job_id} already in memory")
            return job_id

        # Scan sandbox directories for job_info.json with matching job_id
        sandbox_path = "sandbox"
        if not os.path.exists(sandbox_path):
            raise FileNotFoundError(f"Sandbox directory not found")

        for job_info_path in glob.glob(f"{sandbox_path}/*/job_info.json"):
            try:
                with open(job_info_path, 'r') as f:
                    job_data = json.load(f)
                if job_data.get("job_id") == job_id:
                    work_dir = os.path.dirname(job_info_path)
                    logger.info(f"Found job {job_id} at {work_dir}")
                    return await self.restore_job_from_disk(work_dir)
            except Exception as e:
                logger.warning(f"Failed to read {job_info_path}: {e}")
                continue

        raise FileNotFoundError(f"Job {job_id} not found in sandbox directories")

    async def add_event(self, job_id: str, event: dict) -> int:
        async with self.lock:
            if job_id not in self.events:
                self.events[job_id] = []
            self.events[job_id].append(event)
            # return new cursor (len)
            return len(self.events[job_id])

    async def get_events_since(self, job_id: str, last_idx: int | None) -> tuple[list[dict], int]:
        async with self.lock:
            buf = self.events.get(job_id, [])
            start = 0 if last_idx is None else last_idx
            new = buf[start:]
            return new, len(buf)

    async def get_job(self, job_id: str) -> Optional[JobInfo]:
        return self.jobs.get(job_id)

    async def list_jobs(self, status: Optional[JobStatus] = None) -> List[JobInfo]:
        jobs = list(self.jobs.values())
        if status:
            jobs = [job for job in jobs if job.status == status]
        return jobs

    async def cancel_job(self, job_id: str) -> bool:
        """Improved cancellation handling"""
        # 1. Set cancellation flag in callback
        callback = self.callbacks.get(job_id)
        if callback:
            callback.cancelled = True  # This will trigger exception on next stream event

        # 2. Also cancel asyncio task (as fallback)
        task = self.tasks.get(job_id)
        if task and not task.done():
            task.cancel()
        
        # 3. Update job status
        async with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id].status = JobStatus.CANCELLED
                self.jobs[job_id].updated_at = datetime.now()
                self.jobs[job_id].progress = "Job cancelled"
                
        # 4. Cleanup
        if job_id in self.callbacks:
            del self.callbacks[job_id]
            
        return True

    async def update_job_progress(self, job_id: str, progress: str):
        async with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id].progress = progress
                self.jobs[job_id].updated_at = datetime.now()

    async def update_job_phase(self, job_id: str, phase: str):
        async with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id].current_phase = phase
                self.jobs[job_id].current_agent = None  # Reset agent when phase changes
                self.jobs[job_id].updated_at = datetime.now()

    async def update_job_agent(self, job_id: str, agent: str):
        async with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id].current_agent = agent
                self.jobs[job_id].updated_at = datetime.now()

    async def pause_job(self, job_id: str) -> bool:
        """Pause a running job for later resume"""
        # Set PAUSED status FIRST before cancelling task
        # This ensures CancelledError handler sees PAUSED status
        async with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id].status = JobStatus.PAUSED
                self.jobs[job_id].updated_at = datetime.now()
                phase = self.jobs[job_id].current_phase or "unknown"
                agent = self.jobs[job_id].current_agent
                if agent:
                    self.jobs[job_id].progress = f"Paused at {phase}/{agent}"
                else:
                    self.jobs[job_id].progress = f"Paused at {phase}"

        # Then cancel the task
        callback = self.callbacks.get(job_id)
        if callback:
            callback.cancelled = True

        task = self.tasks.get(job_id)
        if task and not task.done():
            task.cancel()

        if job_id in self.callbacks:
            del self.callbacks[job_id]

        return True

    async def cleanup_old_jobs(self, hours: int = 24):
        cutoff = datetime.now() - timedelta(hours=hours)
        async with self.lock:
            stale = [
                job_id for job_id, job in self.jobs.items()
                if job.created_at < cutoff and job.status in {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}
            ]
            for job_id in stale:
                self.jobs.pop(job_id, None)
                self.chaos_eaters.pop(job_id, None)
                t = self.tasks.pop(job_id, None)
                if t and not t.done():
                    t.cancel()

    async def purge_job(self, job_id: str, delete_files: bool = True) -> dict:
        """
        Delete the job's in-memory information and (optionally) its work directory.
        If the job is in RUNNING or PENDING state, return an error equivalent to 409.
        """
        async with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return {"ok": False, "status": 404, "detail": f"Job {job_id} not found"}

            if job.status in {JobStatus.PENDING, JobStatus.RUNNING}:
                return {"ok": False, "status": 409, "detail": f"Job {job_id} is {job.status}, cancel it first"}

            # Delete files first (if needed)
            file_results = []
            if delete_files and job.work_dir:
                file_results.append(_safe_rmtree(job.work_dir))
                file_results.append(_safe_rmtree(f"/tmp/{Path(job.work_dir).name}"))

            # Cleanup in-memory state
            self.jobs.pop(job_id, None)
            self.chaos_eaters.pop(job_id, None)
            self.events.pop(job_id, None)
            cb = self.callbacks.pop(job_id, None)
            task = self.tasks.pop(job_id, None)
            if task and not task.done():
                task.cancel()

            return {"ok": True, "status": 200, "deleted_files": file_results}


# ---------------------------------------------------------------------
# API Callback (thread-safe progress updates)
# ---------------------------------------------------------------------
class APICallback:
    """
    ChaosEater invokes callbacks from a worker thread (run_in_executor).
    We bridge to the main asyncio loop via run_coroutine_threadsafe.
    """
    def __init__(self, job_manager: JobManager, job_id: str, loop: asyncio.AbstractEventLoop):
        self.job_manager = job_manager
        self.job_id = job_id
        self.loop = loop

    def _push(self, msg: str):
        fut = asyncio.run_coroutine_threadsafe(
            self.job_manager.update_job_progress(self.job_id, msg), self.loop
        )
        try:
            fut.result(timeout=5)
        except Exception as e:
            logger.warning(f"Progress push failed: {e}")

    def _push_event(self, event: dict):
        # Thread-safe fire-and-forget structured event
        event.setdefault("ts", time.time())
        fut = asyncio.run_coroutine_threadsafe(
            self.job_manager.add_event(self.job_id, event), self.loop
        )
        try:
            fut.result(timeout=5)
        except Exception as e:
            logger.warning(f"Event push failed: {e}")

    def on_stream(self, channel: str, event: dict) -> None:
        """Generic streaming hook used by agents."""
        # Enrich + forward as a structured event
        payload = dict(event)
        # default mode for partials if not provided by the producer
        if payload.get("type") == "partial" and "mode" not in payload:
            payload["mode"] = os.getenv("CE_PARTIAL_MODE", "delta")
        payload.setdefault("channel", channel)
        payload.setdefault("ts", time.time())
        fut = asyncio.run_coroutine_threadsafe(
            self.job_manager.add_event(self.job_id, payload),
            self.loop
        )
        try:
            fut.result(timeout=5)
        except Exception:
            pass

    # ---- ChaosEaterCallback interface ----
    def on_preprocess_start(self):        self._push("Phase 0: Preprocessing started")
    def on_preprocess_end(self, _):       self._push("Phase 0: Preprocessing completed")
    def on_hypothesis_start(self):        self._push("Phase 1: Hypothesis started")
    def on_hypothesis_end(self, _):       self._push("Phase 1: Hypothesis completed")
    def on_experiment_plan_start(self):   self._push("Phase 2: Experiment planning started")
    def on_experiment_plan_end(self, _):  self._push("Phase 2: Experiment planning completed")
    def on_experiment_start(self):        self._push("Phase 2: Experiment execution started")
    def on_experiment_end(self):          self._push("Phase 2: Experiment execution completed")
    def on_analysis_start(self):          self._push("Phase 3: Analysis started")
    def on_analysis_end(self, _):         self._push("Phase 3: Analysis completed")
    def on_improvement_start(self):       self._push("Phase 4: Improvement started")
    def on_improvement_end(self, _):      self._push("Phase 4: Improvement completed")
    def on_experiment_replan_start(self): self._push("Experiment replanning started")
    def on_experiment_replan_end(self, _):self._push("Experiment replanning completed")
    def on_postprocess_start(self):       self._push("Phase EX: Postprocessing started")
    def on_postprocess_end(self, _):      self._push("Phase EX: Postprocessing completed")

class CancellableAPICallback(APICallback):
    def __init__(
        self,
        job_manager: JobManager,
        job_id: str,
        loop: asyncio.AbstractEventLoop
    ):
        super().__init__(job_manager, job_id, loop)
        self.cancelled = False

    def _update_phase(self, phase: str):
        """Update current phase in job info for resume support"""
        fut = asyncio.run_coroutine_threadsafe(
            self.job_manager.update_job_phase(self.job_id, phase), self.loop
        )
        try:
            fut.result(timeout=5)
        except Exception as e:
            logger.warning(f"Phase update failed: {e}")

    def _update_agent(self, agent: str):
        """Update current agent in job info for resume support"""
        fut = asyncio.run_coroutine_threadsafe(
            self.job_manager.update_job_agent(self.job_id, agent), self.loop
        )
        try:
            fut.result(timeout=5)
        except Exception as e:
            logger.warning(f"Agent update failed: {e}")

    def on_agent_start(self, agent_name: str):
        """Called when an agent starts execution"""
        self._update_agent(agent_name)
        self._push(f"Agent started: {agent_name}")

    def on_agent_end(self, agent_name: str, result: any = None):
        """Called when an agent completes execution"""
        self._push(f"Agent completed: {agent_name}")

    def on_stream(self, channel: str, event: dict) -> None:
        """Check cancellation on every stream event"""
        if self.cancelled:
            raise asyncio.CancelledError(f"Job {self.job_id} cancelled")
        super().on_stream(channel, event)

    # Override phase start callbacks to track current phase
    def on_preprocess_start(self):
        self._update_phase("preprocess")
        super().on_preprocess_start()

    def on_hypothesis_start(self):
        self._update_phase("hypothesis")
        super().on_hypothesis_start()

    def on_experiment_plan_start(self):
        self._update_phase("experiment_plan")
        super().on_experiment_plan_start()

    def on_experiment_start(self):
        self._update_phase("experiment")
        super().on_experiment_start()

    def on_analysis_start(self):
        self._update_phase("analysis")
        super().on_analysis_start()

    def on_improvement_start(self):
        self._update_phase("improvement")
        super().on_improvement_start()

    def on_postprocess_start(self):
        self._update_phase("postprocess")
        super().on_postprocess_start()

# ---------------------------------------------------------------------
# Background runner
# ---------------------------------------------------------------------
from .streaming import FrontendMessageLogger

async def run_chaos_eater_cycle(
    job_id: str,
    job_manager: JobManager,
    request: ChaosEaterJobRequest,
    llm,
    ce_tool,
    resume_from: Optional[str] = None,
    resume_from_agent: Optional[str] = None,
    checkpoint_path: Optional[str] = None
):
    try:
        async with job_manager.lock:
            job_manager.jobs[job_id].status = JobStatus.RUNNING
            job_manager.jobs[job_id].updated_at = datetime.now()
            job_work_dir = job_manager.jobs[job_id].work_dir

        # Logger without Streamlit
        message_logger = FrontendMessageLogger(job_id=job_id)

        # Instance
        chaos_eater = ChaosEater(
            llm=llm,
            ce_tool=ce_tool,
            message_logger=message_logger,
            work_dir="sandbox",
            namespace=request.namespace
        )
        job_manager.chaos_eaters[job_id] = chaos_eater

        # Thread-safe callback
        loop = asyncio.get_running_loop()
        callback = CancellableAPICallback(job_manager, job_id, loop)

        # Store callback reference in JobManager
        job_manager.callbacks[job_id] = callback

        # Set emitter
        message_logger.set_emitter(lambda ev: callback.on_stream("log", ev))

        # Build/convert input
        if request.input_data:
            ce_input = ChaosEaterInput(**request.input_data)
        else:
            # project_path flow already validated by request model
            built = build_input_from_project_path(
                request.project_path,
                override_instructions=request.ce_instructions
            )
            ce_input = ChaosEaterInput(**built)

        # Load checkpoint if resuming
        checkpoint = None
        if resume_from and checkpoint_path and os.path.exists(checkpoint_path):
            import json
            with open(checkpoint_path, 'r') as f:
                checkpoint_data = json.load(f)
            checkpoint = ChaosEaterOutput(**checkpoint_data)
            logger.info(f"Resuming job {job_id} from phase: {resume_from}")

        # Run CE in thread pool (avoid blocking the event loop)
        from functools import partial
        runner_loop = asyncio.get_event_loop()
        run_fn = partial(
            chaos_eater.run_ce_cycle,
            input=ce_input,
            kube_context=request.kube_context,
            work_dir=job_work_dir,
            project_name=request.project_name,
            clean_cluster_before_run=request.clean_cluster_before_run if not resume_from else False,
            clean_cluster_after_run=request.clean_cluster_after_run,
            is_new_deployment=request.is_new_deployment if not resume_from else False,
            max_num_steadystates=request.max_num_steadystates,
            max_retries=request.max_retries,
            callbacks=[callback],
            resume_from=resume_from,
            resume_from_agent=resume_from_agent,
            checkpoint=checkpoint
        )
        result: ChaosEaterOutput = await runner_loop.run_in_executor(None, run_fn)

        async with job_manager.lock:
            job_manager.jobs[job_id].status = JobStatus.COMPLETED
            job_manager.jobs[job_id].updated_at = datetime.now()
            job_manager.jobs[job_id].result = result.dict()
            job_manager.jobs[job_id].progress = "Cycle completed successfully"

    except asyncio.CancelledError:
        async with job_manager.lock:
            # Check if job was paused (not cancelled)
            current_status = job_manager.jobs[job_id].status
            if current_status == JobStatus.PAUSED:
                # Keep PAUSED status - don't overwrite
                logger.info(f"Job {job_id} was paused at phase: {job_manager.jobs[job_id].current_phase}")
            else:
                job_manager.jobs[job_id].status = JobStatus.CANCELLED
                job_manager.jobs[job_id].updated_at = datetime.now()
                job_manager.jobs[job_id].progress = "Job cancelled"
                logger.info(f"Job {job_id} was cancelled")

    except Exception as e:
        logger.exception(f"Job {job_id} failed")
        async with job_manager.lock:
            job_manager.jobs[job_id].status = JobStatus.FAILED
            job_manager.jobs[job_id].updated_at = datetime.now()
            job_manager.jobs[job_id].error = str(e)
            job_manager.jobs[job_id].progress = f"Job failed: {e}"

    finally:
        # Cleanup
        job_manager.tasks.pop(job_id, None)
        job_manager.callbacks.pop(job_id, None)  # Remove callback reference


# ---------------------------------------------------------------------
# Globals & DI
# ---------------------------------------------------------------------
job_manager = JobManager()
_LLM = None
_CE_TOOL = None


def get_job_manager() -> JobManager:
    return job_manager


def get_llm():
    if _LLM is None:
        raise HTTPException(status_code=500, detail="LLM not configured")
    return _LLM


def get_ce_tool():
    if _CE_TOOL is None:
        raise HTTPException(status_code=500, detail="CE tool not configured")
    return _CE_TOOL


# ---------------------------------------------------------------------
# Lifespan (startup/shutdown)
# ---------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting ChaosEater API...")
    global _LLM, _CE_TOOL

    # Configure from environment (align with your GUI's load_llm usage)
    model_name = os.getenv("CE_MODEL", "openai/gpt-4o-2024-08-06")
    temperature = float(os.getenv("CE_TEMPERATURE", "0.0"))
    port = int(os.getenv("CE_PORT", "8000"))
    seed = int(os.getenv("CE_SEED", "42"))

    # Initialize runtime dependencies
    _LLM = load_llm(model_name=model_name, temperature=temperature, port=port, seed=seed)
    _CE_TOOL = CETool.init(CEToolType.chaosmesh)

    cleanup_task = asyncio.create_task(periodic_cleanup())
    try:
        yield
    finally:
        logger.info("Shutting down ChaosEater API...")
        cleanup_task.cancel()
        for task in list(job_manager.tasks.values()):
            task.cancel()
        await asyncio.gather(*job_manager.tasks.values(), return_exceptions=True)


async def periodic_cleanup():
    while True:
        try:
            await asyncio.sleep(3600)
            await job_manager.cleanup_old_jobs(hours=24)
        except asyncio.CancelledError:
            break


# ---------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="ChaosEater API",
    description="API for running Chaos Engineering experiments",
    version="1.1.0",
    lifespan=lifespan,
)

# (optional) CORS if your GUI runs on another origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ---------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------
@app.post("/jobs", response_model=JobResponse)
async def create_job(
    request: ChaosEaterJobRequest,
    job_mgr: JobManager = Depends(get_job_manager),
    llm_inst=Depends(get_llm),
    ce_tool_inst=Depends(get_ce_tool),
):
    # build LLM instance per request
    llm_inst = load_llm(
        model_name=request.model_name,
        temperature=request.temperature,
        seed=request.seed,
        port=int(os.getenv("CE_PORT", "8000"))
    )

    job_id = await job_mgr.create_job(request)
    job_info = await job_mgr.get_job(job_id)
    task = asyncio.create_task(
        run_chaos_eater_cycle(job_id, job_mgr, request, llm_inst, ce_tool_inst)
    )
    job_mgr.tasks[job_id] = task
    return JobResponse(
        job_id=job_id,
        status=JobStatus.PENDING,
        message=f"Job {job_id} created successfully",
        work_dir=job_info.work_dir
    )


class RestoreJobRequest(BaseModel):
    work_dir: str = Field(..., description="Path to the job's work directory")


@app.post("/jobs/restore", response_model=JobInfo)
async def restore_job(
    request: RestoreJobRequest,
    job_mgr: JobManager = Depends(get_job_manager),
):
    """
    Restore a job from disk after server restart.
    Use this when loading a snapshot that references a job that's no longer in memory.
    """
    try:
        job_id = await job_mgr.restore_job_from_disk(request.work_dir)
        job = await job_mgr.get_job(job_id)
        return job
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception(f"Failed to restore job from {request.work_dir}")
        raise HTTPException(status_code=500, detail=f"Failed to restore job: {e}")


@app.post("/jobs/{job_id}/restore", response_model=JobInfo)
async def restore_job_by_id(
    job_id: str,
    job_mgr: JobManager = Depends(get_job_manager),
):
    """
    Restore a job by its ID by scanning sandbox directories.
    Use this when loading a snapshot without work_dir info.
    """
    try:
        await job_mgr.restore_job_by_id(job_id)
        job = await job_mgr.get_job(job_id)
        return job
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception(f"Failed to restore job {job_id}")
        raise HTTPException(status_code=500, detail=f"Failed to restore job: {e}")


@app.get("/jobs/{job_id}", response_model=JobInfo)
async def get_job(job_id: str, job_mgr: JobManager = Depends(get_job_manager)):
    job = await job_mgr.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return job


@app.get("/jobs", response_model=List[JobInfo])
async def list_jobs(
    status: Optional[JobStatus] = Query(None, description="Filter by status"),
    job_mgr: JobManager = Depends(get_job_manager),
):
    return await job_mgr.list_jobs(status)


@app.delete("/jobs/{job_id}")
async def cancel_job(job_id: str, job_mgr: JobManager = Depends(get_job_manager)):
    """
    Cancel a running job.
    This will set the cancellation flag and interrupt the job at the next checkpoint.
    """
    job = await job_mgr.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    
    if job.status == JobStatus.CANCELLED:
        return {"message": f"Job {job_id} is already cancelled", "status": job.status}
        
    if job.status in {JobStatus.COMPLETED, JobStatus.FAILED}:
        raise HTTPException(
            status_code=400, 
            detail=f"Cannot cancel job {job_id} with status: {job.status}"
        )
    
    cancelled = await job_mgr.cancel_job(job_id)
    if cancelled:
        return {
            "message": f"Job {job_id} cancellation initiated",
            "status": "CANCELLING",
            "note": "Job will stop at the next checkpoint"
        }
    
    raise HTTPException(status_code=500, detail=f"Failed to cancel job {job_id}")


@app.post("/jobs/{job_id}/pause")
async def pause_job(job_id: str, job_mgr: JobManager = Depends(get_job_manager)):
    """
    Pause a running job for later resume.
    The job will stop at the current phase and can be resumed from there.
    """
    job = await job_mgr.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    if job.status != JobStatus.RUNNING:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot pause job {job_id} with status: {job.status}. Only RUNNING jobs can be paused."
        )

    paused = await job_mgr.pause_job(job_id)
    if paused:
        return {
            "message": f"Job {job_id} paused",
            "status": JobStatus.PAUSED,
            "current_phase": job.current_phase,
            "work_dir": job.work_dir
        }

    raise HTTPException(status_code=500, detail=f"Failed to pause job {job_id}")


@app.post("/jobs/{job_id}/resume")
async def resume_job(
    job_id: str,
    job_mgr: JobManager = Depends(get_job_manager),
    ce_tool_inst=Depends(get_ce_tool),
):
    """
    Resume a paused job from its last checkpoint.
    """
    job = await job_mgr.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    if job.status != JobStatus.PAUSED:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot resume job {job_id} with status: {job.status}. Only PAUSED jobs can be resumed."
        )

    if not job.work_dir:
        raise HTTPException(
            status_code=400,
            detail=f"Job {job_id} has no work_dir, cannot resume"
        )

    # Get the original request
    request = job_mgr.requests.get(job_id)
    if not request:
        raise HTTPException(
            status_code=400,
            detail=f"Original request not found for job {job_id}, cannot resume"
        )

    # Check for checkpoints - agent-level or phase-level
    output_checkpoint_path = f"{job.work_dir}/outputs/output.json"
    agent_checkpoint_path = f"{job.work_dir}/checkpoints/agent_checkpoint.json"
    resume_from = job.current_phase
    resume_from_agent = job.current_agent  # Agent-level resume

    # Determine which checkpoint to use
    has_agent_checkpoint = os.path.exists(agent_checkpoint_path)
    has_output_checkpoint = os.path.exists(output_checkpoint_path)

    if has_agent_checkpoint and resume_from_agent:
        # Agent-level checkpoint exists - use it for fine-grained resume
        # output.json may or may not exist (e.g., paused mid-preprocess)
        checkpoint_path = output_checkpoint_path if has_output_checkpoint else None
        logger.info(f"Agent checkpoint found, resuming from {resume_from}/{resume_from_agent}")
    elif has_agent_checkpoint and resume_from:
        # Agent checkpoint exists but no specific agent (phase completed, next phase starting)
        checkpoint_path = output_checkpoint_path if has_output_checkpoint else None
        logger.info(f"Agent checkpoint found (phase level), resuming from {resume_from}")
    elif has_output_checkpoint:
        # Phase-level checkpoint only
        checkpoint_path = output_checkpoint_path
        logger.info(f"Output checkpoint found, resuming from {resume_from}")
    elif resume_from:
        # No checkpoint files but we know where to resume (from JobInfo)
        checkpoint_path = None
        logger.info(f"No checkpoint files, but resuming from {resume_from} based on job state")
    else:
        # No checkpoint found at all
        logger.warning(f"No checkpoint found, restarting from beginning")
        checkpoint_path = None
        resume_from = None
        resume_from_agent = None

    # Update job status
    async with job_mgr.lock:
        job_mgr.jobs[job_id].status = JobStatus.RUNNING
        job_mgr.jobs[job_id].updated_at = datetime.now()
        if resume_from_agent:
            job_mgr.jobs[job_id].progress = f"Resuming from {resume_from}/{resume_from_agent}"
        elif resume_from:
            job_mgr.jobs[job_id].progress = f"Resuming from {resume_from}"
        else:
            job_mgr.jobs[job_id].progress = "Restarting from beginning (no checkpoint)"

    # Rebuild LLM with original settings
    llm_inst = load_llm(
        model_name=request.model_name,
        temperature=request.temperature,
        seed=request.seed,
        port=int(os.getenv("CE_PORT", "8000"))
    )

    # Start the resume task
    task = asyncio.create_task(
        run_chaos_eater_cycle(
            job_id=job_id,
            job_manager=job_mgr,
            request=request,
            llm=llm_inst,
            ce_tool=ce_tool_inst,
            resume_from=resume_from,
            resume_from_agent=resume_from_agent,
            checkpoint_path=checkpoint_path
        )
    )
    job_mgr.tasks[job_id] = task

    return {
        "message": f"Job {job_id} resuming from {resume_from or 'beginning'}" + (f"/{resume_from_agent}" if resume_from_agent else ""),
        "status": JobStatus.RUNNING,
        "resume_from": resume_from,
        "resume_from_agent": resume_from_agent
    }


@app.get("/jobs/{job_id}/logs")
async def get_job_logs(job_id: str, job_mgr: JobManager = Depends(get_job_manager)):
    job = await job_mgr.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if job.status != JobStatus.COMPLETED:
        raise HTTPException(status_code=400, detail=f"Job {job_id} is not completed (status: {job.status})")

    # NOTE: ChaosEater saves message log to <work_dir>/outputs/message_log.pkl
    if job.result and "work_dir" in job.result:
        log_file = os.path.join(job.result["work_dir"], "outputs", "message_log.pkl")
        if os.path.exists(log_file):
            return FileResponse(log_file, media_type="application/octet-stream", filename="message_log.pkl")
    raise HTTPException(status_code=404, detail="Log file not found")

@app.get("/jobs/{job_id}/output")
async def get_job_output(job_id: str, job_mgr: JobManager = Depends(get_job_manager)):
    job = await job_mgr.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if job.status != JobStatus.COMPLETED:
        raise HTTPException(status_code=400, detail=f"Job {job_id} is not completed (status: {job.status})")

    # NOTE: ChaosEater saves output.json to <work_dir>/outputs/output.json
    if job.result and "work_dir" in job.result:
        output_json = os.path.join(job.result["work_dir"], "outputs", "output.json")
        if os.path.exists(output_json):
            return FileResponse(output_json, media_type="application/json", filename="output.json")
    raise HTTPException(status_code=404, detail="Output file not found")

@app.get("/jobs/{job_id}/artifact")
async def get_job_artifact(job_id: str, job_mgr: JobManager = Depends(get_job_manager)):
    job = await job_mgr.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if not job.work_dir:
        raise HTTPException(status_code=400, detail="work_dir is not set for this job")
    
    # generate artifact
    artifact_path = os.path.join(
        "/tmp",
        Path(job.work_dir).name,
        "artifact.zip"
    )
    zip_path = make_artifact(job.work_dir, artifact_path)

    if os.path.exists(artifact_path):
        return FileResponse(zip_path, media_type="application/zip", filename="artifact.zip")
    raise HTTPException(status_code=404, detail="Artifact not found")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.websocket("/jobs/{job_id}/stream")
async def websocket_endpoint(websocket: WebSocket, job_id: str, job_mgr: JobManager = Depends(get_job_manager)):
    await websocket.accept()
    try:
        job = await job_mgr.get_job(job_id)
        if not job:
            await websocket.send_json({"error": f"Job {job_id} not found"})
            return

        last_progress = None
        last_event_idx = 0   # Important: cursor of already-sent events
        while True:
            # 1. only NEW events
            new_events, last_event_idx = await job_mgr.get_events_since(job_id, last_event_idx)
            for ev in new_events:
                await websocket.send_json({"type": "event", "event": ev})

            # 2. progress changed only
            job = await job_mgr.get_job(job_id)
            if not job:
                break
            if job.progress != last_progress:
                await websocket.send_json({
                    "job_id": job_id,
                    "status": job.status,
                    "progress": job.progress,
                    "updated_at": job.updated_at.isoformat()
                })
                last_progress = job.progress

            # 3. terminal
            if job.status in {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}:
                await websocket.send_json({
                    "job_id": job_id,
                    "status": job.status,
                    "message": "Job finished",
                    "result": job.result if job.status == JobStatus.COMPLETED else None,
                    "error": job.error if job.status == JobStatus.FAILED else None,
                })
                break

            await asyncio.sleep(1)
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for job {job_id}")
    except Exception:
        logger.exception(f"WebSocket error for job {job_id}")
        try:
            await websocket.send_json({"error": "WebSocket internal error"})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass

# ---------------------------------------------------------------------
# Project upload
# ---------------------------------------------------------------------
import tempfile
import shutil
import zipfile
from pathlib import Path
from fastapi import UploadFile, File

# Where to store temp projects
TEMP_BASE = Path(os.getenv("CE_TEMP_BASE", "/tmp/chaos-eater")).resolve()
TEMP_BASE.mkdir(parents=True, exist_ok=True)

def _safe_temp_project_dir() -> Path:
    # Create a unique directory under TEMP_BASE
    return Path(tempfile.mkdtemp(prefix="proj_", dir=str(TEMP_BASE)))

def _unzip_to_dir(zip_fp: Path, dest_dir: Path):
    with zipfile.ZipFile(zip_fp, "r") as zf:
        zf.extractall(dest_dir)

@app.post("/upload", summary="Upload project zip and get a project_path")
async def upload_project_zip(
    file: UploadFile = File(..., description="Project zip containing skaffold.yaml etc."),
):
    # Create a unique working dir
    proj_dir = _safe_temp_project_dir()
    zip_path = proj_dir / "project.zip"

    # Save uploaded zip
    with zip_path.open("wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)

    # Extract it into the same folder
    try:
        _unzip_to_dir(zip_path, proj_dir)
    except zipfile.BadZipFile:
        shutil.rmtree(proj_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="Invalid zip file")

    # Optional: remove zip after extract
    zip_path.unlink(missing_ok=True)

    # Search for skaffold.yaml and use its parent directory as the project_path.
    matches = list(proj_dir.rglob("skaffold.yaml"))
    if not matches:
        raise HTTPException(status_code=400, detail="skaffold.yaml not found in uploaded zip")

    skaffold_dir = matches[0].parent
    return {"project_path": str(skaffold_dir)}

# ---------------------------------------------------------------------
# Get cluster list
# ---------------------------------------------------------------------
import os
from typing import Optional, List, Dict, Any
from kubernetes.config import list_kube_config_contexts
from redis.asyncio import Redis

# redis client
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
redis: Redis = Redis.from_url(REDIS_URL, decode_responses=True)
USAGE_HASH = "cluster_usage"  # { session_id: context_name }

# helper functions
def list_kind_contexts() -> List[str]:
    contexts, active = list_kube_config_contexts()
    names = [c["name"] for c in (contexts or [])]
    return sorted([n for n in names if n.startswith("kind-")])

async def compute_available(session_id: Optional[str]) -> Dict[str, Any]:
    all_ctx = set(list_kind_contexts())

    usage: Dict[str, str] = await redis.hgetall(USAGE_HASH)  # {sid: ctx}
    used_ctx = set(usage.values())

    mine = usage.get(session_id) if session_id else None
    available = (all_ctx - used_ctx) | ({mine} if mine else set())

    return {
        "all": sorted(all_ctx),
        "used": sorted(used_ctx),
        "mine": mine,
        "available": sorted(available),
    }

# endpoints
@app.get("/clusters")
async def list_clusters(session_id: Optional[str] = None):
    """
    List available kind contexts.
    - available: Unused contexts + those reserved by the current session
    - used: Contexts currently in use by other sessions
    - mine: The context reserved by the current session (null if none)
    """
    return await compute_available(session_id)

class ClaimBody(BaseModel):
    session_id: str
    preferred: Optional[str] = None

@app.post("/clusters/claim")
async def claim_cluster(body: ClaimBody):
    """
    Claim a cluster (one per session).
    - If 'preferred' is available, assign that cluster.
    - If no preferred cluster is provided, automatically assign the first available one.
    """
    info = await compute_available(body.session_id)
    available = info["available"]
    mine = info["mine"]

    # If the session already owns a cluster, return it as-is
    if mine:
        return {"cluster": mine, "already_owned": True}

    # If 'preferred' is provided and available, assign it
    if body.preferred and body.preferred in available:
        await redis.hset(USAGE_HASH, body.session_id, body.preferred)
        return {"cluster": body.preferred, "already_owned": False}

    # Otherwise, pick the first available cluster
    if not available:
        raise HTTPException(409, "No clusters available")
    chosen = available[0]
    await redis.hset(USAGE_HASH, body.session_id, chosen)
    return {"cluster": chosen, "already_owned": False}

class ReleaseBody(BaseModel):
    session_id: str

@app.post("/clusters/release")
async def release_cluster(body: ReleaseBody):
    removed = await redis.hdel(USAGE_HASH, body.session_id)
    return {"released": bool(removed)}

from ..utils.k8s import remove_all_resources_by_labels, remove_all_resources_by_namespace 

class CleanClusterBody(BaseModel):
    kube_context: str
    namespace: str
    project_name: str

@app.post("/clusters/clean")
async def clean_cluster(body: CleanClusterBody):
    try:
        remove_all_resources_by_namespace(body.kube_context, body.namespace)
        remove_all_resources_by_labels(body.kube_context, f"project={body.project_name}")
        return {"cleaned": True}
    except Exception as e:
        return {"cleaned": False, "error": str(e)}

# ---------------------------------------------------------------------
# API key settings
# ---------------------------------------------------------------------
from typing import Optional, Literal
from pydantic import field_validator

from ..utils.llms import get_env_key_name, verify_api_key, verify_model_name


Provider = Literal["openai", "anthropic", "google", "ollama"]

class APIKeyRequest(BaseModel):
    provider: Provider
    api_key: str

    @field_validator("api_key")
    @classmethod
    def not_empty(cls, v: str):
        if not v or not v.strip():
            raise ValueError("api_key must not be empty")
        return v.strip()

class APIKeyInfo(BaseModel):
    provider: Provider
    configured: bool

def _set_env_key(provider: str, api_key: str) -> None:
    env_name = get_env_key_name(provider)
    os.environ[env_name] = api_key

def _get_env_key(provider: str) -> Optional[str]:
    env_name = get_env_key_name(provider)
    return os.environ.get(env_name)

def _del_env_key(provider: str) -> bool:
    env_name = get_env_key_name(provider)
    if env_name in os.environ:
        del os.environ[env_name]
        return True
    return False

@app.post("/config/api-key", response_model=APIKeyInfo)
async def set_api_key(req: APIKeyRequest):
    """
    Validate and set API key for a given provider.
    - Returns masked key in response.
    - If ?persist=true, also writes to .env (development convenience).
    """
    ok = verify_api_key(req.provider, req.api_key)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid API key for the provider")
    _set_env_key(req.provider, req.api_key)
    return APIKeyInfo(
        provider=req.provider,
        configured=True,
    )

@app.get("/config/api-key", response_model=APIKeyInfo)
async def get_api_key(provider: Provider = Query(...)):
    """
    Get current configuration status for a provider.
    Only returns masked key (or nothing).
    """
    existing = _get_env_key(provider)
    return APIKeyInfo(
        provider=provider,
        configured=bool(existing and verify_api_key(provider, existing))
    )

@app.delete("/config/api-key", response_model=APIKeyInfo)
async def delete_api_key(provider: Provider = Query(...), persist: bool = Query(False)):
    """
    Delete API key for a provider from process env (and optionally from .env).
    """
    existed = _get_env_key(provider)
    removed = _del_env_key(provider)
    return APIKeyInfo(
        provider=provider,
        configured=False,
    )

#----------------
# job management
#----------------
@app.delete("/jobs/{job_id}/purge")
async def purge_job_storage(
    job_id: str,
    delete_files: bool = Query(True, description="Whether to delete the work_dir"),
    job_mgr: JobManager = Depends(get_job_manager),
):
    """
    For completed/failed/cancelled jobs:
      - Optionally delete the work_dir
      - Clean up jobs / tasks / events / callbacks / chaos_eaters inside JobManager
    If the job is RUNNING or PENDING, return 409.
    """
    result = await job_mgr.purge_job(job_id, delete_files=delete_files)
    if not result["ok"]:
        raise HTTPException(status_code=result["status"], detail=result["detail"])
    return {
        "message": f"Job {job_id} purged",
        "deleted_files": result.get("deleted_files"),
    }

#-----------------------------
# model verification (Ollama)
#-----------------------------
import json, time, requests
from fastapi.responses import StreamingResponse

def _norm_ollama_model(name: str) -> str:
    # "ollama/qwen3:32b" -> "qwen3:32b"
    return name.split("ollama/", 1)[1] if name.startswith("ollama/") else name

def _sanitize_model(name: str) -> str:
    # Basic sanitization to avoid accidental whitespace/quotes
    return name.strip().strip('"').strip("'")

@app.get("/ollama/verify")
async def verify_ollama_model(model: str):
    """
    Check if an Ollama model is already pulled (present in /api/tags).
    Query example: /ollama/verify?model=qwen3:32b
    """
    base = os.getenv("OLLAMA_BASE") or "http://localhost:11434"
    short = _norm_ollama_model(model)
    try:
        r = requests.get(f"{base}/api/tags", timeout=10)
        r.raise_for_status()
        data = r.json()
        exists = any(m.get("name") == short for m in data.get("models", []))
        return {"model": short, "exists": bool(exists)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ollama verify error: {e}")

class OllamaPullBody(BaseModel):
    model: str  # accepts "ollama/<name>" or "<name>"

@app.post("/ollama/pull")
async def ollama_pull(req: OllamaPullBody):
    """
    Proxy Ollama /api/pull NDJSON stream to the frontend as bytes and emit
    throttled server-side logs (INFO) with progress percentage. If no explicit
    success event is seen, perform a bounded post-verify against /api/tags and
    emit a final {"status":"success"} when the model appears.
    """
    base = os.getenv("OLLAMA_BASE") or "http://localhost:11434"
    model = _sanitize_model(_norm_ollama_model(req.model))

    # Post-verify window and logging throttling knobs
    verify_secs = int(os.getenv("OLLAMA_VERIFY_TIMEOUT_SECONDS", "120"))
    pct_step = max(1, int(os.getenv("OLLAMA_PULL_LOG_EVERY_PERCENT", "5")))
    min_interval = int(os.getenv("OLLAMA_PULL_LOG_INTERVAL_SECONDS", "15"))

    def stream():
        logger.info(f"[ollama/pull] start: model={model}, base={base}")
        saw_success = False
        saw_error: Optional[str] = None

        # Progress throttling state
        last_pct_logged = -pct_step  # force log at first computed pct
        last_log_ts = 0.0

        # Helper to maybe log progress
        def maybe_log_progress(pct: Optional[float], status: Optional[str]):
            nonlocal last_pct_logged, last_log_ts
            now = time.time()
            if pct is None:
                # Log status at interval if no percentage available
                if now - last_log_ts >= min_interval:
                    logger.info(f"[ollama/pull] {model}: status={status}")
                    last_log_ts = now
                return
            pct_int = int(pct)
            # Log on step change or time interval
            if pct_int >= last_pct_logged + pct_step or (now - last_log_ts) >= min_interval:
                logger.info(f"[ollama/pull] {model}: progress={pct_int}% (status={status})")
                last_pct_logged = pct_int
                last_log_ts = now

        try:
            with requests.post(
                f"{base}/api/pull",
                json={"name": model},
                stream=True,
                timeout=None,  # pulling can take a long time
            ) as r:
                r.raise_for_status()

                for raw in r.iter_lines(decode_unicode=False):
                    if not raw:
                        continue

                    # Forward upstream NDJSON to client
                    yield raw + b"\n"

                    # Attempt to parse and extract progress/status for logging
                    try:
                        obj = json.loads(raw.decode("utf-8", "replace"))
                        status = obj.get("status")
                        done_flag = obj.get("done") is True
                        if status == "success" or done_flag:
                            saw_success = True
                        if "error" in obj and obj["error"]:
                            saw_error = str(obj["error"])

                        # Compute rough % if possible
                        pct = None
                        total = obj.get("total")
                        completed = obj.get("completed")
                        if isinstance(total, int) and total > 0 and isinstance(completed, int):
                            pct = (completed / total) * 100.0
                        elif isinstance(obj.get("percentage"), (int, float)):
                            pct = float(obj["percentage"]) * 100.0 if obj["percentage"] <= 1 else float(obj["percentage"])

                        maybe_log_progress(pct, status)
                    except Exception:
                        # Ignore parse errors; keep streaming and avoid noisy logs
                        pass
        except Exception as e:
            msg = f"pull request failed: {e}"
            logger.error(f"[ollama/pull] {model}: {msg}")
            err = {"status": "error", "error": msg}
            yield (json.dumps(err).encode("utf-8") + b"\n")
            return

        # Post-verify if we didn't observe a terminal success
        if not saw_success and not saw_error:
            logger.info(f"[ollama/pull] {model}: no explicit success; start post-verify up to {verify_secs}s")
            deadline = time.time() + verify_secs
            attempt = 0
            while time.time() < deadline:
                attempt += 1
                try:
                    tags = requests.get(f"{base}/api/tags", timeout=10)
                    tags.raise_for_status()
                    data = tags.json()
                    if any(m.get("name") == model for m in data.get("models", [])):
                        saw_success = True
                        logger.info(f"[ollama/pull] {model}: post-verify success on attempt {attempt}")
                        break
                except Exception as e:
                    logger.warning(f"[ollama/pull] {model}: post-verify error (attempt {attempt}): {e}")
                time.sleep(2)

        # Emit a final terminal record the frontend can rely on
        if saw_success:
            final = {"status": "success", "model": model}
            logger.info(f"[ollama/pull] done: model={model} (success)")
            yield (json.dumps(final).encode("utf-8") + b"\n")
        elif saw_error:
            final = {"status": "error", "error": saw_error}
            logger.error(f"[ollama/pull] done: model={model} (error) {saw_error}")
            yield (json.dumps(final).encode("utf-8") + b"\n")
        else:
            # Still no success nor explicit error → report incomplete with hint
            msg = 'Pull did not complete (no "success" event and model not found after post-verify)'
            final = {"status": "error", "error": msg}
            logger.error(f"[ollama/pull] done: model={model} (incomplete) {msg}")
            yield (json.dumps(final).encode("utf-8") + b"\n")

    return StreamingResponse(stream(), media_type="application/x-ndjson")

#--------
# Router
#--------
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pathlib import Path
import json
import os
import asyncio
import time

router = APIRouter()

# ---------- REST: one-shot aggregation ----------
@router.get("/jobs/{job_id}/stats")
async def get_stats(job_id: str, job_mgr: JobManager = Depends(get_job_manager)):
    job = await job_mgr.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    # Resolve work_dir from job.result or job.work_dir
    work_dir = None
    if job.result and "work_dir" in job.result:
        work_dir = Path(job.result["work_dir"])
    elif job.work_dir:
        work_dir = Path(job.work_dir)

    if not work_dir:
        raise HTTPException(status_code=404, detail="work_dir not found for this job")

    log_file = work_dir / "logs" / "agent_log.jsonl"
    if not log_file.exists():
        raise HTTPException(status_code=404, detail="log file not found")

    return compute_stats_from_file(log_file)


# ---------- WebSocket: push updates as the log grows ----------
@router.websocket("/jobs/{job_id}/stats/stream")
async def ws_stats_stream(websocket: WebSocket, job_id: str, job_mgr: JobManager = Depends(get_job_manager)):
    await websocket.accept()

    try:
        job = await job_mgr.get_job(job_id)
        if not job:
            await websocket.send_json({"type": "error", "detail": f"Job {job_id} not found"})
            return

        # Resolve work_dir
        work_dir = None
        if job.result and "work_dir" in job.result:
            work_dir = Path(job.result["work_dir"])
        elif job.work_dir:
            work_dir = Path(job.work_dir)
        if not work_dir:
            await websocket.send_json({"type": "error", "detail": "work_dir not found for this job"})
            return

        log_path = work_dir / "logs" / "agent_log.jsonl"
        if not log_path.exists():
            await websocket.send_json({"type": "error", "detail": "log file not found"})
            return

        # Send initial snapshot by scanning the whole file
        state = compute_stats_from_file(log_path)  # dict (total/by_agent/phases/time/lines)
        await websocket.send_json({"type": "stats", "snapshot": state})

        # Tail the file and aggregate only appended lines
        last_pos = os.path.getsize(log_path)
        last_mtime = os.path.getmtime(log_path)
        keepalive_at = time.time() + 30  # send periodic ping

        while True:
            try:
                # Handle rotation/disappearance: if file disappears, wait and retry
                exists_now = log_path.exists()
                if not exists_now:
                    await asyncio.sleep(0.5)
                    if not log_path.exists():
                        await websocket.send_json({"type": "warning", "detail": "log file disappeared; waiting..."})
                        await asyncio.sleep(1.5)
                        continue

                size_now = os.path.getsize(log_path)
                mtime_now = os.path.getmtime(log_path)

                # (1) Rotation or truncation detected: rescan full file and resend snapshot
                if size_now < last_pos or mtime_now < last_mtime:
                    state = compute_stats_from_file(log_path)
                    await websocket.send_json({"type": "stats", "snapshot": state})
                    last_pos = os.path.getsize(log_path)
                    last_mtime = os.path.getmtime(log_path)
                    await asyncio.sleep(0.2)
                    continue

                # (2) New data appended: read increment and merge into state
                if size_now > last_pos:
                    inc_lines, inc_state = read_increment_and_aggregate(log_path, last_pos)
                    last_pos = size_now
                    last_mtime = mtime_now

                    if inc_lines > 0:
                        merge_increment(state, inc_state)
                        await websocket.send_json({"type": "stats", "snapshot": state})

                # Periodic keepalive
                now = time.time()
                if now >= keepalive_at:
                    await websocket.send_json({"type": "ping", "ts": now})
                    keepalive_at = now + 30

                await asyncio.sleep(0.5)

            except WebSocketDisconnect:
                break
            except Exception as e:
                # Non-fatal errors (e.g., temporary file locks): report and retry later
                await websocket.send_json({"type": "warning", "detail": str(e)})
                await asyncio.sleep(1.0)

    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ---------- Aggregation utilities ----------
def parse_add_log(line: str):
    """
    Parse a JSONL line. Only process entries of type {"type": "add_log", ...}.
    Returns:
      (ts, phase, agent_name, input_tokens, output_tokens, total_tokens) or None
    """
    try:
        ev = json.loads(line)
    except Exception:
        return None
    if ev.get("type") != "add_log":
        return None

    ts = ev.get("ts")
    phase = ev.get("phase")

    log = ev.get("log") or {}
    agent = log.get("agent_name") or "(unknown)"
    tu = log.get("token_usage") or {}

    it = safe_int(tu.get("input_tokens", 0))
    ot = safe_int(tu.get("output_tokens", 0))
    # Fallback: if total is missing, compute as input + output
    tt = safe_int(tu.get("total_tokens", it + ot))

    return ts, phase, agent, it, ot, tt


def safe_int(v):
    try:
        return int(v)
    except Exception:
        return 0


def empty_state():
    return {
        "total": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
        "by_agent": {},  # name -> usage dict
        "phases": {},    # phase -> {count, first_ts, last_ts}
        "time": {"first_ts": None, "last_ts": None, "elapsed_sec": None},
        "lines": 0,
    }


def compute_stats_from_file(path: Path) -> dict:
    """
    Scan the entire file and return a snapshot dict:
      {
        total: {input_tokens, output_tokens, total_tokens},
        by_agent: [{agent_name, token_usage}, ...] (sorted by total desc),
        phases: {phase: {count, first_ts, last_ts}, ...},
        time: {first_ts, last_ts, elapsed_sec},
        lines: <int>
      }
    """
    st = empty_state()
    first_ts = None
    last_ts = None

    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            parsed = parse_add_log(line)
            if not parsed:
                continue

            ts, phase, agent, it, ot, tt = parsed
            st["lines"] += 1

            # totals
            st["total"]["input_tokens"] += it
            st["total"]["output_tokens"] += ot
            st["total"]["total_tokens"] += tt

            # by_agent
            a = st["by_agent"].setdefault(agent, {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0})
            a["input_tokens"] += it
            a["output_tokens"] += ot
            a["total_tokens"] += tt

            # phases
            if phase is not None:
                p = st["phases"].setdefault(phase, {"count": 0, "first_ts": ts, "last_ts": ts})
                p["count"] += 1
                if ts is not None:
                    p["first_ts"] = ts if p["first_ts"] is None else min(p["first_ts"], ts)
                    p["last_ts"] = ts if p["last_ts"] is None else max(p["last_ts"], ts)

            # time
            if ts is not None:
                first_ts = ts if first_ts is None else min(first_ts, ts)
                last_ts = ts if last_ts is None else max(last_ts, ts)

    st["time"]["first_ts"] = first_ts
    st["time"]["last_ts"] = last_ts
    st["time"]["elapsed_sec"] = (last_ts - first_ts) if (first_ts is not None and last_ts is not None) else None

    # Convert by_agent to sorted array (desc by total_tokens)
    st["by_agent"] = [
        {"agent_name": name, "token_usage": usage}
        for name, usage in sorted(st["by_agent"].items(), key=lambda kv: kv[1]["total_tokens"], reverse=True)
    ]
    return st


def read_increment_and_aggregate(path: Path, start_pos: int) -> tuple[int, dict]:
    """
    Read only the appended part after start_pos and return an incremental state
    with the same shape as compute_stats_from_file(). The caller is expected to
    merge it into an existing snapshot using merge_increment().
    """
    inc = empty_state()
    first_ts = None
    last_ts = None

    with path.open("r", encoding="utf-8") as f:
        f.seek(start_pos)
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            parsed = parse_add_log(line)
            if not parsed:
                continue

            ts, phase, agent, it, ot, tt = parsed
            inc["lines"] += 1

            inc["total"]["input_tokens"] += it
            inc["total"]["output_tokens"] += ot
            inc["total"]["total_tokens"] += tt

            a = inc["by_agent"].setdefault(agent, {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0})
            a["input_tokens"] += it
            a["output_tokens"] += ot
            a["total_tokens"] += tt

            if phase is not None:
                p = inc["phases"].setdefault(phase, {"count": 0, "first_ts": ts, "last_ts": ts})
                p["count"] += 1
                if ts is not None:
                    p["first_ts"] = ts if p["first_ts"] is None else min(p["first_ts"], ts)
                    p["last_ts"] = ts if p["last_ts"] is None else max(p["last_ts"], ts)

            if ts is not None:
                first_ts = ts if first_ts is None else min(first_ts, ts)
                last_ts = ts if last_ts is None else max(last_ts, ts)

    inc["time"]["first_ts"] = first_ts
    inc["time"]["last_ts"] = last_ts
    inc["time"]["elapsed_sec"] = (last_ts - first_ts) if (first_ts is not None and last_ts is not None) else None

    # Convert by_agent to sorted array (desc by total_tokens)
    inc["by_agent"] = [
        {"agent_name": name, "token_usage": usage}
        for name, usage in sorted(inc["by_agent"].items(), key=lambda kv: kv[1]["total_tokens"], reverse=True)
    ]
    # Return number of processed lines as a hint to the caller
    return inc["lines"], inc


def merge_increment(base: dict, inc: dict) -> None:
    """
    Destructively merge the incremental state `inc` into the snapshot `base`.
    Shapes must be compatible with compute_stats_from_file()/read_increment_and_aggregate().
    """
    # totals
    for k in ("input_tokens", "output_tokens", "total_tokens"):
        base["total"][k] += inc["total"][k]

    # by_agent: convert base array back to a dict for merging
    base_map = {e["agent_name"]: e["token_usage"] for e in base.get("by_agent", [])}
    for e in inc.get("by_agent", []):
        name = e["agent_name"]
        u = e["token_usage"]
        slot = base_map.setdefault(name, {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0})
        slot["input_tokens"] += u["input_tokens"]
        slot["output_tokens"] += u["output_tokens"]
        slot["total_tokens"] += u["total_tokens"]
    # Re-sort back to array
    base["by_agent"] = [
        {"agent_name": name, "token_usage": usage}
        for name, usage in sorted(base_map.items(), key=lambda kv: kv[1]["total_tokens"], reverse=True)
    ]

    # phases
    for phase, pdata in inc.get("phases", {}).items():
        slot = base["phases"].setdefault(phase, {"count": 0, "first_ts": pdata["first_ts"], "last_ts": pdata["last_ts"]})
        slot["count"] += pdata["count"]
        fts = pdata.get("first_ts")
        lts = pdata.get("last_ts")
        if fts is not None:
            slot["first_ts"] = fts if slot["first_ts"] is None else min(slot["first_ts"], fts)
        if lts is not None:
            slot["last_ts"] = lts if slot["last_ts"] is None else max(slot["last_ts"], lts)

    # time
    bft = base["time"]["first_ts"]
    blt = base["time"]["last_ts"]
    if inc["time"]["first_ts"] is not None:
        bft = inc["time"]["first_ts"] if bft is None else min(bft, inc["time"]["first_ts"])
    if inc["time"]["last_ts"] is not None:
        blt = inc["time"]["last_ts"] if blt is None else max(blt, inc["time"]["last_ts"])
    base["time"]["first_ts"] = bft
    base["time"]["last_ts"] = blt
    base["time"]["elapsed_sec"] = (blt - bft) if (bft is not None and blt is not None) else None

    # lines
    base["lines"] += inc["lines"]

# set router
app.include_router(router)


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run(
        "chaos_eater_api:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=True,
        log_level="info",
    )