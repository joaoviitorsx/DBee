# Identidade e personalidade do DBee

Data: 2026-11-17 · Status: **proposta** (nada aqui foi aplicado ao código).
Lê junto com `docs/design-system.md` (regras) e `docs/auditoria-ui-ux.md`
(diagnóstico de UI). Onde este doc contradiz o design-system, vale o
design-system até a fatia correspondente ser aprovada e o doc atualizado.

Moodboard visual comparando as direções: ver o artifact publicado (link no
relatório da tarefa; arquivo-fonte no scratchpad da sessão).

---

## 1. Referências

Fontes conferidas em 2026-11-17. Itens com **[não verificado]** saíram de memória ou de análise de terceiros, não da própria marca.

| Produto | O que define a personalidade | Fonte |
|---|---|---|
| **DBeaver** (origem do time) | Tagline "Universal Database Tool". A voz é de catálogo ("Basic support for relational databases", "Advanced security"). O castor só aparece no arquivo `beaver-head.png`. É uma IDE Eclipse com dezenas de painéis, perspectivas e preferências. | https://dbeaver.io |
| Linear | Inter Display nos títulos e Inter no corpo. Temas gerados em LCH a partir de três entradas (base, acento, contraste). Cortaram o azul da marca em favor de um visual "more neutral and timeless", com mais densidade e menos ruído. | https://linear.app/now/how-we-redesigned-the-linear-ui |
| Raycast | Afirmação precisa no lugar de adjetivo ("Reliable. 99.8% crash-free rate."), "Take the short way.", tecla de teclado como grafismo. | https://www.raycast.com |
| Warp | O logo conta uma história (o terminal que "cracked under extreme speed"). Produto frio e preciso, visual quente e tátil. Fontes [não verificado]. | https://warp.dev/blog/world-of-warp |
| TablePlus | "Modern, native, and friendly GUI tool". UI nativa de cada SO, sem mascote; atalho para toda função. | https://tableplus.com |
| Beekeeper Studio | Também é uma abelha amarela, então é o vizinho mais próximo do DBee. Voz calorosa: "Oh, it's also open source :-)", "warm and fuzzy inside". Sem mascote ilustrado na home. | https://www.beekeeperstudio.io |
| Supabase | Verde #3ECF8E, cinzas #1C1C1C e #F8F8F8, regras de grafia do nome. | https://supabase.com/brand |
| Neon | Voz seca e técnica: "Serverless, branchable, scale-to-zero…". Visual [não verificado]. | https://neon.com |
| Arc | A cor é do usuário. O onboarding vem de game design. Hoje está em manutenção. | https://www.inverse.com/input/design/the-browser-company-arc-design-interview |
| Teenage Engineering | Microcopy absurda e impassível ("THIS SHADOW IS unrealistically LONG… ARE YOU HIDING SOMETHING?"), botões que fazem piada. Minúscula como padrão. | https://teenage.engineering |
| Panic | "A new, tiny, yellow console with a crank." Fazer jogos dá personalidade ao resto, e a lista de suporte termina em piscadela ("Anything else!"). | https://panic.com |
| Charm | "We make software glamorous." Nomes de bibliotecas tirados de cosméticos e doces, um mascote por biblioteca, "haters > /dev/null™". | https://charm.sh |
| Tailscale | Voz sem pressão ("Installation takes minutes"), captura de UI real no lugar de arte. Acento #d04841 [terceiros]. | https://tailscale.com |
| Fly.io | Direta, com aparte nerd: "we nerd out about this stuff", "No Dockerfile? No problem". Balão [não verificado]. | https://fly.io |

### Eixo central: DBeaver é poderoso e pesado; o DBee é direto e leve

O time vem do DBeaver, então toda decisão abaixo é medida contra ele:

