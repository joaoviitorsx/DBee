# ATRITO

2026-09-05 · **PERGUNTA ABERTA para o dia do deploy: com que papel Postgres cada conexão de produção roda?** A §11.37/ADR 001 mostram que `BEGIN READ ONLY` não contém um papel privilegiado — `COPY … TO PROGRAM` num superusuário (ou com `pg_execute_server_program`) executa comando no host do banco a partir de uma conexão que a UI mostra como somente-leitura. O público-alvo (contador que conecta como `postgres` no banco do cliente) cai exatamente nesse caso, e aí o modo leitura não é barreira e o aviso vermelho aparece. Decisão do autor antes de instalar: usar um papel restrito (sem `rolsuper`, sem `pg_execute_server_program`) para as conexões de produção, ou aceitar o aviso conscientemente. Registrado aqui para não passar batido no dia do deploy.

2026-09-05 · **Padrão a revisar antes da tag: mensagens de erro do DBee diagnosticam bem e orientam mal.** Duas já corrigidas — `row_changed` ("a linha mudou") e `decryption_failed` ("não foi possível decifrar… APP_SECRET pode ter mudado") explicavam a causa mas não diziam a ação (recarregar a linha; editar a conexão e reinformar a senha). O padrão provavelmente se repete em outras: a mensagem descreve o estado, não o próximo passo. Vale uma passada geral pelas chaves `erro.*` (web) e pelas `message` de `failures.ts`/serviços antes da v0.1 — cada erro deve terminar dizendo o que o usuário faz a seguir, na voz da interface, não só o que aconteceu.

2026-09-05 · **INSERT não detecta coluna gerada / `GENERATED ALWAYS AS IDENTITY`.** A introspecção atual (`Column`) não traz `is_generated`, então o formulário de "Nova linha" oferece essas colunas como preenchíveis. Preencher uma faz o Postgres recusar (`cannot insert into column ...`) e o erro vai inteiro para a tela — falha alto e visível, sem escrita errada em silêncio, por isso o botão fica ligado. Fatia curta: introspectar `attgenerated`/`is_identity` no `/schema`, marcar a coluna e ocultá-la (ou travá-la) no `InsertModal`. Fecha a última aspereza do INSERT sem mudar a garantia de segurança.

2026-09-05 · **A árvore mostra o mesmo sinal (barra vermelha) para "rota não existe" e "conexão falhou".** Quando o backend estava defasado e a rota `/schema/tree` não existia (404), a árvore pintou a conexão com a mesma barra vermelha de erro de conexão — e o diagnóstico foi para o lado errado ("o Postgres caiu?") em vez de "reinicie o servidor". São causas de camadas diferentes: 404/`rota não encontrada` é o cliente e o servidor fora de sincronia (deploy/migration), enquanto falha de conexão é o Postgres ou a credencial. Precisam ser distinguíveis no sinal: erro de app (4xx/5xx do próprio DBee, especialmente 404 de rota) merece um estado diferente de erro de upstream (conexão/decifra/timeout do Postgres) — texto e/ou cor distintos, e a mensagem apontando a ação certa. O `EXPECTED_SCHEMA` no boot (feito) fecha o caso do schema defasado pela origem; este item é a defesa na UI para o próximo desencontro de contrato. Fatia de UI pequena, mas toca o mapeamento de erro→estado da árvore.

### Resolvido — Fase pós-v0.1 (dívida de perf medida)

2026-09-05 · Fechados da auditoria de perf:
- **Resizer da árvore** re-renderizava o grid a cada `mousemove` (67 ms, 15 fps): agora escreve a largura numa CSS var por ref durante o arrasto e só `setState` no `mouseup`. `AppShell.tsx`.
- **Auto-expansão da árvore** injetava 6.420 nós num commit síncrono: teto de 200 relações casadas para a busca auto-expandir (`MAX_AUTO_EXPAND`, `ConnectionTree.tsx`). Acima disso os schemas ficam recolhidos.
- **Cache de schema bloqueava na entrada vencida** (498 ms local / 872 ms com RTT): stale-while-revalidate em `schema.service.ts` (`#revalidar`), servindo o vencido e revalidando em background pelo `#emVoo`.
- **Pool cheio devolvia 502** culpando o Postgres: já resolvido (503 honesto em `pool.ts`).

