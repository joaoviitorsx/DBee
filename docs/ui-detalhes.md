# UI — detalhes, movimento e auxílios visuais

Data: 2026-11-17 · Status: **especificação (FASE 1)**, nada implementado ainda.
Base: `docs/design-system.md` §7 (tokens e utilitários), `docs/identidade.md`
(direção "Apicultor": TablePlus quieto + voz do Panic), `docs/auditoria-ui-ux.md`.

Regras que este doc não pode quebrar (e que cada fatia trava em teste):

- Duração só por token: `--motion-fast` 120 · `--motion-base` 180 ·
  `--motion-slow` 240 · `--motion-stagger` 30 · `--motion-tema` 420. Entrada
  `--ease-enter`, saída `--ease-exit` e sempre mais curta (`fast`).
- Só `transform` e `opacity`. Nunca `width`/`height`/`top`.
- `prefers-reduced-motion: reduce` zera movimento; **estado** continua visível
  (cor, ícone, texto). Movimento nunca é o único portador de significado.
- Regra 11: nenhuma linha do grid anima individualmente, nada de stagger em
  linha virtualizada, nenhum efeito por célula que rode a cada scroll.
- Regra 10: toda formatação é **só de exibição**; o valor bruto (string) segue
  para cópia, edição, filtro e export, e é acessível por `title`/inspetor.
- Âmbar sólido = modo escrita. Seleção, foco e progresso usam `accent`/`muted`.
- Item de árvore e de menu não escala (lê como tremor) — responde por tom.

---

## 1. Inventário (estado atual → lacuna)

Legenda: **M** movimento · **T** tatilidade (press/active) · **F** foco visível/teclado.

### 1.1 Primitivos (`components/ui`, `components/`)

