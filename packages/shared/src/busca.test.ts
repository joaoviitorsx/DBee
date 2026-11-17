import { describe, expect, it } from "bun:test";

import { buscarNoCatalogo, type CatalogoBuscavel } from "./busca.puro";

const cat: CatalogoBuscavel = {
  connectionId: "c1",
  connectionName: "prod",
  database: "app",
  schemas: [
    {
      name: "vendas",
      relations: [
        { name: "pedido_item", kind: "table", columns: [{ name: "pedido_id" }, { name: "valor" }] },
        { name: "pedido", kind: "table", columns: [{ name: "id" }] },
        { name: "v_resumo_pedidos", kind: "view" },
      ],
    },
  ],
};

describe("buscarNoCatalogo", () => {
  it("igual > prefixo > contém; relação antes de coluna", () => {
    const r = buscarNoCatalogo([cat], "PEDIDO", 10);
    expect(r.hits.map((h) => `${h.kind}:${h.column ?? h.relation ?? h.schema}`)).toEqual([
      "relation:pedido",
      "relation:pedido_item",
      "column:pedido_id",
      "relation:v_resumo_pedidos",
    ]);
    expect(r.truncated).toBe(false);
  });

  it("limite trunca e avisa", () => {
    const r = buscarNoCatalogo([cat], "p", 2);
    expect(r.hits).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });

  it("termo vazio não casa nada", () => {
    expect(buscarNoCatalogo([cat], "  ", 10).hits).toEqual([]);
  });
});