| | DBeaver | DBee |
|---|---|---|
| Primeira impressão | Workspace, perspectivas, wizard de driver | Login, árvore, uma tabela aberta |
| Cromo | Barras de ferramentas, painéis acopláveis, abas dentro de abas | Uma barra, uma árvore, abas. Só isso. |
| Voz | Rótulo de catálogo ("Universal Database Tool") | Frase de colega: o que aconteceu e o que fazer |
| Densidade | Densa porque tem muitos controles | Densa porque mostra muitos **dados**, não controles |
| Configuração | Centenas de preferências | Defaults decididos. A conexão já nasce em modo leitura |

**Restrição como identidade.** O DBee *não* tem: perspectivas, painéis
arrastáveis, ER editável, plugin, preferência de fonte ou de tema além de
claro/escuro, toast de sucesso, tour de onboarding, mascote na tela de trabalho.
Dizer isso em voz alta (README, landing, `?`) faz parte da marca.


### O que se repete entre as que funcionam

1. **A identidade mora em poucos lugares, executados com obsessão.** Nenhuma
   delas espalha mascote pela tela de trabalho. A ferramenta em uso é quieta; a
   personalidade aparece em microcopy, no movimento e nas bordas (landing,
   changelog, 404, estados vazios).
2. **Uma voz com opinião, escrita por gente.** Frases curtas, verbos concretos,
   humor seco, zero motivacional.
3. **Tipografia como assinatura**, quase sempre com uma mono de verdade.
4. **Um objeto de marca próprio**, não um tema genérico (cão do Charm, balão do
   Fly, "Mac-like" do Panic). O do DBee já existe: a abelha-cilindro.

---

## 2. Diagnóstico do DBee hoje

### Já é próprio (manter)

- **A marca abelha-cilindro** (`assets/marca.webp`): banco + abelha numa forma
  só, plana, legível a 16 px. É o ativo mais forte e mais raro do projeto.
- **O nome.** DB + bee é trocadilho que se explica sozinho; dá vocabulário
  (enxame, colmeia, pólen, zumbido, apicultor) sem precisar de ilustração.
- **Âmbar = escrita.** Uma cor que *significa* algo, não decora. Poucos clientes
  de banco têm isso tão claro; é personalidade funcional.
- **"A marca só voa quando o app está ocupado de verdade"** (§ gesto
  assinatura). É exatamente o tipo de regra que Linear/Raycast praticam.
- **Voz técnica e honesta em vários pontos**: "A condição casaria mais de uma
  linha — nada foi alterado.", "O token vive no volume, nunca no log." Isso já é
  a voz certa; falta torná-la padrão.

### Genérico (o que puxa para "cara de IA / SaaS")

- **Mascote 3D lustroso com confete** (`feliz.webp`, `sucesso.webp`,
  `vitrine-login.webp`): estética de gerador de imagem, idêntica a mil
  mascotes de app. Contradiz a marca plana: hoje o DBee tem **dois estilos de
  abelha** que não conversam.
- **Tipografia default de 2023** (Sora + Space Grotesk): fontes boas, mas
  justamente as que todo template de SaaS usa; e a mono é a do sistema (cada
  máquina vê uma coisa).
- **Microcopy de kit**: "Algo deu errado do nosso lado.", "Carregando",
  "Nenhuma aba aberta", "Nada registrado ainda." Corretas e sem dono.

### Contradições

1. Marca plana vs. mascote 3D (dois mundos visuais).
2. Âmbar é "só escrita", mas o "Bee" do logotipo é âmbar — exceção defensável,
   porém é a única porta por onde o âmbar decorativo volta.
3. **`--color-subtle` reprova AA para texto**: 3,76:1 no dark (`#7a7166` sobre
   `#191612`) e 3,52:1 no light (`#8a8071` sobre `#f8f3eb`). Se é usado em texto
   de 11–12 px, é bug, não identidade.
4. O vocabulário de abelha existe no nome mas quase não na voz; e quando
   aparece, aparece como imagem (favo, já removido) em vez de palavra.

---

## 3. Três direções

Todas mantêm: âmbar sólido só em escrita; sem favo/hexágono decorativo; grid de
26 px; nada de animação que atrase o trabalho; `prefers-reduced-motion` zera
tudo; fontes bundladas (pacotes `@fontsource*`, OFL), sem CDN.

