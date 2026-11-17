# Roadmap: DBeaver × DBee

Data: 2026-11-17 · Tipo: pesquisa e proposta (nenhum código alterado).
Base: `docs/DBee.md` §1 (fronteira) e §9, ADR 006/010, `ATRITO.md`, `CHANGELOG.md`
até 0.5.1, `docs/multi-engine.md`, `docs/auditoria-ui-ux.md` e leitura de
`apps/web/src/features/*` e `apps/server/src/routes/*`.

> Limite honesto: a pesquisa externa se apoiou na documentação oficial e em
> comparativos publicados. Os comparativos são em boa parte de fornecedores
> concorrentes (DbVisualizer, Beekeeper), então valem como sinal de reclamação
> recorrente, não como medida. Não achei thread de Reddit/HN citável na busca;
> não cito nenhuma.

## 1. O que a pesquisa diz

**DBeaver** é o mais completo e o mais pesado. A crítica que se repete é
lentidão em resultado grande (relatos de 2 a 4 GB de RAM ao rolar milhões de
linhas), interface Eclipse densa e atualizações frequentes que quebram coisas.
Os concorrentes "simples" (TablePlus, Beekeeper) vencem em abrir rápido e ter
menos botões, e perdem em diagrama ER e em quantidade de engines.

Coisas do DBeaver que importam no uso diário, com fonte:

- Plano de execução visual, com o caminho mais caro em vermelho e detalhe por
  nó. O grafo avançado é só nas edições pagas (Lite/Enterprise/Ultimate/Team).
  https://dbeaver.com/docs/dbeaver/Query-Execution-Plan/
- Data compare entre tabelas, até entre SGBDs diferentes.
  https://dbeaver.com/docs/wiki/Data-compare/ ·
  https://dbeaver.com/docs/dbeaver/25.1/Data-compare/
- Navegador com filtro incremental sobre a árvore.
  https://dbeaver.com/docs/dbeaver/Database-Navigator/
- A versão web (CloudBeaver) tem o mesmo plano de execução.
  https://dbeaver.com/docs/cloudbeaver/Query-Execution-Plan/

Concorrentes:

- **Beekeeper Studio** grava queries salvas num SQLite local; para compartilhar
  é preciso Cloud Workspace pago, e o conteúdo só abre dentro do app, não há
  link web. https://docs.beekeeperstudio.io/user_guide/sql_editor/saving_queries/ ·
  https://docs.beekeeperstudio.io/user_guide/cloud-storage-team-workspaces ·
  https://www.beekeeperstudio.io/alternatives/dbeaver
- **Comparativos** (viés de fornecedor):
  https://www.dbvis.com/thetable/best-dbeaver-alternatives-of-2025/ ·
  https://dev.to/dbvismarketing/when-dbeaver-isnt-the-right-fit-5806 ·
  https://setapp.com/app-reviews/dbeaver-alternatives-for-mac

O ponto que interessa ao DBee: **ninguém do grupo resolve "o time inteiro vê a
mesma coisa por uma URL"**. DBeaver e Beekeeper colaboram sincronizando
metadado entre desktops; o DBee já é o servidor.

## 2. Mapa de gaps

Legenda: **tem** · **parcial** · **falta** · **fora** (reprovado pelos 4 testes
do ADR 006/010).

