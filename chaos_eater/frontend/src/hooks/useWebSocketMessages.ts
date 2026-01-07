import { useRef, useCallback, useEffect } from 'react';
import type { Message } from '../types';

/**
 * Partial message state for tracking streaming messages
 */
interface PartialState {
  open: boolean;
  role: string;
  type: string;
  language?: string;
}

/**
 * Options for partial message handling
 */
export interface PartialOptions {
  role?: string;
  mode?: 'delta' | 'frame';
  format?: 'plain' | 'code';
  language?: string;
  filename?: string;
  final?: boolean;
}

/**
 * Event types from WebSocket
 */
interface WsEvent {
  type: string;
  partial?: string;
  text?: string;
  code?: string;
  url?: string;
  role?: string;
  mode?: string;
  format?: string;
  language?: string;
  filename?: string;
  final?: boolean;
  color?: string;
  background?: string;
}

/**
 * WebSocket message payload
 */
interface WsPayload {
  type?: string;
  event?: WsEvent;
  partial?: string;
  role?: string;
  mode?: string;
  format?: string;
  language?: string;
  final?: boolean;
  rich?: string;
  message?: string;
  progress?: string;
  status?: string;
}

/**
 * Return type for useWebSocketMessages hook
 */
export interface UseWebSocketMessagesReturn {
  handlePayload: (payload: string) => void;
  clearQueue: () => void;
  resetPartialState: () => void;
}

/**
 * Hook for managing WebSocket message processing with batching
 */
export function useWebSocketMessages(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
): UseWebSocketMessagesReturn {
  const messageQueueRef = useRef<string[]>([]);
  const rafRef = useRef<number | null>(null);
  const partialStateRef = useRef<PartialState | null>(null);

  /**
   * Append a partial chunk to the messages
   */
  const appendAssistantPartial = useCallback(
    (chunk: string, options: PartialOptions = {}) => {
      const {
        role = 'assistant',
        mode = 'delta',
        format = 'plain',
        language,
        final = false,
      } = options;

      const type = format === 'code' ? 'code' : 'text';
      const c = String(chunk ?? '');

      setMessages((prev) => {
        const out = [...prev];
        const last = out[out.length - 1];

        // Check if the current partial should continue the same bubble
        const sameBubble =
          partialStateRef.current?.open &&
          partialStateRef.current?.role === role &&
          partialStateRef.current?.type === type &&
          (type === 'text' || partialStateRef.current?.language === (language || undefined));

        if (sameBubble && last && last.role === role && last.type === type) {
          // Append or replace depending on mode
          if (mode === 'frame') {
            last.content = c;
          } else {
            last.content = `${last.content || ''}${c}`;
          }
        } else {
          // Create a new bubble
          out.push({
            type,
            role,
            content: c,
            ...(type === 'code' ? { language } : {}),
          } as Message);
          partialStateRef.current = {
            open: true,
            role,
            type,
            language: type === 'code' ? language : undefined,
          };
        }

        if (final) {
          partialStateRef.current = null;
        }
        return out;
      });
    },
    [setMessages]
  );

  /**
   * Process a single message payload
   */
  const processPayload = useCallback(
    (payload: string) => {
      let msg: WsPayload;
      try {
        msg = JSON.parse(payload);
      } catch {
        setMessages((m) => [...m, { type: 'text', role: 'assistant', content: String(payload) }]);
        return;
      }

      // Handle event-based messages
      if (msg?.type === 'event' && msg.event) {
        const ev = msg.event;

        if (ev.type === 'partial' && ev.partial != null) {
          appendAssistantPartial(ev.partial, {
            role: ev.role || 'assistant',
            mode: (ev.mode as 'delta' | 'frame') || 'delta',
            format: (ev.format as 'plain' | 'code') || 'plain',
            language: ev.language,
            filename: ev.filename,
            final: !!ev.final,
          });
          return;
        }

        if (ev.type === 'partial_end') {
          partialStateRef.current = null;
          return;
        }

        if (ev.type === 'write') {
          setMessages((m) => [
            ...m,
            { type: 'text', role: ev.role || 'assistant', content: ev.text || '' },
          ]);
          return;
        }

        if (ev.type === 'code') {
          setMessages((m) => [
            ...m,
            {
              type: 'code',
              role: ev.role || 'assistant',
              content: ev.code || '',
              language: ev.language,
            },
          ]);
          return;
        }

        if (ev.type === 'subheader') {
          setMessages((m) => [
            ...m,
            { type: 'subheader', role: ev.role || 'assistant', content: ev.text || '' },
          ]);
          return;
        }

        if (ev.type === 'iframe') {
          setMessages((m) => [
            ...m,
            { type: 'iframe', role: ev.role || 'assistant', content: ev.url || '' },
          ]);
          return;
        }

        if (ev.type === 'tag') {
          setMessages((m) => [
            ...m,
            { type: 'tag', role: ev.role || 'assistant', content: ev.text || '' },
          ]);
          return;
        }

        setMessages((m) => [
          ...m,
          { type: 'text', role: 'assistant', content: JSON.stringify(ev) },
        ]);
        return;
      }

      // Handle direct partial messages
      if (msg.partial != null) {
        appendAssistantPartial(msg.partial, {
          role: msg.role || 'assistant',
          mode: (msg.mode as 'delta' | 'frame') || 'delta',
          format: (msg.format as 'plain' | 'code') || 'plain',
          language: msg.language,
          final: !!msg.final,
        });
        return;
      }

      // Handle status/progress messages (log only)
      const content =
        msg.rich || msg.message || msg.progress || (msg.status ? `Status: ${msg.status}` : null);
      if (content != null) {
        console.log(content);
        return;
      }

      // Fallback: show raw JSON
      setMessages((m) => [
        ...m,
        { type: 'text', role: 'assistant', content: JSON.stringify(msg) },
      ]);
    },
    [setMessages, appendAssistantPartial]
  );

  /**
   * Process all queued messages
   */
  const processMessageQueue = useCallback(() => {
    if (messageQueueRef.current.length === 0) return;

    const messages = [...messageQueueRef.current];
    messageQueueRef.current = [];

    rafRef.current = requestAnimationFrame(() => {
      messages.forEach(processPayload);
      rafRef.current = null;
    });
  }, [processPayload]);

  /**
   * Handle incoming WebSocket payload
   */
  const handlePayload = useCallback(
    (payload: string) => {
      messageQueueRef.current.push(payload);

      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          processMessageQueue();
          rafRef.current = null;
        });
      }
    },
    [processMessageQueue]
  );

  /**
   * Clear the message queue
   */
  const clearQueue = useCallback(() => {
    messageQueueRef.current = [];
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /**
   * Reset partial message state
   */
  const resetPartialState = useCallback(() => {
    partialStateRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      messageQueueRef.current = [];
    };
  }, []);

  return {
    handlePayload,
    clearQueue,
    resetPartialState,
  };
}
