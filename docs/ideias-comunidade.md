# Ideias da comunidade — o que usuários de clientes de banco reclamam, pedem e elogiam

> Pesquisa de 2026-11-17. Só pesquisa: nada aqui está aprovado. Filtro aplicado:
> fronteira do ADR 006 (4 testes, `docs/DBee.md` §1), regra 8 do CLAUDE.md (sem
> parser/regex de SQL) e o que já está feito ou em andamento (`docs/roadmap-dbeaver.md`,
> `CHANGELOG.md` [Não lançado], `ATRITO.md`). Itens já cobertos (abas persistidas,
> histórico, copiar como, formatar, filtro com operadores, link compartilhável,
> queries salvas com dono, explain visual, Cmd+K, compare, viewer de JSON) foram
> descartados da lista de ideias.
>
> **Método e limites.** Votos do GitHub vêm da API de busca (`sort=reactions-+1`),
> lidos em 2026-11-17. Reddit **não foi acessível**: a busca não devolveu nenhum
> thread de r/PostgreSQL, r/SQL etc. nem com `site:reddit.com`, e não abri páginas do
> Reddit. X/Twitter, Lobsters e Stack Overflow não foram consultados diretamente.
> As citações de Hacker News foram extraídas por um leitor automático de página;
> conferir o texto no link antes de citar em público. Onde só há material de
> fornecedor, está dito.

## 1. Dores recorrentes

