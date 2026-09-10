# site/ — a landing pública do DBee

Site estático, publicado no GitHub Pages por `.github/workflows/pages.yml`.
Duas páginas: a landing (`index.html`) e as docs demonstrativas (`docs/`).

Isto **não** é o app. O app vive em `apps/`, tem outro build (Vite) e outro
deploy (imagem Docker, por tag). As duas coisas não se falam: o que a landing
usa de `apps/` foi **copiado** para cá — fonte, imagem e tokens de cor.

---

## Rodar local

```bash
bun scripts/site-dev.ts          # http://localhost:4321
PORT=8080 bun scripts/site-dev.ts
```

Não há build, não há watch, não há reload. Salvou o arquivo, F5 no navegador.

**Por que não abrir o `index.html` direto no navegador:** por `file://` o
navegador não resolve `docs/` para `docs/index.html` (o link do cabeçalho
quebra) e trata cada arquivo como origem opaca. Servir por HTTP é o único jeito
de o que se vê localmente ser o que o Pages entrega.

## Medir a copy

```bash
bun scripts/site-copy.ts          # relatório, sai 1 se algo estourar
bun scripts/site-copy.ts --tudo   # lista todos os rótulos, não só os que estouram
```

"Não verboso demais, não complexo demais" não sobrevive à terceira edição do
texto se ficar na cabeça de quem escreveu: cada frase cresce um pouco, ninguém
percebe, e num ano a página é um documento. O script mede **todo rótulo da
landing** contra um teto por papel, e o teto não é gosto — é o ponto em que
aquele papel quebra na tela (título de seção acima de ~42 vira três linhas em
375px; item de motor acima de ~95 vira três linhas no cartão de 348px do
trilho). Estado de hoje:

| papel | teto | qtd | média | maior |
|---|---|---|---|---|
| kicker | 22 | 6 | 11 | 15 |
| título de seção | 42 | 7 | 30 | 36 |
| lede | 190 | 6 | 131 | 179 |
| nome de motor | 18 | 7 | 7 | 10 |
| estado de motor | 24 | 7 | 11 | 21 |
| item de motor | 95 | 36 | 29 | 85 |
| garantia de motor | 130 | 7 | 77 | 91 |
| título de cartão | 30 | 10 | 20 | 25 |
| corpo de cartão | 230 | 6 | 120 | 135 |
| botão | 26 | 5 | 10 | 12 |
| chip de motor | 32 | 7 | 16 | 20 |
| legenda de captura | 150 | 5 | 120 | 131 |
| rótulo de número | 62 | 4 | 31 | 53 |

**115 rótulos medidos, 0 fora do teto.**

## Capturar as telas

```bash
# Chrome headless, uma vez por sessão (Flatpak: só escreve dentro de $HOME)
flatpak run --filesystem=home com.google.Chrome \
  --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --remote-debugging-port=9223 --user-data-dir="$HOME/.dbee-chrome-site" \
  about:blank

bun scripts/site-shot.ts                    # 4 breakpoints × 8 paradas
bun scripts/site-shot.ts 375 /docs/ topo    # uma só
```

As imagens saem em `~/.dbee-shots/`. **Nunca em `/tmp`**: o Chrome deste
ambiente é Flatpak e só escreve dentro de `$HOME` — um caminho em `/tmp` falha
em silêncio parcial, o CDP devolve a imagem e nada aparece no disco.

---

## O domínio (CNAME) — a decisão pendente

`site/CNAME` está com **`dbee.joaoviitorsx.dev`**, que é um chute: o repositório
não declara domínio em lugar nenhum. Antes do primeiro deploy, escolha um dos
três:

1. **Tem domínio.** Troque a linha de `site/CNAME` e aponte um registro CNAME
   do subdomínio para `joaoviitorsx.github.io.` (com o ponto final).
2. **Tem domínio, mas não quer commitar.** Crie a variável de repositório
   `PAGES_DOMAIN` (Settings → Secrets and variables → Actions → Variables). Ela
   vence o arquivo.
3. **Não tem domínio.** Ponha `PAGES_DOMAIN` com o valor literal `none`: o
   workflow apaga o CNAME e o site sai em `joaoviitorsx.github.io/DBee`.

O site funciona nos três casos porque **todo caminho interno é relativo**
(`assets/…`, `docs/`), e caminho relativo é indiferente a estar na raiz do
domínio ou numa subpasta. A única exceção é `404.html`, que usa caminho
absoluto — ele é servido de qualquer profundidade de URL, e ali relativo
apontaria para um lugar diferente a cada erro.

---

## Regras que esta pasta obedece

