/**
 * Varre as telas em oito larguras e falha se a **página** rolar na horizontal.
 *
 * ## Por que isto é um script, e não um teste da suíte
 *
 * `bun test` roda sem navegador. Este defeito não existe no comportamento — ele
 * existe no layout, e só aparece quando um `flex` sem `min-w-0` encontra uma
 * caixa estreita. As 466 asserções da suíte não tinham como pegá-lo, e não
 * teriam mesmo: é o "teste verifica comportamento; pixel verifica significado"
 * do CLAUDE.md. A diferença é que aqui a medição serve, e é barata.
 *
 * ## O que ele mede
 *
 * `document.documentElement.scrollWidth > window.innerWidth`. Rolagem
 * horizontal de página nunca deveria ser possível: a grade tem o scroller dela,
 * as tabelas largas têm o delas. Quando a página desliza, a barra superior —
 * que no modo escrita **é** o alerta âmbar — sai de vista.
 *
 * Também reporta os elementos que ultrapassam a viewport, para o culpado ficar
 * nomeado em vez de virar caça ao tesouro.
 *
 * ## Uso
 *
 * ```bash
 * # com `bun run dev` de pé e um Chrome headless na porta escolhida
 * DBEE_SHOT_CDP=http://localhost:9224 bun scripts/check-responsivo.ts
 * ```
 *
 * Sai com código 1 se alguma combinação falhar, para servir em CI o dia em que
 * houver um navegador lá.
 */

import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

const CDP = process.env["DBEE_SHOT_CDP"] ?? "http://localhost:9223";
const BASE = process.env["DBEE_WEB"] ?? "http://localhost:5173";

/** As larguras que importam. 320 é o menor telefone que ainda existe. */
const LARGURAS = [320, 375, 414, 768, 1024, 1280, 1440, 1920] as const;
/** Alturas curtas revelam o que 812 esconde. */
const ALTURA_POR_LARGURA: Readonly<Record<number, number>> = {
  320: 568, 375: 667, 414: 896, 768: 1024, 1024: 600, 1280: 800, 1440: 900, 1920: 1080,
};

/** Cada cena é um caminho mais uma ação que a leva ao estado real. */
const clicar = (padrao: string): string =>
  `(()=>{const b=[...document.querySelectorAll('button')].find(e=>${padrao}.test(e.textContent));if(b)b.click();return true})()`;

/**
 * Cada cena é uma ação que leva a tela ao estado real.
 *
 * **Tela vazia esconde o defeito.** Os dois piores achados desta varredura —
 * o `<select>` de filtro que dimensiona pelo nome de coluna mais longo, e o
 * interruptor de escrita saindo da tela — só existem com uma tabela aberta.
 */
const CENAS: readonly { nome: string; acao: string }[] = [
  { nome: "árvore + vazio", acao: "true" },
  { nome: "conexão expandida", acao: clicar("/./") },
  {
    nome: "aba Dados",
    acao: `(async()=>{
      const esperar=(ms)=>new Promise(r=>setTimeout(r,ms));
      ${clicar("/./")}; await esperar(1500);
      ${clicar("/^postgres$/")}; await esperar(2000);
      ${clicar("/[a-z_]{4,}/")}; await esperar(2200);
      return true;})()`,
  },
];

function mintarSessao(): string {
  const caminho = `${process.env["HOME"] ?? ""}/.dbee-dev/dbee.sqlite`;
  if (!existsSync(caminho)) throw new Error(`banco de dev não existe: ${caminho}`);
  const db = new Database(caminho);
  const user = db
    .query<{ id: string }, []>(
      "SELECT id FROM users ORDER BY must_change_password, created_at LIMIT 1",
    )
    .get();
  if (user === null) throw new Error("sem usuário no banco de dev");
  const token = randomBytes(32).toString("base64url");
  const agora = new Date();
  db.run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", [
    createHash("sha256").update(token, "utf8").digest("hex"),
    user.id,
    agora.toISOString(),
    new Date(agora.getTime() + 12 * 3600_000).toISOString(),
  ]);
  db.close();
  return token;
}

interface Medida {
  readonly rola: boolean;
  readonly scrollWidth: number;
  readonly innerWidth: number;
  readonly culpados: readonly string[];
}

