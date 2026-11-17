import type { SearchHit } from "@dbee/shared";
import { describe, expect, it } from "bun:test";

import { agrupar, mover, rotuloDoHit } from "./agrupar.puro";

const base = { connectionId: "c", connectionName: "Demo", database: "d", schema: "public" };
const rel: SearchHit = { ...base, kind: "relation", relation: "clientes", relationKind: "table", column: null };
const col: SearchHit = { ...base, kind: "column", relation: "clientes", relationKind: "table", column: "nome" };
const sch: SearchHit = { ...base, kind: "schema", relation: null, relationKind: null, column: null };

describe("agrupar", () => {
  it("ordena grupos relação, coluna, schema e numera o índice plano", () => {
    const { grupos, planos } = agrupar([sch, col, rel]);
    expect(grupos.map((g) => [g.kind, g.inicio])).toEqual([["relation", 0], ["column", 1], ["schema", 2]]);
    expect(planos).toEqual([rel, col, sch]);
  });
  it("omite grupo vazio", () => {
    expect(agrupar([col]).grupos.map((g) => g.kind)).toEqual(["column"]);
  });
});

describe("rotuloDoHit / mover", () => {
  it("monta o caminho", () => {
    expect(rotuloDoHit(col)).toBe("public.clientes.nome");
    expect(rotuloDoHit(sch)).toBe("public");
  });
  it("dá a volta", () => {
    expect(mover(2, 3, 1)).toBe(0);
    expect(mover(0, 3, -1)).toBe(2);
    expect(mover(0, 0, 1)).toBe(0);
  });
});
