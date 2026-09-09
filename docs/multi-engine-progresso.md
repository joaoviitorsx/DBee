# Multi-engine — onde estamos

Rastro vivo da implementação. `docs/multi-engine.md` diz **o quê** e **por quê**;
`docs/conexao-multi-engine.md` detalha o formulário; aqui fica **onde parou** e
**o que decidir a seguir**.

Atualizar este arquivo faz parte de cada fatia. Um plano sem rastro vira
arqueologia na terceira sessão.

## Estado

| fase | o que entrega | estado |
|---|---|---|
| 0b — o campo `engine` existe | migration 007, tipo, capacidades, `engine` na API | **concluída** |
| 0a — fronteira do driver | ~~interface `Driver` antes da 2ª engine~~ | **absorvida na fase 2**, ver nota |
| 1 — papéis documentados | `docs/papeis-mysql.md`, medido | **concluída** |
| 2 — MySQL e MariaDB (leitura) | driver, árvore de 3 níveis, sem interruptor de escrita | **em andamento** — tipos, TLS e introspecção prontos |
| 3 — libSQL | URL + token, read-only por JWT | não começou |
| 4 — MongoDB | vista de documentos | descrito, não agendado |
| 5 — Redis | vista chave/valor (6 tipos) | descrito, não agendado |
| — SQLite local | — | **bloqueado**, ver decisões |

## Fase 0b — o que já está feito

- [x] `packages/shared/src/engine.ts` — `Engine`, `EscopoReadOnly`, `Capacidades`,
      `CAPACIDADES` (só `postgres`), `capacidadesDe` devolvendo `null` para
      engine não implementada.
- [x] Migration `007_connection_engine.sql`, aditiva. `EXPECTED_SCHEMA` 6 → 7.
- [x] `engine` obrigatório em `Connection` (resposta) e opcional em
      `CreateConnection`; **fora** de `UpdateConnection` — imutável por desenho.
- [x] `PUBLIC_COLUMNS`, `PUBLIC_COLUMNS_C`, `ConnectionRow` e o `INSERT` do
      repositório.
- [x] Teste: migração de um banco v6 **com dados** para v7, sem perder linha.
      Verificado também sobre cópia do banco de dev real: v5 → v7, 5 conexões e
      232 linhas de log intactas, todas `postgres`, `integrity_check` ok.
- [x] Teste: `engine` fora do schema de atualização, dentro do de criação
      (opcional) e obrigatório na resposta. Verificado revertendo: mover
      `engine` para dentro de `FIELDS` quebra o teste.
- [x] `engine.puro.ts` — as capacidades vivem fora do módulo de schema, senão
      importá-las no formulário traria o TypeBox de volta ao bundle (os 60 kB
      gzip que já saíram uma vez). Conferido: `TypeBox`/`Kind`/`sinclair` = 0
      ocorrências no bundle, 312,40 kB contra 311,62 antes.
- [x] Formulário derivando visibilidade das capacidades. Com `postgres`
      renderiza os mesmos nove campos, na mesma ordem: Nome, Tag, Host, Porta,
      Database, Usuário, Senha, Criptografia, Timezone, Permitir escrita.
- [x] Screenshots nos quatro breakpoints — 375, 768, 1024 e 1440 — e
      `check-responsivo` limpo nas oito larguras.
- [x] `CHANGELOG.md`.

**Fase 0b concluída.**

**Critério de pronto da fase**: a suíte inteira passa **sem alteração de teste**
(fora os testes novos acima) e os quatro screenshots batem com os de hoje. É o
que torna esta fatia barata e verificável — e o que prova que quem só usa
Postgres não perdeu nada.

## Fase 1 — concluída

- [x] `docs/papeis-mysql.md`, medido contra MySQL 8.4.11 e MariaDB 11.8.9 com
      `GRANT SELECT` e nada mais. A credencial segura exatamente onde a
      transação falhava: `TRUNCATE` e `CREATE USER` voltam 1142 e 1227, e os
      dados ficam intactos depois da bateria inteira.
- [x] Três achados que o plano não previa, todos no documento: MariaDB permite
      `SELECT … FOR UPDATE` ao usuário de leitura e o MySQL não (medido: lock de
      linha travando um `UPDATE` do root com 1205); view com `SQL SECURITY
      DEFINER` no banco concedido lê de banco sem grant; e no MySQL uma consulta
      cortada por `max_execution_time` pode voltar **sem erro**.
