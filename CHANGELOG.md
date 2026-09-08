# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) · versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- **Contas para o time (fase 1 do multi-usuário).** Até aqui o DBee era travado
  em **uma** conta: `POST /auth/setup` recusa quando já existe usuário, e
  nenhuma outra rota criava conta. Distribuir só era possível compartilhando o
  login, o que quebra o `actor` do `query_log`.
  - Migração 004 acrescenta `users.role` (`admin`/`member`) e promove quem já
    existe — quando ela roda há no máximo uma conta, a do setup.
  - Rotas `/users` (listar, criar, trocar papel, resetar senha, remover), todas
    verificadas por `exigirAdmin` **no servidor**. O botão da tela só aparece
    para admin, mas isso é conveniência: quem recusa é a API, e há teste
    varrendo as cinco rotas com uma conta `member`.
  - A senha provisória é **digitada pelo admin**, não gerada — §7 é explícito
    sobre não produzir senha que precise ser exibida ou transportada. Ela nasce
    com `must_change_password`, que o guard já aplicava desde a v0.1 e que
    estava no schema sem uso.
  - Resetar senha e remover conta derrubam as sessões da pessoa. O `query_log`
    **não** é tocado: `actor` guarda o id, não uma FK, para a auditoria
    sobreviver à saída de quem executou.
- **Teste de paridade dos dicionários pt/en.** Chave nova entra à mão nos dois
  arquivos, e esquecer um não quebra build, typecheck nem lint — o `t()` devolve
  a própria chave e a tela mostra o identificador, só para quem usa aquele
  idioma. Cobre chaves faltando, valor vazio e parâmetros de interpolação
  divergentes entre os lados.

### Corrigido
- **A tela de troca de senha dizia que a senha tinha vindo do log do
  container.** Isso deixou de ser verdade quando a §7 removeu a senha gerada e
  impressa; desde a administração de contas, a provisória é escolhida por quem
  criou a conta e entregue por fora. O texto ficou para trás e passou a
  desinformar sobre a origem da própria credencial, nos dois idiomas.
- **`scripts/headless-shot.ts` escolhia qualquer usuário** (`LIMIT 1` sem
  ordem). Com contas novas no banco isso passou a cair numa que o guard prende
  na tela de trocar senha, e **todo screenshot virava aquela tela** sem aviso.
  Agora prefere uma conta sem troca pendente.
- **Diagrama virava tela vazia em schema grande.** Duas causas, ambas medidas
  contra Postgres real com 124 tabelas:
  - `enquadrar()` calculava a escala com `min(w/largura, h/altura, 1)` **sem
    piso**, enquanto o zoom pela roda já clampava em `0,15`. Num schema de 80
    tabelas ligadas à mesma dimensão (formato estrela, comum em contábil) isso
    dá escala `0,075`: a caixa de 220 px vira 16 px, sem texto nem borda
    legível. O piso passou a ser compartilhado pelos dois caminhos, e quando o
    desenho não cabe a vista ancora no canto em vez de centralizar — centralizar
    deixava a origem (onde ficam as tabelas raiz) fora da tela.
  - Dagre põe **todo nó sem aresta no mesmo posto**, e um posto é uma linha
    única: 150 tabelas sem FK viravam uma coluna de 13.240 px. Schema legado
    frequentemente não declara FK nenhuma. As tabelas soltas passaram a assentar
    numa grade quadrada abaixo do grafo ligado — 150 delas saíram de uma caixa
    renderizada de 12 px para 70 px.
  - O teste que deveria ter pego isso usava **cinco** tabelas e um teto de
    4000 px; passava com o layout quebrado. Agora trava a proporção e a escala
    de enquadramento com 150 tabelas.
- **O ponto de status da conexão só refletia o botão "Testar".** Quem testou uma
  vez com a senha errada, corrigiu e passou a usar a conexão continuava vendo
  vermelho para sempre — abrir a conexão, listar databases e rodar query nunca
  atualizavam nada. Carregar os databases **é** conectar, então essa evidência
  agora vence o resultado do teste, que é mais antigo por definição.
