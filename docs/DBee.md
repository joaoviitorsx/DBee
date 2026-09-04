# DBee

Cliente PostgreSQL web, self-hosted, para uso diário em produção.

> **Status:** especificação inicial — v0.1 ainda não iniciada.
> **Dono:** JV · **Repo:** `<seu-usuario>/dbee` (projeto pessoal, conta própria)
>
> **Nota sobre o nome:** existem outros projetos chamados `dbee` — o `nvim-dbee` (cliente de banco para Neovim) e o `5ika/dbee` (CLI de backup PostgreSQL). Nenhum conflito de uso, mas leve isso em conta ao escolher nome de pacote publicado ou domínio, e ao buscar referências na web.

---

## 1. Por que existe

Hoje o acesso aos bancos dos projetos da empresa passa por túnel SSH + DBeaver desktop. Isso significa: setup por máquina, túnel que cai, nenhum histórico compartilhado e nada de acessar de um celular ou de uma máquina que não seja a sua.

O DBee substitui esse fluxo por uma URL na tailnet. Abre o navegador, escolhe a conexão, roda a query.

**O que ele não é:** não é substituto do pgAdmin para administração de servidor (backup, replicação, gestão de extensões). É ferramenta de trabalho diário com dados — consultar, inspecionar, exportar, corrigir uma linha.

**Critério de sucesso da v0.1:** uma semana inteira de trabalho sem abrir o DBeaver.

---

## 2. Princípios

1. **Read-only por padrão.** Escrita é um modo explícito, ligado por conexão. Erro de digitação não derruba dado de cliente.
2. **Instalação em um container.** Sem banco externo, sem serviço auxiliar, sem passo de configuração obrigatório antes da primeira tela.
3. **Segurança pela rede, não pela UI.** O app nunca é exposto à internet. A autenticação existe como segunda camada, não como única.
4. **Auditável desde o dia 1.** Toda query executada fica registrada. Contexto contábil/fiscal exige isso.
5. **Rápido em tabela grande.** 100k linhas não podem travar a aba. Virtualização e streaming não são otimização tardia, são requisito.

---

## 3. Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Runtime | Bun 1.3.x | TS nativo sem build step, startup rápido, toolchain unificada |
| Framework | Elysia 1.4.x | Feito para Bun, type inference ponta a ponta, OpenAPI automático |
| Validação | TypeBox (`t` do Elysia) | Alimenta Eden e OpenAPI de graça; schemas em `packages/shared` |
| Cliente tipado | Eden Treaty | Front consome a API com tipos do server, sem codegen |
| Driver PG | `pg` (puro JS) + cursor SQL | Ver seção 6 — streaming feito por `DECLARE CURSOR`, não por lib |
| Tipos | `@types/pg`, `@types/bun` (dev) | Só definições, sem runtime |
| Metadados | `bun:sqlite` | Embutido no runtime, síncrono, sem módulo nativo pra compilar |
| Hash de senha | `Bun.password` (argon2id) | Nativo, sem dependência |
| Cripto | `node:crypto` (compat Bun) | AES-256-GCM + scrypt |
| Frontend | React 19 + Vite | — |
| Estilo | Tailwind 4 + shadcn/ui | Componentes acessíveis, dark mode nativo |
| Estado servidor | TanStack Query | Cache, invalidação, retry |
| Grid | TanStack Table + TanStack Virtual | Virtualização obrigatória |
| Editor SQL | CodeMirror 6 + `@codemirror/lang-sql` | Leve, autocomplete alimentável por schema |
| Testes | `bun test` | Embutido |
| Monorepo | Bun workspaces | — |
| Container | `oven/bun` multi-stage → binário `--compile` | Imagem enxuta, 2-3x menos memória |

**Plugins Elysia:** `@elysiajs/static` (serve o build do web), `@elysiajs/cookie`, `@elysiajs/openapi`.
Rate limit e headers de segurança: implementação própria em middleware — o ecossistema Elysia é menor que o do Fastify aqui, e neste app o escopo é pequeno o bastante para não justificar dependência.

### Estrutura