- **`/schema` de 2,66 MB por desenho da árvore**: split feito — `/schema/tree` leve (só nomes/tipos) para a navegação; colunas/índices/FKs vêm do `/schema` completo só quando a tabela é aberta.

Resta da auditoria: virtualização de colunas do grid.


Registro de fricção do uso real (DBee.md §10).

Toda vez que a ferramenta atrapalhar, uma linha aqui **no momento em que doeu**.
Sem formatar, sem julgar se vale, sem abrir issue na hora.

Também é onde vai ideia boa que está fora do escopo da fase atual — para não
virar código antes da hora (CLAUDE.md, "O que não fazer sem perguntar").

Formato:

```
AAAA-MM-DD · o que aconteceu, em uma linha
```

**Triagem semanal de 15 min:** lê o arquivo, converte o que sobreviveu em issue
com label `atrito`, limpa o resto. O que aparecer 3 vezes vira prioridade
automática.

---

2026-09-04 · a tela de conexões subiu sem revisão visual — a extensão do Chrome não estava conectada, então validei só por build (tokens no CSS, classes presentes, tipo e lint limpos) e nunca vi a página renderizada. Pendente: screenshot em 375/768/1024/1440 e revisão.

2026-09-04 · headers de segurança da §7 (CSP, X-Content-Type-Options, Referrer-Policy) ainda não existem. **Disparo: ao ligar o `@elysiajs/static`.** Enquanto o server só devolve JSON não há página a proteger e falta só o `nosniff`; no commit que passar a servir o build do web, a CSP vira dívida imediata. Registrado aqui e não só na §7 porque item de doc de arquitetura ninguém lê no dia certo.

2026-09-05 · conferência de contrato para o autocomplete da v0.3 (não implementar agora). O `GET /connections/:id/schema` **atende** o que o `@codemirror/lang-sql` 6.10 precisa: o `SQLNamespace` dele é `{ [nome]: SQLNamespace } | { self, children } | (Completion | string)[]`, e a árvore já dá schema → relação → coluna com `dataType` (vira `Completion.detail`) e `kind` (vira `Completion.type`). Montar o objeto é transformação pura, sem rota nova.

Duas coisas que faltam, para a fatia do editor não descobrir tarde:

1. **`search_path` / schema default não é exposto.** O `SQLConfig.defaultSchema` do lang-sql é o que permite completar `SELECT * FROM cli…` sem digitar `public.` antes. Hoje `isDefault` existe só para *database*, não para schema, e nada devolve o `search_path` da sessão. Sem isso o autocomplete só funciona com nome qualificado — que é justamente o que o usuário quer evitar digitar.

2. **A árvore é pesada para alimentar autocomplete.** Ela carrega índices, FKs, comentários, defaults e `estimatedRows` de toda relação; o editor precisa só de nome e tipo. Num banco com centenas de tabelas isso é bastante JSON por montagem do editor. Não é bloqueio — o cache de 5 min já cobre, e a árvore é buscada de qualquer forma para a navegação — mas se o editor ficar lento, é aqui que se olha primeiro, e a saída é um parâmetro de projeção na rota, não uma rota nova.

2026-09-05 · revisão de interface contra a premissa da v0.1 apontou que **o app não abre pela tailnet**: o `Dockerfile` copia o build do web para `/app/public` e nada no server lê esse diretório — não há `@elysiajs/static` em lugar nenhum. Hoje o DBee só existe como `bun run dev` na máquina do autor, com Vite em `:5173`, que é literalmente o "setup por máquina" que a §1 diz que a ferramenta existe para eliminar. Sem isso, nenhum outro item importa.

