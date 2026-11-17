import { beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";

import { SESSION_COOKIE, type SavedQuery } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { migrate } from "../db/migrate";
import { EXPECTED_SCHEMA, MIGRATIONS } from "../db/migrations";
import { UsersRepository } from "../db/users.repo";
import { autenticar } from "../test/sessao";

/**
 * Queries salvas — CRUD com dono e visibilidade (ADR 016). SQLite em memória,
 * sem Postgres. Três atores: admin, ana e beto (members).
 */
let app: ReturnType<typeof createApp>;
let store: Store;
let admin = "";
let ana = "";
let beto = "";
let conexao = "";

const call = (cookie: string, path: string, body?: unknown, method = "POST"): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

const listar = async (cookie: string, q?: string): Promise<SavedQuery[]> => {
  const res = await call(cookie, `/api/saved-queries${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`, undefined, "GET");
  return (await res.json()) as SavedQuery[];
};

const salvar = async (cookie: string, body: object): Promise<SavedQuery> => {
  const res = await call(cookie, "/api/saved-queries", body);
  expect(res.status).toBe(200);
  return (await res.json()) as SavedQuery;
};

async function membro(nome: string): Promise<string> {
  const users = new UsersRepository(store.db);
  const u = users.criar(nome, await Bun.password.hash("senha-de-teste-1"), false, "member");
  return `${SESSION_COOKIE}=${users.abrirSessao(u.id).token}`;
}

beforeAll(async () => {
  store = openTestStore();
  app = createApp({ store, caCert: undefined });
  ({ cookie: admin } = await autenticar(store));
  ana = await membro("ana");
  beto = await membro("beto");
  const res = await call(admin, "/api/connections", {
    name: "prod", host: "127.0.0.1", port: 5432, database: "x",
    username: "u", password: "segredo-1234", timezone: "UTC",
  });
  conexao = ((await res.json()) as { id: string }).id;
});

describe("queries salvas", () => {
  it("busca casa por nome E por conteúdo do SQL", async () => {
    await salvar(admin, { name: "Relatório mensal", sql: "SELECT count(*) FROM vendas" });
    await salvar(admin, { name: "Clientes ativos", sql: "SELECT nome FROM clientes WHERE ativo" });
    expect((await listar(admin, "clientes")).map((q) => q.name)).toEqual(["Clientes ativos"]);
    expect((await listar(admin, "vendas")).map((q) => q.name)).toEqual(["Relatório mensal"]);
    expect(await listar(admin, "xyz-nao-existe")).toHaveLength(0);
  });

  it("nome vazio é recusado na validação", async () => {
    expect((await call(admin, "/api/saved-queries", { name: "", sql: "SELECT 1" })).status).toBe(422);
  });

  it("sem visibility nasce privada, com dono e canEdit", async () => {
    const q = await salvar(ana, { name: "rascunho da ana", sql: "SELECT 'ana'" });
    expect(q.visibility).toBe("private");
    expect(q.ownerName).toBe("ana");
    expect(q.canEdit).toBe(true);
    // Nem beto nem admin listam o rascunho alheio.
    expect((await listar(beto)).some((x) => x.id === q.id)).toBe(false);
    expect((await listar(admin)).some((x) => x.id === q.id)).toBe(false);
    expect((await call(beto, `/api/saved-queries/${q.id}`, undefined, "GET")).status).toBe(404);
  });

  it("do time: todos veem, só o dono (ou admin) altera — IDOR em PATCH/DELETE", async () => {
    const q = await salvar(ana, { name: "do time", sql: "SELECT 1", visibility: "team" });
    const vistaPorBeto = (await listar(beto)).find((x) => x.id === q.id);
    expect(vistaPorBeto?.canEdit).toBe(false);

    expect((await call(beto, `/api/saved-queries/${q.id}`, { name: "sequestrada" }, "PATCH")).status).toBe(403);
    expect((await call(beto, `/api/saved-queries/${q.id}`, undefined, "DELETE")).status).toBe(403);
    expect((await call(beto, `/api/saved-queries/${q.id}`, undefined, "GET")).status).toBe(200);

    const ren = await call(ana, `/api/saved-queries/${q.id}`, { name: "renomeada", sql: "SELECT 2" }, "PATCH");
    expect(ren.status).toBe(200);
    const atual = (await ren.json()) as SavedQuery;
    expect([atual.name, atual.sql, atual.visibility]).toEqual(["renomeada", "SELECT 2", "team"]);

    expect((await call(admin, `/api/saved-queries/${q.id}`, { visibility: "private" }, "PATCH")).status).toBe(200);
    // Virou privada da ana: beto deixa de ver; PATCH dele agora é 404.
    expect((await call(beto, `/api/saved-queries/${q.id}`, { name: "x" }, "PATCH")).status).toBe(404);
    expect((await call(ana, `/api/saved-queries/${q.id}`, undefined, "DELETE")).status).toBe(200);
    expect((await call(ana, `/api/saved-queries/${q.id}`, undefined, "DELETE")).status).toBe(404);
  });

  it("PATCH vazio é 422", async () => {
    const q = await salvar(ana, { name: "p", sql: "SELECT 1" });
    expect((await call(ana, `/api/saved-queries/${q.id}`, {}, "PATCH")).status).toBe(422);
  });

  it("query de conexão sem concessão some, mesmo sendo do time", async () => {
    const q = await salvar(admin, { name: "da prod", sql: "SELECT segredo", visibility: "team", connectionId: conexao });
    expect((await listar(ana)).some((x) => x.id === q.id)).toBe(false);
    expect((await call(ana, `/api/saved-queries/${q.id}`, undefined, "GET")).status).toBe(404);
    // E não dá para criar uma atrelada a conexão que não vejo.
    expect((await call(ana, "/api/saved-queries", { name: "x", sql: "SELECT 1", connectionId: conexao })).status).toBe(404);
  });
});

describe("migration 014", () => {
  it("as queries que já existiam viram 'team', sem dono", () => {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys = ON");
    // O banco como estava antes da 014: aplica as anteriores à mão.
    for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
      if (m.version < 14) db.run(m.sql);
    }
    db.run("INSERT INTO app_meta (key, value) VALUES ('schema_version', '13')");
    db.run(
      `INSERT INTO saved_queries (id, name, sql, connection_id, created_at, updated_at)
       VALUES ('velha', 'antiga', 'SELECT 1', NULL, '2024-01-01', '2024-01-01')`,
    );
    expect(migrate(db)).toBe(EXPECTED_SCHEMA);
    const linha = db.query<{ visibility: string; owner_id: string | null }, []>(
      "SELECT visibility, owner_id FROM saved_queries WHERE id = 'velha'",
    ).get();
    expect(linha).toEqual({ visibility: "team", owner_id: null });
  });
});
