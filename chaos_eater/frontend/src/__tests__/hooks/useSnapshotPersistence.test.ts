import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSnapshotPersistence, SnapshotData } from '../../hooks/useSnapshotPersistence';
import type { Snapshot } from '../../types';

// Create mocks
const mockEnsureSession = vi.fn();
const mockListSnapshots = vi.fn();
const mockCreateSnapshot = vi.fn();
const mockUpdateSnapshot = vi.fn();
const mockGetSnapshot = vi.fn();
const mockDeleteSnapshot = vi.fn();
const mockRenameSnapshot = vi.fn();
const mockClearSnapshots = vi.fn();
const mockSafeFormData = vi.fn();

// Mock the useSessionStore module
vi.mock('../../lib/useSessionStore', () => ({
  ensureSession: (...args: unknown[]) => mockEnsureSession(...args),
  listSnapshots: (...args: unknown[]) => mockListSnapshots(...args),
  createSnapshot: (...args: unknown[]) => mockCreateSnapshot(...args),
  updateSnapshot: (...args: unknown[]) => mockUpdateSnapshot(...args),
  getSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
  deleteSnapshot: (...args: unknown[]) => mockDeleteSnapshot(...args),
  renameSnapshot: (...args: unknown[]) => mockRenameSnapshot(...args),
  clearSnapshots: (...args: unknown[]) => mockClearSnapshots(...args),
  safeFormData: (...args: unknown[]) => mockSafeFormData(...args),
}));

