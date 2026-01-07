import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cleanCluster,
  fetchClusters,
  claimCluster,
  releaseCluster,
  releaseClusterBeacon,
} from '../../api/cluster';

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

describe('fetchClusters', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should fetch clusters with session ID', async () => {
    const mockData = {
      all: ['cluster-1', 'cluster-2'],
      used: ['cluster-1'],
      available: ['cluster-2'],
      mine: 'cluster-1',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const result = await fetchClusters('http://localhost:8000', 'test-session-id');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/clusters?session_id=test-session-id',
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    );
    expect(result).toEqual(mockData);
  });

  it('should URL encode session ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ all: [], used: [], available: [], mine: null }),
    });

    await fetchClusters('http://localhost:8000', 'session/with/slashes');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/clusters?session_id=session%2Fwith%2Fslashes',
      expect.anything()
    );
  });

  it('should throw error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Server error'),
    });

    await expect(fetchClusters('http://localhost:8000', 'test')).rejects.toThrow('Server error');
  });
});

describe('claimCluster', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should claim cluster with session ID and preferred', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ cluster: 'my-cluster' }),
    });

    const result = await claimCluster('http://localhost:8000', 'test-session', 'preferred-cluster');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/clusters/claim',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'test-session', preferred: 'preferred-cluster' }),
      }
    );
    expect(result).toEqual({ cluster: 'my-cluster' });
  });

  it('should claim cluster without preferred', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ cluster: 'any-cluster' }),
    });

    await claimCluster('http://localhost:8000', 'test-session');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.preferred).toBeUndefined();
  });

  it('should throw error on claim failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () => Promise.resolve('Cluster already claimed'),
    });

    await expect(claimCluster('http://localhost:8000', 'test', 'cluster')).rejects.toThrow(
      'Cluster already claimed'
    );
  });
});

describe('releaseCluster', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should release cluster with session ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await releaseCluster('http://localhost:8000', 'test-session');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/clusters/release',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'test-session' }),
      }
    );
  });

  it('should throw error on release failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Release failed'),
    });

    await expect(releaseCluster('http://localhost:8000', 'test')).rejects.toThrow('Release failed');
  });
});

describe('releaseClusterBeacon', () => {
  const originalSendBeacon = navigator.sendBeacon;

  beforeEach(() => {
    navigator.sendBeacon = vi.fn();
  });

  afterEach(() => {
    navigator.sendBeacon = originalSendBeacon;
  });

  it('should send beacon with session ID', () => {
    releaseClusterBeacon('http://localhost:8000', 'test-session');

    expect(navigator.sendBeacon).toHaveBeenCalledWith(
      'http://localhost:8000/clusters/release',
      expect.any(Blob)
    );
  });
});
