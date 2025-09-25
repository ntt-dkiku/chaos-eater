import React, { useRef, useState } from "react";

export default function OllamaPullWidget() {
  const [model, setModel] = useState("qwen2.5:7b");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("idle");
  const [lines, setLines] = useState([]);
  const [pulling, setPulling] = useState(false);
  const abortRef = useRef(null);

  const handleLine = (line) => {
    if (!line.trim()) return;
    setLines((prev) => [...prev, line]);

    try {
      const obj = JSON.parse(line);
      if (obj.status) setStatus(obj.status);
      if (obj.percentage) {
        let pct = obj.percentage <= 1 ? obj.percentage * 100 : obj.percentage;
        setProgress(Math.min(100, pct));
      }
      if (obj.status === "success" || obj.done) {
        setProgress(100);
        setStatus("success");
        setPulling(false);
      }
    } catch {
      // ignore parse errors
    }
  };

  const streamPull = async () => {
    setProgress(0);
    setStatus("starting...");
    setLines([]);
    setPulling(true);

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    const res = await fetch("http://localhost:8000/ollama/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: abortRef.current.signal,
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() || "";
      for (const part of parts) handleLine(part);
    }
  };

  return (
    <div>
      <input
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder="Enter model (e.g. qwen2.5:7b)"
      />
      <button onClick={streamPull} disabled={pulling}>
        {pulling ? "Pulling..." : "Pull"}
      </button>
      <div>Status: {status}</div>
      <progress value={progress} max={100}></progress>
      <pre>{lines.join("\n")}</pre>
    </div>
  );
}