| Área | Feature | DBeaver | DBee hoje | Nota |
|---|---|---|---|---|
| Editor | Autocomplete por schema | tem | tem | por engine, prioriza o que é do schema (0.4.x). Alias (`FROM clientes c` → `c.`) resolvido pelo `@codemirror/lang-sql`, conferido no navegador |
| Editor | Formatar SQL | tem | tem | `sql-formatter` por dialeto, Shift+Alt+F (carregado sob demanda) |
| Editor | Histórico de execução | tem (local) | tem | gaveta no editor, Minhas/Time, cola sem executar |
| Editor | Snippets/templates | tem | tem | queries salvas com `:nome` → bind (ADR 019), só Postgres |
| Editor | Executar statement sob o cursor | tem | tem | `statementSobCursor` |
| Editor | Vários resultados por execução | tem | tem | `results[]` no `QueryTabContent` |
| Editor | Explain visual | tem (pago no grafo) | tem | árvore com custo/linhas/tempo e nó mais caro (ADR 017) |
| Editor | Explain ANALYZE | tem | fora em leitura | ANALYZE executa a query: só em modo escrita, ADR 006 |
| Grid | Ordenação | tem | tem | |
| Grid | Filtro | tem | parcial | aba Dados tem filtro `contains`; sem operadores (=, <, IS NULL, IN) |
| Grid | Edição de célula / INSERT / DELETE | tem | tem | com cardinalidade provada |
| Grid | Copiar seleção | tem (Advanced Copy) | parcial | só TSV |
| Grid | Copiar como INSERT/CSV/Markdown/JSON | tem | falta | `mutation.puro.ts` já monta INSERT |
| Grid | Visualizar JSON/jsonb | tem | parcial | Mongo/Redis têm modal; jsonb do PG não tem viewer |
| Grid | Comparar linhas | tem (painel) | falta | |
| Grid | Painel de valor/registro | tem | parcial | `RowEditModal` |
| Navegação | Filtro da árvore | tem | tem | |
| Navegação | Busca global (Cmd+K) | tem | falta | §9 v0.3 |
| Navegação | Salto por FK | tem | parcial | aba Dados sim; resultado de query livre não (ATRITO: precisa `tableID`) |
| Navegação | Diagrama ER | tem | tem | dagre |
| Dados | Export CSV/JSON/SQL em stream | tem | tem | multi-tabela, zip |
| Dados | Import CSV para tabela | tem | fora | falha no teste 4 (ADR 006) |
| Dados | Data compare | tem | falta | ver §4: só como leitura/gerar SQL |
| Dados | Backup/restore (`pg_dump`) | tem | fora | teste 2 |
| Schema | DDL aditivo por formulário | tem | tem | ADR 010 |
| Schema | DROP/TRUNCATE por botão | tem | fora | gera SQL (teste 4) |
| Schema | Schema compare/migração | tem (pago) | falta | só gerando SQL |
| Sessão | Abas persistidas | tem | falta | `workspace.ts` vive em memória |
| Sessão | Conexões favoritas / agrupar | tem (pastas) | falta | §9 v0.4 |
| Instância | Sessões/locks (leitura) | tem | tem | `ActivityTab` |
| Instância | Kill de sessão | tem | fora | teste 3 |
| Colaboração | Queries salvas | local | parcial | globais, sem dono nem visibilidade |
| Colaboração | Link para query/linha/aba | falta | falta | **oportunidade** |
| Colaboração | Histórico do time | falta | parcial | Auditoria pesquisável (admin) |
| Segurança | Read-only forçado por transação | parcial (flag na conexão) | tem | `BEGIN READ ONLY` |
| Segurança | Auditoria de toda query | só Team/Enterprise | tem | `query_log` com ator |
| Segurança | Permissão por conexão | Team | tem | |
| Agentes | MCP | falta no Community | tem | ADR 015 |
| Rede | VPN/túnel | SSH por máquina | tem | por pessoa, ADR 014 |
| Setup | Zero instalação por máquina | falta | tem | URL na tailnet |

## 3. Onde o DBee pode ser melhor por ser web, multiusuário e simples

1. **Link para o que está na tela.** `/#c/<conn>/t/<schema.tabela>?f=<filtros>`
   ou `/#q/<saved-id>`. Colar no chat "olha essa linha" e o colega abre a mesma
   coisa, com a permissão dele. DBeaver e Beekeeper não têm como fazer isso.
   O link carrega só identificadores; quem abre passa pela própria sessão e
   pela permissão por conexão.
2. **Histórico como memória do time.** O `query_log` já guarda tudo com ator.
   "O que o João rodou nessa conexão ontem" é um filtro, não uma feature nova.
   Para member, cada um vê o próprio; admin vê todos (como hoje na Auditoria).
3. **Queries salvas do time** com dono e visibilidade (pessoal/time). No
   Beekeeper isso é plano pago.
4. **MCP com o mesmo controle do humano.** Já feito; o próximo passo barato é o
   agente também ver queries salvas do time (`list_saved_queries`), o que dá ao
   agente o vocabulário de consultas que o time já validou.
5. **Zero setup e VPN por pessoa** já são o argumento de venda. Nada a fazer
   além de não regredir.
6. **Read-only real.** O DBeaver marca a conexão como read-only no cliente; o
   DBee impõe no `BEGIN`. Vale dizer isso na tela de conexão.

## 4. Roadmap priorizado (top 10)

