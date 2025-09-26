// components/StatsPanel.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/** Format helpers */
function formatNumber(n) {
  try {
    return new Intl.NumberFormat().format(n || 0);
  } catch {
    return String(n || 0);
  }
}
function formatDuration(sec) {
  if (sec == null) return "-";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m ${ss}s`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

/**
 * Live usage stats panel for a job.
 * - Opens WS to /jobs/{jobId}/stats/stream for incremental updates.
 * - Falls back to one-shot GET /jobs/{jobId}/stats if WS fails.
 * - Keeps independent state per "snapshotKey" (e.g., jobId + snapshot id).
 */
export default function StatsPanel({
  apiBase,
  jobId,
  snapshotKey: snapshotKeyProp, // pass e.g. `${jobId}:${selectedSnapshotId}`
  collapsed = false
}) {
  // Use provided snapshotKey or fallback to jobId so each key keeps its own state
  const key = snapshotKeyProp ?? jobId;

  // UI state
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);

  // Refs for WS, reconnect timer, cache, and "generation" guard
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  // Map<key, { snapshot, error }>
  const cacheRef = useRef(new Map());

  // Bump this number when key/apiBase/jobId changes to invalidate stale async results
  const genRef = useRef(0);

  /** Close WebSocket safely */
  function closeWS() {
    try {
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;
    setConnected(false);
  }

  /** One-shot REST fetch (guarded by generation id) */
  async function fetchOnce(gen) {
    if (!jobId) return;
    try {
      const res = await fetch(`${apiBase}/jobs/${encodeURIComponent(jobId)}/stats`);
      if (gen !== genRef.current) return; // drop stale result
      if (!res.ok) {
        const { detail } = await res.json().catch(() => ({}));
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSnapshot(data);
      setError(null);
      // cache per key
      cacheRef.current.set(key, { snapshot: data, error: null });
    } catch (e) {
      if (gen !== genRef.current) return; // drop stale result
      const msg = e.message || String(e);
      setError(msg);
      const prev = cacheRef.current.get(key)?.snapshot ?? null;
      cacheRef.current.set(key, { snapshot: prev, error: msg });
    }
  }

  /** Open WebSocket for live updates (guarded by generation id) */
  function openWS(gen) {
    if (!jobId) return;

    const url = (() => {
      try {
        const u = new URL(apiBase);
        u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
        u.pathname = `/jobs/${encodeURIComponent(jobId)}/stats/stream`;
        return u.toString();
      } catch {
        return apiBase.replace(/^http/, "ws") + `/jobs/${encodeURIComponent(jobId)}/stats/stream`;
      }
    })();

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (gen !== genRef.current) return;
      setConnected(true);
      setError(null);
    };

    ws.onmessage = (ev) => {
      if (gen !== genRef.current) return; // ignore messages from stale WS
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "stats" && msg.snapshot) {
          setSnapshot(msg.snapshot);
          cacheRef.current.set(key, { snapshot: msg.snapshot, error: null });
        } else if (msg.type === "warning") {
          const warn = msg.detail || "warning";
          setError(warn);
          const prev = cacheRef.current.get(key)?.snapshot ?? null;
          cacheRef.current.set(key, { snapshot: prev, error: warn });
        } else if (msg.type === "error") {
          const err = msg.detail || "error";
          setError(err);
          const prev = cacheRef.current.get(key)?.snapshot ?? null;
          cacheRef.current.set(key, { snapshot: prev, error: err });
        }
      } catch {
        // ignore parse errors for robustness
      }
    };

    ws.onerror = () => {
      if (gen !== genRef.current) return;
      setConnected(false);
      setError("WebSocket error");
      const prev = cacheRef.current.get(key)?.snapshot ?? null;
      cacheRef.current.set(key, { snapshot: prev, error: "WebSocket error" });
    };

    ws.onclose = () => {
      if (gen !== genRef.current) return; // do not reconnect for stale generation
      setConnected(false);
      reconnectTimer.current = setTimeout(() => {
        openWS(genRef.current); // reconnect only for current generation
      }, 2000);
    };
  }

  /** React to key/apiBase/jobId change */
  useEffect(() => {
    // advance generation to invalidate in-flight async results for previous key
    genRef.current += 1;
    const myGen = genRef.current;

    // restore from cache or reset
    const cached = cacheRef.current.get(key);
    setSnapshot(cached?.snapshot ?? null);
    setError(cached?.error ?? null);
    setConnected(false);

    // cleanup previous WS and timers
    closeWS();

    if (!jobId) return;

    // first paint via REST, then upgrade to WS
    fetchOnce(myGen).finally(() => {
      openWS(myGen);
    });

    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      closeWS();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, jobId, apiBase]);

  // Derived values for rendering
  const total = snapshot?.total || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const elapsed = snapshot?.time?.elapsed_sec ?? null;
  const firstTs = snapshot?.time?.first_ts ?? null;
  const lastTs = snapshot?.time?.last_ts ?? null;

  const byAgent = useMemo(() => snapshot?.by_agent || [], [snapshot]);
  const topAgents = byAgent.slice(0, 5);

  return (
    <div
      style={{
        padding: "0px",
        display: collapsed ? "none" : "block",
      }}
      aria-live="polite"
    >
      {/* Totals header with Live/Idle at the right */}
      <div
        style={{
          padding: "12px",
          background: "transparent",
          border: "1px solid #374151",
          borderRadius: 8,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <div style={{ fontSize: 12, color: "#9ca3af", fontWeight: 500 }}>Totals</div>
          <div style={{ marginLeft: "auto", fontSize: 11, color: connected ? "#84cc16" : "#9ca3af" }}>
            {connected ? "Live" : "Idle"}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>Input tokens</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{formatNumber(total.input_tokens)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>Output tokens</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{formatNumber(total.output_tokens)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>Total tokens</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{formatNumber(total.total_tokens)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>Elapsed</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{formatDuration(elapsed)}</div>
          </div>
        </div>

        <div style={{ marginTop: 8, fontSize: 11, color: "#6b7280" }}>
          {firstTs != null && lastTs != null
            ? `Window: ${new Date(firstTs * 1000).toLocaleTimeString()} – ${new Date(
                lastTs * 1000
              ).toLocaleTimeString()}`
            : "Window: -"}
        </div>

        {/* Compact error row under the totals card */}
        {error && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: "#ef4444",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={error}
          >
            {error}
          </div>
        )}
      </div>

      {/* By Agent (top 5) */}
      <div
        style={{
          padding: "12px",
          background: "transparent",
          border: "1px solid #374151",
          borderRadius: 8,
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6, fontWeight: 500 }}>
          By Agent (top 5)
        </div>
        {topAgents.length === 0 ? (
          <div style={{ fontSize: 12, color: "#6b7280" }}>No data yet</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {topAgents.map((row) => (
              <div
                key={row.agent_name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 12,
                  padding: "6px 8px",
                  background: "transparent",
                  border: "1px solid #1f2937",
                  borderRadius: 6,
                }}
                title={`${row.agent_name}`}
              >
                <span style={{ color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.agent_name}
                </span>
                <span style={{ color: "#9ca3af" }}>
                  {formatNumber(row.token_usage.total_tokens)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}