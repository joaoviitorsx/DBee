# DBee — Design System

Fonte: os arquivos em `assets/`. Nada aqui foi inventado: cada token sai da marca
ou de uma restrição do `DBee.md`.

> **Regra de ouro:** este é um cliente de banco de produção. A tela existe para
> deixar óbvio **em qual banco você está** e **se ele aceita escrita**. Toda
> decisão visual abaixo serve a isso; o que não serve foi cortado.

> **Regra do documento:** todo número afirmado aqui — razão de contraste, peso,
> tamanho, duração — precisa de teste que o trave, ou não entra. Sem isso o doc
> vira folclore: na primeira escrita deste arquivo os contrastes foram estimados
> de cabeça e quatro dos sete estavam errados (16.3:1 virou "14.8:1", 8.9:1
> virou "13.1:1"). Ninguém teria percebido. Hoje `contrast.test.ts` quebra o
> build se um token mudar.

---

## 1. Cor

### 1.1 Base — as cinco da marca

O `assets/README.txt` define cinco valores. Eles são a fundação e não mudam.

| Token | Hex | Origem | Uso |
|---|---|---|---|
| `--amber` | `#F5A623` | corpo/cabeça/antenas da abelha | acento único |
| `--graphite` | `#1C1917` | listras, versão mono | traços sobre claro |
| `--plate` | `#191612` | placa do ícone de app | superfície |
| `--bone` | `#F7F3EC` | mono sobre escuro | texto |
| `--amber-wing` | `rgb(245 166 35 / .55)` | asas, âmbar a 55% | estados suaves |

### 1.2 Escala de superfície

`#191612` é o fundo da placa. Uma interface precisa de mais de um nível, então a
escala estende a placa nos dois sentidos mantendo o mesmo matiz quente
(H≈33°) — cinza neutro ao lado do âmbar puxa esverdeado.

| Token | Hex | Uso |
|---|---|---|
| `--surface-sunken` | `#141210` | fundo da janela |
| `--surface` | `#191612` | painéis, a placa da marca |
| `--surface-raised` | `#221E19` | linhas, campos, cabeçalhos |
| `--surface-overlay` | `#2A251F` | menus, popovers, hover |

**Nunca `#000000`.** A marca tem fundo `#191612`, não preto: preto puro ao lado
de `#191612` faz a placa parecer suja.

### 1.3 Texto

| Token | Hex | Contraste sobre `--surface` | Uso |
|---|---|---|---|
| `--text` | `#F7F3EC` | 16.3:1 | corpo, nomes |
| `--text-muted` | `#A79E90` | 6.8:1 | rótulos, metadados |
| `--text-subtle` | `#7A7166` | 3.8:1 | **só texto grande ou desativado** — reprova AA em 14px |

### 1.4 Semântica

| Token | Hex | Significa |
|---|---|---|
| `--accent` | `#F5A623` | marca, foco, **modo escrita** |
| `--accent-ink` | `#191612` | texto sobre âmbar sólido (8.9:1) |
| `--ok` | `#5FA777` | teste passou, conexão viva |
| `--danger` | `#E5484D` | apagar, falha, erro do Postgres |
| `--border` | `#2E2822` | divisórias |
| `--border-strong` | `#3D352C` | borda de campo, foco em repouso |

**O âmbar é o único saturado que a interface produz.** Se aparecer em dois
lugares na mesma tela sem relação entre eles, um dos dois está errado. As tags
de cor das conexões são exceção — a cor ali é dado do usuário, não decoração.

### 1.5 Contraste — verificado em teste

Os números acima são medidos, não estimados, e ficam travados por
`apps/web/src/lib/contrast.test.ts`. Mexeu em token, `bun test` acusa.

| Par | Razão | AA |
|---|---|---|
| `ink` / `surface` | 16.3:1 | ✓ |
| `accent-ink` / `amber` | 8.9:1 | ✓ |
| `amber` / `surface` | 8.9:1 | ✓ |
| `muted` / `surface` | 6.8:1 | ✓ |
| `ok` / `surface` | 6.3:1 | ✓ |
| `danger` / `surface` | 4.6:1 | ✓ |
| `subtle` / `surface` | 3.8:1 | só texto grande |