| # | Dor | Frequência aproximada | Evidência |
|---|---|---|---|
| D1 | **Escrita acidental** — rodar tudo em vez do statement, UPDATE/DELETE sem WHERE, confirmação que falha | alta (issue +25, docs de 3 ferramentas, bug de confirmação) | [Beekeeper #1679](https://github.com/beekeeper-studio/beekeeper-studio/issues/1679) (+25): *"Our employees sometimes run unintended database updates in Beekeeper by accident"*; [DBeaver: confirmação não dispara com DELETE … RETURNING](https://lightrun.com/answers/dbeaver-dbeaver-confirm-dangerous-query-execution-doesnt-work-when-theres-a-returning-clause-in-a-delete-statement); [DataGrip: aviso de query insegura](https://www.jetbrains.com/help/datagrip/2024.3/query-execution.html); [JetBrains forum, opções preventivas](https://intellij-support.jetbrains.com/hc/en-us/community/posts/360000575744/comments/360000187770) |
| D2 | **Peso, startup, instabilidade do desktop** (Java/Electron) | alta (aparece em quase todo thread) | [HN DBeaver 39660592](https://news.ycombinator.com/item?id=39660592) (451 pts): *"Like most Java software, it's incredibly memory hungry"* (LunaSea), *"so heavy/clunky on OSX"* (irjustin); [HN PgManage 41024576](https://news.ycombinator.com/item?id=41024576): *"startup time (it takes at least 30-60s…)"* (awesan); [pgAdmin #9770](https://github.com/pgadmin-org/pgadmin4/issues/9770) (+13) startup lento |
| D3 | **Setup por máquina e driver/cliente nativo** | alta (os dois issues mais votados do DBeaver são disso) | [DBeaver #1361](https://github.com/dbeaver/dbeaver/issues/1361) (+183) "Client home is not specified"; [DBeaver #7976](https://github.com/dbeaver/dbeaver/issues/7976) (+67); [DBeaver #5317](https://github.com/dbeaver/dbeaver/issues/5317) (+129, aberta) plugins somem no update; [pgAdmin #9090](https://github.com/pgadmin-org/pgadmin4/issues/9090) (+34) túnel SSH com chave |
| D4 | **Conexão que cai / reconectar** | média | [pgAdmin #8279](https://github.com/pgadmin-org/pgadmin4/issues/8279) (+12) "Major Pain: Make the connection lost warning an option"; [pgAdmin #6959](https://github.com/pgadmin-org/pgadmin4/issues/6959) (+110) "connection timeout expired"; HN 39660592: *"buggy when it has to reconnect"* (ajsnigrutin) |
| D5 | **Credencial passada de mão em mão / acesso de time** | média | [pgAdmin #5534](https://github.com/pgadmin-org/pgadmin4/issues/5534) (+7): *"what I am trying to avoid is passing around credentials"*; [pgAdmin #8115](https://github.com/pgadmin-org/pgadmin4/issues/8115) (+9) admin via OAuth2; [CloudBeaver #341](https://github.com/dbeaver/cloudbeaver/issues/341) (+16) LDAP; [CloudBeaver #443](https://github.com/dbeaver/cloudbeaver/issues/443) OIDC |
| D6 | **Feature boa atrás de paywall** (gráfico, IA, multi-banco) | média | HN 39660592: *"you need to pay $500 a year if you to talk to more databases"* (RachelF); [DBeaver #36951](https://github.com/dbeaver/dbeaver/issues/36951) (+156) IA só no Enterprise; [dev.to, guia de GUIs](https://dev.to/concerate/which-is-the-best-postgresql-guisql-editor-tool-in-2024-ai8) (charts pagos) |
| D7 | **UI feia, abas que não cabem, tema** | média | [DBeaver #7114](https://github.com/dbeaver/dbeaver/issues/7114) (+59) várias linhas de abas; [DBeaver #21600](https://github.com/dbeaver/dbeaver/issues/21600) (+68, aberta) tema seguir o SO; HN 39660592: *"barely visible text in many places"* (lf-non) |
| D8 | **Edição de linha quebra em tipo "não comum"** (uuid, PostGIS) | baixa-média | [DBeaver #9964](https://github.com/dbeaver/dbeaver/issues/9964) (+66) edição com PK uuid; HN 41024576: *"randomly crashes … postgis related result sets"* (awesan) |

## 2. Pedidos mais votados que ninguém resolve bem

- **IA com modelo local / sem mandar dado para fora** — [DBeaver #36951](https://github.com/dbeaver/dbeaver/issues/36951) (+156), [#20072 Copilot](https://github.com/dbeaver/dbeaver/issues/20072) (+108). Resolvido só no pago, e sempre como chat *dentro* do cliente.
- **Atalhos de editor (Vim/Emacs) e multi-cursor** — [TablePlus #1237](https://github.com/TablePlus/TablePlus/issues/1237) (+184), [DBeaver #6064](https://github.com/dbeaver/dbeaver/issues/6064) (+85), [DBeaver #2316 Tab aceita autocomplete](https://github.com/dbeaver/dbeaver/issues/2316) (+73).
- **Buscar um valor no banco inteiro** — [TablePlus #425](https://github.com/TablePlus/TablePlus/issues/425) (+53): *"search an entire database or just a selection of tables for a word, a number"*. Só phpMyAdmin tem, mal.
- **Copiar tabela com dados para outro banco** — [DBeaver #17767](https://github.com/dbeaver/dbeaver/issues/17767) (+49, aberta).
- **Autenticação de nuvem (IAM RDS, ADC do BigQuery)** — [TablePlus #2007](https://github.com/TablePlus/TablePlus/issues/2007) (+50), [#2921](https://github.com/TablePlus/TablePlus/issues/2921) (+59); HN 41024576 (cyberax).
- **Abrir/salvar arquivo .sql** — [Beekeeper #256](https://github.com/beekeeper-studio/beekeeper-studio/issues/256) (+17, aberta).
- **Mudança de dado com aprovação** ("pull request de dado") — [Ask HN 36877992](https://news.ycombinator.com/item?id=36877992): SQL client não serve porque *"eng approval on data changes"*. Hoje o mercado resolve com Bytebase/PopSQL (material de fornecedor: [Bytebase vs PopSQL](https://www.bytebase.com/blog/bytebase-vs-popsql/)).
- **Mais engines** (DynamoDB +276, ClickHouse +132, DuckDB +53/+19, Mongo +46) — [TablePlus #666](https://github.com/TablePlus/TablePlus/issues/666), [#670](https://github.com/TablePlus/TablePlus/issues/670), [Beekeeper #258](https://github.com/beekeeper-studio/beekeeper-studio/issues/258). Ver anti-ideias.

## 3. O que as pessoas amam (não perder)

- **Rapidez e leveza** — HeidiSQL *"lightning fast"* (FpUser), Postico *"no comparison for a Mac native db client"* (20kleagues), TablePlus *"it just feels right"* (nxpnsv) — [HN 39660592](https://news.ycombinator.com/item?id=39660592); [TablePlus #489](https://github.com/TablePlus/TablePlus/issues/489) (+90) "The best database client I've ever tried!". **DBee:** manter o orçamento de perf (ATRITO, auditoria de 2026-09-05).
- **Editar como planilha, em transação** — *"graphically edit rows and it will start those changes as a transaction"* (shortrounddev2, HN 39660592); Beekeeper *"edit tables like spreadsheets"* (bbkane, HN 41024576). **DBee:** já tem, com cardinalidade provada.
- **Rodar só o statement sob o cursor** — o pedido do Beekeeper #1679 é o comportamento padrão do DBee (`Mod-Enter` → `alvoDoEditor`). Não mudar o padrão.
- **ER diagram, PostGIS, schema diff** — HN 39660592 (supriyo-biswas, mvexel, frankbreetz).
- **Navegador já aberto, sem Electron, de qualquer máquina** — [Ask HN 24996118](https://news.ycombinator.com/item?id=24996118): *"I don't want to run Electron app"*, *"I have a browser open already"* (emteycz). Contra: limite de volume em cliente web (blakeburch) — o streaming do DBee já responde.
- **Estabilidade** — IntelliJ/DataGrip: *"I don't think I've ever encountered a bug in 5 plus years"* (switch007, HN 41024576).

## 4. Ideias para o DBee

Legenda: Fronteira = passa nos 4 testes do ADR 006? Esforço P/M/G. **[ATRITO]** = registrar, não implementar agora.

### Agrega muito / pouco esforço

**I1. Ensaio de escrita: "afetaria N linhas" antes do COMMIT (M)**
- Problema: D1 — [Beekeeper #1679](https://github.com/beekeeper-studio/beekeeper-studio/issues/1679) (+25), [bug de confirmação do DBeaver](https://lightrun.com/answers/dbeaver-dbeaver-confirm-dangerous-query-execution-doesnt-work-when-theres-a-returning-clause-in-a-delete-statement).
- Proposta: no modo escrita, o primeiro Ctrl+Enter num statement que não devolve linhas roda em `BEGIN READ WRITE … ROLLBACK` e mostra `rowCount` (e amostra de `RETURNING`, se houver). Botão "Aplicar" reexecuta com `COMMIT` e **aborta se o rowCount divergir** do ensaio (mesmo espírito da guarda otimista do ADR 008). Não inspeciona o SQL — a decisão vem do resultado do banco, não de parser (regra 8). Os concorrentes resolvem com regex de "sem WHERE", que o DBee não pode e nem precisa.
- Por que o DBee: a transação já é dele (§6); o ensaio fica no `query_log` com ator — auditável.
- Fronteira: passa (SQL em transação, logado; reversível — o ensaio desfaz).
- Risco: efeito colateral fora da transação (sequência avança, `dblink`, função volátil com efeito externo) — documentar como o ADR 017 fez para ANALYZE. Dobra o custo de DML pesado: oferecer "aplicar direto" com confirmação.

**I2. Selo de ambiente por conexão (P)**
- Problema: [ATRITO 2026-09-05](../ATRITO.md) "não dá para saber em qual servidor você está"; DataGrip/DBeaver resolvem com "connection type" colorido (não coletei voto público disso — evidência interna).
- Proposta: campo `ambiente` (produção/homologação/dev) na conexão; faixa e rótulo na barra superior e na aba. Produção + modo escrita = selo inequívoco.
- Por que o DBee: o admin define uma vez para o time inteiro; no desktop cada pessoa configura (ou não).
- Fronteira: não executa nada. Risco: cor competindo com a semântica de escrita (o âmbar do design-system — ver CLAUDE.md 4b); exige migration.

**I3. MCP: `explain_query` e contexto compacto de schema (P)**
- Problema: [DBeaver #36951](https://github.com/dbeaver/dbeaver/issues/36951) (+156) e [#20072](https://github.com/dbeaver/dbeaver/issues/20072) (+108): IA com modelo próprio/local, sem pagar Enterprise.
- Proposta: tool MCP `explain_query` (EXPLAIN sem ANALYZE, `READ ONLY`) e um modo resumido de `list_schema` (nome+tipo+FK) para caber em contexto de modelo local pequeno. Documentar receita com cliente MCP + Ollama.
- Por que o DBee: o MCP já respeita permissão por conexão e audita (ADR 015); a IA fica fora do DBee, que é o certo.
- Fronteira: passa. Risco: baixo; plano pode vazar estimativas de cardinalidade — mesma permissão do humano.

**I4. Abrir e baixar `.sql` na aba do editor (P)**
- Problema: [Beekeeper #256](https://github.com/beekeeper-studio/beekeeper-studio/issues/256) (+17, aberta).
- Proposta: arrastar/abrir arquivo `.sql` cria aba com o conteúdo (File API no navegador); "Baixar como .sql" salva a aba. Nada passa pelo servidor.
- Fronteira: puramente cliente, nada executa ao abrir. Risco: arquivo enorme — teto de tamanho.

**I5. Tema "seguir o sistema" (P)**
- Problema: [DBeaver #21600](https://github.com/dbeaver/dbeaver/issues/21600) (+68, aberta desde 2023). No `apps/web/src` não há `prefers-color-scheme` hoje (conferir antes — o toggle pode já cobrir).
- Proposta: terceira opção do toggle: claro/escuro/sistema. Fronteira: n/a. Risco: nenhum.

**I6. Abas que não cabem: lista de abas e busca (P)**
- Problema: [DBeaver #7114](https://github.com/dbeaver/dbeaver/issues/7114) (+59).
- Proposta: botão "todas as abas" no fim da barra com filtro por nome; Ctrl+K já busca objetos — incluir abas abertas no mesmo véu. Fronteira: n/a.

**I7. Teste de regressão de edição com PK uuid/PostGIS/compostas (P)**
- Problema: [DBeaver #9964](https://github.com/dbeaver/dbeaver/issues/9964) (+66); crash com PostGIS (HN 41024576).
- Proposta: não é feature: integração contra PG real editando linha com PK `uuid`, PK composta e coluna `geometry` (valor trafega como string, regra 10). Fronteira: n/a. Barato e trava um bug famoso dos outros.

**I8. Modo Vim no editor (P, exige dependência)**
- Problema: [TablePlus #1237](https://github.com/TablePlus/TablePlus/issues/1237) (+184).
- Proposta: preferência por usuário que liga `@replit/codemirror-vim`. **Perguntar antes** (dependência nova). Multi-cursor e Tab-aceita-autocomplete o CodeMirror do DBee já tem.

### Médio

**I9. Buscar valor no banco inteiro (M)**
- Problema: [TablePlus #425](https://github.com/TablePlus/TablePlus/issues/425) (+53).
- Proposta: busca por valor nas colunas texto/numéricas das tabelas **escolhidas** (schema ou lista), uma `SELECT … WHERE col::text ILIKE $1 LIMIT 5` por tabela, em `READ ONLY`, com `statement_timeout` curto, cancelável e com progresso. Resultado: tabela → link para a aba Dados já filtrada (ADR 020).
- Por que o DBee: o link pronto para o colega.
- Fronteira: testes 1, 2 e 4 passam; **teste 3 é a dúvida** — varrer muitas tabelas é carga. Mitigar com escopo obrigatório, teto de tabelas e timeout; sem escopo, não roda. Risco: M.

**I10. "Copiar tabela para…" gera script (M)**
- Problema: [DBeaver #17767](https://github.com/dbeaver/dbeaver/issues/17767) (+49).
- Proposta: gera `CREATE TABLE` (DDL já introspectado) + `INSERT`s (copiar como INSERT já existe) e abre no editor da conexão de destino. Não aplica — o usuário roda (ADR 018: compare gera SQL).
- Fronteira: passa por gerar SQL. Risco: volume — limitar a N linhas; acima disso, sugerir export.

**I11. Gráfico rápido do resultado (M) [ATRITO]**
- Problema: charts são pagos no DBeaver ([dev.to](https://dev.to/concerate/which-is-the-best-postgresql-guisql-editor-tool-in-2024-ai8)); Metabase existe para isso.
- Proposta: barra/linha sobre as linhas já carregadas (≤ maxRows), no cliente. Sem pedido real do autor ainda.
- Fronteira: passa. Risco: escopo vira BI; exige lib de gráfico (perguntar).

**I12. Visualizar geometria PostGIS (M) [ATRITO]**
- Problema: *"I don't know of any other clients that support display of PostGIS geometry types"* (mvexel, [HN 39660592](https://news.ycombinator.com/item?id=39660592)).
- Proposta: no visualizador de célula, `ST_AsGeoJSON` e um mini-mapa SVG sem tiles (nada de CDN — tiles externos violariam "nada de CDN em runtime"). Só se o trabalho do autor tiver PostGIS.

### Grandes apostas

**I13. Proposta de mudança com aprovação ("PR de dado") (G) [ATRITO]**
- Problema: [Ask HN 36877992](https://news.ycombinator.com/item?id=36877992); o mercado vende isso pago (Bytebase/PopSQL — fonte de fornecedor).
- Proposta: membro sem permissão de escrita propõe um SQL; um aprovador vê o ensaio (I1), aprova, e o DBee executa com a guarda de rowCount. Tudo no `query_log`.
- Por que o DBee: é multiusuário, já tem papéis, auditoria e ensaio (se I1 existir). Desktop não consegue.
- Fronteira: passa (é SQL em transação). Risco: G — modelo de dados novo, fluxo de estado, revisão adversarial obrigatória (aprovação é fronteira de autorização). Fazer **depois** de I1.

**I14. Login por identidade da rede (Tailscale/forward-auth) ou OIDC (G) [ATRITO]**
- Problema: [pgAdmin #5534](https://github.com/pgadmin-org/pgadmin4/issues/5534), [#8115](https://github.com/pgadmin-org/pgadmin4/issues/8115), [CloudBeaver #341](https://github.com/dbeaver/cloudbeaver/issues/341) (+16), [#443](https://github.com/dbeaver/cloudbeaver/issues/443).
- Proposta: confiar no cabeçalho `Tailscale-User-Login` do `tailscale serve` (casar com usuário existente; nunca criar admin) — o DBee já vive na tailnet (princípio 3).
- Fronteira: n/a (é auth). Risco: **alto** — cabeçalho confiável só se a porta 3001 não for alcançável por fora do proxy, e o compose hoje publica 3001 (commit 2352c7a). Reabre o ADR 007.

**I15. Autenticação IAM do RDS / token de nuvem (G) [ATRITO]**
- Problema: [TablePlus #2007](https://github.com/TablePlus/TablePlus/issues/2007) (+50); HN 41024576 (cyberax).
- Proposta: senha gerada por token assinado (SigV4) no momento de abrir o pool. Só se houver banco em RDS no trabalho; SDK da AWS é dependência de peso.

## 5. Anti-ideias (a comunidade pede, o DBee não deve)

| Pedido | Evidência | Por que não |
|---|---|---|
| Backup/restore do banco | [Beekeeper #778](https://github.com/beekeeper-studio/beekeeper-studio/issues/778) (+25), [CloudBeaver #275](https://github.com/dbeaver/cloudbeaver/issues/275) (+9) | Teste 2 (`pg_dump`, binário externo). Já decidido no ADR 006. |
| Avisar "UPDATE sem WHERE" | DataGrip/DBeaver fazem por inspeção do SQL | Regra 8: nada de parser/regex. O I1 resolve pelo resultado do banco. |
| Debugger de PL/pgSQL | HN 41024576 (infamia) | Exige `CREATE EXTENSION pldebugger` (teste 3) e sessão presa. |
| Plugins/extensões de terceiros | [DBeaver #5317](https://github.com/dbeaver/dbeaver/issues/5317) (+129) | Superfície de ataque num app multiusuário com credencial cifrada; o MCP é o ponto de extensão. |
| Mais engines (DynamoDB, BigQuery, ClickHouse, Athena, Influx) | TablePlus #666 (+276), #670 (+132), #2083 (+60) | Fora do roadmap; cada engine é driver, ADR e revisão de segurança. Só com banco real no trabalho. |
| Chat de IA embutido chamando API externa | DBeaver #20072 | Mandaria schema/dado do cliente para fora e exige chave de API no servidor; o MCP deixa a escolha do modelo com quem usa. |
| Import CSV / colar dados em massa | DBeaver #17767 (parte de colar) | Teste 4 (ADR 006). I10 gera script em vez disso. |
| Kill de sessão / gerência de instância | pgAdmin é a referência | Teste 3. |
