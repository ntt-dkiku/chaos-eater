import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  safeFormData,
  ensureSession,
  listSessions,
  renameSession,
  deleteSession,
  createSnapshot,
  updateSnapshot,
  listSnapshots,
  getSnapshot,
  deleteSnapshot,
  renameSnapshot,
  clearSnapshots,
} from './useSessionStore';
import { db } from './sessionStore';
import type { FormData } from '../types';

describe('useSessionStore', () => {
  beforeEach(async () => {
    // Clear the database before each test
    await db.sessions.clear();
    await db.snapshots.clear();
  });

  describe('safeFormData', () => {
    it('should remove apiKey from formData', () => {
      const formData: FormData = {
        model: 'gpt-4',
        apiKey: 'secret-key-123',
        apiKeyVisible: false,
        cluster: 'test-cluster',
        projectName: 'test-project',
        instructions: '',
        cleanBefore: true,
        cleanAfter: true,
        newDeployment: true,
        temperature: 0,
        seed: 42,
        maxSteadyStates: 2,
        maxRetries: 3,
      };

      const result = safeFormData(formData);

      expect(result.apiKey).toBe('');
      expect(result.model).toBe('gpt-4');
      expect(result.cluster).toBe('test-cluster');
    });

    it('should handle null formData', () => {
      const result = safeFormData(null);
      expect(result.apiKey).toBe('');
    });

    it('should handle undefined formData', () => {
      const result = safeFormData(undefined);
      expect(result.apiKey).toBe('');
    });
  });

  describe('ensureSession', () => {
    it('should create a new session if it does not exist', async () => {
      await ensureSession('session-1', 'Test Session');

      const session = await db.sessions.get('session-1');
      expect(session).toBeDefined();
      expect(session?.name).toBe('Test Session');
      expect(session?.id).toBe('session-1');
    });

    it('should update lastOpenedAt if session exists', async () => {
      await db.sessions.put({
        id: 'session-2',
        createdAt: 1000,
        lastOpenedAt: 1000,
        name: 'Existing',
      });

      const before = await db.sessions.get('session-2');
      const beforeLastOpened = before?.lastOpenedAt;

      // Wait a bit to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));
      await ensureSession('session-2');

      const after = await db.sessions.get('session-2');
      expect(after?.lastOpenedAt).toBeGreaterThan(beforeLastOpened!);
    });
  });

  describe('listSessions', () => {
    it('should return sessions ordered by lastOpenedAt descending', async () => {
      await db.sessions.bulkPut([
        { id: 's1', createdAt: 1000, lastOpenedAt: 1000 },
        { id: 's2', createdAt: 2000, lastOpenedAt: 3000 },
        { id: 's3', createdAt: 1500, lastOpenedAt: 2000 },
      ]);

      const sessions = await listSessions();

      expect(sessions[0].id).toBe('s2');
      expect(sessions[1].id).toBe('s3');
      expect(sessions[2].id).toBe('s1');
    });

    it('should return empty array when no sessions', async () => {
      const sessions = await listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('renameSession', () => {
    it('should rename session and update lastOpenedAt', async () => {
      await db.sessions.put({
        id: 'session-rename',
        createdAt: 1000,
        lastOpenedAt: 1000,
        name: 'Old Name',
      });

      await renameSession('session-rename', 'New Name');

      const session = await db.sessions.get('session-rename');
      expect(session?.name).toBe('New Name');
      expect(session?.lastOpenedAt).toBeGreaterThan(1000);
    });
  });

  describe('deleteSession', () => {
    it('should delete session and its snapshots', async () => {
      await db.sessions.put({
        id: 'session-delete',
        createdAt: 1000,
        lastOpenedAt: 1000,
      });
      await db.snapshots.bulkPut([
        {
          id: 'snap1',
          sessionId: 'session-delete',
          title: 'Snap 1',
          createdAt: 1000,
          updatedAt: 1000,
          messages: [],
          panelVisible: true,
          backendProjectPath: null,
          uploadedFilesMeta: [],
          formData: { apiKey: '' } as any,
        },
        {
          id: 'snap2',
          sessionId: 'session-delete',
          title: 'Snap 2',
          createdAt: 2000,
          updatedAt: 2000,
          messages: [],
          panelVisible: true,
          backendProjectPath: null,
          uploadedFilesMeta: [],
          formData: { apiKey: '' } as any,
        },
      ]);

      await deleteSession('session-delete');

      const session = await db.sessions.get('session-delete');
      const snapshots = await db.snapshots.where({ sessionId: 'session-delete' }).toArray();

      expect(session).toBeUndefined();
      expect(snapshots).toHaveLength(0);
    });
  });

  describe('createSnapshot', () => {
    it('should create a snapshot with generated id', async () => {
      await db.sessions.put({
        id: 'session-snap',
        createdAt: 1000,
        lastOpenedAt: 1000,
      });

      const snapshot = await createSnapshot('session-snap', 'My Snapshot', {
        messages: [],
        panelVisible: true,
        backendProjectPath: null,
        uploadedFilesMeta: [],
        formData: { apiKey: '' } as any,
      });

      expect(snapshot.id).toMatch(/^session-snap-\d+$/);
      expect(snapshot.title).toBe('My Snapshot');
      expect(snapshot.sessionId).toBe('session-snap');
    });

    it('should update session lastOpenedAt when creating snapshot', async () => {
      await db.sessions.put({
        id: 'session-snap2',
        createdAt: 1000,
        lastOpenedAt: 1000,
      });

      await createSnapshot('session-snap2', 'Snapshot', {
        messages: [],
        panelVisible: true,
        backendProjectPath: null,
        uploadedFilesMeta: [],
        formData: { apiKey: '' } as any,
      });

      const session = await db.sessions.get('session-snap2');
      expect(session?.lastOpenedAt).toBeGreaterThan(1000);
    });
  });

  describe('updateSnapshot', () => {
    it('should update snapshot fields', async () => {
      await db.snapshots.put({
        id: 'snap-update',
        sessionId: 'session-1',
        title: 'Original',
        createdAt: 1000,
        updatedAt: 1000,
        messages: [],
        panelVisible: true,
        backendProjectPath: null,
        uploadedFilesMeta: [],
        formData: { apiKey: '' } as any,
      });

      await updateSnapshot('snap-update', { title: 'Updated', panelVisible: false });

      const snapshot = await db.snapshots.get('snap-update');
      expect(snapshot?.title).toBe('Updated');
      expect(snapshot?.panelVisible).toBe(false);
      expect(snapshot?.updatedAt).toBeGreaterThan(1000);
    });
  });

  describe('listSnapshots', () => {
    it('should list snapshots for a session', async () => {
      await db.snapshots.bulkPut([
        {
          id: 'snap-list-1',
          sessionId: 'session-list',
          title: 'Snap 1',
          createdAt: 1000,
          updatedAt: 1000,
          messages: [],
          panelVisible: true,
          backendProjectPath: null,
          uploadedFilesMeta: [],
          formData: { apiKey: '' } as any,
        },
        {
          id: 'snap-list-2',
          sessionId: 'session-list',
          title: 'Snap 2',
          createdAt: 2000,
          updatedAt: 2000,
          messages: [],
          panelVisible: true,
          backendProjectPath: null,
          uploadedFilesMeta: [],
          formData: { apiKey: '' } as any,
        },
        {
          id: 'snap-other',
          sessionId: 'session-other',
          title: 'Other',
          createdAt: 3000,
          updatedAt: 3000,
          messages: [],
          panelVisible: true,
          backendProjectPath: null,
          uploadedFilesMeta: [],
          formData: { apiKey: '' } as any,
        },
      ]);

      const snapshots = await listSnapshots('session-list');
      expect(snapshots).toHaveLength(2);
      expect(snapshots.map((s) => s.id)).toContain('snap-list-1');
      expect(snapshots.map((s) => s.id)).toContain('snap-list-2');
    });
  });

  describe('getSnapshot', () => {
    it('should get snapshot by id', async () => {
      await db.snapshots.put({
        id: 'snap-get',
        sessionId: 'session-1',
        title: 'Get Me',
        createdAt: 1000,
        updatedAt: 1000,
        messages: [],
        panelVisible: true,
        backendProjectPath: null,
        uploadedFilesMeta: [],
        formData: { apiKey: '' } as any,
      });

      const snapshot = await getSnapshot('snap-get');
      expect(snapshot?.title).toBe('Get Me');
    });

    it('should return undefined for non-existent snapshot', async () => {
      const snapshot = await getSnapshot('non-existent');
      expect(snapshot).toBeUndefined();
    });
  });

  describe('deleteSnapshot', () => {
    it('should delete snapshot by id', async () => {
      await db.snapshots.put({
        id: 'snap-delete',
        sessionId: 'session-1',
        title: 'Delete Me',
        createdAt: 1000,
        updatedAt: 1000,
        messages: [],
        panelVisible: true,
        backendProjectPath: null,
        uploadedFilesMeta: [],
        formData: { apiKey: '' } as any,
      });

      await deleteSnapshot('snap-delete');

      const snapshot = await db.snapshots.get('snap-delete');
      expect(snapshot).toBeUndefined();
    });
  });

  describe('renameSnapshot', () => {
    it('should rename snapshot and return updated snapshot', async () => {
      await db.snapshots.put({
        id: 'snap-rename',
        sessionId: 'session-1',
        title: 'Old Title',
        createdAt: 1000,
        updatedAt: 1000,
        messages: [],
        panelVisible: true,
        backendProjectPath: null,
        uploadedFilesMeta: [],
        formData: { apiKey: '' } as any,
      });

      const result = await renameSnapshot('snap-rename', 'New Title');

      expect(result?.title).toBe('New Title');
      expect(result?.updatedAt).toBeGreaterThan(1000);
    });
  });

  describe('clearSnapshots', () => {
    it('should clear all snapshots for a session', async () => {
      await db.snapshots.bulkPut([
        {
          id: 'snap-clear-1',
          sessionId: 'session-clear',
          title: 'Clear 1',
          createdAt: 1000,
          updatedAt: 1000,
          messages: [],
          panelVisible: true,
          backendProjectPath: null,
          uploadedFilesMeta: [],
          formData: { apiKey: '' } as any,
        },
        {
          id: 'snap-clear-2',
          sessionId: 'session-clear',
          title: 'Clear 2',
          createdAt: 2000,
          updatedAt: 2000,
          messages: [],
          panelVisible: true,
          backendProjectPath: null,
          uploadedFilesMeta: [],
          formData: { apiKey: '' } as any,
        },
        {
          id: 'snap-keep',
          sessionId: 'session-keep',
          title: 'Keep',
          createdAt: 3000,
          updatedAt: 3000,
          messages: [],
          panelVisible: true,
          backendProjectPath: null,
          uploadedFilesMeta: [],
          formData: { apiKey: '' } as any,
        },
      ]);

      await clearSnapshots('session-clear');

      const cleared = await db.snapshots.where({ sessionId: 'session-clear' }).toArray();
      const kept = await db.snapshots.where({ sessionId: 'session-keep' }).toArray();

      expect(cleared).toHaveLength(0);
      expect(kept).toHaveLength(1);
    });
  });
});