| regra | onde ela aparece |
|---|---|
| **Sem CDN em runtime** | as duas fontes são `.woff2` em `assets/fonts/`, copiadas do `@fontsource-variable` que o app já usa. Zero `<script src="http…">`, zero `@import` externo. |
| **Estático de verdade** | sem servidor, sem API, sem build. O que está em `site/` é o que o Pages serve. |
| **Só afirma o que é verdade** | cada número e cada capacidade tem a origem citada na própria página (a classe `.src`) e um comentário no HTML apontando o arquivo. |
| **Movimento não atrapalha leitura** | `prefers-reduced-motion` desliga tudo sem esconder nada; o trilho horizontal vira pilha vertical abaixo de 1000×800. |
| **Peso** | **177 KB** transferidos na primeira dobra — fontes 56 KB, `grid.webp` 73 KB, HTML+CSS+JS 33 KB em gzip, ícones 15 KB. Orçamento do agente da landing: 300 KB. Medido com `gzip -9` no texto e tamanho bruto no resto. O resto da página é `loading="lazy"`. |

### O que a página faz de movimento

Referência de movimento: sites de piloto. O esqueleto é o do Dokploy; a
imersão é a de lá.

| efeito | onde | como |
|---|---|---|
| Cortina de entrada | topo | mascote "carregando", sai por translação, teto de 2 s |
| Título por caractere | H1 do herói | cada letra sobe de dentro de uma máscara, 26 ms de atraso com teto |
| Título por palavra | títulos de seção | cascata de 55 ms, revelada por `IntersectionObserver` |
| Saída do herói | primeira dobra | o bloco sobe mais devagar que a página e desbota |
| Barra de progresso | topo, fixa | `scaleX` do quanto já rolou |
| Índice de capítulo | canto inferior, ≥1100px | `01 / 09` + nome, troca com fade |
| Marquise de velocidade | entre o herói e "o que é" | anda sozinha e **acelera com a rolagem**; rolar para cima inverte |
| Inclinação por velocidade | marquise | `skewY` proporcional à velocidade, teto de 3,5° |
| Trilho horizontal preso | motores | a rolagem vertical vira deslocamento horizontal, com barra de progresso |
| Parallax com inércia | halo, mascotes | LERP de 0,085 sobre a distância ao centro da tela |
| Revelação por máscara | capturas | a imagem é descoberta de baixo para cima com `clip-path` |
| Contadores | números | sobem com `easeOutExpo` ao entrar na tela |
| Botão magnético | todos os CTAs | o botão é puxado pelo cursor; o conteúdo anda em contra-fase |
| Cursor com rótulo | trilho de capturas | vira pastilha âmbar escrita "arraste" |
| Índice que se retira | rodapé na tela | some quando a narrativa que ele numera acaba |
| Arraste com o ponteiro | trilho de capturas | além da rolagem nativa, que continua funcionando |
| Sobreposição de seções | todas | a seção seguinte sobe por cima com o canto arredondado |

Tudo em `transform`, `opacity` e `clip-path` — nada que force recálculo de
layout. Um único `requestAnimationFrame`, que **dorme** quando nada se move.

### O que NÃO tem aqui, e por quê

- **GSAP e Lenis.** A skill de referência os recomenda, e a regra do projeto
  proíbe CDN — vendorizá-los custaria ~90 KB de JS para fazer o que
  `assets/js/site.js` faz em ~7 KB. O que se perde (timeline declarativa,
  ScrollTrigger) esta página não usa.
- **Scroll hijacking.** O padrão Lenis (um wrapper com `translate3d` por rAF)
  daria mais inércia e quebraria `position: sticky`, a busca do navegador, o
  Page Down e o gesto de toque. A rolagem aqui é a nativa; o peso vem de LERP
  nos elementos.
- **Menu sanduíche.** Abaixo de 860px os links de âncora somem e ficam só
  "Docs" e "GitHub". Rolar já é a navegação no telefone, e a página tem nove
  seções em ordem narrativa.
- **Versão em inglês.** Ou ela é completa ou não existe (regra do agente da
  landing). Hoje não existe.
- **Sitemap e canonical.** Os dois exigem URL absoluta, e o domínio ainda não
  está decidido. Um canonical apontando para o domínio errado desindexa o
  certo.

---

## Estrutura

```
site/
├── index.html              landing — 9 seções
├── 404.html                caminhos absolutos (servida de qualquer URL)
├── CNAME                   ver "O domínio" acima
├── robots.txt
├── .nojekyll               impede o Pages de processar como Jekyll
├── docs/index.html         docs demonstrativas — 9 capítulos
└── assets/
    ├── css/site.css        tokens + a landing inteira
    ├── css/docs.css        só a camada de documento
    ├── js/site.js          motor de movimento, sem dependência
    ├── fonts/*.woff2       Sora e Space Grotesk, subset latin
    └── img/                mascote, marca e capturas reais do produto
```

