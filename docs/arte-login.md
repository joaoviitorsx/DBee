# Arte do login: exploração e decisão

Data: 2026-11-17. Dono: painel esquerdo de `AuthPanel` e `features/auth/CenaLogin.tsx`.
O formulário (lado direito) não faz parte deste doc.

## Problema

A cena anterior (abelha, três cilindros brancos, uma tabela, rastro pontilhado,
chão de pontos) não tinha ponto focal. Os elementos se espalhavam com o mesmo
peso, os cilindros só ficavam parados ali e nada contava uma história. Parecia
clipart de template.

## Referências

Usei para calibrar o ofício. Nenhuma foi copiada.

| Referência | O que tirei | URL |
|---|---|---|
| Stripe, ilustrações animadas do Connect | Movimento coreografado e curto, que explica o produto em vez de enfeitar | https://stripe.com/blog/connect-front-end-experience |
| Josh Comeau, guia interativo de paths SVG | `stroke-dashoffset` e `pathLength` como lápis | https://www.joshwcomeau.com/svg/interactive-guide-to-paths/ |
| CSS-Tricks, como funciona a animação de linha SVG | A técnica de traçar com `stroke-dasharray`/`dashoffset` | https://css-tricks.com/svg-line-animation-works/ |
| MDN, `offset-path` | Um objeto andando por um trajeto sem JS por quadro | https://developer.mozilla.org/en-US/docs/Web/CSS/offset-path |
| Teenage Engineering | Diagrama técnico seco como estética e humor impassível | https://teenage.engineering |
| Linear, changelog | Gráfico de lançamento monocromático com um único acento | https://linear.app/changelog |

As URLs não foram buscadas de novo nesta sessão porque a ferramenta web não estava carregada. São páginas públicas conhecidas e precisam de conferência antes de citar fora daqui.

## Três conceitos

**A. Consulta em favo (escolhido).** Uma consulta real é digitada, o rastro dela
desce até um favo traçado à mão, e cada célula acende com o dado de uma linha
do resultado. A abelha leva a consulta e pousa na última linha. A cena fecha com
`(4 rows)`, a saída do psql.

```
 select * from favo; ···.
 ─────────────────────────:──
 │   ⬡id ⬡nome ⬡mel ⬡kg    :
 4    ⬡1 ⬡jataí ⬡sim ⬡4.2  :
 │   ⬡2 ⬡uruçu ⬡sim ⬡7.9  .
 │    ⬡3 ⬡iraí ⬡não ⬡0.0 .
     ⬡4 ⬡mirim ⬡sim ⬡1.6🐝
   (4 rows)
```

Não é clichê porque o favo não é textura. É a grade de resultado, com cabeçalho e
valores reais, nomes de abelhas sem ferrão brasileiras. A regra de "favo
decorativo proibido" (§4b/§10) fica respeitada: cada célula é um campo. A
consulta é SQL de verdade, a cota "4" é a de um desenho técnico e o rodapé é o
do psql. Quem usa banco reconhece cada peça.

**B. Corte isométrico do servidor.** Um mini-servidor em isométrico preciso, com
consultas viajando como pólen por trilhos entre tabelas. Descartado: o
isométrico de servidor é o território mais batido de ilustração SaaS, puxa 3D
genérico e exige muito detalhe para não parecer stock.

```
      ◇───◇
     ╱ pg ╱│  ·→·→·  ◇──◇
    ◇───◇ │        ╱tbl╱│
    │   │ ◇       ◇──◇ ◇
```

**C. Página de caderno de engenharia.** Um diagrama ER em blueprint que se
desenha sozinho e ganha cor ao final. Descartado: diagrama ER promete uma
feature (ER editável) que o DBee recusa de propósito (identidade.md,
"restrição como identidade"). Além disso, blueprint azul brigaria com a paleta
âmbar/grafite. Aproveitei dele as linhas de cota e o traço de lápis.

```
 ┌favo──┐      ┌coleta┐
 │id  PK├──────┤favo FK│
 └──────┘      └──────┘
```

Escolhi A porque é o único dos três em que a animação **é** o produto: digitar,
consultar, ver as linhas chegando. Ele herda a precisão de C e evita a armadilha
de B.

## Coreografia

