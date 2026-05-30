import { createHmac, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();

export type JwtUser = { id: string; agency_id: string; client_id: string | null; email: string; role: 'agency_admin' | 'marketer' | 'client' };

export function hashPassword(password: string): string {
  const salt = randomUUID();
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [, salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64));
}

export function signJwt(user: JwtUser, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: user.id, user, exp: Math.floor(Date.now() / 1000) + 7 * 86400 }));
  const signature = hmac(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtUser | null {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;
  if (hmac(`${header}.${payload}`, secret) !== signature) return null;
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp: number; user: JwtUser };
  if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
  return parsed.user;
}

function hmac(value: string, secret: string): string {
  return createHmac('sha256', encoder.encode(secret)).update(value).digest('base64url');
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}
