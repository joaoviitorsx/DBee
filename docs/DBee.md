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

**A fronteira** (ADR [006](adr/006-fronteira-dados-schema-instancia.md)):

> **DBee age sobre dados e schema, dentro de uma transação, com a permissão do
> papel Postgres da conexão. DBee não age sobre a instância.**

Quatro testes decidem qualquer feature nova, sem precisar perguntar:

1. É comando SQL que roda na transação da §6 e cai inteiro no `query_log`? Se não, está fora.
2. Exige processo, arquivo no disco do servidor ou binário externo (`pg_dump`)? Se sim, está fora.
3. Afeta outras sessões ou a disponibilidade, mesmo sendo SQL (`pg_terminate_backend`, `ALTER SYSTEM`, `VACUUM FULL`, `CREATE EXTENSION`)? Se sim, está fora.
4. A ação é reversível pelo próprio usuário, com o que ele vê na tela? Se não, ela **gera SQL** em vez de executar.

**Corolário:** o DBee gera SQL para o usuário ler e rodar; não executa DDL por botão. Gerar `ALTER TABLE … ADD COLUMN` no editor, sim. Item de menu "Excluir tabela" que executa, não — divergência deliberada do DBeaver, cujo botão existe porque ele roda no desktop de uma pessoa, não numa URL compartilhada contra banco de cliente.

Isso não é substituto do pgAdmin para administração de servidor: backup, replicação e gestão de extensões ficam fora pelos testes 2 e 3. É ferramenta de trabalho diário com dados — consultar, inspecionar, exportar, corrigir uma linha.

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

### Dependências aprovadas

Nomeadas para que a regra "pergunte antes de instalar" (`CLAUDE.md`) não pare a
próxima sessão no que já foi decidido. Fora desta lista, ainda vale perguntar.

**Server** — `elysia`, `pg`, `@types/pg` (dev). O resto é primitiva do Bun:
`bun:sqlite`, `Bun.password`, `node:crypto`, `bun test`.

**Front**
| Pacote | Para quê |
|---|---|
| `react`, `react-dom` | — |
| `vite`, `@vitejs/plugin-react` (dev) | build |
| `tailwindcss`, `@tailwindcss/vite` (dev) | Tailwind 4 |
| `@tanstack/react-query` | estado de servidor |
| `@tanstack/react-table`, `@tanstack/react-virtual` | grid virtualizado (§6) |
| `@elysiajs/eden` | Eden Treaty |
| `clsx`, `tailwind-merge`, `class-variance-authority` | base do shadcn/ui |
| `lucide-react` | ícones do shadcn/ui |
| `@radix-ui/react-*` | primitivos por trás dos componentes shadcn/ui em uso |
| `@fontsource-variable/sora` | Sora bundlada, subset latin — sem CDN |
| `codemirror`, `@codemirror/lang-sql` | editor SQL (v0.1) |
| `@codemirror/autocomplete` | autocomplete de tabela/coluna no editor (abre ao digitar; Ctrl+Espaço força) |
| `@dagrejs/dagre` | layout do diagrama ERD — ver nota abaixo |

**`animejs` saiu** (2026-09-05): as cenas animadas viraram o mascote 3D em WebP, e o pacote foi removido.
| `animejs` | as cenas animadas — **fora do bundle inicial**, ver abaixo |

**`animejs` tem uma condição.** Ele entra só por `import()` dinâmico, num chunk
próprio de ~14 kB gzip que o `Trabalhando`/`AuthGate` carregam sob demanda e o
`main.tsx` pré-carrega quando a aba fica ociosa. Medido: o chunk inicial foi de
277,69 para 278,45 kB gzip ao ligar as animações em quatro telas — 0,76 kB, que
é o wrapper, não a biblioteca. **Se algum dia ele aparecer no chunk principal, é
regressão**, e a causa vai ser um `import` estático em algum lugar.

Ele existe porque as cenas têm três ritmos independentes com um ponto de
sincronia — asa em 240 ms, voo em 1,6 s, e a trilha se desenhando junto do voo.
Em `@keyframes` isso vira animações que entram em fase sozinhas de tempos em
tempos, e no instante em que entram o bicho volta a parecer objeto interpolado.
Movimento simples continua em CSS: as cinco animações do `index.css` não saíram.

**`@dagrejs/dagre` faz o layout do diagrama ERD** (`features/diagram/layout.ts`).
Layout de grafo em camadas (Sugiyama) é problema difícil e a alternativa era um
force-directed próprio que espalhava as tabelas soltas; dagre posiciona por
posto ao longo das FKs e dá a leitura "quem referencia quem". É pura JS, entra
no bundle normal (não é grande), e a fronteira foi desenhada de propósito: o
`calcularLayout` troca de miolo sem que o `DiagramView` saiba — se um dia
precisar de outro layout, troca-se um arquivo.

**Ferramenta** (dev, nada disso entra no binário) — `typescript` (pinado, ADR
002), `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`,
`globals`, `@types/bun`.

