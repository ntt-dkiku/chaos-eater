import React, { useRef, useState } from 'react';

type PullStatus = 'idle' | 'starting...' | 'success' | string;

interface OllamaPullLine {
  status?: string;
  percentage?: number;
  done?: boolean;
}

export default function OllamaPullWidget(): React.ReactElement {
  const [model, setModel] = useState('qwen2.5:7b');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<PullStatus>('idle');
  const [lines, setLines] = useState<string[]>([]);
  const [pulling, setPulling] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleLine = (line: string): void => {
    if (!line.trim()) return;
    setLines((prev) => [...prev, line]);

    try {
      const obj: OllamaPullLine = JSON.parse(line);
      if (obj.status) setStatus(obj.status);
      if (obj.percentage !== undefined) {
        const pct = obj.percentage <= 1 ? obj.percentage * 100 : obj.percentage;
        setProgress(Math.min(100, pct));
      }
      if (obj.status === 'success' || obj.done) {
        setProgress(100);
        setStatus('success');
        setPulling(false);
      }
    } catch {
      // ignore parse errors
    }
  };

  const streamPull = async (): Promise<void> => {
    setProgress(0);
    setStatus('starting...');
    setLines([]);
    setPulling(true);

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch('http://localhost:8000/ollama/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: abortRef.current.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) {
        setPulling(false);
        setStatus('idle');
        return;
      }

      const decoder = new TextDecoder('utf-8');
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n');
        buf = parts.pop() || '';
        for (const part of parts) handleLine(part);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setStatus('idle');
      }
      setPulling(false);
    }
  };

  return (
    <div>
      <input
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder="Enter model (e.g. qwen2.5:7b)"
        aria-label="Model name"
      />
      <button onClick={streamPull} disabled={pulling}>
        {pulling ? 'Pulling...' : 'Pull'}
      </button>
      <div>Status: {status}</div>
      <progress value={progress} max={100}></progress>
      <pre>{lines.join('\n')}</pre>
    </div>
  );
}
