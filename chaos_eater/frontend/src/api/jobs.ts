/**
 * Job creation payload
 */
export interface JobCreatePayload {
  project_path: string;
  ce_instructions: string;
  kube_context: string;
  project_name: string;
  work_dir: string | null;
  clean_cluster_before_run: boolean;
  clean_cluster_after_run: boolean;
  is_new_deployment: boolean;
  model_name: string;
  temperature: number;
  seed: number;
  max_num_steadystates: number;
  max_retries: number;
  namespace: string;
}

/**
 * Job creation response
 */
export interface JobCreateResponse {
  job_id: string;
  work_dir: string;
}

/**
 * Job status response
 */
export interface JobStatusResponse {
  status: string;
  current_phase?: string;
  current_agent?: string;
  has_partial_output?: boolean;  // true if stopped mid-stream (use retry_context)
  next_agent?: string;           // next agent to run (set when cancel at approval)
}

/**
 * Purge response
 */
export interface PurgeResponse {
  deleted_files?: Array<{ path?: string; deleted?: boolean; reason?: string }>;
}

/**
 * Create a new job
 */
export async function createJob(
  apiBase: string,
  payload: JobCreatePayload,
  options: { apiKey?: string; model?: string } = {}
): Promise<JobCreateResponse> {
  const { apiKey, model } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers['x-api-key'] = apiKey;
  if (model) headers['x-model'] = model;

  const res = await fetch(`${apiBase}/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.detail || data.message || 'Failed to create job');
  }

  return data;
}

/**
 * Pause a running job
 */
export async function pauseJob(
  apiBase: string,
  jobId: string
): Promise<{ current_phase?: string }> {
  const res = await fetch(`${apiBase}/jobs/${encodeURIComponent(jobId)}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) {
      throw new Error('Job not found');
    } else if (res.status === 400) {
      throw new Error(data.detail || 'Job may not be running or already finished');
    }
    throw new Error(`Pause failed: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Resume a paused job
 */
export async function resumeJob(
  apiBase: string,
  jobId: string,
  options: { apiKey?: string; feedback?: string } = {}
): Promise<{ resume_from?: string; resume_from_agent?: string; has_feedback?: boolean }> {
  const { apiKey, feedback } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers['x-api-key'] = apiKey;

  const res = await fetch(`${apiBase}/jobs/${encodeURIComponent(jobId)}/resume`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ feedback }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to resume job');
  }

  return res.json();
}

/**
 * Delete a job
 */
export async function deleteJob(apiBase: string, jobId: string): Promise<void> {
  await fetch(`${apiBase}/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Purge job files and artifacts
 */
export async function purgeJob(apiBase: string, jobId: string): Promise<PurgeResponse> {
  const res = await fetch(
    `${apiBase}/jobs/${encodeURIComponent(jobId)}/purge?delete_files=true`,
    { method: 'DELETE' }
  );

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(body?.detail || `HTTP ${res.status}`);
  }

  return body;
}

/**
 * Get job status
 */
export async function getJob(apiBase: string, jobId: string): Promise<JobStatusResponse> {
  const res = await fetch(`${apiBase}/jobs/${encodeURIComponent(jobId)}`);

  if (!res.ok) {
    throw new Error(`Job not found (HTTP ${res.status})`);
  }

  return res.json();
}

/**
 * Restore a job from disk
 */
export async function restoreJob(
  apiBase: string,
  options: { jobId?: string; workDir?: string }
): Promise<{ job_id: string; current_phase?: string; current_agent?: string }> {
  let res: Response;

  if (options.workDir) {
    res = await fetch(`${apiBase}/jobs/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_dir: options.workDir }),
    });
  } else if (options.jobId) {
    res = await fetch(`${apiBase}/jobs/${encodeURIComponent(options.jobId)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } else {
    throw new Error('Either jobId or workDir is required');
  }

  if (!res.ok) {
    throw new Error('Failed to restore job from disk');
  }

  return res.json();
}
