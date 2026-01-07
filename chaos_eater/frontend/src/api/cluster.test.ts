import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanCluster } from './cluster';

describe('cleanCluster', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should call API with correct parameters', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ cleaned: true }),
    });

    await cleanCluster('http://localhost:8000', {
      kube_context: 'my-cluster',
      namespace: 'default',
      project_name: 'test-project',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/clusters/clean',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kube_context: 'my-cluster',
          namespace: 'default',
          project_name: 'test-project',
        }),
      }
    );
  });

  it('should return response on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ cleaned: true }),
    });

    const result = await cleanCluster('http://localhost:8000', {
      kube_context: 'my-cluster',
      namespace: 'default',
      project_name: 'test-project',
    });

    expect(result).toEqual({ cleaned: true });
  });

  it('should throw error when API returns error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    });

    await expect(
      cleanCluster('http://localhost:8000', {
        kube_context: 'my-cluster',
        namespace: 'default',
        project_name: 'test-project',
      })
    ).rejects.toThrow('Internal server error');
  });

  it('should throw error when cleaned is false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ cleaned: false }),
    });

    await expect(
      cleanCluster('http://localhost:8000', {
        kube_context: 'my-cluster',
        namespace: 'default',
        project_name: 'test-project',
      })
    ).rejects.toThrow('Clean failed');
  });

  it('should handle JSON parse error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('Invalid JSON')),
    });

    await expect(
      cleanCluster('http://localhost:8000', {
        kube_context: 'my-cluster',
        namespace: 'default',
        project_name: 'test-project',
      })
    ).rejects.toThrow('Clean failed (500)');
  });
});
