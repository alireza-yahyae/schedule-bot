// The list of people who use the public bot (lives in the main database) and who is whose partner.

import type { Env } from './types.ts';

export interface UserRow {
  id: number;
  first_name: string | null;
  username: string | null;
  created_at: number;
  last_seen: number;
  blocked: number;
}

/**
 * Default cap for people. Every person costs about 150 database rows read per minute (reminder check), i.e. ~200 000 a day;
 * the free Cloudflare plan allows 5 million a day, so about 20 people. On the paid plan ($5/month) raise MAX_USERS.
 */
export const DEFAULT_MAX_USERS = 20;
const RECENT_DAYS = 60;

export function maxUsers(env: Env): number {
  const n = Number(env.MAX_USERS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_USERS;
}

export async function getUser(db: D1Database, id: number): Promise<UserRow | null> {
  return await db.prepare(`SELECT id, first_name, username, created_at, last_seen, blocked FROM users WHERE id = ?1`).bind(id).first<UserRow>();
}

export async function countUsers(db: D1Database): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

export async function createUser(db: D1Database, id: number, firstName: string | null, username: string | null, now: number): Promise<void> {
  await db
    .prepare(`INSERT OR IGNORE INTO users (id, first_name, username, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(id, firstName, username, now, now)
    .run();
}

export async function touchUser(db: D1Database, id: number, now: number): Promise<void> {
  await db.prepare(`UPDATE users SET last_seen = ?1 WHERE id = ?2 AND last_seen < ?3`).bind(now, id, now - 3600).run();
}

/** People whose reminders are checked every minute: everyone who opened the bot in the last two months. */
export async function activeUserIds(db: D1Database, now: number, limit: number): Promise<number[]> {
  const rows = (
    await db
      .prepare(`SELECT id FROM users WHERE blocked = 0 AND last_seen > ?1 ORDER BY last_seen DESC LIMIT ?2`)
      .bind(now - RECENT_DAYS * 86400, limit)
      .all<{ id: number }>()
  ).results;
  return rows.map((r) => Number(r.id));
}

export async function ownerOfPartner(db: D1Database, partnerChatId: number): Promise<number | null> {
  const r = await db.prepare(`SELECT owner_id FROM partner_links WHERE partner_chat_id = ?1`).bind(partnerChatId).first<{ owner_id: number }>();
  return r ? Number(r.owner_id) : null;
}

/** Called by a person's database when a partner connects (REGISTRY is the main database). */
export async function linkPartner(env: Env, partnerChatId: number): Promise<void> {
  if (!env.REGISTRY) return;
  await env.REGISTRY.prepare(`INSERT OR REPLACE INTO partner_links (partner_chat_id, owner_id) VALUES (?1, ?2)`).bind(partnerChatId, Number(env.OWNER_ID)).run();
}

/** The owner this chat is already a partner of (or null). */
export async function partnerOwner(env: Env, partnerChatId: number): Promise<number | null> {
  if (!env.REGISTRY) return null;
  const r = await env.REGISTRY.prepare(`SELECT owner_id FROM partner_links WHERE partner_chat_id = ?1`).bind(partnerChatId).first<{ owner_id: number }>();
  return r ? Number(r.owner_id) : null;
}

export async function unlinkPartner(env: Env, partnerChatId: number | null): Promise<void> {
  if (!env.REGISTRY || partnerChatId === null) return;
  await env.REGISTRY.prepare(`DELETE FROM partner_links WHERE partner_chat_id = ?1 AND owner_id = ?2`).bind(partnerChatId, Number(env.OWNER_ID)).run();
}
