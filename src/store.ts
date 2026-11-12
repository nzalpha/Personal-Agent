import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

export type Turn = { role: 'user' | 'assistant'; content: string };
export type Job = { id: string; event_id: string; chat: string; sender: string; text: string; reply: string | null; attempts: number; next_at: number; state: string };

export class Store {
  directory: string;
  db: DatabaseSync;
  constructor(directory: string) {
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, 'agent.sqlite');
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS turns(seq INTEGER PRIMARY KEY, scope TEXT, role TEXT, content TEXT);
      CREATE TABLE IF NOT EXISTS cleared_turns(scope TEXT PRIMARY KEY, input_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, event_id TEXT UNIQUE, chat TEXT, sender TEXT, text TEXT,
        reply TEXT, attempts INTEGER DEFAULT 0, next_at INTEGER DEFAULT 0, state TEXT DEFAULT 'pending', last_error TEXT);
      CREATE TABLE IF NOT EXISTS voice_replies(key TEXT PRIMARY KEY, attachment TEXT, state TEXT NOT NULL DEFAULT 'new');
      CREATE TABLE IF NOT EXISTS whatsapp_outbox(key TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, state TEXT NOT NULL);`);
  }
  enqueue(job: Pick<Job, 'id' | 'event_id' | 'chat' | 'sender' | 'text'>): boolean {
    return this.db.prepare('INSERT OR IGNORE INTO jobs(id,event_id,chat,sender,text) VALUES(?,?,?,?,?)').run(job.id, job.event_id, job.chat, job.sender, job.text).changes > 0;
  }
  next(now = Date.now(), channel?: 'linq' | 'whatsapp'): Job | undefined {
    const filter = channel === 'whatsapp' ? " AND chat LIKE 'whatsapp:%'" : channel === 'linq' ? " AND chat NOT LIKE 'whatsapp:%'" : '';
    const job = this.db.prepare(`SELECT * FROM jobs WHERE state='pending'${filter} ORDER BY rowid LIMIT 1`).get() as Job | undefined;
    return job && job.next_at <= now ? job : undefined;
  }
  saveReply(id: string, reply: string) { this.db.prepare('UPDATE jobs SET reply=? WHERE id=?').run(reply, id); }
  hold(id: string) { this.db.prepare("UPDATE jobs SET state='needs_review',last_error='WhatsApp delivery requires review; not automatically resent' WHERE id=?").run(id); }
  retry(id: string, attempts: number, error: string) {
    this.db.prepare('UPDATE jobs SET attempts=?,next_at=?,state=?,last_error=? WHERE id=?').run(attempts, Date.now() + Math.min(60_000, 1000 * 2 ** attempts), attempts >= 3 ? 'failed' : 'pending', error, id);
  }
  finish(job: Job, reply: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.addTurn(job.sender, 'user', job.text);
      this.addTurn(job.sender, 'assistant', reply);
      this.db.prepare("UPDATE jobs SET state='accepted' WHERE id=?").run(job.id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  addTurn(scope: string, role: Turn['role'], content: string) {
    if (role === 'user') {
      const hash = createHash('sha256').update(content).digest('hex');
      const cleared = this.db.prepare('DELETE FROM cleared_turns WHERE scope=? AND input_hash=?').run(scope, hash);
      if (cleared.changes) content = '[The owner cleared conversation history or saved preferences.]';
    }
    this.db.prepare('INSERT INTO turns(scope,role,content) VALUES(?,?,?)').run(scope, role, content);
    this.db.prepare('DELETE FROM turns WHERE scope=? AND seq NOT IN (SELECT seq FROM turns WHERE scope=? ORDER BY seq DESC LIMIT 20)').run(scope, scope);
  }
  history(scope: string): Turn[] { return this.db.prepare('SELECT role,content FROM turns WHERE scope=? ORDER BY seq').all(scope) as Turn[]; }
  reset(scope: string, redactRequest?: string) {
    this.db.prepare('DELETE FROM turns WHERE scope=?').run(scope);
    if (redactRequest !== undefined) this.db.prepare('INSERT OR REPLACE INTO cleared_turns(scope,input_hash) VALUES(?,?)')
      .run(scope, createHash('sha256').update(redactRequest).digest('hex'));
  }
  // Compatibility with the presentation's Mem0 adapter; no legacy memory in this starter.
  memories(_scope: string): string[] { return []; }
  forget(_scope: string) {}
  forgetOne(_scope: string, _text: string) {}
  stats() { return this.db.prepare('SELECT state,COUNT(*) AS count FROM jobs GROUP BY state').all(); }
  close() { this.db.close(); }
}