2026-09-05 · **o executor de query está inalcançável pela interface.** Rota, serviço, cursor, correção de position e query_log estão prontos e testados, e não existe nenhum caminho para criar uma aba de query: `workspace.ts` não tem `openQuery()`, o menu da árvore não tem o item, a barra de abas não tem "+". Foi decisão explícita de escopo na fatia do executor (as quatro portas de entrada foram excluídas), mas o efeito prático é que a funcionalidade não pode ser usada.

2026-09-05 · **a busca da árvore só filtra o que já foi expandido.** `filterSchema` roda sobre `schema?.data`, que só existe depois de expandir conexão *e* database. Com tudo fechado — que é o estado ao abrir o app — digitar no campo não produz efeito nenhum. A tela afirma uma capacidade que não tem, e o item está marcado como concluído no CHANGELOG.

2026-09-05 · **servidor fora do ar diz "Nenhuma conexão ainda".** `App.tsx` usa `query.data ?? []` e nunca lê `isError` nem `isPending`. Com a API caída, a tela afirma que as conexões do usuário não existem. É a classe de defeito que a definição de pronto nomeia: a tela afirmando a coisa errada.

2026-09-05 · **excluir conexão não pede confirmação.** O item está no menu de contexto e é navegável por seta + Enter: uma seta a mais apaga a conexão de produção e a senha cifrada, sem volta.

2026-09-05 · **nada sobrevive a fechar a aba do navegador**: abas abertas, expansão da árvore, largura do painel, saúde das conexões e o SQL que estava sendo escrito. O SQL some inclusive só ao trocar de aba, porque o componente é remontado por `key`. O ciclo "volto amanhã e reencontro o que estava fazendo" não existe em nenhum eixo.

2026-09-05 · **o histórico existe no banco e na rota, e não na tela.** `GET /connections/:id/history` responde e `query_log` grava tudo; nenhum componente consome. "Aquela query do fechamento" está gravada e inalcançável.

2026-09-05 · **não dá para saber em qual servidor você está.** A árvore mostra o nome que o usuário deu; a barra superior mostra nome + database.schema.relação. O `host:porta` nunca aparece. Duas conexões chamadas "Produção Assertivus" apontando para hosts diferentes são indistinguíveis sem abrir o formulário — e a §2.1 do design system reserva a mono justamente para esse endereço.

2026-09-05 · **os três estados de carregamento documentados no §7 são código morto** desde a fatia do shell. Ver o aviso no próprio design-system.md.

2026-09-05 · **acessibilidade: selecionar coluna é mouse-only** (`<tr onClick>` sem tabIndex, role ou onKeyDown), e como o inspetor só abre por seleção de coluna, o inspetor inteiro é inacessível por teclado. O menu de contexto nunca move o foco do DOM. A árvore não usa `role="tree"`. Contradiz "a ferramenta é operada por teclado" do §6.

2026-09-05 · `actor` no `query_log` é a string `"unauthenticated"` até a fatia de autenticação. Era `"admin"`, o que dava ao registro aparência de identidade sem ter nenhuma. Troca feita agora, não quando a auth chegar: um log que finge saber quem foi é pior que um que admite não saber.

### Construído e não ligado

Quatro coisas já existem no repositório e nenhum código as usa. Registradas para
uma passada de "expor o que já está pronto" antes de qualquer sprint de feature
nova — foi o achado mais consistente da revisão de features.

2026-09-05 · `saved_queries` está criada na migration 001 e **nenhuma linha de código a usa**. Queries salvas do time custam repositório + rotas + painel, sem migration de tabela nova (só `owner_id` e `visibility` depois).

2026-09-05 · a introspecção devolve `foreignKeys` com `referencedSchema`, `referencedTable` e `referencedColumns` **em ordem preservada** (o `WITH ORDINALITY` existe para FK composta não sair trocada) e **nada na UI consome**. Navegação por FK no grid — clicar numa célula e abrir a linha referenciada — é montar a query a partir do que já está em memória.

2026-09-05 · **`EXPLAIN` já executa hoje**: o `DECLARE` recusa, o `SAVEPOINT` desfaz e o `executeDirect` roda. Visualizar o plano é trabalho de front, não de servidor. (`EXPLAIN ANALYZE` é escrita — ADR 006, já coberto por teste.)