Contraste medido com a fórmula WCAG 2.x (luminância relativa), texto sobre
`surface`. Todos ≥ 4,5:1 (AA texto normal).

### Direção A — "Apicultor" (recomendada)

**Conceito:** o DBee é a bancada de quem cuida da colmeia: ferramenta de ofício,
calma, precisa, com humor seco de quem já levou ferroada.

Princípios:
1. **Ofício antes de enfeite.** A tela de trabalho não tem ilustração; tem
   ferramenta bem afiada.
2. **Diz o que aconteceu e o que fazer.** Toda mensagem tem fato + próxima ação.
3. **O vocabulário da colmeia é tempero, não molho.** Uma palavra de abelha por
   tela, no máximo, e só onde não atrapalha a compreensão (estado vazio, espera,
   404, changelog). Erro nunca brinca.
4. **Âmbar é ferrão.** Escrita é a única coisa que pica.
5. **Uma abelha só.** A marca plana é a identidade; o mascote 3D sai.

Voz e tom (strings reais de `pt.ts`):

| chave | antes | depois (pt) | depois (en) |
|---|---|---|---|
| `vazio.titulo` | Nenhuma aba aberta | Bancada limpa | Clean workbench |
| `vazio.dica` | Abra uma tabela na árvore à esquerda ou comece uma consulta. | Abra uma tabela na árvore ou comece uma consulta (⌘T). | Open a table from the tree, or start a query (⌘T). |
| `comum.carregando` | Carregando | Buscando… | Fetching… |
| `erro.internal_error` | Algo deu errado do nosso lado. | Erro no servidor do DBee, não no seu banco. Detalhes no log do container. | DBee’s server failed, not your database. Details are in the container log. |
| `erro.rede` | Sem resposta do servidor. Verifique a conexão. | O DBee não respondeu. Ele está de pé? Confira a rede ou a VPN. | DBee didn’t answer. Is it running? Check the network or VPN. |
| `audit.vazio` | Nada registrado ainda. | Ninguém escreveu nada ainda. Tudo que for gravado aparece aqui. | Nobody has written anything yet. Every write shows up here. |
| `erro.write_forbidden` | Escrita não habilitada nesta conexão. | Esta conexão é só leitura. Um admin pode liberar escrita na edição da conexão. | This connection is read-only. An admin can enable writes in the connection settings. |
| `sessao.expirada` | Sua sessão expirou. Entre novamente. | Sessão expirada. Entre de novo; suas abas continuam aqui. | Session expired. Sign in again; your tabs are still here. |

(Último item só vale se as abas de fato persistem — conferir antes de prometer.)

Paleta (só o que muda; resto igual ao `index.css` atual):

| token | dark | light | contraste dark / light |
|---|---|---|---|
| `surface` | `#191612` | `#f8f3eb` | — |
| `ink` | `#f2ece2` | `#1c1917` | 15,3 / 15,8 |
| `muted` | `#a79e90` | `#5c5449` | 6,8 / 6,7 |
| `subtle` | **`#8a8174`** (era `#7a7166`) | **`#736a5e`** (era `#8a8071`) | 4,7 / 4,8 |
| `ok` | `#6fb487` | `#2f7d4f` | 7,3 / 4,6 |
| `danger` | `#f0645f` | `#b8262b` | 5,7 / 5,7 |
| `info` (novo, "fumaça") | `#8fa9c4` | `#3d5f82` | 7,4 / 6,0 |
| `accent` (escrita) | `#f5a623` | `#8f5a08` | 8,9 / 5,2 |
| `accent-ink` sobre `accent` | `#191612` | `#fdfbf6` | 8,9 / 5,6 |

`info` existe para tirar do âmbar qualquer destaque neutro (link, seleção de
aba de leitura, dica) — é a "fumaça do apicultor", calma.

Tipografia: **IBM Plex Sans** (UI) + **IBM Plex Mono** (grid, SQL, números),
ambas OFL, `@fontsource/ibm-plex-sans` / `@fontsource/ibm-plex-mono`. Plex tem
cara de ferramenta industrial sem ser fria, tem itálico real (útil para `NULL`),
números tabulares e cobertura de PT. Space Grotesk fica **só** no logotipo
(já bundlada).