```
dbee/
├─ apps/
│  ├─ server/          Elysia, rotas, pools, cripto, SQLite
│  │  ├─ src/
│  │  │  ├─ routes/    auth, connections, query, schema, history, meta
│  │  │  ├─ db/        migrations SQLite (bun:sqlite), repositórios
│  │  │  ├─ pg/        pool manager, executor, cursor, introspecção
│  │  │  └─ lib/       crypto, config, logger
│  └─ web/             React, Vite
│     └─ src/
│        ├─ routes/    connections, editor, browser
│        ├─ components/
│        └─ lib/       api client, hooks
├─ packages/shared/    schemas TypeBox e tipos compartilhados
├─ deploy/             docker-compose.yml para o Dokploy
├─ docs/adr/           decisões de arquitetura
├─ ATRITO.md           registro de fricção do uso real
├─ CHANGELOG.md
└─ Dockerfile
```

---

## 4. Modelo de dados (SQLite)

```sql
CREATE TABLE connections (
  id              TEXT PRIMARY KEY,          -- nanoid
  name            TEXT NOT NULL,
  color           TEXT,                      -- tag visual (ex: vermelho = prod)
  host            TEXT NOT NULL,
  port            INTEGER NOT NULL DEFAULT 5432,
  database        TEXT NOT NULL,
  username        TEXT NOT NULL,
  password_enc    TEXT NOT NULL,             -- AES-256-GCM, nunca retornado pela API
  ssl_mode        TEXT NOT NULL DEFAULT 'prefer',
  write_enabled   INTEGER NOT NULL DEFAULT 0,
  statement_timeout_ms INTEGER NOT NULL DEFAULT 30000,
  timezone        TEXT NOT NULL DEFAULT 'UTC',   -- fixado por sessão, ver §6
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE query_log (
  id            TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  database      TEXT NOT NULL,
  sql           TEXT NOT NULL,
  status        TEXT NOT NULL,               -- ok | error | cancelled
  error         TEXT,
  row_count     INTEGER,
  duration_ms   INTEGER,
  read_only     INTEGER NOT NULL,
  actor         TEXT NOT NULL,               -- v0.1: 'admin'
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

CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

Migrations versionadas em `apps/server/src/db/migrations/NNN_nome.sql`, aplicadas no boot em ordem, com a versão atual em `app_meta`.

---

## 5. API

Prefixo `/api`. Tudo JSON. Autenticação por cookie de sessão `httpOnly` + `SameSite=Strict`.

### Auth
- `POST /auth/login` — `{ password }` → seta cookie. Rate limit: 5 tentativas / 15 min por IP.
- `POST /auth/logout`
- `GET /auth/me`

### Conexões
- `GET /connections` — lista (**sem** `password_enc`)
- `POST /connections` — cria
- `PATCH /connections/:id`
- `DELETE /connections/:id`
- `POST /connections/:id/test` — abre conexão, `SELECT 1`, fecha
- `GET /connections/:id/databases` — lista databases do cluster (`pg_database`, filtrando templates)

### Schema
- `GET /connections/:id/schema?database=X` — árvore schemas → tabelas/views → colunas, tipos, PK/FK, índices. Cacheado em memória, TTL 5 min, com `?refresh=1`.

### Query
- `POST /connections/:id/query` — `{ database, sql, maxRows?, readOnly? }`
  → `{ columns: [{name, dataTypeId, dataTypeName}], rows: string[][], rowCount, durationMs, truncated }`
- `POST /connections/:id/query/cancel` — `{ queryId }` (via `pg_cancel_backend`)
- `GET /connections/:id/tables/:schema/:table/rows` — paginação por keyset, filtros e ordenação

### Export
- `POST /connections/:id/export` — mesma entrada da query, resposta em stream CSV ou NDJSON

### Meta
- `GET /meta/version` — `{ current, latest, updateAvailable, releaseUrl }`
- `POST /meta/update` — dispara o webhook de deploy do Dokploy (só se `DOKPLOY_DEPLOY_WEBHOOK` estiver setado)
- `GET /history?connectionId=&limit=&q=`

---

## 6. Execução de query — regras

Esta seção é a parte que mais quebra se for implementada por instinto.

**Conexão:** sempre no Postgres direto (5432). **Nunca** no PgBouncer em transaction mode — quebra `SET`, prepared statements, cursores e transações interativas.

**Pool:** um pool por `connection_id`, `max: 5`, `idleTimeoutMillis: 30000`. Pools ociosos há mais de 10 min são destruídos.

**Sessão read-only — `BEGIN READ ONLY`, e só isso.** Escrita retorna erro do próprio Postgres (SQLSTATE `25006`), que é a proteção correta. **Não tentar detectar `UPDATE`/`DELETE` com regex ou parser:** falsos negativos são inevitáveis (CTE com `INSERT`, função com efeito colateral, `SELECT` que chama procedure) e falsos positivos irritam (`SELECT * FROM update_log`).

> ⚠️ **`SET LOCAL default_transaction_read_only = on` NÃO protege a transação corrente.**
> Esse GUC define o modo que transações **futuras** herdam ao iniciar. Dentro de um `BEGIN`
> já aberto, `transaction_read_only` continua `off` e `UPDATE`, `DELETE`, `TRUNCATE` e DDL
> passam normalmente. Isso foi verificado na prática no spike de validação — a receita
> anterior desta seção dava aparência de proteção sem proteger nada. O GUC que manda é
> `transaction_read_only`, e a forma correta de setá-lo é no próprio `BEGIN`.

**Streaming — cursor no SQL, não em biblioteca.** `pg-cursor` e `pg-query-stream` dependem de streams do Node e são o ponto mais provável de atrito no Bun. O DBee não depende deles: usa cursor do próprio Postgres, dentro da transação que já é aberta para o read-only.

```sql
BEGIN READ ONLY;                        -- ou BEGIN READ WRITE no modo escrita
SET LOCAL statement_timeout = <ms>;
SET LOCAL TimeZone = '<tz da conexão>';
DECLARE dbee_<queryId> NO SCROLL CURSOR FOR <sql do usuário>;
FETCH <n> FROM dbee_<queryId>;          -- em laço, ver abaixo
CLOSE dbee_<queryId>;
COMMIT;
```

O modo é decidido no `BEGIN` — não em comando posterior. `BEGIN READ ONLY` fecha a janela em que a transação existiria gravável, e evita um round-trip. No modo escrita, `BEGIN READ WRITE` explícito, nunca `BEGIN` pelado: o modo tem que estar sempre visível no log e no código.

**FETCH é em lotes, sempre.** `FETCH n` materializa as n linhas de uma vez na memória do processo — o cursor evita puxar a tabela inteira, mas não faz streaming incremental. Medido: ~2 KB de RSS por linha numa tabela de 20 colunas (1k linhas → 13 MB; 500k → 948 MB). Portanto:

- **Query interativa:** um `FETCH maxRows + 1`. A linha extra revela truncamento sem contar a tabela — se voltou uma a mais, descarta e marca `truncated: true`. Default `maxRows` = 1000, custo desprezível.
- **Export (§5):** laço de `FETCH 1000` escrevendo cada lote na resposta antes de buscar o próximo. Nunca um `FETCH` gigante. É isso que torna o export realmente streaming.

**Não injetar `LIMIT` no SQL do usuário.**

Cursor só aceita um comando. Para múltiplos statements separados por `;`, executa em sequência e aplica o cursor a cada um que retorne linhas.

**`position` do erro precisa ser corrigida.** O SQL do usuário vai embrulhado em `DECLARE dbee_<id> NO SCROLL CURSOR FOR `, então a `position` que o Postgres devolve é relativa à string embrulhada, não à do usuário. Subtraia o comprimento do prefixo antes de mandar pra UI — **calculado, nunca hardcoded**, já que o nome do cursor pode mudar. Statements executados fora do cursor não têm deslocamento: guarde o offset por execução, com valor 0 nesse caso. Sem isso, o editor destaca a coluna errada.

**`TimeZone` é fixado por sessão.** Com parser textual, quem formata `timestamptz` é o servidor, e o mesmo dado aparece diferente conforme o `TimeZone` da sessão. Fixar sempre, explicitamente. Default `UTC`, sobrescrevível por conexão (campo `timezone` em `connections`). A UI indica qual timezone está em vigor — valor sem timezone declarado é pior que valor em UTC.

**Serialização de tipos — atenção:** o driver `pg` devolve `bigint`, `numeric` e `money` como string para não perder precisão, e `timestamptz` como `Date` no timezone do processo. Política do DBee:

- Configurar parsers para devolver **tudo como string**, no formato textual do Postgres.
- `jsonb`/`json` continuam como string; a UI formata na visualização de célula.
- Arrays viram sua representação textual (`{1,2,3}`).
- `bytea` não é renderizado — a célula mostra `\x… (N bytes)` com opção de download.
- O tipo real vai em `columns[].dataTypeName` para a UI decidir alinhamento e formatação.

Isso evita a classe inteira de bug "o número apareceu diferente na tela".

**Múltiplos statements:** permitido, separados por `;`. Executa em sequência, retorna array de resultados, mostra abas de resultado.

---

## 7. Segurança

- **Senhas de conexão:** AES-256-GCM. Chave derivada de `APP_SECRET` via `scrypt` com salt fixo por instalação (guardado em `app_meta`). IV aleatório por registro. Se `APP_SECRET` mudar, as conexões ficam ilegíveis — documentar isso no README de forma bem visível.
- **Senha de acesso:** `Bun.password.hash` (argon2id) sobre `ADMIN_PASSWORD`. Se a env não estiver setada, o app gera uma senha aleatória no primeiro boot e imprime no log uma única vez.
- **Nunca** retornar `password_enc` nem a senha em claro por nenhuma rota, nem em log, nem em mensagem de erro.
- **Exposição:** sem porta publicada. Acesso só via Traefik do Dokploy com a regra da tailnet, ou porta bindada no IP `100.x` do Tailscale. O mesmo padrão DOCKER-USER já aplicado na 3000 e na 15672.
- **Headers:** middleware próprio setando CSP restritiva, `X-Content-Type-Options`, `Referrer-Policy`. Sem CDN externo (tudo bundlado).
- **Rate limit:** middleware próprio em memória, só na rota de login. Não precisa de store distribuído — é uma instância única.
- **Log:** sem corpo de resultado, sem credencial. SQL vai pro `query_log`, não pro stdout.

---

## 8. Deploy

`Dockerfile` multi-stage sobre `oven/bun`: build do web (Vite) → `bun build --compile --target bun-linux-x64` do server → runtime `debian-slim` com o binário e os assets estáticos. Sem Bun instalado na imagem final. Publicada em `ghcr.io/<seu-usuario>/dbee`.

```yaml
# deploy/docker-compose.yml
services:
  dbee:
    image: ghcr.io/<seu-usuario>/dbee:latest
    restart: unless-stopped
    environment:
      APP_SECRET: ${APP_SECRET}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      DOKPLOY_DEPLOY_WEBHOOK: ${DOKPLOY_DEPLOY_WEBHOOK:-}
    volumes:
      - dbee-data:/data
    networks:
      - dokploy-network