2026-09-05 · `splitStatements` já devolve o `offset` de cada statement no SQL original. É exatamente a peça de "executar o statement sob o cursor" no editor; falta mover o arquivo para `packages/shared` (é TS puro, sem dependência) para o front usar a mesma função.

2026-09-05 · **Export sem File System Access monta o arquivo na memória da aba.** `showSaveFilePicker` existe em Chrome e Edge e permite gravar em disco enquanto os bytes chegam — o servidor em stream chega até o disco sem nada materializar. Firefox e Safari não têm a API: lá o caminho de reserva é `blob()` + `<a download>`, e o arquivo inteiro passa pela memória do navegador. O servidor continua limitado a um lote; o teto que se perde é o do cliente. O painel de export **diz isso ao usuário** naqueles navegadores. Gatilho para reabrir: alguém exportar tabela de milhões de linhas fora do Chrome, ou o Firefox implementar a API.

2026-09-05 · **O salvamento do arquivo não é verificável em Chrome headless.** O caminho de reserva usa `<a download>` sobre um `blob:`, e o headless não materializa esse download nem com `Page.setDownloadBehavior`. O que foi verificado no navegador de verdade: `fetch` da rota devolvendo 200, `content-type`, `content-disposition`, ausência de `content-length`, BOM no primeiro byte e o CSV correto lido do stream. O passo que falta cobrir é o do navegador escrever o arquivo — teste manual, ou um runner com navegador de cabeça.

2026-09-05 · **`json` no export monta o array inteiro no consumidor, não no servidor.** O servidor emite `[`, os objetos e `]` em stream, mas quem consome um `.json` normalmente faz `JSON.parse` do arquivo todo. Para resultado grande o formato correto é `ndjson`, que o painel oferece e descreve como *"um objeto por linha"*. Não é bug; é a razão de o NDJSON estar ali.

### Idioma PT/EN — decidido para depois da auth, análise preservada

2026-09-05 · **PT/EN sai da v0.1** (decisão do autor): i18n não é requisito para "uma semana sem abrir o DBeaver". Entra depois da auth. O que a análise achou, para não redescobrir:

- **O custo real não está na UI.** Traduzir os ~15 componentes é mecânico. O trabalho está nas **mensagens do servidor**, que hoje são prosa pt-BR dentro de cada `fail()` (`"exporte um statement por vez"`, `"public.x não existe neste database"`).
- **Caminho barato e suficiente:** traduzir **pelo código** que a rota já devolve (`not_found`, `bad_request`, `upstream_error`), com fallback na `message` do servidor quando não houver tradução para aquele código. Pega o caso comum sem tocar em cada `fail()`. Detalhe que carrega nome de tabela vira parâmetro quando aparecer.
- **O erro do Postgres não se traduz.** Vai inteiro para a tela, no idioma do `lc_messages` do cluster (CLAUDE.md). Traduzir seria reescrever o que o banco disse — e é justamente o texto que a pessoa cola numa busca.
- **Sem dependência nova.** Dicionário próprio e um `t()`; `react-i18next` são ~40 KB para dois idiomas sem pluralização complexa.
- Onde guardar a escolha: no registro do usuário, que só existe depois da auth. É a razão de a ordem ser essa.

### Auditoria de performance — 2026-09-05

Rodada contra Postgres real (500k linhas, catálogo de 801 tabelas) e com RTT de 20 ms injetado por proxy, para o cenário de banco de cliente atrás de túnel. Ordenado por ganho medido / custo.

