-- Qual banco está do outro lado da conexão.
--
-- Aditiva de propósito: `ADD COLUMN` com default não reescreve a tabela, e um
-- binário ANTERIOR continua abrindo este banco (ele não pede a coluna, e o
-- `migrate` só aborta abaixo do esperado). Isso mantém rollback de deploy como
-- opção — o que deixa de valer no dia em que `host`/`database`/`username`
-- precisarem virar anuláveis para o SQLite, que exige rebuild da tabela com
-- três FKs apontando para cá. Esse dia merece ADR próprio.
--
-- O `DEFAULT` aqui é do DDL, não de schema de entrada: o ADR 004 proíbe default
-- em schema de entrada (o Elysia o materializa e corrompe o PATCH), não em
-- coluna. E no SQLite `ADD COLUMN NOT NULL` EXIGE default não-nulo.
--
-- O default também é o backfill, e ele não é chute: toda conexão que existe
-- hoje É Postgres, porque é a única engine que o DBee fala.
ALTER TABLE connections ADD COLUMN engine TEXT NOT NULL DEFAULT 'postgres'
  CHECK (engine IN ('postgres', 'mysql', 'mariadb', 'sqlite', 'libsql', 'mongodb', 'redis'));
