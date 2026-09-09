# O formulário de conexão por engine

Desenho da próxima feature: escolher a engine primeiro, e o formulário se moldar
ao que aquela engine exige. Complementa `docs/multi-engine.md`, que trata do
servidor; aqui é o modelo de dados e a tela.

## O portão não é o formulário — é o schema compartilhado

Antes de discutir tela, o fato que decide onde está o trabalho. Rodando
`Value.Check(CreateConnection, …)` com payloads das sete engines, o schema de
hoje **recusa quatro delas**, sem nenhuma linha de UI existir:

```
ACEITA  postgres
RECUSA  sqlite (caminho absoluto)  ->  /host  não casa '^[^/\s][^\s]*$'
                                      /username comprimento mínimo 1
RECUSA  sqlite (caminho relativo)  ->  /username comprimento mínimo 1
RECUSA  libsql (url + token)       ->  /username comprimento mínimo 1
RECUSA  sem database               ->  /database propriedade obrigatória
RECUSA  token de 2000 caracteres   ->  /password máximo 1000
```

O `pattern` do host existe para o `pg` não interpretar `/` como socket unix — e
é justamente ele que rejeita o caminho do SQLite. Isso é o desenho **acertando**:
o campo diz "sou um host, não um caminho". A conclusão não é afrouxar o pattern;
é que **caminho de arquivo é outro campo**.

O trabalho desta feature está em `packages/shared`, não no `.tsx`.

## Campo × engine

**obrig** = obrigatório · **opc** = opcional · **—** = não existe, some da tela ·
*itálico* = existe com outro significado.

| campo | PostgreSQL | MySQL | MariaDB | SQLite | libSQL | MongoDB | Redis |
|---|---|---|---|---|---|---|---|
| nome, cor | obrig / opc | idem | idem | idem | idem | idem | idem |
| host | obrig | obrig | obrig | **—** | **—** | obrig | obrig |
| porta | 5432 | 3306 | 3306 | **—** | **—** | 27017 | 6379 |
| caminho do arquivo | — | — | — | **obrig** | — | — | — |
| url | — | — | — | — | **obrig** | opc (`mongodb+srv://`) | — |
| database | **obrig** | opc | opc | **—** (o arquivo é o database) | — (vai na url) | opc | *índice numérico* |
| usuário | obrig | obrig | obrig | **—** | **—** | opc | **opc** |
| senha | obrig | obrig | obrig | **—** | *token JWT* | obrig com auth | obrig |
| authSource | — | — | — | — | — | **obrig, e ≠ database** | — |
| replicaSet | — | — | — | — | — | opc | — |
| sslMode | 3 valores (ADR 003) | 5 valores | 5 valores | **—** | *é a própria url* | `tls` + CA | `tls` |
| timezone | sim | sim | sim | **—** | **—** | **—** (BSON é UTC) | **—** |
| timeout de statement | sim | **parcial** | **outro nome e unidade** | **não existe** | — | `maxTimeMS` | — |
| interruptor de escrita | **sim** | **não pode existir** | **não pode existir** | só reabrindo o arquivo | **não pode existir** | **não pode existir** | **não pode existir** |

Detalhes que vieram de medição, não de documentação:

- **`authSource` do Mongo não deriva do `database`.** Usuário criado em `zzapp`
  com papel `read`: autenticar contra `admin` falha, contra `zzapp` funciona.
  Reaproveitar o campo produz falha de autenticação indiagnosticável.
- **O `database` do Redis não é 0–15 fixo.** É `CONFIG GET databases`, config do
  servidor — e uma credencial `+@read` recebe `NOPERM` ao lê-la. Um `select` de
  16 opções afirma um fato que o servidor pode desmentir.
- **`+@read` do Redis não inclui `PING` nem `SELECT`.** O botão "testar conexão"
  não pode usar `PING`: falharia justamente na credencial mais restrita, que é a
  correta. A sonda de teste é específica por engine **e** por credencial.
- **`timeout de statement` não significa o mesmo em lugar nenhum.** No MySQL,
  `max_execution_time = 500` não interrompeu `SELECT SLEEP(3)` nem um `UPDATE`
  preso — protege leitura pesada, não escrita presa. No MariaDB a variável nem
  existe (é `max_statement_time`, em segundos float). No SQLite não há mecanismo.

## Modelo de dados: colunas anuláveis + coluna `engine`

Recusadas: blob JSON de opções e tabela por engine.

**Por que não o blob.** O `PUBLIC_COLUMNS` do repositório é uma lista de negação
por omissão — `password_enc` não está lá, e é isso que garante que rota nenhuma
devolva a senha. Um `options_json` que às vezes carrega o token do libSQL e às
vezes carrega só `authSource` **não pode entrar nem ficar de fora**: entra e
vaza o token, fica de fora e a edição não consegue montar o formulário. Partir o
blob em metade pública e metade secreta é reinventar colunas com pior tipagem.