const MEDIR = `(() => {
  const doc = document.documentElement;
  const culpados = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Ornamento que sangra pela borda de propósito (os favos do cabeçalho e da
    // árvore) não é defeito: o pai o recorta e ele não é alcançável.
    //
    // O filtro é aria-hidden, e não position absolute: filho de SVG é static
    // por natureza, então checar posição pegava o svg e deixava passar os path
    // dele — quatro falsos positivos em toda largura. O que está escondido da
    // tecnologia assistiva é, por definição, decoração.
    if (el.closest('[aria-hidden="true"]') !== null) continue;
    if (r.right > window.innerWidth + 1) {
      const cls = String(el.className.baseVal ?? el.className).split(" ").slice(0, 4).join(".");
      culpados.push(el.tagName.toLowerCase() + "." + cls + " right=" + Math.round(r.right));
    }
  }
  return JSON.stringify({
    rola: doc.scrollWidth > window.innerWidth,
    scrollWidth: doc.scrollWidth,
    innerWidth: window.innerWidth,
    culpados: culpados.slice(0, 4),
  });
})()`;

const lista = (await (await fetch(`${CDP}/json/list`)).json()) as {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}[];
const alvo = lista.find((t) => t.type === "page");
if (alvo === undefined) throw new Error(`sem aba no Chrome de ${CDP}`);

const ws = new WebSocket(alvo.webSocketDebuggerUrl);
let id = 0;
const pendentes = new Map<number, (v: unknown) => void>();
const send = (metodo: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method: metodo, params }));
  return new Promise((r) => pendentes.set(i, r as (v: unknown) => void));
};
await new Promise<void>((r) => { ws.onopen = () => { r(); }; });
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown };
  if (m.id !== undefined && pendentes.has(m.id)) {
    pendentes.get(m.id)?.(m.result);
    pendentes.delete(m.id);
  }
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Network.clearBrowserCookies");
await send("Network.setCookie", {
  name: "dbee_session",
  value: mintarSessao(),
  domain: "localhost",
  path: "/",
  httpOnly: true,
  secure: false,
  sameSite: "Lax",
});

const falhas: string[] = [];
console.log("largura × altura   cena                    scrollWidth / viewport");
console.log("─".repeat(72));

for (const largura of LARGURAS) {
  const altura = ALTURA_POR_LARGURA[largura] ?? 800;
  await send("Emulation.setDeviceMetricsOverride", {
    width: largura, height: altura, deviceScaleFactor: 1, mobile: largura < 768,
  });

  for (const cena of CENAS) {
    await send("Page.navigate", { url: BASE });
    await new Promise((r) => setTimeout(r, 1400));
    await send("Runtime.evaluate", { expression: cena.acao, awaitPromise: true });
    await new Promise((r) => setTimeout(r, 700));

    const r = (await send("Runtime.evaluate", { expression: MEDIR, returnByValue: true })) as {
      result: { value: string };
    };
    const m = JSON.parse(r.result.value) as Medida;
    /*
     * Falha por **elemento fora da viewport**, não só por a página rolar.
     *
     * O shell tem `overflow-x-hidden` como rede de segurança, e ele mascara o
     * sintoma: com ele, um `flex` estourado deixa de rolar a página e passa a
     * cortar o filho em silêncio. Medir só `scrollWidth` daria verde para um
     * botão inalcançável. O que importa é se algo ficou fora do alcance.
     */
    const ruim = m.rola || m.culpados.length > 0;
    console.log(
      `${String(largura).padStart(4)}×${String(altura).padEnd(5)} ${cena.nome.padEnd(24)} ${String(m.scrollWidth).padStart(5)} / ${String(m.innerWidth).padEnd(5)} ${ruim ? "FALHOU" : "ok"}`,
    );
    if (ruim) {
      falhas.push(
        `${String(largura)}px · ${cena.nome} · ${m.rola ? `página +${String(m.scrollWidth - m.innerWidth)}px` : `${String(m.culpados.length)} elemento(s) fora`}`,
      );
      for (const c of m.culpados) console.log(`        ↳ ${c}`);
    }
  }
}

console.log("─".repeat(72));
if (falhas.length > 0) {
  console.log(`${String(falhas.length)} combinação(ões) com conteúdo fora do alcance:`);
  for (const f of falhas) console.log(`  ${f}`);
  process.exit(1);
}
console.log("nada fora do alcance em nenhuma largura.");
process.exit(0);
