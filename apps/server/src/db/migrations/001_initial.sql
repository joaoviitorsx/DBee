-- DBee.md §4. Aplicada no boot; a versão corrente fica em app_meta.

CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE connections (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  color                TEXT,
  host                 TEXT NOT NULL,
  port                 INTEGER NOT NULL DEFAULT 5432,
  database             TEXT NOT NULL,
  username             TEXT NOT NULL,
  password_enc         TEXT NOT NULL,
  ssl_mode             TEXT NOT NULL DEFAULT 'disable'
                         CHECK (ssl_mode IN ('disable', 'require', 'verify-full')),
  write_enabled        INTEGER NOT NULL DEFAULT 0 CHECK (write_enabled IN (0, 1)),
  statement_timeout_ms INTEGER NOT NULL DEFAULT 30000 CHECK (statement_timeout_ms > 0),
  timezone             TEXT NOT NULL DEFAULT 'UTC',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE query_log (
  id            TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  database      TEXT NOT NULL,
  sql           TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('ok', 'error', 'cancelled')),
  error         TEXT,
  row_count     INTEGER,
  duration_ms   INTEGER,
  read_only     INTEGER NOT NULL CHECK (read_only IN (0, 1)),
  actor         TEXT NOT NULL,
  executed_at   TEXT NOT NULL
);
CREATE INDEX idx_query_log_recent ON query_log(executed_at DESC);

CREATE TABLE saved_queries (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  sql           TEXT NOT NULL,
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
