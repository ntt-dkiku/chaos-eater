/**
 * Result of verifying an Ollama model
 */
export interface VerifyResult {
  exists: boolean;
  short: string;
}

/**
 * Progress event from Ollama pull
 */
export interface PullProgressEvent {
  status?: string;
  completed?: number;
  total?: number;
}

/**
 * Callback for pull progress updates
 */
export type OnProgressCallback = (event: PullProgressEvent) => void;

/**
 * Extract short model name from full Ollama model path
 * e.g., "ollama/gpt-oss:20b" -> "gpt-oss:20b"
 */
export function shortOllamaName(modelFull: string): string {
  return String(modelFull).startsWith('ollama/')
    ? modelFull.slice('ollama/'.length)
    : modelFull;
}

/**
 * Check if an Ollama model exists locally
 */
export async function verifyOllamaModelExists(
  apiBase: string,
  modelFull: string
): Promise<VerifyResult> {
  const short = shortOllamaName(modelFull);
  const res = await fetch(`${apiBase}/ollama/verify?model=${encodeURIComponent(short)}`);

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const json = await res.json();
  return { exists: !!json.exists, short };
}

/**
 * Pull an Ollama model with progress streaming
 */
export async function pullOllamaModel(
  apiBase: string,
  modelFull: string,
  onProgress?: OnProgressCallback,
  signal?: AbortSignal
): Promise<{ ok: boolean; model: string }> {
  const short = shortOllamaName(modelFull);

  const res = await fetch(`${apiBase}/ollama/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: short }),
    signal,
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let success = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl < 0) break;

      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;

      let event: PullProgressEvent;
      try {
        event = JSON.parse(line);
      } catch {
        event = { status: line };
      }

      onProgress?.(event);

      if (event.status === 'success') {
        success = true;
      }
    }
  }

  if (!success) {
    throw new Error('Pull did not complete (no "success" event).');
  }

  return { ok: true, model: short };
}

/**
 * Wait for Ollama model to be available after pull
 * Polls the verify endpoint until the model appears
 */
export async function waitOllamaTag(
  apiBase: string,
  short: string,
  options: { tries?: number; delay?: number } = {}
): Promise<boolean> {
  const { tries = 6, delay = 1000 } = options;

  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${apiBase}/ollama/verify?model=${encodeURIComponent(short)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.exists) return true;
      }
    } catch {
      // Ignore errors and retry
    }
    await new Promise((r) => setTimeout(r, delay));
  }

  return false;
}