**Escrito à mão de propósito:** geração de id no padrão nanoid
(`apps/server/src/lib/ids.ts`) — 21 chars, alfabeto de 64 símbolos,
`randomFillSync`. Uma dependência a menos no binário compilado.

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
  ssl_mode        TEXT NOT NULL DEFAULT 'disable',  -- disable | require | verify-full, ver ADR 003
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

**`ssl_mode` tem três valores, não cinco** (ADR [003](adr/003-modos-de-ssl.md)):

| valor | config do `pg` | o que garante |
|---|---|---|
| `disable` | `ssl: false` | nada — texto claro |
| `require` | `ssl: { rejectUnauthorized: false }` | criptografa em trânsito; **não** autentica o servidor, logo não protege contra MITM |
| `verify-full` | `ssl: { rejectUnauthorized: true, ca }` | criptografa **e** valida cadeia e hostname |

`prefer` e `allow` foram removidos de propósito: os dois caem para texto claro em
silêncio quando o TLS falha, o que faz o usuário acreditar que está protegido
quando não está. O `pg` não implementa esse fallback nativamente — isso é sinal,
não obstáculo, e não deve ser recriado com retry.

Default `disable`, explícito: os bancos são alcançados por rede privada e não têm
TLS. Melhor um `disable` honesto que um `prefer` que mente. A UI sempre mostra o
modo em vigor na conexão.

---

## 5. API

Prefixo `/api`. Tudo JSON. Autenticação por cookie de sessão `httpOnly` + `SameSite=Strict`.

### Auth
- `POST /auth/login` — `{ username, password }` → cookie de sessão `httpOnly` + `SameSite=Strict` + `Secure`
- `POST /auth/logout` — apaga a sessão **no servidor**, não só o cookie
- `GET /auth/me` — o usuário da sessão; **401 é resposta, não erro**
- `POST /auth/password` — troca a senha e derruba todas as sessões do usuário
- `POST /connections/:id/rows/update`, `/rows/delete` e `/rows/insert` — edição de uma linha (v0.2). Exige `write_enabled` e `readOnly: false`. WHERE por PK + valores originais (guarda otimista); cardinalidade provada antes do commit; grava o SQL literal no `query_log`. Ver §11.
- `GET /audit?q=&status=&connectionId=&actor=&cursor=` — o `query_log` pesquisável (v0.2). Filtros combinam com AND, paginação por keyset. Só-leitura.
- `PATCH /auth/locale` — `{ locale: "pt" | "en" }` grava o idioma da UI no registro do usuário; devolve o usuário atualizado. Preferência, não segredo — não mexe em cookie nem em sessão

**Todas as outras rotas exigem sessão.** As únicas abertas são `GET /api/health`
(o healthcheck do container não tem cookie) e `POST /api/auth/login`. A lista
vive em `routes/guard.ts` e `guard.test.ts` **varre `app.routes`** — rota nova
sem cobertura faz o teste falhar sozinha.

### Conexões
- `GET /connections` — lista (**sem** `password_enc`)
- `POST /connections` — cria
- `PATCH /connections/:id`
- `DELETE /connections/:id`
- `POST /connections/:id/test` — abre conexão, `SELECT 1`, fecha
- `GET /connections/:id/databases` — lista databases do cluster (`pg_database`, filtrando templates)

### Schema
- `GET /connections/:id/schema/tree?database=X` — árvore **leve** de navegação (schema → relação: nome, tipo, estimativa), dezenas de KB. É o que a árvore desenha; o detalhe vem sob demanda pelo `/schema` completo (ATRITO).
- `GET /connections/:id/schema?database=X` — árvore schemas → tabelas/views → colunas, tipos, PK/FK, índices. Cacheado em memória, TTL 5 min **com stale-while-revalidate** (entrada vencida é servida na hora e revalidada em background); `?refresh=1` força fresco.

### Query
- `POST /connections/:id/query` — `{ database, sql, maxRows?, readOnly? }`
  → `{ columns: [{name, dataTypeId, dataTypeName}], rows: string[][], rowCount, durationMs, truncated }`
- `POST /connections/:id/query/cancel` — `{ queryId }` (via `pg_cancel_backend`)
- `GET /connections/:id/tables/:schema/:table/rows` — paginação por keyset, filtros e ordenação

### Export
- `GET /connections/:id/databases/overview` — databases do cluster com tamanho (`pg_database_size`), encoding, collation, dono e conexões abertas. Só-leitura.
- `GET /connections/:id/activity` — `pg_stat_activity` sem os backends de sistema nem a própria sessão; marca as sessões do DBee. Só-leitura, instantâneo.
- `POST /connections/:id/export` — resposta em **stream**, `Response` cru sem `content-length`

  Origem: `{ kind: "query", sql }` ou `{ kind: "table", schema, table, orderBy, orderDirection, filters }`
  — a origem tabela reusa o **mesmo `RowFilter`** da aba Dados, para o arquivo ser o que está na tela.

  Formatos: `csv` | `json` | `ndjson`. Opções de CSV com os defaults do **Excel pt-BR**:
  `;` e BOM UTF-8 (§11.29). `maxRows` ausente significa **tudo** — é o ponto da rota.

  Medido contra Postgres real (`exporter.integration.test.ts`): 150 mil linhas / 39,5 MB de corpo,
  primeiro byte em **5 ms** de 1,7 s, pico de heap **+14 MB** contra +0 MB para 5 mil linhas.
  A memória não acompanha o tamanho do resultado — é o que a rota existe para garantir.

