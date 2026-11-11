/**
 * QUANTORA relational schema (SQLite dialect).
 *
 * Conventions:
 *  - All timestamps are stored in UTC (unix seconds or ISO-8601 Z strings).
 *  - Exchange timezone is stored alongside market/session rows so local
 *    session math can be reproduced without guessing.
 *  - Time-series data (candles, indicator_values) is keyed for range scans
 *    and de-duplication: primary keys include the timestamp column.
 *  - Every ingested record carries a data-quality status; nothing is treated
 *    as verified until the validation service has approved it.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
-- ── Reference: markets ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS markets (
  id                 TEXT PRIMARY KEY,
  category           TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  region             TEXT NOT NULL,
  timezone           TEXT NOT NULL,
  weekday_open_min   INTEGER NOT NULL,
  weekday_close_min  INTEGER NOT NULL,
  weekdays           TEXT NOT NULL,           -- JSON array, e.g. [1,2,3,4,5]
  currency           TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

-- ── Reference: instruments ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS instruments (
  id                TEXT PRIMARY KEY,
  symbol            TEXT NOT NULL,
  name              TEXT NOT NULL,
  market_category   TEXT NOT NULL REFERENCES markets(category),
  exchange          TEXT NOT NULL,
  region            TEXT NOT NULL,
  type              TEXT NOT NULL,
  currency          TEXT NOT NULL,
  sector            TEXT,
  provider_id       TEXT,                       -- preferred provider adapter
  provider_symbol   TEXT,                       -- that provider's ticker
  restriction_code  TEXT,
  restriction_summary TEXT,
  restriction_detail  TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  UNIQUE (symbol, exchange)
);
CREATE INDEX IF NOT EXISTS idx_instruments_market  ON instruments(market_category);
CREATE INDEX IF NOT EXISTS idx_instruments_exchange ON instruments(exchange);
CREATE INDEX IF NOT EXISTS idx_instruments_sector  ON instruments(sector);
CREATE INDEX IF NOT EXISTS idx_instruments_provider ON instruments(provider_id, provider_symbol);

-- ── Market sessions (per trading day, exchange-local then stored UTC) ─
CREATE TABLE IF NOT EXISTS market_sessions (
  id            TEXT PRIMARY KEY,
  market_id     TEXT NOT NULL REFERENCES markets(id),
  session_date  TEXT NOT NULL,                  -- yyyy-mm-dd in exchange tz
  open_at_utc   TEXT NOT NULL,
  close_at_utc  TEXT NOT NULL,
  status        TEXT NOT NULL,                  -- SCHEDULED|OPEN|CLOSED|HOLIDAY
  is_holiday    INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (market_id, session_date)
);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON market_sessions(session_date);

-- ── Time series: historical candles ───────────────────────────────────
CREATE TABLE IF NOT EXISTS candles (
  instrument_id  TEXT NOT NULL REFERENCES instruments(id),
  timeframe      TEXT NOT NULL,
  ts             INTEGER NOT NULL,              -- unix seconds, bucket start (UTC)
  open           REAL NOT NULL,
  high           REAL NOT NULL,
  low            REAL NOT NULL,
  close          REAL NOT NULL,
  volume         REAL NOT NULL DEFAULT 0,
  source_provider TEXT NOT NULL,
  source_origin  TEXT NOT NULL,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  quality_status TEXT NOT NULL DEFAULT 'PENDING',-- PENDING|VERIFIED|SUSPECT|REJECTED
  is_complete    INTEGER NOT NULL DEFAULT 1,     -- closed candle vs forming
  ingested_at    TEXT NOT NULL,
  PRIMARY KEY (instrument_id, timeframe, ts)
);
CREATE INDEX IF NOT EXISTS idx_candles_ts ON candles(ts);
CREATE INDEX IF NOT EXISTS idx_candles_quality ON candles(quality_status);
CREATE INDEX IF NOT EXISTS idx_candles_instrument_time ON candles(instrument_id, ts);

-- ── Time series: latest quote per instrument ──────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  instrument_id   TEXT PRIMARY KEY REFERENCES instruments(id),
  last_price      REAL NOT NULL,
  change          REAL NOT NULL,
  change_percent  REAL NOT NULL,
  open            REAL NOT NULL,
  high            REAL NOT NULL,
  low             REAL NOT NULL,
  previous_close  REAL NOT NULL,
  volume          REAL NOT NULL DEFAULT 0,
  average_volume  REAL NOT NULL DEFAULT 0,
  bid             REAL,
  ask             REAL,
  market_status   TEXT NOT NULL,
  freshness       TEXT NOT NULL,                -- LIVE|DELAYED|STALE|DEMO|MISSING
  source_provider TEXT NOT NULL,
  source_origin   TEXT NOT NULL,
  is_demo         INTEGER NOT NULL DEFAULT 0,
  quality_status  TEXT NOT NULL DEFAULT 'PENDING',
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotes_updated ON quotes(updated_at);

-- ── Time series: computed indicator values ────────────────────────────
CREATE TABLE IF NOT EXISTS indicator_values (
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  timeframe     TEXT NOT NULL,
  name          TEXT NOT NULL,                   -- RSI, MACD, EMA_20, ...
  ts            INTEGER NOT NULL,                -- candle bucket the value belongs to
  value_json    TEXT NOT NULL,
  computed_at   TEXT NOT NULL,
  PRIMARY KEY (instrument_id, timeframe, name, ts)
);
CREATE INDEX IF NOT EXISTS idx_indicator_name ON indicator_values(name, ts);

-- ── Market events (calendar / corporate / news hooks) ─────────────────
CREATE TABLE IF NOT EXISTS market_events (
  id            TEXT PRIMARY KEY,
  instrument_id TEXT REFERENCES instruments(id),
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  country       TEXT,
  impact        TEXT,
  payload_json  TEXT,
  source_provider TEXT NOT NULL,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  occurred_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_time ON market_events(occurred_at);

-- ── Strategy definitions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  family      TEXT NOT NULL,
  description TEXT NOT NULL,
  timeframe   TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_configs (
  id          TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL REFERENCES strategies(id),
  version     INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE (strategy_id, version)
);

CREATE TABLE IF NOT EXISTS entry_exit_conditions (
  id          TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL REFERENCES strategies(id),
  kind        TEXT NOT NULL,                     -- ENTRY|EXIT
  ordinal     INTEGER NOT NULL,
  left_expr   TEXT NOT NULL,
  operator    TEXT NOT NULL,
  right_expr  TEXT NOT NULL,
  lookback    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_conditions_strategy ON entry_exit_conditions(strategy_id, kind, ordinal);

-- ── Generated opportunities ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opportunities (
  id                 TEXT PRIMARY KEY,
  instrument_id      TEXT NOT NULL REFERENCES instruments(id),
  strategy_id        TEXT NOT NULL REFERENCES strategies(id),
  strategy_name      TEXT NOT NULL,
  direction          TEXT NOT NULL,               -- LONG|SHORT|FLAT
  signal             TEXT NOT NULL,               -- BUY|SELL|WATCH|NO_TRADE
  timeframe          TEXT NOT NULL,
  score              REAL NOT NULL,               -- 0-100 confluence metric
  last_price         REAL NOT NULL,
  currency           TEXT NOT NULL,
  observed_at        TEXT NOT NULL,
  source_json        TEXT NOT NULL,
  entry_trigger      TEXT NOT NULL,
  entry_zone_low     REAL NOT NULL,
  entry_zone_high    REAL NOT NULL,
  stop_loss          REAL NOT NULL,
  target1            REAL NOT NULL,
  target2            REAL NOT NULL,
  planned_rr         REAL NOT NULL,
  liquidity          TEXT NOT NULL,
  spread_bps         REAL NOT NULL DEFAULT 0,
  technical_explanation TEXT NOT NULL,
  risk_factors_json  TEXT NOT NULL,
  quality_json       TEXT NOT NULL,
  data_quality       TEXT NOT NULL DEFAULT 'PENDING',
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opportunities_created ON opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_instrument ON opportunities(instrument_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_strategy ON opportunities(strategy_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_score ON opportunities(score DESC);

-- ── Risk calculations ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_calculations (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,                    -- POSITION_SIZE|RISK_REWARD|PORTFOLIO
  instrument_id TEXT REFERENCES instruments(id),
  input_json    TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  data_quality  TEXT NOT NULL DEFAULT 'VERIFIED',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_created ON risk_calculations(created_at DESC);

-- ── Backtests ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backtest_results (
  id               TEXT PRIMARY KEY,
  strategy_id      TEXT NOT NULL REFERENCES strategies(id),
  instrument_ids   TEXT NOT NULL,                 -- JSON array
  window_from      TEXT NOT NULL,
  window_to        TEXT NOT NULL,
  costs_json       TEXT NOT NULL,
  initial_capital  REAL NOT NULL,
  phase            TEXT NOT NULL,                 -- IN_SAMPLE|OUT_OF_SAMPLE|WALK_FORWARD
  metrics_json     TEXT NOT NULL,
  equity_json      TEXT NOT NULL,
  warnings_json    TEXT NOT NULL,
  is_simulated     INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backtest_created ON backtest_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_strategy ON backtest_results(strategy_id);

CREATE TABLE IF NOT EXISTS backtest_trades (
  id            TEXT PRIMARY KEY,
  backtest_id   TEXT NOT NULL REFERENCES backtest_results(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  direction     TEXT NOT NULL,
  entry_ts      TEXT NOT NULL,
  exit_ts       TEXT NOT NULL,
  entry_price   REAL NOT NULL,
  exit_price    REAL NOT NULL,
  quantity      REAL NOT NULL,
  gross_pnl     REAL NOT NULL,
  costs         REAL NOT NULL,
  net_pnl       REAL NOT NULL,
  r_multiple    REAL NOT NULL,
  exit_reason   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_backtest ON backtest_trades(backtest_id);

-- ── Paper trades (simulated only — never routed to a broker) ──────────
CREATE TABLE IF NOT EXISTS paper_trades (
  id            TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  strategy_id   TEXT REFERENCES strategies(id),
  direction     TEXT NOT NULL,
  quantity      REAL NOT NULL,
  entry_price   REAL NOT NULL,
  exit_price    REAL,
  status        TEXT NOT NULL,                    -- OPEN|CLOSED|REJECTED
  opened_at     TEXT NOT NULL,
  closed_at     TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paper_status ON paper_trades(status, opened_at DESC);

-- ── Daily reports ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_reports (
  id                 TEXT PRIMARY KEY,
  report_date        TEXT NOT NULL,
  market             TEXT NOT NULL,
  title              TEXT NOT NULL,
  payload_json       TEXT NOT NULL,
  source_json        TEXT NOT NULL,
  no_qualified_setups INTEGER NOT NULL DEFAULT 0,
  generated_at       TEXT NOT NULL,
  UNIQUE (report_date, market)
);
CREATE INDEX IF NOT EXISTS idx_reports_date ON daily_reports(report_date DESC);

-- ── Provider health ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_status (
  provider_id        TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  vendor             TEXT NOT NULL,
  status             TEXT NOT NULL,               -- CONNECTED|DELAYED|STALE|DISCONNECTED|DEMO DATA
  last_success_at    TEXT,
  last_error         TEXT,
  latency_ms         INTEGER NOT NULL DEFAULT 0,
  freshness_seconds  INTEGER NOT NULL DEFAULT 0,
  reliability_pct    REAL NOT NULL DEFAULT 100,
  is_demo            INTEGER NOT NULL DEFAULT 0,
  rate_limit_used    INTEGER NOT NULL DEFAULT 0,
  rate_limit_limit   INTEGER NOT NULL DEFAULT 0,
  rate_limit_resets_at TEXT,
  requests_today     INTEGER NOT NULL DEFAULT 0,
  requests_month     INTEGER NOT NULL DEFAULT 0,
  supported_markets  TEXT NOT NULL DEFAULT '[]',
  updated_at         TEXT NOT NULL
);

-- ── System monitoring logs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_logs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,
  level    TEXT NOT NULL,
  source   TEXT NOT NULL,
  message  TEXT NOT NULL,
  context_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON system_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level ON system_logs(level, ts DESC);

-- ── Migration bookkeeping ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;