`--text-subtle` é o único que não passa AA em texto normal, e isso é decisão,
não descuido: ele só carrega texto auxiliar que também existe em outro lugar. O
teste trava a faixa entre 3:1 e 4.5:1 justamente para o uso dele não escorregar
para texto essencial sem ninguém notar.

---

## 2. Tipografia

### 2.1 Famílias

| Papel | Família | Por quê |
|---|---|---|
| Display / UI | **Sora** | é a do lockup (`assets/README.txt`: Sora SemiBold, tracking -2.5%) |
| Dados | **mono** | `host:porta/database` se lê em coluna; alinhamento é informação, não estilo |

Duas famílias, claramente distintas. Sora tem contrapunção geométrica e resolve
bem em peso 600; a mono só aparece onde há valor técnico literal.

> **Pendência:** `CLAUDE.md` proíbe CDN em runtime, então Sora precisa ser
> bundlada (`@fontsource/sora`, ~40 KB por peso) — dependência ainda não
> aprovada. Enquanto isso a pilha cai em `ui-sans-serif`. O sistema de tokens já
> está pronto para a troca: só muda `--font-display`.

### 2.2 Escala

Razão 1.25 (terça maior), ancorada em 14px — densidade de ferramenta, não de
site. Base 16px seria confortável e caberia menos conexão na tela.

| Token | px | Uso |
|---|---|---|
| `--text-2xs` | 11 | selos, contadores |
| `--text-xs` | 12 | metadados, rótulos de campo |
| `--text-sm` | 14 | **base** — corpo, campos, linhas |
| `--text-base` | 16 | nome da conexão |
| `--text-lg` | 20 | título de painel |
| `--text-xl` | 25 | título de página |

Nada abaixo de 11px, e 11px só em texto não essencial que também existe como
rótulo acessível.

### 2.3 Pesos e tracking

- 400 corpo · 500 ênfase · 600 títulos e o wordmark
- Tracking `-0.025em` em 20px+ (o do lockup). Em texto pequeno, `0`.
- Altura de linha 1.5 no corpo, 1.2 nos títulos.

---

## 3. Espaço, raio, traço

**Escala 4px.** Denso por decisão: `--space-1` 4 · `2` 8 · `3` 12 · `4` 16 ·
`6` 24 · `8` 32 · `12` 48.

**Raio comedido.** O ícone de app tem cantos arredondados generosos; a interface
não. Raio grande em tudo é o visual de kit de SaaS.

| Token | px | Onde |
|---|---|---|
| `--radius-sm` | 4 | selos, campos |
| `--radius` | 6 | botões, linhas |
| `--radius-lg` | 10 | painéis |
| `--radius-brand` | 22% | **só** a placa da marca |

**Traço 1px, sempre `--border`.** Sem sombra difusa como separador: no escuro
ela vira borrão. Profundidade vem da escala de superfície, não de sombra.
Sombra existe só onde há sobreposição real (overlay), e é dura e curta.

---

## 4. O motivo estrutural: os cortes

A marca tem listras que são **cortes reais** — o fundo aparece através delas.
Traduzido para a interface: as divisórias da lista são o mesmo gesto. Uma
hairline de 1px que deixa o fundo passar, nunca uma linha "desenhada por cima".

Isso é o único elemento decorativo herdado, e ele carrega função: separar
registros. Sem favo de mel, sem abelha ilustrada, sem hexágono de fundo — o
caminho curto para kitsch.

---

## 5. As três zonas

A conexão **não é uma página**. Ela é a raiz da navegação, e a tela inteira é um
shell de três zonas que nunca se troca por outra.

```
┌──────────────┬────────────────────────────────────┬──────────────┐
│ busca        │ [aba] [aba] [aba]                  │  Inspetor    │
├──────────────┼────────────────────────────────────┤  (fechado    │
│ ▸ conexão    │ Dados | Estrutura | Índices        │   por        │
│   ▾ database │ ─────────────────────────────────  │   padrão)    │
│     ▾ schema │ coluna   tipo   nulo   default     │              │
│       tabela │ ...                                │              │
│              │                                    │              │
│ + Nova       │                                    │              │
└──────────────┴────────────────────────────────────┴──────────────┘
   ~260px          flex                                 ~280px
   redimensionável                                      colapsável
```

