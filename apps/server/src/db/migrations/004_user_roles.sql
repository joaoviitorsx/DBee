-- Papéis (DBee.md §9, v0.2: "papéis, permissão por conexão").
--
-- O motivo é distribuir o DBee para um time. Até aqui o sistema é travado em
-- **uma** conta: `POST /auth/setup` recusa com `setup_done` quando já existe
-- usuário, e nenhuma outra rota chama `users.criar()`. Sem papel não há como
-- dizer quem pode criar a segunda conta, e a alternativa — todo mundo no mesmo
-- login — quebra o `actor` do `query_log`, que é a razão de a auth existir
-- (§7).
--
-- Dois valores, não uma hierarquia numérica: `admin` administra contas e
-- conexões, `member` usa. `CHECK` fecha o domínio pelo mesmo motivo do
-- `locale` na 003 — um terceiro papel entrando por engano viraria permissão
-- indefinida, e permissão indefinida falha aberta.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'
  CHECK (role IN ('admin', 'member'));

-- Quem já existe vira admin.
--
-- Não é um `UPDATE` largo por descuido: quando esta migration roda, o banco tem
-- no máximo **uma** conta — a do setup, criada por quem tem acesso ao volume e
-- que é justamente quem administra a instalação. Deixá-la como `member` seria
-- publicar uma versão em que ninguém pode administrar nada, e o conserto exigiria
-- editar o SQLite à mão.
UPDATE users SET role = 'admin';
