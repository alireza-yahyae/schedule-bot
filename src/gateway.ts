// The front door of the public bot. Telegram messages and Mini App requests come here and go to the right place:
// the bot owner is served directly (the original database); everybody else has a private database (a Durable Object).

import { handleApi } from './api.ts';
import { verifyInitData } from './auth.ts';
import { handleUpdate } from './handlers.ts';
import { activeUserIds, countUsers, createUser, getUser, maxUsers, ownerOfPartner, touchUser } from './registry.ts';
import { Telegram } from './telegram.ts';
import type { Env, TgUpdate } from './types.ts';

/** The bot owner's own environment: the main database doubles as the registry. */
export const legacyEnv = (env: Env): Env => ({ ...env, REGISTRY: env.DB });

type Target = { kind: 'legacy' } | { kind: 'tenant'; userId: number } | { kind: 'new' } | { kind: 'ignore' };

const isOwnerId = (env: Env, id: number) => String(id) === String(env.OWNER_ID).trim();

// (the people limit and why: see registry.ts)
const WELCOME_NEW = (name: string) =>
  `سلام ${name || 'دوست من'} 👋\n\nاینجا برنامه‌ی کلاس و کار، یادآوری، عادت‌ها، آمار و پیام به پارتنرت رو یه‌جا داری.\n\n` +
  `🔒 هر نفر دیتابیس جداگانه‌ی خودش رو داره و بقیه داده‌ی تو رو نمی‌بینن. هر وقت خواستی با /delete_me همه‌ی اطلاعاتت پاک می‌شه.`;
const FULL = 'ظرفیت ربات فعلاً پر شده. چند وقت دیگه دوباره امتحان کن 🙏';
const UNKNOWN = 'برای شروع، /start رو بزن 🙂';

function stubOf(env: Env, userId: number) {
  return env.TENANT.get(env.TENANT.idFromName(String(userId)));
}