### Meta
- `GET /meta/version` — `{ current, latest, updateAvailable, releaseUrl }`
- `POST /meta/update` — **planejado** (não implementado): dispararia o webhook de deploy do Dokploy. Ver §8.
- `GET /history?connectionId=&limit=&q=`

---

## 6. Execução de query — regras

Esta seção é a parte que mais quebra se for implementada por instinto.

**Conexão:** sempre no Postgres direto (5432). **Nunca** no PgBouncer em transaction mode — quebra `SET`, prepared statements, cursores e transações interativas.

**Pool:** um pool por **par `(connection_id, database)`**, `max: 3`, `idleTimeoutMillis: 30000`. Pools ociosos há mais de 10 min são destruídos.

> **Corrigido em 2026-09-05.** Esta linha dizia "um pool por `connection_id`" e
> estava errada: `pg` fixa o database na criação do pool, então cada database
> exige o seu. A implementação sempre foi por par — o doc é que descrevia outra
> coisa.
>
> O teto caiu de 5 para 3 porque **ele multiplica**: medido em
> `pg_stat_activity`, uma conexão navegando 2 databases abria 10 backends no
> cluster do cliente. Com 3, a mesma navegação abre 6, e uma quarta requisição
> concorrente enfileira em vez de falhar.

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
- **Usuários individuais desde a v0.1.** Cada pessoa tem usuário e senha própria, com `Bun.password.hash` (argon2id). Sessão por cookie `httpOnly` + `SameSite=Strict`.

  > **Correção de rumo (2026-09-05).** As versões anteriores desta seção previam
  > **senha única compartilhada** (`ADMIN_PASSWORD`) na v0.1, com usuários só na
  > v0.2. Estava errado, e o erro era de premissa, não de cronograma: o §2.4 diz
  > "auditável desde o dia 1 — contexto contábil/fiscal exige isso", e um
  > `query_log` cujo `actor` é a mesma string para todo mundo **não distingue
  > pessoas**. Um log de auditoria que não distingue pessoas dá aparência de
  > controle sem controle, o que em contexto fiscal é pior que não ter log.
  >
  > Login com senha compartilhada não resolveria o "quem" — só adiaria a
  > descoberta. Por isso a autenticação nasce com identidade real.

  Escopo mínimo da v0.1: usuário com senha própria, sessão por cookie, e
  `actor = id do usuário` no `query_log`. **Sem papéis, sem permissão por
  conexão, sem convite por e-mail** — isso é v0.2.

  **Entregue em 2026-09-05.** O primeiro boot cria `admin` com senha aleatória
  de 24 caracteres (alfabeto sem `0/O`, `1/l/I`, `5/S` — ela vai ser lida de um
  log e digitada à mão) e a imprime **uma vez**, com troca obrigatória: senha
  impressa em log é senha conhecida por quem leu o log, e enquanto ela não muda
  a API recusa tudo que não seja trocá-la.

  > **`ADMIN_PASSWORD` saiu.** As versões anteriores desta seção diziam que a
  > env seria a senha do primeiro usuário. Não foi implementada: senha em
  > variável de ambiente fica no compose, no histórico do shell e na tela de
  > configuração do Dokploy, e a senha aleatória com troca obrigatória cobre o
  > mesmo caso sem nenhum desses lugares. Se a env aparecer em algum doc, é
  > resíduo.

  Sessão de 12 horas, expiração absoluta. O que está guardado em `sessions` é o
  **SHA-256 do token**, nunca o token: se o arquivo SQLite vazar por um backup
  ou um volume montado errado, o que está lá não serve como cookie. SHA-256
  basta porque o token tem 256 bits de aleatoriedade — argon2id ali custaria
  ~180 ms **por requisição autenticada** para proteger contra um ataque de
  dicionário que não existe.

  Três coisas com teste próprio, porque são por onde auth costuma vazar:
  logout apaga a sessão **no servidor**; falha de login não distingue "usuário
  não existe" de "senha errada" nem na mensagem nem no tempo (§11.36); e trocar
  a senha derruba **todas** as sessões, inclusive a que fez a troca.

  Enquanto a autenticação não existir, `actor` é a string `"unauthenticated"` —
  **nunca `"admin"`**, que daria ao registro aparência de identidade sem ter
  nenhuma.
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
      APP_SECRET: ${APP_SECRET}   # único obrigatório; ver README e §7
    volumes:
      - dbee-data:/data           # SQLite + salt de cifra: persistir sempre
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