Movimento: mantém `--motion-fast/base/slow` (120/180/240) e `--ease-enter`.
Uma assinatura nova, **"zumbido"**: `translateX` de ±1 px, 2 ciclos, em
`--motion-base`, aplicada **só na marca do cabeçalho** quando uma escrita é
confirmada (commit). Não em leitura, não em sucesso de consulta. Com
reduced-motion: nada.

Mascote: a abelha-cilindro plana em todos os lugares onde hoje há mascote
(espera longa, servidor fora, troca de senha, 404 da landing), em **poses
desenhadas no mesmo traço plano** (asas a 55%, sem rosto 3D). Nunca na tela de
trabalho, nunca junto de erro de query, nunca comemorando consulta. O mascote 3D
fica só no `site/` como ilustração de marketing — ou sai.

Iconografia: Lucide (já em uso) com `stroke-width` 1.5, tamanho 14/16. Um único
ícone próprio: o ferrão (para "modo escrita"), desenhado no grid de 24 do Lucide.

Microinterações-assinatura:
- marca voa durante requisição (já existe);
- "zumbido" na marca ao confirmar escrita;
- tag de cor da conexão pulsa durante teste (já existe);
- ao copiar célula: rótulo troca para "Copiado" por 1,2 s, sem toast.

Easter eggs discretos (zero custo de trabalho):
- `SELECT 'bee';` no editor devolve normalmente, mas o rodapé diz `1 linha · zzz`.
- `?` abre a lista de atalhos. O rodapé lista o que o DBee não faz ("sem plugins, sem perspectivas, sem tour").
- 404 da landing: "Essa página voou." com a abelha plana virada de costas.
- `console.log` de boas-vindas no devtools com a abelha em ASCII e o link do repo.

Regras do projeto: âmbar continua exclusivo de escrita (o "zumbido" acontece
justamente quando a escrita é confirmada — reforça o significado); nada de
favo; grid intocado; nenhuma animação bloqueia input.

### Direção B — "Enxame" (terminal)

**Conceito:** o DBee é um programa de terminal que aprendeu a desenhar: mono em
tudo, ASCII como ilustração, humor de README.

Princípios: mono-first; teclado antes de mouse; mensagens no tom de saída de
CLI; ilustração em caractere, não em pixel.

Voz (mesmas chaves):

| chave | pt | en |
|---|---|---|
| `vazio.titulo` | `0 abas` | `0 tabs` |
| `vazio.dica` | ⌘T abre uma consulta. ↑↓ navega a árvore. | ⌘T opens a query. ↑↓ walks the tree. |
| `comum.carregando` | zzz… | zzz… |
| `erro.internal_error` | erro interno (500). o log do container sabe mais. | internal error (500). the container log knows more. |
| `erro.rede` | sem resposta. o DBee está de pé? | no reply. is DBee up? |
| `audit.vazio` | log vazio. nenhuma escrita até agora. | empty log. no writes so far. |
| `erro.write_forbidden` | conexão em read-only. escrita: off. | connection is read-only. writes: off. |
| `sessao.expirada` | sessão expirou. entre de novo. | session expired. sign in again. |

Paleta: dark `surface #121311`, `ink #e8e6dc` (14,9), `muted #9c9a8e` (6,6),
`subtle #85837a` (4,9), `ok #9cc36b` "pólen" (9,3), `danger #ff6b6b` (6,7),
`info #7fb8c4` (8,5), `accent #f5a623` (9,2). Light `surface #f4f3ec`,
`ink #161714` (16,2), `muted #55544c` (6,8), `subtle #6e6c63` (4,7),
`ok #3f6e1c` (5,5), `danger #b3261e` (5,9), `info #1f6470` (6,1),
`accent #8f5a08` (5,2).