export async function callTenant(env: Env, userId: number, path: string, init: { body?: string; method?: string } = {}): Promise<Response> {
  return await stubOf(env, userId).fetch(`https://tenant${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: { 'X-Tenant-User': String(userId), 'Content-Type': 'application/json' },
    body: init.body,
  });
}

/** Who should handle this person's message? */
async function resolve(env: Env, id: number, text: string): Promise<{ target: Target; text?: string }> {
  if (isOwnerId(env, id)) return { target: { kind: 'legacy' } };
  const user = await getUser(env.DB, id);
  if (user) return { target: user.blocked ? { kind: 'ignore' } : { kind: 'tenant', userId: id } };

  // a partner: the link is remembered when they connect
  const owner = await ownerOfPartner(env.DB, id);
  if (owner !== null) return { target: isOwnerId(env, owner) ? { kind: 'legacy' } : { kind: 'tenant', userId: owner } };

  // someone who opens a partner invite link for the first time: pair_<ownerId>_<code>
  const m = /^\/start\s+pair_(\d{1,15})_([A-Za-z0-9]{4,32})$/.exec(text);
  if (m) {
    const ownerId = Number(m[1]);
    if (await getUser(env.DB, ownerId)) return { target: { kind: 'tenant', userId: ownerId }, text: `/start pair_${m[2]}` };
    return { target: { kind: 'ignore' } };
  }
  // ... or an invite to the bot owner (no id in the link) / a typed /pair code
  const old = /^\/(?:start\s+pair_|pair\s+)([A-Za-z0-9]{4,32})$/.exec(text);
  if (old) {
    const row = await env.DB.prepare(`SELECT pairing_code FROM partner_settings WHERE id = 1`).first<{ pairing_code: string | null }>();
    if (row && row.pairing_code && row.pairing_code.toUpperCase() === old[1].toUpperCase()) return { target: { kind: 'legacy' } };
  }
  return { target: { kind: 'new' } };
}

function senderOf(update: TgUpdate): { id: number; first_name?: string; username?: string; chatType?: string; text: string } | null {
  const cb = update.callback_query;
  if (cb) return { id: cb.from.id, first_name: cb.from.first_name, text: '' };
  const m = update.message;
  if (!m || !m.from) return null;
  return { id: m.from.id, first_name: m.from.first_name, username: (m.from as { username?: string }).username, chatType: m.chat.type, text: (m.text ?? '').trim() };
}

export async function routeUpdate(env: Env, update: TgUpdate, now: number): Promise<void> {
  const tg = new Telegram(env.BOT_TOKEN);
  const s = senderOf(update);
  if (!s) return;

  // Buttons that belong to the front door (deleting your data).
  const data = update.callback_query?.data ?? '';
  if (data.startsWith('gw:')) {
    await handleGatewayButton(env, tg, update, now);
    return;
  }

  const { target, text } = await resolve(env, s.id, s.text);
  if (target.kind === 'ignore') return;

  if (target.kind === 'legacy') {
    if (s.text === '/users' && isOwnerId(env, s.id)) {
      await tg.sendMessage(s.id, `👥 ${await countUsers(env.DB)} نفر از ربات استفاده می‌کنن (حداکثر ${maxUsers(env)}).`);
      return;
    }
    await handleUpdate(legacyEnv(env), tg, update, now);
    return;
  }

  if (target.kind === 'new') {
    if (update.callback_query || s.chatType !== 'private') return;
    if (!/^\/start(\s|@|$)/.test(s.text)) {
      await tg.sendMessage(s.id, UNKNOWN);
      return;
    }
    if ((await countUsers(env.DB)) >= maxUsers(env)) {
      await tg.sendMessage(s.id, FULL);
      return;
    }
    await createUser(env.DB, s.id, s.first_name ?? null, s.username ?? null, now);
    await tg.sendMessage(s.id, WELCOME_NEW(s.first_name ?? ''));
    await forward(env, s.id, update, undefined);
    return;
  }

  // a person with a private database (or a partner of one)
  if (s.text === '/delete_me' && target.userId === s.id) {
    await tg.sendMessage(s.id, '⚠️ همه‌ی برنامه، عادت‌ها، آمار و تنظیماتت برای همیشه پاک می‌شه و برنمی‌گرده. مطمئنی؟', [
      [{ text: '🗑 آره، همه‌چیز پاک بشه', callback_data: 'gw:del:yes' }],
      [{ text: 'نه، منصرف شدم', callback_data: 'gw:del:no' }],
    ]);
    return;
  }
  if (target.userId === s.id) await touchUser(env.DB, s.id, now);
  await forward(env, target.userId, update, text);
}

/** Send the update to the person's database; `text` replaces the message text (used for partner invite links). */
async function forward(env: Env, userId: number, update: TgUpdate, text: string | undefined): Promise<void> {
  let u = update;
  if (text !== undefined && update.message) u = { ...update, message: { ...update.message, text } };
  const r = await callTenant(env, userId, '/__update', { body: JSON.stringify(u) });
  if (!r.ok) console.error('tenant update failed', userId, r.status);
}

async function handleGatewayButton(env: Env, tg: Telegram, update: TgUpdate, _now: number): Promise<void> {
  const cb = update.callback_query;
  if (!cb) return;
  const chatId = cb.message?.chat.id ?? cb.from.id;
  const msgId = cb.message?.message_id;
  const user = await getUser(env.DB, cb.from.id);
  await tg.answerCallbackQuery(cb.id);
  if (!user || isOwnerId(env, cb.from.id)) return;
  if (cb.data === 'gw:del:no') {
    if (msgId) await tg.editMessageText(chatId, msgId, 'باشه، چیزی پاک نشد 👍');
    return;
  }
  if (cb.data === 'gw:del:yes') {
    const del = await callTenant(env, user.id, '/__delete', { body: '{}' });
    if (!del.ok) {
      // Do not remove the account row while the person's data is still there.
      console.error('tenant delete failed', user.id, del.status);
      if (msgId) await tg.editMessageText(chatId, msgId, 'حذف انجام نشد، دوباره تلاش کن.');
      return;
    }
    await env.DB.prepare(`DELETE FROM partner_links WHERE owner_id = ?1`).bind(user.id).run();
    await env.DB.prepare(`DELETE FROM users WHERE id = ?1`).bind(user.id).run();
    if (msgId) await tg.editMessageText(chatId, msgId, '✅ همه‌ی اطلاعاتت پاک شد. هر وقت خواستی دوباره با /start شروع کن.');
  }
}

/** Mini App requests: the person's own database answers. */
export async function routeApi(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization') ?? '';
  const now = Math.floor(Date.now() / 1000);
  const user = auth.startsWith('tma ') ? await verifyInitData(auth.slice(4), env.BOT_TOKEN, now) : null;
  if (!user) return handleApi(request, legacyEnv(env)); // answers 401 in the usual way
  const { target } = await resolve(env, user.id, '');
  if (target.kind === 'legacy') return handleApi(request, legacyEnv(env));
  if (target.kind === 'tenant') {
    if (target.userId === user.id) await touchUser(env.DB, user.id, now);
    const headers = new Headers(request.headers);
    headers.set('X-Tenant-User', String(target.userId));
    return await stubOf(env, target.userId).fetch(new Request(request, { headers }));
  }
  return Response.json({ error: 'اول توی ربات /start رو بزن، بعد برنامه رو باز کن.' }, { status: 403 });
}

/** Every minute: the reminders of everybody who uses the bot. */
export async function tickAll(env: Env, now: number): Promise<void> {
  const ids = await activeUserIds(env.DB, now, maxUsers(env));
  const results = await Promise.allSettled(ids.map((id) => callTenant(env, id, '/__tick', { method: 'POST', body: '{}' })));
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error('tick failed', ids[i], r.reason instanceof Error ? r.reason.message : String(r.reason));
    else if (!r.value.ok) console.error('tick failed', ids[i], r.value.status);
  });
}
