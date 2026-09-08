-- Permissão por conexão (DBee.md §9, v0.2: "papéis, permissão por conexão").
--
-- Sem isto, a fase 1 entrega o pior dos dois mundos: contas individuais — logo,
-- auditoria correta — e **todo mundo enxergando todas as conexões**, produção
-- incluída. Uma conta nova nasceria com acesso de escrita ao banco do cliente.
--
-- ## As duas regras
--
-- 1. `admin` vê tudo. Ele administra as conexões; exigir que concedesse acesso
--    a si mesmo criaria o mesmo beco do "último admin" da migração 004.
-- 2. `member` vê **só** o que tem linha aqui.
--
-- ## Escrita exige as DUAS pontas
--
-- `connections.write_enabled` continua sendo "esta conexão pode ser escrita";
-- `can_write` aqui é "esta pessoa pode escrever nela". Nenhum dos dois sozinho
-- basta. Assim produção segue gravável para quem precisa, sem virar gravável
-- para quem apenas recebeu acesso de leitura.
--
-- ## Ausência é negação
--
-- Não há linha "sem acesso": a ausência de linha já é a negação. Uma coluna
-- `granted INTEGER` permitiria o estado `granted = 0`, que é o mesmo que não
-- existir e mais um caminho para a leitura errar.
CREATE TABLE connection_access (
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  -- Só vale com `connections.write_enabled = 1`. Ver acima.
  can_write     INTEGER NOT NULL DEFAULT 0 CHECK (can_write IN (0, 1)),
  granted_at    TEXT NOT NULL,
  -- Quem concedeu. Id, não FK: a concessão sobrevive à saída de quem a fez,
  -- pelo mesmo motivo de `query_log.actor` (migração 001).
  granted_by    TEXT NOT NULL,
  PRIMARY KEY (connection_id, user_id)
);

-- A pergunta quente é "quais conexões esta pessoa vê", feita a cada listagem e
-- a cada resolução por id. A PK cobre (connection_id, user_id); este índice
-- cobre o outro sentido.
CREATE INDEX idx_connection_access_user ON connection_access(user_id);
