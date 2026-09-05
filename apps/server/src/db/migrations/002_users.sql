-- Identidade real (DBee.md §7). O motivo é o `actor` do query_log: sem pessoa,
-- o log tem aparência de auditoria e não distingue quem fez o quê.

CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE,
  -- argon2id via Bun.password. Nunca sai desta tabela por rota nenhuma.
  password_hash        TEXT NOT NULL,
  -- Senha gerada no primeiro boot é senha impressa em log: trocar é obrigatório
  -- antes de a API responder qualquer outra coisa.
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE sessions (
  -- **Hash** do token, nunca o token. Se o arquivo SQLite vazar (backup, volume
  -- montado errado), o que está aqui não serve como cookie.
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  -- Expiração absoluta, não por inatividade: um `last_seen_at` exigiria uma
  -- escrita por requisição para alimentar uma regra que não existe.
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
