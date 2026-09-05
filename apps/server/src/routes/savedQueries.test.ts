import { beforeAll, describe, expect, it } from "bun:test";

import type { SavedQuery } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { autenticar } from "../test/sessao";

/**
 * Queries salvas — CRUD sobre `saved_queries` (DBee.md §5). SQLite em memória,
 * sem Postgres. A rota é guardada; o cookie vem de `autenticar`.
 */
let app: ReturnType<typeof createApp>;
let store: Store;
let cookie = "";

const call = (path: string, body?: unknown, method = "POST"): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

const listar = async (q?: string): Promise<SavedQuery[]> => {
  const res = await call(`/api/saved-queries${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`, undefined, "GET");
  return (await res.json()) as SavedQuery[];
};

beforeAll(async () => {
  store = openTestStore();
  app = createApp({ store, caCert: undefined });
  ({ cookie } = await autenticar(store));
});

describe("queries salvas", () => {
  it("salva, lista, e a busca casa por nome E por conteúdo do SQL", async () => {
    const c1 = await call("/api/saved-queries", { name: "Relatório mensal", sql: "SELECT count(*) FROM vendas" });
    expect(c1.status).toBe(200);
    await call("/api/saved-queries", { name: "Clientes ativos", sql: "SELECT nome FROM clientes WHERE ativo" });

    expect(await listar()).toHaveLength(2);
    // Nome:
    expect((await listar("clientes")).map((q) => q.name)).toEqual(["Clientes ativos"]);
    // Conteúdo do SQL (nenhum nome tem "vendas", mas o SQL do primeiro tem):
    expect((await listar("vendas")).map((q) => q.name)).toEqual(["Relatório mensal"]);
    // Casa os dois pelo SQL (ambos têm "SELECT"):
    expect(await listar("select")).toHaveLength(2);
    // Sem casar nada:
    expect(await listar("xyz-nao-existe")).toHaveLength(0);
  });

  it("renomeia", async () => {
    const criada = (await (await call("/api/saved-queries", { name: "Rascunho", sql: "SELECT 1" })).json()) as SavedQuery;
    const res = await call(`/api/saved-queries/${criada.id}`, { name: "Nome novo" }, "PATCH");
    expect(res.status).toBe(200);
    expect(((await res.json()) as SavedQuery).name).toBe("Nome novo");
  });

  it("exclui, e excluir de novo dá 404", async () => {
    const criada = (await (await call("/api/saved-queries", { name: "Descartável", sql: "SELECT 2" })).json()) as SavedQuery;
    expect((await call(`/api/saved-queries/${criada.id}`, undefined, "DELETE")).status).toBe(200);
    expect((await call(`/api/saved-queries/${criada.id}`, undefined, "DELETE")).status).toBe(404);
  });

  it("nome vazio é recusado na validação", async () => {
    const res = await call("/api/saved-queries", { name: "", sql: "SELECT 1" });
    expect(res.status).toBe(422);
  });
});
