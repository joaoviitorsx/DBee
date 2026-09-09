# Expandir o DBee para outros bancos

Plano para o DBee deixar de ser só-Postgres. Escrito depois de medir o que
realmente difere, não do que parece diferir.

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
contra servidores reais:

| dentro da transação somente-leitura | PostgreSQL 16 | MySQL 8.4 |
|---|---|---|
| `INSERT` | bloqueia | bloqueia (erro 1792) |
| `CREATE TABLE` | **bloqueia** | **passa — a tabela é criada** |

`START TRANSACTION READ ONLY` do MySQL cobre DML e **não** cobre DDL: comando
de esquema faz commit implícito e escapa da transação. No Postgres o mesmo
`CREATE TABLE` morre com *cannot execute CREATE TABLE in a read-only
transaction*.

Ou seja: a promessa central do produto — "nada é escrito por acidente" — vale
no Postgres e **não vale igual** no MySQL. Antes de qualquer ícone novo na
tela, cada engine precisa responder o que "somente leitura" significa nela, e a
resposta precisa ser verificada contra servidor real, não lida na
documentação.

Onde o modo de transação não basta, sobra uma alternativa só, e ela é do lado
do banco: **papel restrito** (`GRANT SELECT`, ACL do Redis, usuário read-only do
Mongo). O `docs/papeis-postgres.md` já faz isso para Postgres; cada engine nova
precisa do seu equivalente, e o DBee precisa **detectar e avisar** quando o
papel é privilegiado — como já faz hoje para o superusuário e o
`COPY … TO PROGRAM`.

### 2. Dois grupos, não seis engines

| | modelo | grade e SQL | esforço |
|---|---|---|---|
| **MySQL / MariaDB** | relacional, SQL | servem como estão | médio |
| **SQLite / libSQL** | relacional, SQL | servem como estão | baixo–médio |
| **MongoDB** | documentos | grade não serve; não há SQL | alto, e é outra UI |
| **Redis** | chave-valor | grade não serve; não há schema | alto, e é outro produto |

A grade virtualizada, o editor SQL, o keyset por PK, o diagrama ERD e o
`INSERT`/`UPDATE` com preview são todos construídos sobre "linhas com colunas e
chave primária". No Mongo isso vira documento aninhado sem esquema fixo; no
Redis não existe nem tabela.

Fazer os quatro primeiros é evolução. Fazer os dois últimos é construir um
segundo produto dentro do mesmo container.

### 3. O que muda dentro do grupo relacional

| tema | Postgres | MySQL/MariaDB | SQLite/libSQL |
|---|---|---|---|
| catálogo | `pg_catalog`/`pg_class` | `information_schema` | `pragma_table_info`, `sqlite_master` |
| hierarquia | conexão → database → **schema** → tabela | conexão → database → tabela (sem schema) | arquivo → tabela (sem database, sem schema) |
| citar identificador | `"aspas duplas"` | `` `crase` `` | `"aspas duplas"` |
| streaming | `DECLARE CURSOR` + `FETCH` | cursor do protocolo / `LIMIT` | `LIMIT` |
| tipos no fio | tudo texto (regra 10) | driver converte — precisa da mesma trava | idem |
| somente leitura | `BEGIN READ ONLY` | `START TRANSACTION READ ONLY` (não cobre DDL) | `PRAGMA query_only` (a confirmar) |
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
  readonly engine: "postgres" | "mysql" | "mariadb" | "sqlite";
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
  readonly niveis: "conexao/database/schema/tabela" | "conexao/database/tabela" | "arquivo/tabela";
  /** A transação somente-leitura cobre DDL? No MySQL, NÃO — medido. */
  readonly readOnlyCobreDdl: boolean;
  readonly cancelarQuery: boolean;
  readonly diagramaErd: boolean;
  readonly exportSql: boolean;
}
```

`capabilities` não é enfeite: é o que impede a UI de oferecer um botão que a
engine não honra. E `readOnlyCobreDdl: false` tem consequência visível — no
MySQL o app precisa dizer que a proteção é parcial, em vez de deixar a pessoa
supor a garantia do Postgres.

## Fases

**Fase 0 — fechar a fronteira, ainda só com Postgres.** Extrair a interface
`Driver` e fazer os 11 arquivos passarem a depender dela, não de `pg/`. Nenhuma
funcionalidade nova; o critério de pronto é a suíte inteira passando sem
alteração de teste. É a fase que torna as outras baratas, e a única que dá para
fazer sem risco de regressão porque não há comportamento novo.

**Fase 1 — MySQL/MariaDB, somente leitura.** Driver novo, árvore de três níveis,
citação com crase, catálogo por `information_schema`. **Escrita desligada por
enquanto**, justamente porque a garantia de read-only não cobre DDL: liberar
escrita antes de resolver isso seria vender uma proteção que não existe.
Critério de pronto: os mesmos testes de integração do Postgres, rodando contra
um container MySQL de verdade.

**Fase 2 — resolver a escrita no MySQL.** Papel restrito documentado
(`docs/papeis-mysql.md`), detecção de papel privilegiado no teste de conexão, e
o aviso na UI quando a proteção for parcial. Só então ligar edição de linha.

**Fase 3 — SQLite/libSQL.** Mais barato que o MySQL em quase tudo (dois níveis,
sem rede no caso de arquivo local), mas exige responder o que "conexão"
significa quando o banco é um arquivo — e, no libSQL, quando é uma URL remota
com token.

**Fase 4 — decidir sobre Mongo e Redis, com dado na mão.** Depois das fases
1–3 haverá evidência real de quanto custa uma engine. A pergunta a responder
não é técnica, é de produto: o time precisa **navegar** Mongo/Redis, ou
precisa só que eles existam? Se for a segunda, o seletor bonito não é a
resposta.

## O que não fazer

- **Não** colocar os seis ícones na tela antes da fase 1. Um seletor que oferece
  seis e entrega um é pior que um seletor que não existe.
- **Não** traduzir SQL entre dialetos. O editor manda o texto que a pessoa
  escreveu, para a engine que ela escolheu — reescrever a query dela é o tipo de
  esperteza que o `CLAUDE.md` recusa.
- **Não** generalizar a introspecção num "schema universal" antes de ter a
  segunda engine funcionando. A forma certa da abstração aparece com o segundo
  caso, não com o primeiro imaginado.
- **Não** ligar escrita numa engine cuja garantia de somente-leitura ainda não
  foi **medida** contra servidor real. Foi medindo que apareceu o buraco do DDL
  no MySQL; ler a documentação não teria mostrado.
