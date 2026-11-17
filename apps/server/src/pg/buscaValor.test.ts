import { describe, expect, it } from "bun:test";

import { planejarTabela } from "./buscaValor";

const [texto, , numero] = [
  { nome: "nome", tipo: "texto" as const },
  null,
  { nome: "total", tipo: "numero" as const },
] as const;

const tabela = {
  schema: 'sch"x',
  nome: "Pedido",
  pk: ["id"],
  colunas: [
    { nome: "nome", tipo: "texto" as const },
    { nome: 'ev"il', tipo: "texto" as const },
    { nome: "total", tipo: "numero" as const },
  ],
};

describe("planejarTabela", () => {
  it("valor só como parâmetro, identificadores citados, LIMIT teto+1", () => {
    const p = planejarTabela(tabela, "x'; DROP TABLE t; --", "contains", 20);
    expect(p.sql).not.toContain("DROP");
    expect(p.sql).toContain('FROM "sch""x"."Pedido"');
    expect(p.sql).toContain('"ev""il"::text ILIKE $1');
    expect(p.sql).toContain('"total" = $2::numeric');
    expect(p.sql).toMatch(/LIMIT 21$/);
    expect(p.valores).toEqual(["%x'; DROP TABLE t; --%", "x'; DROP TABLE t; --"]);
  });
  it("exato usa igualdade e um parâmetro por tipo", () => {
    const p = planejarTabela({ ...tabela, colunas: [texto] }, "Ana", "exact", 5);
    expect(p.sql).toContain('"nome"::text = $1');
    expect(p.valores).toEqual(["Ana"]);
  });
  it("só numérica: o primeiro parâmetro é o número", () => {
    const p = planejarTabela({ ...tabela, pk: [], colunas: [numero] }, " 42 ", "contains", 5);
    expect(p.sql).toContain('"total" = $1::numeric');
    expect(p.valores).toEqual(["42"]);
  });
});