**Atualização.** O que existe hoje: GitHub Actions publica `:latest` e `:vX.Y.Z` a cada tag; atualizar é publicar a tag e re-deployar no Dokploy (o `restart: unless-stopped` + trigger On Push cobrem parte). Container não se auto-atualiza por dentro — nada de montar socket do Docker.

> **Planejado, não implementado (2026-09-05).** A consulta à Releases API 1x/dia, o badge de "há versão nova" e o botão "Atualizar" que chama um webhook do Dokploy estão descritos aqui como intenção — **não estão no código** (`grep` por `releases`/`DOKPLOY_DEPLOY_WEBHOOK` vem vazio). `/meta/update` na §5 é do mesmo pacote futuro. Documentado como planejado para não afirmar recurso que o binário não tem.

---

## 9. Roadmap

### v0.1 — Uso interno, read-only
- [x] Scaffold do monorepo (Bun workspaces), Dockerfile, CI
- [x] ~~**Spike do dia 1:** validar `pg` + `DECLARE CURSOR` no Bun contra uma tabela real grande~~ — concluído. `pg@8.23` sob Bun 1.3.14: sem incompatibilidade, sobrevive ao `bun build --compile`, pool e SCRAM ok, `statement_timeout` efetivo, todos os tipos como string sem perda de precisão. Revelou o bug do read-only corrigido na §6.
- [x] **Login com usuários individuais + sessão** — e não senha única, ver §7. `actor` no `query_log` passa a ser o id do usuário. Último item da v0.1, mas **antes da instalação em produção**: não instalar sem ele.
- [x] CRUD de conexões com senha cifrada + teste de conexão
- [x] Listagem de databases do cluster
- [x] Árvore de schema (tabelas, views, colunas, tipos, PK/FK)
- [x] **Busca na árvore** — trazida da v0.3. Com dois ou três schemas de cliente a árvore passa de cem nós, e sem filtro vira rolagem. Escopo: filtrar por nome de tabela/schema e abrir a aba ao selecionar.
- [x] Editor SQL com `Cmd+Enter`, execução read-only forçada
- [x] Grid virtualizado com tipos preservados como string
- [x] `query_log` gravando tudo
- [x] Export CSV em stream — com seleção retangular e `Ctrl+C` como TSV
- [x] Autocomplete no editor — abre sozinho ao digitar (VSCode-like), Ctrl+Espaço força; alimentado pelo schema
- [x] Ordenação e largura ajustável no cabeçalho do grid; cabeçalho acompanha o scroll horizontal
- [x] Painel dividido editor + dados da tabela de origem
- [x] Diagrama ERD (dagre) — aba própria e sub-aba da tabela
- [x] Tema claro/escuro
- [x] **Idioma PT/EN** — dicionário próprio (`i18n/`), escolha no registro do usuário, mensagens do servidor traduzidas por código, erro do Postgres intacto
- [ ] Deploy no Dokploy pela tailnet

> **Nota (2026-09-05).** Vários itens acima (autocomplete, diagrama, split-view,
> tema, resize/scroll do grid) não estavam no escopo original da v0.1 — entraram
> a pedido do autor durante o desenvolvimento. Estão listados aqui para o
> inventário ficar honesto; a **ordem de fechamento** abaixo não mudou, e o
> idioma PT/EN continua sendo o único item que separa o estado atual da tag.

**Ordem de fechamento da v0.1** (decidida em 2026-09-05, sem exceção — nenhuma
feature nova entra antes):

1. ~~Editor SQL + grid virtualizado~~ — concluído
2. ~~Export CSV em stream~~ — concluído
3. ~~Autenticação com identidade real~~ — concluído
4. **Idioma PT/EN**
5. Tag `v0.1.0` e instalação no Dokploy

O idioma entra **depois da auth e antes da tag**, decidido em 2026-09-05. A
razão é ordem, não preferência: a auth traz um conjunto novo de textos (login,
sessão expirada, permissão negada) e traz **onde guardar a escolha** — o
registro do usuário. Fazer i18n antes seria escrever os textos da auth duas
vezes e guardar a preferência em `localStorage` para migrar depois.

**Alcance da tradução**, decidido junto:

- Sem dependência nova. Dicionário próprio e um `t()`; `react-i18next` são
  ~40 KB para dois idiomas sem pluralização complexa.
- **A UI inteira**, incluindo formatação de número e data por `Intl`.
- **Mensagens do servidor traduzidas pelo código**, não pela prosa: a rota já
  devolve `not_found`, `bad_request` e afins, e o front cai na `message` do
  servidor quando não tem tradução para aquele código. Pega o caso comum sem
  tocar em cada `fail()`; detalhe que carrega nome de tabela vira parâmetro
  quando aparecer.