describe('useSnapshotPersistence', () => {
  const mockSnapshots: Snapshot[] = [
    {
      id: 'snap-1',
      sessionId: 'test-session',
      title: 'Snapshot 1',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [],
      panelVisible: false,
      backendProjectPath: null,
      uploadedFilesMeta: [],
      formData: { apiKey: '' } as Snapshot['formData'],
    },
    {
      id: 'snap-2',
      sessionId: 'test-session',
      title: 'Snapshot 2',
      createdAt: 2000,
      updatedAt: 2000,
      messages: [],
      panelVisible: true,
      backendProjectPath: '/path',
      uploadedFilesMeta: [],
      formData: { apiKey: '' } as Snapshot['formData'],
    },
  ];

  const mockSnapshotData: SnapshotData = {
    messages: [{ type: 'text', role: 'user', content: 'Hello' }],
    panelVisible: true,
    backendProjectPath: '/test/path',
    uploadedFiles: [{ name: 'file.txt', size: 100 }],
    formData: { apiKey: 'secret', model: 'gpt-4' } as SnapshotData['formData'],
    jobId: 'job-123',
    jobWorkDir: '/work/dir',
  };

  beforeEach(() => {
    vi.useFakeTimers();

    // Reset all mocks
    mockEnsureSession.mockReset().mockResolvedValue(undefined);
    mockListSnapshots.mockReset().mockResolvedValue([]);
    mockCreateSnapshot.mockReset().mockImplementation(async (sessionId, title, payload) => ({
      id: `${sessionId}-${Date.now()}`,
      sessionId,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...payload,
    }));
    mockUpdateSnapshot.mockReset().mockResolvedValue(undefined);
    mockGetSnapshot.mockReset().mockResolvedValue(undefined);
    mockDeleteSnapshot.mockReset().mockResolvedValue(undefined);
    mockRenameSnapshot.mockReset().mockResolvedValue(undefined);
    mockClearSnapshots.mockReset().mockResolvedValue(undefined);
    mockSafeFormData.mockReset().mockImplementation((fd) => ({ ...fd, apiKey: '' }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should initialize with empty snapshots', async () => {
    const { result } = renderHook(() =>
      useSnapshotPersistence({ sessionId: 'test-session' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.snapshots).toEqual([]);
    expect(result.current.currentSnapshotId).toBeNull();
    expect(result.current.isCreating).toBe(false);
  });

  it('should load snapshots on mount', async () => {
    mockListSnapshots.mockResolvedValue(mockSnapshots);

    const { result } = renderHook(() =>
      useSnapshotPersistence({ sessionId: 'test-session' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockEnsureSession).toHaveBeenCalledWith('test-session');
    expect(mockListSnapshots).toHaveBeenCalledWith('test-session');
    // Should be sorted by createdAt descending
    expect(result.current.snapshots[0].id).toBe('snap-2');
    expect(result.current.snapshots[1].id).toBe('snap-1');
  });

  it('should create a new snapshot', async () => {
    const { result } = renderHook(() =>
      useSnapshotPersistence({ sessionId: 'test-session' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    let createdSnap: Snapshot | undefined;
    await act(async () => {
      createdSnap = await result.current.createNewSnapshot('New Snapshot', mockSnapshotData);
    });

    expect(mockCreateSnapshot).toHaveBeenCalledWith(
      'test-session',
      'New Snapshot',
      expect.objectContaining({
        messages: mockSnapshotData.messages,
        panelVisible: true,
        backendProjectPath: '/test/path',
        jobId: 'job-123',
        jobWorkDir: '/work/dir',
      })
    );
    expect(createdSnap).toBeDefined();
    expect(result.current.currentSnapshotId).toBe(createdSnap?.id);
    expect(result.current.snapshots.length).toBe(1);
  });

  it('should update current snapshot with debounce', async () => {
    const { result } = renderHook(() =>
      useSnapshotPersistence({ sessionId: 'test-session', debounceMs: 100 })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Create a snapshot first
    await act(async () => {
      await result.current.createNewSnapshot('Test', mockSnapshotData);
    });

    // Clear the mock after creation
    mockUpdateSnapshot.mockClear();

    // Update should be debounced
    act(() => {
      result.current.updateCurrentSnapshot({ ...mockSnapshotData, panelVisible: false });
    });

    expect(mockUpdateSnapshot).not.toHaveBeenCalled();

    // After debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(mockUpdateSnapshot).toHaveBeenCalled();
  });

  it('should not update when no current snapshot', async () => {
    const { result } = renderHook(() =>
      useSnapshotPersistence({ sessionId: 'test-session' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.updateCurrentSnapshot(mockSnapshotData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockUpdateSnapshot).not.toHaveBeenCalled();
  });

  it('should delete a snapshot', async () => {
    mockListSnapshots.mockResolvedValue(mockSnapshots);

    const { result } = renderHook(() =>
      useSnapshotPersistence({ sessionId: 'test-session' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.snapshots.length).toBe(2);

    await act(async () => {
      await result.current.deleteSnapshotById('snap-1');
    });

    expect(mockDeleteSnapshot).toHaveBeenCalledWith('snap-1');
    expect(result.current.snapshots.length).toBe(1);
    expect(result.current.snapshots[0].id).toBe('snap-2');
  });

  it('should clear current snapshot ID when deleting current', async () => {
    mockListSnapshots.mockResolvedValue(mockSnapshots);

    const { result } = renderHook(() =>
      useSnapshotPersistence({ sessionId: 'test-session' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setCurrentSnapshotId('snap-1');
    });

    expect(result.current.currentSnapshotId).toBe('snap-1');

    await act(async () => {
      await result.current.deleteSnapshotById('snap-1');
    });

    expect(result.current.currentSnapshotId).toBeNull();
  });

  it('should rename a snapshot', async () => {
    mockListSnapshots.mockResolvedValue(mockSnapshots);

    const { result } = renderHook(() =>
      useSnapshotPersistence({ sessionId: 'test-session' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await result.current.renameSnapshotById('snap-1', 'New Title');
    });

    expect(mockRenameSnapshot).toHaveBeenCalledWith('snap-1', 'New Title');
    expect(result.current.snapshots.find((s) => s.id === 'snap-1')?.title).toBe('New Title');
  });

  it('should clear all snapshots', async () => {
    mockListSnapshots.mockResolvedValue(mockSnapshots);

    const { result } = renderHook(() =>
      useSnapshotPersistence({ sessionId: 'test-session' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setCurrentSnapshotId('snap-1');
    });

    await act(async () => {
      await result.current.clearAllSnapshots();
    });

    expect(mockClearSnapshots).toHaveBeenCalledWith('test-session');
    expect(result.current.snapshots.length).toBe(0);
    expect(result.current.currentSnapshotId).toBeNull();
  });

  it('should generate correct snapshot key', async () => {
    const { result } = renderHook(() =>
      useSnapshotPersistence({ sessionId: 'test-session' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.snapshotKey).toBe('none');

    act(() => {
      result.current.setCurrentSnapshotId('snap-123');
    });

    expect(result.current.snapshotKey).toBe('snap:snap-123');
  });

  it('should load a specific snapshot', async () => {
    const mockSnap = mockSnapshots[0];
    mockGetSnapshot.mockResolvedValue(mockSnap);

    const { result } = renderHook(() =>
      useSnapshotPersistence({ sessionId: 'test-session' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    let loadedSnap: Snapshot | undefined;
    await act(async () => {
      loadedSnap = await result.current.loadSnapshot('snap-1');
    });

    expect(mockGetSnapshot).toHaveBeenCalledWith('snap-1');
    expect(loadedSnap).toEqual(mockSnap);
  });

  it('should call safeFormData when creating snapshot', async () => {
    const { result } = renderHook(() =>
      useSnapshotPersistence({ sessionId: 'test-session' })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await result.current.createNewSnapshot('Test', mockSnapshotData);
    });

    expect(mockSafeFormData).toHaveBeenCalled();
  });
});
