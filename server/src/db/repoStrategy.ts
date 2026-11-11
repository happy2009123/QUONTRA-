/**
 * Persistence for user strategy configuration and saved presets.
 *
 * Tables are created idempotently with IF NOT EXISTS so the existing
 * schema/migrations are not modified. User configs are keyed by user_id
 * (there is no external auth provider in this build, so the user id comes
 * from the client settings / default desk).
 */

import type { Db } from './db.ts';
import { withTx } from './tx.ts';
import type {
  CombinationConfig,
  UserStrategyConfig,
  UserStrategyPreset,
} from '../lib/strategyTypes.ts';

const USER_STRATEGY_CONFIGS_SQL = `
CREATE TABLE IF NOT EXISTS user_strategy_configs (
  user_id            TEXT PRIMARY KEY,
  combination_json   TEXT NOT NULL,
  timeframes_json    TEXT NOT NULL,
  markets_json       TEXT NOT NULL,
  instruments_json   TEXT NOT NULL,
  min_risk_reward    REAL NOT NULL DEFAULT 1.0,
  min_liquidity      TEXT NOT NULL DEFAULT 'MEDIUM',
  max_spread_bps     REAL NOT NULL DEFAULT 10,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_strategy_configs_user ON user_strategy_configs(user_id);
`;

const USER_STRATEGY_PRESETS_SQL = `
CREATE TABLE IF NOT EXISTS user_strategy_presets (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  config_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_strategy_presets_user ON user_strategy_presets(user_id);
`;

export function ensureStrategyTables(db: Db): void {
  withTx(db, () => {
    db.exec(USER_STRATEGY_CONFIGS_SQL);
    db.exec(USER_STRATEGY_PRESETS_SQL);
  });
}

interface StoredConfig {
  user_id: string;
  combination_json: string;
  timeframes_json: string;
  markets_json: string;
  instruments_json: string;
  min_risk_reward: number;
  min_liquidity: string;
  max_spread_bps: number;
  strategies_json: string;
  updated_at: string;
}

export interface StoredUserStrategyConfig {
  userId: string;
  combination: CombinationConfig;
  timeframes: string[];
  markets: string[];
  instruments: string[];
  minRiskReward: number;
  minLiquidity: 'HIGH' | 'MEDIUM' | 'LOW';
  maxSpreadBps: number;
  updatedAt: string;
  strategies: UserStrategyConfig[];
}

export function saveUserStrategyConfig(db: Db, config: StoredUserStrategyConfig): void {
  ensureStrategyTables(db);
  withTx(db, () => {
    const existing = db
      .prepare('SELECT user_id FROM user_strategy_configs WHERE user_id = ?')
      .get(config.userId) as { user_id: string } | undefined;
    const now = new Date().toISOString();
    const strategiesJson = JSON.stringify(config.strategies);
    const combinationJson = JSON.stringify(config.combination);
    if (existing) {
      db.prepare(
        `UPDATE user_strategy_configs
         SET combination_json = ?, timeframes_json = ?, markets_json = ?, instruments_json = ?,
             min_risk_reward = ?, min_liquidity = ?, max_spread_bps = ?, updated_at = ?,
             strategies_json = ?
         WHERE user_id = ?`,
      ).run(
        combinationJson,
        JSON.stringify(config.timeframes),
        JSON.stringify(config.markets),
        JSON.stringify(config.instruments),
        config.minRiskReward,
        config.minLiquidity,
        config.maxSpreadBps,
        now,
        strategiesJson,
        config.userId,
      );
    } else {
      db.prepare(
        `INSERT INTO user_strategy_configs
         (user_id, combination_json, timeframes_json, markets_json, instruments_json,
          min_risk_reward, min_liquidity, max_spread_bps, updated_at, strategies_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        config.userId,
        combinationJson,
        JSON.stringify(config.timeframes),
        JSON.stringify(config.markets),
        JSON.stringify(config.instruments),
        config.minRiskReward,
        config.minLiquidity,
        config.maxSpreadBps,
        now,
        strategiesJson,
      );
    }
  });
}

export function getUserStrategyConfig(db: Db, userId: string): StoredUserStrategyConfig | null {
  ensureStrategyTables(db);
  const row = db
    .prepare('SELECT * FROM user_strategy_configs WHERE user_id = ?')
    .get(userId) as StoredConfig | undefined;
  if (!row) return null;
  return {
    userId: row.user_id,
    combination: JSON.parse(row.combination_json) as CombinationConfig,
    timeframes: JSON.parse(row.timeframes_json) as string[],
    markets: JSON.parse(row.markets_json) as string[],
    instruments: JSON.parse(row.instruments_json) as string[],
    minRiskReward: row.min_risk_reward,
    minLiquidity: row.min_liquidity as 'HIGH' | 'MEDIUM' | 'LOW',
    maxSpreadBps: row.max_spread_bps,
    updatedAt: row.updated_at,
    strategies: JSON.parse(row.strategies_json || '[]') as UserStrategyConfig[],
  };
}

interface StoredPreset {
  id: string;
  user_id: string;
  name: string;
  config_json: string;
  created_at: string;
  updated_at: string;
}

export function saveStrategyPreset(db: Db, preset: UserStrategyPreset): void {
  ensureStrategyTables(db);
  const now = new Date().toISOString();
  const row: StoredPreset = {
    id: preset.id,
    user_id: preset.userId,
    name: preset.name,
    config_json: JSON.stringify(preset),
    created_at: preset.createdAt,
    updated_at: now,
  };
  withTx(db, () => {
    db.prepare(
      `INSERT INTO user_strategy_presets (id, user_id, name, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, config_json = excluded.config_json, updated_at = excluded.updated_at`,
    ).run(row.id, row.user_id, row.name, row.config_json, row.created_at, row.updated_at);
  });
}

export function getStrategyPreset(db: Db, id: string): UserStrategyPreset | null {
  ensureStrategyTables(db);
  const row = db
    .prepare('SELECT * FROM user_strategy_presets WHERE id = ?')
    .get(id) as StoredPreset | undefined;
  if (!row) return null;
  return JSON.parse(row.config_json) as UserStrategyPreset;
}

export function listStrategyPresets(db: Db, userId: string): UserStrategyPreset[] {
  ensureStrategyTables(db);
  const rows = db
    .prepare('SELECT config_json FROM user_strategy_presets WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as unknown as { config_json: string }[];
  return rows.map((r) => JSON.parse(r.config_json) as UserStrategyPreset);
}

export function deleteStrategyPreset(db: Db, id: string, userId: string): boolean {
  ensureStrategyTables(db);
  const result = db
    .prepare('DELETE FROM user_strategy_presets WHERE id = ? AND user_id = ?')
    .run(id, userId) as { changes: number };
  return result.changes > 0;
}