A versão anterior tratava "Conexões" como página, e todo caminho para os dados
exigia sair dela — beco sem saída numa ferramenta cujo trabalho é chegar aos
dados.

### 5.1 Árvore

`conexão → database → schema → relação`. Quatro níveis, indentação de 12px.

**Expansão lazy é requisito, não otimização.** Cada conexão expandida custa uma
ida ao Postgres; cada database custa uma introspecção de catálogo inteira.
Buscar tudo de antemão abriria conexão em todo banco de produção cadastrado no
instante em que a tela carrega, inclusive nos que ninguém vai tocar hoje. A
decisão de o que buscar mora em `features/tree/plan.ts`, separada do componente
para ser verificável sem montar React.

| Nível | Ícone | Estado |
|---|---|---|
| conexão | tomada | ponto de saúde: verde conectada, vermelho erro, cinza não testada |
| database | cilindro | marca "padrão" no database da conexão |
| schema | ponto | contagem de relações |
| table | grade | — |
| view | olho, em `--text-subtle` | — |
| materialized view | camadas, em `--color-ok` | — |

Ícone distinto por tipo é obrigatório: view e tabela se comportam de forma
diferente e confundi-las custa uma query errada.

**Ações da conexão vivem em menu de contexto**, não em botões na linha. Numa
árvore, botão por linha compete com o alvo de clique que importa — expandir.

### 5.2 Abas

Aba de tabela e aba de query convivem na mesma faixa. A de query ainda não é
criada por nenhum caminho; o tipo já existe no estado para o executor nascer
dentro deste shell em vez de virar uma tela a refazer.

- **Id determinístico pelo alvo**: reabrir a mesma tabela foca a aba existente.
- **Estado preservado** ao alternar: sub-aba e coluna selecionada sobrevivem.
- **Fechar foca a vizinha** da direita, ou a da esquerda se era a última.
- Sub-abas da tabela: `Dados` (placeholder até o executor) · `Estrutura` ·
  `Índices`.

### 5.3 Responsivo

**Abaixo de 1024px, árvore e inspetor viram sobreposição.** Como colunas fixas,
em 375px sobravam ~115px para o centro — a tela do meio simplesmente
desaparecia. Sobrepostas, elas somem quando não estão em uso e o centro fica
inteiro. A árvore ganha um botão na barra superior, e escolher uma relação
fecha a gaveta.

> ⚠️ **Verificação incompleta — corrigido em 2026-09-05.** A afirmação anterior
> ("verificado em 375 · 768 · 1024 · 1440") era **falsa**: os quatro screenshots
> foram tirados com o inspetor **fechado** e nenhuma aba aberta, que é o estado
> em que o layout não tem como quebrar.
>
> Com o inspetor aberto em 375px, ele ocupa ~300px de 375, **cobre a barra
> superior inteira** — inclusive o nome do banco ativo, que o §6b declara
> permanentemente visível — e deixa ~72px de centro. Não há *scrim* para
> fechá-lo, ao contrário da árvore. E `selectColumn` abre o inspetor sozinho,
> então o gesto normal de leitura é o que enterra o conteúdo.
>
> Screenshot da falha: `bp-375-inspetor.png`. Registrado em `ATRITO.md`.
>
> **Lição de método:** screenshot de estado vazio não verifica layout. O estado
> a fotografar é o mais cheio que a tela alcança, não o mais limpo.

### 5.4 Menu de contexto

Botão direito em **qualquer** nó da árvore e em qualquer aba. Um componente só
(`components/ContextMenu.tsx`), porque um menu por lugar diverge em espaçamento,
ordem e teclado.

- Reposiciona para caber na janela — perto da borda é justamente onde se clica
  quando a árvore está cheia.
- Navegação por seta e `Enter`, `Esc` fecha.
- **Cada nível oferece só o que faz sentido nele.** Menu com item inútil treina
  o usuário a não ler o menu — e um menu que ninguém lê é pior que menu nenhum,
  porque ocupa o gesto sem entregar a ação.