2026-09-05 · **O keyset de `rows.ts` degrada como `OFFSET` — verificado aqui, não só relatado.** `EXPLAIN (ANALYZE, BUFFERS)` na página 300.000 de 500k, `ORDER BY criado_em` (indexada, NOT NULL): a forma de hoje leva **61,19 ms** com `Filter:`, `Rows Removed by Filter: 300000` e `Heap Fetches: 300101`; a comparação de linha canônica `(c, pk) > (v, p)` leva **0,138 ms** com `Index Cond:` e `Heap Fetches: 101`. **443×.** O `OR` da disjunção impede o planejador de converter a condição num range de índice.

  Consequência real: rolar 100k linhas ordenando por coluna indexada custou **8,46 s** de banco contra 0,77 s da forma canônica; e a página 450k lê ~177 MB de buffer para devolver 100 linhas, despejando o cache do banco do cliente.

  **A ordenação só pela PK já está correta** — `pkAvanca` já é comparação de linha e vira `Index Cond`.

  Correção em duas partes, com o que a introspecção já entrega: coluna com `nullable === false` usa a forma canônica direta; coluna anulável vira `UNION ALL` de dois ramos (não-nulos canônico, nulos com `IS NULL AND pk > `), cada um com `LIMIT n+1`. O `RowCursor` não muda de formato e o teste que trava isso é o `paginarTudo()` que já existe.

  **Três comentários do repositório afirmavam o contrário** (`rows.ts`, `DataTab.tsx`, `RowCursor` no shared: *"a página 400 custa o mesmo que a página 2"*). Corrigidos para dizer o que foi medido, com ponteiro para cá — o comportamento continua o de hoje até a correção entrar.

2026-09-05 · **`PAGINA = 200` no `DataTab` (`:13`): trocar por 1000 é uma linha e 4,6×.** Rolar 10k linhas com RTT de 20 ms: **6,63 s** com 200 (50 requisições), **1,43 s** com 1000 (10 requisições). O schema já permite 1000 (`shared/src/rows.ts:53`) e o grid é virtualizado, então o DOM não muda. O payload por página vai de 78 KB para 390 KB — menos tempo que os 4 round-trips que economiza.

2026-09-05 · **`GET /:id/history` numa conexão parada leva 542 ms com 1M de registros; com índice `(connection_id, executed_at DESC)`, 0,20 ms — 2.700×.** O plano varre o log inteiro em ordem de data procurando 100 linhas daquela conexão. Está no caminho real: `routes/query.ts:44` sempre passa `params.id`, então **toda** chamada usa o statement patológico. Custo da correção: uma migration e 3 linhas. (O `record()` custa 0,04 ms e não degrada — não mexer.)

2026-09-05 · **Uma query simples custa 10 round-trips; com RTT de 20 ms, um `SELECT 1` leva 213 ms, dos quais 94% é rede.** Sequência: `BEGIN` · 2× `set_config` · `SAVEPOINT` · `DECLARE` · `FETCH` · `CLOSE` · `RELEASE` · consulta a `pg_type` · `ROLLBACK`. Dá para ir a 7 sem concatenar SQL: os dois `set_config` num `SELECT` só (parametrizado), cache de OID de tipo no processo (os embutidos são constantes), e não emitir `RELEASE SAVEPOINT` (a leitura termina em `ROLLBACK` de qualquer forma). Medido: 210 → 147 ms.

  **O que NÃO fazer, medido:** agrupar `FETCH; CLOSE; RELEASE` numa string chegaria a 4 round-trips, mas o `pg@8.23` lança `uncaughtException` **não capturável** quando um statement do grupo falha (reproduzido com `SELECT 1/0`), e no protocolo simples o bloco implícito **perde o savepoint** quando o `DECLARE` falha — quebrando exatamente o fallback do `executeOne`.

2026-09-05 · **17% do bundle do front é runtime de servidor.** Três arquivos do web importam valor do barrel `@dbee/shared`, que arrasta `elysia` → `@sinclair/typebox` → um `import("file-type")` dinâmico com descompactador de ZIP. Correção verificada com build real: extrair as funções puras de CSV/TSV de `export.ts` para um `csv.ts` sem elysia e expor subpaths `./split` e `./csv`. **−40,2 kB gzip no chunk inicial, e um chunk de 62,4 kB some inteiro.** `typecheck` e testes verdes na cópia de teste.

2026-09-05 · **`SqlEditor` custa 107,4 kB gzip no primeiro carregamento e não há um `import()` dinâmico em todo o projeto.** Quem abre o DBee para olhar uma tabela paga o editor inteiro. `React.lazy` + `Suspense` com o `Skeleton` que já existe. Não conflita com *"nada de CDN em runtime"*: mesmo build, mesma origem.

