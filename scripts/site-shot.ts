/**
 * Screenshot da landing (`site/`) nos quatro breakpoints — CLAUDE.md §4b.
 *
 * A landing é fatia de UI, então ela não fecha sem captura. Diferente do
 * `headless-shot.ts`, aqui NÃO existe sessão para mintar: o site é estático e
 * não tem login. O que este script faz é o resto do caminho:
 *
 *   1. sobe um servidor estático em cima de `site/` com `Bun.serve` — o mesmo
 *      jeito de servir que a pessoa vai usar localmente, então a captura é do
 *      que o Pages vai entregar, não de um `file://` que se comporta diferente
 *      (o `file://` bloqueia `fetch`, quebra caminho absoluto e não resolve
 *      diretório para `index.html`);
 *   2. conversa com um Chrome headless por CDP e fotografa.
 *
 * ATENÇÃO AO CHROME DESTE AMBIENTE: ele é Flatpak e só escreve dentro de
 * `$HOME`. A saída padrão é `~/.dbee-shots/`. Um caminho em `/tmp` falha em
 * silêncio parcial — o CDP devolve a imagem, mas nada aparece no disco onde se
 * espera.
 *
 * Chrome, uma vez por sessão:
 *   flatpak run --filesystem=home com.google.Chrome \
 *     --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
 *     --remote-debugging-port=9223 --user-data-dir="$HOME/.dbee-chrome-site" \
 *     "about:blank"
 *
 * Uso:
 *   bun scripts/site-shot.ts                      # os 4 breakpoints, home + docs
 *   bun scripts/site-shot.ts 375 /docs/ topo      # uma captura só
 *
 * O terceiro argumento é onde parar antes de fotografar: `topo`, um número de
 * pixels, ou um seletor CSS (a página rola até ele).
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RAIZ = new URL("../site/", import.meta.url).pathname;
const CDP = process.env["DBEE_SHOT_CDP"] ?? "http://localhost:9223";
const PORTA = Number(process.env["DBEE_SITE_PORT"] ?? 5273);

/**
 * A saída fica em `$HOME` por imposição do Flatpak, não por gosto. Deixar o
 * padrão em `/tmp` seria um script que "funciona" e não produz arquivo.
 */
const SAIDA = process.env["DBEE_SHOT_DIR"] ?? join(homedir(), ".dbee-shots");
mkdirSync(SAIDA, { recursive: true });

/* ---------------------------------------------------------------------------
 * 1. Servidor estático
 * ------------------------------------------------------------------------- */
const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const servidor = Bun.serve({
  port: PORTA,
  /*
   * `127.0.0.1`, nunca `0.0.0.0`.
   *
   * O padrão do `Bun.serve` é escutar em todas as interfaces, e isso poria a
   * pasta `site/` na rede local de quem rodasse o script num café. É o mesmo
   * princípio do `docs/operacao.md`: nada bindado em 0.0.0.0 por descuido.
   */
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    let caminho = decodeURIComponent(url.pathname);
    if (caminho.endsWith("/")) caminho += "index.html";

    /*
     * Normaliza antes de juntar com a raiz. Sem isto um `..` no caminho
     * serviria arquivo de fora de `site/` — é servidor de desenvolvimento, mas
     * um que lê o repositório inteiro não é aceitável nem em dev.
     */
    const alvo = join(RAIZ, caminho.replace(/^\/+/, ""));
    if (!alvo.startsWith(RAIZ)) return new Response("não", { status: 403 });

    const arquivo = Bun.file(alvo);
    if (await arquivo.exists()) {
      const ext = alvo.slice(alvo.lastIndexOf("."));
      return new Response(arquivo, {
        headers: { "content-type": TIPOS[ext] ?? "application/octet-stream" },
      });
    }
    /* O Pages serve 404.html para qualquer caminho inexistente; o servidor
       local imita isso, senão a página de erro nunca é testada. */
    const erro = Bun.file(join(RAIZ, "404.html"));
    return new Response(await erro.exists() ? erro : "404", { status: 404 });
  },
});

/* ---------------------------------------------------------------------------
 * 2. CDP
 * ------------------------------------------------------------------------- */
interface Alvo {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

const lista = (await (await fetch(`${CDP}/json/list`)).json()) as Alvo[];
let aba = lista.find((t) => t.type === "page");
if (aba === undefined) {
  /* PUT, não GET: o Chrome passou a exigir PUT em /json/new, e com GET o erro
     que aparece é um SyntaxError de JSON que manda procurar no lugar errado. */
  const criada = await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" });
  if (!criada.ok) {
    throw new Error(
      `não consegui abrir aba no Chrome de depuração (${String(criada.status)}). ` +
        "O Chrome headless está de pé na 9223? Veja o cabeçalho deste arquivo.",
    );
  }
  aba = (await criada.json()) as Alvo;
}

const ws = new WebSocket(aba.webSocketDebuggerUrl);
let seq = 0;
const pendentes = new Map<number, (v: unknown) => void>();

const enviar = (metodo: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method: metodo, params }));
  return new Promise((r) => pendentes.set(id, r as (v: unknown) => void));
};

