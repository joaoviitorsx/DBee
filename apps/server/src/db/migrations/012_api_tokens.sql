-- Tokens pessoais de API, para o MCP (docs/plano-mcp-vpn.md §1, ADR 015).
--
-- O token só vale em `POST /api/mcp` — o guard recusa Bearer em qualquer outra
-- rota, e recusa cookie no MCP. Ele é mostrado **uma vez** na criação; aqui
-- fica só o hash (argon2id via Bun.password), como `users.password_hash`.
--
-- ## Por que um prefixo público
--
-- argon2id não tem lookup: não dá para achar a linha pelo hash. O formato
-- `dbee_<prefix>_<segredo>` leva um prefixo aleatório não secreto, que acha a
-- linha por índice; só então o segredo é verificado contra o hash. Sem ele,
-- cada requisição teria de verificar contra todos os tokens.
--
-- Revogar é `revoked_at`, não DELETE: a lista continua mostrando o que existiu
-- e quando foi cortado. Apagar o usuário apaga os tokens (CASCADE).
--
-- Aditiva: binário anterior segue abrindo o banco.
CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL UNIQUE,
  hash         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
