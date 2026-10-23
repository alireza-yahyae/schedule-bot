// Entry point: Telegram webhook + per-minute cron + /health.

import type { Env, TgUpdate } from './types.ts';
import { Telegram } from './telegram.ts';
import { runScheduler } from './scheduler.ts';
import { legacyEnv, routeApi, routeUpdate, tickAll } from './gateway.ts';
import { countUsers } from './registry.ts';

// Each person's private database is a Durable Object of this class.
export { Tenant } from './tenant.ts';

/** Constant-time string comparison (so the secret cannot be guessed by timing). */
function safeEqual(a: string, b: string): boolean {
  if (!b) return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      try {
        const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'last_tick'`).first<{ value: string }>();
        const now = Math.floor(Date.now() / 1000);
        const lastTick = row ? Number(row.value) : null;
        return Response.json({
          ok: true,
          time: new Date().toISOString(),
          scheduler_last_run_seconds_ago: lastTick === null ? null : now - lastTick,
          users: await countUsers(env.DB).catch(() => null),
        });
      } catch {
        return Response.json({ ok: false, error: 'database not reachable' }, { status: 500 });
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return routeApi(request, env);
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      // Only Telegram knows the secret token.
      const given = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
      if (!safeEqual(given, env.WEBHOOK_SECRET ?? '')) {
        return new Response('forbidden', { status: 403 });
      }
      let update: TgUpdate;
      try {
        update = (await request.json()) as TgUpdate;
      } catch {
        return new Response('bad request', { status: 400 });
      }
      const now = Math.floor(Date.now() / 1000);
      // Answer Telegram immediately; do the work in the background.
      ctx.waitUntil(
        routeUpdate(env, update, now).catch((e) => {
          console.error('update failed', e instanceof Error ? e.message : String(e));
        }),
      );
      return new Response('ok');
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const tg = new Telegram(env.BOT_TOKEN);
    const now = Math.floor(Date.now() / 1000);
    // the owner's reminders, then everybody else's (each in their own private database)
    ctx.waitUntil(
      runScheduler(legacyEnv(env), tg, now).catch((e) => {
        console.error('scheduler failed', e instanceof Error ? e.message : String(e));
      }),
    );
    ctx.waitUntil(
      tickAll(env, now).catch((e) => {
        console.error('tick all failed', e instanceof Error ? e.message : String(e));
      }),
    );
  },
};
