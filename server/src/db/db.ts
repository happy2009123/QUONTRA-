/** Database connection, pragmas and idempotent migrations. */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { withTx } from './tx.ts';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts';
import { log } from '../lib/logger.ts';

export type Db = DatabaseSync;

export interface OpenOptions {
  path: string;
  /** Apply schema when the connection opens (default true). */
  migrate?: boolean;
}

/**
 * Opens a SQLite database with the pragmas the platform relies on:
 * WAL for concurrent reads during ingestion, foreign keys for referential
 * integrity and a busy timeout so writers do not fail under load.
 */
export function openDatabase(options: OpenOptions): Db {
  const { path, migrate = true } = options;
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  if (migrate) migrateSchema(db);
  return db;
}

/**
 * Applies the schema. Safe to call repeatedly: every DDL statement uses
 * IF NOT EXISTS and the applied version is recorded in schema_migrations.
 */
export function migrateSchema(db: Db): void {
  withTx(db, () => {
    db.exec(SCHEMA_SQL);
    const row = db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(SCHEMA_VERSION) as { version: number } | undefined;
    if (!row) {
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        SCHEMA_VERSION,
        new Date().toISOString(),
      );
      log.info('schema migrated', { version: SCHEMA_VERSION });
    }
  });
}

/** Current schema version (0 when nothing has been applied). */
export function schemaVersion(db: Db): number {
  try {
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
    return row?.v ?? 0;
  } catch {
    return 0;
  }
}

/** Lists index names on a table — used by tests to assert time-series indexes. */
export function tableIndexes(db: Db, table: string): string[] {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[];
  return rows.map((r) => r.name);
}
