import { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchClusters,
  claimCluster as claimClusterApi,
  releaseCluster as releaseClusterApi,
  releaseClusterBeacon,
  ClustersResponse,
} from '../api/cluster';

/**
 * Options for useClusterManagement hook
 */
export interface UseClusterManagementOptions {
  /** API base URL */
  apiBase: string;
  /** Polling interval in ms (default: 60000) */
  pollInterval?: number;
  /** Callback when a cluster is claimed */
  onClusterClaimed?: (cluster: string) => void;
  /** Callback when an error occurs */
  onError?: (error: string) => void;
}

/**
 * Return type for useClusterManagement hook
 */
export interface UseClusterManagementReturn {
  clusters: ClustersResponse;
  loading: boolean;
  error: string | null;
  sessionId: string;
  loadClusters: () => Promise<void>;
  claimCluster: (preferred?: string) => Promise<void>;
  releaseCluster: () => Promise<void>;
}

const DEFAULT_CLUSTERS: ClustersResponse = {
  all: [],
  used: [],
  available: [],
  mine: null,
};

/**
 * Get or create a session ID stored in localStorage
 */
function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return '';

  let sessionId = localStorage.getItem('ce_session_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem('ce_session_id', sessionId);
  }
  return sessionId;
}

/**
 * Hook for managing Kubernetes cluster selection and claiming
 */
export function useClusterManagement(
  options: UseClusterManagementOptions
): UseClusterManagementReturn {
  const { apiBase, pollInterval = 60000, onClusterClaimed, onError } = options;

  const [clusters, setClusters] = useState<ClustersResponse>(DEFAULT_CLUSTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef<string>(getOrCreateSessionId());

  const loadClusters = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchClusters(apiBase, sessionIdRef.current);
      setClusters(prev => {
        // Only update if data changed to prevent unnecessary re-renders
        return JSON.stringify(prev) === JSON.stringify(data) ? prev : data;
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  }, [apiBase, onError]);

  const claimCluster = useCallback(async (preferred?: string) => {
    try {
      const data = await claimClusterApi(apiBase, sessionIdRef.current, preferred);
      onClusterClaimed?.(data.cluster);
      await loadClusters();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      onError?.(message);
      throw e;
    }
  }, [apiBase, loadClusters, onClusterClaimed, onError]);

  const releaseCluster = useCallback(async () => {
    try {
      await releaseClusterApi(apiBase, sessionIdRef.current);
    } catch (_) {
      // Ignore errors on release
    }
  }, [apiBase]);

  // Initial load and polling
  useEffect(() => {
    loadClusters();
    const id = setInterval(loadClusters, pollInterval);
    return () => clearInterval(id);
  }, [loadClusters, pollInterval]);

  // Release cluster on page unload
  useEffect(() => {
    const handler = () => {
      releaseClusterBeacon(apiBase, sessionIdRef.current);
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [apiBase]);

  return {
    clusters,
    loading,
    error,
    sessionId: sessionIdRef.current,
    loadClusters,
    claimCluster,
    releaseCluster,
  };
}