2026-09-05 · **A árvore não é virtualizada: a primeira tecla do filtro custa 192 ms e injeta 6.420 nós DOM** (catálogo de 800 relações; com 10.000, 1,65 s). O filtro em si é rápido — `filterSchema` leva 0,155 ms — então **debounce seria dano líquido**: 150 ms de latência para economizar 0,3 ms. A causa é o `forceOpen` de `ConnectionTree.tsx:430`, que expande todos os schemas num commit síncrono. Paliativo de 5 linhas: teto de ~200 relações casadas para auto-expandir.

2026-09-05 · **`/schema` devolve 2,66 MB quando a árvore desenha 50 KB** (1,9%), e um acerto de cache custa 35–57 ms de CPU do servidor, dos quais **25 ms são validação de resposta TypeBox**. Tirar o `response` conflita com a Definição de Pronto item 7 e **não deve ser feito** — foi a validação de resposta que pegou o `array_agg` cru. O caminho sem conflito é encolher o payload: árvore de navegação num endpoint, colunas/índices/constraints noutro, ambos validados. Altera o contrato do §5, então exige atualizar o doc junto.

2026-09-05 · **O TTL de 5 min do cache de schema faz o primeiro clique numa tabela custar 498 ms local / 872 ms com RTT de 20 ms**, em momento imprevisível, o dia inteiro. Stale-while-revalidate resolve em ~15 linhas: servir a entrada vencida e revalidar em background (o `#emVoo` já existe e resolve a corrida), com o botão "Recarregar catálogo" que já existe para quem quer garantia.

2026-09-05 · **Arrastar o divisor da árvore re-renderiza o grid: 67,6 ms por `mousemove`, 15 fps**, com 800 linhas de árvore no DOM. `AppShell.tsx:378` chama `setState` a cada `mousemove`. Escrever a largura numa CSS custom property por `ref` durante o arrasto e só chamar `setState` no `mouseup`: ~15 linhas.

2026-09-05 · **Pool cheio devolve 502 culpando o Postgres por uma fila que o DBee criou.** Cinco queries de 12 s em cinco abas, e a sexta requisição — trivial — falha depois de 10 s com `upstream_error: timeout exceeded when trying to connect`. Para fila curta o `max: 5` está adequado (20 queries de 1 s enfileiram sem erro). O que falta é distinguir "fila do pool cheia" de "banco fora do ar" e devolver 503 honesto. **E o `DBee.md` §6 está errado:** diz "um pool por `connection_id`, `max: 5`", mas a implementação é por **(connection_id, database)** — uma conexão navegando 2 databases abre **10 backends** no cliente, confirmado em `pg_stat_activity`. Corrigir o número no doc antes de qualquer um subir o `max`.

2026-09-05 · **O grid virtualiza linhas, não colunas.** 10k linhas com 20 colunas rendem em 39,7 ms; com 100 colunas, **176,4 ms** — `SELECT *` numa tabela de ERP. Um segundo `useVirtualizer` com `horizontal: true`; a parte chata é sincronizar o `scrollLeft` do cabeçalho, que hoje é um irmão fora do scroller. Junto com isso faz sentido projetar colunas no `SELECT` do `/rows` (hoje `SELECT *`, 392 KB por página de 1000) — antes disso, não: o Inspector mostra a linha inteira e precisa dos dados.

**Medido e rápido o bastante — não otimizar:** o export em stream (500k linhas / 176 MB a 53 MB/s com RSS subindo 6 MB — faz exatamente o que o §6 prescreve); a virtualização de linhas do grid (929 nós DOM constantes com 1k, 10k ou 100k linhas; re-render com 100k em 8,2 ms — o §2.5 está cumprido e medido); `filter.ts` e `plan.ts`; o `record()` do `query_log`; o boot (607–814 ms, dos quais ~490 ms são o `deriveKey` do ADR 005, deliberado); `has_table_privilege` (15% da introspecção, e tirá-lo é regressão de segurança); `refetchOnWindowFocus: false`, que já está certo; e o tree-shaking de `lucide-react` (254 B por ícone) e do `@fontsource-variable/sora` (um woff2 de 33 kB, porque o `@font-face` foi escrito à mão em vez de importar o `index.css` do pacote).

