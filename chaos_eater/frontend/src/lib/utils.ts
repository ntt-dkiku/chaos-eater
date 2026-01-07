import type { UploadedFile, Message, MessageType, MessageRole } from '../types';

declare global {
  interface Window {
    NEXT_PUBLIC_CE_API?: string;
  }
}

/**
 * Get the API base URL from window, env, or fallback to localhost
 */
export function getApiBase(): string {
  return (
    (typeof window !== 'undefined' && window.NEXT_PUBLIC_CE_API) ||
    import.meta.env.VITE_CE_API ||
    'http://localhost:8000'
  );
}

/**
 * Build WebSocket URL that matches API_BASE protocol/host
 */
export function wsUrl(apiBase: string, path: string): string {
  try {
    const u = new URL(apiBase);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = path;
    return u.toString();
  } catch {
    // Fallback: naive replace
    return apiBase.replace(/^http/, 'ws') + path;
  }
}

/**
 * Read a File object as text, preserving webkitRelativePath if available
 */
export function readAsTextWithPath(file: File): Promise<UploadedFile> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) =>
      resolve({
        name: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        content: e.target?.result as string,
        size: file.size,
      });
    reader.readAsText(file);
  });
}

/**
 * Extract provider from model name (e.g., "openai/gpt-4" -> "openai")
 */
export function providerFromModel(model: string): string | null {
  if (!model) return null;
  const idx = model.indexOf('/');
  return idx > 0 ? model.slice(0, idx) : null;
}

/**
 * Extract short model name for Ollama (e.g., "ollama/gpt-oss:20b" -> "gpt-oss:20b")
 */
export function shortOllamaName(model: string): string {
  return model.replace(/^ollama\//, '');
}

/**
 * Resolve API URL for downloads (handles localhost resolution)
 */
export function resolveApiUrl(apiBase: string): string {
  if (typeof window === 'undefined') return apiBase;

  try {
    const api = new URL(apiBase);
    const page = new URL(window.location.href);

    // If API is localhost but page is not, use page origin
    if (
      (api.hostname === 'localhost' || api.hostname === '127.0.0.1') &&
      page.hostname !== 'localhost' &&
      page.hostname !== '127.0.0.1'
    ) {
      api.protocol = page.protocol;
      api.hostname = page.hostname;
    }

    return api.toString().replace(/\/$/, '');
  } catch {
    return apiBase;
  }
}

/**
 * Format a number with locale-specific formatting
 */
export function formatNumber(n: number | null | undefined): string {
  try {
    return new Intl.NumberFormat().format(n || 0);
  } catch {
    return String(n || 0);
  }
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '-';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m ${ss}s`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

/**
 * Raw message input that may have partial fields
 */
export interface RawMessage {
  type?: MessageType;
  role?: MessageRole;
  content?: string;
  text?: string;
  language?: string;
}

/**
 * Normalize a raw message to a standard Message shape for rendering
 */
export function normalizeMessage(msg: RawMessage): Message {
  return {
    type: msg.type || 'text',
    role: msg.role || 'assistant',
    content: msg.content || msg.text || '',
    ...(msg.language ? { language: msg.language } : {}),
  } as Message;
}