Tipografia: **JetBrains Mono** (OFL) em toda a UI, Space Grotesk só no logo.
Movimento: cursor piscando no estado vazio; transições em degrau
(`steps(4)`). Mascote: abelha em ASCII (`>8-|`), nunca imagem. Ícones: mínimos,
glifos Unicode onde possível.

Risco: mono em toda a UI reduz densidade de rótulo (mono é ~15% mais larga) e
cansa em formulários longos; o humor minúsculo envelhece rápido; afasta quem
não vive no terminal.

### Direção C — "Etiqueta" (instrumento)

**Conceito:** o DBee é um instrumento de laboratório: painel cinza, etiquetas
numeradas, cor só como sinal — no espírito Teenage Engineering.

Princípios: tudo tem etiqueta; cor é sinal, nunca fundo; números à vista
(contagens, ms, linhas); geometria dura (raio 2–4 px).

Voz: rotular em vez de conversar (sem caixa alta travada, recusada no §8).
`vazio.titulo` "Sem aba aberta · 0"; `comum.carregando` "Lendo";
`erro.internal_error` "Falha interna · 500 · ver log"; `erro.rede`
"Servidor sem resposta · rede/VPN"; `audit.vazio` "0 escritas registradas";
`erro.write_forbidden` "Escrita: desligada nesta conexão";
`sessao.expirada` "Sessão encerrada · entrar"; `vazio.dica` "Árvore → tabela,
ou ⌘T". (en paralelo: "No tab open · 0", "Reading", "Internal failure · 500 ·
see log", "Server not answering · network/VPN", "0 writes logged", "Writes: off
on this connection", "Session ended · sign in", "Tree → table, or ⌘T".)

Paleta: dark `surface #1a1a19`, `ink #efefea` (15,1), `muted #a3a39b` (6,9),
`subtle #8b8b84` (5,1), `ok #5fb88a` (7,2), `danger #ff5c4d` (5,7),
`info #9db0ff` (8,4), `accent #f5a623` (8,6). Light `surface #ebebe6`,
`ink #111110` (15,8), `muted #4e4e4a` (7,0), `subtle #686862` (4,7),
`ok #1d6b45` (5,4), `danger #b42318` (5,5), `info #3446b0` (6,6),
`accent #8f5a08` (4,8).

Tipografia: **Geist** + **Geist Mono** (OFL, `@fontsource/geist-*`). Movimento:
quase nenhum; transições de 80–120 ms, sem easing elástico. Mascote: só a marca
plana, como "logotipo de fabricante" no canto. Ícones: quadrados, 1.5 px.

Risco: cinza neutro briga com o âmbar quente (o design-system já anota que
cinza neutro ao lado do âmbar puxa esverdeado); perde o calor que diferencia o
DBee; Geist virou default da Vercel e de muito template.

### Teste de plausibilidade

| Direção | Lembra | O que a distingue |
|---|---|---|
| A, Apicultor | TablePlus (quieto, nativo) com a voz do Panic | Âmbar com significado de escrita, a marca abelha-cilindro e a voz em pt e en de quem conhece o banco. Passa. |
| B, Enxame | Charm / Warp | Pouco. Um cliente web em mono com ASCII é o Charm sem o glamour. Fica com cara de tema, então só serve como fonte de easter egg. |
| C, Etiqueta | Teenage Engineering, ou qualquer template em Geist | Sem o hardware, a estética TE vira moodboard. Cinza neutro com Geist é o default da Vercel. Descartada como direção; aproveitam-se os números à vista. |

## Anti-padrões rejeitados