- **Erro do Postgres não é traduzido.** Ele vai inteiro para a tela, no idioma
  do `lc_messages` do cluster (CLAUDE.md). Traduzir seria reescrever o que o
  banco disse — e é justamente o texto que a pessoa vai colar numa busca.

**Pronto quando:** uma semana de trabalho real sem abrir o DBeaver.

### v0.2 — Escrita controlada

> Usuários individuais **subiram para a v0.1** (§7). O que fica aqui é o que se
> constrói **sobre** identidade: papéis, permissão por conexão, e quem aprova o quê.
- [x] Modo escrita por conexão, com indicador visual permanente (já na v0.1: `write_enabled`, tarja de perigo, `BEGIN READ ONLY/WRITE`)
- [x] Edição inline de célula com diff do SQL antes de aplicar — concorrência otimista + cardinalidade provada antes do commit
- [x] `INSERT`/`DELETE` de linha pela UI — DELETE por PK + cardinalidade; INSERT informa só as colunas escolhidas, as omitidas ficam com default/sequence (coluna gerada informada → erro do Postgres, não detectável na introspecção atual)
- [x] Cancelamento de query em execução — `pg_cancel_backend` por conexão à parte; a query volta com 57014 e o log marca `cancelled`
- [x] Tela de auditoria (histórico pesquisável) — busca por SQL/estado/conexão, keyset

### v0.3 — Workflow
- [ ] Autocomplete schema-aware com resolução de alias
- [ ] Múltiplas abas de query com estado persistido
- [ ] Queries salvas, nomeadas e organizadas
- [ ] `Cmd+K` — busca global de conexão e query salva (o filtro da árvore subiu para a v0.1)
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
15. **`default` em schema TypeBox corrompe `PATCH`.** Ver ADR [004](adr/004-defaults-nunca-no-schema-de-entrada.md), que é onde a decisão mora. O Elysia materializa o default durante a validação, então um `PATCH { timezone }` chega ao repositório com `port: 5432` junto e reaponta a conexão para outro servidor, em silêncio. Achado contra banco real: a porta 55434 virou 5432 depois de um patch que não falava de porta. **Default de campo mora no repositório, na criação — nunca no schema.**
16. **`SET` não aceita placeholder.** `SET x = $1` dá `syntax error at or near "$1"`: `SET` é comando utilitário, não DML. A forma parametrizável é `SELECT set_config('x', $1, true)`, com `true` equivalendo a `SET LOCAL`.
17. **`array_agg(attname)` devolve `name[]`, que o `pg` não converte.** O driver entrega a string crua `{a,b}` em vez de array JS, porque `attname` é do tipo `name` (OID 1003), não `text`. Sempre `array_agg(x::text)` em consulta de catálogo.
18. **Um `Client` do `pg` executa uma consulta por vez.** `Promise.all` de várias `query()` no mesmo client é deprecado e some no `pg@9`. Dentro de uma transação, em sequência.
19. **O formato de erro padrão do Elysia ecoa o corpo submetido.** O campo `found` traz a requisição inteira — **inclusive a senha em claro** — em qualquer 422 de validação. Um erro de digitação no formulário mandava a senha do banco para o devtools, o HAR e qualquer log de resposta no caminho. Exige `onError` próprio, e ele precisa de `{ as: "global" }`: hook de plugin é local por padrão, e sem isso as rotas do app pai continuam com o formato original.
20. **`BEGIN READ ONLY` não fixa o nível de isolamento.** Ele define só o modo de acesso; o isolamento continua READ COMMITTED, em que cada statement pega um snapshot novo. Leitura de várias consultas que precisa ser coerente — a introspecção de catálogo, por exemplo — precisa de `BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ`. Sem isso, um DDL no meio produz relação com zero coluna na árvore, sem erro nenhum.
21. **`oid::int` faz wrap para negativo acima de 2^31.** O cast é binário-coercível e não dá erro. O `pg` lê o `dataTypeID` de um resultado como **não sinalizado**, então a árvore e o resultado de query divergiriam num cluster antigo. Use `::bigint` — e lembre que aí o valor chega como string (§11.2).
22. **`array_agg` sobre `indkey` filtrando `attnum > 0` mente em índice misto.** Em `CREATE INDEX ON t (lower(a), b)` o filtro descarta a expressão e devolve `['b']` — array não-nulo e incompleto, que a UI mostra como índice de coluna única em `b`. É falso na direção que importa: `b` é a segunda chave e o índice não serve para `WHERE b = ?`. Se qualquer chave for expressão, devolva NULL e caia para a definição literal.
23. **`ca: ""` desliga o CA store do sistema.** String vazia não é "sem CA": é uma lista de CAs vazia, que substitui a do sistema e faz todo `verify-full` falhar. E `${VAR:-}` no compose entrega exatamente string vazia. Variável de ambiente em branco tem que virar `undefined` na leitura.
24. **Um arquivo fonte pode sair do alcance de grep e de diff sem que nada acuse.** Uma edição trocou o espaço separador de uma chave de mapa em `pg/pool.ts` por um byte NUL — invisível no terminal e no editor. Efeito: `grep` e `rg` pulavam o arquivo **em silêncio**, `git grep` respondia "Binary file matches" sem a linha, e `git diff` dizia "Binary files differ" sem diff nenhum. O único arquivo que abre a transação read-only ficou fora de toda busca e de toda revisão — anulando o controle que o ADR 001 institui ("revisão de PR que veja essa string deve barrar"). `bun run check:bytes` falha se qualquer fonte tiver byte de controle fora de tab e newline; roda junto do lint e no CI.
25. **Sob Bun, um `kill` que erra o alvo deixa servidor velho servindo.** O `Bun.serve` aceita `SO_REUSEPORT`, então **vários processos escutam a mesma porta ao mesmo tempo** e as requisições fazem round-robin entre eles. O sintoma é o pior possível: o **mesmo** endpoint responde 200 e 404 alternadamente, e testar duas vezes dá resultados diferentes. Custou tempo uma vez — `/databases` dava 404 pelo proxy do Vite e 200 direto na API, com três servidores no ar. O boot agora aborta se a porta já responder; e `ss -ltn | grep :3001` deve mostrar **uma** linha.
26. **NULL quebra a comparação de linha do keyset, e a linha _some_.** Paginação por keyset usa `(coluna, pk) > ($1, $2)`, que é canônico e usa índice. Mas se `coluna` for NULL a comparação devolve **NULL**, não `false` — e a linha é descartada. Numa coluna anulável isso perde, **em silêncio**, todas as linhas com NULL a partir da segunda página: a primeira página mostra tudo, e o que falta nunca aparece. Ninguém deduz isso lendo o SQL.

    Com `ORDER BY c ASC NULLS LAST` existem **dois regimes**, e o cursor precisa carregar em qual deles está:

    ```sql
    -- ainda na região não-nula (cursor.orderValueIsNull = false)
    (c > $v OR (c = $v AND (pk) > ($p)) OR c IS NULL)

    -- já entre os nulos (cursor.orderValueIsNull = true)
    (c IS NULL AND (pk) > ($p))
    ```

    Vale para **qualquer** paginação futura, não só a de linhas. E o teste que pega isso não é contar linhas de uma página: é percorrer todas as páginas e conferir que o conjunto é exatamente a tabela, sem repetição e sem buraco.

