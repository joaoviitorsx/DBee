import { describe, expect, it } from "bun:test";

import type { DatabaseSchema } from "@dbee/shared";

import { construirCompletion } from "./completion";

function schema(schemas: DatabaseSchema["schemas"]): DatabaseSchema {
  return { database: "d", schemas, fetchedAt: "2026-01-01T00:00:00Z", cached: false };
}

const coluna = (name: string, dataType: string, isPrimaryKey = false) => ({
  name, dataType, dataTypeId: 0, nullable: true, defaultValue: null,
  position: 1, isPrimaryKey, comment: null,
});

const relacao = (name: string, kind: "table" | "view", colunas: ReturnType<typeof coluna>[]) => ({
  name, kind, comment: null, estimatedRows: null, columns: colunas,
  primaryKey: colunas.filter((c) => c.isPrimaryKey).map((c) => c.name),
  foreignKeys: [], indexes: [],
});

// Objeto de namespace, não o formato `{self, children}` nem a lista de colunas.
const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !("self" in v);

describe("namespace de autocomplete", () => {
  it("public é o schema padrão quando existe", () => {
    const { defaultSchema } = construirCompletion(
      schema([
        { name: "fiscal", relations: [relacao("notas", "table", [coluna("id", "bigint", true)])] },
        { name: "public", relations: [relacao("t", "table", [coluna("id", "int")])] },
      ]),
    );
    expect(defaultSchema).toBe("public");
  });

  it("sem public, cai no primeiro schema com relações", () => {
    const { defaultSchema } = construirCompletion(
      schema([
        { name: "vazio", relations: [] },
        { name: "fiscal", relations: [relacao("notas", "table", [coluna("id", "bigint")])] },
      ]),
    );
    expect(defaultSchema).toBe("fiscal");
  });

  it("cada tabela é alcançável por schema.tabela", () => {
    const { schema: ns } = construirCompletion(
      schema([{ name: "fiscal", relations: [relacao("notas", "table", [coluna("id", "bigint")])] }]),
    );
    const fiscal = ns as Record<string, unknown>;
    expect(ehObjeto(fiscal["fiscal"])).toBe(true);
    const dentro = fiscal["fiscal"] as Record<string, unknown>;
    expect(dentro["notas"]).toBeDefined();
  });

  it("a tabela do schema padrão também aparece no topo, sem qualificar", () => {
    const { schema: ns } = construirCompletion(
      schema([{ name: "public", relations: [relacao("clientes", "table", [coluna("id", "int")])] }]),
    );
    // `clientes` no topo, para `FROM cli…` completar.
    expect((ns as Record<string, unknown>)["clientes"]).toBeDefined();
  });

  it("a coluna carrega o tipo real em detail, e a PK é marcada", () => {
    const { schema: ns } = construirCompletion(
      schema([{
        name: "public",
        relations: [relacao("t", "table", [coluna("id", "bigint", true), coluna("nome", "text")])],
      }]),
    );
    const t = (ns as Record<string, { children: readonly { label: string; detail?: string }[] }>)["t"];
    const cols = t?.children ?? [];
    expect(cols.find((c) => c.label === "id")?.detail).toContain("PK");
    expect(cols.find((c) => c.label === "nome")?.detail).toBe("text");
  });

  it("nome de tabela igual em schemas diferentes: o topo pega uma, as duas ficam qualificadas", () => {
    // O caso que o usuário citou: tabelas parecidas não podem sumir.
    const { schema: ns } = construirCompletion(
      schema([
        { name: "public", relations: [relacao("notas", "table", [coluna("id", "int")])] },
        { name: "fiscal", relations: [relacao("notas", "table", [coluna("id", "bigint")])] },
      ]),
    );
    const raiz = ns as Record<string, Record<string, unknown>>;
    // As duas continuam alcançáveis pelo caminho qualificado.
    expect(raiz["public"]?.["notas"]).toBeDefined();
    expect(raiz["fiscal"]?.["notas"]).toBeDefined();
  });
});
