import type { DatabaseSchema } from "@dbee/shared";
import { describe, expect, it } from "bun:test";

import { countRelations, filterSchema, matches, normalize } from "./filter";

const rel = (name: string) =>
  ({ name, kind: "table", comment: null, estimatedRows: null, columns: [], primaryKey: [], foreignKeys: [], indexes: [] }) as const;

const arvore = {
  database: "app",
  fetchedAt: "",
  cached: false,
  schemas: [
    { name: "public", relations: [rel("clientes"), rel("pedidos"), rel("produção_log")] },
    { name: "vendas", relations: [rel("item"), rel("nota")] },
  ],
} as unknown as DatabaseSchema;

describe("normalize", () => {
  it("tira acento e caixa", () => {
    expect(normalize("Produção")).toBe("producao");
    expect(normalize("ÀÉÎÕÜ")).toBe("aeiou");
  });

  it("quem digita sem acento acha com acento", () => {
    expect(matches("producao", "produção_log")).toBe(true);
    expect(matches("PRODUÇÃO", "producao_log")).toBe(true);
  });
});

describe("filterSchema", () => {
  it("busca vazia devolve tudo", () => {
    const r = filterSchema(arvore, "");
    expect(r).toHaveLength(2);
    expect(countRelations(r)).toBe(5);
  });

  it("só espaços conta como vazia", () => {
    expect(countRelations(filterSchema(arvore, "   "))).toBe(5);
  });

  it("schema que casa aparece inteiro", () => {
    // Buscar "vendas" quer dizer "me mostre vendas", não "tabelas chamadas vendas".
    const r = filterSchema(arvore, "vendas");
    expect(r).toHaveLength(1);
    expect(r[0]?.schemaMatched).toBe(true);
    expect(r[0]?.relations.map((x) => x.name)).toEqual(["item", "nota"]);
  });

  it("schema que não casa aparece só com as relações que casaram", () => {
    const r = filterSchema(arvore, "cliente");
    expect(r).toHaveLength(1);
    expect(r[0]?.node.name).toBe("public");
    expect(r[0]?.schemaMatched).toBe(false);
    expect(r[0]?.relations.map((x) => x.name)).toEqual(["clientes"]);
  });

  it("schema sem nenhuma relação casando some", () => {
    expect(filterSchema(arvore, "inexistente")).toEqual([]);
  });

  it("casa em mais de um schema", () => {
    const r = filterSchema(arvore, "o");
    expect(r.length).toBeGreaterThan(1);
  });

  it("acha por acento independente de como foi digitado", () => {
    expect(countRelations(filterSchema(arvore, "producao"))).toBe(1);
    expect(countRelations(filterSchema(arvore, "produção"))).toBe(1);
  });
});
