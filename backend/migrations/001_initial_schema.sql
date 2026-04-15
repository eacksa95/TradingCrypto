-- =============================================================
-- TradingCrypto - Schema inicial
-- =============================================================

-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================
-- WALLETS / FONDOS DE INVERSIÓN
-- =============================================================
CREATE TABLE wallets (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          VARCHAR(100)    NOT NULL,
    exchange      VARCHAR(50)     NOT NULL,           -- binance, phantom, metamask, bybit, kraken, etc.
    network       VARCHAR(50),                         -- solana, ethereum, bsc, tron, etc.
    wallet_address VARCHAR(200),                       -- dirección blockchain si aplica
    currency      VARCHAR(20)     NOT NULL DEFAULT 'USDT',
    initial_balance NUMERIC(20,8) NOT NULL DEFAULT 0,
    current_balance NUMERIC(20,8) NOT NULL DEFAULT 0,
    is_active     BOOLEAN         NOT NULL DEFAULT TRUE,
    notes         TEXT,
    created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Transacciones de wallet (depósitos, retiros, transferencias)
CREATE TABLE wallet_transactions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id     UUID            NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    type          VARCHAR(20)     NOT NULL CHECK (type IN ('deposit','withdrawal','transfer_in','transfer_out','fee','profit','loss')),
    amount        NUMERIC(20,8)   NOT NULL,
    currency      VARCHAR(20)     NOT NULL DEFAULT 'USDT',
    description   TEXT,
    tx_hash       VARCHAR(200),                        -- hash de transacción en blockchain
    created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- =============================================================
-- TRADES / OPERATIVAS
-- =============================================================
CREATE TABLE trades (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id       UUID            NOT NULL REFERENCES wallets(id),
    alert_id        UUID,                              -- FK a tv_alerts (se agrega después)
    symbol          VARCHAR(30)     NOT NULL,          -- ej: BTCUSDT, SOLUSDT
    trade_type      VARCHAR(20)     NOT NULL CHECK (trade_type IN ('long','short','spot_buy','spot_sell')),
    status          VARCHAR(20)     NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled','partial')),
    exchange        VARCHAR(50)     NOT NULL DEFAULT 'binance',
    timeframe       VARCHAR(10),                       -- 1m, 5m, 15m, 1h, 4h, 1d
    -- Precios
    entry_price     NUMERIC(20,8)   NOT NULL,
    exit_price      NUMERIC(20,8),
    quantity        NUMERIC(20,8)   NOT NULL,
    leverage        INTEGER         NOT NULL DEFAULT 1,
    -- Risk management
    stop_loss       NUMERIC(20,8),
    take_profit     NUMERIC(20,8),
    -- Resultado
    pnl             NUMERIC(20,8),
    pnl_percentage  NUMERIC(10,4),
    fees            NUMERIC(20,8)   NOT NULL DEFAULT 0,
    -- Extra
    tags            TEXT[],
    notes           TEXT,
    opened_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Notas y seguimiento por trade
CREATE TABLE trade_notes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_id    UUID        NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    content     TEXT        NOT NULL,
    price_at    NUMERIC(20,8),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- ALERTAS DE TRADINGVIEW (webhooks entrantes)
-- =============================================================
CREATE TABLE tv_alerts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol          VARCHAR(30)     NOT NULL,
    timeframe       VARCHAR(10),
    action          VARCHAR(30)     NOT NULL,          -- long, short, close_long, close_short, buy, sell
    price           NUMERIC(20,8),
    volume          NUMERIC(30,8),
    indicator_name  VARCHAR(100),
    strategy_name   VARCHAR(100),
    extra_data      JSONB           NOT NULL DEFAULT '{}',
    raw_payload     JSONB           NOT NULL DEFAULT '{}',
    is_processed    BOOLEAN         NOT NULL DEFAULT FALSE,
    analysis_id     UUID,                              -- FK a market_analyses
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- =============================================================
-- ANÁLISIS DE MERCADO CON IA
-- =============================================================
CREATE TABLE market_analyses (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id        UUID            REFERENCES tv_alerts(id),
    symbol          VARCHAR(30)     NOT NULL,
    timeframe       VARCHAR(10),
    -- Datos de mercado al momento del análisis
    market_data     JSONB           NOT NULL DEFAULT '{}',
    -- Resultado del análisis con Claude
    ai_analysis     TEXT,
    recommendation  VARCHAR(20)     CHECK (recommendation IN ('LONG','SHORT','SPOT_BUY','SPOT_SELL','HOLD','AVOID')),
    confidence      INTEGER         CHECK (confidence BETWEEN 0 AND 100),
    risk_level      VARCHAR(10)     CHECK (risk_level IN ('LOW','MEDIUM','HIGH','VERY_HIGH')),
    reasoning       TEXT,
    suggested_entry    NUMERIC(20,8),
    suggested_sl       NUMERIC(20,8),
    suggested_tp1      NUMERIC(20,8),
    suggested_tp2      NUMERIC(20,8),
    -- Tokens usados (costo de IA)
    ai_input_tokens    INTEGER,
    ai_output_tokens   INTEGER,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- =============================================================
-- SÍMBOLOS SEGUIDOS
-- =============================================================
CREATE TABLE symbols (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol      VARCHAR(30)     NOT NULL UNIQUE,
    base_asset  VARCHAR(20)     NOT NULL,
    quote_asset VARCHAR(20)     NOT NULL DEFAULT 'USDT',
    exchange    VARCHAR(50)     NOT NULL DEFAULT 'binance',
    is_tracked  BOOLEAN         NOT NULL DEFAULT TRUE,
    notes       TEXT,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- =============================================================
-- FOREIGN KEYS (ciclos)
-- =============================================================
ALTER TABLE trades ADD CONSTRAINT fk_trades_alert
    FOREIGN KEY (alert_id) REFERENCES tv_alerts(id) ON DELETE SET NULL;

ALTER TABLE tv_alerts ADD CONSTRAINT fk_alerts_analysis
    FOREIGN KEY (analysis_id) REFERENCES market_analyses(id) ON DELETE SET NULL;

-- =============================================================
-- ÍNDICES
-- =============================================================
CREATE INDEX idx_trades_wallet     ON trades(wallet_id);
CREATE INDEX idx_trades_symbol     ON trades(symbol);
CREATE INDEX idx_trades_status     ON trades(status);
CREATE INDEX idx_trades_opened_at  ON trades(opened_at DESC);
CREATE INDEX idx_trades_type       ON trades(trade_type);

CREATE INDEX idx_tv_alerts_symbol      ON tv_alerts(symbol);
CREATE INDEX idx_tv_alerts_processed   ON tv_alerts(is_processed);
CREATE INDEX idx_tv_alerts_created_at  ON tv_alerts(created_at DESC);

CREATE INDEX idx_analyses_symbol       ON market_analyses(symbol);
CREATE INDEX idx_analyses_created_at   ON market_analyses(created_at DESC);
CREATE INDEX idx_analyses_rec          ON market_analyses(recommendation);

CREATE INDEX idx_wallet_tx_wallet      ON wallet_transactions(wallet_id);
CREATE INDEX idx_wallet_tx_type        ON wallet_transactions(type);

-- =============================================================
-- TRIGGER: updated_at automático
-- =============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wallets_updated_at
    BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_trades_updated_at
    BEFORE UPDATE ON trades
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- DATOS INICIALES DE EJEMPLO
-- =============================================================
INSERT INTO symbols (symbol, base_asset, quote_asset) VALUES
    ('BTCUSDT',  'BTC',  'USDT'),
    ('ETHUSDT',  'ETH',  'USDT'),
    ('SOLUSDT',  'SOL',  'USDT'),
    ('BNBUSDT',  'BNB',  'USDT'),
    ('XRPUSDT',  'XRP',  'USDT'),
    ('ADAUSDT',  'ADA',  'USDT'),
    ('DOGEUSDT', 'DOGE', 'USDT'),
    ('AVAXUSDT', 'AVAX', 'USDT');
