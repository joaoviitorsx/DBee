# Expandir o DBee para outros bancos

Plano para o DBee deixar de ser só-Postgres. Escrito depois de medir o que
realmente difere, não do que parece diferir.

## Resumo

| engine | fase | vista | onde mora a garantia de somente-leitura | estado |
|---|---|---|---|---|
| PostgreSQL | — | grade | **transação** (`BEGIN READ ONLY`) | **pronto** |
| MySQL | 2 | grade | **credencial** (`GRANT SELECT`) | **leitura + escrita** |
| MariaDB | 2 | grade | **credencial** | **leitura + escrita** |
| libSQL | 3 | grade | **credencial** (claim `"a":"ro"` do JWT) | **leitura + escrita** |
| SQLite | — | grade | abertura do handle (`readonly: true`) | **pronto em leitura (worker)** |
| MongoDB | 4 | grade de documentos | **credencial** (papel `read`/`readWrite`) | **leitura + escrita** |
| Redis | 5 | grade de chaves (6 tipos de valor) | **credencial** (ACL `+@read`) | **leitura + escrita** |

> **Correção de uma versão anterior deste documento.** A tabela dizia que todas
> as garantias tinham sido medidas. Não tinham: MariaDB e libSQL eram
> extrapolação a partir de MySQL e SQLite, e as duas extrapolações estavam
> erradas. A tabela acima é a corrigida; o que mudou está na seção 1.

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

### 1. Só o Postgres protege por transação

A regra 8 do `CLAUDE.md` diz que a proteção contra escrita é o **modo da
transação**, declarado no `BEGIN`. Medido contra servidor real de cada engine,
essa garantia **não existe em nenhuma outra**:

| engine | mecanismo tentado | o que escapa | onde a garantia realmente mora |
|---|---|---|---|
| PostgreSQL 16 | `BEGIN READ ONLY` | nada que eu tenha encontrado | **transação** |
| MySQL 8.4 | `START TRANSACTION READ ONLY` | `CREATE TABLE`, `DROP`, **`TRUNCATE`**, **`CREATE USER`** | credencial |
| MariaDB 11 | idem | idem | credencial |
| SQLite | `PRAGMA query_only = ON` | o próprio usuário desliga com `PRAGMA query_only = OFF` | abertura do handle (`readonly: true`) |
| libSQL | `PRAGMA query_only` | **não existe** (`SQL_PARSE_ERROR`) | claim `"a":"ro"` do JWT |
| MongoDB 7 | — | — | papel `read` |
| Redis 7 | — | — | ACL `+@read` |

**O MySQL é pior do que "não cobre DDL".** Medido: dentro de `START TRANSACTION
READ ONLY`, o `INSERT` morre com 1792, mas o `TRUNCATE TABLE` **esvaziou a
tabela** e o `CREATE USER` **criou um usuário do banco**. Não é só esquema que
escapa — é perda de dado e é DCL.

`SET SESSION transaction_read_only = ON` barra mais coisas, e mesmo assim não
serve: não barra `SELECT … INTO OUTFILE`, e o usuário desliga com
`SET SESSION transaction_read_only = OFF` no próprio SQL. É a mesma classe do
`SET LOCAL default_transaction_read_only` que a regra 8 já chama de regressão
de segurança.

**SQLite e libSQL também não seguram.** No SQLite o `PRAGMA query_only = OFF`
está ao alcance do usuário, na mesma conexão; o que segura é abrir o arquivo
com `readonly: true`. No libSQL o `PRAGMA` nem existe.

**A consequência que reordena as fases.** MySQL e MariaDB **não** estão no grupo
do Postgres — estão no grupo do Mongo e do Redis. Isso apaga a premissa de que
a primeira engine nova é barata "porque reusa a UI que existe": ela reusa a
grade, mas **não** reusa o interruptor "permitir escrita nesta execução", que é
justamente a peça de UI incompatível com garantia por credencial.