- Ação destrutiva vai por último, em seção própria, com tratamento de perigo.

| Nó | Ações |
|---|---|
| conexão | testar · editar · ‖ excluir |
| database | recarregar catálogo · copiar nome |
| schema | copiar nome |
| relação | abrir · ‖ copiar nome qualificado · copiar nome · copiar colunas |
| aba | fechar · fechar as outras · fechar todas |

O nome **qualificado** vem antes do simples: é o que se cola numa query.

### 5.4b Editor e grid

**Editor** — CodeMirror com `lang-sql` no dialeto Postgres. Tema e realce
escritos à mão: um tema pronto traria uma segunda paleta competindo com a da
marca dentro do mesmo painel. O âmbar marca a palavra-chave — ler SQL é achar o
verbo.

- `Cmd+Enter` roda **o statement sob o cursor**; `Cmd+Shift+Enter`, o script.
- A escolha do statement usa `splitStatements` de `packages/shared`, **a mesma
  função do servidor**. Duas implementações divergiriam no SQL estranho
  (dollar quoting, `;` dentro de string) e o editor destacaria um trecho
  enquanto o banco executaria outro.

**Grid** — virtualizado (`CLAUDE.md` regra 11), nunca `.map()` direto sobre as
linhas. Três coisas precisam ser distinguíveis a olho:

| valor | tratamento |
|---|---|
| SQL `NULL` | `NULL` em itálico, `--text-subtle` |
| string vazia | a palavra `vazio`, itálico, mais apagada |
| a string `"NULL"` | texto normal — ela aparece de verdade dentro de `{a,NULL,b}` (§11.14) |

**Alinhamento pelo tipo real.** Numérico à direita; o resto à esquerda. Número
alinhado à esquerda obriga a contar dígitos para comparar duas linhas. O tipo
vem de `format_type`, então `numeric(12,2)` perde o parâmetro antes da
comparação.

### 5.4c Sem chave primária, a UI avisa

A sub-aba Dados pagina por keyset sobre a PK. Sem PK isso é impossível, e a
faixa de alerta diz exatamente isso: *"Sem chave primária: navegação limitada.
A ordem entre páginas pode repetir ou pular linha."*

Fingir que a navegação funciona é o que faz o usuário confiar numa lista
incompleta — e numa ferramenta de conferência de dado, lista incompleta é a
pior saída possível.

### 5.5 Inspetor

Zona direita, **começa fechada** e abre quando há o que inspecionar —
selecionar uma coluna abre. Fechar é ação do usuário; limpar a seleção não
fecha, porque fechar sozinho no meio de uma leitura é o tipo de coisa que faz o
usuário perder o lugar.

## 6. Estados

Cada componente interativo declara os seis. Faltando um, não está pronto.

| Estado | Tratamento |
|---|---|
| repouso | `--surface`, borda `--border` |
| hover | fundo `--surface-raised`, 150ms |
| foco | anel `--accent` 2px, offset 2px — **nunca removido** |
| ativo | `--surface-overlay`, sem deslocamento |
| desativado | 45% de opacidade, `cursor: not-allowed` |
| carregando | rótulo trocado pelo verbo no gerúndio + spinner; largura preservada |

**Foco visível é inegociável.** A ferramenta é operada por teclado.

---

## 6b. Estado de perigo

Conexão com `write_enabled = 1` é **alerta persistente**, não etiqueta.

| Token | Hex | ΔE / contraste medido |
|---|---|---|
| `--color-danger-surface` | `#2a1614` | ΔE 0.038 vs `--surface` |
| `--color-danger-raised` | `#3a1c19` | ΔE 0.043 vs danger-surface |
| `--color-danger-line` | `#5c2b26` | ΔE 0.133 vs danger-surface |
| `--color-danger-ink` | `#ff9d9d` | 8.6:1 sobre danger-surface |

Texto normal sobre a superfície de perigo: **15.5:1**. Travado em
`contrast.test.ts`.

