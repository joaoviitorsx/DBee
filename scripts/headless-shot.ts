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
 *   bun scripts/headless-shot.ts <saida.png> [caminho] [tema] [idioma] [w] [h] [acao]
 *   ex.: bun scripts/headless-shot.ts /tmp/vazio.png / dark pt 1440 900
 *
 * `acao` é uma expressão JS avaliada na página depois da navegação e antes da
 * captura — é como se chega a um estado real (menu aberto, modal na tela) em
 * vez de fotografar sempre a tela inicial.
 *
 * `DBEE_SHOT_SEM_SESSAO=1` pula a sessão: é o único jeito de fotografar as
 * telas de ENTRADA (login, setup, troca de senha), que por definição são o
 * que se vê sem estar autenticado.
 *
 * Pré-requisitos: `bun run dev` de pé (web :5173 + server :3001) COM o código
 * atual (o backend precisa ter as rotas que a tela usa), e um Chrome headless
 * com --remote-debugging-port=9223 (ver o método CDP no CLAUDE.md).
 */
import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

const [, , saida, caminho = "/", tema = "dark", idioma = "pt", w = "1440", h = "900", acao] = process.argv;
if (saida === undefined) {
  console.error("uso: bun scripts/headless-shot.ts <saida.png> [caminho] [tema] [idioma] [w] [h]");
  process.exit(1);
}

/**
 * Porta do Chrome headless. `DBEE_SHOT_CDP` existe porque mais de um processo
 * pode estar fotografando ao mesmo tempo — dois agentes disputando as abas da
 * mesma instância navegam a aba um do outro no meio da captura, e o resultado é
 * um screenshot da tela errada sem erro nenhum.
 */
const CDP = process.env["DBEE_SHOT_CDP"] ?? "http://localhost:9223";

/**
 * TRAVA DE DEV. Este utilitário cria uma sessão **válida sem senha** — é o poder
 * que o torna útil e o que o torna perigoso. Ele só pode tocar o banco de dev,
 * `~/.dbee-dev/dbee.sqlite`, e recusa qualquer outro caminho de forma explícita.
 * Não basta "depende de qual DBEE_DATA_DIR está setado": se essa env apontar
 * para outro lugar (produção, um /data montado), o script aborta em vez de
 * mintar sessão lá. O banco de dev fica fixo no código, não vem de argumento.
 */
function bancoDev(): string {
  const home = process.env.HOME ?? "";
  if (home === "") throw new Error("recusado: $HOME não definido");
  const esperado = `${home}/.dbee-dev/dbee.sqlite`;

  const envDir = process.env.DBEE_DATA_DIR;
  if (envDir !== undefined && envDir !== `${home}/.dbee-dev`) {
    throw new Error(
      `recusado: DBEE_DATA_DIR aponta para '${envDir}', não para o dev (~/.dbee-dev). ` +
        "Este script cria sessão sem senha e só pode tocar o banco de dev.",
    );
  }
  if ((process.env.DBEE_ENV ?? process.env.NODE_ENV) === "production") {
    throw new Error("recusado: ambiente de produção (DBEE_ENV/NODE_ENV=production)");
  }
  if (!/^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(new URL(CDP).hostname)) {
    throw new Error(`recusado: CDP não é loopback (${CDP})`);
  }
  if (!existsSync(esperado)) throw new Error(`banco de dev não existe: ${esperado}`);
  return esperado;
}

/** Minta um token de sessão para o primeiro usuário, direto na tabela. */
function mintarSessao(): string {
  const db = new Database(bancoDev());
  /*
   * Prefere uma conta **sem troca de senha pendente**.
   *
   * `LIMIT 1` sem ordem pegava qualquer uma, e desde que existe administração
   * de contas isso passou a cair numa conta recém-criada — que o guard prende
   * na tela de trocar senha. Todo screenshot virava aquela tela, sem aviso.
   */
  const user = db
    .query<{ id: string }, []>(
      "SELECT id FROM users ORDER BY must_change_password, created_at LIMIT 1",
    )
    .get();
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

/**
 * Sem sessão, nenhum banco é tocado: o guard barra antes, que é justamente o
 * estado que as telas de entrada mostram.
 */
const semSessao = process.env.DBEE_SHOT_SEM_SESSAO === "1";
const token = semSessao ? null : mintarSessao();

const lista = (await (await fetch(`${CDP}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
let alvo = lista.find((t) => t.type === "page" && t.url.includes("localhost:5173"));
/*
 * `PUT`, e não `GET`.
 *
 * O Chrome passou a exigir PUT em `/json/new` (a mudança fecha um CSRF: uma
 * página qualquer conseguia abrir abas na instância de depuração por uma
 * navegação simples). Com `GET` a resposta não é JSON, e o erro que aparece é
 * `SyntaxError: Failed to parse JSON` nesta linha — que não diz nada sobre o
 * método, e manda procurar defeito no lugar errado.
 */
if (alvo === undefined) {
  const criada = await fetch(`${CDP}/json/new?http://localhost:5173/`, { method: "PUT" });
  if (!criada.ok) {
    throw new Error(
      `não consegui abrir aba no Chrome de depuração (${String(criada.status)}): ${await criada.text()}`,
    );
  }
  alvo = (await criada.json()) as (typeof lista)[number];
}

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
// Limpa antes: uma sessão de execução anterior sobreviveria no perfil do
// Chrome e o modo "sem sessão" mostraria o app logado.
await send("Network.clearBrowserCookies");
if (token !== null) {
  await send("Network.setCookie", {
    name: "dbee_session",
    value: token,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  });
}
await send("Runtime.evaluate", {
  expression: `try{localStorage.setItem('dbee:tema','${tema}');localStorage.setItem('dbee:idioma','${idioma}')}catch(e){}`,
});
await send("Page.navigate", { url: `http://localhost:5173${caminho}` });
await new Promise((r) => setTimeout(r, 2200));

// Estado real antes da captura: sem isto todo screenshot é a tela inicial, e a
// tela inicial não é onde os erros visuais moram.
if (acao !== undefined && acao !== "") {
  const r = (await send("Runtime.evaluate", {
    expression: acao,
    awaitPromise: true,
    returnByValue: true,
  })) as { exceptionDetails?: { text?: string } };
  if (r.exceptionDetails !== undefined) {
    throw new Error(`ação falhou na página: ${r.exceptionDetails.text ?? "erro"}`);
  }
  await new Promise((rr) => setTimeout(rr, 900));
}
const cap = (await send("Page.captureScreenshot", { format: "png" })) as { data: string };
await Bun.write(saida, Buffer.from(cap.data, "base64"));
console.log("wrote", saida);
ws.close();