await new Promise<void>((r) => {
  ws.onopen = () => { r(); };
});
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown };
  if (m.id !== undefined && pendentes.has(m.id)) {
    pendentes.get(m.id)?.(m.result);
    pendentes.delete(m.id);
  }
};

await enviar("Page.enable");
await enviar("Runtime.enable");

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Uma captura. `parada` é `topo`, um número de pixels ou um seletor CSS.
 *
 * A espera é em duas etapas de propósito: a primeira deixa o preloader sair e
 * as fontes trocarem (fotografar antes disso rende a página na fonte de
 * sistema, que é a única coisa que a captura NÃO deve provar), e a segunda
 * deixa a revelação por rolagem terminar depois do salto.
 */
async function capturar(
  largura: number,
  altura: number,
  caminho: string,
  parada: string,
  nome: string,
): Promise<void> {
  await enviar("Emulation.setDeviceMetricsOverride", {
    width: largura,
    height: altura,
    deviceScaleFactor: 2,
    mobile: largura < 768,
  });
  await enviar("Page.navigate", { url: `http://localhost:${String(PORTA)}${caminho}` });
  await dormir(2600);

  if (parada !== "topo") {
    const expr = /^\d+$/.test(parada)
      ? `window.scrollTo({top:${parada},behavior:'instant'})`
      : `document.querySelector(${JSON.stringify(parada)})?.scrollIntoView({block:'start',behavior:'instant'})`;
    await enviar("Runtime.evaluate", { expression: expr });
    /* A revelação é por IntersectionObserver com transição de 720ms; 1400ms
       cobre a transição e o LERP do parallax assentar. */
    await dormir(1400);
  }

  /*
   * Trava de rolagem horizontal, conferida a CADA captura.
   *
   * Existe porque este defeito já aconteceu e é invisível: um `min-width` num
   * filho de grid esticou a página para 587px num viewport de 375, e o
   * `overflow-x: hidden` do body escondeu a barra. A página parecia certa, e o
   * cabeçalho `position: fixed` — que se dimensiona pelo viewport de layout —
   * jogou metade da navegação para fora da tela.
   *
   * A verificação é feita aqui, e não num teste à parte, porque é aqui que a
   * página já está montada em cada uma das quatro larguras.
   */
  const medida = (await enviar("Runtime.evaluate", {
    expression:
      "JSON.stringify({s:document.documentElement.scrollWidth,c:document.documentElement.clientWidth})",
    returnByValue: true,
  })) as { result?: { value?: string } };
  const { s: rolagem, c: cliente } = JSON.parse(
    medida.result?.value ?? '{"s":0,"c":0}',
  ) as { s: number; c: number };
  /* 1px de folga: arredondamento de subpixel em zoom fracionário. */
  if (rolagem > cliente + 1) {
    throw new Error(
      `rolagem horizontal em ${caminho} @${String(largura)}px: ` +
        `scrollWidth ${String(rolagem)} > clientWidth ${String(cliente)}. ` +
        "Provável item de grid/flex sem `min-width: 0` (ver a seção 5b do site.css).",
    );
  }

  const cap = (await enviar("Page.captureScreenshot", { format: "png" })) as { data: string };
  const destino = join(SAIDA, nome);
  await Bun.write(destino, Buffer.from(cap.data, "base64"));
  console.log("escrito", destino);
}

/* ---------------------------------------------------------------------------
 * 3. Rodar
 * ------------------------------------------------------------------------- */
const [, , argLargura, argCaminho, argParada] = process.argv;

/** Os quatro do CLAUDE.md §4b. A altura é a típica de cada classe de tela. */
const BREAKPOINTS: readonly (readonly [number, number])[] = [
  [375, 812],
  [768, 1024],
  [1024, 768],
  [1440, 900],
];

if (argLargura !== undefined) {
  const l = Number(argLargura);
  const bp = BREAKPOINTS.find(([w]) => w === l);
  await capturar(
    l,
    bp?.[1] ?? 900,
    argCaminho ?? "/",
    argParada ?? "topo",
    `avulso-${String(l)}.png`,
  );
} else {
  /* As paradas cobrem o que muda de forma por largura: o herói, o trilho de
     motores (que vira pilha abaixo de 1000px), a tabela de garantias, a
     inversão de tema da instalação e o documento com sumário. */
  const PARADAS: readonly (readonly [string, string, string])[] = [
    ["/", "topo", "01-hero"],
    ["/", "#motores", "02-motores"],
    ["/", "#garantias", "03-garantias"],
    ["/", "#diferenciais", "04-diferenciais"],
    ["/", "#telas", "05-telas"],
    ["/", "#instalar", "06-instalar"],
    ["/docs/", "topo", "07-docs"],
    ["/docs/", "#papel-no-banco", "08-docs-papeis"],
  ];

  for (const [largura, altura] of BREAKPOINTS) {
    for (const [caminho, parada, nome] of PARADAS) {
      await capturar(largura, altura, caminho, parada, `${nome}-${String(largura)}.png`);
    }
  }
}

ws.close();
/* `await`: o `stop()` do Bun devolve promise. Sem ele o processo pode sair
   antes de as conexões abertas fecharem, e a última captura vira uma corrida
   entre o `Bun.write` e o encerramento. */
await servidor.stop(true);
