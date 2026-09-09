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
| **0a — fronteira do driver** | interface `Driver`, serviços deixam de importar `pg/` | **a seguir** |
| 1 — papéis documentados | `docs/papeis-mysql.md` | não começou |
| 2 — MySQL e MariaDB (leitura) | driver, árvore de 3 níveis, sem interruptor de escrita | não começou |
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
3. **`verify-full` no MySQL.** Não foi medido se o driver `mysql2` valida
   identidade por **SAN de IP**, que é o caso da rede Tailscale deste projeto e
   que o `pg/ssl.ts` resolve à mão. Se não validar, `verify-full` fica
   inutilizável ali — a mesma armadilha do ADR 003. **Medir antes da fase 2.**
4. **Conversão de tipos de cada driver novo.** A regra 10 (todo valor de célula
   trafega como string) precisou do `TUDO_TEXTO` no Postgres. Cada driver novo
   precisa da própria medição — `mysql2`, `@libsql/client`, `mongodb`, `ioredis`.
   **Faz parte da definição de pronto de cada driver.**

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
