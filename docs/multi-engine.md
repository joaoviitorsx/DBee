# Expandir o DBee para outros bancos

Plano para o DBee deixar de ser só-Postgres. Escrito depois de medir o que
realmente difere, não do que parece diferir.

## Resumo

| engine | fase | vista | garantia de somente-leitura | estado |
|---|---|---|---|---|
| PostgreSQL | — | grade | transação, cobre DDL | **pronto** |
| MySQL | 1 e 2 | grade | transação, **não** cobre DDL | planejado |
| MariaDB | 1 e 2 | grade | igual ao MySQL | planejado |
| SQLite | 3 | grade | conexão, cobre DDL | planejado |
| libSQL | 3 | grade | igual ao SQLite | planejado |
| MongoDB | 4 | árvore de documentos | **credencial** | planejado, não agendado |
| Redis | 5 | par chave/valor (6 tipos) | **credencial** | planejado, não agendado |

Todas as garantias da coluna foram medidas contra servidor real, não lidas na
documentação — ver a seção 1.

## O que este plano NÃO é

A referência visual é o seletor do Dokploy — PostgreSQL, MongoDB, MariaDB,
MySQL, Redis, libSQL lado a lado. Vale dizer em voz alta que **o Dokploy
resolve outro problema**: ele *provisiona* — sobe um container com aquele
banco. Trocar de engine ali é trocar de imagem Docker.

O DBee *opera* um banco que já existe: lê catálogo, executa consulta, pagina
resultado, edita linha, exporta. Cada uma dessas cinco coisas é diferente em
cada engine, e duas delas nem existem fora do modelo relacional.

Copiar a grade de ícones sem isso é prometer paridade que não há. Um cartão
"Redis" ao lado de um cartão "PostgreSQL", do mesmo tamanho, diz que os dois
fazem o mesmo — e não fazem.

## O que de fato muda, medido

### 1. A garantia de somente-leitura não atravessa

Esta é a descoberta que reordena o plano. A regra 8 do `CLAUDE.md` diz que a
proteção contra escrita é o **modo da transação**, declarado no `BEGIN`. Medido
contra servidores reais de cada engine:

| engine | mecanismo | barra DML | barra DDL | escopo |
|---|---|---|---|---|
| PostgreSQL 16 | `BEGIN READ ONLY` | sim | **sim** | transação |
| MySQL 8.4 / MariaDB | `START TRANSACTION READ ONLY` | sim | **NÃO** | transação |
| SQLite / libSQL | `PRAGMA query_only = ON` | sim | sim | conexão |
| MongoDB 7 | papel `read` | sim | sim | **credencial** |
| Redis 7 | ACL `+@read` | sim | n/a | **credencial** |

Três achados, e cada um muda o plano:

**MySQL deixa DDL passar.** `START TRANSACTION READ ONLY` cobre DML e não cobre
comando de esquema — DDL faz commit implícito e escapa da transação. No Postgres
o mesmo `CREATE TABLE` morre com *cannot execute CREATE TABLE in a read-only
transaction*; no MySQL a tabela é criada. A promessa central do produto vale no
Postgres e **não vale igual** no MySQL.

**No Mongo e no Redis a garantia não é da operação, é da credencial.** Nos dois
não existe "esta transação é somente leitura": o que existe é um usuário que não
pode escrever. Medido — o papel `read` do Mongo recusa `insert`, `update`,
`drop`, `createCollection` e `$out` com `Unauthorized`; a ACL `+@read` do Redis
recusa `SET`, `DEL` e `FLUSHALL` com `NOPERM`.

Isso quebra o desenho da UI, não só o do driver. Hoje o DBee liga a escrita
**por execução** — o interruptor "permitir escrita nesta execução" faz a próxima
transação nascer `READ WRITE` na mesma conexão. Com credencial, isso exige
**duas credenciais por conexão**: uma só-leitura para o uso normal e uma
gravável para o momento da escrita. A alternativa — uma credencial gravável e o
DBee prometendo não mandar comando de escrita — é proteção por lista de
comandos, exatamente o que a regra 8 recusa por saber que sempre tem um caso que
escapa.

