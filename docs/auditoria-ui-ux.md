# Auditoria de UI/UX — app web (apps/web)

Data: 2026-11-17 · Escopo: `apps/web/src` · Método: leitura de `docs/design-system.md`,
código, e capturas reais via `scripts/headless-shot.ts` (dev com `~/.dbee-dev`,
sessão mintada). Capturas em `scratch/ui-audit/` (login dark/light 375–1440,
shell autenticado 1440 dark, diálogo VPN 768 dark e 1024 light).

**Limite honesto:** não consegui capturar o grid com dados nem o editor de SQL
(o script de navegação por `acao` abriu o diálogo de VPN no lugar da tabela). Os
achados de grid/editor abaixo vêm do código, não do pixel. A fatia de grid
precisa de uma rodada de capturas antes de virar trabalho.

## Resumo executivo

O miolo de trabalho está certo e é mais disciplinado que a média do gênero:
grid virtualizado com linha de 26px, árvore densa, âmbar reservado para escrita,
barra vertical de cor no lugar de ponto, selo de escrita em ícone. O que puxa o
app para "cara de IA" é a **camada de marca**, que cresceu por cima do sistema
e hoje contradiz o próprio `design-system.md`:

1. O §10 recusa "favo de mel, hexágono, abelha ilustrada"; o §4b, escrito
   depois, os espalha por 6 lugares (cabeçalho ×2, rodapé da árvore, estado
   vazio ×2, login, tela de servidor fora). O doc se contradiz e o código seguiu
   a metade decorativa.
2. A tela de login é uma landing page (ilustração 3D gerada, slogan motivacional,
   título com metade em âmbar, botão pílula com sombra âmbar e lift no hover).
   É a primeira tela que o dev vê todo dia e a que menos parece a ferramenta.
3. Âmbar sólido aparece fora do modo escrita (CTA de login, rótulo de campo
   focado, "Bee" do logotipo, metade do título), diluindo o único sinal de
   perigo do sistema.

Corrigir 1–3 é quase todo remoção, cabe em um dia e não toca invariante.

## Achados ranqueados

Severidade: **A** = a tela afirma algo errado ou enfraquece um sinal de
segurança; **M** = custo diário de leitura/uso; **B** = acabamento.

