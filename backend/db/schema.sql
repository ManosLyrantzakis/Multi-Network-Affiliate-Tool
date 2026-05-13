-- Affiliate Merchant Tool - SQLite Schema (same as Python)

CREATE TABLE IF NOT EXISTS merchants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    network TEXT NOT NULL CHECK(network IN ('awin', 'cj', 'impact', 'webgains')),
    advertiser_id TEXT,
    timezone TEXT DEFAULT 'UTC',
    api_key_encrypted TEXT,
    api_token_encrypted TEXT,
    commission_rate REAL DEFAULT 0,
    commission_fee REAL DEFAULT 0,
    basket_rate REAL DEFAULT 0,
    last_sync_utc TEXT,
    fetch_start_date TEXT,
    cj_account_name_encrypted TEXT,
    cj_password_encrypted TEXT,
    created_at_utc TEXT DEFAULT (datetime('now')),
    updated_at_utc TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publishers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL,
    publisher_id TEXT NOT NULL,
    name TEXT,
    domain TEXT,
    website_id TEXT,
    created_at_utc TEXT DEFAULT (datetime('now')),
    UNIQUE(network, publisher_id)
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL,
    merchant_id INTEGER NOT NULL,
    external_id TEXT NOT NULL,
    amount DECIMAL(12,2) DEFAULT 0,
    currency TEXT DEFAULT 'EUR',
    commission DECIMAL(12,2) DEFAULT 0,
    status TEXT NOT NULL,
    click_datetime_utc TEXT,
    transaction_datetime_utc TEXT NOT NULL,
    validated_at_utc TEXT,
    validation_status TEXT,
    validation_reason TEXT,
    offer_title TEXT,
    publisher_id TEXT,
    created_at_utc TEXT DEFAULT (datetime('now')),
    updated_at_utc TEXT DEFAULT (datetime('now')),
    UNIQUE(network, merchant_id, external_id),
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id INTEGER NOT NULL,
    network TEXT NOT NULL,
    start_time_utc TEXT NOT NULL,
    end_time_utc TEXT,
    transaction_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',
    error_message TEXT,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE TABLE IF NOT EXISTS performance_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id INTEGER NOT NULL,
    network TEXT NOT NULL,
    date TEXT NOT NULL,
    clicks INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    transactions INTEGER DEFAULT 0,
    revenue DECIMAL(12,2) DEFAULT 0,
    commission DECIMAL(12,2) DEFAULT 0,
    created_at_utc TEXT DEFAULT (datetime('now')),
    updated_at_utc TEXT DEFAULT (datetime('now')),
    UNIQUE(merchant_id, network, date),
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_network ON transactions(network);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_datetime ON transactions(transaction_datetime_utc);
CREATE INDEX IF NOT EXISTS idx_sync_logs_merchant ON sync_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_performance_daily_merchant_date ON performance_daily(merchant_id, date);

-- Publisher-level performance (needed for Publisher Performance + Partner Daily Performance)
CREATE TABLE IF NOT EXISTS performance_publisher_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id INTEGER NOT NULL,
    network TEXT NOT NULL,
    date TEXT NOT NULL,
    publisher_id TEXT NOT NULL,
    publisher_name TEXT,
    clicks INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    actions INTEGER DEFAULT 0,
    revenue DECIMAL(12,2) DEFAULT 0,
    commission DECIMAL(12,2) DEFAULT 0,
    created_at_utc TEXT DEFAULT (datetime('now')),
    updated_at_utc TEXT DEFAULT (datetime('now')),
    UNIQUE(merchant_id, network, date, publisher_id),
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE INDEX IF NOT EXISTS idx_performance_publisher_daily_merchant_date ON performance_publisher_daily(merchant_id, date);
CREATE INDEX IF NOT EXISTS idx_performance_publisher_daily_network ON performance_publisher_daily(network);
CREATE INDEX IF NOT EXISTS idx_performance_publisher_daily_publisher ON performance_publisher_daily(publisher_id);
