-- O caminho do arquivo, para o SQLite local.
--
-- O SQLite não é um servidor: é um arquivo no disco. A conexão precisa apontar
-- para ele, e `host`/`port` não fazem sentido — daí um campo próprio. O arquivo
-- vive num volume montado no container (o mesmo princípio do `dbee.sqlite`), e
-- o caminho é validado no serviço (dentro de uma raiz permitida, ver o driver).
--
-- Nulo por padrão e só o SQLite o usa. Aditiva: binário anterior segue abrindo
-- o banco, rollback de deploy continua possível.
ALTER TABLE connections ADD COLUMN file_path TEXT;
