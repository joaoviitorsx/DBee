# Papéis Postgres restritos para o DBee

SQL para **você** ler, entender e rodar no `psql`. O DBee não executa nada em
banco de cliente (corolário do ADR 006 aplicado a nós mesmos): este arquivo é
texto, não uma ferramenta que o app dispara.

O motivo de existir está na §11.37 / ADR 001: `BEGIN READ ONLY` barra escrita de
linhas, mas **não contém um papel privilegiado** — com `rolsuper` ou
`pg_execute_server_program`, `COPY … TO PROGRAM` executa comando no host do
banco a partir de uma conexão que a UI mostra como somente-leitura. A defesa real
é conectar com um papel restrito. Estes são esses papéis.

Convenções abaixo: `<slug>` = escritório, `<db>` = database (`su_<slug>`),
`<schema>` = schema de trabalho (troque `public` se for o caso), `<dono>` = o
papel que **cria** as tabelas da aplicação. Troque os placeholders; nada aqui
inventa nome de tabela.

---

## Decisões de desenho — leia antes de rodar

### 1. Um papel por escritório, não um papel global

**Recomendo um par de papéis por escritório** (`dbee_ro_<slug>` e
`dbee_rw_<slug>`), não um papel global com `GRANT` por database.

Papéis no Postgres são objetos **do cluster** (globais); privilégios são por
database/schema/tabela. A diferença de confinamento sai daí:

- **Um papel por escritório** — cada papel recebe `CONNECT` **só** no seu próprio
  `su_<slug>` e `SELECT` só nos schemas daquele database. O confinamento é
  enforçado pelo `CONNECT`: o papel do escritório A **não consegue nem conectar**
  no database do escritório B. Uma credencial vazada expõe **um** escritório.
  Custo: 2 papéis por escritório, criados no onboarding (é script, não trabalho
  manual recorrente).
- **Um papel global com `GRANT` por database** — um `dbee_ro` só, com `CONNECT`
  concedido a cada database. A mesma credencial conecta em **todo** database que
  recebeu grant; uma credencial vazada expõe **todos**. E você passa a depender de
  lembrar de não conceder demais e de ter revogado o `PUBLIC` (decisão 2) em cada
  database. O raio de dano é o cluster inteiro.

Como o DBee usa **uma conexão por database** de qualquer forma (um escritório =
uma conexão = um `su_<slug>`), o papel por escritório encaixa sem fricção: cada
conexão do DBee carrega a credencial do papel daquele escritório.

Um papel global só compensa para um database compartilhado e de baixa
sensibilidade — não é o caso dos dados de escritório.

### 2. `REVOKE … FROM PUBLIC` muda o SQL — rode sempre a variante que revoga

Por padrão, o papel virtual `PUBLIC` (todo mundo) já tem, em qualquer database:

- `CONNECT` e `TEMPORARY` no database;
- `USAGE` no schema `public`, e — em **Postgres < 15** — também `CREATE` no
  `public` (no 15+ o `CREATE` do `public` já vem revogado do `PUBLIC`).

Ou seja: num database **sem** `REVOKE … FROM PUBLIC`, o seu papel "somente
leitura" herda do `PUBLIC` o direito de abrir transações, criar tabelas
temporárias e, no PG<15, criar objetos no `public` — exatamente o que você **não**
quer num papel de leitura, e o `GRANT CONNECT` que você escrever vira redundante.

**Isso muda o SQL, então há duas variantes:**

- **Variante A — o database já teve `REVOKE ALL … FROM PUBLIC`.** Basta conceder
  o que o papel precisa (blocos abaixo, sem o prelúdio de `REVOKE`).
- **Variante B — o database ainda tem os privilégios do `PUBLIC`.** Rode primeiro
  o **prelúdio de REVOKE** (revoga `PUBLIC` no database e no schema) e só então
  conceda.

**Recomendação: rode sempre a variante B.** Revogar um privilégio que o `PUBLIC`
não tem mais é um no-op (emite `NOTICE`, não erro), então o prelúdio é seguro
mesmo nos databases onde você acha que já revogou — e assim você não depende de
lembrar quais estão em qual estado. Os dois blocos de papel abaixo já vêm com o
prelúdio marcado como **opcional** para quem tem certeza de estar na variante A.

---

## Prelúdio (variante B) — revoga o `PUBLIC`

Rode **conectado ao `<db>` alvo** (o `REVOKE` é por database):

```sql
-- Tira do PUBLIC o CONNECT/TEMP herdado: só quem receber GRANT explícito conecta.
REVOKE ALL ON DATABASE <db> FROM PUBLIC;

-- Tira do PUBLIC o USAGE/CREATE no schema de trabalho (no PG<15 isto remove o
-- CREATE no public que todo mundo teria). Repita para cada schema de trabalho.
REVOKE ALL ON SCHEMA <schema> FROM PUBLIC;
```

> Se estiver na **variante A** (já revogado antes), pode pular este bloco — ou
> rodar mesmo assim: vira no-op.