26b. **A correção acima, escrita como `OR` numa cláusula só, transforma o keyset em `OFFSET`.** As duas metades desta armadilha precisam ser lidas juntas: a de cima diz *o que a condição tem que selecionar*, e esta diz *que forma ela pode ter*. Consertar uma reintroduzindo a outra é o erro que já aconteceu aqui.

    `(c, pk) > ($v, $p)` e `c > $v OR (c = $v AND pk > $p)` selecionam **exatamente as mesmas linhas** e têm planos completamente diferentes. Medido contra Postgres real, 500 mil linhas, coluna indexada, página 300.000:

    | forma | plano | tempo |
    |---|---|---|
    | disjunção com `OR` | `Filter`, 300.000 linhas descartadas, 300.101 heap fetches | **76,4 ms** |
    | comparação de linha | `Index Cond`, 101 heap fetches | **0,25 ms** |

    **Qualquer `OR` derruba o `Index Cond`** — inclusive `(c, pk) > ($v, $p) OR c IS NULL`, que parece manter a forma canônica e não mantém (medido: 19,3 ms, `Filter`). Então os dois regimes de NULL **não cabem numa cláusula `WHERE` só** sem perder o índice.

    Cabem numa **consulta** só, com `UNION ALL` de dois ramos — 0,50 ms contra 21,0 ms na mesma página, com `Merge Append` preservando a ordem:

    ```sql
    SELECT * FROM (
      (SELECT * FROM t WHERE c IS NOT NULL AND (c, pk) > ($v, $p)
        ORDER BY c ASC, pk ASC LIMIT n+1)
      UNION ALL
      (SELECT * FROM t WHERE c IS NULL
        ORDER BY c ASC, pk ASC LIMIT n+1)
    ) u
    ORDER BY c ASC NULLS LAST, pk ASC LIMIT n+1
    ```

    Dois detalhes que parecem enfeite e não são:

    - **`c IS NOT NULL` explícito no primeiro ramo.** A comparação de linha já exclui NULL sozinha, mas escrevê-lo faz o planejador dobrá-lo **dentro** do `Index Cond` (`Index Cond: ((c IS NOT NULL) AND (ROW(c, pk) > ROW(...)))`).
    - **`ORDER BY c, pk` no ramo dos NULL**, não `ORDER BY pk`. Dentro do ramo `c` é sempre NULL, então as duas ordens são idênticas — mas só a primeira deixa o índice composto servir o ramo: **0,23 ms contra 2,6 ms** numa coluna com NULL raro, onde a segunda forma vira `Sort` sobre todos os nulos.

    **Correção e desempenho aqui são independentes, e é isso que torna a armadilha perigosa:** os 31 testes de correção passavam nas duas formas. O que trava isto é um teste que roda `EXPLAIN` sobre o SQL que o planejador de linhas emite e afirma `Index Cond`, ausência de `Rows Removed by Filter` na casa dos milhares, e ausência de `Filter: ... OR`. Conferido também pelo controle: reintroduzindo a forma antiga de propósito, três dos quatro testes de plano falham.
