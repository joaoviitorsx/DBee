# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) · versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- **Edição de linha** (v0.2), a metade de UI da fatia de escrita: duplo clique numa
  célula edita inline; Enter abre o **preview do diff** (o SQL com valores
  literais, '2026-03-01' e não `$1`) para confirmar antes de aplicar; selecionar
  uma linha mostra "Excluir linha", também com preview. Só aparece quando a
  conexão tem escrita habilitada e a tabela tem PK. A execução liga parâmetros; o
  literal é só para leitura. Modal em `RowEditModal`, grade editável em
  `ResultGrid` (`editavel`/`onEditCell`). Ao aplicar, a grade recarrega.
- **Auditoria** (v0.2): tela de `query_log` pesquisável — filtro por texto do SQL
  (substring case-insensitive), estado, conexão e autor, combinando com AND;
  paginação por keyset ("Carregar mais"). Rota `GET /audit`, só-leitura. Aberta
  pelo menu da conexão ("Ver auditoria"), cross-conexão. Títulos de aba passaram
  a ser traduzidos (`tabTitle(tab, t)`).
- Scaffold do monorepo com Bun workspaces: `apps/server` (Elysia), `apps/web` (React + Vite), `packages/shared`.
- `GET /api/health` respondendo 200.
- TypeScript strict em todo o workspace, ESLint com regras type-aware, `bun test`.
- Dockerfile multi-stage sobre `oven/bun` com `bun build --compile`, runtime `debian-slim`.
- `deploy/docker-compose.yml` para o Dokploy.
- GitHub Actions publicando no GHCR a cada tag `v*`.
- Spike de validação do `pg` + `DECLARE CURSOR` sob Bun em `scratch/spike-cursor.ts`.
- `dbee --healthcheck`: o binário compilado faz o próprio healthcheck com `fetch` nativo,
  o que tirou o `curl` da imagem final (260 MB).
- ADR [001](docs/adr/001-modo-read-only-por-transacao.md) (modo read-only por transação) e
  [002](docs/adr/002-typescript-pinado-em-5-9.md) (TypeScript pinado em 5.9.3).

- Base local: migrations do `bun:sqlite` aplicadas no boot, cifra AES-256-GCM das senhas
  com chave scrypt derivada uma vez no boot (salt de 32 B em `app_meta`), CRUD de conexões
  e teste de conexão via `BEGIN READ ONLY`.
- `ssl_mode` reduzido a três modos sem negociação, ADR
  [003](docs/adr/003-modos-de-ssl.md).
- Design system derivado de `assets/` — tokens, movimento e regras em
  [docs/design-system.md](docs/design-system.md), contraste travado por teste.
- Tela de conexões: lista densa com tag de risco, painel lateral de cadastro, esqueleto de
  carregamento e a marca animada como estado de espera.
- Arquitetura em camadas documentada em [docs/arquitetura.md](docs/arquitetura.md).

- Introspecção de schema: `GET /connections/:id/schema` com árvore schemas → relações →
  colunas, tipos, PK/FK e índices, cache em memória de 5 min e `?refresh=1`. Tudo em
  `BEGIN READ ONLY`.
- Gerência de pools por (conexão, database), `max: 5`, com varredura dos ociosos.
- Sora bundlada (`@fontsource-variable/sora`, só o subset latin, 33,6 KB).

- **Shell de três zonas.** A conexão deixa de ser página e vira a raiz da navegação:
  árvore `conexão → database → schema → relação` com expansão lazy, abas de tabela com
  sub-abas Estrutura e Índices, e inspetor de coluna à direita. `Dados` é placeholder até
  o executor de query.
- `GET /connections/:id/databases` — primeiro nível da árvore.
- Busca na árvore, trazida da v0.3 para a v0.1 (§9), sem diferenciar acento nem caixa.
- Estado de perigo para conexão com escrita: nó inteiro, tarja em toda aba e barra
  superior, com o banco ativo sempre visível.
- Menu de contexto por botão direito em todo nó da árvore e em toda aba, com ações
  próprias de cada nível.
- Abaixo de 1024px, árvore e inspetor viram sobreposição — como colunas fixas, em 375px
  o centro da tela desaparecia.

