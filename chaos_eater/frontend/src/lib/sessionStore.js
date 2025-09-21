import Dexie from 'dexie';

// message schema
export const ChatMessage = {};

// snapshot schema
export const Snapshot = {};

// session schema
export const Session = {};

class CEAppDB extends Dexie {
  constructor() {
    super('ChaosEaterDB');
    this.version(1).stores({
      sessions: 'id, lastOpenedAt',
      snapshots: 'id, sessionId, updatedAt, createdAt',
    });
    this.sessions = this.table('sessions');
    this.snapshots = this.table('snapshots');
  }
}

export const db = new CEAppDB();