27. **Ordenação de keyset por coluna não única precisa desempatar pela chave primária.** `ORDER BY c` sozinho não é determinístico quando `c` repete: entre uma página e a seguinte o Postgres pode devolver as linhas empatadas em ordem diferente, e aí linhas repetem ou somem. A ordenação é sempre `(coluna escolhida, ...PK)`, com a PK herdando a mesma direção.
28. **Migration fora de ordem no array corrompe a versão.** Comparar sempre com a versão lida no início do laço faz a 002 rodar depois da 003 e regravar `schema_version = 2`; no boot seguinte a 003 reaplica e estoura em `already exists`, deixando o container em loop de restart. Ordene por versão e releia a versão a cada passo.
29. **`Response.text()` come o BOM, e o teste do BOM passa a testar nada.** O decode UTF-8 do padrão remove a marca de ordem de bytes em silêncio, então `csv.startsWith("\uFEFF")` dá `false` sobre uma resposta que **tem** o BOM no fio. Custou um falso negativo aqui. Conferir BOM exige ler `arrayBuffer()` e decodificar com `new TextDecoder("utf-8", { ignoreBOM: true })`. O BOM importa porque sem ele o Excel assume a codificação da região e `Produção` vira `ProduÃ§Ã£o` — junto com o `;`, é o que faz o arquivo abrir certo em planilha brasileira.
30. **`cancel` do `ReadableStream` que não devolve o cliente esgota o pool, e o sintoma aparece muito depois.** Quem fecha a aba no meio de um download dispara `cancel` no stream do produtor — não `close`. Se só o caminho de `close` encerrar a transação, cada download abandonado deixa um cliente emprestado **para sempre**; com `max: 3` por (conexão, database), o terceiro abandono trava toda a conexão sem erro nenhum, muito depois do clique que causou. O mesmo vale para exceção dentro do `pull`, que também não passa por `cancel`. Um ponto de saída único, chamado exatamente uma vez em qualquer desfecho — fim normal, erro, desistência — é a única forma que não depende de lembrar de cada caminho. O teste que pega isso abandona 8 downloads e exige que o nono complete.
31. **Um `enqueue` por linha custa 13× o tempo de um por lote.** Exportar 150 mil linhas emitindo célula formatada linha a linha levou **14,8 s**; juntando o lote inteiro num `enqueue` só, **1,16 s** — mesmo teto de memória, porque o que vive de cada vez continua sendo um lote. O custo não é o `TextEncoder`: é a fila do `ReadableStream` e o `Uint8Array` por linha. Vale para qualquer produtor de stream, não só o export.
32. **O Elysia valida o corpo ANTES do `onBeforeHandle`, então guard de sessão ali não protege nada de verdade.** A ordem, medida no 1.4.30: `onRequest → onParse → onTransform → derive → validação → onBeforeHandle`. Com o guard em `onBeforeHandle`, uma requisição **sem sessão** e com corpo inválido recebia 422, não 401 — e o status é o menor dos problemas: o corpo do atacante foi lido, parseado e validado por TypeBox antes de qualquer autenticação. O `sql` do export aceita 1 MB, então era `JSON.parse` + validação de 1 MB aberto a quem alcançasse a porta. O guard tem que ser `onRequest`, que roda antes do parse — e ali o cookie precisa ser lido do cabeçalho cru, porque o Elysia ainda não parseou cookies. Achado por um teste que varre `app.routes` e exige 401 em todas; um teste caso a caso teria passado.

33. **`onRequest` não aceita `{ as: "global" }` — e é o único hook assim.** Ele roda antes do roteamento, então já vale para o app inteiro. Passar o objeto de escopo dá `TypeError: undefined is not an object (evaluating 'fn.constructor')` lá dentro do `compose.mjs`, longe da causa. Os outros hooks continuam **locais por padrão** e precisam do `as` (§11.19).

34. **`derive` do Elysia recusa `interface` e aceita `type` com a mesma forma.** `Index signature for type 'string' is missing in type 'X'` — o `derive` exige um tipo provadamente compatível com assinatura de índice, e `interface` é aberta a extensão por declaração, então o TypeScript não consegue provar. É regra do TypeScript, não do Elysia. O `@typescript-eslint/consistent-type-definitions` pede o contrário, e aí a exceção precisa de `eslint-disable` com o motivo escrito.

