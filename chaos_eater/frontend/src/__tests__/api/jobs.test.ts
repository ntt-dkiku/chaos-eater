import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createJob,
  pauseJob,
  resumeJob,
  deleteJob,
  purgeJob,
  getJob,
  restoreJob,
} from '../../api/jobs';
import type { JobCreatePayload } from '../../api/jobs';

describe('jobs API', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  const mockPayload: JobCreatePayload = {
    project_path: '/tmp/project',
    ce_instructions: 'Run tests',
    kube_context: 'test-cluster',
    project_name: 'test-project',
    work_dir: null,
    clean_cluster_before_run: true,
    clean_cluster_after_run: true,
    is_new_deployment: true,
    model_name: 'openai/gpt-4',
    temperature: 0.0,
    seed: 42,
    max_num_steadystates: 2,
    max_retries: 3,
    namespace: 'chaos-eater',
  };

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('createJob', () => {
    it('should create job successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ job_id: 'job-123', work_dir: '/tmp/work' }),
      });

      const result = await createJob('http://localhost:8000', mockPayload);
      expect(result).toEqual({ job_id: 'job-123', work_dir: '/tmp/work' });
    });

    it('should include API key header when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ job_id: 'job-123', work_dir: '/tmp/work' }),
      });

      await createJob('http://localhost:8000', mockPayload, { apiKey: 'sk-123' });

      expect(mockFetch.mock.calls[0][1].headers).toHaveProperty('x-api-key', 'sk-123');
    });

    it('should include model header when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ job_id: 'job-123', work_dir: '/tmp/work' }),
      });

      await createJob('http://localhost:8000', mockPayload, { model: 'gpt-4' });

      expect(mockFetch.mock.calls[0][1].headers).toHaveProperty('x-model', 'gpt-4');
    });

    it('should throw error on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ detail: 'Invalid payload' }),
      });

      await expect(createJob('http://localhost:8000', mockPayload)).rejects.toThrow(
        'Invalid payload'
      );
    });
  });

  describe('pauseJob', () => {
    it('should pause job successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ current_phase: 'analysis' }),
      });

      const result = await pauseJob('http://localhost:8000', 'job-123');
      expect(result).toEqual({ current_phase: 'analysis' });
    });

    it('should throw error for not found job', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      });

      await expect(pauseJob('http://localhost:8000', 'job-123')).rejects.toThrow('Job not found');
    });

    it('should throw error for invalid state', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ detail: 'Job already paused' }),
      });

      await expect(pauseJob('http://localhost:8000', 'job-123')).rejects.toThrow('Job already paused');
    });
  });

  describe('resumeJob', () => {
    it('should resume job successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ resume_from: 'analysis', resume_from_agent: 'agent-1' }),
      });

      const result = await resumeJob('http://localhost:8000', 'job-123');
      expect(result).toEqual({ resume_from: 'analysis', resume_from_agent: 'agent-1' });
    });

    it('should include API key when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await resumeJob('http://localhost:8000', 'job-123', { apiKey: 'sk-123' });

      expect(mockFetch.mock.calls[0][1].headers).toHaveProperty('x-api-key', 'sk-123');
    });

    it('should include feedback when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ has_feedback: true }),
      });

      const result = await resumeJob('http://localhost:8000', 'job-123', { feedback: 'Please improve the output' });

      expect(result.has_feedback).toBe(true);
      expect(mockFetch.mock.calls[0][1].body).toContain('Please improve the output');
    });

    it('should throw error on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ detail: 'Cannot resume' }),
      });

      await expect(resumeJob('http://localhost:8000', 'job-123')).rejects.toThrow('Cannot resume');
    });
  });

  describe('deleteJob', () => {
    it('should delete job successfully', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await expect(deleteJob('http://localhost:8000', 'job-123')).resolves.toBeUndefined();
    });

    it('should encode jobId in URL', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await deleteJob('http://localhost:8000', 'job/with/slashes');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/jobs/job%2Fwith%2Fslashes',
        expect.anything()
      );
    });
  });

  describe('purgeJob', () => {
    it('should purge job successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ deleted_files: [{ path: '/tmp/file', deleted: true }] }),
      });

      const result = await purgeJob('http://localhost:8000', 'job-123');
      expect(result.deleted_files).toHaveLength(1);
    });

    it('should throw error on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ detail: 'Purge failed' }),
      });

      await expect(purgeJob('http://localhost:8000', 'job-123')).rejects.toThrow('Purge failed');
    });
  });

  describe('getJob', () => {
    it('should get job status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'running', current_phase: 'analysis' }),
      });

      const result = await getJob('http://localhost:8000', 'job-123');
      expect(result).toEqual({ status: 'running', current_phase: 'analysis' });
    });

    it('should throw error for not found job', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(getJob('http://localhost:8000', 'job-123')).rejects.toThrow('Job not found');
    });
  });

  describe('restoreJob', () => {
    it('should restore job by workDir', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ job_id: 'job-123', current_phase: 'analysis' }),
      });

      const result = await restoreJob('http://localhost:8000', { workDir: '/tmp/work' });
      expect(result.job_id).toBe('job-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/jobs/restore',
        expect.objectContaining({
          body: JSON.stringify({ work_dir: '/tmp/work' }),
        })
      );
    });

    it('should restore job by jobId', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ job_id: 'job-123' }),
      });

      const result = await restoreJob('http://localhost:8000', { jobId: 'job-123' });
      expect(result.job_id).toBe('job-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/jobs/job-123/restore',
        expect.anything()
      );
    });

    it('should throw error when neither jobId nor workDir provided', async () => {
      await expect(restoreJob('http://localhost:8000', {})).rejects.toThrow(
        'Either jobId or workDir is required'
      );
    });

    it('should throw error on failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      await expect(restoreJob('http://localhost:8000', { jobId: 'job-123' })).rejects.toThrow(
        'Failed to restore job from disk'
      );
    });
  });
});
