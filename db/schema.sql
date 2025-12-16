-- Schema (SWAP copy trading only)
-- Re-applying this file will DROP existing tables.

-- Legacy tables (v1)
DROP TABLE IF EXISTS trader_pnl_weekly;
DROP TABLE IF EXISTS trader_pnl_daily;
DROP TABLE IF EXISTS trader_stats;
DROP TABLE IF EXISTS trader_profile;
DROP TABLE IF EXISTS history;
DROP TABLE IF EXISTS traders;

-- Current tables (v2)
DROP TABLE IF EXISTS watched_trader_metrics;
DROP TABLE IF EXISTS watched_traders;
DROP TABLE IF EXISTS trader_info;

-- Trader info table
-- Source: GET /api/v5/copytrading/public-lead-traders?instType=SWAP
CREATE TABLE IF NOT EXISTS trader_info (
    instId TEXT PRIMARY KEY,      -- OKX uniqueCode
    nickName TEXT NOT NULL,
    ccy TEXT NOT NULL,            -- e.g. USDT
    leadDays INTEGER NOT NULL,    -- 带单天数
    copyTraderNum INTEGER NOT NULL, -- 跟单人数
    maxCopyTraderNum INTEGER NOT NULL,
    avatarUrl TEXT NOT NULL,      -- OKX portLink (avatar image url)
    traderInsts TEXT NOT NULL,    -- JSON array of instrument ids (e.g. BTC-USDT-SWAP)
    uTime INTEGER NOT NULL        -- last updated (ms)
);

-- Watched traders table
CREATE TABLE IF NOT EXISTS watched_traders (
    instId TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);

-- Watched trader metrics (updated by cron every 5 minutes)
-- Sources:
-- - aum from public-lead-traders
-- - investAmt/curCopyTraderPnl/winRatio/profitDays/lossDays/avgSubPosNotional from public-stats (lastDays=4)
CREATE TABLE IF NOT EXISTS watched_trader_metrics (
    instId TEXT NOT NULL,
    timestamp INTEGER NOT NULL,      -- bucketed timestamp (ms)
    ccy TEXT NOT NULL,
    aum REAL NOT NULL,
    investAmt REAL NOT NULL,
    curCopyTraderPnl REAL NOT NULL,
    winRatio REAL NOT NULL,
    profitDays INTEGER NOT NULL,
    lossDays INTEGER NOT NULL,
    avgSubPosNotional REAL NOT NULL,
    uTime INTEGER NOT NULL,
    PRIMARY KEY (instId, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_watched_trader_metrics_inst_ts
    ON watched_trader_metrics (instId, timestamp);