35. **Valor derivado só entra na tipagem de um hook quando chega por `.use()`.** Na mesma instância (`.derive().onBeforeHandle()`) o valor existe em runtime e **não** no tipo, e a saída fácil é um cast — que passa a mentir na primeira vez que o derive mudar. Dois plugins, um derivando e outro consumindo por `.use()`, resolve sem cast.

36. **Login que sai cedo quando o usuário não existe vaza a lista de quem tem conta.** "Usuário inexistente" responde em ~0 ms e "senha errada" em ~180 ms (o custo do argon2id), e a diferença é medível de fora com três amostras. O caminho do usuário inexistente precisa verificar contra um **hash fixo de comparação**, gastando o mesmo argon2id. E o hash tem que estar no fonte, não calculado no boot: calculado no boot, a **primeira** tentativa seria mais rápida que as seguintes — o mesmo vazamento com outra forma.
37. **`BEGIN READ ONLY` não contém um papel privilegiado: `COPY … TO PROGRAM` fura.** Achado e **reproduzido** na revisão adversarial de 2026-09-05, ponta a ponta, por uma conexão marcada `writeEnabled:false`: `COPY (SELECT 1) TO PROGRAM 'echo … > /tmp/rce'` cria o arquivo no host do Postgres, e a resposta ainda diz `"readOnly":true`. O modo read-only barra DML e DDL (INSERT, UPDATE, DDL, `nextval`, `CREATE TEMP`, `SELECT … INTO`, `DO` com escrita — todos medidos com `25006`), mas `COPY … TO PROGRAM` não modifica linhas do ponto de vista da transação, então não é barrado. Num papel superusuário ou com `pg_execute_server_program`, é **execução de comando no host do banco** — e o público-alvo (contador que conecta como `postgres` no banco do cliente) cai exatamente nesse caso.

    **Não há conserto pelo lado do cliente.** A regra 8 proíbe parser, e um parser erraria de qualquer forma (`copy(select 1)to program`, comentários, casing); pior, um superusuário desfaz qualquer `SET` que tentássemos aplicar na sessão. A defesa é honesta e parcial: `testConnection` detecta o papel privilegiado (`rolsuper OR pg_has_role(current_user,'pg_execute_server_program','USAGE')`) e **avisa em vermelho na árvore** que o modo leitura não é uma barreira ali, recomendando um papel sem esses privilégios. O aviso é `warnings` no `TestConnectionResult`; a fronteira está travada por `readonly-copy.integration.test.ts`, que reproduz o COPY passando e confere que o aviso aparece para o superusuário e some para o papel restrito.

    **Isto corrige um overclaim.** As versões anteriores da §11.4b e do ADR 001 diziam que READ ONLY é *a* proteção de escrita, sem ressalva. Ele é a proteção contra escrita de **linhas**, que é o acidente comum; não é uma caixa de contenção contra um papel que já pode executar programas no servidor. Quem quer contenção de verdade usa um papel restrito — e agora o app diz isso na cara.
38. **Estado de UI de um grid reconciliado no lugar vaza entre resultados.** O `ResultGrid` de um statement não é remontado quando a query roda de novo — o React o reconcilia na mesma posição. A seleção de células (âncora/foco) e as larguras ajustadas **sobreviviam** à troca de resultado: `Ctrl+C` copiava índices do resultado antigo sobre as linhas do novo, em silêncio — a tela afirmando um dado que não é o que está nela. Conserto: resetar seleção e larguras quando a **referência** de `columns` muda, feito **durante o render** guardando a referência anterior (padrão do React para "ajustar estado quando a prop muda"), não num efeito — `setState` síncrono em efeito dispara cascata e o React Compiler recusa. `columns` é estável ao paginar, então a seleção sobrevive à rolagem e só cai a cada nova query.

39. **Objeto literal com chave vinda do banco quebra em `__proto__`/`constructor`.** Largura de coluna guardada em `Record<string, number>` por nome: uma coluna chamada `__proto__` devolve o protótipo em vez de `undefined`, e a largura sai um objeto no `style`; `constructor` devolve a função `Object`. No namespace do autocomplete (`completion.ts`), a atribuição por colchete a `"__proto__"` invoca o setter de protótipo e a tabela some da lista. Não há poluição **global** (confirmado), mas o local quebra. Conserto: `Map` para as larguras e `Object.create(null)` + `Object.hasOwn` no namespace. `Object.fromEntries` (export JSON) já é seguro — cria propriedade própria. Vale para qualquer objeto cujas chaves venham do catálogo do cliente.

40. **`${a}.${b}` como id colide quando o identificador aceita o separador.** O id de nó do diagrama era `${schema}.${relation}`; identificador Postgres citado aceita ponto, então schema `"a.b"`+tabela `c` e schema `a`+tabela `"b.c"` davam o mesmo `a.b.c`, e um nó sobrescrevia o outro. `JSON.stringify([schema, relation])` é inambíguo e sem byte de controle — NUL como separador seria pior (o projeto barra NUL em fonte, §11.24, e assustaria em runtime). Vale para qualquer chave composta a partir de dois nomes livres.