O blob também reintroduz o ADR 004 num nível que o guarda não enxerga: o teste
que trava "nada de `default` em schema de entrada" só olha `properties` de
primeiro nível. "Chave ausente dentro do blob" vira um terceiro estado invisível
— exatamente a distinção que o ADR 004 existe para preservar.

**Por que não tabela por engine.** `connection_access`, `query_log` e
`saved_queries` têm FK para `connections(id)`, e o id é o AAD da cifra (ADR 005).
A tabela pai continua existindo de qualquer forma: você não ganha 7 tabelas,
ganha 8 e um JOIN em toda leitura.

**Por que colunas anuláveis.** Em todas as sete engines há **exatamente um
segredo por conexão** — senha, ou token, ou nenhum. Todos cabem em
`password_enc`, com o mesmo AES-256-GCM e o mesmo AAD. Zero cripto nova, ADR 005
intacto. E `UpdateConnection` continua sendo `t.Partial` sobre um objeto plano,
então o teste genérico do ADR 004 cobre os campos novos de graça.

Custo honesto: colunas anuláveis sem sentido para o Postgres. **Reabrir a decisão
se** passarem de ~6 colunas específicas, ou se aparecer uma engine com **dois**
segredos.

> **Quando vier o segundo segredo** (credencial de escrita separada, que a
> garantia por credencial vai exigir), as duas colunas precisam de **AAD
> diferente** — `"v2:" + id` e `"v2w:" + id`. Com o mesmo AAD os dois textos
> cifrados da mesma linha são intercambiáveis, e um
> `UPDATE … SET password_enc = password_write_enc` promove a credencial de
> leitura à de escrita em silêncio. Vira nota no ADR 005 na hora que acontecer.

## `engine` é imutável depois de criada

Entra em `CreateConnection`; **não** entra em `FIELDS`, logo não entra em
`UpdateConnection`. Dois motivos, e o primeiro é de segurança:

1. **Um PATCH que troca a engine mantendo `password_enc` é o ataque do ADR 005
   por rota autenticada.** A senha continua decifrando — o AAD é o id, e o id não
   mudou — mas passa a ser enviada para outro tipo de servidor. Senha de Postgres
   entregue a um endpoint libSQL de terceiro é exfiltração completa. O ADR 005
   recusou amarrar host no AAD porque **editar host é operação normal**; editar
   engine não é.
2. Tudo que pendura na conexão — `query_log`, `saved_queries`,
   `connection_access` — foi escrito sob a semântica de uma engine.

Isso responde "o que acontece ao trocar a engine com campos preenchidos": **na
edição não acontece, porque não é oferecido.** Trocar de engine é criar outra
conexão.

Na **criação**, onde a troca existe: preserva nome e cor, limpa o resto, repõe a
porta convencional da engine nova, e **nunca** carrega o segredo entre engines —
manter um token do Turso enquanto a pessoa passa para Postgres e digita um host
arbitrário é entregar o token a esse host. A limpeza é anunciada numa linha
abaixo do seletor: anunciar é a diferença entre um reset e um bug.

A porta convencional vem do rascunho do cliente, onde o `5432` já mora hoje —
**nunca** do schema TypeBox (ADR 004).

## O seletor: lista, não grade

A referência citada foi o seletor do Dokploy. Uma grade de cartões quadrados
iguais força paridade visual: seis quadrados do mesmo tamanho afirmam seis
capacidades do mesmo tamanho, e Redis não faz o que PostgreSQL faz.

Lista de uma coluna, uma linha por engine, com a capacidade dita em voz alta:

```
⬤  PostgreSQL   grade e SQL · escrita protegida pela transação
⬤  MySQL        grade e SQL · somente leitura — a proteção é a credencial
⬤  MariaDB      grade e SQL · somente leitura — a proteção é a credencial
```

A lista aceita hierarquia — linha esmaecida, selo, linha desabilitada com o
motivo — que a grade não aceita. E escala para baixo: com duas engines uma grade
parece quebrada, uma lista de duas linhas não.

**O seletor não renderiza enquanto houver uma engine só.** Um seletor com uma
opção é uma pergunta cuja resposta o sistema já sabe.

## O interruptor de escrita muda de forma, não só de estado

Hoje ele diz uma frase que só é verdadeira no Postgres: *"desligado, as queries
rodam em transação read-only e o Postgres recusa qualquer alteração"*. Medido,
essa frase é **falsa** no MySQL e no MariaDB.

| garantia | o que a tela mostra |
|---|---|
| transação (Postgres) | o interruptor de hoje, com a frase de hoje |
| credencial (MySQL, MariaDB, libSQL, Mongo, Redis) | **sem interruptor.** No lugar: *"esta conexão grava se a credencial gravar. O DBee não impede."* + link para `docs/papeis-<engine>.md` |
| handle (SQLite local) | interruptor, mas reabrindo o arquivo — não é por execução |

As capacidades governam **visibilidade**, não `disabled`. Campo desabilitado
ainda afirma "isto existe aqui, você só não pode mexer" — e para `timezone` no
SQLite isso é falso.

