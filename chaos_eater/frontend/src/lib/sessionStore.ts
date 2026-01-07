import Dexie, { type Table } from 'dexie';
import type { Session, Snapshot } from '../types';

class CEAppDB extends Dexie {
  sessions!: Table<Session, string>;
  snapshots!: Table<Snapshot, string>;

  constructor() {
    super('ChaosEaterDB');
    this.version(1).stores({
      sessions: 'id, lastOpenedAt',
      snapshots: 'id, sessionId, updatedAt, createdAt',
    });
  }
}

export const db = new CEAppDB();
