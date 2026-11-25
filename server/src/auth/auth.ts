/**
 * Authentication primitives: scrypt password hashing, HMAC-signed session
 * cookies and request guards for the paper-trading API.
 *
 * Sessions are stateless — a signed payload (user id + expiry) lives in an
 * httpOnly cookie and is verified with SESSION_SECRET, so sign-ins survive
 * serverless cold starts. No session rows are stored server-side; logout
 * simply clears the cookie. Passwords use scrypt with a per-user random salt.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config/env.ts';
import type { RequestContext } from '../api/http.ts';
import type { Db } from '../db/db.ts';
import { AppError } from '../lib/errors.ts';
import { getUserById, toPublicUser, type PublicUser } from '../db/repoAuth.ts';

export const SESSION_COOKIE = 'quantora_session';
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 32;

// ── Passwords ────────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(password, Buffer.from(parts[4], 'base64'), expected.length, { N: n, r, p });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ── Session tokens ───────────────────────────────────────────────────────

interface SessionPayload {
  /** User id (normalized email). */
  u: string;
  /** Expiry, unix seconds. */
  e: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payloadB64: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payloadB64).digest());
}

export function createSessionToken(userId: string, secret: string, nowMs = Date.now()): string {
  const payload: SessionPayload = { u: userId, e: Math.floor(nowMs / 1000) + SESSION_TTL_SEC };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Returns the user id carried by a valid, unexpired token (null otherwise). */
export function readSessionToken(token: string, secret: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromB64url(payloadB64).toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.u !== 'string' || typeof payload.e !== 'number') return null;
  if (payload.e < Math.floor(Date.now() / 1000)) return null;
  return payload.u;
}

// ── Cookies ──────────────────────────────────────────────────────────────

function secureSuffix(config: AppConfig): string {
  return config.env === 'production' ? '; Secure' : '';
}

/** Sets the signed session cookie on the response (httpOnly, 30 days). */
export function setSessionCookie(ctx: RequestContext, config: AppConfig, userId: string): void {
  const token = createSessionToken(userId, config.sessionSecret);
  ctx.res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${secureSuffix(config)}`,
  );
}

/** Clears the session cookie (stateless sessions — nothing to revoke). */
export function clearSessionCookie(ctx: RequestContext, config: AppConfig): void {
  ctx.res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureSuffix(config)}`,
  );
}

function sessionUserIdFromRequest(ctx: RequestContext, config: AppConfig): string | null {
  const header = ctx.req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const token = part.slice(eq + 1).trim();
    if (!token) return null;
    return readSessionToken(token, config.sessionSecret);
  }
  return null;
}

// ── Request guards ───────────────────────────────────────────────────────

/** Resolves the signed-in user for this request, or null when signed out. */
export function getSessionUser(ctx: RequestContext, db: Db, config: AppConfig): PublicUser | null {
  const userId = sessionUserIdFromRequest(ctx, config);
  if (!userId) return null;
  const row = getUserById(db, userId);
  if (!row) return null;
  return toPublicUser(row);
}

/** Same as getSessionUser but throws UNAUTHORIZED when there is no session. */
export function requireSession(ctx: RequestContext, db: Db, config: AppConfig): PublicUser {
  const user = getSessionUser(ctx, db, config);
  if (!user) throw new AppError('UNAUTHORIZED', 'Sign in to continue');
  return user;
}
