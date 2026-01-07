import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkProviderStatus, saveApiKey } from '../../api/config';

describe('config API', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('checkProviderStatus', () => {
    it('should return true when provider is configured', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configured: true }),
      });

      const result = await checkProviderStatus('http://localhost:8000', 'openai');
      expect(result).toBe(true);
    });

    it('should return false when provider is not configured', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configured: false }),
      });

      const result = await checkProviderStatus('http://localhost:8000', 'openai');
      expect(result).toBe(false);
    });

    it('should return false for empty provider', async () => {
      const result = await checkProviderStatus('http://localhost:8000', '');
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await checkProviderStatus('http://localhost:8000', 'openai');
      expect(result).toBe(false);
    });

    it('should encode provider in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configured: true }),
      });

      await checkProviderStatus('http://localhost:8000', 'provider/with/slashes');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/config/api-key?provider=provider%2Fwith%2Fslashes'
      );
    });
  });

  describe('saveApiKey', () => {
    it('should save API key successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ provider: 'openai', configured: true }),
      });

      const result = await saveApiKey('http://localhost:8000', 'openai', 'sk-123');
      expect(result).toEqual({ provider: 'openai', configured: true });
    });

    it('should throw error for empty provider', async () => {
      await expect(saveApiKey('http://localhost:8000', '', 'sk-123')).rejects.toThrow(
        'Unknown provider'
      );
    });

    it('should throw error for empty API key', async () => {
      await expect(saveApiKey('http://localhost:8000', 'openai', '')).rejects.toThrow(
        'API Key is empty'
      );
    });

    it('should throw error for whitespace-only API key', async () => {
      await expect(saveApiKey('http://localhost:8000', 'openai', '   ')).rejects.toThrow(
        'API Key is empty'
      );
    });

    it('should trim API key before sending', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ provider: 'openai', configured: true }),
      });

      await saveApiKey('http://localhost:8000', 'openai', '  sk-123  ');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.api_key).toBe('sk-123');
    });

    it('should throw error on server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      });

      await expect(saveApiKey('http://localhost:8000', 'openai', 'sk-123')).rejects.toThrow(
        'Server error'
      );
    });
  });
});
