import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchJSON, postJSON } from './base';

describe('API base', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('fetchJSON', () => {
    it('should make GET request by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: () => 'application/json',
        },
        json: () => Promise.resolve({ data: 'test' }),
      });

      const result = await fetchJSON('http://localhost:8000', '/api/test');

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8000/api/test', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual({ data: 'test' });
    });

    it('should throw error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found'),
      });

      await expect(
        fetchJSON('http://localhost:8000', '/api/test')
      ).rejects.toThrow('Not found');
    });

    it('should return text for non-JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: () => 'text/plain',
        },
        text: () => Promise.resolve('plain text response'),
      });

      const result = await fetchJSON('http://localhost:8000', '/api/text');

      expect(result).toBe('plain text response');
    });

    it('should merge custom headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: () => 'application/json',
        },
        json: () => Promise.resolve({}),
      });

      await fetchJSON('http://localhost:8000', '/api/test', {
        headers: { Authorization: 'Bearer token' },
      });

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8000/api/test', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
      });
    });
  });

  describe('postJSON', () => {
    it('should make POST request with JSON body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: () => 'application/json',
        },
        json: () => Promise.resolve({ id: 123 }),
      });

      const result = await postJSON('http://localhost:8000', '/api/create', {
        name: 'test',
      });

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8000/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
      expect(result).toEqual({ id: 123 });
    });
  });
});