- **Os rótulos de status da árvore eram texto fixo em português** num app
  bilíngue: "conectada", "erro na última tentativa", "não testada" apareciam
  assim também em inglês. Passaram por `t()`, e o ponto ganhou `title` — antes o
  rótulo existia só para leitor de tela.


## [0.2.3] — 2026-09-08

> A tag `v0.2.2` existe mas **não gerou release**: o CI falhou no `verify`
> por causa do vazamento de pool corrigido abaixo, antes de qualquer push de
> imagem. Nada foi publicado sob ela.

### Corrigido
- **Dois testes de integração derrubavam o Postgres com o pool ainda aberto.**
  `bundle` e `ddl` removiam o container no `afterAll` sem chamar
  `pools.shutdown()` antes — os outros dez arquivos de integração já faziam. As
  conexões ociosas recebiam `FATAL 57P01 terminating connection due to
  unexpected postmaster exit` **depois** de os testes terem passado, e como
  ninguém esperava por elas o `bun test` contava `1 error` e saía com código 1
  com `0 fail`. Suíte verde, release vermelha.
- **A URL de deploy podia ser trocada ou removida — mas não pela interface.**
  O `PATCH /api/meta/update-settings` sempre aceitou outra URL (substitui) e
  `null` (apaga); o diálogo é que nunca ligou o caminho de volta:
  `editandoUrl` nascia `false` quando já havia URL e **nenhuma linha do código
  chamava `setEditandoUrl(true)`**. Quem colava a URL errada ficava com o botão
  "Atualizar servidor" disparando para o endereço errado, para sempre. Entram
  os botões **Trocar** e **Remover**, mais o **Cancelar** ao trocar — sem ele o
  beco só mudava de lugar. A chave de i18n `update.trocarUrl` já existia,
  órfã, desde a implementação original.
  - Remover pede confirmação: a URL é gravada cifrada e **nunca é devolvida**
    pela API (é credencial), então apagar por engano obriga a buscá-la no
    Dokploy de novo.


## [0.2.1] — 2026-09-08

> **Aviso de versão nova e botão de atualizar, dentro do app.** O cabeçalho
> passa a mostrar um selo quando há release mais nova; o diálogo traz o link
> das notas e o botão que pede o redeploy ao Dokploy. **Quem troca o container
> continua sendo o orquestrador** — o DBee avisa e pede (ADR 009).

### Adicionado
- **Criar tabela e criar database por formulário** (ADR 010), no menu de botão
  direito do database e do schema. **Só aparecem com a escrita ligada** na
  conexão — e o servidor recusa igual se a requisição vier direto na API, porque
  esconder o item de menu não é controle.
- **O comando fica à vista enquanto o formulário é preenchido**, montado pelo
  mesmo código do servidor: o que se lê é literalmente o que vai rodar.
- **Export de várias tabelas em aba própria**, no estilo do Adminer: filtro,
  contagem de linhas por tabela e marcação separada de estrutura e dados.
- **Painel de opções completo no export**: saída (baixar / comprimido / ver na
  tela), formato (SQL, CSV `;`, CSV `,`, TSV, JSON, NDJSON), estrutura
  (`none`/`CREATE`/`DROP+CREATE`), dados (`INSERT`, `INSERT + ON CONFLICT`,
  `COPY`) e inclusão de índices, triggers e funções.
  - Formato tabular de **várias** tabelas sai como **um arquivo por tabela num
    `.zip`**, escrito à mão (`apps/server/src/lib/zip.ts`) — validado contra o
    `unzip` do sistema e o `zipfile` do Python.
  - `COPY … FROM stdin` recarrega muito mais rápido que `INSERT` em tabela
    grande; é o que o `pg_dump` usa por padrão.
  - As opções `USE` e "Incremento Automático" do Adminer **não** existem aqui:
    são MySQL. Copiá-las seria cargo cult.
- **Criar database mudou de lugar**: sai do menu do database e vai para o da
  **conexão**. Um database nasce no cluster, não dentro de outro database.