Com credencial, ou a conexão guarda **duas** (uma de leitura e uma de escrita),
ou o DBee promete não mandar comando de escrita — e promessa por lista de
comandos é o que a regra 8 recusa, porque sempre tem um caso que escapa. Neste
documento, `TRUNCATE` foi esse caso.

**Cuidado ao medir Mongo.** Um container `mongo:7` sem `MONGO_INITDB_ROOT_*`
sobe **sem controle de acesso**, e aí papel nenhum é aplicado: numa primeira
medição o usuário "somente leitura" apagou a coleção inteira. O número só vale
com `--auth` ligado. Vale como aviso operacional: um Mongo sem auth não tem
somente-leitura nenhum, faça o DBee o que fizer.

**MariaDB não é "MySQL com outra string de versão".** Medido: `@@max_execution_time`
não existe nela (erro 1193); o equivalente é `@@max_statement_time`, em
**segundos como float** contra **milissegundos inteiros** do MySQL. Isso cai
direto num campo do formulário de conexão.

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
| tipos no fio | tudo texto (regra 10) | driver converte — trava medida, ver §3b | idem |
| somente leitura | `BEGIN READ ONLY` | `START TRANSACTION READ ONLY` (não cobre DDL) | `PRAGMA query_only` (cobre DDL — medido) |
| cancelar query | `pg_cancel_backend` | `KILL QUERY` | não há |


### 3b. O driver de MySQL: medido, e o primeiro candidato reprovou

A regra 3 do `CLAUDE.md` manda preferir primitiva do Bun a dependência externa,
e o **Bun 1.3.14 fala MySQL nativamente**. Ele foi medido primeiro, e reprovou
na regra 10.

`Bun.SQL` converte tipos sem opção documentada de desligar — inteiro vira
`number`, `DATE` vira `Date`, `BLOB` vira `Uint8Array`, `JSON` vira objeto: 12
de 24 colunas. Pior, **a conversão de `DATE` depende de qual API se chama**.
Mesma linha, mesmo servidor, coluna guardada como `2026-03-01`:

| caminho | valor | em `America/Bahia` |
|---|---|---|
| template tag | `2026-03-01T03:00:00Z` | 1 de março |
| `sql.unsafe()` | `2026-03-01T00:00:00Z` | **28 de fevereiro** |

E `unsafe()` é o caminho do editor de SQL, onde a consulta é texto do usuário.
Um cliente de banco que mostra o dia errado não serve, então a regra 3 cede:
entra o `mysql2`, JS puro, sem módulo nativo — a regra 4 (`bun build
--compile`) segue de pé.

**A trava equivalente ao `TUDO_TEXTO`**: o `typeCast` devolve os bytes crus e a
decisão entre texto e hexadecimal sai dos **metadados de coluna**, porque o
objeto do `typeCast` não expõe charset — ali `TEXT` e `BLOB` são os dois
`BLOB`, e `CHAR`, `BINARY`, `ENUM` e `SET` são os quatro `STRING`.

A regra é `charset === 63` **e** o tipo estar na lista dos que carregam bytes.
As duas condições vieram de erro medido:

- só `BINARY_FLAG` não serve: **o MariaDB liga o flag no JSON**, que é texto;
- só `charset === 63` não serve: número e data também dizem 63, e o inteiro `1`
  saía `"0x31"`.

Isso **obriga `query()` e proíbe `execute()`**: só no protocolo de texto os
números e as datas chegam em ASCII.

**Quarta divergência MariaDB/MySQL:** o MySQL descreve JSON como `columnType`
245; o MariaDB, como `BLOB` (252) com `extendedFormat: "json"`.

### 3d. libSQL: o protocolo entrega a regra 10, e o cliente oficial atrapalha

Medido contra `ghcr.io/tursodatabase/libsql-server` real.

**O `sqld` fala JSON por `POST /v2/pipeline`, e cada célula vem com o tipo
explícito e o valor já como string:**

```json
{"type":"integer","value":"9223372036854775807"}
```