| Elemento | Arquivo | Hoje | Lacuna |
|---|---|---|---|
| `Button` (primary/secondary/ghost/danger, `loading`) | `components/ui/Button.tsx` | M: `motion-fade` no spinner. T: `press`. F: ok | Hover só troca cor sem transição declarada em todas as variantes; `loading` troca ícone mas a largura pode variar entre rótulos; `disabled` sem distinção de cursor em todas as variantes. |
| `Input` | `components/ui/Input.tsx` | transição de borda | Foco usa anel; sem estado de erro animado (o `animate-refuse` só existe no ConnectionForm). |
| `Field` | `components/ui/Field.tsx` | erro `role=alert` estático | Erro aparece seco; sem `motion-fade`. |
| `Badge` | `components/ui/Badge.tsx` | estático | ok (não deve animar). |
| `Skeleton` | `components/ui/Skeleton.tsx` | shimmer com gradiente | Auditoria #10: trocar por pulso de opacidade; não usado no grid. |
| `ModalPainel` | `components/ui/ModalPainel.tsx` | `motion-overlay` + pop do `[role=dialog]` | Overlay `bg-black/60 backdrop-blur` (auditoria #5); rodapé sem estado de envio. |
| `ContextMenu` | `components/ContextMenu.tsx` | `motion-pop` na entrada, hover com cor | **Sem saída** (desmonta seco); sem origem do transform no ponto do clique; navegação por seta a conferir; sem submenu. |
| `FronteiraDeErro` | `components/FronteiraDeErro.tsx` | `role=alert`, sem M | Entrada seca; sem ação "copiar detalhes". |
| `Marca`/`Mark` | `components/` | assinatura (voo) | ok, fora do escopo — marca é do agente de identidade. |

### 1.2 Shell (`app/AppShell.tsx`)

| Elemento | Hoje | Lacuna |
|---|---|---|
| Árvore — gaveta em `<lg` | `translate-x` em `--motion-slow` | Véu sem fade; sem fechar por arrasto/Esc conferido. |
| Árvore — recolher em `≥lg` | não existe (só largura por `--w-arvore`) | Não dá para recolher a árvore no desktop. Ver F1.2. |
| Divisor de redimensionar | `hover:bg-amber/40` | **Âmbar fora de escrita** — trocar por `accent`/`line-strong`. Sem duplo-clique para resetar, sem teclado (`role=separator`, setas). |
| Inspetor (direita) | monta/desmonta seco (`visivel.inspectorOpen ? … : null`) | **Sem animação de entrada/saída**, apesar de `--motion-slow` estar reservado para ele no §7. |
| Botão do inspetor | `aria-pressed` | Ícone não muda entre aberto/fechado. |
| Troca de aba (conteúdo) | `motion-fade` com `key` | ok; perde scroll do grid ao voltar? (conferir — se o conteúdo é remontado, sim). |
| Barra de progresso global | `animate-progresso` 2 px, delay `fast` | ok. Falta progresso **determinado** onde há números (export, lote). |
| Estado vazio do miolo | mascote `float` em loop | Auditoria #4: loop proibido; trocar por atalhos `kbd`. |
| `Trabalhando` (lendo catálogo) | cronômetro | ok; conferir que só aparece após `fast`. |

### 1.3 Abas (`features/tabs/TabStrip.tsx`)

| Elemento | Hoje | Lacuna |
|---|---|---|
| Aba (abrir/ativar/fechar) | cor + borda superior; `press` no rótulo e no X | Aba nova entra seca; fechar desmonta seco e as vizinhas saltam; sem indicador deslizante; sem fade de overflow nas bordas quando há rolagem horizontal; sem "aba suja" (consulta não salva). Middle-click para fechar a conferir. |
| `+` nova consulta | cor no hover | Sem `press`. |
| Sub-abas Dados/Estrutura/Índices/Diagrama | `border-b-2` muda de cor | Indicador **pula** em vez de deslizar; sem setas ←/→ (padrão `tablist`). |

### 1.4 Árvore (`features/tree/ConnectionTree.tsx`, `treeMenu.tsx`)

| Elemento | Hoje | Lacuna |
|---|---|---|
| Expandir/recolher | chevron gira (`fast`), filhos `motion-fade` | Recolher é seco; filhos não têm deslocamento de 2–4 px que dê direção. |
| Carregar filhos | `Skeleton` (2–3 linhas) + `Loader2` spin | Spinner + esqueleto juntos é redundante; spinner aparece mesmo em respostas < 120 ms. |
| Selecionar | cor de fundo | Sem barra lateral de "ativo" que sincronize com a aba ativa; abrir a aba não rola a árvore até o nó. |
| Ações no hover (`opacity-0 → 1`) | ok | Não aparecem com foco de teclado (`group-focus-within`). |
| Busca | `Input` | Sem destaque do trecho casado; sem contagem; Esc não limpa (conferir). |
| Saúde da conexão | ponto vazado ~5 px | Auditoria #8. |
| Menu de contexto | `ContextMenu` | ver 1.1. |
| Navegação por teclado | parcial | Sem modelo `tree` (↑↓ move, → expande, ← recolhe/sobe). |

### 1.5 Aba Dados (`features/tabs/DataTab.tsx`) e grid (`features/grid/ResultGrid.tsx`)

| Elemento | Hoje | Lacuna |
|---|---|---|
| Toolbar: Consultar, Nova linha, Exportar | `Button` com `press` | Ok; Exportar abre popover com `shadow-lg` (auditoria #11) e sem saída animada. |
| Chips de filtro | lista; remover por X | Chip entra/sai seco; sem `press` no X. |
| Cabeçalho | nome + `dataTypeName` mono; seta só na ordenada; redimensionar (alça `hover:bg-accent/40`) | Sem ícone de PK/FK/NOT NULL; seta aparece seca; sem duplo-clique na alça para autoajustar; sem menu da coluna. |
| Linha: hover | não há hover de linha | Falta guia de leitura horizontal (linha de 26 px, 20+ colunas). |
| Seleção | faixa `bg-amber/12` | **Âmbar na seleção** contraria "âmbar = escrita" (o comentário diz "tinta fraca", mas é âmbar). Trocar por `accent`. Falta realce de linha/coluna da célula focada. |
| Célula: NULL/vazio | itálico `muted`, rótulo i18n | ok (§11.14). |
| Célula: números | `text-right tabular-nums` para tipos numéricos | ok. |
| Célula: booleano, data, JSON, enum, uuid, bytea | texto cru, `truncate`, `title` | Ver §3 (auxílios). |
| Célula: FK | botão de salto no hover | ok; sem tooltip com a tabela de destino. |
| Edição inline | `input` sobre a célula, Enter/Esc | Sem marca de "célula editada pendente"; `animate-salvo` após gravar ok. |
| Rolagem | virtualizada, `overscan: 12` | Sem sombra no cabeçalho quando rolado; sem coluna fixa. |
| Carregar mais | `isFetchingNextPage` + `onEndReached` | Sem rodapé "N de ~M linhas · carregando lote k"; sem indicador de fim ("todas as linhas"). |
| Primeira carga | `Trabalhando`/vazio | Sem esqueleto com a forma do grid. |

### 1.6 Editor SQL (`features/query/SqlEditor.tsx`, `QueryTabContent.tsx`)

| Elemento | Hoje | Lacuna |
|---|---|---|
| Executar | botão + `Trabalhando` com cronômetro | Sem feedback no próprio botão (Ctrl+Enter não "aperta" o botão visualmente); sem cancelar visível perto do cronômetro (conferir). |
| Resultado | `motion-fade` da área | Mascote `pop` a cada sucesso (auditoria #6). Rodapé de métrica sem transição de número. |
| Erro com `position` | painel com linha:coluna calculada | **Sem marcador no editor** (sublinhado ondulado/gutter na posição); clicar no "linha:coluna" não leva o cursor lá (conferir). |
| Abas de resultado múltiplas | toggle com cor | Indicador pula. |
| Consultas salvas | `SavedQueriesModal` | ok via ModalPainel; lista sem busca destacada. |

### 1.7 Diálogos e painéis

Onze diálogos com overlay copiado (`RowEditModal`, `InsertModal`,
`MongoDocModal`, `RedisValueModal`, `CreateTableDialog`, `CreateDatabaseDialog`,
`ConnectionForm`, `UsuariosDialog`, `TokensDialog`, `VpnBotao`, `UpdateDialog`).
Conteúdo já anima por `[role=dialog][data-state]`. Lacunas: overlay `bg-black`
+ blur; erro de envio entra seco (só o ConnectionForm usa `animate-refuse`);
botão de confirmar sem estado `loading` em todos; foco inicial nem sempre no
primeiro campo; diálogo de confirmação destrutiva (DROP/DELETE) sem atraso de
armar.

### 1.8 Estados transversais

| Estado | Hoje | Lacuna |
|---|---|---|
| Toasts | **não existem** (sem `sonner` ou equivalente) | Confirmações (copiado, salvo, exportado) não têm canal; hoje viram texto inline ou nada. |
| Copiar (Ctrl+C no grid) | `motion-troca` em botões de copiar | No grid, Ctrl+C não dá retorno visível. |
| Sessão expirada (401) | `AuthGate` volta ao login | Perde contexto sem aviso; sem "sua sessão expirou, entre de novo" com retorno às abas. |
| Erro de rede/servidor fora | `AuthGate` tela própria | ok; entrada seca. |
| Tema | revelação circular (View Transitions) + `motion-troca` | ok. |
| Idioma | troca instantânea | ok (não deve animar; texto muda de largura). |
| Atualização disponível | `UpdateBadge` | conferir que o selo não pulsa em loop. |
| Overview (Databases/Atividade/Auditoria) | `Trabalhando`; "carregar mais" com `loading` | Tabelas da overview não reaproveitam auxílios do grid. |

---

## 2. Referências

Links citados de memória (sem fetch nesta sessão); conferir antes de citar em
ADR. Nada aqui é para copiar visual — é para calibrar duração, intenção e o que
um produto sério **não** anima.

**Motion e microinteração**
- Linear — redesenho da UI e o porquê da contenção: https://linear.app/now/how-we-redesigned-the-linear-ui
- Raycast — a referência de teclado-primeiro e listas que respondem sem atraso: https://www.raycast.com/
- Arc (The Browser Company) — sidebar recolhível com peek no hover: https://arc.net/
- TablePlus — grid quieto, cor de ambiente por conexão, edição pendente destacada antes do commit: https://tableplus.com/ e https://docs.tableplus.com/
- Vercel Geist — escala de duração e componentes de produto: https://vercel.com/geist/introduction
- Radix — animação de entrada/saída com `data-state` e `forceMount`: https://www.radix-ui.com/primitives/docs/guides/animation
- shadcn/ui — Data Table e Sonner (toast): https://ui.shadcn.com/docs/components/data-table · https://ui.shadcn.com/docs/components/sonner
- Material 3 — easing e duração (curta para pequeno, saída mais rápida que entrada): https://m3.material.io/styles/motion/easing-and-duration
- Apple HIG — Motion (movimento com propósito, respeitar Reduce Motion): https://developer.apple.com/design/human-interface-guidelines/motion
- MDN — `prefers-reduced-motion` e View Transitions: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion · https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- Emil Kowalski — "great animations" (frequência alta = animação curta ou nenhuma): https://emilkowal.ski/ui/great-animations
- NN/g — indicadores de progresso (determinado > indeterminado acima de ~10 s): https://www.nngroup.com/articles/progress-indicators/

**Grids de dados**
- AG Grid — pinning, autoajuste de coluna por duplo-clique, renderers por tipo: https://www.ag-grid.com/javascript-data-grid/column-pinning/
- TanStack Virtual (o virtualizador usado aqui) — sticky e range customizado sem quebrar a virtualização: https://tanstack.com/virtual/latest
- DataGrip — ícones de PK/FK no cabeçalho, NULL distinto, editor de valor: https://www.jetbrains.com/help/datagrip/table-editor.html
- Supabase Table Editor — ícones de tipo e chave no cabeçalho, chips de enum, JSON em painel: https://supabase.com/docs/guides/database/tables
- Glide Data Grid — tipos de célula (boolean, bubble/chip, URI) desenhados por tipo: https://github.com/glideapps/glide-data-grid

---

## 3. Especificação por elemento

Formato: **gatilho → propriedade · duração/curva · reduced-motion · teclado/foco · estados**.

### 3.1 Primitivos

- **Button.** hover → `background-color`/`color` · `fast`/`enter`. active →
  `press` (0,97). disabled → `opacity-50 cursor-not-allowed`, sem press.
  loading → rótulo fica `invisible` (largura preservada), spinner `motion-fade`
  só após `fast` (evita piscar em resposta rápida), `aria-busy`. Foco:
  `ring-1 ring-line-strong` com `ring-offset` no fundo. Reduced: sem escala.
- **Input/Field.** erro aparece → `motion-fade` + `animate-refuse` uma vez
  (já existe), `aria-invalid`, `aria-describedby`. Foco: borda `line-strong`,
  nunca âmbar (auditoria #1).
- **Overlay de diálogo.** `bg-sunken/80`, sem blur, `motion-overlay`
  (já existe). Um `components/ui/Dialog.tsx` único substitui as 11 cópias.
- **Conteúdo de diálogo.** já: sobe 4 px + 0,97 → 1 em `base`, sai em `fast`.
  Acrescentar: foco inicial no primeiro campo; Esc fecha; botão de confirmar
  com `loading`; erro de envio com `animate-refuse`.
- **Confirmação destrutiva (DROP/TRUNCATE/DELETE em massa).** botão `danger`
  desabilitado por `base`×2 (360 ms) após abrir — "armar" — com o rótulo
  sempre legível. Evita Enter reflexo. Reduced: o atraso continua (é segurança,
  não decoração).
- **ContextMenu.** entrada `motion-pop` com `transform-origin` no ponto do
  clique (canto mais próximo); **saída** `dbee-pop-out` em `fast` antes de
  desmontar. Item: hover/foco `bg-raised`, active `bg-overlay`, sem escala.
  Teclado: ↑↓ (com wrap), Home/End, Enter, Esc devolve foco ao gatilho,
  type-ahead pela inicial. Atalho à direita em `kbd text-subtle`.
- **Tooltip** (novo, Radix Tooltip): atraso de abertura 500 ms, aberto entre
  vizinhos sem atraso (`skipDelayDuration`), fade `fast`. Usado para valor bruto,
  ícones sem rótulo e atalhos.
- **Toast** (novo, shadcn Sonner — dependência leve, conferir com o autor):
  canto inferior direito, entra subindo 8 px + fade em `base`, sai em `fast`,
  4 s, pausa no hover, `role=status`. Só para **confirmação de ação fora do
  campo de visão** (copiado N células, export pronto, consulta salva). Erro de
  banco nunca vai para toast — fica no lugar, com `position`.

### 3.2 Shell

- **Inspetor (direita).** abrir → `translate-x(100%→0)` + `opacity` em `slow`/
  `enter`; fechar em `fast`/`exit`. Implementação: manter montado durante a
  saída (`data-state` + `onAnimationEnd`, mesmo padrão do Radix) e o miolo
  reflui **uma vez** no fim (não animar `width`). Em `<lg` vira gaveta sobre o
  conteúdo com véu `motion-overlay`. Ícone do botão alterna
  `PanelRight`/`PanelRightClose` por `motion-troca`. Atalho `Ctrl+I`. Foco vai
  para o título do inspetor ao abrir e volta ao botão ao fechar.
  Troca de coluna inspecionada com o inspetor aberto → crossfade `motion-fade`
  do corpo, sem deslizar o painel.
- **Árvore (esquerda).** `≥lg`: recolher para um trilho de 44 px com os ícones
  de conexão (`Ctrl+B`), conteúdo `translate-x` + fade em `slow`, largura troca
  uma vez. Hover no trilho por 300 ms abre "peek" sobreposto (padrão Arc), sem
  refluir o miolo. `<lg`: gaveta atual + véu com fade + Esc fecha.
- **Divisores.** `role=separator aria-orientation=vertical`, focáveis; ←/→ 16
  px, Shift ×4; duplo-clique restaura o padrão; hover/drag `bg-accent/40`
  (não âmbar). Cursor `col-resize` em todo o corpo durante o arrasto.
- **Troca de aba (miolo).** já `motion-fade`. Acrescentar: preservar o
  `scrollTop`/`scrollLeft` do grid e a seleção por aba (o estado mora fora do
  componente remontado). Sem slide lateral — abas não têm ordem espacial que o
  usuário memorize.

### 3.3 Abas

- **TabStrip.** aba nova → `motion-pop` (`fast`) só na aba criada; fechar →
  fade `fast`, as vizinhas ocupam o espaço sem animar largura (aceitável:
  troca de layout uma vez). Indicador de ativa: barra de 2 px no topo que
  **desliza** entre abas por `transform: translateX/scaleX` medido (um
  elemento só, não um por aba), `base`/`enter`; reduced → salta. Overflow
  horizontal: máscara de fade de 16 px nas bordas que aparece só quando há
  conteúdo escondido; aba ativa rola para a vista (`scrollIntoView({block:
  "nearest"})`). Aba de consulta com SQL não salvo: ponto `text-subtle` no lugar
  do X até o hover (padrão de editor). Middle-click fecha. `Ctrl+W`,
  `Ctrl+Tab`/`Ctrl+Shift+Tab`. Aba em modo escrita mantém a borda âmbar (já é
  semântica).
- **Sub-abas (Dados/Estrutura/Índices/Diagrama).** mesmo indicador deslizante,
  `role=tablist`, ←/→ movem, Home/End, ativação automática.

### 3.4 Árvore e menus

- **Expandir.** chevron 0→90° em `fast` (já). Filhos: `opacity` 0→1 +
  `translateY(-2px→0)` em `base`; **sem stagger** (listas de 500 tabelas).
  Recolher: fade `fast`, depois desmonta.
- **Carregar filhos.** só esqueleto, sem spinner; esqueleto aparece após
  `fast` (resposta rápida não pisca). Erro de carga: linha `text-danger` com
  "tentar de novo".
- **Selecionado/ativo.** barra de 2 px `accent` à esquerda da linha cuja tabela
  é a aba ativa; abrir uma aba rola a árvore até o nó (`nearest`).
- **Ações no hover.** também em `group-focus-within`.
- **Teclado (`role=tree`).** ↑↓, →/← expandir/recolher/subir, Enter abre,
  Shift+F10/tecla Menu abre o menu de contexto, type-ahead.
- **Busca.** trecho casado em `font-semibold text-ink` (sem fundo amarelo),
  contagem "12 de 340" `text-2xs text-subtle`, Esc limpa e devolve foco, `/`
  foca a busca. Sem animação nos resultados (lista muda a cada tecla).
- **Saúde.** ponto `size-2` cheio `ok`/contorno/`danger` com `aria-label`
  (auditoria #8). Mudança de estado: crossfade de cor em `base`, sem pulso
  (o único pulso permitido é o da VPN conectada).

**Feito (F4, 2026-11-17).** Tudo acima, com estes desvios:
- Barra do ativo em `info`, não `accent`: âmbar é só modo escrita; em conexão
  com escrita a barra é âmbar. 2 px (era 3).
- Contagem "n de total" fica na linha de cada database, não no campo: cada
  catálogo chega numa requisição própria e o total global seria parcial.
- Saúde: ponto único `size-2` com crossfade; `error` é quadrado cheio
  `danger` (forma diferente do `ok` para daltonismo), `conectando` é contorno
  `info` (o `Loader2` saiu — carga é dita pelo esqueleto).
- Teclado: tabindex móvel (só o item corrente entra no Tab); Enter/Espaço são
  o clique nativo do `<button role=treeitem>`. Lógica pura em
  `features/tree/teclado.puro.ts`; destaque em `destaque.puro.ts`.
- Menu: `MenuItem.atalho` em `<kbd>` à direita ("Abrir · Enter"); submenu não
  foi necessário.
- Busca global (F8) em `features/busca/PaletaBusca.tsx`, montada no shell.

### 3.5 Grid e aba Dados

Movimento no grid é **zero** por padrão. O que muda é tom e ícone, aplicado na
célula renderizada, custo O(1) por célula visível.

- **Hover de linha.** `bg-raised/60` na linha inteira via CSS (`:hover` no
  container da linha virtual), sem transição (transição + scroll rápido = rastro).
- **Seleção.** faixa `bg-accent/12` (sai do âmbar); célula foco com contorno
  `ring-1 ring-inset ring-accent`; cabeçalho da coluna e número da linha da
  célula foco ganham `text-ink` (realce de cruz, sem pintar a coluna toda).
- **Sombra de cabeçalho ao rolar.** `box-shadow` de 1 px `line-strong` só
  quando `scrollTop > 0` (atributo no container, não estado React por scroll).
- **Seta de ordenação.** aparece com `motion-pop` (`fast`); inverter gira 180°
  em `fast`.
- **Edição inline.** célula com valor alterado e ainda não gravado: canto
  superior direito com triângulo de 4 px `amber` (é escrita pendente — âmbar
  correto) e `title` "valor original: …". Gravou → `animate-salvo` (já).
  Falhou → `animate-refuse` na célula + erro do Postgres inline.
- **Ctrl+C.** a faixa copiada pisca uma vez (`opacity` 1→0,6→1 em `base`) e
  toast "N células copiadas" (o grid não pode mostrar isso em lugar nenhum
  sem ruído).
- **Carregar mais.** ver F3.
- **Chips de filtro.** entram com `motion-pop`, saem com fade `fast`; X com
  `press`; Backspace no campo vazio remove o último.
- **Exportar (popover).** sombra do token do diálogo; saída `fast`; progresso
  determinado (bytes/linhas) quando o servidor informa.

### 3.6 Editor SQL

- **Executar.** `Ctrl+Enter` dispara o mesmo `press` visual no botão (classe
  `data-pressed` por 120 ms) — o teclado também "aperta". Durante a execução
  o botão vira "Cancelar" (mesmo lugar, `motion-troca`), cronômetro ao lado
  após `fast`.
- **Resultado.** área entra com `motion-fade`; rodapé
  "N linhas · 123 ms · somente leitura" em mono, sem mascote (auditoria #6).
  Número de linhas troca sem contagem animada (contagem animada é tique).
- **Erro com `position`.** sublinhado ondulado `danger` no token do erro
  (decoração do CodeMirror/Monaco em uso), marcador no gutter, e o rótulo
  "linha 3, coluna 14" do painel é botão que põe o cursor lá e rola. O painel
  de erro entra com `animate-refuse` uma vez. Código SQLSTATE em `kbd` com
  tooltip do nome do erro.
- **Abas de resultado.** indicador deslizante (3.3).

**Estado (F5, 2026-11-17): feito**, com desvios: (1) a troca
Executar↔Cancelar usa opacidade+escala na mesma célula do grid, sem o giro do
`motion-troca` (girar botão com texto desmonta a leitura); (2) o cronômetro
fica no corpo do painel (`Trabalhando`), não ao lado do botão; (3) o
sublinhado só aparece quando o trecho executado ainda está onde estava e sem
variáveis de snippet (com `$n` as posições não batem com o texto do editor) —
nesses casos o rótulo vira texto, não botão; (4) o sublinhado acompanha
edições (campo mapeado) e some com o token. O mascote do rodapé já tinha
saído; o rodapé agora é "N linhas · ms · modo" em mono. Seleção do editor,
statement ativo e item do autocomplete passaram de âmbar para `info`/neutro;
o realce de palavra-chave em âmbar ficou (identidade, decidir à parte).

### 3.7 Estados vazios, carregando, erro

> **Estado (FASE 2, F3/F7b):** feito na aba Dados — regra 120 ms/1 s
> (`grid/carregamento.puro.ts`, `EsqueletoGrid`), rodapé de lote, PK fixa
> (só quando a PK é a 1ª coluna), filtro com operadores, canto âmbar de
> pendente, piscar do Ctrl+C (Web Animations, respeita reduced-motion).
> **Desvios:** a barra do lote e o progresso do export ficam indeterminado /
> em bytes — a rota de linhas não informa progresso dentro do lote e o export
> não manda total (pendência de servidor: `Content-Length` ou total de linhas).
> Tooltip segue `title` nativo (sem dependência nova).

- **Vazio do miolo.** sem mascote em loop; título único + 3 atalhos em `kbd`
  (Nova consulta, Buscar na árvore, Abrir última aba). Entra com `motion-fade`.
- **Tabela vazia.** "Nenhuma linha" + se há filtro ativo, "Nenhuma linha com
  estes filtros · limpar filtros" (botão). Distinguir "tabela vazia" de
  "filtro sem resultado" é a informação útil.
- **Carregando.** regra única: < 120 ms nada; 120 ms–1 s esqueleto com a forma
  final; > 1 s `Trabalhando` com cronômetro (já existe nas consultas).
- **Erro.** no lugar do conteúdo, `code` + `message` + ação; `FronteiraDeErro`
  com "copiar detalhes" (sem credencial — revisar o que entra no texto).
- **Sessão expirada.** interceptar 401 em consulta já autenticada: modal
  "Sua sessão expirou" com o formulário de login **por cima** das abas, que
  continuam montadas; ao entrar, a ação repete. Nada de toast.

**Status F6/F8 (2026-11-17):**

- Feito: vazio do miolo (sem mascote, título único, `kbd` Ctrl+T/K/B; o
  "Abrir última aba" da spec virou "Ctrl+B árvore", porque com abas
  persistidas a última aba já volta sozinha). Ctrl+T sem aba ativa abre na
  primeira conexão **em leitura**.
- Feito: sessão expirada (`AuthGate` + `SessaoExpirada`): modal por cima, abas
  montadas, consultas repetem via `invalidateQueries` do login. Desvio:
  **mutação** que toma 401 não repete sozinha — o `QueryCache` revalida a
  sessão, o `MutationCache` não (em `lib/query.ts`, fora desta fatia).
- Feito: `FronteiraDeErro` com `motion-fade` e texto filtrado por
  `features/estados/detalhes.puro.ts` (URI com senha, `password=`, token,
  Bearer, cookie de sessão; sem hash/search da URL).
- Feito como componente, **não ligado**: `ConfirmacaoArmada` (360 ms) e
  `TabelaVazia` em `features/estados/`. Ligar nos diálogos de DROP/TRUNCATE
  (`features/ddl`) e no `DataTab` (que já tem a sua versão de "limpar filtros").
- F8: abas persistidas por usuário em `localStorage` (`workspace.ts`:
  `serializarWorkspace`/`restaurarWorkspace`, validação aba a aba). O texto
  digitado no editor só persiste quando `QueryTabContent` chamar
  `setQuerySql` — pendente na fatia do editor.
- F8: links (ADR 020) em `features/links`, "Copiar link" no menu da aba de
  tabela; comparar dados/schema (ADR 018) em `features/comparar`, aba própria
  `compare`. Seleção A/B por texto (database/schema/tabela), não por árvore.

---

## 4. Auxílios visuais — prioridade

Cada item: **uso diário** · **virtualização (regra 11)** · **regra 10**.
"Detecção por tipo" usa `dataTypeName` da coluna (já chega do servidor), nunca
o conteúdo — exceto onde dito.

| # | Auxílio | Uso diário | Regra 11 | Regra 10 |
|---|---|---|---|---|
| 1 | **Ícone de chave no cabeçalho** (PK `KeyRound`, FK `Link2` com tooltip "→ schema.tabela", NOT NULL como `•` subscrito) | Saber o que é chave sem abrir Estrutura; FK já tem salto, falta anunciar | Só cabeçalho; zero custo por linha | n/a |
| 2 | **Boolean como glifo** (`true` → check `text-ok`, `false` → traço `text-subtle`, NULL segue NULL) | `t`/`f` em mono é o pior caso de leitura de grid | Render condicional na célula visível; O(1) | Exibição; cópia/edição/`title` usam `t`/`f` cru |
| 3 | **Datas legíveis** (`timestamp[tz]`, `date`): data em `ink`, hora em `muted`, frações de segundo e fuso escondidos; tooltip com o bruto | O exemplo do pedido: "2026-11-17 17:56:00.842…" truncado esconde a hora | Formatação por regex sobre a string — **sem `Date`** (fuso do navegador mentiria) | Bruto no `title`, cópia, edição |
| 4 | **Seleção fora do âmbar + realce de cruz** | Âmbar na seleção hoje gasta o sinal de escrita | CSS por célula já renderizada | n/a |
| 5 | **Hover de linha** | Guia horizontal em tabela larga | Uma regra CSS | n/a |
| 6 | **Rodapé de lote** "1.000 linhas carregadas · mais ao rolar" / "todas as 1.342 linhas" + barra fina determinada durante o fetch do lote | Hoje não se sabe se acabou | Fora da lista virtual | n/a |
| 7 | **Duplo-clique na alça = autoajuste** (mede só as linhas renderizadas + cabeçalho, teto 480 px) | Coluna cortada é a reclamação nº 1 | Mede o que está no DOM; nunca o dataset | n/a |
| 8 | **Coluna fixa (PK pinned)** `sticky left-0` com sombra ao rolar horizontal | Não perder a linha em tabela de 40 colunas | `position: sticky` dentro da linha virtual; testar com TanStack | n/a |
| 9 | **JSON/JSONB**: célula mostra `{…} 4 chaves` / `[…] 12 itens` em `muted` + primeiras chaves; clique abre no inspetor formatado | JSON truncado numa linha é ilegível | Contagem calculada **só na célula visível**, com cache por `(linha,coluna)` e teto de 64 KB (acima: só `{…}`) | Inspetor mostra o bruto; cópia é o bruto |
| 10 | **Enum/status como chip** (tipo enum do catálogo): pílula `border-line` neutra, **sem cor por valor** (cor por valor compete com estado e âmbar — lição da fatia de layout) | Leitura rápida de status | O(1) | Texto do chip = valor exato |
| 11 | **UUID/hash encurtado** `3f2a…9c1e` em mono, tooltip completo | Colunas de 36 chars comem a tela | O(1) | Bruto em cópia/edição |
| 12 | **Ícone de tipo no cabeçalho** (`#` número, `Aa` texto, calendário, `{}` json, `⊘` bytea) substitui a segunda linha `dataTypeName` só em telas `<lg`; em `≥lg` mantém o nome do tipo | Densidade em 768 | Cabeçalho | n/a |
| 13 | **Estatística rápida da coluna** (menu da coluna → "Resumo": nulos, distintos, min/max) | Pergunta frequente antes de filtrar | **Consulta ao servidor** (`count`, `count(distinct)` sob `BEGIN READ ONLY`), nunca varrer o array em memória | Números retornam como string |
| 14 | **Zebra opcional** (preferência, padrão desligado) | Alguns preferem | CSS `nth-child` não funciona com virtualização — usar `index % 2` na linha virtual | n/a |
| 15 | **Bytea/texto longo**: `⊘ 12 KB` / contagem de caracteres em vez do dump | Evita célula com lixo binário | O(1) | Inspetor/“copiar como hex” |

**Árvore:** contagem estimada de linhas (`reltuples`) em `text-2xs text-subtle`
à direita do nome da tabela (só se já vier no catálogo); ícone distinto para
view/matview/tabela particionada; tabela sem PK com o aviso do §5.4c na própria
linha (ícone `muted` + tooltip).

**Editor:** marcador de erro na posição (3.6); "executando a seleção" quando
há texto selecionado (rótulo do botão muda para "Executar seleção").

Recusados: heatmap/barras de valor dentro da célula (decoração, custo por
célula), ícones coloridos por valor de enum, avatares por coluna "user",
contagens animadas, confete/mascote em sucesso.

---

## 5. Fatias implementáveis (FASE 2)

Cada fatia: testes (incl. `motion.test.ts` para tokens novos e testes puros de
formatação em `*.puro.ts`), screenshots 375/768/1024/1440 em dark e light com
estado real, GIF desacelerado (4×) do movimento, CHANGELOG, e atualização de
`design-system.md` §7 (tabela de utilitários).

| Fatia | Conteúdo | Arquivos principais | Risco |
|---|---|---|---|
| **F0 base** | `components/ui/Dialog.tsx` (overlay único, sem blur), `Tooltip`, saída do `ContextMenu`, decisão sobre toast (Sonner — perguntar) | `components/ui/*`, 11 diálogos | baixo; toca muitos arquivos |
| **F1 shell** | Inspetor com entrada/saída e `Ctrl+I`; árvore recolhível em `≥lg` com trilho e peek; divisores acessíveis e sem âmbar; indicador deslizante em TabStrip e sub-abas; fade de overflow; preservar scroll por aba | `AppShell.tsx` (extrair `Inspetor`/`Divisor`, arquivo já > 1000 linhas), `TabStrip.tsx` | médio (layout) |
| **F2 grid** | Auxílios 1–5, 7, 9–12, 15; seleção em `accent`; sombra do cabeçalho; seta animada; célula pendente; formatadores puros em `packages/shared` ou `features/grid/formatar.puro.ts` | `ResultGrid.tsx` (extrair `Celula.tsx`), novo `.puro.ts` | médio; perf: medir FPS rolando 100k linhas antes/depois |
| **F3 carregamento** | Regra 120 ms/1 s única; esqueleto do grid; rodapé de lote (6); progresso determinado no export; coluna fixa (8) | `DataTab.tsx`, `Skeleton.tsx`, `ExportButton.tsx` | baixo |
| **F4 árvore/menus** | Modelo `role=tree` por teclado; filhos com direção; barra de ativo + scroll até o nó; busca com destaque e contagem; saúde da conexão; extras da árvore; menu com origem, type-ahead | `ConnectionTree.tsx`, `treeMenu.tsx`, `ContextMenu.tsx` | médio (teclado) |
| **F5 editor** | Marcador de erro na posição + ir até; press visual no Ctrl+Enter; Executar↔Cancelar; "Executar seleção"; remover mascote do rodapé | `SqlEditor.tsx`, `QueryTabContent.tsx` | baixo |
| **F7 visualizadores** | §6: núcleo `JsonArvore` (achatamento puro + virtual + teclado + busca + caminho), popover⇄painel no inspetor, renderizadores de §6.2, ver como registro, comparar linhas, estatística da coluna (UI da rota aprovada), menu de cópia; Mongo/Redis passam a usar o núcleo | novo `features/visualizador/`, `celula.puro.ts`, `Inspector.tsx`, `MongoDocModal.tsx`, `RedisValueModal.tsx` | médio; perf de parse com teto de tamanho |
| **F6 estados** | Vazio do miolo com atalhos; tabela vazia vs filtro vazio; sessão expirada sem perder abas; `FronteiraDeErro` copiar detalhes (revisão de segurança: nada de credencial); confirmação destrutiva armada; estatística de coluna (13) se o autor aprovar rota nova | `AppShell.tsx`, `AuthGate.tsx`, `App.tsx`, `FronteiraDeErro.tsx` | médio (401 e rota nova tocam segurança) |

Ordem: F0 → F1 → F2 → F7 → F3 → F5 → F4 → F6. F7 vem logo após F2 porque
depende do inspetor animado (F1) e dos renderizadores puros (F2), e é o pedido
prioritário do autor. A F2 passa a conter só os renderizadores inline; os
popovers/painéis de tipo ficam na F7.

Decisões do autor (2026-11-17): Sonner aprovado; estatística de coluna
incluída (rota em implementação no backend); zebra = preferência por pessoa no
navegador, desligada por padrão.

Ainda aberto: (a) clique simples vs ícone/duplo-clique para abrir o
visualizador (§6.1); (b) "copiar como INSERT" gerado no servidor ou fora do
escopo — o front não monta SQL por concatenação.

---

## 6. Visualizadores de célula

Pedido direto do autor. Um princípio governa tudo: **o visualizador é um
overlay único por grid**, montado fora da lista virtual e posicionado pela
célula foco (`{linha, coluna}` + `getBoundingClientRect` no momento de abrir).
Nenhuma linha ganha componente, estado ou listener a mais (regra 11). O que ele
recebe é a string bruta da célula; tudo que mostra é derivado dela, e tudo que
copia por padrão é ela (regra 10).

### 6.1 JSON / jsonb (prioridade)

**Decisão: popover ancorado que "expande" para painel lateral** — um
componente, dois tamanhos.

- **Popover** (padrão quando o texto bruto ≤ 2 KB **e** ≤ 40 nós): ancorado
  na célula, `max-w-[480px] max-h-[360px]`, Radix Popover. Responde à
  pergunta mais comum — "o que tem aqui dentro?" — sem tirar o olho da linha.
  Entrada `motion-pop` com `transform-origin` no lado da célula (`fast`),
  saída `fast`/`exit`.
- **Painel** (JSON maior, ou botão "Expandir" / `Shift+Enter` no popover):
  ocupa a zona do **Inspetor** (direita), com a mesma animação do inspetor
  (§3.2: `translate-x` + fade em `slow`). Por que o inspetor e não um modal:
  o modal esconde o grid e o usuário perde a comparação com as linhas
  vizinhas; o painel deixa navegar célula a célula (↑↓ no grid atualiza o
  painel por crossfade `motion-fade`, sem reabrir). Popover → painel: o
  popover sai em `fast` e o painel entra; não há morph de geometria (seria
  animar `width/height`).
- Abaixo de `lg` sempre painel (gaveta inferior de 70vh, `translateY`), porque
  popover ancorado em 375 px cobre a própria célula.
- Reduced-motion: aparece e some sem deslocamento; o crossfade vira troca.

**Gatilhos.** Clique simples na célula json/jsonb **não** abre (clique é
seleção; abrir a cada clique viraria ruído ao arrastar faixa). Abre por:
duplo-clique (nas colunas json de tabela **não editável** e em resultado de
consulta; em tabela editável o duplo-clique continua sendo edição — o visualizador
tem botão "Editar" que passa para o editor), `Enter`/`Espaço` com a célula em
foco, ou o ícone `{…}` que aparece no hover da célula (mesmo padrão do salto
de FK). `Esc` fecha e devolve o foco à célula.

> Divergência intencional do pedido ("clicar abre"): o clique simples já
> ancora a seleção e o Shift+clique estende a faixa (§5.4b-2). O ícone no hover
> é o "clique" de um gesto só. Se o autor preferir clique simples, fica
> restrito a resultado não editável.

**Conteúdo.**
- **Árvore** (padrão): cada nó numa linha de 22 px, indentação 12 px por
  nível com guia vertical `line`; chave em `text-ink`, string em
  `--syn-string`, número em `--syn-number` com `tabular-nums`, `true/false`
  em `--syn-keyword`, `null` em itálico `muted` (mesma leitura do NULL do
  grid). Tokens `--syn-*` novos no tema, dark e light, com contraste
  travado em teste (§1.5) — e nenhum é âmbar.
- Objeto/array recolhível: chevron (`fast`, como a árvore de conexões),
  rótulo `{ 4 }` / `[ 12 ]` em `subtle` quando recolhido. Abre expandido até o
  nível 2; nível 3+ recolhido. `*` expande tudo do nó, `-` recolhe.
- **Texto bruto**: alternância `Árvore ⇄ Bruto` (segmented, `Ctrl+Shift+B`).
  Bruto é **exatamente a string recebida**, em mono, com quebra suave e
  números de linha. Para `jsonb` o Postgres já normalizou; o rótulo diz
  "como o banco devolveu".
- **Busca** (`Ctrl+F` dentro do visualizador): casa chave e valor, destaca com
  `font-semibold text-ink` + fundo `accent/12`, expande os ancestrais dos
  achados, "3 de 17" com Enter/Shift+Enter.
- **Copiar**: no nó em foco, `C` copia o **valor** (escalar como texto; objeto
  como fatia do bruto original quando localizável, senão `JSON.stringify` e o
  toast diz "reformatado"); `Shift+C` copia o **caminho** (`preferencias.tags[0]`;
  chave não identificador vira `["chave com espaço"]`); botão "Copiar JSON"
  copia **o bruto original**, nunca o reformatado. Cada cópia → toast Sonner.
- **Virtualização**: a árvore é achatada em lista de nós visíveis (pura,
  `json-arvore.puro.ts`) e renderizada com o mesmo TanStack Virtual quando
  passa de 200 nós. Parse com teto: acima de 5 MB não parseia — mostra só o
  bruto com aviso, para não travar a aba.
- **Teclado** (`role=tree`): ↑↓ move, →/← expande/recolhe/sobe, Home/End,
  Enter alterna, type-ahead pela chave, Tab sai para a barra (busca, modo,
  copiar, expandir).
- **Erro de parse** (json inválido em coluna `text`): não existe para
  json/jsonb (o banco valida). Para `text` que "parece JSON", o ícone só
  aparece se `JSON.parse` der certo na célula **focada** (nunca varrer coluna).

**Mongo e Redis.** `MongoDocModal` e `RedisValueModal` são editores (escrevem
por caminho/membro), não visualizadores. Unificar inteiro misturaria leitura e
escrita num componente, e o modo escrita tem regras próprias (âmbar, `BEGIN
READ WRITE`/confirmação). Proposta: extrair o **núcleo** — `JsonArvore`
(achatamento puro + render virtual + teclado + busca + cópia de caminho) — e
usá-lo nos três: visualizador (leitura), e como corpo navegável dos dois
modais de edição, que mantêm seus formulários de escrita. Os caminhos do Mongo
usam notação pontuada (`enderecos.0.cep`); o núcleo recebe um formatador de
caminho por engine.

### 6.2 Outros tipos

Todos: formatação por função pura sobre a **string** (`celula.puro.ts`, testes
sem mock), decidida por `dataTypeName`; bruto sempre no `title`, na cópia, no
filtro, na edição e no export. Custo O(1) por célula visível, sem medição de DOM.

| Tipo | Inline (célula) | Gatilho → componente | Atalho | Regra 10 / 11 |
|---|---|---|---|---|
| Texto longo / multilinha | primeira linha + `↵ 12` em `subtle` quando há quebras; truncamento normal | Enter/ícone → popover com quebra, contador "1.284 car · 12 linhas"; > 4 KB → painel | Enter | bruto copiado; contagem só da célula aberta |
| Espaço no início/fim, só espaços | `·` em `subtle` marcando cada espaço das bordas; célula só de espaços vira `␣×3` | tooltip "3 espaços no fim" | — | marcador é pseudo-elemento, não entra na cópia |
| NULL / "" / "NULL" literal | já: `NULL` itálico, `vazio` itálico; string "NULL" fica em `ink` normal | — | — | ok; manter teste |
| Array do Postgres `{a,b,"c d",NULL}` | `[3]` em `subtle` + primeiros itens separados por `·` | Enter → popover lista numerada (NULL estilizado); parse puro respeitando aspas e escapes | Enter | parse só na abertura; copiar = literal `{…}` |
| uuid | `3f2a8c1e…9c1e` mono | hover → botão copiar na borda (como FK) | `Ctrl+C` copia completo | bruto completo em tudo |
| timestamp / timestamptz | `17/11/2026 17:56` em `ink`, segundos+fração+fuso em `muted` reduzido; nunca `Date()` | tooltip: bruto + relativo "há 3 dias" (relativo calculado **só** para timestamptz, cujo offset vem na string; para timestamp sem fuso, só a data) | — | formatação por regex; locale do idioma da UI |
| date / time | data por idioma; time como está | tooltip bruto | — | idem |
| interval | `1 dia 02:00` (já é o texto do Postgres; só tradução de unidade quando `IntervalStyle` é `postgres`) | tooltip bruto | — | se o estilo não for reconhecido, mostra o bruto |
| bytea | `⊘ 12,4 KB` + primeiros 8 bytes hex | Enter → popover hex dump (16 bytes/linha, 4 KB de preview) + "copiar como hex" | Enter | tamanho = (len−2)/2 sobre a string `\x…`; nunca decodifica tudo |
| xml | primeira tag `<pedido …>` | Enter → painel com indentação e realce (parser `DOMParser` só na abertura) | Enter | bruto copiado |
| geometria (PostGIS) | depende do que o driver devolve: WKT/EWKT `POINT(…)` mostra tipo + SRID; EWKB hex mostra `geometry · 21 bytes` | Enter → popover com o texto WKT quando houver; sem mapa | Enter | sem conversão no cliente |
| numeric grande / money | agrupamento de milhar **visual** (`1.234.567,89`), inserindo o separador na string só para exibição, `tabular-nums`, à direita | tooltip bruto | — | nunca `Number()` (perde precisão); só manipula a string |
| enum | chip neutro (auxílio §4 #10) | — | — | texto do chip = valor |
| FK | já: salto no hover. Acrescentar tooltip "→ public.clientes (id = 42)" e `Ctrl+Enter` na célula = salto | abre aba filtrada (salto existente) | Ctrl+Enter | usa o valor bruto no filtro |
| boolean | glifo (§4 #2) | — | — | — |

### 6.3 Usabilidade do grid e da consulta

| Melhoria | Comportamento | Notas |
|---|---|---|
| **Estatística da coluna** (aprovado) | clique no ícone `Σ` do cabeçalho (ou menu da coluna) → popover: nulos, distintos, min/max, top 5 valores; esqueleto até chegar; erro inline | rota do backend sob `BEGIN READ ONLY`, respeitando os filtros da aba; números como string |
| **Comparar duas linhas** (aprovado) | selecionar 2 linhas → "Comparar" (ou `Ctrl+D`) → painel com colunas lado a lado, diferenças marcadas por fundo `accent/12` e "só diferenças" | painel no inspetor; diff puro testado |
| Copiar célula/linha/coluna | menu de contexto do grid: copiar valor, copiar linha (TSV / JSON / `INSERT`), copiar coluna (valores carregados, com aviso "apenas N linhas carregadas"), copiar nome da coluna | sempre bruto; `INSERT` usa o mesmo quoting do servidor? — gerar no servidor ou recusar no cliente (sem SQL montado por concatenação no front) |
| Ver como registro (vertical) | `Ctrl+Shift+V` ou duplo-clique no número da linha → inspetor mostra a linha como lista `coluna: valor` com os mesmos renderizadores; ↑↓ no grid troca a linha | resolve tabela de 40 colunas; é o "detalhe da linha" do inspetor |
| Mudanças pendentes | célula editada com canto âmbar (§3.5); barra no rodapé "3 alterações pendentes · Gravar · Descartar" quando houver edição em lote | âmbar correto: é escrita |
| Número da linha | coluna de gutter fixa com índice (1-based), clicável para selecionar a linha inteira | sticky, fora do dataset |
| Selecionar coluna | clique no cabeçalho com `Alt` (clique normal ordena) | — |
| Filtro rápido por célula | menu de contexto: "Filtrar = este valor", "≠", "é NULL" → vira chip | reaproveita `RowFilter`, valor bruto |
| Ir para linha/coluna | `Ctrl+G` linha; `Ctrl+Shift+O` coluna por nome (lista filtrável, rola horizontalmente) | essencial com 60 colunas |
| Contagem da seleção | rodapé: "4 × 3 células · soma 1.234,00" quando a faixa é numérica | soma com aritmética decimal sobre strings (sem `Number` para numeric) |
| Larguras lembradas | largura por tabela persistida no navegador (mesmo mecanismo da zebra) | per-viewer, `try/catch` |
| Resultado da consulta | "Executar seleção", histórico com tempo, abas de resultado nomeadas pela 1ª linha do SQL | ver §3.6 |
| Zebra (decidido) | preferência por pessoa no `localStorage`, padrão desligado, `index % 2` na linha virtual | leitura em `try/catch` |

---

## 7. Estado da implementação (FASE 2)

Cada agente acrescenta a sua parte abaixo; desvio da spec vem com o porquê.

### F0, F1, F2, parte da F7 (coordenador)

- **Árvore recolhida (§3.2), refeita a pedido do autor.** Não são dois
  painéis (árvore + trilho) cruzando: é UMA superfície (`ArvoreLateral`,
  `app/trilho.puro.ts`) que anima `clip-path` de `--w-arvore` até 44 px, com a
  borda direita andando junto. Layout troca de largura uma vez (no início ao
  abrir, no `transitionend` ao fechar). Texto sai nos primeiros 40 %; os
  ícones do trilho voam por FLIP da posição que tinham na árvore até uma lista
  compacta de passo fixo (32 px), centrada — conexão expandida não abre vão.
  O trilho aparece a partir de 20 % (e não 60 %) para o voo ser visto.
  Abertura e fechamento em `--motion-slow` (240 ms): a única duração de token
  acima dos 200 ms pedidos para legibilidade; abertura `ease-enter`,
  fechamento `ease-exit`. O botão do cabeçalho é o único controle (o trilho
  não tem botão de expandir); clicar num ícone abre a árvore com a conexão
  expandida; hover de 300 ms abre o "peek" por cima do grid.
- **Máscara da fila de abas** só do lado em que há transbordo medido.
- **Tooltip**: `title` nativo por enquanto (sem nova dependência).
- **Enum como chip (§4 #10)**: não feito — o resultado não diz se o tipo é
  enum; precisa do catálogo de tipos. Pendência.
- **Gatilho do visualizador**: ícone `{…}` + duplo-clique (sem edição) +
  Enter/Espaço, como decidido.
