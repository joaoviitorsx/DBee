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
| **Peso** | **171 KB** transferidos na primeira dobra — fontes 56 KB, `grid.webp` 73 KB, HTML+CSS+JS 27 KB em gzip, ícones 15 KB. Orçamento do agente da landing: 300 KB. Medido com `gzip -9` no texto e tamanho bruto no resto. O resto da página é `loading="lazy"`. |

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

`readme-banner.png` (1,2 MB) **não** foi copiado: dele saiu só `og.webp`
(22 KB, 1200×630), que é o único uso que ele teria aqui. O original continua em
`assets/` na raiz do repositório.

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