| t | Plano | Acontece |
|---|---|---|
| 0 a 0,7 s | fundo | linhas de cota são traçadas (`stroke-dashoffset`) |
| 0,25 a 1,0 s | frente | a consulta é digitada (clip com `steps(19)`), o cursor pisca |
| 0,95 a 2,25 s | frente | a abelha voa pelo rastro (`offset-path`) e o rastro é traçado junto |
| 1,15 a 1,9 s | meio | os hexágonos são traçados em sequência e o preenchimento entra depois do contorno |
| 1,75 a 2,5 s | meio | as linhas do resultado acendem, uma por vez |
| 2,1 s em diante | loop | o rastro pontilhado corre, a abelha paira (4,2 s), uma célula por vez "reatualiza" (ciclo de 9,9 s) |

`--cena-entrada: 2400ms` está travado em `lib/motion.test.ts`.

- **Planos:** fundo (cotas), meio (favo) e frente (consulta, rastro, abelha). A
  paralaxe desloca 4, 6 e 12 px. Só roda com `pointer: fine` e sem
  reduced-motion, com um `requestAnimationFrame` por movimento. É o único JS.
- **Reduced-motion:** as animações só existem dentro de `no-preference`. O
  estado base é o quadro final, com a abelha pousada e o resultado cheio.
- **Aba oculta:** `data-pausada="1"` pausa todas as animações.
- **Cor:** só tokens (`ink`, `muted`, `subtle`, `line`, `info`, `surface`,
  `raised`). O âmbar fica só na abelha, que é a marca. O rastro é `info`, a
  "fumaça".
- **< lg:** a mesma cena vira vinheta (`compacta`) de 144 px (192 em `sm`) acima
  do formulário, mostrando a consulta e o cabeçalho do favo. Em 375×667 o campo
  de usuário continua na primeira dobra.

## Rodadas de crítica

1. **Primeira renderização** (`~/dbee-shots/arte-login/r1-1440-dark.png`). As
   células cheias estavam a 16% de opacidade e não se liam, então o resultado
   não chegava. Uma célula interna aparecia fora do lugar, porque o `transform`
   do CSS apagava o atributo `transform` do SVG. A composição ficava baixa, com
   vazio grande em cima e embaixo. **Correção:** valores reais em mono dentro
   das células e hexágono interno calculado (sem transform). O viewBox foi
   recortado para a cena ocupar o painel.
2. **Segunda** (`r2-1440-dark.png`). Leu como tabela, e o ponto focal ficou
   claro. Mas a abelha cobria o "1.6" e a cota vertical atravessava o
   `(4 rows)`. **Correção:** o rastro termina na borda da última célula e a cota
   foi encurtada. No mobile, o recorte `slice` mostrava só pedaços de hexágono.
   Passei para `meet` com a vinheta mais alta.
3. **Frames da coreografia** (`coreografia-contato.png`). O favo aparecia como
   um fantasma preenchido antes de ser traçado, a abelha já estava parada na
   origem antes da consulta ser digitada e o rastro inteiro aparecia antes do
   voo. **Correção:** o preenchimento do hexágono só entra depois do contorno, a
   abelha surge no começo do voo e o rastro é traçado junto com ela. Os pontos
   correm só depois do pouso.

## Arquivos

- `apps/web/src/features/auth/CenaLogin.tsx`
- `apps/web/src/features/auth/AuthPanel.tsx`: vinheta abaixo de `lg`
- `apps/web/src/index.css`: bloco "Cena do login"
- `apps/web/src/lib/motion.test.ts`

---

# Troca de tema

Antes, o tema novo era revelado por um círculo que crescia a partir do botão. Funciona, mas qualquer site faz igual. O autor pediu um gesto que seja da marca.

## Três ideias

**A. Cortina de mel (escolhida).** A abelha sai do botão e cruza a janela em
arco até a meia altura, e o tema novo vem atrás dela como uma lâmina de mel. A
frente fica adiantada na altura da abelha e atrasada nas bordas, como mel
escorrendo.
```
 [botão]🐝·····
 ███████╲
 ████████🐝   ← frente puxada por ela
 ███████╱
```
**B. Rastro-máscara.** O traço que a abelha deixa engrossa e vira a máscara.
Descartada: um traço fino só cobre a tela inteira se engrossar muito no fim, e
aí vira um borrão. Também exige `mask` com SVG animado, mais caro de pintar que
`clip-path`.

