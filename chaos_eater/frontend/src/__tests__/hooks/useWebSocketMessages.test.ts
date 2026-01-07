import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocketMessages } from '../../hooks/useWebSocketMessages';
import type { Message } from '../../types';

describe('useWebSocketMessages', () => {
  let mockSetMessages: ReturnType<typeof vi.fn>;
  let mockRaf: number;

  beforeEach(() => {
    mockSetMessages = vi.fn((updater) => {
      if (typeof updater === 'function') {
        return updater([]);
      }
      return updater;
    });

    mockRaf = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      mockRaf++;
      setTimeout(() => cb(0), 0);
      return mockRaf;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return handlePayload, clearQueue, and resetPartialState functions', () => {
    const { result } = renderHook(() => useWebSocketMessages(mockSetMessages));

    expect(typeof result.current.handlePayload).toBe('function');
    expect(typeof result.current.clearQueue).toBe('function');
    expect(typeof result.current.resetPartialState).toBe('function');
  });

  it('should process text message', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((updater: (prev: Message[]) => Message[]) => {
      const result = updater(messages);
      messages.push(...result.slice(messages.length));
    });

    const { result } = renderHook(() => useWebSocketMessages(setMessages));

    act(() => {
      result.current.handlePayload(JSON.stringify({ type: 'text', content: 'Hello' }));
    });

    // Wait for RAF to process
    await vi.waitFor(() => {
      expect(setMessages).toHaveBeenCalled();
    });
  });

  it('should process event with partial type', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((updater: (prev: Message[]) => Message[]) => {
      const result = updater(messages);
      messages.length = 0;
      messages.push(...result);
    });

    const { result } = renderHook(() => useWebSocketMessages(setMessages));

    act(() => {
      result.current.handlePayload(
        JSON.stringify({
          type: 'event',
          event: { type: 'partial', partial: 'Hello' },
        })
      );
    });

    await vi.waitFor(() => {
      expect(setMessages).toHaveBeenCalled();
    });

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].content).toBe('Hello');
  });

  it('should handle write event', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((updater: (prev: Message[]) => Message[]) => {
      const result = updater(messages);
      messages.length = 0;
      messages.push(...result);
    });

    const { result } = renderHook(() => useWebSocketMessages(setMessages));

    act(() => {
      result.current.handlePayload(
        JSON.stringify({
          type: 'event',
          event: { type: 'write', text: 'Write message' },
        })
      );
    });

    await vi.waitFor(() => {
      expect(setMessages).toHaveBeenCalled();
    });

    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe('text');
    expect(messages[0].content).toBe('Write message');
  });

  it('should handle code event', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((updater: (prev: Message[]) => Message[]) => {
      const result = updater(messages);
      messages.length = 0;
      messages.push(...result);
    });

    const { result } = renderHook(() => useWebSocketMessages(setMessages));

    act(() => {
      result.current.handlePayload(
        JSON.stringify({
          type: 'event',
          event: { type: 'code', code: 'console.log("test")', language: 'javascript' },
        })
      );
    });

    await vi.waitFor(() => {
      expect(setMessages).toHaveBeenCalled();
    });

    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe('code');
    expect(messages[0].content).toBe('console.log("test")');
    expect(messages[0].language).toBe('javascript');
  });

  it('should handle subheader event', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((updater: (prev: Message[]) => Message[]) => {
      const result = updater(messages);
      messages.length = 0;
      messages.push(...result);
    });

    const { result } = renderHook(() => useWebSocketMessages(setMessages));

    act(() => {
      result.current.handlePayload(
        JSON.stringify({
          type: 'event',
          event: { type: 'subheader', text: 'Section Title' },
        })
      );
    });

    await vi.waitFor(() => {
      expect(setMessages).toHaveBeenCalled();
    });

    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe('subheader');
  });

  it('should handle iframe event', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((updater: (prev: Message[]) => Message[]) => {
      const result = updater(messages);
      messages.length = 0;
      messages.push(...result);
    });

    const { result } = renderHook(() => useWebSocketMessages(setMessages));

    act(() => {
      result.current.handlePayload(
        JSON.stringify({
          type: 'event',
          event: { type: 'iframe', url: 'https://example.com' },
        })
      );
    });

    await vi.waitFor(() => {
      expect(setMessages).toHaveBeenCalled();
    });

    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe('iframe');
    expect(messages[0].content).toBe('https://example.com');
  });

  it('should handle tag event', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((updater: (prev: Message[]) => Message[]) => {
      const result = updater(messages);
      messages.length = 0;
      messages.push(...result);
    });

    const { result } = renderHook(() => useWebSocketMessages(setMessages));

    act(() => {
      result.current.handlePayload(
        JSON.stringify({
          type: 'event',
          event: { type: 'tag', text: 'Status Tag' },
        })
      );
    });

    await vi.waitFor(() => {
      expect(setMessages).toHaveBeenCalled();
    });

    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe('tag');
  });

  it('should append partial in delta mode', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((updater: (prev: Message[]) => Message[]) => {
      const result = updater(messages);
      messages.length = 0;
      messages.push(...result);
    });

    const { result } = renderHook(() => useWebSocketMessages(setMessages));

    // First partial
    act(() => {
      result.current.handlePayload(
        JSON.stringify({
          type: 'event',
          event: { type: 'partial', partial: 'Hello', mode: 'delta' },
        })
      );
    });

    await vi.waitFor(() => {
      expect(messages.length).toBe(1);
    });

    // Second partial - should append
    act(() => {
      result.current.handlePayload(
        JSON.stringify({
          type: 'event',
          event: { type: 'partial', partial: ' World', mode: 'delta' },
        })
      );
    });

    await vi.waitFor(() => {
      expect(messages[0].content).toBe('Hello World');
    });
  });

  it('should replace content in frame mode', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((updater: (prev: Message[]) => Message[]) => {
      const result = updater(messages);
      messages.length = 0;
      messages.push(...result);
    });

    const { result } = renderHook(() => useWebSocketMessages(setMessages));

    // First partial
    act(() => {
      result.current.handlePayload(
        JSON.stringify({
          type: 'event',
          event: { type: 'partial', partial: 'Frame 1', mode: 'frame' },
        })
      );
    });

    await vi.waitFor(() => {
      expect(messages.length).toBe(1);
    });

    // Second partial - should replace
    act(() => {
      result.current.handlePayload(
        JSON.stringify({
          type: 'event',
          event: { type: 'partial', partial: 'Frame 2', mode: 'frame' },
        })
      );
    });

    await vi.waitFor(() => {
      expect(messages[0].content).toBe('Frame 2');
    });
  });

  it('should handle invalid JSON gracefully', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((updater: (prev: Message[]) => Message[]) => {
      const result = updater(messages);
      messages.length = 0;
      messages.push(...result);
    });

    const { result } = renderHook(() => useWebSocketMessages(setMessages));

    act(() => {
      result.current.handlePayload('not valid json');
    });

    await vi.waitFor(() => {
      expect(setMessages).toHaveBeenCalled();
    });

    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('not valid json');
  });

  it('should clear queue', () => {
    const { result } = renderHook(() => useWebSocketMessages(mockSetMessages));

    act(() => {
      result.current.handlePayload(JSON.stringify({ type: 'text' }));
      result.current.clearQueue();
    });

    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('should batch multiple payloads', async () => {
    let callCount = 0;
    const setMessages = vi.fn(() => {
      callCount++;
    });

    const { result } = renderHook(() => useWebSocketMessages(setMessages));

    act(() => {
      result.current.handlePayload(JSON.stringify({ partial: 'a' }));
      result.current.handlePayload(JSON.stringify({ partial: 'b' }));
      result.current.handlePayload(JSON.stringify({ partial: 'c' }));
    });

    // Should only trigger one RAF
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('should handle direct partial message', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((updater: (prev: Message[]) => Message[]) => {
      const result = updater(messages);
      messages.length = 0;
      messages.push(...result);
    });

    const { result } = renderHook(() => useWebSocketMessages(setMessages));

    act(() => {
      result.current.handlePayload(JSON.stringify({ partial: 'Direct partial' }));
    });

    await vi.waitFor(() => {
      expect(setMessages).toHaveBeenCalled();
    });

    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('Direct partial');
  });

  it('should handle partial_end event', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((updater: (prev: Message[]) => Message[]) => {
      const result = updater(messages);
      messages.length = 0;
      messages.push(...result);
    });

    const { result } = renderHook(() => useWebSocketMessages(setMessages));

    // Start partial
    act(() => {
      result.current.handlePayload(
        JSON.stringify({
          type: 'event',
          event: { type: 'partial', partial: 'Start' },
        })
      );
    });

    await vi.waitFor(() => {
      expect(messages.length).toBe(1);
    });

    // End partial
    act(() => {
      result.current.handlePayload(
        JSON.stringify({
          type: 'event',
          event: { type: 'partial_end' },
        })
      );
    });

    // New partial should create new message
    act(() => {
      result.current.handlePayload(
        JSON.stringify({
          type: 'event',
          event: { type: 'partial', partial: 'New' },
        })
      );
    });

    await vi.waitFor(() => {
      expect(messages.length).toBe(2);
    });

    expect(messages[1].content).toBe('New');
  });
});
