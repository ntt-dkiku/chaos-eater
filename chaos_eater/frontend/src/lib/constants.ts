/**
 * Available model options
 */
export const MODELS = [
  'openai/gpt-4.1',
  'openai/gpt-4o-2024-08-06',
  'openai/gpt-5.1-2025-11-13',
  'openai/gpt-5.2',
  'anthropic/claude-sonnet-4-5-20250929',
  'anthropic/claude-opus-4-5-20251101',
  'google/gemini-2.5-pro',
  'google/gemini-3-pro-preview',
  'ollama/gpt-oss:20b',
  'ollama/gpt-oss:120b',
  'custom',
] as const;

export type ModelName = typeof MODELS[number];

/**
 * Default model selection
 */
export const DEFAULT_MODEL: ModelName = 'openai/gpt-4.1';

/**
 * Sidebar width in pixels
 */
export const SIDEBAR_WIDTH = 280;

/**
 * Default namespace for chaos experiments
 */
export const DEFAULT_NAMESPACE = 'chaos-eater';

/**
 * Notification auto-dismiss timeout in milliseconds
 */
export const NOTIFICATION_TIMEOUT = 10000;

/**
 * WebSocket reconnect delay in milliseconds
 */
export const WS_RECONNECT_DELAY = 2000;

/**
 * Cluster refresh interval in milliseconds
 */
export const CLUSTER_REFRESH_INTERVAL = 10000;