**C. Acender a colmeia.** A abelha voa até um canto e a tela acende célula por
célula. Descartada: o favo viraria textura de fundo, que o §4b/§10 proíbe. E
800 ms de células piscando cansam quem troca de tema várias vezes.

Escolhi A porque cabe numa única curva interpolável (`clip-path: path()` com os
mesmos comandos em todos os quadros, `quadroDeMel`), tem um ponto focal só (a
abelha na frente da cortina) e não depende de partícula nem de brilho.

## Técnica

- **Recorte do tema novo:** `startViewTransition` e um `clip-path: path()` de 15
  quadros no `::view-transition-new(root)`.
- **Abelha:** um `<span>` fora da tela que só ganha
  `view-transition-name: abelha-tema` durante a troca. O voo é animado no
  `::view-transition-group(abelha-tema)`, acima dos dois snapshots. As asas
  continuam batendo porque o snapshot novo é ao vivo.
- **Direção:** botão na metade direita, ela voa para a esquerda (espelhada).
  Botão na metade esquerda, para a direita. Funciona de qualquer posição e no
  mobile.
- **Clique repetido:** `skipTransition()` conclui a troca em curso na hora e a
  próxima começa.
- **Sem a API ou com reduced-motion:** troca instantânea.
- **Duração:** `--motion-tema: 800ms`, travado em `motion.test.ts`.

## Crítica

1. **Primeiro quadro** (`~/dbee-shots/tema/teste.png`). Com o botão no topo, a
   abelha voava colada na borda de cima e a cortina virava um "S" gigante sem
   foco. **Correção:** a abelha desce em arco até a meia altura enquanto cruza,
   e a frente acompanha a altura dela.
2. **Frames de 0 a 100%** nos dois sentidos, em 1440 e 375 (`~/dbee-shots/tema/`).
   Ver o relatório.

## Rodada v2: feedback do autor e troca para "Poça de mel"

O autor testou no navegador e disse: "estranha, rápida demais para entender e não flexível. Tem ideia de tecido, mas não é". O diagnóstico foi este:

- 800 ms com 15 quadros interpolados linearmente davam uma frente dura.
- O "S" vertical lia como pano.
- A abelha corria descolada do mel.

Fiz duas versões com física (mola amortecida, ζ≈0,8, 40 quadros, 12 subpassos
por quadro, todas as curvas em Catmull-Rom → Bézier, sem bicos) e comparei as
duas lado a lado (`~/dbee-shots/tema/v2/comp-poca.gif` e `comp-cortina.gif`):

- **Cortina v2.** Cada ponto da frente segue a abelha com mola, e quanto mais
  longe da altura dela, maior o arrasto. Melhorou, mas continuou lendo como
  tecido: uma borda vertical que ondula é uma cortina, por mais viscosa que
  seja.
- **Poça (escolhida).** Uma gota nasce no botão e se espalha numa poça de borda
  orgânica: 18 pontos radiais, cada um com sua mola, mais rígida na direção da
  abelha e mais arrastada nos lados. Três lóbulos irregulares (fase pelo ângulo
  áureo, sem `Math.random`) se fundem conforme a poça assenta. A abelha voa
  colada à frente, um corpo adiante, e puxa o mel. Lê como líquido denso, não
  como pano.

Tempo: `--motion-tema` = 1300 ms. A abelha arranca, cruza e desacelera. As molas são mais macias na frente (k 60–170) para a poça se espalhar devagar, até ~800 ms, de forma visível. Antes ela cobria a tela em 640 ms e a troca parecia brusca
(easeInOutCubic em 82% do tempo). O mel vem atrasado (follow-through) e, a
partir de 55%, todos os pontos convergem para o raio final, com um leve
"settle" da mola. O WAAPI interpola linearmente entre os 41 quadros porque a
aceleração já está na física. O clique repetido continua chamando
`skipTransition()`.

GIFs em velocidade real e a 0,5x: `~/dbee-shots/tema/v2/troca-{dl,ld}-{1440,375}-1x.gif`
e `troca-{dl,ld}-1440-0.5x.gif` (dl = escuro→claro, ld = claro→escuro).