## Não piorar para quem só usa Postgres

Critério verificável, não intenção: com `engine === "postgres"`, o formulário
renderiza **os mesmos campos, na mesma ordem, com a mesma altura de painel** que
hoje. Travado por um teste que conta os campos renderizados e pelos screenshots
nos quatro breakpoints (`CLAUDE.md` §4b) comparados com os atuais.

## Migração

`007_connection_engine.sql`, `EXPECTED_SCHEMA` 6 → 7, **puramente aditiva**:

```sql
ALTER TABLE connections ADD COLUMN engine TEXT NOT NULL DEFAULT 'postgres'
  CHECK (engine IN ('postgres','mysql','mariadb','sqlite','libsql','mongodb','redis'));
```

O `DEFAULT` aqui é do DDL, não do schema TypeBox — o ADR 004 proíbe o segundo,
não o primeiro, e no SQLite um `ADD COLUMN NOT NULL` exige default não-nulo. É
ele que faz o backfill: toda linha existente vira `postgres`, o que é verdade.

As demais colunas (`file_path`, `url`, `auth_source`…) entram **na migração da
fase que as usar**. Coluna anulável que ninguém escreve é ruído no
`PUBLIC_COLUMNS` e no repositório.

Consequências previstas:

- **Binário novo sobre banco velho** → o aborto de boot que já existe dispara.
- **Binário velho sobre banco v7** → funciona, porque a migração é aditiva. É o
  argumento mais forte para não reescrever a tabela agora: rollback de deploy
  continua sendo opção.
- **`PUBLIC_COLUMNS` precisa ganhar `engine` no mesmo commit**, senão toda
  resposta de conexão falha a validação de `response`. Esse erro é o item 7 do
  `CLAUDE.md` funcionando — é o teste avisando, não um problema.
- **`Connection` ganha `engine` obrigatório, não opcional.** Opcional convidaria
  `conn.engine ?? "postgres"` espalhado pelo front, e o fallback é o que apodrece.

**O custo adiado, e real:** `host`, `database` e `username` são `TEXT NOT NULL`.
Uma conexão SQLite não tem nenhum dos três. Quando o SQLite entrar, ou se grava
sentinela numa coluna NOT NULL — a mentira que produz o próximo bug — ou se faz
o rebuild de 12 passos do SQLite, com três FKs apontando para `connections(id)`.
Seria a primeira migração destrutiva do projeto e merece ADR próprio. **Não entra
na primeira fatia.**

## A primeira fatia não adiciona engine nenhuma

É a discordância mais importante com o enunciado da feature. A primeira fatia é
"o formulário aprende que engines existem, enquanto ainda só existe uma":

1. Migração 007, `EXPECTED_SCHEMA` 7, `PUBLIC_COLUMNS` atualizado.
2. `Engine` em `packages/shared`; `engine` em `Connection` e `CreateConnection`;
   **fora** de `FIELDS`/`UpdateConnection`.
3. Tabela de capacidades por engine, com só `postgres` preenchido.
4. O formulário deriva visibilidade e texto das capacidades em vez de tê-los
   fixos. Com `postgres`, resultado idêntico ao de hoje.
5. Seletor de engine não renderiza.

**Pronto quando** a suíte inteira passa **sem alteração de teste** e os quatro
screenshots batem com os de hoje. É a única fatia verificável assim, e é o que a
torna barata.

Depois: papéis restritos documentados → MySQL/MariaDB somente leitura → libSQL.
SQLite local fica fora até haver resposta para o bloqueio do event loop
(`docs/multi-engine.md`).

## O que não foi medido

Honestidade sobre os limites deste documento:

- **Turso hospedado.** O somente-leitura por JWT foi medido em `sqld`
  self-hosted, com chave própria. Não foi verificado que os tokens da plataforma
  carregam a mesma semântica, nem se cabem no limite de 1000 caracteres do campo
  de senha — 2000 são recusados hoje.
- **`mongodb+srv://`, replica set, `readPreference`** — sem DNS SRV local.
- **Redis Cluster** — em cluster só existe o db 0 e `SELECT` some.
- **TLS ponta a ponta no MySQL/MariaDB.** Os cinco valores de `ssl-mode` vieram
  da mensagem de erro do cliente; o mapeamento a partir dos três do ADR 003 é
  **proposta, não medição**. Em particular, se o driver `mysql2` resolve
  verificação de identidade por **SAN de IP** — que o `pg/ssl.ts` resolve à mão
  para o cenário Tailscale — é desconhecido. Se não resolver, `verify-full` fica
  inutilizável na rede real, que é a armadilha do ADR 003 de novo.
- **Os drivers JS.** Tudo foi medido por CLI, não por `mysql2`/`mongodb`/
  `ioredis`/`@libsql/client`. A regra 10 — todo valor de célula trafega como
  string, não confie na conversão do driver — é exatamente onde essa lacuna dói:
  o Postgres precisou do `TUDO_TEXTO` para resolvê-la. **Cada driver novo precisa
  da própria medição disso.**