**Cuidado ao medir Mongo.** Um container `mongo:7` sem `MONGO_INITDB_ROOT_*`
sobe **sem controle de acesso**, e aí papel nenhum é aplicado: na primeira
medição o usuário "somente leitura" apagou a coleção inteira. O número só vale
com `--auth` ligado. Vale como aviso operacional também: um Mongo sem auth não
tem somente-leitura nenhum, independentemente do que o DBee faça.

### 2. Dois grupos, e o segundo não é uma engine a mais

| | modelo | a UI de hoje serve? | garantia de leitura | esforço |
|---|---|---|---|---|
| **MySQL / MariaDB** | relacional, SQL | sim | transação (sem DDL) | médio |
| **SQLite / libSQL** | relacional, SQL | sim | conexão | baixo–médio |
| **MongoDB** | documentos | **não** — precisa de outra vista | credencial | alto |
| **Redis** | chave-valor | **não** — precisa de outro produto | credencial | alto |

A grade virtualizada, o editor SQL, o keyset por PK, o diagrama ERD e o
`INSERT`/`UPDATE` com preview são todos construídos sobre "linhas com colunas e
chave primária". No Mongo isso vira documento aninhado sem esquema fixo; no
Redis não existe nem tabela.

Fazer os dois primeiros é evolução. Fazer os dois últimos é construir uma
segunda vista dentro do mesmo app — e o plano abaixo diz exatamente qual.

### 3. O que muda dentro do grupo relacional

| tema | Postgres | MySQL/MariaDB | SQLite/libSQL |
|---|---|---|---|
| catálogo | `pg_catalog`/`pg_class` | `information_schema` | `pragma_table_info`, `sqlite_master` |
| hierarquia | conexão → database → **schema** → tabela | conexão → database → tabela (sem schema) | arquivo → tabela (sem database, sem schema) |
| citar identificador | `"aspas duplas"` | `` `crase` `` | `"aspas duplas"` |
| streaming | `DECLARE CURSOR` + `FETCH` | cursor do protocolo / `LIMIT` | `LIMIT` |
| tipos no fio | tudo texto (regra 10) | driver converte — precisa da mesma trava | idem |
| somente leitura | `BEGIN READ ONLY` | `START TRANSACTION READ ONLY` (não cobre DDL) | `PRAGMA query_only` (cobre DDL — medido) |
| cancelar query | `pg_cancel_backend` | `KILL QUERY` | não há |

A **hierarquia** é a que mais dói na UI: a árvore hoje tem quatro níveis, e o
MySQL tem três. Não dá para fingir um nível de schema que não existe — a árvore
precisa saber quantos níveis aquela conexão tem.

## Onde o Postgres está preso hoje

Medido no repositório:

```
apps/server/src/pg/     5.966 linhas, 9 arquivos
  pool.ts        500   introspect.ts  475   bundle.ts   404
  rows.ts        345   exporter.ts    216   executor.ts 213
  ssl.ts         127   columns.ts      46   tipos.ts     18
```

Fora dessa pasta, **11 arquivos** do servidor falam Postgres direto (rotas de
`rows` e `schema`, e os serviços de conexão, ddl, export, mutation, query, rows
e schema). No front, o acoplamento é menor e concentrado: o formulário de
conexão, a árvore, o autocomplete e os modais de escrita.

A boa notícia é que a pasta `pg/` já é quase uma fronteira. A ruim é que os
serviços importam dela direto, então a fronteira existe no sistema de arquivos
e não no tipo.

## O desenho: porta e adaptador, com capacidades declaradas

Uma interface `Driver` por engine, e — a peça que evita o pior erro — um objeto
de **capacidades** que a UI lê para esconder o que aquela engine não faz.

