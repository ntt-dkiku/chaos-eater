import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getApiBase,
  wsUrl,
  readAsTextWithPath,
  providerFromModel,
  shortOllamaName,
  resolveApiUrl,
  formatNumber,
  formatDuration,
  normalizeMessage,
} from '../../lib/utils';

describe('utils', () => {
  describe('getApiBase', () => {
    const originalWindow = global.window;
    const originalEnv = import.meta.env.VITE_CE_API;

    afterEach(() => {
      global.window = originalWindow;
      if (originalEnv === undefined) {
        delete (import.meta.env as Record<string, unknown>).VITE_CE_API;
      } else {
        import.meta.env.VITE_CE_API = originalEnv;
      }
    });

    it('should return default localhost when no config', () => {
      delete (import.meta.env as Record<string, unknown>).VITE_CE_API;
      expect(getApiBase()).toBe('http://localhost:8000');
    });

    it('should use env variable when set', () => {
      import.meta.env.VITE_CE_API = 'http://api.example.com';
      expect(getApiBase()).toBe('http://api.example.com');
    });
  });

  describe('wsUrl', () => {
    it('should convert http to ws', () => {
      const result = wsUrl('http://localhost:8000', '/ws/stream');
      expect(result).toBe('ws://localhost:8000/ws/stream');
    });

    it('should convert https to wss', () => {
      const result = wsUrl('https://api.example.com', '/ws/stream');
      expect(result).toBe('wss://api.example.com/ws/stream');
    });

    it('should handle invalid URL with fallback', () => {
      const result = wsUrl('invalid-url', '/ws/stream');
      // Fallback appends path directly (no 'http' prefix to replace)
      expect(result).toBe('invalid-url/ws/stream');
    });
  });

  describe('readAsTextWithPath', () => {
    it('should read file content', async () => {
      const fileContent = 'Hello, World!';
      const file = new File([fileContent], 'test.txt', { type: 'text/plain' });

      const result = await readAsTextWithPath(file);

      expect(result.name).toBe('test.txt');
      expect(result.content).toBe(fileContent);
      expect(result.size).toBe(fileContent.length);
    });
  });

  describe('providerFromModel', () => {
    it('should extract openai provider', () => {
      expect(providerFromModel('openai/gpt-4')).toBe('openai');
    });

    it('should extract anthropic provider', () => {
      expect(providerFromModel('anthropic/claude-3')).toBe('anthropic');
    });

    it('should extract google provider', () => {
      expect(providerFromModel('google/gemini-pro')).toBe('google');
    });

    it('should extract ollama provider', () => {
      expect(providerFromModel('ollama/llama2')).toBe('ollama');
    });

    it('should return null for empty model', () => {
      expect(providerFromModel('')).toBeNull();
    });

    it('should return null for model without slash', () => {
      expect(providerFromModel('gpt-4')).toBeNull();
    });
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
  });

  describe('resolveApiUrl', () => {
    it('should return apiBase as-is for server-side', () => {
      const original = global.window;
      // @ts-expect-error - testing server-side
      delete global.window;
      expect(resolveApiUrl('http://localhost:8000')).toBe('http://localhost:8000');
      global.window = original;
    });

    it('should handle invalid URL gracefully', () => {
      expect(resolveApiUrl('invalid-url')).toBe('invalid-url');
    });
  });

  describe('formatNumber', () => {
    it('should format numbers with locale', () => {
      expect(formatNumber(1000)).toMatch(/1[,.]?000/);
    });

    it('should handle null', () => {
      expect(formatNumber(null)).toBe('0');
    });

    it('should handle undefined', () => {
      expect(formatNumber(undefined)).toBe('0');
    });

    it('should handle zero', () => {
      expect(formatNumber(0)).toBe('0');
    });
  });

  describe('formatDuration', () => {
    it('should format seconds only', () => {
      expect(formatDuration(45)).toBe('45s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(125)).toBe('2m 5s');
    });

    it('should format hours, minutes, and seconds', () => {
      expect(formatDuration(3725)).toBe('1h 2m 5s');
    });

    it('should handle null', () => {
      expect(formatDuration(null)).toBe('-');
    });

    it('should handle undefined', () => {
      expect(formatDuration(undefined)).toBe('-');
    });

    it('should handle negative values', () => {
      expect(formatDuration(-10)).toBe('0s');
    });
  });

  describe('normalizeMessage', () => {
    it('should normalize message with defaults', () => {
      const result = normalizeMessage({ content: 'hello' });
      expect(result.type).toBe('text');
      expect(result.role).toBe('assistant');
      expect(result.content).toBe('hello');
    });

    it('should preserve type and role', () => {
      const result = normalizeMessage({ type: 'code', role: 'user', content: 'test' });
      expect(result.type).toBe('code');
      expect(result.role).toBe('user');
      expect(result.content).toBe('test');
    });

    it('should use text field as fallback for content', () => {
      const result = normalizeMessage({ text: 'fallback' });
      expect(result.content).toBe('fallback');
    });

    it('should prefer content over text', () => {
      const result = normalizeMessage({ content: 'primary', text: 'fallback' });
      expect(result.content).toBe('primary');
    });

    it('should include language for code messages', () => {
      const result = normalizeMessage({ type: 'code', content: 'code', language: 'python' });
      expect(result).toHaveProperty('language', 'python');
    });

    it('should not include language when not provided', () => {
      const result = normalizeMessage({ content: 'text' });
      expect(result).not.toHaveProperty('language');
    });

    it('should handle empty message', () => {
      const result = normalizeMessage({});
      expect(result.type).toBe('text');
      expect(result.role).toBe('assistant');
      expect(result.content).toBe('');
    });
  });
});