Inteiro de 64 bits chega inteiro, sem passar por `number`. O que no Postgres
exigiu `TUDO_TEXTO` e no MySQL exigiu `typeCast` com bytes crus, aqui o servidor
já entrega pronto.

Três exceções, e a terceira é perda de dado:

| tipo | como chega | tratamento |
|---|---|---|
| `integer`, `text` | string | direto |
| `float` | **número JSON** | precisão sobrevive (IEEE 754 dos dois lados); a formatação é nossa |
| `blob` | **`base64`**, em campo próprio | vira hexadecimal `0x…`, como o `bytea` e o `BLOB` |
| infinito | **`{"type":"float","value":null}`** | ver abaixo |

**O infinito não sobrevive ao JSON.** O SQLite guarda infinito numa coluna
`REAL` sem reclamar (`typeof` devolve `real`, `CAST(v AS TEXT)` devolve `Inf`),
e o protocolo o entrega como `value: null`. O **tipo** ainda distingue de um
`NULL` de verdade, que chega com `type: "null"` — e é isso que permite não
mentir. O **sinal** não sobrevive: `+Inf` e `-Inf` chegam idênticos.

**O cliente oficial reprovou em duas frentes**, e por isso o DBee fala o
protocolo com `fetch`:

1. **Traz módulo nativo** (`@libsql/linux-x64-gnu/index.node`, 23 MB). A regra 4
   proíbe módulo nativo no backend porque quebra o `bun build --compile`.
2. **Quebra na tabela com infinito**: `HRANA_PROTO_ERROR: Expected number,
   received null`, e a consulta inteira falha. Com `fetch`, a mesma tabela é
   lida.

Sem cliente também não há pool, configuração de sessão nem contrato de descarte:
cada requisição é independente, e o `fetch` do Bun reusa a conexão TCP por
baixo. Menos peças porque a engine tem menos estado.

### 3e. A garantia do libSQL é a mais forte depois do Postgres

O claim `"a":"ro"` do JWT é aplicado **pelo servidor**, e cobre até DDL. Medido
com `SQLD_AUTH_JWT_KEY` e um par Ed25519:

| statement | com token `ro` |
|---|---|
| `SELECT` | passa |
| `INSERT` / `UPDATE` / `DELETE` | **bloqueado** — `Current session doesn't have Write permission` |
| `DROP TABLE` / `CREATE TABLE` | **bloqueado** |
| `PRAGMA query_only = OFF` | **bloqueado** — `unsupported statement` |
| `ATTACH DATABASE` | **bloqueado** — `unsupported statement` |

Dados intactos depois da bateria. É melhor que o MySQL em dois aspectos: não
depende de montar `GRANT` certo, e cobre DDL. E melhor que o SQLite local, onde
o `PRAGMA query_only` está ao alcance do usuário.

**Os três modos de SSL significam o que prometem** (ADR 003), e isto NÃO foi de
graça como a primeira versão da fase 3 assumiu. O `fetch` do Bun aceita `tls`
por requisição — extensão dele, não do fetch padrão —, então: `disable` é
`http`; `require` é `https` com `rejectUnauthorized: false` (cifra, cai num
self-signed sem reclamar — medido contra `badssl.com`); `verify-full` é `https`
validando cadeia e identidade, com a CA própria pelo `ca`. A versão anterior
tratava `require` e `verify-full` como a mesma coisa (https sempre validado),
fazendo `require` prometer menos do que entregava. `driver/libsql.test.ts`
trava a tradução dos três modos.

**O que falta ali:** limite de tempo por statement e cancelamento não existem no
protocolo. Vira `cancelarQuery: false` na capacidade, e a tela deixa de oferecer
o botão em vez de oferecer um que não faz nada.

### 3f. A forma do keyset: três engines, três respostas

| engine | comparação de linha | disjunção `OR` | NULL em `ASC` | `NULLS LAST` |
|---|---|---|---|---|
| PostgreSQL 16 | `Index Cond`, **0,25 ms** | `Filter`, 76,4 ms | por último | existe |
| MySQL 8.4 / MariaDB 11 | `type=index`, 24 ms | `type=range`, **1 ms** | **primeiro** | **não existe** |
| libSQL | covering index, ~0,4 ms | covering index, ~0,4 ms | **primeiro** | existe |