volumes:
  dbee-data:
networks:
  dokploy-network:
    external: true
```

Serviço no Dokploy: provider Git apontando para o repo pessoal `dbee`, branch `main`, Compose Path `deploy/docker-compose.yml`, trigger On Push. Mesmo fluxo já validado com o PgBouncer.

Como o repo é pessoal e privado, o GitHub App do Dokploy precisa receber acesso a ele explicitamente — não basta o acesso já concedido aos repos da organização.

**Healthcheck:** `GET /api/health` → 200 se SQLite responde.

**Atualização:** GitHub Actions publica `:latest` e `:vX.Y.Z` a cada tag. O app consulta a Releases API 1x/dia, compara com a versão do build e mostra badge. Botão "Atualizar" chama o webhook do Dokploy. Container não se auto-atualiza por dentro — nada de montar socket do Docker.

---

## 9. Roadmap

### v0.1 — Uso interno, read-only
- [ ] Scaffold do monorepo (Bun workspaces), Dockerfile, CI
- [x] ~~**Spike do dia 1:** validar `pg` + `DECLARE CURSOR` no Bun contra uma tabela real grande~~ — concluído. `pg@8.23` sob Bun 1.3.14: sem incompatibilidade, sobrevive ao `bun build --compile`, pool e SCRAM ok, `statement_timeout` efetivo, todos os tipos como string sem perda de precisão. Revelou o bug do read-only corrigido na §6.
- [ ] Login com senha única + sessão
- [ ] CRUD de conexões com senha cifrada + teste de conexão
- [ ] Listagem de databases do cluster
- [ ] Árvore de schema (tabelas, views, colunas, tipos, PK/FK)
- [ ] Editor SQL com `Cmd+Enter`, execução read-only forçada
- [ ] Grid virtualizado com tipos preservados como string
- [ ] `query_log` gravando tudo
- [ ] Export CSV em stream
- [ ] Deploy no Dokploy pela tailnet

**Pronto quando:** uma semana de trabalho real sem abrir o DBeaver.

### v0.2 — Escrita controlada
- [ ] Modo escrita por conexão, com indicador visual permanente
- [ ] Edição inline de linha com diff do SQL antes de aplicar
- [ ] `INSERT`/`DELETE` de linha pela UI
- [ ] Cancelamento de query em execução
- [ ] Tela de auditoria (histórico pesquisável)

### v0.3 — Workflow
- [ ] Autocomplete schema-aware com resolução de alias
- [ ] Múltiplas abas de query com estado persistido
- [ ] Queries salvas, nomeadas e organizadas
- [ ] `Cmd+K` — busca global de tabela/conexão/query salva
- [ ] `EXPLAIN ANALYZE` com visualização de plano
- [ ] Responsivo: resultado vira lista de cards no mobile

### v0.4 — Cenário Assertivus
- [ ] Seletor de escritório `su_<slug>` como conceito de primeira classe
- [ ] Agrupamento de conexões por projeto
- [ ] O que o `ATRITO.md` mandar

---

## 10. Processo

**`ATRITO.md`** — toda vez que a ferramenta atrapalhar no uso real, uma linha ali no momento em que doeu:

```
2026-09-12 · precisava ver o resultado de duas queries lado a lado, tive que abrir outra aba do navegador
```

Sem formatar, sem julgar se vale. **Triagem semanal de 15 min:** lê o arquivo, converte o que sobreviveu em issue com label `atrito`, limpa. O que aparecer 3 vezes vira prioridade automática.

**Convenções:** Conventional Commits · branch `main` protegida, trabalho em `feat/*` e `fix/*` · SemVer, release por tag · `docs/adr/NNN-titulo.md` para decisão de arquitetura que alguém vai questionar em seis meses.

---

## 11. Armadilhas conhecidas

Registradas aqui para não serem redescobertas pela terceira vez:

1. **PgBouncer transaction mode quebra a ferramenta.** Sempre 5432.
2. **`numeric` e `bigint` viram string no `pg`.** Tratar como string em todo o caminho.
3. **Grid sem virtualização trava o navegador** em poucas milhares de linhas.
4. **Regex não valida SQL.** A proteção de escrita é o modo da transação, declarado em `BEGIN READ ONLY`.
4b. **`default_transaction_read_only` não protege a transação já aberta.** Verificado no spike: com ele setado via `SET LOCAL` dentro de um `BEGIN`, `UPDATE`, `DELETE`, `TRUNCATE` e DDL passam. Se em alguma revisão essa linha voltar ao doc ou ao código, é regressão de segurança, não estilo.
5. **`APP_SECRET` perdido = conexões perdidas.** Precisa estar no gerenciamento de segredos do Dokploy, não só no `.env` local.
6. **Query longa segura o pool.** `statement_timeout` sempre setado, sem exceção.
7. **Auto-update por dentro do container** exige socket do Docker montado — buraco de segurança grave. Webhook do Dokploy resolve.
8. **`pg-cursor` e `pg-query-stream` podem não se comportar no Bun.** Por isso o streaming é feito com `DECLARE CURSOR` em SQL puro. Se em algum momento alguém propuser trazer essas libs de volta, releia a seção 6.
9. **`bun build --compile` e módulos nativos não se dão bem.** Manter o backend em dependências puro-JS. `bun:sqlite` é embutido no runtime e funciona no binário; um `better-sqlite3` da vida quebraria.
10. **Eden Treaty acopla front e server pelo tipo exportado.** Mudança de rota quebra o build do web — isso é o comportamento desejado, não um bug a contornar com `any`.
11. **`FETCH n` não é streaming.** Materializa as n linhas de uma vez. Export sempre em laço de lotes. Ver §6.
12. **`position` do erro vem deslocada pelo prefixo do `DECLARE`.** Corrigir calculando o comprimento do prefixo, nunca com constante literal.
13. **`jsonb` chega normalizado pelo Postgres** (chaves reordenadas, espaçamento próprio); `json` chega literal. A UI não deve prometer preservar a formatação original de `jsonb`.
14. **`NULL` (JS `null`) é diferente da string `NULL` dentro da representação textual de um array.** A UI precisa distinguir os dois visualmente.
