import { describe, it, expect } from 'vitest';
import type {
  Message,
  FormData,
  ClusterState,
  RunState,
  OllamaPullState,
  Notification,
  UploadedFile,
  Session,
  Snapshot,
  StatsSnapshot,
  WSEvent,
  DEFAULT_FORM_DATA,
} from '../../types/index';
import { DEFAULT_FORM_DATA as defaultFormData } from '../../types/index';

describe('Type Definitions', () => {
  describe('Message types', () => {
    it('should accept valid text message', () => {
      const msg: Message = {
        role: 'user',
        content: 'Hello',
      };
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
    });

    it('should accept valid code message', () => {
      const msg: Message = {
        type: 'code',
        role: 'assistant',
        content: 'const x = 1;',
        language: 'javascript',
        filename: 'test.js',
      };
      expect(msg.type).toBe('code');
    });

    it('should accept valid tag message', () => {
      const msg: Message = {
        type: 'tag',
        role: 'assistant',
        content: 'Success',
        color: '#fff',
        background: '#00ff00',
      };
      expect(msg.type).toBe('tag');
    });
  });

  describe('FormData', () => {
    it('should have correct default values', () => {
      expect(defaultFormData.model).toBe('openai/gpt-4.1');
      expect(defaultFormData.apiKey).toBe('');
      expect(defaultFormData.temperature).toBe(0.0);
      expect(defaultFormData.seed).toBe(42);
      expect(defaultFormData.maxSteadyStates).toBe(2);
      expect(defaultFormData.maxRetries).toBe(3);
    });

    it('should accept valid form data', () => {
      const data: FormData = {
        model: 'openai/gpt-4.1',
        apiKey: 'test-key',
        apiKeyVisible: false,
        cluster: 'my-cluster',
        projectName: 'test-project',
        instructions: 'Run chaos tests',
        cleanBefore: true,
        cleanAfter: false,
        newDeployment: true,
        temperature: 0.5,
        seed: 123,
        maxSteadyStates: 3,
        maxRetries: 5,
      };
      expect(data.model).toBe('openai/gpt-4.1');
    });
  });

  describe('ClusterState', () => {
    it('should accept valid cluster state', () => {
      const state: ClusterState = {
        all: ['cluster-1', 'cluster-2'],
        used: ['cluster-1'],
        available: ['cluster-2'],
        mine: 'cluster-1',
      };
      expect(state.all).toHaveLength(2);
      expect(state.mine).toBe('cluster-1');
    });

    it('should accept null mine', () => {
      const state: ClusterState = {
        all: [],
        used: [],
        available: [],
        mine: null,
      };
      expect(state.mine).toBeNull();
    });
  });

  describe('RunState', () => {
    it('should accept all valid run states', () => {
      const states: RunState[] = ['idle', 'running', 'paused', 'completed'];
      expect(states).toHaveLength(4);
    });
  });

  describe('OllamaPullState', () => {
    it('should accept valid pull state', () => {
      const state: OllamaPullState = {
        inProgress: true,
        pct: 50,
        status: 'downloading',
        model: 'llama2',
        abort: null,
      };
      expect(state.inProgress).toBe(true);
      expect(state.pct).toBe(50);
    });
  });

  describe('Notification', () => {
    it('should accept all notification types', () => {
      const notifications: Notification[] = [
        { type: 'success', message: 'Done!' },
        { type: 'error', message: 'Failed' },
        { type: 'info', message: 'Info' },
        { type: 'warning', message: 'Warning' },
      ];
      expect(notifications).toHaveLength(4);
    });
  });

  describe('UploadedFile', () => {
    it('should accept valid uploaded file', () => {
      const file: UploadedFile = {
        name: 'test.yaml',
        content: 'apiVersion: v1',
        size: 14,
      };
      expect(file.name).toBe('test.yaml');
    });

    it('should accept optional project_path', () => {
      const file: UploadedFile = {
        name: 'test.yaml',
        content: 'apiVersion: v1',
        size: 14,
        project_path: '/app/test.yaml',
      };
      expect(file.project_path).toBe('/app/test.yaml');
    });
  });

  describe('Session', () => {
    it('should accept valid session', () => {
      const session: Session = {
        id: 'session-123',
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        name: 'My Session',
      };
      expect(session.id).toBe('session-123');
    });
  });

  describe('StatsSnapshot', () => {
    it('should accept valid stats snapshot', () => {
      const stats: StatsSnapshot = {
        total: {
          input_tokens: 100,
          output_tokens: 200,
          total_tokens: 300,
        },
        time: {
          elapsed_sec: 60,
          first_ts: 1000,
          last_ts: 1060,
        },
        by_agent: [
          {
            agent_name: 'agent-1',
            token_usage: {
              input_tokens: 50,
              output_tokens: 100,
              total_tokens: 150,
            },
          },
        ],
      };
      expect(stats.total.total_tokens).toBe(300);
      expect(stats.by_agent).toHaveLength(1);
    });
  });

  describe('WSEvent', () => {
    it('should accept partial event', () => {
      const event: WSEvent = {
        type: 'partial',
        partial: 'Hello',
        role: 'assistant',
        mode: 'delta',
      };
      expect(event.type).toBe('partial');
    });

    it('should accept done event', () => {
      const event: WSEvent = {
        type: 'done',
        status: 'completed',
      };
      expect(event.type).toBe('done');
    });

    it('should accept stats event', () => {
      const event: WSEvent = {
        type: 'stats',
        snapshot: {
          total: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          time: { elapsed_sec: null, first_ts: null, last_ts: null },
          by_agent: [],
        },
      };
      expect(event.type).toBe('stats');
    });
  });
});