O libSQL é o único indiferente à forma — as duas dão o mesmo plano e o mesmo
tempo. Ele aceita `NULLS LAST`, mas usá-lo para imitar a ordem do Postgres
custaria o índice, então a ordem nativa é respeitada, como no MySQL.

### 3c. `verify-full` no MySQL: possível por nome, impossível por IP

O ADR 003 diz que só existem três modos de SSL e que **cada um precisa
significar o que promete**. Medido contra MySQL 8.4 com TLS, CA própria e três
certificados (SAN de IP correto, SAN de nome errado, e outra CA):

| como o `mysql2` é configurado | cadeia | identidade |
|---|---|---|
| `rejectUnauthorized: true` | **verificada** (recusa outra CA) | **não verificada** — aceita qualquer certificado da CA, para qualquer host |
| `+ verifyIdentity: true`, host é **nome** | verificada | **verificada** — aceita SAN certo, recusa SAN errado |
| `+ verifyIdentity: true`, host é **IP** | verificada | **quebrada** — recusa até o certificado legítimo |
| `checkServerIdentity` próprio | verificada | **ignorado** — o `mysql2` sobrescreve |

A causa está em `lib/base/connection.js`:

```js
const servername = Net.isIP(this.config.host) ? undefined : this.config.host;
```

Com IP o `servername` some, o `Tls.checkServerIdentity` do Node cai no padrão
`'localhost'`, e a reconferência logo abaixo é guardada por
`typeof servername === 'string'` — então nem roda. Reproduzido igual sob Bun
1.3.14 e Node 22: é comportamento do `mysql2`, não do runtime.

**Por que isso importa exatamente aqui.** A produção do DBee é alcançada pelo IP
da tailnet. Para uma conexão MySQL por IP, `verify-full` não tem como ser
honrado — e oferecer o modo assim mesmo seria a tela prometendo uma garantia que
não existe, que é o erro que o ADR 003 nomeia.

**Decisão:** `verify-full` continua oferecido para MySQL/MariaDB, e a validação
recusa a combinação **`verify-full` + host que é IP**, com mensagem dizendo por
quê. Recusar o modo inteiro puniria quem usa nome de host, onde ele funciona de
verdade; recusar a combinação exata é o que diz a verdade nos dois casos.

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

A ordem mudou depois da medição da seção 1. Ela **não** sai mais de "quem reusa
a UI", porque MySQL reusa a grade e não reusa o interruptor de escrita.

**Fase 0a — fechar a fronteira no servidor, ainda só com Postgres.** Extrair a
interface `Driver` e fazer os 11 arquivos dependerem dela, não de `pg/`. Nenhuma
funcionalidade nova; pronto quando a suíte inteira passa **sem alteração de
teste**.

**Fase 0b — o formulário aprende que engine existe, sem mudança visível.**
Migração aditiva com a coluna `engine`, o tipo em `packages/shared`, e a tabela
de capacidades com só o Postgres preenchido. O formulário passa a derivar
visibilidade de campo e o texto do interruptor dessas capacidades, em vez de tê-los
fixos — e com `postgres` o resultado é idêntico ao de hoje. O seletor de engine
**não renderiza** enquanto houver uma engine só.

Pronto quando a suíte passa sem alteração de teste **e** os screenshots dos
quatro breakpoints batem com os de hoje. É a única fatia verificável assim, e é
o que a torna barata. Ver `docs/conexao-multi-engine.md`.

**Fase 1 — papéis restritos documentados.** `docs/papeis-mysql.md` antes de
qualquer código de MySQL. Como a garantia é a credencial, a documentação do
`GRANT SELECT` **é** a funcionalidade de segurança, não um anexo dela.