Cada item segue a fatia vertical do CLAUDE.md: shared → repo/migration → service
com teste → rota → `features/`. Os 4 testes: (1) SQL na transação e no
`query_log`; (2) sem capacidade fora do SQL; (3) não afeta outras sessões;
(4) reversível pela tela, senão gera SQL.

### Quick wins (até 1 dia cada)

**1. Abas persistidas (P)**
- Problema: recarregar a página ou cair a sessão perde as abas e o SQL digitado.
- Proposta: serializar `workspace` (abas, SQL, conexão, filtros) em
  `localStorage` por usuário, com restauração tolerante (conexão que sumiu é
  descartada, como `workspace.ts` já faz ao podar abas mortas).
- Fronteira: não executa nada; passa trivialmente.
- Camadas: só `apps/web/src/app/workspace.ts` + função pura de (de)serialização
  com teste. Sem backend.
- Risco: SQL com dado sensível fica no navegador. Mitigar: limpar no logout;
  try/catch em toda leitura (modo privado).
- Teste: unitário da serialização; screenshot nos 4 breakpoints após reload.

**2. Histórico da conexão no editor (P)**
- Problema: "qual era aquela query de ontem" obriga a ir na Auditoria (admin).
- Proposta: painel lateral no `QueryTabContent` consumindo o
  `GET /connections/:id/history` que já existe; clique cola no editor.
- Fronteira: leitura do SQLite, nada no Postgres.
- Camadas: `features/query/` + hook Eden. Conferir que a rota filtra por ator
  para member (hoje prova acesso à conexão; definir se member vê só o próprio).
- Risco: vazar SQL de outro usuário a quem não é admin. Teste de autorização.
- Teste: integração com dois usuários, member não vê query do outro.
- **Servidor pronto:** `GET /connections/:id/history?scope=mine|team&q=&status=&limit=&cursor=`.
  `mine` = o que o ator rodou (UI ou MCP); `team` (padrão, comportamento
  anterior) = tudo da conexão — o mesmo que a Auditoria já mostra a quem
  enxerga a conexão, então não abre dado novo. Paginação: `cursor` =
  `executedAt|id` da última linha.

**3. Copiar como INSERT / CSV / Markdown / JSON (P)**
- Problema: só TSV; para colar em ticket ou script precisa reformatar à mão.
- Proposta: menu no rodapé da seleção do grid. INSERT reaproveita o quoting de
  `packages/shared/src/mutation.puro.ts`; os demais são funções puras novas em
  `selecao.ts`/`*.puro.ts`.
- Fronteira: não executa nada.
- Risco: INSERT gerado com escape errado vira SQL quebrado colado depois.
  Teste com aspas, barra, NULL, `bytea`, jsonb e `standard_conforming_strings`
  (o bug da 0.5.0).
- Teste: unitário puro com casos de borda; colar o INSERT gerado num Postgres
  real e conferir a linha.

**4. Formatar SQL (P)**
- Problema: query colada de log vem numa linha só.
- Proposta: `Shift+Alt+F` no CodeMirror. Exige dependência (`sql-formatter`,
  puro JS, ~60 KB) — **perguntar antes** (CLAUDE.md). Sem ela, não fazer.
- Fronteira: puramente cliente.
- Risco: o formatador nunca deve ser usado para validar ou reescrever o SQL
  antes da execução (regra 8). Só texto no editor, desfazível com Ctrl+Z.
- Teste: unitário de que o SQL formatado executa igual (fixture contra PG real).

**5. Filtro com operadores na aba Dados (P/M)**
- Problema: só `contains`; não dá para `status = 'X'`, `valor > 100`,
  `IS NULL`.
- Proposta: estender `RowFilter.operator` em `packages/shared` com
  `= <> < > <= >= is_null not_null in`; o backend monta com parâmetros, como
  o `contains` já faz.
- Fronteira: SELECT em transação read-only.
- Risco: operador montado por concatenação. Operador vem de enum TypeBox,
  valor sempre parâmetro, coluna validada contra o catálogo. Repetir para
  MySQL/libSQL/SQLite (keyset por engine).
- Teste: integração por engine, incluindo valor malicioso no `in`.

### Grandes

**6. Link compartilhável para tabela/filtro/query salva (M)**
- Problema: "olha isso" hoje é print ou SQL colado no chat.
- Proposta: o estado da aba vira URL (hash) — conexão, database, schema,
  tabela, filtros, ordenação, ou id de query salva. Abrir o link abre a aba.
  Nunca carrega SQL livre na URL (evita link que executa algo ao abrir); query
  livre só via query salva, e abrir **não executa**, só preenche o editor.