### Revisão adversarial de segurança — 2026-09-05

Rodada antes de fechar a v0.1, reproduzindo contra Postgres e servidor reais. O achado grave (`COPY … TO PROGRAM` furando o read-only) foi corrigido com detecção+aviso e está em `DBee.md` §11.37, ADR 001 (emenda) e `readonly-copy.integration.test.ts`. Os dois abaixo ficaram registrados, não corrigidos, por dependerem de decisão de deploy ou de escopo.

2026-09-05 · **Rate-limit de login colapsa atrás do proxy do Dokploy.** `auth.ts` usa `server.requestIP()` como chave de origem e descarta `X-Forwarded-For` de propósito (contra spoof). Mas o §8 diz que o acesso é via Traefik do Dokploy — e aí `requestIP()` é o IP do container do Traefik para **toda** requisição, então o balde "por origem" (10/15min) vira global: um atacante não autenticado faz 10 logins falhos e trava o login de todo mundo. Dedução de código + deploy, não reproduzido contra Traefik real. Correção certa: confiar em `X-Forwarded-For` **apenas** de uma lista de hops confiáveis configurada, senão o limite por origem é inútil no ambiente de produção. O balde por usuário continua valendo (trava `admin` com 10 falhas — account-lockout DoS, menor). Decisão de deploy; entra quando o proxy for configurado.

2026-09-05 · **Regra 6 (nunca PgBouncer 6432) não é aplicada em código.** `packages/shared/src/connections.ts` valida `port` como 1..65535 (inclui 6432) e `host` como qualquer string sem `/` inicial. Não há blocklist de 6432, `169.254.169.254`, `localhost:outra-porta`. Um usuário **autenticado** pode apontar conexão para serviço interno e usar as mensagens distinguíveis do `pg` (`ECONNREFUSED` vs timeout) para varrer a rede interna — SSRF de gravidade baixa (exige sessão, single-tenant, atrás da tailnet). A regra 6 existe só como comentário em `test-connection.ts`. Vale ao menos bloquear 6432 explicitamente na validação, já que a própria regra diz que é para nunca acontecer. Toca a §4/§8; deixado para a revisão do doc decidir se a blocklist entra na v0.1 ou vira item da v0.2.

**Vetores conferidos e fechados** (para não "consertarem" o que está certo): bypass do guard (barra dupla, trailing slash, `%2F`, maiúsculas — todos 401); timing de login (argon2id idêntico nos dois caminhos, medido); logout invalidando no servidor; vazamento de credencial em 422/`/connections`/erro de teste/`query_log` (nenhum ecoa senha); injeção de SQL nas queries do próprio DBee (identificadores citados e validados contra o catálogo, incluindo o `UNION ALL` novo do keyset); `executeDirect`/fallback de SAVEPOINT sempre dentro do `BEGIN READ ONLY`; crypto (AES-256-GCM, IV por registro, AAD por conexão, scrypt N=2¹⁷); `verify-full` para IP (SAN iPAddress, igualdade exata, falha fechada); senha do primeiro boot (~137 bits, amostragem sem viés).

2026-09-05 · **Criar database pelo sistema → v0.2 (modo escrita).** Pedido do autor; decidido deixar para a v0.2. `CREATE DATABASE` é DDL, não roda em transação, e fura o read-only por padrão que é o núcleo do DBee (regra 8, ADR 001). Entra junto do modo escrita da v0.2, tratado como a operação privilegiada que é — com indicador de perigo e opt-in, não como exceção solta na v0.1. A visão de databases (tamanho, tabelas, encoding) e a lista de processos (`pg_stat_activity`) foram aprovadas para agora por serem **só-leitura** — leem catálogo, não ferem o princípio.
