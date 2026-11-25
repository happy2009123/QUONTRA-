/** Platform user accounts — email identity plus scrypt password hash. */

import type { Db } from './db.ts';

export interface UserRow {
  id: string;
  password_hash: string;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
}

/** User shape exposed over the API (never includes the password hash). */
export interface PublicUser {
  userId: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    userId: row.id,
    email: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export function getUserById(db: Db, id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function insertUser(
  db: Db,
  user: { id: string; passwordHash: string; displayName: string | null; createdAt: string },
): void {
  db.prepare(
    'INSERT INTO users (id, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)',
  ).run(user.id, user.passwordHash, user.displayName, user.createdAt);
}

export function updateLastLogin(db: Db, id: string, at: string): void {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(at, id);
}
