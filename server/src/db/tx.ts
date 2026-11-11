import type { Db } from './db.ts';

/**
 * Runs `fn` inside a SQLite transaction. If a transaction is already open on
 * this connection the call joins it instead of nesting (node:sqlite throws on
 * nested BEGIN), so repository helpers compose safely with seed scripts.
 */
export function withTx<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