---

## Papel 1 — leitura (uso diário)

> **Concede:** conectar no `<db>`, enxergar os schemas de trabalho, e `SELECT` em
> todas as tabelas e views deles, inclusive as **futuras**.
> **Deliberadamente não concede:** superusuário; `pg_execute_server_program`,
> `pg_read_server_files`, `pg_write_server_files`; `CREATE` em nenhum schema;
> nenhuma escrita (`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`); nenhum DDL.

Conectado ao `<db>`:

```sql
-- Papel de login, sem nenhum atributo privilegiado. NOSUPERUSER/NOCREATEDB/
-- NOCREATEROLE são o default de CREATE ROLE, mas escritos aqui para o papel se
-- ler como "sem poderes" à primeira vista. Troque a senha.
CREATE ROLE dbee_ro_<slug> LOGIN PASSWORD '<senha-forte>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- (Prelúdio da variante B acima, se ainda não rodou.)

-- Conectar: agora explícito, porque o PUBLIC foi revogado.
GRANT CONNECT ON DATABASE <db> TO dbee_ro_<slug>;

-- Enxergar o schema (USAGE), SEM poder criar objetos nele (sem CREATE).
GRANT USAGE ON SCHEMA <schema> TO dbee_ro_<slug>;

-- Ler tabelas e views que existem hoje. (SELECT cobre view também.)
GRANT SELECT ON ALL TABLES IN SCHEMA <schema> TO dbee_ro_<slug>;

-- Ler as tabelas que forem criadas DEPOIS. ATENÇÃO: DEFAULT PRIVILEGES é keyed
-- pelo papel que CRIA o objeto — sem FOR ROLE, vale só para o que ESTE usuário
-- (o que roda o comando) criar, que provavelmente não é quem cria as tabelas da
-- app. Use FOR ROLE <dono>, onde <dono> é o papel que cria as tabelas.
ALTER DEFAULT PRIVILEGES FOR ROLE <dono> IN SCHEMA <schema>
  GRANT SELECT ON TABLES TO dbee_ro_<slug>;
```

> **Sequences:** leitura **não** precisa de `USAGE` em sequence — só o `INSERT`
> com `serial` precisa (papel 2). Não conceda aqui.
>
> **Vários schemas:** repita `USAGE`, `GRANT SELECT ON ALL TABLES` e o
> `ALTER DEFAULT PRIVILEGES` para cada schema de trabalho.

---

## Papel 2 — escrita restrita

> **Concede:** tudo do papel de leitura, mais `INSERT`/`UPDATE`/`DELETE` **apenas
> nas tabelas que você listar**, e `USAGE` nas sequences dessas tabelas (para
> `INSERT` com `serial` não falhar).
> **Deliberadamente não concede:** `TRUNCATE`; qualquer DDL (`CREATE`/`ALTER`/
> `DROP`); `REFERENCES`; escrita em tabela fora da lista; e nada dos poderes que o
> papel de leitura já nega (superusuário, `COPY … TO PROGRAM`, arquivos do
> servidor).

Conectado ao `<db>`:

```sql
CREATE ROLE dbee_rw_<slug> LOGIN PASSWORD '<senha-forte>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Herda TODO o pacote de leitura por pertencer ao papel de leitura. (INHERIT é o
-- default, então dbee_rw_<slug> usa os SELECT/USAGE/CONNECT do dbee_ro_<slug>
-- sem SET ROLE.)
GRANT dbee_ro_<slug> TO dbee_rw_<slug>;

-- Escrita SÓ nas tabelas listadas. Uma linha por tabela — nada de
-- "ALL TABLES", que concederia escrita no schema inteiro. NÃO inclui TRUNCATE
-- nem REFERENCES (a lista de privilégios é explícita).
-- GRANT INSERT, UPDATE, DELETE ON <schema>.<tabela_1> TO dbee_rw_<slug>;
-- GRANT INSERT, UPDATE, DELETE ON <schema>.<tabela_2> TO dbee_rw_<slug>;

-- USAGE nas sequences das tabelas graváveis — necessário para colunas `serial`/
-- `bigserial` (o INSERT chama nextval). Uma linha por sequence.
-- Coluna GENERATED ... AS IDENTITY NÃO precisa disto (a sequence é interna à
-- tabela e o INSERT já a alcança). Descubra o nome com:
--   SELECT pg_get_serial_sequence('<schema>.<tabela_1>', '<coluna_serial>');
-- GRANT USAGE ON SEQUENCE <schema>.<seq_da_tabela_1> TO dbee_rw_<slug>;
```

> Coluna gerada (`GENERATED ALWAYS AS IDENTITY`) e o INSERT do DBee: o form ainda oferece a coluna e o Postgres recusa; não é
> problema de GRANT.

---

## Verificação — rode conectado COMO o papel, e queira ver o erro

Não confie no `GRANT`: conecte como `dbee_ro_<slug>` (ou `_rw_`) e prove que o
que **não** pode, falha. Cada bloco diz o erro esperado.

