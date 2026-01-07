import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../lib/sessionStore';

describe('sessionStore', () => {
  beforeEach(async () => {
    // Clear the database before each test
    await db.sessions.clear();
    await db.snapshots.clear();
  });

  describe('db', () => {
    it('should have sessions table', () => {
      expect(db.sessions).toBeDefined();
    });

    it('should have snapshots table', () => {
      expect(db.snapshots).toBeDefined();
    });
  });

  describe('sessions table', () => {
    it('should add and retrieve a session', async () => {
      const session = {
        id: 'test-session-1',
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        name: 'Test Session',
      };

      await db.sessions.put(session);
      const retrieved = await db.sessions.get('test-session-1');

      expect(retrieved).toEqual(session);
    });

    it('should update a session', async () => {
      const session = {
        id: 'test-session-2',
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      };

      await db.sessions.put(session);
      await db.sessions.update('test-session-2', { name: 'Updated Name' });

      const updated = await db.sessions.get('test-session-2');
      expect(updated?.name).toBe('Updated Name');
    });

    it('should delete a session', async () => {
      const session = {
        id: 'test-session-3',
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      };

      await db.sessions.put(session);
      await db.sessions.delete('test-session-3');

      const deleted = await db.sessions.get('test-session-3');
      expect(deleted).toBeUndefined();
    });

    it('should list sessions ordered by lastOpenedAt', async () => {
      const now = Date.now();
      await db.sessions.bulkPut([
        { id: 'session-a', createdAt: now, lastOpenedAt: now - 2000 },
        { id: 'session-b', createdAt: now, lastOpenedAt: now - 1000 },
        { id: 'session-c', createdAt: now, lastOpenedAt: now },
      ]);

      const sessions = await db.sessions.orderBy('lastOpenedAt').reverse().toArray();

      expect(sessions[0].id).toBe('session-c');
      expect(sessions[1].id).toBe('session-b');
      expect(sessions[2].id).toBe('session-a');
    });
  });

  describe('snapshots table', () => {
    it('should add and retrieve a snapshot', async () => {
      const snapshot = {
        id: 'snapshot-1',
        sessionId: 'session-1',
        title: 'Test Snapshot',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        panelVisible: true,
        backendProjectPath: null,
        uploadedFilesMeta: [],
        formData: {
          model: 'openai/gpt-4',
          apiKey: '' as const,
          apiKeyVisible: false,
          cluster: '',
          projectName: 'test',
          instructions: '',
          cleanBefore: true,
          cleanAfter: true,
          newDeployment: true,
          temperature: 0,
          seed: 42,
          maxSteadyStates: 2,
          maxRetries: 3,
        },
      };

      await db.snapshots.put(snapshot);
      const retrieved = await db.snapshots.get('snapshot-1');

      expect(retrieved).toEqual(snapshot);
    });

    it('should query snapshots by sessionId', async () => {
      const now = Date.now();
      await db.snapshots.bulkPut([
        {
          id: 'snap-a',
          sessionId: 'session-1',
          title: 'Snapshot A',
          createdAt: now,
          updatedAt: now,
          messages: [],
          panelVisible: true,
          backendProjectPath: null,
          uploadedFilesMeta: [],
          formData: {} as any,
        },
        {
          id: 'snap-b',
          sessionId: 'session-1',
          title: 'Snapshot B',
          createdAt: now,
          updatedAt: now,
          messages: [],
          panelVisible: true,
          backendProjectPath: null,
          uploadedFilesMeta: [],
          formData: {} as any,
        },
        {
          id: 'snap-c',
          sessionId: 'session-2',
          title: 'Snapshot C',
          createdAt: now,
          updatedAt: now,
          messages: [],
          panelVisible: true,
          backendProjectPath: null,
          uploadedFilesMeta: [],
          formData: {} as any,
        },
      ]);

      const session1Snapshots = await db.snapshots
        .where('sessionId')
        .equals('session-1')
        .toArray();

      expect(session1Snapshots).toHaveLength(2);
      expect(session1Snapshots.map((s) => s.id)).toContain('snap-a');
      expect(session1Snapshots.map((s) => s.id)).toContain('snap-b');
    });
  });
});