| # | Sev | Onde | Problema | Por que importa | Proposta |
|---|---|---|---|---|---|
| 1 | A | `features/auth/LoginScreen.tsx:135`, `AuthPanel.tsx:379` | CTA "Entrar" e foco do campo em âmbar sólido/contorno âmbar; botão `rounded-full h-12` com `hover:shadow-[0_12px_30px_-8px_rgba(245,166,35,0.6)]` e `-translate-y-0.5`. | §1.4/§10: âmbar sólido = modo escrita, sem exceção. Treinar o olho a ver âmbar como "botão principal" na primeira tela do dia enfraquece o selo de escrita. Sombra colorida + lift é tique de SaaS gerado. | Botão `variant="primary"` do kit (`components/ui/Button.tsx`), `h-10 rounded-[6px]`, fundo `bg-ink text-surface` (ou o neutro forte do tema). Remover sombra e translate. Foco: `ring-1 ring-line-strong`, não âmbar. |
| 2 | A | `docs/design-system.md:164` vs `:418-449`; `app/AppShell.tsx:610,624,965,970`; `features/tree/ConnectionTree.tsx:181`; `features/auth/AuthGate.tsx:72`; `AuthPanel.tsx:218,222` | Favo de mel em 6+ pontos, inclusive dois cachos no cabeçalho e um atrás do rodapé da árvore. O §10 o proíbe explicitamente. | Doc contraditório é pior que ausente (regra do próprio projeto). No shell, o cacho do cabeçalho e o do canto do miolo competem com o breadcrumb/área de trabalho — e somem no perigo, ou seja, a tela "segura" é a mais enfeitada. | Remover `HoneycombCluster` do AppShell, árvore e estado vazio. Se quiser manter marca, um único lugar: a vitrine do login. Reescrever §4b para dizer isso e deixar §10 coerente. |
| 3 | A | `features/auth/AuthPanel.tsx:114-173`, `i18n/pt.ts:38-41` | Login como landing: ilustração 3D gerada (paisagem + abelha + hexágonos-prédio), slogan "Dados de hoje, melhores decisões amanhã", rodapé em caixa alta espaçada "PEQUENAS QUERIES, GRANDES CONQUISTAS.", título "Bem-vindo **de volta**" com metade âmbar, gradiente duplo `linear-gradient(150deg…)` sobre a imagem. | É o pacote completo de "cara de IA": arte genérica gerada, copy motivacional vazia, caixa alta travada (recusada no §8/§10), gradiente decorativo (recusado no §10). Também diz **"Seu PostgreSQL"** num produto com 7 engines — copy factualmente errada. | Login em coluna única, `max-w-sm`, centrado: marca pequena, "Entrar no DBee", campos, botão. Sem vitrine em ≤1024. Se a vitrine ficar em ≥1280, trocar a ilustração por algo verdadeiro (ex.: a própria UI em captura monocromática) e remover os dois slogans. Tagline → "Cliente de banco de dados self-hosted". |
| 4 | M | `app/AppShell.tsx:~985-1000` (estado vazio) | Com conexões cadastradas mas nenhuma aberta, o vazio diz "Escolha uma tabela / Abra uma conexão na árvore." com mascote "feliz" flutuando (`animate-float`) no meio de 1440px. | Título e dica pedem coisas diferentes. Mascote em loop contínuo aparece toda vez que a última aba fecha — o próprio comentário no código admite que vira insistente. §10: "mais de um ciclo contínuo na tela" — e não há razão para nenhum aqui. | Um texto só: "Abra uma tabela na árvore à esquerda" + atalhos reais (`Ctrl+T` nova consulta, `Ctrl+K`/busca) como `kbd`. Mascote estático ou nenhum; nunca `float` em tela de trabalho. Referência: estado vazio do TablePlus e do DataGrip (lista de atalhos, sem ilustração). |
| 5 | M | 11 diálogos: `VpnBotao.tsx:88`, `UsuariosDialog.tsx:86`, `RowEditModal.tsx:139`, `InsertModal.tsx:113`, `CreateTableDialog.tsx:163`, `ConnectionForm.tsx:175`, etc. | Overlay `bg-black/60 backdrop-blur-[3px]` copiado em 11 arquivos; não existe `components/ui/Dialog`. Capturas: blur do fundo + diálogo com sombra grande + card de borda dentro do diálogo (VPN: cabeçalho, divisória, e o formulário inteiro numa segunda caixa). | Glassmorphism gratuito (blur não ajuda a ler nada atrás) e card-dentro-de-card. Duplicação garante deriva: um diálogo vai divergir. `bg-black` contraria "nunca #000" (§1.2). | Criar `components/ui/Dialog.tsx` (shadcn Dialog) com overlay `bg-sunken/80`, sem blur; conteúdo `rounded-[10px] border border-line bg-surface shadow-[0_8px_24px_-12px_rgb(0_0_0/.5)]` (dura e curta, §3). No VPN, remover a caixa interna: campos direto no corpo, status como linha `text-xs text-muted`. |
| 6 | M | `features/query/QueryTabContent.tsx:373` | Mascote "joia" dá `pop` a cada consulta bem-sucedida, ao lado de "123 ms · somente leitura". | Quem roda 200 queries por dia vê 200 comemorações. Reforço positivo em ação rotineira é ruído; o rodapé de resultado deveria ser só métrica. | Remover o mascote do rodapé. Manter "N linhas · 123 ms · somente leitura" em `font-mono text-2xs`. |
| 7 | M | `app/AppShell.tsx` cabeçalho (captura 1440) | Barra superior: logo grande com "Bee" âmbar, depois `dev · PT · tema · usuários · escudo · admin · sair` — sete ícones sem rótulo e sem agrupamento; "admin" em mono destoando. | Ícones sem rótulo exigem hover para descobrir (escudo = auditoria? VPN?). O logotipo em âmbar é mais âmbar fora do modo escrita (#1). | Agrupar idioma/tema/conta num menu de usuário (shadcn `DropdownMenu`) atrás do nome; deixar no topo só o que muda estado de trabalho (VPN, atualização). Logotipo em `text-ink` monocromático, `h-5`. Referência: barra do Linear e do Neon console (conta e preferências num único menu). |
| 8 | M | `features/tree/ConnectionTree.tsx` (captura) | Cada conexão mostra ícone de engine + ponto de saúde vazado de ~5px + barra de cor + texto "Nome · ambiente". O ponto vazado é quase invisível no dark; o ícone do elefante é igual para todas as linhas. | O estado "conectada/erro/desconhecida" é a segunda informação mais importante depois do modo escrita, e hoje é a menos legível da linha. | Ponto `size-2` cheio quando conectado (`bg-ok`), contorno `border-subtle` quando nunca aberto, `bg-danger` em erro, com `title`/`aria-label`. Ícone de engine em `text-subtle` para não competir. |
| 9 | M | `features/grid/ResultGrid.tsx` (código; sem captura) | Linha de 26px é boa. Não há indicação verificada em pixel de: NULL distinto de string vazia, alinhamento numérico à direita, coluna congelada da PK. | São as três coisas que separam um grid de banco de uma tabela genérica (TablePlus e DataGrip fazem as três). | Capturar o grid antes de agir. Conferir: `NULL` em `text-subtle italic`, números `text-right tabular-nums`, PK `sticky left-0 bg-surface`. |
| 10 | B | `components/ui/Skeleton.tsx:15` | Shimmer com `bg-gradient-to-r`. | Aceitável (o gradiente aqui representa progresso), mas é o padrão de kit. | Manter, ou trocar por pulso de opacidade em `bg-raised` — mais quieto e respeita `prefers-reduced-motion` com menos código. |
| 11 | B | `features/export/ExportButton.tsx:143` | Popover com `shadow-lg` padrão do Tailwind. | §3: sombra só dura e curta. | Usar a mesma sombra do Dialog (#5) via token. |
| 12 | B | Login 375px (captura) | Vitrine vira faixa de 260px no topo, empurrando o formulário para a segunda dobra; seletor de idioma flutua no meio de um cacho de hexágonos. | No celular a pessoa quer o campo de usuário na primeira dobra. | Esconder a vitrine abaixo de `lg`. Idioma no canto superior, fora de qualquer decoração. |

## "Cara de IA" — inventário

Separado porque a pergunta foi explícita. Em ordem de quanto pesa:

- **Arte 3D gerada + slogans motivacionais no login** (`AuthPanel.tsx`,
  `pt.ts:40-41`): "Dados de hoje, melhores decisões amanhã", "Pequenas queries,
  grandes conquistas". Frases que caberiam em qualquer produto. Cortar.
- **Título com metade colorida** ("Bem-vindo *de volta*" em âmbar): tique de hero
  de landing gerada. Título inteiro em `text-ink`.
- **Hexágonos decorativos em todo canto** (#2). O motivo da marca repetido como
  papel de parede.
- **Mascote em loop** no estado vazio e comemoração por query (#4, #6). Um
  mascote no login/erro de servidor é personalidade; em toda tela é ruído.
- **Botão pílula com sombra colorida e lift** (#1).
- **Blur no overlay de 11 diálogos** (#5).
- **Card dentro de card** em diálogos (VPN capturado; verificar Usuários e
  Atualização, mesmo padrão no código).
- **Caixa alta espaçada** no rodapé da vitrine — recusada no §8.

O que **não** é cara de IA e deve ficar: barra vertical de cor da conexão, selo
de escrita em ícone, cabeçalho inteiro mudando no perigo, hairlines como
divisória, mono para valores, a contenção da árvore.

### Copy (passada tipo humanizer em `i18n/pt.ts` e `en.ts`)

A copy de trabalho (árvore, erros, VPN) é boa: concreta, diz o que acontece
("ela vai direto para a VPN e não fica guardada"). Os problemas se concentram no
login:

| Chave | Atual | Proposta |
|---|---|---|
| `login.marcaTagline` | Seu PostgreSQL, mais simples. / Your PostgreSQL, simpler. | Cliente de banco de dados self-hosted. / Self-hosted database client. |
| `login.titulo` (+ destaque) | Bem-vindo de volta | Entrar |
| subtítulo | Acesse sua conta para continuar no DBee. | remover (o título já diz) |
| `login.vitrineLinha1/2` | Dados de hoje, melhores decisões amanhã. | remover |
| `login.vitrineRodape` | Pequenas queries, grandes conquistas. | remover |
| `vazio.titulo` + `vazio.dica` (com conexões) | Escolha uma tabela / Abra uma conexão na árvore. | Abra uma tabela na árvore ou comece uma consulta. |

"Bem-vindo" também é gênero fixo; "Entrar" resolve isso de graça.

## Quick wins (≤ 1h cada)

1. Remover os 5 `HoneycombCluster` do AppShell e da árvore (#2).
2. CTA do login: `Button variant="primary"` padrão, sem sombra/lift/pílula (#1).
3. Trocar a copy do login pela tabela acima, nos dois idiomas (#3). Corrige o
   "PostgreSQL" factualmente errado.
4. Tirar o `pop` do mascote no rodapé de resultado (#6).
5. Estado vazio: um texto coerente + atalhos, mascote sem `float` (#4).
6. Trocar `shadow-lg` do export pela sombra curta (#11).
7. Ponto de saúde da árvore cheio e maior (#8).
8. Reescrever §4b/§10 do `design-system.md` para não se contradizerem.

## Mudanças estruturais

1. **`components/ui/Dialog.tsx`** (shadcn) e migração dos 11 diálogos: overlay
   sem blur, sem `bg-black`, sem caixa interna (#5). Meio dia.
2. **Login enxuto**: coluna única abaixo de `xl`, vitrine opcional e verdadeira
   acima (#3, #12).
3. **Barra superior com menu de conta** agrupando idioma/tema/usuários/sair (#7).
4. **Rodada de capturas do grid e do editor** (seleção, NULL, numéricos, erro com
   `position`, modo escrita aberto) nos 4 breakpoints — pré-requisito para #9.

## Referências

Não revalidadas nesta sessão (sem fetch); servem como ponto de partida:

- TablePlus — densidade de grid, NULL distinto, cor por ambiente na barra:
  https://tableplus.com/
- Beekeeper Studio — estado vazio com atalhos, cor de conexão:
  https://www.beekeeperstudio.io/
- DataGrip — cor por conexão para produção, grid com coluna fixa:
  https://www.jetbrains.com/help/datagrip/data-editor-and-viewer.html
- Linear — barra superior quieta, conta e preferências num menu:
  https://linear.app/
- Supabase Studio — table editor, árvore lateral, diálogos sem blur:
  https://supabase.com/docs/guides/database/tables
- Neon console — painel de branch/estado legível sem decoração:
  https://neon.tech/docs/manage/console
- Outerbase — grid editável denso: https://www.outerbase.com/

## Fora de escopo → ideia para ATRITO.md

- Vitrine do login mostrando a própria UI (captura real) em vez de ilustração:
  exige pipeline de imagem; só se o login continuar com duas colunas.
- Paleta de comandos (`Ctrl+K`) unificada para conexões, tabelas e ações, como
  Linear/Supabase: útil, mas não está no roadmap da fase.

## Invariantes respeitadas pelas propostas

Grid continua virtualizado; âmbar fica **mais** exclusivo do modo escrita; nada
de CDN (tudo é classe Tailwind/shadcn local); shadcn primeiro (Dialog,
DropdownMenu).