**Razão de contraste é a métrica errada aqui.** A superfície de perigo e a
normal têm luminância parecida de propósito, para o texto continuar legível nas
duas; o que muda é o matiz. Quem mede isso é ΔE em OKLab, e é ele que o teste
usa — 0.038, acima do limiar de ~0.02 em que a diferença passa a ser notada.

Onde o alerta aparece, em ordem de permanência:

1. **O nó inteiro da árvore** em tom de perigo, com borda — não uma barra de
   2px. O olho precisa pegar de relance numa árvore de cem nós.
2. **Toda aba** sobre aquela conexão herda a tarja no topo.
3. **A barra superior inteira** vira alerta, com o selo "Escrita habilitada".
4. **O nome do banco ativo** fica visível permanentemente na barra superior,
   sem exigir busca.

O usuário nunca deve precisar procurar em qual banco está.

## 7. Movimento

Discreto, e só como resposta a um estado real. Nada anima por decoração, e nada
se mexe numa tela parada.

- 150ms hover e cor · 200ms entrada de painel · 900ms–2,4s os ciclos de espera
- `cubic-bezier(0.16, 1, 0.3, 1)` na entrada; saída mais rápida que a entrada
- Só `transform` e `opacity` — nunca `width`/`height`
- `prefers-reduced-motion: reduce` zera tudo, sem exceção

### O gesto assinatura: a abelha voa

O app espera com a própria marca, não com um spinner genérico. As asas do
`dbee-mark.svg` já são dois caminhos separados a 55% de opacidade — animá-las é
mover o desenho que existe.

| Animação | Onde | Quando |
|---|---|---|
| `animate-wing` + `animate-hover` | a marca na barra lateral | **só** enquanto há requisição em voo |
| `animate-shimmer` | `Skeleton` | primeiro carregamento da lista |
| `animate-probe` | tag de cor da linha | aquela conexão está sendo testada |
| `animate-settle` | selo de resultado | o resultado acabou de chegar |

Duas escolhas deliberadas:

1. **A marca só voa quando o app está ocupado de verdade** — `useIsFetching() +
   useIsMutating()`, estado global, não um `isPending` local. Abelha voando à
   toa vira enfeite e o olho para de acreditar nela.
2. **Quem pulsa durante o teste é a tag de cor da conexão**, não um spinner ao
   lado. A tag já significa "esta conexão"; animá-la responde *qual* está sendo
   testada sem acrescentar um elemento novo à linha.

O botão continua com spinner comum: a 14px o desenho da abelha não resolve, e
inventar uma segunda animação de marca para caber ali seria o começo da
proliferação que a §10 recusa.

### São três estados de carregamento — e só três

> ⚠️ **Os três estão MORTOS desde a fatia do shell de três zonas
> (2026-09-05).** `Mark flying` não tem chamador, `animate-probe` não é usado
> por componente nenhum, `ConnectionsSkeleton` foi **apagado** junto com a
> antiga página de conexões, e `animate-settle` ficou sem uso. `useIsFetching`
> saiu junto com o `App.tsx` antigo.
>
> Foram perdidos na migração e o documento não acompanhou — exatamente o que o
> `CLAUDE.md` chama de "doc desatualizado é pior que doc ausente", cometido por
> quem escreveu a regra. A seção abaixo descreve a **intenção**, que continua
> válida; a implementação precisa voltar. Registrado em `ATRITO.md`.

| Estado | Componente | Responde a |
|---|---|---|
| marca em voo | `Mark flying` na barra lateral | há requisição em voo, em qualquer lugar |
| tag pulsando | `animate-probe` na linha | **aquela** conexão está sendo testada |
| esqueleto | `ConnectionsSkeleton` | a lista ainda não chegou |

Cada um responde a uma pergunta diferente: *o app está ocupado?*, *qual item
está ocupado?*, *o que vai aparecer aqui?*. Juntos cobrem os casos.

**Um quarto estado precisa justificar por que os três não servem.** Chegou a
existir um `BeeLoader` de região — abelha voando no meio da tela — e foi
apagado: a lista já usa esqueleto, a barra lateral já responde por "ocupado", e
o botão já tem spinner inline. Ele não respondia a pergunta nenhuma que os
outros não respondessem, e um loader a mais é um vocabulário a mais que o
usuário precisa aprender sem ganhar nada.