- **Executor de query** (`POST /connections/:id/query`), conforme §6: `BEGIN READ ONLY`
  ou `READ WRITE`, `set_config` para `TimeZone` e `statement_timeout`, `DECLARE` /
  `FETCH maxRows+1` / `CLOSE`, truncamento marcado, valores como string com o tipo real,
  múltiplos statements em sequência e `position` corrigida pelo prefixo calculado.
- `query_log` gravando toda execução, inclusive as que falharam, e
  `GET /connections/:id/history`.
- Aba de query com textarea e tabela HTML — andaime deliberado até o CodeMirror e o
  TanStack Table.

- **Editor SQL** com CodeMirror e `lang-sql`, realce nos tokens da marca, `Cmd+Enter`
  rodando o statement sob o cursor e `Cmd+Shift+Enter` o script inteiro.
- **Grid virtualizado**, com `NULL`, string vazia e a string `"NULL"` distinguíveis, e
  alinhamento pelo tipo real da coluna.
- **Sub-aba Dados funcional** por `POST /connections/:id/tables/:schema/:table/rows`, com
  paginação keyset, filtro e ordenação. Sem chave primária a UI avisa em vez de fingir.
- Quatro portas de entrada de consulta: `+` na barra de abas, `Cmd+T`, "Nova consulta
  aqui" no menu do database, e "Consultar" na aba Dados abrindo já preenchida.
- `splitStatements` movido para `packages/shared`: o editor e o servidor separam
  statements com a **mesma** função.

### Segurança
- **A senha do banco voltava em claro na resposta 422 de validação.** O formato de erro
  padrão do Elysia inclui um campo `found` com o corpo submetido inteiro, então qualquer
  erro de digitação no formulário mandava a senha para o devtools, o HAR e qualquer log de
  resposta no caminho. Agora há `onError` próprio que diz qual campo falhou e nunca o
  valor. Regra 5 do `CLAUDE.md`, §11.19.
- `POST /connections/:id/test` não declarava corpo, então aceitava `form-urlencoded` — um
  *simple request*, acionável por CSRF sem preflight.
- `host` iniciado por `/` era aceito e o `pg` o trata como socket unix em vez de TCP.
- Cifra v2 com o id da conexão como AAD (ADR 005): sem ele, quem tivesse escrita no volume
  podia trocar o `password_enc` entre conexões e a senha de produção ia para outro host.
- `verify-full` com host IP passa a validar o IP contra os SANs `iPAddress` do certificado
  (ADR 003, adendo). Antes falhava contra certificado correto e empurrava o usuário para
  `require`, que não autentica ninguém.
- `::selection` usava a mesma cor sólida do selo de escrita, fazendo texto selecionado
  parecer um selo de estado.
- `BEGIN READ WRITE` passa a exigir `readOnly: false` **explícito** na requisição, além do
  `write_enabled` na conexão. Omitir o campo significa leitura: campo ausente tem que
  significar o estado seguro.
- O boot aborta se a porta já estiver sendo servida — sob Bun os dois processos escutariam
  ao mesmo tempo e as respostas alternariam entre eles (§11.25).

### Corrigido
- **`PATCH /connections/:id` corrompia campos não enviados.** O `default` dos schemas
  TypeBox era materializado na validação, então um patch só do nome reapontava a conexão
  para a porta 5432. Os defaults saíram do schema e ficaram no repositório, onde só valem
  na criação. Registrado em `DBee.md` §11.15.
- `SET LOCAL TimeZone = $1` dava erro de sintaxe — `SET` não aceita placeholder. Trocado
  por `set_config`. Registrado em §11.16.
- Introspecção rodava quatro consultas em `Promise.all` no mesmo client, o que o `pg`
  deprecou. Agora em sequência. Registrado em §11.18.
- `evict()` de pool encerrava a conexão com transação em voo, abandonando quem estava na
  fila do `connect()` — o pedido só falhava 10 s depois e virava 502, culpando o Postgres
  por uma fila do próprio DBee. Agora sai do mapa na hora e encerra quando o último
  empréstimo volta.
- Migration fora de ordem no array regravava a versão para trás e deixava o container em
  loop de restart no boot seguinte. §11.24.
- A introspecção afirmava snapshot consistente que `BEGIN READ ONLY` não dá — o isolamento
  default é READ COMMITTED. Agora usa `REPEATABLE READ`. §11.20.
- Índice misto de coluna e expressão devolvia lista de colunas incompleta, exibida como
  índice de coluna única. §11.22.