- [x] `KILL QUERY` na própria sessão e o timeout de statement sobrevivem ao
      papel restrito — cancelamento e limite de tempo seguem viáveis.

## Fatia de interface — o motor tem cara

Fora da ordem das fases, mas dentro do multi-engine: o formulário abre com um
seletor de motor e a linha da árvore mostra de qual banco a conexão é.

- [x] Sete glifos de uma cor só (`components/IconeEngine.tsx`), `currentColor`.
      A forma diz qual motor é; a cor diz em que estado ele está. Sete paletas
      de marca competiriam com o âmbar que já significa escrita.
- [x] Motores não implementados aparecem apagados e não selecionáveis; o rádio
      nativo `disabled` também os tira da navegação por setas.
- [x] Teste travando que **toda** engine da união aparece no seletor — o furo
      que o typecheck não fecha, porque a lista de ordem é um array e uma lista
      incompleta é um array válido.
- [x] `POST /connections` recusa engine não implementada (400). Esconder na tela
      não é impedir na API.
- [x] Screenshots nos quatro breakpoints, nos dois temas. A primeira versão eram
      cartões altos e a captura em 375px os reprovou: a grade comia a tela
      inteira antes do campo Nome. Viraram chips de uma linha.

## Por que a 0a foi absorvida na fase 2

O plano previa extrair a interface `Driver` **antes** da segunda engine, com o
argumento de que seria a fase sem risco de regressão. Ao começar, ela bateu de
frente com uma regra do próprio plano: *não generalizar antes de ter a segunda
engine funcionando — a forma certa da abstração aparece com o segundo caso, não
com o primeiro imaginado.*

Extrair `introspectar`, `lerLinhas` e `exportar` agora seria inventar a forma a
partir de um caso só, e a chance de acertar é a mesma de qualquer palpite. O que
se ganharia era churn com nome de arquitetura.

**A exceção é a transação.** Ali existe medição de seis engines dizendo que a
garantia de somente-leitura muda de lugar (`docs/multi-engine.md` §1), então a
fronteira é justificada por evidência e não por simetria. Ela entra junto com o
driver do MySQL, com dois casos reais na mão.

Os serviços continuam importando `pg/` até lá. É dívida consciente, e o teste
que a cobra é o próprio typecheck no dia em que o segundo driver aparecer.

## Fase 2 — o que já está de pé

Tudo medido contra MySQL 8.4.11 e MariaDB 11.8.9 reais, nenhum passo presumido
da documentação dos drivers.

- [x] **Tipos** (`mysql/tipos.ts`) — o `TUDO_TEXTO` do MySQL. O `Bun.SQL` foi
      medido primeiro, pela regra 3, e reprovou: converte tipos e o `DATE` muda
      de valor conforme a API chamada. Entrou o `mysql2`.
- [x] **TLS** (`mysql/conexao.ts`) — três modos, com `verify-full` + IP recusado
      em voz alta, porque o `mysql2` não tem como conferir identidade por IP.
      Há um teste-alarme que avisa se o driver corrigir isso.
- [x] **Introspecção** (`mysql/introspect.ts`) — árvore de três níveis, com um
      nó de schema sintético; `information_schema` já filtra por grant.
- [x] **Teste de conexão** (`mysql/test-connection.ts`) — os dois avisos de
      credencial, somando as quatro tabelas de privilégio.

Falta para a fase fechar:

- [ ] Pool de conexões e execução de consulta (o `PoolManager` equivalente).
- [ ] Leitura de linhas com paginação por keyset, e exportação.
- [ ] Cancelamento por `KILL QUERY` e limite de tempo por statement — as duas
      capacidades já foram medidas como viáveis com a credencial restrita, mas
      o MySQL corta `SELECT SLEEP` **sem levantar erro**, e o driver precisa
      tratar isso.
- [ ] `CAPACIDADES` de `mysql` e `mariadb`, e as duas entrando em
      `ENGINES_IMPLEMENTADAS` — é o passo que acende os chips do seletor. Só
      depois de tudo acima, senão a tela oferece o que o servidor não faz.
- [ ] A árvore da interface pulando o nível de schema pela capacidade.

## Decisões pendentes, e quem decide

