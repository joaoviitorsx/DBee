import { beforeAll, describe, expect, it } from "bun:test";

import { SESSION_COOKIE, type CreateApiTokenResponse } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore } from "../db/client";
import { UsersRepository } from "../db/users.repo";
import { autenticar } from "../test/sessao";

/**
 * Acesso ao MCP (ADR 015): Bearer **só** em `/api/mcp`, e em `/api/mcp` **só**
 * Bearer. Sem Postgres — o que roda SQL de verdade está em
 * `mcp.integration.test.ts`.
 */

const store = openTestStore();
const app = createApp({ store, caCert: undefined });
const users = new UsersRepository(store.db);

let cookieAdmin = "";
let tokenAdmin = "";
let cookieMembro = "";
let tokenMembro = "";

const req = (metodo: string, caminho: string, headers: Record<string, string>, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${caminho}`, {
      method: metodo,
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

const rpc = (method: string, params?: Record<string, unknown>, id: number | null = 1) => ({
  jsonrpc: "2.0",
  method,
  ...(id === null ? {} : { id }),
  ...(params === undefined ? {} : { params }),
});

async function criarToken(cookie: string, name: string): Promise<CreateApiTokenResponse> {
  const res = await req("POST", "/api/tokens", { cookie }, { name });
  expect(res.status).toBe(200);
  return (await res.json()) as CreateApiTokenResponse;
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  cookieAdmin = (await autenticar(store)).cookie;
  tokenAdmin = (await criarToken(cookieAdmin, "agente")).secret;

  const membro = users.criar(
    "membro",
    await Bun.password.hash("senha-do-membro-1", { algorithm: "argon2id" }),
    false,
    "member",
  );
  cookieMembro = `${SESSION_COOKIE}=${users.abrirSessao(membro.id).token}`;
  tokenMembro = (await criarToken(cookieMembro, "do membro")).secret;

  // Uma conexão que o membro NÃO recebeu. Criar não conecta.
  const res = await req("POST", "/api/connections", { cookie: cookieAdmin }, {
    name: "producao", host: "127.0.0.1", port: 5432, database: "x",
    username: "u", password: "segredo-do-banco", timezone: "UTC",
  });
  expect(res.status).toBe(201);
});

describe("tokens pessoais", () => {
  it("formato dbee_<prefixo>_<segredo>, e a lista não traz hash nem segredo", async () => {
    expect(tokenAdmin).toMatch(/^dbee_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    const res = await req("GET", "/api/tokens", { cookie: cookieAdmin });
    const corpo = await res.text();
    expect(res.status).toBe(200);
    expect(corpo).not.toContain(tokenAdmin.split("_").slice(2).join("_"));
    expect(corpo).not.toContain("argon2");
    expect(corpo).not.toContain("hash");
  });

  it("cada um lista só os seus", async () => {
    const res = await req("GET", "/api/tokens", { cookie: cookieMembro });
    const lista = (await res.json()) as { name: string }[];
    expect(lista.map((t) => t.name)).toEqual(["do membro"]);
  });

  it("membro não revoga token de outro (404), admin revoga qualquer um", async () => {
    const alvo = await criarToken(cookieAdmin, "alvo");
    expect((await req("DELETE", `/api/tokens/${alvo.token.id}`, { cookie: cookieMembro })).status).toBe(404);
    expect((await req("DELETE", `/api/tokens/${alvo.token.id}`, { cookie: cookieAdmin })).status).toBe(200);
  });
});

describe("guard do MCP", () => {
  it("Bearer válido em /api/mcp → 200", async () => {
    const res = await req("POST", "/api/mcp", bearer(tokenAdmin), rpc("ping"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("cookie de sessão válido NÃO autentica /api/mcp (CSRF)", async () => {
    const res = await req("POST", "/api/mcp", { cookie: cookieAdmin }, rpc("ping"));
    expect(res.status).toBe(401);
  });

  it("Bearer válido NÃO autentica fora de /api/mcp", async () => {
    for (const [m, c] of [["GET", "/api/connections"], ["GET", "/api/tokens"], ["GET", "/api/auth/me"]] as const) {
      const res = await req(m, c, bearer(tokenAdmin));
      expect(`${m} ${c} ${String(res.status)}`).toBe(`${m} ${c} 401`);
    }
  });

  it("Bearer não cria token (rota de tokens é só por sessão)", async () => {
    const res = await req("POST", "/api/tokens", bearer(tokenAdmin), { name: "escalada" });
    expect(res.status).toBe(401);
  });

  it("token revogado → 401", async () => {
    const t = await criarToken(cookieAdmin, "efemero");
    expect((await req("POST", "/api/mcp", bearer(t.secret), rpc("ping"))).status).toBe(200);
    await req("DELETE", `/api/tokens/${t.token.id}`, { cookie: cookieAdmin });
    expect((await req("POST", "/api/mcp", bearer(t.secret), rpc("ping"))).status).toBe(401);
  });

  it("segredo errado com prefixo certo → 401", async () => {
    const adulterado = `${tokenAdmin.slice(0, -4)}AAAA`;
    expect((await req("POST", "/api/mcp", bearer(adulterado), rpc("ping"))).status).toBe(401);
  });

  it("usuário com troca de senha pendente → 403", async () => {
    const u = users.criar("pendente", await Bun.password.hash("x-provisoria-1", { algorithm: "argon2id" }), false, "member");
    const cookie = `${SESSION_COOKIE}=${users.abrirSessao(u.id).token}`;
    const t = await criarToken(cookie, "antes do reset");
    users.resetarSenha(u.id, await Bun.password.hash("outra-provisoria-1", { algorithm: "argon2id" }));
    expect((await req("POST", "/api/mcp", bearer(t.secret), rpc("ping"))).status).toBe(403);
  });

  it("usuário removido → token morre junto", async () => {
    const u = users.criar("efemera", await Bun.password.hash("x-provisoria-2", { algorithm: "argon2id" }), false, "member");
    const t = await criarToken(`${SESSION_COOKIE}=${users.abrirSessao(u.id).token}`, "t");
    users.remover(u.id);
    expect((await req("POST", "/api/mcp", bearer(t.secret), rpc("ping"))).status).toBe(401);
  });

  it("notificação → 202 sem corpo", async () => {
    const res = await req("POST", "/api/mcp", bearer(tokenAdmin), rpc("notifications/initialized", undefined, null));
    expect(`${String(res.status)} ${await res.text()}`).toBe("202 ");
  });

  it("initialize e tools/list", async () => {
    const init = (await (await req("POST", "/api/mcp", bearer(tokenAdmin), rpc("initialize", {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" },
    }))).json()) as { result: { serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe("dbee");

    const lista = (await (await req("POST", "/api/mcp", bearer(tokenAdmin), rpc("tools/list"))).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(lista.result.tools.map((t) => t.name).sort()).toEqual(
      ["describe_schema_compact", "describe_table", "explain_query", "get_saved_query", "list_connections", "list_saved_queries", "list_schema", "run_query"],
    );
  });

  it("método desconhecido → erro JSON-RPC -32601", async () => {
    const r = (await (await req("POST", "/api/mcp", bearer(tokenAdmin), rpc("resources/list"))).json()) as {
      error: { code: number };
    };
    expect(r.error.code).toBe(-32601);
  });
});

describe("permissão por conexão no MCP", () => {
  const listar = async (token: string) => {
    const r = (await (await req("POST", "/api/mcp", bearer(token), rpc("tools/call", {
      name: "list_connections", arguments: {},
    }))).json()) as { result: { content: { text: string }[]; isError: boolean } };
    return r.result;
  };

  it("admin vê a conexão, sem credencial nem host", async () => {
    const r = await listar(tokenAdmin);
    const texto = r.content[0]?.text ?? "";
    expect(texto).toContain("producao");
    expect(texto).not.toContain("segredo-do-banco");
    expect(texto).not.toContain("password");
    expect(texto).not.toContain("127.0.0.1");
  });

  it("member sem concessão não lista a conexão", async () => {
    const r = await listar(tokenMembro);
    expect(JSON.parse(r.content[0]?.text ?? "null")).toEqual([]);
  });

  it("member sem concessão: run_query por id conhecido → not found", async () => {
    const conexoes = JSON.parse((await listar(tokenAdmin)).content[0]?.text ?? "[]") as { id: string }[];
    const id = conexoes[0]?.id ?? "";
    const r = (await (await req("POST", "/api/mcp", bearer(tokenMembro), rpc("tools/call", {
      name: "run_query", arguments: { connectionId: id, sql: "SELECT 1" },
    }))).json()) as { result: { content: { text: string }[]; isError: boolean } };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0]?.text).toContain("connection_not_found");
  });
});

describe("queries salvas no MCP", () => {
  const chamar = async (token: string, name: string, args: Record<string, unknown>) =>
    ((await (await req("POST", "/api/mcp", bearer(token), rpc("tools/call", { name, arguments: args }))).json()) as {
      result: { content: { text: string }[]; isError: boolean };
    }).result;

  it("mesma visibilidade da UI: time + próprias, conexão sem acesso some", async () => {
    const conexoes = JSON.parse((await chamar(tokenAdmin, "list_connections", {})).content[0]?.text ?? "[]") as { id: string }[];
    const prod = conexoes[0]?.id ?? "";
    const salvar = async (cookie: string, body: object) => {
      const r = await req("POST", "/api/saved-queries", { cookie }, body);
      expect(r.status).toBe(200);
      return ((await r.json()) as { id: string }).id;
    };
    await salvar(cookieAdmin, { name: "time-livre", sql: "SELECT 1", visibility: "team" });
    await salvar(cookieAdmin, { name: "rascunho-admin", sql: "SELECT 2" });
    const daProd = await salvar(cookieAdmin, { name: "time-prod", sql: "SELECT 3", visibility: "team", connectionId: prod });
    await salvar(cookieMembro, { name: "meu-rascunho", sql: "SELECT 4" });

    const nomes = (r: { content: { text: string }[] }) =>
      (JSON.parse(r.content[0]?.text ?? "[]") as { name: string }[]).map((x) => x.name).sort();

    expect(nomes(await chamar(tokenMembro, "list_saved_queries", {}))).toEqual(["meu-rascunho", "time-livre"]);
    expect(nomes(await chamar(tokenAdmin, "list_saved_queries", {}))).toEqual(["rascunho-admin", "time-livre", "time-prod"]);
    expect(nomes(await chamar(tokenAdmin, "list_saved_queries", { connectionId: prod }))).toEqual(["time-prod"]);

    const negado = await chamar(tokenMembro, "get_saved_query", { id: daProd });
    expect(negado.isError).toBe(true);
    expect(negado.content[0]?.text).toContain("saved_query_not_found");
    const visto = await chamar(tokenAdmin, "get_saved_query", { id: daProd });
    expect(visto.content[0]?.text).toContain("SELECT 3");
  });
});

describe("rate limit de token", () => {
  it("falhas repetidas da mesma origem → 429", async () => {
    // App novo: o limitador é por instância e os testes acima já gastaram falhas.
    const app2 = createApp({ store: openTestStore(), caCert: undefined });
    let ultimo = 0;
    for (let i = 0; i < 12; i++) {
      const res = await app2.handle(new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer dbee_000000000000_x" },
        body: JSON.stringify(rpc("ping")),
      }));
      ultimo = res.status;
    }
    expect(ultimo).toBe(429);
  });
});
