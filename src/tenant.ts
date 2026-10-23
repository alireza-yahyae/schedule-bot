// One private database per person: a Durable Object with its own SQLite storage.
// It runs the same code as the main bot (handlers, scheduler, API), with this person's database in place of D1
// and this person's Telegram id as the owner.

import { DoDatabase, type StorageLike } from './dosql.ts';
import { TENANT_MIGRATIONS } from './tenant-schema.generated.ts';
import { handleApi } from './api.ts';
import { handleUpdate } from './handlers.ts';
import { runScheduler } from './scheduler.ts';
import { Telegram } from './telegram.ts';
import type { Env, TgUpdate } from './types.ts';

/** Creates the tables on first use and adds new ones when a migration is added later. */
export function migrate(storage: StorageLike): void {
  try {
    storage.sql.exec('PRAGMA foreign_keys = ON').toArray();
  } catch {
    /* the default is fine too */
  }
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS tenant_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`).toArray();
  const done = new Set(storage.sql.exec(`SELECT name FROM tenant_migrations`).toArray().map((r) => String(r.name)));
  for (const m of TENANT_MIGRATIONS) {
    if (done.has(m.name)) continue;
    storage.transactionSync(() => {
      for (const s of m.statements) storage.sql.exec(s).toArray();
      storage.sql.exec(`INSERT INTO tenant_migrations (name, applied_at) VALUES (?1, ?2)`, m.name, Math.floor(Date.now() / 1000)).toArray();
    });
  }
}

interface DurableState {
  storage: StorageLike & { deleteAll(): Promise<void> };
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}

export class Tenant {
  private readonly state: DurableState;
  private readonly env: Env;
  private readonly db: DoDatabase;

  constructor(state: DurableState, env: Env) {
    this.state = state;
    this.env = env;
    this.db = new DoDatabase(state.storage);
    void state.blockConcurrencyWhile(async () => migrate(state.storage));
  }

  async fetch(request: Request): Promise<Response> {
    const userId = request.headers.get('X-Tenant-User') ?? '';
    if (!/^\d{1,15}$/.test(userId)) return new Response('bad tenant', { status: 400 });
    // The same code as the main bot, but on this person's database and with this person as the owner.
    const env: Env = { ...this.env, DB: this.db as unknown as D1Database, REGISTRY: this.env.DB, OWNER_ID: userId, TENANT_ID: userId };
    const url = new URL(request.url);
    const now = Math.floor(Date.now() / 1000);
    try {
      if (url.pathname === '/__update' && request.method === 'POST') {
        await handleUpdate(env, new Telegram(env.BOT_TOKEN), (await request.json()) as TgUpdate, now);
        return new Response('ok');
      }
      if (url.pathname === '/__tick') {
        await runScheduler(env, new Telegram(env.BOT_TOKEN), now);
        return new Response('ok');
      }
      if (url.pathname === '/__delete' && request.method === 'POST') {
        await this.state.storage.deleteAll();
        migrate(this.state.storage); // an empty, fresh database in case the person comes back
        return new Response('ok');
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env);
    } catch (e) {
      console.error('tenant failed', userId, url.pathname, e instanceof Error ? e.message : String(e));
      return new Response('error', { status: 500 });
    }
    return new Response('not found', { status: 404 });
  }
}
