import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClusterManagement } from '../../hooks/useClusterManagement';

describe('useClusterManagement', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;
  const originalSendBeacon = navigator.sendBeacon;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
    navigator.sendBeacon = vi.fn();
    vi.useFakeTimers();

    // Mock localStorage
    const storage: Record<string, string> = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => storage[key] || null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      storage[key] = value;
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    navigator.sendBeacon = originalSendBeacon;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const mockClustersResponse = {
    all: ['cluster-1', 'cluster-2'],
    used: ['cluster-1'],
    available: ['cluster-2'],
    mine: null,
  };

  it('should load clusters on mount', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockClustersResponse),
    });

    const { result } = renderHook(() =>
      useClusterManagement({ apiBase: 'http://localhost:8000' })
    );

    expect(result.current.loading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.clusters).toEqual(mockClustersResponse);
    expect(result.current.error).toBeNull();
  });

  it('should poll clusters at interval', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockClustersResponse),
    });

    renderHook(() =>
      useClusterManagement({ apiBase: 'http://localhost:8000', pollInterval: 1000 })
    );

    // Initial load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // After polling interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should handle load error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Server error'),
    });

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useClusterManagement({ apiBase: 'http://localhost:8000', onError })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('Server error');
    expect(onError).toHaveBeenCalledWith('Server error');
  });

  it('should claim cluster', async () => {
    // Initial load
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockClustersResponse),
    });

    const onClusterClaimed = vi.fn();
    const { result } = renderHook(() =>
      useClusterManagement({
        apiBase: 'http://localhost:8000',
        onClusterClaimed,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Claim cluster
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ cluster: 'cluster-2' }),
    });

    // Reload after claim
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ...mockClustersResponse, mine: 'cluster-2' }),
    });

    await act(async () => {
      await result.current.claimCluster('cluster-2');
    });

    expect(onClusterClaimed).toHaveBeenCalledWith('cluster-2');
  });

  it('should handle claim error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockClustersResponse),
    });

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useClusterManagement({ apiBase: 'http://localhost:8000', onError })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () => Promise.resolve('Cluster already claimed'),
    });

    let thrownError: Error | null = null;
    await act(async () => {
      try {
        await result.current.claimCluster('cluster-1');
      } catch (e) {
        thrownError = e as Error;
      }
    });

    expect(thrownError?.message).toBe('Cluster already claimed');
    expect(onError).toHaveBeenCalledWith('Cluster already claimed');
  });

  it('should release cluster', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockClustersResponse),
    });

    const { result } = renderHook(() =>
      useClusterManagement({ apiBase: 'http://localhost:8000' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await act(async () => {
      await result.current.releaseCluster();
    });

    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://localhost:8000/clusters/release',
      expect.anything()
    );
  });

  it('should not throw on release error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockClustersResponse),
    });

    const { result } = renderHook(() =>
      useClusterManagement({ apiBase: 'http://localhost:8000' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Release failed'),
    });

    // Should not throw
    await act(async () => {
      await result.current.releaseCluster();
    });
  });

  it('should have session ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockClustersResponse),
    });

    const { result } = renderHook(() =>
      useClusterManagement({ apiBase: 'http://localhost:8000' })
    );

    expect(result.current.sessionId).toBeTruthy();
    expect(typeof result.current.sessionId).toBe('string');
  });

  it('should setup beforeunload handler', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockClustersResponse),
    });

    renderHook(() => useClusterManagement({ apiBase: 'http://localhost:8000' }));

    expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('should not update clusters if data unchanged', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockClustersResponse),
    });

    const { result } = renderHook(() =>
      useClusterManagement({ apiBase: 'http://localhost:8000', pollInterval: 1000 })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const firstClusters = result.current.clusters;

    // Poll again with same data
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Should be the same object reference (not updated)
    expect(result.current.clusters).toBe(firstClusters);
  });
});
