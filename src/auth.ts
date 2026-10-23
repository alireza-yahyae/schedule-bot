// Validation of Telegram Mini App "initData" (HMAC-SHA256), as described in the Telegram docs.

const enc = new TextEncoder();

async function hmac(key: BufferSource, data: BufferSource): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, data);
}

function toHex(b: ArrayBuffer): string {
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

export interface WebUser {
  id: number;
  first_name?: string;
}

/**
 * Returns the Telegram user if (and only if) initData was really signed by Telegram
 * for THIS bot and is not older than maxAgeSec. Otherwise null.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  nowSec: number,
  maxAgeSec = 86400,
): Promise<WebUser | null> {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = await hmac(enc.encode('WebAppData'), enc.encode(botToken));
  const calc = toHex(await hmac(secret, enc.encode(dataCheck)));
  if (!safeEqual(calc, hash)) return null;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (nowSec - authDate > maxAgeSec || authDate - nowSec > 300) return null;
  try {
    const user = JSON.parse(params.get('user') ?? '');
    if (user && typeof user.id === 'number') return { id: user.id, first_name: user.first_name };
  } catch {
    return null;
  }
  return null;
}