**Fase 2 — MySQL e MariaDB, somente leitura.** Driver, árvore de três níveis,
citação com crase, catálogo por `information_schema`. Sem interruptor de
escrita: no lugar dele, a afirmação de que a conexão grava se a credencial
gravar. MariaDB entra junto, mas **não de graça** — `max_statement_time` em
segundos contra `max_execution_time` em milissegundos é diferença de campo de
formulário, não de string de versão.

**Fase 3 — libSQL. Fechada em leitura.** Antes do SQLite, invertendo a ordem
anterior: é URL + token, tem somente-leitura de verdade no servidor (claim
`"a":"ro"`, medido) e não bloqueia o processo.

O que ela entregou, e as decisões que ninguém adivinharia:

- **Nenhuma migration.** A migração 007 já havia registrado que tornar
  `host`/`database`/`username` anuláveis exige reconstruir a tabela com três
  chaves estrangeiras apontando para ela, e que esse dia merece ADR próprio.
  Ele não chegou: os campos existentes dizem a mesma coisa —
  `host` + `port` são o endereço do `sqld`, `sslMode` escolhe `http` ou `https`
  e **`password` guarda o token**, cifrado como qualquer credencial (ADR 005).
  O que mudou no schema de entrada foi `database` e `username` virarem
  opcionais, com a obrigatoriedade passando a ser **por engine**
  (`exigirCamposDaEngine`, lendo a mesma tabela de capacidades que decide o que
  o formulário mostra).

- **A permissão de escrita é lida do token, não sondada.** Descobrir por
  sondagem exigiria tentar escrever no banco de alguém. O claim está no próprio
  JWT: `claimsDe` o decodifica (sem conferir assinatura — não temos a chave, e
  não é nossa função) e qualquer coisa que não seja `"a":"ro"` vira aviso. Na
  dúvida, avisa: um aviso a mais custa uma linha na tela, um a menos custa a
  confiança num modo leitura que não existe.

- **Sem streaming, e o documento diz isso em vez de escondê-lo.** O protocolo é
  requisição-resposta: o `/v2/pipeline` devolve o resultado inteiro num JSON e
  não há ponto em que parar de ler. O corte de `maxRows` acontece **depois** de
  a resposta chegar. Injetar `LIMIT` no SQL do usuário está fora de questão
  (regra 8, e mudaria o resultado de uma consulta que já tem `LIMIT`). O que
  contém um `SELECT` sem `WHERE` numa tabela grande é o limite de tempo da
  requisição HTTP.

- **Um `POST` por statement.** O `/v2/pipeline` aceita vários de uma vez, e
  mesmo assim eles vão um a um: mandados juntos, o erro do terceiro chega depois
  de o primeiro e o segundo já terem executado, e o contrato do DBee é relatar
  **quais rodaram**.