Ferramentas, fora de `site/` (não vão para o Pages):

```
scripts/site-dev.ts     servidor estático local, 127.0.0.1:4321
scripts/site-shot.ts    captura nos 4 breakpoints + trava de rolagem horizontal
scripts/site-copy.ts    mede toda label contra o teto do papel dela
```

`readme-banner.png` (1,2 MB) **não** foi copiado: dele saiu só `og.webp`
(22 KB, 1200×630), que é o único uso que ele teria aqui. O original continua em
`assets/` na raiz do repositório.

---

## O que envelhece aqui quando o produto anda

A landing afirma estado de produto, e estado de produto muda. Estes são os
pontos que **precisam** ser revisados junto com a fatia que os mexe — cada um
já ficou desatualizado uma vez, dentro da mesma sessão em que a página nasceu
(o libSQL saiu de "em construção" para leitura completa enquanto ela era
escrita).

| se mudar isto | atualize |
|---|---|
| `ENGINES_IMPLEMENTADAS` (`packages/shared/src/engine.puro.ts`) | o chip da faixa, o cartão do motor, a tabela das docs §6, **e o contador "motores falando hoje"** |
| `CAPACIDADES` de qualquer engine | o que o cartão daquele motor lista em "faz" e em "não faz" |
| A tabela §1 do `docs/multi-engine.md` | a matriz de garantias da home e a coluna "garantia" das docs |
| A versão em `package.json` | o selo do herói e a linha do rodapé (dois lugares, os dois marcados com comentário `fonte:`) |
| Os números medidos em `migrations/006_audit_indexes.sql` | o cartão de `0,093 ms` |
| Os formatos de exportação | o cartão "Exportação em stream" e o contador `5` |

A regra que evita o pior caso: **um cartão de motor nunca lista só o que a
engine faz.** Toda vez que ele lista, a linha `data-no` do que ela não faz é o
que impede a página de virar promessa. Foi o que aconteceu com a linha do
libSQL na tabela das docs, onde a coluna "Não faz" chegou a listar coisas que
ele faz.

---

## Defeitos que só a captura pegou

Ficam registrados porque o padrão importa mais que o item: os três passaram por
HTML válido, CSS válido e a página abrindo sem erro no console.

1. **`scrollWidth` 587 num viewport de 375.** A tabela de garantias tem
   `min-width: 560px` dentro de um `overflow-x: auto`, e item de grid nasce com
   `min-width: auto` — ele se recusou a encolher e esticou a página inteira. O
   `overflow-x: hidden` do body escondeu a barra, então a página *parecia*
   certa; mas o cabeçalho é `position: fixed` e se dimensiona pelo viewport de
   layout, então "Docs" e "GitHub" ficaram em x=414 e x=478, fora da tela.
   Conserto: `min-width: 0` (seção 5b do `site.css`). Travado por uma asserção
   em `scripts/site-shot.ts`, que roda a cada captura — desligar o conserto faz
   as capturas falharem com o número.

2. **O botão "Copiar os três comandos" era invisível.** Ele vive na seção creme
   e herdava `color: var(--ink)`, que é `#F7F3EC` — o mesmo do fundo. Contraste
   medido: **1,00:1**. A borda aparecia, o rótulo não. O clique funcionava, o
   texto estava no DOM, e nenhum teste de comportamento teria como notar.

3. **`<li>` com `display: flex` desmontou o texto do cartão do MariaDB.** Num
   item de flex, cada `<code>` inline vira um item de flex próprio: a frase
   virou colunas ("Driver / SEQUENCE / no / BLOB / próprio / catálogo,"). A
   frase inteira estava no DOM, na ordem certa.

4. **As quatro capturas do produto ficavam invisíveis para sempre.** A
   revelação por máscara punha `clip-path: inset(0 0 100% 0)` no próprio
   elemento observado — e um elemento totalmente cortado tem retângulo visível
   VAZIO, então o `IntersectionObserver` o reporta como fora da tela
   (`intersectionRatio: 0`) enquanto o `getBoundingClientRect` diz que ele está
   a 48px da borda. Impasse: sem `is-in` o corte nunca abre, e sem o corte
   aberto o observador nunca dispara. Conserto: o `data-fx="mask"` mora no
   `<figure>`, que a legenda impede de ficar vazio, e o corte cai só na `<img>`
   dentro dele. Zero erro no console, nos dois estados.
