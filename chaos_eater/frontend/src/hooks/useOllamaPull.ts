import { useState, useEffect, useRef, useCallback } from 'react';
import {
  shortOllamaName,
  verifyOllamaModelExists,
  pullOllamaModel,
  waitOllamaTag,
  OllamaProgressEvent,
} from '../api/ollama';

/**
 * State for Ollama model pull progress
 */
export interface OllamaPullState {
  inProgress: boolean;
  pct: number | null;
  status: string | null;
  model: string | null;
  abort: AbortController | null;
}

/**
 * Options for useOllamaPull hook
 */
export interface UseOllamaPullOptions {
  /** API base URL */
  apiBase: string;
  /** Current model name (e.g., "ollama/gpt-oss:20b") */
  model: string;
  /** Auto-hide success banner after this many ms (default: 10000) */
  successHideDelay?: number;
  /** Callback to determine provider from model name */
  providerFromModel?: (model: string) => string;
  /** Callback when pull starts */
  onPullStart?: (model: string) => void;
  /** Callback when pull succeeds */
  onPullSuccess?: (model: string) => void;
  /** Callback when pull fails */
  onPullError?: (error: string) => void;
  /** Callback for notifications */
  onNotify?: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
  /** Custom confirm function (default: window.confirm) */
  confirm?: (message: string) => boolean;
}

/**
 * Return type for useOllamaPull hook
 */
export interface UseOllamaPullReturn {
  pullState: OllamaPullState;
  retry: (force?: boolean) => void;
  cancel: () => void;
  isOllama: boolean;
}

const DEFAULT_STATE: OllamaPullState = {
  inProgress: false,
  pct: null,
  status: null,
  model: null,
  abort: null,
};

function defaultProviderFromModel(model: string): string {
  const p = String(model).split('/')[0];
  if (['openai', 'anthropic', 'google', 'ollama'].includes(p)) return p;
  return '';
}

/**
 * Hook for managing Ollama model pulling with auto-verification
 */
export function useOllamaPull(options: UseOllamaPullOptions): UseOllamaPullReturn {
  const {
    apiBase,
    model,
    successHideDelay = 10000,
    providerFromModel = defaultProviderFromModel,
    onPullStart,
    onPullSuccess,
    onPullError,
    onNotify,
    confirm: confirmFn = (msg: string) => window.confirm(msg),
  } = options;

  const [pullState, setPullState] = useState<OllamaPullState>(DEFAULT_STATE);
  const [pullNonce, setPullNonce] = useState(0);

  const seenModelsRef = useRef(new Set<string>());
  const skipConfirmOnceRef = useRef(false);
  const lastModelRef = useRef<string | null>(null);

  const isOllama = providerFromModel(model) === 'ollama';

  const retry = useCallback((force = false) => {
    const trimmedModel = model?.trim();
    if (!trimmedModel) return;
    if (force) {
      seenModelsRef.current.delete(trimmedModel);
      skipConfirmOnceRef.current = true;
    }
    setPullNonce((n) => n + 1);
  }, [model]);

  const cancel = useCallback(() => {
    try {
      pullState.abort?.abort();
    } catch {
      // Ignore abort errors
    }
    setPullState((prev) => ({
      ...prev,
      inProgress: false,
      status: 'cancelled',
      abort: null,
    }));
  }, [pullState.abort]);

  // Auto-hide pull progress after success
  useEffect(() => {
    if (pullState.status === 'success') {
      const t = setTimeout(() => {
        setPullState(DEFAULT_STATE);
      }, successHideDelay);
      return () => clearTimeout(t);
    }
  }, [pullState.status, successHideDelay, pullNonce]);

  // Clear pull banner when model changes away from the current one
  useEffect(() => {
    const currentShort = shortOllamaName(model || '');
    if (!isOllama || (pullState.model && pullState.model !== currentShort)) {
      setPullState(DEFAULT_STATE);
    }
  }, [model, isOllama, pullState.model]);

  // Auto-pull when model becomes an Ollama model and not present locally
  useEffect(() => {
    const trimmedModel = model?.trim();
    if (!trimmedModel) return;
    if (!isOllama) return;

    const changed = lastModelRef.current !== trimmedModel;
    if (changed) {
      skipConfirmOnceRef.current = false;
      setPullState(DEFAULT_STATE);
    }
    lastModelRef.current = trimmedModel;

    if (seenModelsRef.current.has(trimmedModel)) return;

    let cancelled = false;

    (async () => {
      try {
        const { exists, short } = await verifyOllamaModelExists(apiBase, trimmedModel);
        if (cancelled) return;

        if (exists) {
          seenModelsRef.current.add(trimmedModel);
          return;
        }

        // Show confirm only if it's not a retry
        if (!skipConfirmOnceRef.current) {
          const ok = confirmFn(`Ollama model "${short}" is not available locally. Pull now?`);
          if (!ok) {
            onNotify?.('warning', `Model "${short}" is not available.`);
            return;
          }
        }
        skipConfirmOnceRef.current = false;

        const ac = new AbortController();
        setPullState({
          inProgress: true,
          pct: null,
          status: 'starting',
          model: short,
          abort: ac,
        });
        onPullStart?.(short);

        await pullOllamaModel(
          apiBase,
          trimmedModel,
          (ev: OllamaProgressEvent) => {
            if (cancelled) return;
            let pct: number | null = null;
            if (typeof ev?.completed === 'number' && typeof ev?.total === 'number' && ev.total > 0) {
              pct = Math.floor((ev.completed / ev.total) * 100);
            }
            setPullState((prev) => ({
              ...prev,
              pct,
              status: ev?.status || prev.status,
            }));
          },
          ac.signal
        );

        if (cancelled) return;

        await waitOllamaTag(apiBase, short);

        if (cancelled) return;

        setPullState({
          inProgress: false,
          pct: 100,
          status: 'success',
          model: short,
          abort: null,
        });
        onNotify?.('success', `Pull completed: "${short}"`);
        onPullSuccess?.(short);
        seenModelsRef.current.add(trimmedModel);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setPullState((prev) => ({ ...prev, inProgress: false, abort: null, status: 'error' }));
        onNotify?.('error', `Ollama pull failed: ${message}`);
        onPullError?.(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [model, pullNonce, apiBase, isOllama, confirmFn, onNotify, onPullStart, onPullSuccess, onPullError]);

  return {
    pullState,
    retry,
    cancel,
    isOllama,
  };
}