- **Selo "Atualizar" no cabeçalho**, só quando há versão maior publicada. Vira
  ícone abaixo de `md`; sem ponto colorido, porque verde já significa "conexão
  viva" na árvore e a mesma forma diria outra coisa.
- **Diálogo de atualização** com versão atual, versão nova, link das notas,
  interruptor de verificação automática e o botão "Atualizar servidor". Enquanto
  o container é recriado, a tela avisa e recarrega sozinha quando o servidor
  volta.
- **`GET /meta/version`**, **`POST /meta/version/check`**,
  **`PATCH /meta/update-settings`** e **`POST /meta/update`** (DBee.md §5).
  Todas exigem sessão.
- **Versão gravada no binário** em tempo de compilação
  (`--define process.env.DBEE_VERSION`), passada pelo `release.yml` a partir da
  tag. Fora do container o valor é `dev`, que nunca compara com tag.
- **`release.yml` cria a Release no GitHub** a cada tag, depois do push da
  imagem. Sem isso, `releases/latest` devolve 404 mesmo com a tag publicada e o
  selo nunca acenderia (§11.27c).

### Alterado
- **Tela de login redesenhada**: ilustração à esquerda, formulário à direita,
  num cartão único. A vitrine antiga empilhava selo, mascote com halo, duas
  auroras animadas, favo de fundo, slogan e três provas — sete elementos
  disputando a mesma coluna. Agora a ilustração **é** a vitrine, e tudo em
  volta fica quieto.
  - O mascote saiu da tela: a cena já tem a abelha, e repeti-la ao lado é a
    redundância que o `design-system.md` §1.4 lista.
  - **Não entram "criar conta", "esqueci minha senha" nem "lembrar de mim".**
    Nenhum dos três existe no servidor: não há rota de recuperação, e a sessão
    tem expiração absoluta de 12 h, sem modo prolongado. Controle que não faz
    nada é pior que a ausência dele.
  - Dez chaves de i18n ficaram órfãs com a vitrine antiga e foram removidas.
  - **Dois rótulos sobre a ilustração** — uma frase no canto superior esquerdo e
    uma linha versalete no inferior direito, cada uma com um traço âmbar. Sobre
    a arte crua o branco media **1,01:1** (nuvem e pedra claras): o véu diagonal
    que os acompanha leva o pior caso a **5,06:1** e **5,90:1**, medido em seis
    larguras entre 1024 e 2560, porque o recorte muda com a janela. Só a partir
    de `lg` — abaixo disso a ilustração é uma faixa de 160 px, e frase ali é
    entulho.
  - **O favo do lado do formulário virou dois acentos de canto**, sem a
    tesselação que cobria a coluna inteira: ela virava textura sob os campos e,
    no tema claro, competia com eles.
  - **Ilustração trocada e recomprimida**: 1800x2249, 233 KB. A arte entregue
    tinha 5,2 MB, e essa tela carrega **antes** de qualquer sessão — é o
    primeiro byte que o usuário espera. `width`/`height` do `<img>` seguem a
    arte (reservam a caixa e evitam o pulo de layout), então trocar a
    ilustração sem atualizá-los reintroduz o salto.
- **Estado vazio enxugado.** Eram 45 palavras em três blocos — título,
  parágrafo e uma terceira linha que repetia o título — para dizer "abra uma
  conexão". Agora são o título e uma frase, e o mascote encolheu de 96 para
  64 px e perdeu o halo difuso: ele aparece toda vez que uma aba fecha, e o
  que é bonito no login vira insistente repetido o dia inteiro. O texto que
  explicava o carregamento sob demanda da árvore saiu: era nota de
  implementação, não instrução.

### Corrigido
- **O `.sql` exportado não recarregava quando a tabela tinha coluna `serial`.**
  Ela saía como `integer DEFAULT nextval('t_id_seq')` — o que ela é —, e o
  `psql` parava em `relation "t_id_seq" does not exist` num banco vazio, porque
  a sequência não era criada. Agora sai `serial`/`bigserial`. Valia para o
  export de **uma** tabela também, que já existia. Travado pelo teste que
  recarrega o dump e confere os valores.