- `oid::int` fazia wrap para negativo acima de 2^31 e divergiria do `dataTypeID` do
  resultado de query. §11.21.
- TTL do cache de schema era contado do início da introspecção: numa árvore lenta a
  entrada nascia expirada e o cache parava de funcionar.
- Requisições simultâneas na mesma árvore disparavam uma introspecção cada; agora
  compartilham a que já está em voo.
- `DBEE_CA_CERT=""` passava `ca: ""` e desligava o CA store do sistema, quebrando todo
  `verify-full`. §11.23.
- `APP_SECRET` só com espaços passava em produção; `PORT` inválido virava 0 ou NaN.
- `timezone` inválido só falhava no `set_config` e virava 502.
- Cliente com `ROLLBACK` falho voltava ao pool possivelmente em transação; agora é
  descartado.
- Desligamento limpo em `SIGTERM`/`SIGINT`.

### Adicionado
- **Idioma PT/EN** (fechamento da v0.1). Dicionário próprio em `apps/web/src/i18n/`
  (sem dependência), `t()` com interpolação e `Intl` para número/data; o `en.ts` é
  `Record<keyof pt, string>`, então tradução faltando é erro de compilação. A UI
  inteira passa por `t()`, incluindo login, troca de senha, árvore, abas, grade,
  inspetor, diagrama, export, formulário de conexão e menus. Mensagens do servidor
  traduzidas **pelo código** (`ErroApi` preserva o `code`; fallback na `message`); o
  erro do Postgres vai intacto para a tela. A escolha vive no **registro do usuário**
  (migração 003, `PATCH /auth/locale`, `user.locale` no login/`/me`), com
  `localStorage` cobrindo a tela de login antes de haver sessão. Alternador PT/EN na
  barra superior e na tela de entrada.

### Alterado
- Detalhe de favo de mel hexagonal (`HoneycombCluster`) nos dois cantos superiores
  do cabeçalho, casando com a marca "DBee", e no pé da barra lateral de conexões —
  substituindo a tesselação difusa por um cacho finito de hexágonos flat-top.
- Marca "DBee" no cabeçalho com "Bee" em âmbar (`text-accent`), igual ao login.
- Paleta clara re-rampada: elevação agora sobe para o **branco** em vez do creme
  escuro (o `raised` era mais escuro que o `surface`, invertendo a hierarquia).
  Creme vai para o fundo (`sunken`), o que se eleva embranquece — aba ativa,
  card e menu saltam contra o fundo quente.
- Âmbar mais presente nos **dois** temas: novos tokens `accent-soft` (leito
  âmbar) e `accent-line` (borda âmbar), travados em `contrast.test.ts`. Aba
  ativa ganha topo âmbar + leito `accent-soft`; sub-abas idem; hover de botão
  fantasma/secundário vira âmbar. Perigo (conexão gravável) continua vencendo o
  âmbar — vermelho é o sinal mais forte e não é diluído pela cor de marca.
- Vitrine do login reformulada como hero comercial: selo "Cliente PostgreSQL ·
  self-hosted", mascote com halo âmbar, marca "DBee" (D e Bee no mesmo corpo,
  distinção só de cor — Bee em âmbar), slogan da marca ("Organize. Query. **Build
  What's Next.**") e três provas com marcador de favo, tudo com entrada encenada
  (`animate-enter`) em sequência. Correção: o texto da vitrine passou de
  `text-ink` (que invertia para escuro no tema claro, sumindo sobre o fundo
  grafite fixo) para `text-bone`, sempre claro.
- Login: o favo de mel de fundo saiu do lado do formulário (competia com os
  campos) e virou **cacho de canto** no rodapé direito — novo componente
  `HoneycombCluster` (hexágonos flat-top finitos, parte cheios, parte contorno).
  Rótulos dos campos acendem em âmbar no foco (`group-focus-within`).
- `CLAUDE.md` movido de `docs/` para a raiz do repo, onde ferramentas de agente o carregam
  por convenção.
- ESLint passa a rodar `eslint-plugin-react-hooks` sobre `apps/web`.

### Corrigido
- `DBee.md` §6: a receita de sessão read-only usava `SET LOCAL default_transaction_read_only = on`
  dentro de um `BEGIN` já aberto, o que **não** torna a transação read-only — `UPDATE`, `DELETE`,
  `TRUNCATE` e DDL passavam. Substituída por `BEGIN READ ONLY`. Ver §11.4b.
