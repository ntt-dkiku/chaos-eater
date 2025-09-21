import { db } from './sessionStore';

function safeFormData(formData) {
  const { apiKey, ...rest } = formData || {};
  return { ...rest, apiKey: '' }; // do not persist secrets
}

export async function ensureSession(sessionId, name) {
  const now = Date.now();
  const exists = await db.sessions.get(sessionId);
  if (!exists) {
    await db.sessions.put({ id: sessionId, createdAt: now, lastOpenedAt: now, name });
  } else {
    await db.sessions.update(sessionId, { lastOpenedAt: now });
  }
}

export async function listSessions() {
  return db.sessions.orderBy('lastOpenedAt').reverse().toArray();
}

export async function renameSession(sessionId, name) {
  await db.sessions.update(sessionId, { name, lastOpenedAt: Date.now() });
}

export async function deleteSession(sessionId) {
  await db.transaction('rw', db.sessions, db.snapshots, async () => {
    await db.snapshots.where({ sessionId }).delete();
    await db.sessions.delete(sessionId);
  });
}

export async function createSnapshot(sessionId, title, payload) {
  const ts = Date.now();
  const id = `${sessionId}-${ts}`;
  const row = {
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

export async function updateSnapshot(id, patch) {
  const updatedAt = Date.now();
  await db.snapshots.update(id, { ...patch, updatedAt });
}

export async function listSnapshots(sessionId) {
  return db.snapshots.where('sessionId').equals(sessionId).toArray();
}

export async function getSnapshot(id) {
  return db.snapshots.get(id);
}
