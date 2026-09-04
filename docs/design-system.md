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

## 5. A linha de conexão

O componente que justifica o resto do sistema.

```
┌──────────────────────────────────────────────────────────────┐
│ ▌  Produção Assertivus                          [ESCRITA]  ⋯ │
│ ▌  postgres@10.0.0.4:5432/assertivus · America/Sao_Paulo     │
└──────────────────────────────────────────────────────────────┘
  ↑                                                  ↑
  tag de cor: 3px, a única cor saturada    selo só quando há risco
```

Hierarquia deliberada:

1. **Tag de cor** (`connections.color`) — barra sólida na borda esquerda. É a
   coisa que o olho pega antes de ler. Vermelho = produção, por convenção do
   usuário, e o sistema não impõe significado.
2. **Nome** — 16px/600.
3. **Selo de escrita** — âmbar sólido, `--accent-ink` por cima. **Só aparece
   quando `writeEnabled` é verdadeiro.** Read-only é o padrão e o estado seguro:
   não ganha selo, porque marcar o estado seguro treina o olho a ignorar o selo.
4. **Coordenadas** — mono, `--text-muted`, uma linha, sem quebrar.

Sem `.map()` direto quando a lista crescer: a virtualização é obrigatória
(`CLAUDE.md` regra 11). Hoje a lista é de dezenas; o componente já nasce numa
estrutura que aceita virtualizar sem redesenho.

---

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
- **Animação de entrada por seção no load.** Fade-and-slide-up em tudo que
  aparece é o tique visual de página gerada, e aqui não responde a nada.
- **Mais de um ciclo contínuo na tela.** Se a abelha voa, nada mais pisca.