### Alterado
- **`deploy/docker-compose.yml` ganhou `pull_policy: always`.** Sem ele, um
  redeploy reusa a `:latest` já em cache no host e não traz nada — o botão diria
  sucesso sem atualizar (§11.27b).
- **`docs/DBee.md`:** §5 e §8 reescritas; o repo é **público**, não privado como
  o doc afirmava — é o que dispensa token na consulta de versão.

### Segurança
- **Nenhuma rota de DDL aceita SQL.** O comando é montado no servidor a partir de
  campos estruturados: identificador citado, tipo de lista fechada, default que é
  literal escapado ou expressão de lista fechada. Testes cobrem o vetor de fechar
  a aspa e emendar `DROP`, contra Postgres real — a tabela alvo continua de pé.
- **`CREATE DATABASE` roda fora de transação** (não há alternativa: o Postgres o
  recusa dentro de uma). O caminho é estreito e tem um único chamador, e o motivo
  está travado por teste, não só por comentário.
- A **URL de deploy é credencial** e não sai da API: `GET /meta/version` devolve
  `webhookConfigured: boolean`, nunca a URL. Nem a resposta de erro, nem o corpo
  devolvido pelo Dokploy (que pode conter a própria URL) atravessam para o
  cliente. Travado por teste de integração.
- Guardada **cifrada** no SQLite com a mesma AES-256-GCM das senhas de conexão,
  com AAD próprio (`app:update_webhook`) — um `password_enc` copiado para essa
  chave falha na decifragem em vez de passar.
- **Mitigação de SSRF** na URL configurável: só `http`/`https`, endereços de
  metadado de nuvem barrados, redirecionamento não seguido e resposta cega.
  Faixas privadas seguem liberadas de propósito (o Dokploy vive numa).
- **Intervalo mínimo entre disparos**, para cliques repetidos não virarem
  deploys enfileirados. Quem disparou fica no log do servidor.

## [0.1.3] — 2026-09-05

> **Corrige um bug bloqueante de login em produção sem TLS.** A **0.1.2** (e
> anteriores) emitia o cookie de sessão com `Secure` incondicional. O navegador
> **descarta** um cookie `Secure` recebido sobre `http://`, então no acesso por
> IP da tailnet (`http://100.x.x.x:3001`, o caminho documentado sem domínio) o
> login autenticava, o cookie era jogado fora, e a tela voltava para o login —
> **sessão impossível**. Quem acessa por `http` deve atualizar.

### Corrigido
- **Cookie de sessão `Secure` agora é condicional** (§11.44): segue o protocolo
  da requisição (`https` ⇒ `Secure`, `http` ⇒ sem), com override explícito por
  `DBEE_COOKIE_SECURE` (`true`/`false`) para o caso de **TLS que termina no
  proxy** (Traefik/Dokploy com domínio — defina `DBEE_COOKIE_SECURE=true`).
  `HttpOnly` e `SameSite=Strict` seguem inegociáveis — só o `Secure` mudou.
  Coberto dos dois lados em `auth.test.ts` ("cookie Secure segue o protocolo"):
  login sobre `http` emite cookie sem `Secure` **e** a sessão seguinte é aceita;
  sobre `https` vem `Secure`; a env explícita vence o protocolo nos dois sentidos.

### Adicionado
- **`DBEE_COOKIE_SECURE`** — nova variável de ambiente (ver README). Opcional;
  o default (seguir o protocolo) atende tanto o acesso `http` por IP da tailnet
  quanto o `https` direto.

## [0.1.2] — 2026-09-05

