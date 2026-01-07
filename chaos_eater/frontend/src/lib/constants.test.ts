import { describe, it, expect } from 'vitest';
import {
  MODELS,
  DEFAULT_MODEL,
  SIDEBAR_WIDTH,
  DEFAULT_NAMESPACE,
  NOTIFICATION_TIMEOUT,
  WS_RECONNECT_DELAY,
  CLUSTER_REFRESH_INTERVAL,
} from './constants';

describe('constants', () => {
  describe('MODELS', () => {
    it('should contain expected model providers', () => {
      const providers = MODELS.map((m) => m.split('/')[0]);
      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');
      expect(providers).toContain('google');
      expect(providers).toContain('ollama');
    });

    it('should include custom option', () => {
      expect(MODELS).toContain('custom');
    });

    it('should have at least 10 options', () => {
      expect(MODELS.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('DEFAULT_MODEL', () => {
    it('should be a valid model from MODELS', () => {
      expect(MODELS).toContain(DEFAULT_MODEL);
    });

    it('should be an OpenAI model', () => {
      expect(DEFAULT_MODEL.startsWith('openai/')).toBe(true);
    });
  });

  describe('SIDEBAR_WIDTH', () => {
    it('should be a reasonable width', () => {
      expect(SIDEBAR_WIDTH).toBeGreaterThan(200);
      expect(SIDEBAR_WIDTH).toBeLessThan(400);
    });
  });

  describe('DEFAULT_NAMESPACE', () => {
    it('should be chaos-eater', () => {
      expect(DEFAULT_NAMESPACE).toBe('chaos-eater');
    });
  });

  describe('NOTIFICATION_TIMEOUT', () => {
    it('should be 10 seconds', () => {
      expect(NOTIFICATION_TIMEOUT).toBe(10000);
    });
  });

  describe('WS_RECONNECT_DELAY', () => {
    it('should be 2 seconds', () => {
      expect(WS_RECONNECT_DELAY).toBe(2000);
    });
  });

  describe('CLUSTER_REFRESH_INTERVAL', () => {
    it('should be 10 seconds', () => {
      expect(CLUSTER_REFRESH_INTERVAL).toBe(10000);
    });
  });
});