- **O separador de statements ganhou um terceiro dialeto.** SQLite fica *entre*
  os outros dois: aspas do Postgres (a barra invertida **não** escapa),
  identificadores do MySQL e mais um (`` ` `` e `[nome]`), comentário de bloco
  que não aninha. Rodar a gramática do Postgres sobre SQL de SQLite põe o `;`
  do lado errado da fronteira.

- **`cancelarQuery: false`**, e o teste de contrato afirma **os dois lados**:
  onde a capacidade diz `true` o driver tem que entregar o token de
  cancelamento; onde diz `false`, tem que **não** entregar. Um token ali seria a
  promessa de um cancelamento que não acontece.

**SQLite local — adiado, e o motivo mudou.** Não é mais "custa médio". Medido
com `bun:sqlite`: uma consulta de 47 segundos produziu **zero** tiques num
temporizador de 10 ms — o driver é síncrono e, enquanto ela roda, o processo
inteiro não responde a mais ninguém. Não há timeout de statement nem
cancelamento. Num app self-hosted multiusuário isso é negação de serviço
acionável por um `SELECT` malfeito. Entra quando houver resposta para isso —
provavelmente rodar o SQLite fora do processo principal.

### A escrita nas engines de credencial: a segunda credencial

As engines de credencial não têm transação somente-leitura que resista (medido,
§1). Até aqui isso significava "só leitura". A escrita entrou por uma **segunda
credencial, gravável, opcional** — não por afrouxar a garantia.

A promessa central do DBee é a do Postgres via `BEGIN READ ONLY`: nada muda por
acidente. A segunda credencial a mantém nas engines de credencial:

- **A leitura usa a credencial de sempre.** Uma conexão sem credencial de
  escrita é somente-leitura, como antes.
- **A escrita usa a segunda credencial, e só quando pedida** (`readOnly:
  false`) e concedida. No MySQL/MariaDB é um usuário `GRANT INSERT,UPDATE,…`;
  no libSQL, um token sem o claim `"a":"ro"`.
- **Duas trancas**: a credencial de escrita tem que existir na conexão **e** o
  ator tem que ter concessão. Faltando qualquer uma, o pedido de escrita é
  **recusado com mensagem clara**, não rebaixado a leitura.

Decisões que a implementação fixou:

- **Migração 008**, aditiva: `write_username` + `write_password_enc`, nulas.
  A credencial de escrita cifra com AAD **distinto** (`v2:<id>#write`), senão
  quem tem escrita no volume trocaria a senha de leitura pela coluna de escrita
  dentro da mesma linha (ADR 005, um nível mais fino).
- **O pool do MySQL chaveia por `username`**: leitura e escrita nascem em grupos
  distintos, e uma tarefa de leitura nunca recebe a conexão gravável.
- **`writeEnabled` efetivo unificado**: "pode gravar aqui?" virou um campo só —
  `write_enabled` no Postgres, `hasWriteCredential` nas de credencial, dobrado
  pela concessão. O selo de escrita e o interruptor da consulta valem para as
  quatro engines sem mudança de código neles.

**Fase 4 — MongoDB. Fechada em leitura + escrita.** O que foi entregue:

- **Árvore**: conexão → database → coleção. Sem schema e sem FK — logo, **sem
  diagrama ERD**.
- **Vista**: a grade de linhas não serve para documento aninhado. Serve uma
  **árvore de documentos** expansível, com projeção das chaves de primeiro nível
  numa tabela para o caso comum. O virtualizador já existe; o que muda é a
  célula.
- **Consulta**: não há SQL. O editor vira campo de filtro/pipeline em JSON, e o
  autocomplete perde a base — não há catálogo de colunas, e inferir por
  amostragem erra em coleção heterogênea.
- **Conexão**: `authSource` é campo **próprio e obrigatório**. Medido: usuário
  criado em `zzapp` com papel `read` falha autenticando contra `admin` e
  funciona contra `zzapp`. Reaproveitar o campo `database` produz uma falha de
  autenticação indiagnosticável.
- **Export**: JSON e NDJSON saem naturais; CSV exige achatar documento
  aninhado, e achatar é decisão que o usuário tem de ver antes.

**Fase 5 — Redis. Fechada em leitura + escrita.** O que foi entregue:

- **Árvore**: conexão → banco numerado. E o número **não** é 0–15 fixo: é
  `CONFIG GET databases`, config do servidor. Pior, medido: uma credencial
  `+@read` recebe `NOPERM` ao ler essa config — o formulário não tem como
  descobrir o teto legitimamente.
- **Vista**: par chave/valor, com forma por tipo — `string`, `hash`, `list`,
  `set`, `zset`, `stream`. São seis vistas, não uma.
- **Navegação**: `SCAN` com cursor. `KEYS *` trava um Redis de produção, então a
  UI precisa **impedir**, não oferecer.
- **Testar conexão**: medido, `+@read` **não inclui** `PING` nem `SELECT`. A
  sonda de teste não pode ser `PING`, senão falha justamente na credencial mais
  restrita — que é a correta. A sonda é específica por engine e por credencial.
- **Consulta**: não há linguagem de consulta; o que existe é console de
  comandos, e console com escrita ligada é um `redis-cli` com interface.

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
