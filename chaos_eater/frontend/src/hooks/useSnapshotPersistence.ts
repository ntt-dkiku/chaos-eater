import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ensureSession,
  listSnapshots,
  createSnapshot,
  updateSnapshot,
  getSnapshot,
  deleteSnapshot,
  renameSnapshot,
  clearSnapshots,
  SnapshotPayload,
  safeFormData,
} from '../lib/useSessionStore';
import type { Snapshot, FormData } from '../types';
import type { Message } from '../types';

/**
 * Data to persist in a snapshot
 */
export interface SnapshotData {
  messages: Message[];
  panelVisible: boolean;
  backendProjectPath: string | null;
  uploadedFiles: { name: string; size: number }[];
  formData: FormData;
  jobId?: string;
  jobWorkDir?: string;
}

/**
 * Options for useSnapshotPersistence hook
 */
export interface UseSnapshotPersistenceOptions {
  /** Session ID for IndexedDB */
  sessionId: string;
  /** Debounce interval for auto-persist in ms (default: 600) */
  debounceMs?: number;
  /** Callback when an error occurs */
  onError?: (error: string) => void;
}

/**
 * Return type for useSnapshotPersistence hook
 */
export interface UseSnapshotPersistenceReturn {
  snapshots: Snapshot[];
  currentSnapshotId: string | null;
  snapshotKey: string;
  isCreating: boolean;
  setCurrentSnapshotId: (id: string | null) => void;
  loadSnapshots: () => Promise<void>;
  createNewSnapshot: (title: string, data: SnapshotData) => Promise<Snapshot>;
  updateCurrentSnapshot: (data: SnapshotData) => void;
  loadSnapshot: (id: string) => Promise<Snapshot | undefined>;
  deleteSnapshotById: (id: string) => Promise<void>;
  renameSnapshotById: (id: string, title: string) => Promise<void>;
  clearAllSnapshots: () => Promise<void>;
}

/**
 * Hook for managing snapshot persistence with IndexedDB
 */
export function useSnapshotPersistence(
  options: UseSnapshotPersistenceOptions
): UseSnapshotPersistenceReturn {
  const { sessionId, debounceMs = 600, onError } = options;

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [currentSnapshotId, setCurrentSnapshotId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<SnapshotData | null>(null);

  // Generate snapshot key for UI
  const snapshotKey = currentSnapshotId ? `snap:${currentSnapshotId}` : 'none';

  // Load snapshots on mount
  const loadSnapshots = useCallback(async () => {
    if (!sessionId) return;
    try {
      await ensureSession(sessionId);
      const list = await listSnapshots(sessionId);
      // Order by createdAt (newest first)
      const sorted = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setSnapshots(sorted);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      onError?.(`Failed to load snapshots: ${message}`);
    }
  }, [sessionId, onError]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  // Create a new snapshot
  const createNewSnapshot = useCallback(
    async (title: string, data: SnapshotData): Promise<Snapshot> => {
      if (isCreating) {
        throw new Error('Snapshot creation already in progress');
      }

      setIsCreating(true);
      try {
        const payload: SnapshotPayload = {
          jobId: data.jobId,
          jobWorkDir: data.jobWorkDir,
          messages: data.messages,
          panelVisible: data.panelVisible,
          backendProjectPath: data.backendProjectPath,
          uploadedFilesMeta: data.uploadedFiles,
          formData: safeFormData(data.formData),
        };

        const snap = await createSnapshot(sessionId, title, payload);
        setCurrentSnapshotId(snap.id);
        setSnapshots((prev) => [snap, ...prev]);
        return snap;
      } finally {
        setIsCreating(false);
      }
    },
    [sessionId, isCreating]
  );

  // Update current snapshot with debounce
  const updateCurrentSnapshot = useCallback(
    (data: SnapshotData) => {
      if (!currentSnapshotId) return;

      pendingDataRef.current = data;

      if (persistDebounceRef.current) {
        clearTimeout(persistDebounceRef.current);
      }

      persistDebounceRef.current = setTimeout(async () => {
        const dataToSave = pendingDataRef.current;
        if (!dataToSave) return;

        try {
          await updateSnapshot(currentSnapshotId, {
            messages: dataToSave.messages,
            panelVisible: dataToSave.panelVisible,
            backendProjectPath: dataToSave.backendProjectPath,
            uploadedFilesMeta: dataToSave.uploadedFiles,
            formData: safeFormData(dataToSave.formData),
          });
        } catch (e) {
          console.error('snapshot update failed', e);
        }
      }, debounceMs);
    },
    [currentSnapshotId, debounceMs]
  );

  // Load a specific snapshot
  const loadSnapshot = useCallback(async (id: string): Promise<Snapshot | undefined> => {
    return getSnapshot(id);
  }, []);

  // Delete a snapshot
  const deleteSnapshotById = useCallback(
    async (id: string) => {
      await deleteSnapshot(id);
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
      if (currentSnapshotId === id) {
        setCurrentSnapshotId(null);
      }
    },
    [currentSnapshotId]
  );

  // Rename a snapshot
  const renameSnapshotById = useCallback(async (id: string, title: string) => {
    await renameSnapshot(id, title);
    setSnapshots((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  }, []);

  // Clear all snapshots
  const clearAllSnapshots = useCallback(async () => {
    await clearSnapshots(sessionId);
    setSnapshots([]);
    if (currentSnapshotId) {
      setCurrentSnapshotId(null);
    }
  }, [sessionId, currentSnapshotId]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (persistDebounceRef.current) {
        clearTimeout(persistDebounceRef.current);
        persistDebounceRef.current = null;
      }
    };
  }, []);

  return {
    snapshots,
    currentSnapshotId,
    snapshotKey,
    isCreating,
    setCurrentSnapshotId,
    loadSnapshots,
    createNewSnapshot,
    updateCurrentSnapshot,
    loadSnapshot,
    deleteSnapshotById,
    renameSnapshotById,
    clearAllSnapshots,
  };
}