### Adicionado
- **Export de tabela como `.sql`** (novo formato no menu Exportar, na aba Dados):
  `CREATE TABLE` de referência montado da introspecção (colunas com tipo, nulidade
  e default, mais a PRIMARY KEY) seguido de um `INSERT` por linha, tudo em stream
  pelo mesmo cursor dos outros formatos. Só na origem tabela — numa consulta
  arbitrária não há tabela de destino para o `INSERT`, e o backend recusa com 400.
  Todo valor sai como literal de texto com aspas simples dobradas (`NULL` para
  nulo), e o Postgres coage o literal para o tipo da coluna no destino — coerente
  com a regra 10. Dentro da fronteira (ADR 006): dados por `SELECT`, DDL **gerado**,
  sem `pg_dump`. FKs, índices não-PK, checks e grants ficam de fora, e o cabeçalho
  do arquivo diz isso. Coberto por teste de integração que roda o `.sql` gerado num
  database vazio e confere a recriação.

### Corrigido
- **Tab completa a sugestão do autocomplete** no editor SQL, em vez de pular para o
  botão Consultar. `acceptCompletion` entra antes do `completionKeymap`: com o popup
  aberto, Tab aceita; fechado, Tab segue o comportamento normal.
- **Popover de Exportar** agora dispõe os formatos em grade 2×2 em vez de uma fila
  única — com o quarto formato (SQL), a fila apertava e cortava o rótulo. Largura
  do popover limitada à viewport (`min(20rem, 100vw − 1.5rem)`) para não vazar a
  borda em 375 px.
- **Responsividade do cabeçalho** em telas estreitas: o lockup da marca deixou de
  ser cortado (`shrink-0`), o breadcrumb da conexão some abaixo de `md` (a barra de
  abas já nomeia a tabela), e o selo "Escrita habilitada" encolhe para só o cadeado
  abaixo de `sm` (rótulo por `aria-label`), em vez de empurrar a marca para fora.

## [0.1.1] — 2026-09-05

> **Corrige um defeito grave da 0.1.0.** A **0.1.0** — publicada no GHCR como
> `:latest` — tem um bug que **quebra o grid em qualquer coluna `date`/
> `timestamptz`** (`Objects are not valid as a React child: [object Date]`) e,
> pior, **corrompe em silêncio** qualquer célula de texto cujo valor pareça uma
> data ISO. Causa: o cliente Eden convertia, por padrão, strings ISO em `Date`,
> violando a regra 10 (§11.43). A **0.1.1** corrige com `parseDate: false`,
> travado por teste de fronteira. **Quem estiver na 0.1.0 deve atualizar.**

### Adicionado
- **Navegação por FK** e **queries salvas** — ver as entradas abaixo (fatia de
  2026-09-05, junto do fix do Eden).
- **Autocomplete abre sozinho ao digitar** (VSCode-like): `activateOnTyping` ligado
  com 120 ms de respiro; Esc fecha, Ctrl+Espaço força. O popup foi repaginado —
  entrada encenada (`dbee-settle`), material de overlay com sombra, opção
  selecionada no leito âmbar com régua da marca, trecho que casa em âmbar e ícone
  colorido por tipo (tabela/coluna/palavra-chave). Alimentado pelo schema completo.
- **Split do `/schema`** (Fase 2, dívida de perf): a árvore de navegação passou a
  usar um endpoint leve `GET /schema/tree` (só schema → relação: nome, tipo,
  estimativa) em vez do schema completo. Num catálogo de 800 relações o payload
  cai de ~2,66 MB para dezenas de KB; colunas/índices/FKs vêm do `/schema`
  completo só quando uma tabela é aberta. "Copiar lista de colunas" no menu da
  árvore passou a buscar o schema completo sob demanda.
- **Nova linha (INSERT)** (v0.2), fechando a escrita: `POST /rows/insert` informa só
  as colunas escolhidas — as omitidas ficam com default/sequence do Postgres. O
  formulário nasce esperto (coluna com default ou nullable já vem em "default";
  NOT NULL sem default pede valor), com o mesmo preview do diff literal e checkbox
  de NULL. Construtor `construirInsert` unit-testado; integração real cobrindo
  serial+default preenchidos sozinhos e NOT NULL sem valor virando erro sem inserir.
