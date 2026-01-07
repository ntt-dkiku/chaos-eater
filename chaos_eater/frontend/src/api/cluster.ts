import type { CleanClusterParams, CleanClusterResponse } from '../types';

/**
 * Cluster list response from /clusters endpoint
 */
export interface ClustersResponse {
  all: string[];
  used: string[];
  available: string[];
  mine: string | null;
}

/**
 * Cluster claim response from /clusters/claim endpoint
 */
export interface ClusterClaimResponse {
  cluster: string;
}

/**
 * Fetch list of clusters with session info
 */
export async function fetchClusters(
  apiBase: string,
  sessionId: string
): Promise<ClustersResponse> {
  const q = encodeURIComponent(sessionId);
  const res = await fetch(`${apiBase}/clusters?session_id=${q}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Claim a cluster for this session
 */
export async function claimCluster(
  apiBase: string,
  sessionId: string,
  preferred?: string
): Promise<ClusterClaimResponse> {
  const res = await fetch(`${apiBase}/clusters/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, preferred }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Release the currently claimed cluster
 */
export async function releaseCluster(
  apiBase: string,
  sessionId: string
): Promise<void> {
  const res = await fetch(`${apiBase}/clusters/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || `HTTP ${res.status}`);
  }
}

/**
 * Send beacon to release cluster on page unload
 */
export function releaseClusterBeacon(apiBase: string, sessionId: string): void {
  navigator.sendBeacon?.(
    `${apiBase}/clusters/release`,
    new Blob([JSON.stringify({ session_id: sessionId })], { type: 'application/json' })
  );
}

export async function cleanCluster(
  API_BASE: string,
  params: CleanClusterParams
): Promise<CleanClusterResponse> {
  const { kube_context, namespace, project_name } = params;

  const res = await fetch(`${API_BASE}/clusters/clean`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kube_context,
      namespace,
      project_name,
    }),
  });

  const json = await res.json().catch(() => ({} as CleanClusterResponse));

  if (!res.ok || json.cleaned !== true) {
    const msg = json?.error || `Clean failed (${res.status})`;
    throw new Error(msg);
  }

  return json;
}
