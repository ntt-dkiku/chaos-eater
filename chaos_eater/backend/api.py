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


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    message: str


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
        self.lock = asyncio.Lock()

    async def create_job(self, _: ChaosEaterJobRequest) -> str:
        job_id = str(uuid.uuid4())
        async with self.lock:
            self.jobs[job_id] = JobInfo(
                job_id=job_id,
                status=JobStatus.PENDING,
                created_at=datetime.now(),
                updated_at=datetime.now(),
                progress="Job created",
                work_dir=f"sandbox/cycle_{get_timestamp()}"
            )
        return job_id

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

    def on_stream(self, channel: str, event: dict) -> None:
        """Check cancellation on every stream event"""
        if self.cancelled:
            raise asyncio.CancelledError(f"Job {self.job_id} cancelled")
        super().on_stream(channel, event)

# ---------------------------------------------------------------------
# Background runner
# ---------------------------------------------------------------------
from .streaming import FrontendMessageLogger

async def run_chaos_eater_cycle(
    job_id: str,
    job_manager: JobManager,
    request: ChaosEaterJobRequest,
    llm,
    ce_tool
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

        # Run CE in thread pool (avoid blocking the event loop)
        runner_loop = asyncio.get_event_loop()
        result: ChaosEaterOutput = await runner_loop.run_in_executor(
            None,
            chaos_eater.run_ce_cycle,
            ce_input,
            request.kube_context,
            job_work_dir, 
            request.project_name,
            request.clean_cluster_before_run,
            request.clean_cluster_after_run,
            request.is_new_deployment,
            request.max_num_steadystates,
            request.max_retries,
            [callback],
        )

        async with job_manager.lock:
            job_manager.jobs[job_id].status = JobStatus.COMPLETED
            job_manager.jobs[job_id].updated_at = datetime.now()
            job_manager.jobs[job_id].result = result.dict()
            job_manager.jobs[job_id].progress = "Cycle completed successfully"

    except asyncio.CancelledError:
        async with job_manager.lock:
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
    task = asyncio.create_task(
        run_chaos_eater_cycle(job_id, job_mgr, request, llm_inst, ce_tool_inst)
    )
    job_mgr.tasks[job_id] = task
    return JobResponse(job_id=job_id, status=JobStatus.PENDING, message=f"Job {job_id} created successfully")


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
        last_event_idx = 0   # ← これが重要（送信済みカーソル）
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
    kind のコンテキスト一覧。
    - available: 未使用 + 自分が確保済みのもの
    - used: 他セッションが使用中のもの
    - mine: 自分の確保済み（なければ null）
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