```ts
export interface Driver {
  readonly engine: "postgres" | "mysql" | "mariadb" | "sqlite" | "mongodb" | "redis";
  readonly capabilities: Capabilities;

  testar(conn: ResolvedConnection): Promise<TestResult>;
  listarDatabases(conn: ResolvedConnection): Promise<DatabaseInfo[]>;
  introspectar(conn: ResolvedConnection, database: string): Promise<DatabaseSchema>;

  /** A transação nasce no modo pedido — e o driver PROVA que nasceu. */
  comTransacao<T>(
    conn: ResolvedConnection, database: string, escrita: boolean,
    corpo: (c: Sessao) => Promise<T>,
  ): Promise<T>;

  executar(s: Sessao, sql: string): Promise<ResultSet[]>;
  lerLinhas(s: Sessao, alvo: Alvo, cursor: Cursor | null): Promise<Pagina>;
  citar(identificador: string): string;
}

export interface Capabilities {
  /** Quantos níveis a árvore tem: 4 no Postgres, 3 no MySQL, 2 no SQLite. */
  readonly niveis:
    | "conexao/database/schema/tabela"
    | "conexao/database/tabela"
    | "arquivo/tabela"
    | "conexao/database/colecao"   // Mongo
    | "conexao/db-numerado";       // Redis

  /**
   * ONDE mora a garantia de somente-leitura. É a capacidade que mais muda a UI:
   * com `credencial`, o interruptor "permitir escrita nesta execução" não pode
   * existir como está — a conexão precisa de duas credenciais.
   */
  readonly escopoReadOnly: "transacao" | "conexao" | "credencial";
  /** A garantia cobre DDL? No MySQL, NÃO — medido. */
  readonly readOnlyCobreDdl: boolean;

  /** A vista de resultado: grade de linhas, árvore de documentos, ou par chave/valor. */
  readonly vista: "grade" | "documentos" | "chave-valor";

  readonly sqlLivre: boolean;      // Redis e Mongo não têm SQL
  readonly cancelarQuery: boolean; // não há no SQLite
  readonly diagramaErd: boolean;   // precisa de FK declarada
  readonly exportSql: boolean;
}
```

`capabilities` não é enfeite: é o que impede a UI de oferecer um botão que a
engine não honra. E `readOnlyCobreDdl: false` tem consequência visível — no
MySQL o app precisa dizer que a proteção é parcial, em vez de deixar a pessoa
supor a garantia do Postgres.

## Fases

Cada fase entrega uma engine **utilizável**, não meio caminho. A ordem sai da
medição: primeiro o que reusa a UI que existe, depois o que exige vista nova.

**Fase 0 — fechar a fronteira, ainda só com Postgres.** Extrair a interface
`Driver` e fazer os 11 arquivos passarem a depender dela, não de `pg/`. Nenhuma
funcionalidade nova; o critério de pronto é a suíte inteira passando sem
alteração de teste. É a fase que torna as outras baratas, e a única sem risco de
regressão porque não há comportamento novo.

**Fase 1 — MySQL e MariaDB, somente leitura.** Driver novo, árvore de três
níveis, citação com crase, catálogo por `information_schema`. **Escrita
desligada**, porque a garantia não cobre DDL: liberar antes de resolver isso
seria vender proteção que não existe. Critério de pronto: os mesmos testes de
integração do Postgres, contra um container MySQL de verdade. MariaDB entra na
mesma fase — o dialeto e o catálogo são compatíveis no que o DBee usa; o que
muda é a string de versão.

**Fase 2 — escrita no MySQL/MariaDB.** Papel restrito documentado
(`docs/papeis-mysql.md`), detecção de papel privilegiado no teste de conexão, e
o aviso na UI de que a proteção é parcial. Só então ligar edição de linha.

**Fase 3 — SQLite e libSQL.** Mais barato que o MySQL em quase tudo — dois
níveis, `PRAGMA query_only` cobrindo DML e DDL (medido). O que exige decisão é o
que "conexão" significa: no SQLite é um **caminho de arquivo** que o container
precisa enxergar (volume montado), e no libSQL é uma **URL remota com token**,
que é mais parecido com o que já existe. Provavelmente duas entradas distintas
no formulário, não uma.