- Fronteira: passa; a execução segue sendo ação explícita do usuário.
- Camadas: `apps/web/src/app/` (roteamento por hash) + `features/tabs`.
- Risco: link aponta para conexão sem permissão: precisa cair no 403 normal,
  sem revelar nome/host. Link nunca abre em modo escrita automaticamente.
- Teste: integração com usuário sem acesso; screenshot do link aberto.
- **Formato decidido (ADR 020), sem estado no servidor:**
  `/#c/<connId>/t/<schema>/<tabela>?db=<database>&f=<RowFilter[] JSON, encodeURIComponent>&o=<coluna>&d=<asc|desc>`
  e `/#q/<savedQueryId>`. Abrir só lê (`READ ONLY`) ou preenche o editor;
  sem acesso, as rotas devolvem 404.

**7. Queries salvas com dono e visibilidade (M)**
- Problema: a lista é global e anônima; ninguém sabe de quem é nem pode ter
  rascunho privado.
- Proposta: migration com `owner_id` e `visibility ('private'|'team')`
  (já previsto no ATRITO). Editar/excluir só o dono ou admin. MCP ganha
  `list_saved_queries` respeitando a mesma regra.
- Camadas: migration → `savedQueries.repo.ts` → service → `routes/savedQueries.ts`
  → `SavedQueriesModal`.
- Risco: IDOR em PATCH/DELETE. Teste de autorização por rota.
- Teste: integração com dois usuários e um token MCP.

**8. Explain visual (M)**
- Problema: ler `EXPLAIN` em texto é lento; o DBeaver cobra pelo grafo.
- Proposta: botão "Explicar" roda `EXPLAIN (FORMAT JSON)` (sem ANALYZE) na
  transação read-only; o front desenha árvore de nós com custo e linhas
  estimadas, nó mais caro destacado. `EXPLAIN ANALYZE` só aparece em modo
  escrita, e com aviso de que executa a query.
- Fronteira: sem ANALYZE passa nos 4. Com ANALYZE é escrita (ADR 006): só no
  modo escrita, dentro da transação, rollback de efeito colateral **não** é
  garantido para função volátil — por isso não oferecer em leitura.
- Camadas: o executor já roda; `packages/shared` ganha o parser puro do JSON do
  plano; `features/query/PlanoView.tsx`. Só Postgres (capacidade por engine).
- Teste: integração com plano real (seq scan vs index scan), unitário do parser.

**9. Busca global Cmd+K (M)**
- Problema: com várias conexões, achar tabela/query salva é rolar árvore.
- Proposta: paleta que busca conexões, tabelas já carregadas e queries salvas.
  Tabelas de conexão não expandida: endpoint de busca no catálogo, read-only,
  com limite.
- Fronteira: leitura de catálogo.
- Risco: listar objeto de conexão sem permissão. A busca filtra por acesso.
- Teste: integração com usuário restrito; screenshot nos 4 breakpoints.

**10. Salto por FK no resultado de query livre (M/G)**
- Problema: o salto só existe na aba Dados.
- Proposta: o que o ATRITO já desenhou: o executor devolve `tableID`/`columnID`
  da RowDescription em `ResultColumn`; o front resolve para a FK. Só PG.
- Fronteira: leitura.
- Risco: baixo; o salto abre aba com filtro parametrizado, como hoje.
- Teste: integração com JOIN e alias, conferindo que a coluna certa salta.

## 5. Para o ATRITO.md, não para código

- **Data compare entre conexões.** Útil, mas é M/G e o uso diário é raro.
  Se entrar, só como relatório de leitura (diff de linhas por PK) com
  "gerar SQL" para sincronizar, nunca botão "aplicar" (teste 4).
- **Schema compare / migração.** Mesmo argumento; gerar SQL, nunca executar.
- **Snippets com variáveis.** Queries salvas + item 7 cobrem 80%; reavaliar
  depois de uso real.
- **Comparar duas linhas lado a lado.** Barato, mas sem pedido real ainda.
- **Import CSV.** Fora pelo teste 4 (já registrado no ADR 006).
- **Kill de sessão, backup, `pg_dump`.** Fora pelos testes 2 e 3.
- **Viewer de jsonb no Postgres.** Reaproveitar o `MongoDocModal` em leitura;
  pequeno, mas competir com os itens acima por atenção não compensa agora.
