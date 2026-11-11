/** Database migrations, seeding, dedup and transaction behaviour. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateSchema, openDatabase, schemaVersion } from '../src/db/db.ts';
import { seedReferenceData } from '../src/seed.ts';
import { insertCandles, getCandles, type CandleWrite } from '../src/db/repoSeries.ts';
import { withTx } from '../src/db/tx.ts';
import { listStrategies, listConditions } from '../src/db/repoOps.ts';

function freshDb() {
  return openDatabase({ path: ':memory:' });
}

function candle(ts: number, overrides: Partial<CandleWrite> = {}): CandleWrite {
  return {
    instrument_id: 'eq-reliance',
    timeframe: '1D',
    ts,
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 1_000,
    source_provider: 'demo',
    source_origin: 'SIMULATED',
    is_demo: true,
    quality_status: 'VERIFIED',
    is_complete: true,
    ...overrides,
  };
}

test('migrations are idempotent and record a version', () => {
  const db = freshDb();
  // openDatabase migrates on connect, so the version is already stamped.
  assert.equal(schemaVersion(db), 1);
  migrateSchema(db);
  assert.equal(schemaVersion(db), 1);
  migrateSchema(db); // second run must not throw
  assert.equal(schemaVersion(db), 1);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const names = tables.map((t) => t.name);
  for (const expected of ['markets', 'instruments', 'candles', 'opportunities', 'strategies', 'backtest_results', 'provider_status']) {
    assert.ok(names.includes(expected), `missing table ${expected}`);
  }
  db.close();
});

test('seedReferenceData is idempotent (no duplicate markets/instruments/strategies)', () => {
  const db = freshDb();
  migrateSchema(db);
  seedReferenceData(db);
  const first = {
    markets: (db.prepare('SELECT COUNT(*) c FROM markets').get() as { c: number }).c,
    instruments: (db.prepare('SELECT COUNT(*) c FROM instruments').get() as { c: number }).c,
    strategies: listStrategies(db).length,
  };
  seedReferenceData(db);
  const second = {
    markets: (db.prepare('SELECT COUNT(*) c FROM markets').get() as { c: number }).c,
    instruments: (db.prepare('SELECT COUNT(*) c FROM instruments').get() as { c: number }).c,
    strategies: listStrategies(db).length,
  };
  assert.deepEqual(second, first);
  assert.ok(first.instruments >= 40, 'the shared universe must be seeded');
  assert.ok(first.strategies >= 5);

  const conditions = listConditions(db, listStrategies(db)[0].id);
  assert.ok(conditions.ENTRY.length > 0, 'strategies carry entry conditions');
  db.close();
});

test('candle inserts deduplicate on the (instrument, timeframe, ts) key', () => {
  const db = freshDb();
  seedReferenceData(db); // candles reference instruments (foreign key)
  const rows = [candle(1_767_225_600), candle(1_767_312_000), candle(1_767_398_400)];
  const first = insertCandles(db, rows);
  assert.equal(first.inserted, 3);
  assert.equal(first.duplicates, 0);

  const repeat = insertCandles(db, rows);
  assert.equal(repeat.inserted, 0, 're-ingest must not duplicate');
  assert.equal(repeat.duplicates, 3);

  const stored = getCandles(db, { instrumentId: 'eq-reliance', timeframe: '1D', limit: 100, ascending: true });
  assert.equal(stored.length, 3);
  db.close();
});

test('withTx commits on success, rolls back on error and joins nested calls', () => {
  const db = freshDb();
  seedReferenceData(db); // candles reference instruments (foreign key)

  withTx(db, () => {
    insertCandles(db, [candle(1_767_225_600)]);
    // Nested call joins the outer transaction instead of opening a second one.
    insertCandles(db, [candle(1_767_312_000)]);
  });
  assert.equal(getCandles(db, { instrumentId: 'eq-reliance', timeframe: '1D', limit: 10 }).length, 2);

  assert.throws(() =>
    withTx(db, () => {
      insertCandles(db, [candle(1_767_398_400)]);
      throw new Error('boom');
    }),
  );
  assert.equal(
    getCandles(db, { instrumentId: 'eq-reliance', timeframe: '1D', limit: 10 }).length,
    2,
    'failed transaction must roll back',
  );
  db.close();
});