| Rejeitado | Por quê |
|---|---|
| Mascote 3D lustroso com confete | É a estética de gerador de imagem, mil apps têm igual, e brigava com a marca plana |
| Favo e hexágono como fundo | Kitsch, já removido (§4b) |
| Gradiente roxo/azul, mesh, glow, glassmorphism, blur no overlay | Assinatura de template de IA. Blur não ajuda a ler nada |
| Sparkles e emoji decorativo | Não informam nada e são o tique mais reconhecível de "feito por IA" |
| Título bicolor ("Bem-vindo **de volta**") | Põe âmbar fora da escrita e é clichê de landing |
| Slogans e tríades ("Poderoso. Simples. Seu.") | Caberiam em qualquer produto |
| Cartão com sombra grande, card dentro de card | Ruído de profundidade num app que precisa de densidade |
| Display gigante em toda tela | O app é Operate: a hierarquia vem do peso e do espaço, não do tamanho |
| Toast ou mascote comemorando consulta | Quem roda 200 consultas por dia veria 200 festas |
| Pun de abelha em mensagem de erro | Erro é o pior momento da pessoa e não é hora de piada |
| Mono em toda a UI (B) | Custa largura de rótulo e cansa em formulário |
| Tema customizável e escolha de fonte | Isso é o DBeaver. O DBee decide por você |

## Detalhes de ofício exigidos em qualquer direção

- Numerais tabulares (`font-variant-numeric: tabular-nums`) no grid, contagens e ms; número alinhado à direita.
- `NULL` em itálico `subtle`, diferente de string vazia (mostrada como `''`).
- Ícone de 16 px alinhado opticamente à altura-x do texto de 13–14 px (deslocamento de 1 px quando o ícone tem peso embaixo).
- Erro de Postgres sempre com `SQLSTATE` em mono, mensagem do servidor intacta e posição destacada no editor.
- Contraste medido (tabela acima), não estimado.

---

## 4. Recomendação: Direção A, "Apicultor"

- **É a que menos troca e mais ganha.** Mantém o mundo quente (bone, grafite,
  âmbar) que já é do DBee, corrige o `subtle` que reprova AA e tira a única
  peça claramente "gerada" (mascote 3D).
- **Personalidade onde não custa trabalho**: voz e bordas. O grid continua
  ferramenta pura, como pede o projeto.
- **Amarra a metáfora ao significado**: âmbar = ferrão = escrita. O "zumbido" só
  acontece em escrita confirmada, o que ensina a cor em vez de diluí-la.
- É a leitura mais fiel do eixo DBeaver → DBee: menos cromo, menos opção e
  mais voz.
- B fica como fonte de easter eggs (ASCII no console). C fica como fonte de
  disciplina (números à vista no rodapé do resultado).

### Plano em fatias (cada uma pequena e verificável)

Ordem pensada para não colidir com o trabalho de motion/modais em andamento:
nenhuma fatia mexe em `components/ui/Dialog` nem nos keyframes existentes antes
de a fatia de motion fechar.

1. **Tokens de contraste** (`index.css`): `subtle` dark `#8a8174`, light
   `#736a5e`; adicionar `--color-info`. Teste que trava os números (regra 7 do
   CLAUDE.md) e atualização do §1 do design-system. Screenshot nos 4
   breakpoints.
2. **Voz, lote 1** (`i18n/pt.ts`, `en.ts`): as 8 strings acima + um guia curto
   de voz no design-system (§8). Só texto; `en` tipado garante paridade.
3. **Tipografia**: `@fontsource/ibm-plex-sans` e `-mono` (pesos 400/500/600),
   trocar `--font-display` e `--font-mono`. Conferir largura do grid e da árvore
   em 375 e 1440 (Plex Sans é levemente mais estreita que Sora).
4. **Uma abelha só**: redesenhar as 5 poses do mascote no traço plano da marca
   (SVG, < 3 KB cada), substituir os `.webp` 3D em `features/mascote`. Remover
   `vitrine-login.webp` do app.
5. **Zumbido**: keyframe `zumbido` usando `--motion-base`, disparado pelo
   sucesso de mutação de escrita — **depois** da fatia de motion em andamento,
   reaproveitando os tokens dela.
6. **Bordas**: 404 e estados vazios da landing (`site/`) com a nova voz;
   console de boas-vindas; easter egg `SELECT 'bee'` (só texto no rodapé).
7. **Voz, lote 2**: varrer o resto do `pt.ts` (≈700 linhas) com o guia,
   priorizando erros (`erro.*`) — fato + próxima ação.

Fora de escopo agora (vai para `ATRITO.md` se for querido): som, temas
alternativos, mascote animado em Lottie.
