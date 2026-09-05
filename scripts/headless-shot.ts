/**
 * Screenshot headless COM SESSÃO (DBee.md "Definição de pronto" 4b).
 *
 * A maior parte da UI vive atrás do login — árvore, abas, e os modais de escrita,
 * onde um erro visual custa mais caro. "Vive atrás de login" não pode ser isenção
 * de verificação: este script resolve a sessão do mesmo jeito que os testes de
 * integração (`apps/server/src/test/sessao.ts`) — mintando um token direto na
 * tabela `sessions` — e injeta o cookie no Chrome headless por CDP antes de
 * navegar. O obstáculo nunca foi a extensão (o CDP já contorna), era só ter uma
 * sessão válida.
 *
 * Uso:
 *   bun scripts/headless-shot.ts <saida.png> [caminho] [tema] [idioma] [w] [h]
 *   ex.: bun scripts/headless-shot.ts /tmp/vazio.png / dark pt 1440 900
 *
 * Pré-requisitos: `bun run dev` de pé (web :5173 + server :3001) COM o código
 * atual (o backend precisa ter as rotas que a tela usa), e um Chrome headless
 * com --remote-debugging-port=9223 (ver o método CDP no CLAUDE.md).
 */
import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";

const [, , saida, caminho = "/", tema = "dark", idioma = "pt", w = "1440", h = "900"] = process.argv;
if (saida === undefined) {
  console.error("uso: bun scripts/headless-shot.ts <saida.png> [caminho] [tema] [idioma] [w] [h]");
  process.exit(1);
}

const CDP = "http://localhost:9223";
const DATA_DIR = `${process.env.HOME}/.dbee-dev`;

/** Minta um token de sessão para o primeiro usuário, direto na tabela. */
function mintarSessao(): string {
  const db = new Database(`${DATA_DIR}/dbee.sqlite`);
  const user = db.query<{ id: string }, []>("SELECT id FROM users LIMIT 1").get();
  if (user === null) throw new Error(`sem usuário em ${DATA_DIR}/dbee.sqlite`);
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  const agora = new Date();
  const expira = new Date(agora.getTime() + 12 * 60 * 60 * 1000);
  db.run(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [hash, user.id, agora.toISOString(), expira.toISOString()],
  );
  db.close();
  return token;
}

const token = mintarSessao();

const lista = (await (await fetch(`${CDP}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
let alvo = lista.find((t) => t.type === "page" && t.url.includes("localhost:5173"));
alvo ??= (await (await fetch(`${CDP}/json/new?http://localhost:5173/`)).json()) as typeof lista[number];

const ws = new WebSocket(alvo.webSocketDebuggerUrl);
let id = 0;
const pend = new Map<number, (v: unknown) => void>();
const send = (m: string, p: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r) => pend.set(i, r as (v: unknown) => void));
};
await new Promise<void>((r) => { ws.onopen = () => { r(); }; });
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown };
  if (m.id !== undefined && pend.has(m.id)) { pend.get(m.id)?.(m.result); pend.delete(m.id); }
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: Number(w), height: Number(h), deviceScaleFactor: 2, mobile: false });
// O cookie httpOnly da sessão — injetado por CDP, que a página não conseguiria
// setar (é httpOnly de propósito). `secure:false` porque o vite dev é http.
await send("Network.setCookie", {
  name: "dbee_session",
  value: token,
  domain: "localhost",
  path: "/",
  httpOnly: true,
  secure: false,
  sameSite: "Lax",
});
await send("Runtime.evaluate", {
  expression: `try{localStorage.setItem('dbee:tema','${tema}');localStorage.setItem('dbee:idioma','${idioma}')}catch(e){}`,
});
await send("Page.navigate", { url: `http://localhost:5173${caminho}` });
await new Promise((r) => setTimeout(r, 2200));
const cap = (await send("Page.captureScreenshot", { format: "png" })) as { data: string };
await Bun.write(saida, Buffer.from(cap.data, "base64"));
console.log("wrote", saida);
ws.close();