- **Cancelamento de query** (v0.2): o cliente manda um `queryId` na execução; um
  botão "Cancelar" (visível enquanto roda) chama `POST /query/cancel`, que dispara
  `pg_cancel_backend(pid)` numa conexão **fora do pool** (cancela-se justamente
  quando o pool está ocupado). A query volta com o código 57014 e o `query_log`
  marca `cancelled`, não `error`. Só o próprio backend é sinalizado — nunca
  `pg_terminate_backend` (ADR 006). Integração contra Postgres real.
- Timezone no cadastro de conexão virou **select** (lista IANA nativa do runtime),
  fechando a porta ao erro de digitação que só aparecia ao conectar.
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

### Adicionado
- **Navegação por FK.** Na aba Estrutura, a coluna com FK abre a tabela
  referenciada; no grid (Dados), a célula de uma coluna com FK ganha um salto que
  abre a tabela referenciada **já filtrada pela linha** (FK composta usa todas as
  colunas na ordem). Se o papel não pode ler a tabela referenciada, o salto não
  aparece (a introspecção filtra por `has_table_privilege` da referenciada).
- **Queries salvas.** Salvar a query da aba com nome, listar/abrir/renomear/
  excluir, busca por nome e por conteúdo do SQL. Abrir cria aba atrelada à conexão
  de origem. Liga a tabela `saved_queries`, que existia desde a migration 001.

### Corrigido
- **Grid estourava em qualquer coluna de data (`[object Date]`).** O Eden Treaty
  converte, por padrão, strings ISO em `Date`; uma célula `date`/`timestamptz` (ou
  texto que pareça data) chegava como `Date` e o grid quebrava — e, sem quebrar,
  perdia o valor textual exato do Postgres. `parseDate: false` no cliente Eden
  (`lib/api.ts`). Ver DBee.md §11.43.

### Alterado
- Lockup "DBee" ganhou tipo próprio (Space Grotesk) e mais presença no cabeçalho.

### Segurança
- **Primeiro acesso pela tela de setup — nenhuma senha em log.** Antes o boot
  gerava a senha do `admin` e a imprimia no log do container (visível no painel
  do Dokploy). Agora, sem conta, o boot grava um token em `/data/setup-token`
  (modo `0600`) e loga só o caminho; o operador lê o token do volume e cria a
  primeira conta — usuário e senha à escolha — na tela de setup. `GET/POST
  /auth/setup` são abertas; a segunda criação é barrada por `setup_done`. O token
  é apagado ao concluir. Coberto por integração.
- **O binário voltou a servir a UI em produção.** O guard 401ava `GET /` e os
  assets (serve só a API), e não havia serviço de estático montado — o container
  respondia só JSON e a tela de login/setup nunca aparecia. O guard passou a
  ignorar tudo fora de `/api`; a raiz serve o build do Vite por `Bun.file` com
  fallback SPA e `Content-Type` explícito. Pego pelo screenshot do container
  real, não pela suíte (DBee.md §11.42).
- **O DELETE de linha ganhou a mesma guarda otimista do UPDATE.** Antes o `WHERE`
  do DELETE tinha só a PK: se outra pessoa alterasse a linha entre a leitura e o
  clique, o DELETE apagava mesmo assim — e DELETE não volta. Agora a requisição
  carrega os valores originais das colunas não-PK e o `WHERE` os repete (`col::text
  = valor`, `IS NULL` para nulos); linha mudada casa 0 e aborta com `row_changed`
  ("a linha mudou desde que você a leu"), dentro da transação, sem gravar. Cobre o
  mesmo caso que o UPDATE já tratava. Integração contra Postgres real, com uma
  segunda sessão alterando a linha no meio.
- **Tentativa de escrita negada vai ao `query_log`.** Um UPDATE/DELETE/INSERT numa
  conexão sem `write_enabled` era barrado (403) mas não registrado. Agora a tentativa
  é logada com o SQL literal da intenção, o actor da sessão e `status: error` — o
  evento que uma auditoria existe justamente para registrar.
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
