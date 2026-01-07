import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  shortOllamaName,
  verifyOllamaModelExists,
  pullOllamaModel,
  waitOllamaTag,
} from '../../api/ollama';

describe('ollama API', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('shortOllamaName', () => {
    it('should remove ollama/ prefix', () => {
      expect(shortOllamaName('ollama/llama2')).toBe('llama2');
    });

    it('should handle model with tag', () => {
      expect(shortOllamaName('ollama/gpt-oss:20b')).toBe('gpt-oss:20b');
    });

    it('should return unchanged if no prefix', () => {
      expect(shortOllamaName('llama2')).toBe('llama2');
    });

    it('should handle empty string', () => {
      expect(shortOllamaName('')).toBe('');
    });
  });

  describe('verifyOllamaModelExists', () => {
    it('should return exists:true when model exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ exists: true }),
      });

      const result = await verifyOllamaModelExists('http://localhost:8000', 'ollama/llama2');
      expect(result).toEqual({ exists: true, short: 'llama2' });
    });

    it('should return exists:false when model does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ exists: false }),
      });

      const result = await verifyOllamaModelExists('http://localhost:8000', 'llama2');
      expect(result).toEqual({ exists: false, short: 'llama2' });
    });

    it('should throw error on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Model not found'),
      });

      await expect(
        verifyOllamaModelExists('http://localhost:8000', 'llama2')
      ).rejects.toThrow('Model not found');
    });
  });

  describe('pullOllamaModel', () => {
    function createMockStream(events: string[]) {
      const data = events.join('\n') + '\n';
      const encoder = new TextEncoder();
      const chunks = [encoder.encode(data)];
      let index = 0;

      return {
        getReader: () => ({
          read: async () => {
            if (index < chunks.length) {
              return { done: false, value: chunks[index++] };
            }
            return { done: true, value: undefined };
          },
        }),
      };
    }

    it('should pull model and return success', async () => {
      const stream = createMockStream([
        '{"status": "pulling"}',
        '{"status": "success"}',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      const result = await pullOllamaModel('http://localhost:8000', 'ollama/llama2');
      expect(result).toEqual({ ok: true, model: 'llama2' });
    });

    it('should call onProgress with events', async () => {
      const stream = createMockStream([
        '{"status": "downloading", "completed": 50, "total": 100}',
        '{"status": "success"}',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      const onProgress = vi.fn();
      await pullOllamaModel('http://localhost:8000', 'llama2', onProgress);

      expect(onProgress).toHaveBeenCalledWith({ status: 'downloading', completed: 50, total: 100 });
      expect(onProgress).toHaveBeenCalledWith({ status: 'success' });
    });

    it('should throw error if no success event', async () => {
      const stream = createMockStream([
        '{"status": "pulling"}',
        '{"status": "done"}',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await expect(pullOllamaModel('http://localhost:8000', 'llama2')).rejects.toThrow(
        'Pull did not complete'
      );
    });

    it('should throw error on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Pull failed'),
      });

      await expect(pullOllamaModel('http://localhost:8000', 'llama2')).rejects.toThrow(
        'Pull failed'
      );
    });
  });

  describe('waitOllamaTag', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return true when model becomes available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ exists: true }),
      });

      const promise = waitOllamaTag('http://localhost:8000', 'llama2', { tries: 3, delay: 100 });
      const result = await promise;
      expect(result).toBe(true);
    });

    it('should retry until model is available', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ exists: false }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ exists: true }) });

      const promise = waitOllamaTag('http://localhost:8000', 'llama2', { tries: 3, delay: 100 });

      // First check - not available
      await vi.advanceTimersByTimeAsync(0);

      // Wait for delay and second check
      await vi.advanceTimersByTimeAsync(100);

      const result = await promise;
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return false after max tries', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ exists: false }) });

      const promise = waitOllamaTag('http://localhost:8000', 'llama2', { tries: 2, delay: 100 });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      const result = await promise;
      expect(result).toBe(false);
    });
  });
});