### Esqueleto, não spinner, na primeira carga

A lista carrega com `ConnectionsSkeleton`, que espelha a altura e o ritmo das
linhas reais. Spinner centralizado não reserva espaço e a página salta quando os
dados chegam (CLS). O esqueleto herda as mesmas divisórias — os cortes da marca.

---

## 8. Escrita

`CLAUDE.md`: o erro do Postgres é informação útil, não ruído a esconder.

- **Verbo no botão, e o mesmo verbo depois.** "Testar conexão" → "Testando…" →
  "Conectou". Nunca "Enviar".
- **Erro diz o que houve e o que fazer.** O `code` e a `message` do Postgres
  aparecem literais; a interface acrescenta o próximo passo, não desculpa.
- **Vazio é convite.** "Nenhuma conexão ainda. Cadastre a primeira para começar
  a consultar." — não "Sem dados".
- Frase capitalizada, sem CAIXA ALTA travada, sem ponto final em rótulo.
- Português, primeira pessoa do plural evitada. A interface não fala "nós".

---

## 9. Acessibilidade — piso obrigatório

- [ ] Texto ≥ 4.5:1, elementos de UI ≥ 3:1
- [ ] Alvo de toque ≥ 44×44px
- [ ] Toda ação por ícone tem `aria-label`
- [ ] Foco visível e ordem de tabulação previsível
- [ ] Cor **nunca** é o único portador de significado: a tag de conexão sempre
      acompanha o nome; o modo escrita tem texto, não só âmbar
- [ ] `prefers-reduced-motion` respeitado
- [ ] Responsivo em 375 / 768 / 1024 / 1440

---

## 10. O que este sistema recusa

Registrado para não voltar por engano:

- **Fundo preto puro** — briga com a placa `#191612` da marca.
- **Cards arredondados idênticos com sombra cinza.** A lista é uma lista.
- **Rótulo em CAIXA ALTA acima de cada seção.**
- **Meta em `A · B · C` com ponto médio** em toda parte. As coordenadas usam um
  separador porque são um endereço, não porque fica bonito.
- **Gradiente como decoração.** Nenhum gradiente que não represente dado.
- **Favo de mel, hexágono, abelha ilustrada.** A marca já é a abelha; repeti-la
  no cenário é redundância.
- **Selo no estado seguro.** Marcar read-only tornaria o selo de escrita
  invisível por hábito.
- **Âmbar sólido em qualquer coisa que não seja modo escrita.** O selo de PK
  nasceu com `tone="write"` e dizia "escrita" para o olho numa aba de índices.
  Virou contorno âmbar sobre superfície elevada. A regra do §1.4 não tem
  exceção.
- **Selo com palavra inteira competindo com o nome numa barra de 260px.** O selo
  "Escrita" comia metade do nome da conexão (`Produção Ass…`), e saber **qual**
  conexão está gravável é todo o ponto do estado de perigo. O nome é o
  identificador; o selo é qualificador, e vira ícone quando o espaço aperta.
- **Ponto de cor ao lado de ponto de estado.** A tag de cor da conexão era um
  ponto a poucos pixels do indicador de saúde, que também é um ponto: verde lia
  como "conectada", vermelho como "erro" — vocabulários opostos na mesma forma.
  A tag virou barra vertical na borda.
- **Tabela esticando por toda a largura da tela.** A coluna "Referência"
  acabava longe demais da coluna "Coluna". Ler uma linha não pode exigir
  varredura horizontal.
- **Seleção de texto com a mesma cor sólida de um selo.** `::selection` era
  âmbar sólido com tinta escura — exatamente `bg-amber text-accent-ink`, o selo
  de escrita. Dar duplo clique num nome pintava a palavra como se fosse um selo
  sem padding, e a tela passava a afirmar um estado de conexão que não existia.
  Selo é informação; seleção é interação. Travado em `selection.test.ts`.
- **Animação de entrada por seção no load.** Fade-and-slide-up em tudo que
  aparece é o tique visual de página gerada, e aqui não responde a nada.
- **Mais de um ciclo contínuo na tela.** Se a abelha voa, nada mais pisca.