1. **SQLite local está bloqueado, não adiado.** Medido: `bun:sqlite` é síncrono
   e uma consulta de 47 s produziu **zero** tiques num temporizador de 10 ms — o
   processo inteiro para, e não há timeout nem cancelamento. Num app
   multiusuário isso é negação de serviço por um `SELECT` malfeito. Sai do
   bloqueio com uma das duas: rodar SQLite fora do processo principal, ou
   aceitar o risco explicitamente e documentá-lo. **Decisão de produto.**
2. **Segunda credencial por conexão.** MySQL, MariaDB, libSQL, Mongo e Redis só
   têm garantia por credencial. Ou a conexão guarda duas (leitura e escrita), ou
   a escrita fica desligada nessas engines. Afeta o modelo de dados, a cifra
   (AAD distinto por coluna — ver `docs/conexao-multi-engine.md`) e a tela.
   **Bloqueia a fase 2 na parte de escrita**, não na de leitura.
3. **`verify-full` no MySQL — medido, e a resposta é "depende do host".**
   Resolvido: funciona quando o host é **nome**, e é **impossível** quando o
   host é **IP**, porque o `mysql2` zera o `servername` para IP e a conferência
   de identidade cai em `localhost`. Reproduzido igual sob Bun e Node, e um
   `checkServerIdentity` próprio é ignorado. Detalhe e causa em
   `docs/multi-engine.md` §3c. **Não bloqueia mais**: a validação recusa a
   combinação `verify-full` + IP, em vez de tirar o modo de todo mundo.
4. **Conversão de tipos de cada driver novo.** A regra 10 (todo valor de célula
   trafega como string) precisou do `TUDO_TEXTO` no Postgres. Cada driver novo
   precisa da própria medição. **MySQL/MariaDB: feito** — `mysql/tipos.ts`, 24
   tipos contra servidor real, e o `Bun.SQL` reprovado no caminho (§3b). Faltam
   `@libsql/client`, `mongodb`, `ioredis`.

## Invariantes que não podem cair no caminho

Checklist para cada fase nova. Cada item já quebrou uma vez em alguma engine:

- [ ] A garantia de somente-leitura foi **medida** contra servidor real desta
      engine — não lida na documentação dela. Foi medindo que apareceu o
      `TRUNCATE` escapando no MySQL e o `PRAGMA query_only = OFF` no SQLite.
- [ ] O `SAVEPOINT` do executor é carga de segurança **só no Postgres** (ver
      `apps/server/src/pg/executor.ts`). Driver novo que copie a estrutura não
      herda a proteção — medido: o MySQL aceita `SAVEPOINT` fora de transação em
      silêncio.
- [ ] Todo valor de célula chega como **string** (regra 10), provado contra
      servidor real, não presumido do driver.
- [ ] A tela não oferece o que a engine não faz. Capacidade governa
      **visibilidade**, não `disabled`.
- [ ] Nenhum `default` em schema de entrada (ADR 004).
- [ ] Screenshot nos quatro breakpoints com a tela em estado real
      (`CLAUDE.md` §4b).

## Registro de correções deste plano

Coisas que o plano afirmou e a medição desmentiu. Ficam aqui porque o padrão
importa mais que o item: **toda vez que extrapolei de uma engine para a
parecida, errei.**

- `MariaDB = MySQL com outra string de versão` → falso. `max_statement_time` em
  segundos float contra `max_execution_time` em milissegundos inteiros.
- `libSQL = SQLite` → falso. `PRAGMA query_only` não existe no sqld.
- `MySQL não cobre DDL` → subestimado. Não cobre `TRUNCATE` (perda de dado) nem
  `CREATE USER` (DCL).
- `SQLite: garantia de conexão` → falso. O usuário desliga com
  `PRAGMA query_only = OFF`.
- `MariaDB = MySQL` no catálogo → falso. `TABLE_TYPE = 'SEQUENCE'` só existe no
  MariaDB, e o MySQL mostra `performance_schema` a um usuário sem grant nela
  enquanto o MariaDB não mostra.
- `MariaDB = MySQL` na descrição de JSON → falso. MySQL manda `columnType` 245;
  MariaDB manda `BLOB` (252) com `extendedFormat: "json"` **e o BINARY_FLAG
  ligado** numa coluna de texto.
- `o Bun resolve MySQL, então nada de dependência` → falso. Ele fala o
  protocolo, mas converte tipos, e o `DATE` muda de valor conforme a API
  chamada — um dia a menos a oeste de Greenwich.