**Fase 4 — MongoDB.** É aqui que a UI deixa de ser reaproveitada, e a fase
existe para dizer o que ela vira:

- **Árvore**: conexão → database → coleção. Sem schema, sem FK — logo, **sem
  diagrama ERD**.
- **Vista**: a grade de linhas não serve para documento aninhado. O que serve é
  uma **árvore de documentos** expansível, com a projeção das chaves de primeiro
  nível numa tabela para o caso comum (documentos homogêneos). O DBee já tem o
  virtualizador; o que muda é a célula.
- **Consulta**: não há SQL. O editor vira um campo de **filtro/pipeline** em
  JSON, e o autocomplete perde a base (não há catálogo de colunas — dá para
  inferir por amostragem, e amostragem que erra é pior que autocomplete
  nenhum).
- **Escrita**: exige a segunda credencial descrita na seção 1.
- **Export**: JSON e NDJSON saem naturalmente; CSV exige achatar documento
  aninhado, e achatar é decisão que o usuário tem de ver antes.

**Fase 5 — Redis.** A mais distante do que o DBee é hoje:

- **Árvore**: conexão → banco numerado (0–15). Não há coleção nem tabela.
- **Vista**: par chave/valor, com a forma dependendo do tipo (`string`, `hash`,
  `list`, `set`, `zset`, `stream`). São seis vistas, não uma.
- **Navegação**: `SCAN` com cursor, não `LIMIT`/`OFFSET` — e `KEYS *` num Redis
  de produção trava o servidor, então a UI precisa impedir isso, não oferecer.
- **Consulta**: não há linguagem de consulta. O que existe é um console de
  comandos, e um console de comandos com escrita ligada é um `redis-cli` com
  interface — outro produto, com outro risco.
- **Escrita**: mesma segunda credencial do Mongo.

## A pergunta que decide as fases 4 e 5

Elas estão descritas o suficiente para serem executadas, e **não estão
agendadas**. A razão não é técnica: é que o custo delas só se justifica se o
time for **navegar** Mongo e Redis no dia a dia, e não apenas tê-los rodando.

Antes de começar a fase 4 vale responder, com dado e não com impressão:

- quantas vezes por semana alguém abre um Mongo/Redis hoje, e para quê?
- é para **ler** (investigar um documento, conferir uma chave) ou para
  **operar** (apagar chave, corrigir documento)?
- se for ler, um console somente-leitura resolve — e é uma fração do custo da
  vista completa.

Se a resposta for "raramente, e só para ler", o seletor com seis cartões iguais
é a solução errada para o problema certo.

## O que não fazer

- **Não** colocar os seis ícones na tela antes da fase 1. Um seletor que oferece
  seis e entrega um é pior que um seletor que não existe. E quando eles
  entrarem, os cartões **não** devem ser iguais: o de Redis não faz o que o de
  PostgreSQL faz, e seis quadrados do mesmo tamanho afirmam que fazem.
- **Não** traduzir SQL entre dialetos. O editor manda o texto que a pessoa
  escreveu, para a engine que ela escolheu — reescrever a query dela é o tipo de
  esperteza que o `CLAUDE.md` recusa.
- **Não** generalizar a introspecção num "schema universal" antes de ter a
  segunda engine funcionando. A forma certa da abstração aparece com o segundo
  caso, não com o primeiro imaginado.
- **Não** ligar escrita numa engine cuja garantia de somente-leitura ainda não
  foi **medida** contra servidor real. Foi medindo que apareceu o buraco do DDL
  no MySQL, e foi medindo que apareceu o Mongo sem auth aceitando tudo de um
  usuário "somente leitura"; ler a documentação não teria mostrado nenhum dos
  dois.
- **Não** implementar Mongo ou Redis com o interruptor "permitir escrita nesta
  execução" que existe hoje. Nos dois a garantia é da credencial, não da
  operação: o interruptor daria a impressão de proteger sem proteger nada.