```sql
-- 1. COPY TO PROGRAM — o furo do §11.37. TEM que falhar.
COPY (SELECT 1) TO PROGRAM 'true';
--   ERRO esperado: "must be superuser or a member of pg_execute_server_program
--   to COPY to or from an external program". Se ISTO rodar, o papel é
--   privilegiado — pare e revise (provavelmente é superusuário).

-- 2. CREATE TABLE — sem CREATE no schema. TEM que falhar.
CREATE TABLE _dbee_probe (x int);
--   ERRO esperado: "permission denied for schema <schema>".

-- 3. Ler arquivo do servidor — sem pg_read_server_files. TEM que falhar.
COPY (SELECT 1) TO STDOUT;                  -- este PASSA (é só stdout, inofensivo)
SELECT pg_read_file('/etc/hostname');       -- este TEM que falhar
--   ERRO esperado: "permission denied for function pg_read_file".

-- 4. DELETE fora da lista — numa tabela que você NÃO concedeu. TEM que falhar.
DELETE FROM <schema>.<tabela_fora_da_lista>;
--   ERRO esperado: "permission denied for table <tabela_fora_da_lista>".

-- 5. Contraprova de que a leitura funciona (papel de leitura e de escrita):
SELECT count(*) FROM <schema>.<tabela_qualquer>;   -- PASSA
```

Para o papel de escrita, prove também que a escrita **na lista** passa e **fora**
não:

```sql
-- PASSA (tabela concedida):
-- INSERT INTO <schema>.<tabela_1> (<col>) VALUES (<valor>);
-- FALHA com "permission denied for table" (tabela não concedida):
-- UPDATE <schema>.<tabela_fora_da_lista> SET <col> = <valor>;
-- FALHA com "permission denied for table" (TRUNCATE nunca foi concedido):
-- TRUNCATE <schema>.<tabela_1>;
```

---

## É este papel privilegiado? — a mesma checagem do `testConnection`, à mão

O DBee avisa em vermelho quando a conexão é `rolsuper` ou membro de
`pg_execute_server_program` (§11.37). Rode isto conectado como o papel (ou troque
`current_user` pelo nome do papel) para conferir à mão:

```sql
SELECT
  current_user                                                        AS papel,
  rolsuper                                                            AS eh_superusuario,
  pg_has_role(current_user, 'pg_execute_server_program', 'USAGE')    AS pode_program,
  pg_has_role(current_user, 'pg_read_server_files',      'USAGE')    AS pode_ler_arquivos,
  pg_has_role(current_user, 'pg_write_server_files',     'USAGE')    AS pode_escrever_arquivos
FROM pg_roles
WHERE rolname = current_user;
```

Os cinco valores têm que ser: papel = o esperado, e os outros quatro **`false`**.
Qualquer `true` nos quatro últimos significa que o modo leitura do DBee não é
barreira para aquela conexão — é exatamente o aviso vermelho.

---

## Como revogar e refazer, se errar um GRANT

Papel não pode ser removido enquanto tiver grants ou possuir objetos. A ordem que
funciona, **por database** onde o papel recebeu algo:

```sql
-- Conectado a CADA <db> onde o papel recebeu grant (DROP OWNED é por database):
DROP OWNED BY dbee_rw_<slug>;        -- remove grants E objetos do papel NESTE db
DROP OWNED BY dbee_ro_<slug>;
REVOKE CONNECT ON DATABASE <db> FROM dbee_ro_<slug>;   -- se o DROP OWNED não cobriu

-- Depois de limpar em todos os databases, do cluster (qualquer database):
DROP ROLE dbee_rw_<slug>;
DROP ROLE dbee_ro_<slug>;
```

> `DROP OWNED BY` **é por database** — rodá-lo num database só limpa aquele. Se o
> papel recebeu grant em três `su_<slug>`, rode nos três antes do `DROP ROLE`,
> senão o `DROP ROLE` falha com "role ... cannot be dropped because some objects
> depend on it".
>
> Refazer: recomece do bloco do papel. Como os `GRANT` são idempotentes
> (conceder de novo não dá erro), na prática dá para **corrigir** sem dropar —
> revogue só o que errou (`REVOKE <priv> ON <obj> FROM <papel>;`) e conceda o
> certo. O `DROP` completo é para recomeçar do zero.

---

## Resumo operacional

- Um par `dbee_ro_<slug>` / `dbee_rw_<slug>` por escritório (decisão 1).
- Rode o prelúdio de `REVOKE … FROM PUBLIC` sempre (decisão 2, variante B).
- No DBee, cada conexão de escritório usa o papel daquele escritório; a conexão
  de uso diário usa o `_ro_`, e só as conexões onde você realmente edita usam o
  `_rw_`, com `write_enabled` ligado.
- Depois de criar, **conecte como o papel e rode a verificação** — o erro do
  Postgres é a prova, não o `GRANT`.
