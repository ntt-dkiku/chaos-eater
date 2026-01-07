import { db } from './sessionStore';
import type { Session, Snapshot, FormData } from '../types';

type SafeFormData = Omit<FormData, 'apiKey'> & { apiKey: '' };

export function safeFormData(formData: FormData | null | undefined): SafeFormData {
  if (!formData) {
    return { apiKey: '' } as SafeFormData;
  }
  const { apiKey, ...rest } = formData;
  return { ...rest, apiKey: '' }; // do not persist secrets
}

export async function ensureSession(sessionId: string, name?: string): Promise<void> {
  const now = Date.now();
  const exists = await db.sessions.get(sessionId);
  if (!exists) {
    await db.sessions.put({ id: sessionId, createdAt: now, lastOpenedAt: now, name });
  } else {
    await db.sessions.update(sessionId, { lastOpenedAt: now });
  }
}

export async function listSessions(): Promise<Session[]> {
  return db.sessions.orderBy('lastOpenedAt').reverse().toArray();
}

export async function renameSession(sessionId: string, name: string): Promise<void> {
  await db.sessions.update(sessionId, { name, lastOpenedAt: Date.now() });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.snapshots, async () => {
    await db.snapshots.where({ sessionId }).delete();
    await db.sessions.delete(sessionId);
  });
}

export interface SnapshotPayload {
  jobId?: string;
  jobWorkDir?: string;
  messages: Snapshot['messages'];
  panelVisible: boolean;
  backendProjectPath: string | null;
  uploadedFilesMeta: Snapshot['uploadedFilesMeta'];
  formData: SafeFormData;
}

export async function createSnapshot(
  sessionId: string,
  title: string,
  payload: SnapshotPayload
): Promise<Snapshot> {
  const ts = Date.now();
  const id = `${sessionId}-${ts}`;
  const row: Snapshot = {
    id,
    sessionId,
    title,
    createdAt: ts,
    updatedAt: ts,
    ...payload,
  };
  await db.snapshots.put(row);
  await db.sessions.update(sessionId, { lastOpenedAt: ts });
  return row;
}

export async function updateSnapshot(id: string, patch: Partial<Snapshot>): Promise<void> {
  const updatedAt = Date.now();
  await db.snapshots.update(id, { ...patch, updatedAt });
}

export async function listSnapshots(sessionId: string): Promise<Snapshot[]> {
  return db.snapshots.where('sessionId').equals(sessionId).toArray();
}

export async function getSnapshot(id: string): Promise<Snapshot | undefined> {
  return db.snapshots.get(id);
}

export async function deleteSnapshot(id: string): Promise<void> {
  await db.snapshots.delete(id);
}

export async function renameSnapshot(id: string, title: string): Promise<Snapshot | undefined> {
  const updatedAt = Date.now();
  await db.snapshots.update(id, { title, updatedAt });
  return db.snapshots.get(id);
}

export async function clearSnapshots(sessionId: string): Promise<void> {
  await db.snapshots.where('sessionId').equals(sessionId).delete();
}
