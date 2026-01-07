import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOllamaPull } from '../../hooks/useOllamaPull';

describe('useOllamaPull', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  function createMockVerifyResponse(exists: boolean) {
    return {
      ok: true,
      json: () => Promise.resolve({ exists }),
    };
  }

  function createMockPullStream(events: string[]) {
    const data = events.join('\n') + '\n';
    const encoder = new TextEncoder();
    const chunks = [encoder.encode(data)];
    let index = 0;

    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (index < chunks.length) {
              return { done: false, value: chunks[index++] };
            }
            return { done: true, value: undefined };
          },
        }),
      },
    };
  }

  it('should return isOllama false for non-ollama models', () => {
    const { result } = renderHook(() =>
      useOllamaPull({
        apiBase: 'http://localhost:8000',
        model: 'openai/gpt-4',
      })
    );

    expect(result.current.isOllama).toBe(false);
    expect(result.current.pullState.inProgress).toBe(false);
  });

  it('should return isOllama true for ollama models', () => {
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(true));

    const { result } = renderHook(() =>
      useOllamaPull({
        apiBase: 'http://localhost:8000',
        model: 'ollama/llama2',
      })
    );

    expect(result.current.isOllama).toBe(true);
  });

  it('should verify model exists on mount', async () => {
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(true));

    renderHook(() =>
      useOllamaPull({
        apiBase: 'http://localhost:8000',
        model: 'ollama/llama2',
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/ollama/verify?model=llama2')
    );
  });

  it('should not start pull if model exists', async () => {
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(true));

    const { result } = renderHook(() =>
      useOllamaPull({
        apiBase: 'http://localhost:8000',
        model: 'ollama/llama2',
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.pullState.inProgress).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Only verify, no pull
  });

  it('should prompt to pull if model does not exist', async () => {
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(false));

    const confirmFn = vi.fn().mockReturnValue(false);
    const onNotify = vi.fn();

    renderHook(() =>
      useOllamaPull({
        apiBase: 'http://localhost:8000',
        model: 'ollama/llama2',
        confirm: confirmFn,
        onNotify,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(confirmFn).toHaveBeenCalledWith(
      expect.stringContaining('llama2')
    );
    expect(onNotify).toHaveBeenCalledWith('warning', expect.stringContaining('not available'));
  });

  it('should start pull when user confirms', async () => {
    // Verify returns false
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(false));
    // Pull stream
    mockFetch.mockResolvedValueOnce(
      createMockPullStream(['{"status": "downloading"}', '{"status": "success"}'])
    );
    // Wait verify
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(true));

    const confirmFn = vi.fn().mockReturnValue(true);
    const onPullStart = vi.fn();

    const { result } = renderHook(() =>
      useOllamaPull({
        apiBase: 'http://localhost:8000',
        model: 'ollama/llama2',
        confirm: confirmFn,
        onPullStart,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onPullStart).toHaveBeenCalledWith('llama2');
  });

  it('should track pull progress', async () => {
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(false));
    mockFetch.mockResolvedValueOnce(
      createMockPullStream([
        '{"status": "downloading", "completed": 50, "total": 100}',
        '{"status": "success"}',
      ])
    );
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(true));

    const confirmFn = vi.fn().mockReturnValue(true);
    const onPullSuccess = vi.fn();

    const { result } = renderHook(() =>
      useOllamaPull({
        apiBase: 'http://localhost:8000',
        model: 'ollama/llama2',
        confirm: confirmFn,
        onPullSuccess,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // After pull completes
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.pullState.status).toBe('success');
    expect(onPullSuccess).toHaveBeenCalledWith('llama2');
  });

  it('should handle pull error', async () => {
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(false));
    mockFetch.mockRejectedValueOnce(new Error('Pull failed'));

    const confirmFn = vi.fn().mockReturnValue(true);
    const onPullError = vi.fn();
    const onNotify = vi.fn();

    const { result } = renderHook(() =>
      useOllamaPull({
        apiBase: 'http://localhost:8000',
        model: 'ollama/llama2',
        confirm: confirmFn,
        onPullError,
        onNotify,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onPullError).toHaveBeenCalledWith('Pull failed');
    expect(onNotify).toHaveBeenCalledWith('error', expect.stringContaining('Pull failed'));
  });

  it('should auto-hide success banner after delay', async () => {
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(false));
    mockFetch.mockResolvedValueOnce(
      createMockPullStream(['{"status": "success"}'])
    );
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(true));

    const confirmFn = vi.fn().mockReturnValue(true);

    const { result } = renderHook(() =>
      useOllamaPull({
        apiBase: 'http://localhost:8000',
        model: 'ollama/llama2',
        confirm: confirmFn,
        successHideDelay: 1000,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.pullState.status).toBe('success');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.pullState.status).toBeNull();
    expect(result.current.pullState.model).toBeNull();
  });

  it('should cancel pull', async () => {
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(false));

    // Create a never-resolving pull
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));

    const confirmFn = vi.fn().mockReturnValue(true);

    const { result } = renderHook(() =>
      useOllamaPull({
        apiBase: 'http://localhost:8000',
        model: 'ollama/llama2',
        confirm: confirmFn,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.cancel();
    });

    expect(result.current.pullState.inProgress).toBe(false);
    expect(result.current.pullState.status).toBe('cancelled');
  });

  it('should retry pull', async () => {
    // First verify - exists
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(true));

    const { result } = renderHook(() =>
      useOllamaPull({
        apiBase: 'http://localhost:8000',
        model: 'ollama/llama2',
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second verify after retry - not exists, but cancel dialog
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(false));
    mockFetch.mockResolvedValueOnce(
      createMockPullStream(['{"status": "success"}'])
    );
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(true));

    act(() => {
      result.current.retry(true);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Retry should skip confirm and start pull directly
    expect(mockFetch).toHaveBeenCalledTimes(4); // verify + pull + wait verify
  });

  it('should clear state when model changes to non-ollama', async () => {
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(true));

    const { result, rerender } = renderHook(
      ({ model }) =>
        useOllamaPull({
          apiBase: 'http://localhost:8000',
          model,
        }),
      { initialProps: { model: 'ollama/llama2' } }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    rerender({ model: 'openai/gpt-4' });

    expect(result.current.isOllama).toBe(false);
    expect(result.current.pullState.model).toBeNull();
  });

  it('should not re-verify model that was already seen', async () => {
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(true));

    const { rerender } = renderHook(
      ({ model }) =>
        useOllamaPull({
          apiBase: 'http://localhost:8000',
          model,
        }),
      { initialProps: { model: 'ollama/llama2' } }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Change to different model
    mockFetch.mockResolvedValueOnce(createMockVerifyResponse(true));
    rerender({ model: 'ollama/other' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Change back to original - should not re-verify
    rerender({ model: 'ollama/llama2' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2); // No additional call
  });
});
