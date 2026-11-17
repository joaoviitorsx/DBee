import { describe, expect, test } from "bun:test";

import { lerPlano } from "./plano.puro";

const PLANO = JSON.stringify([
  {
    Plan: {
      "Node Type": "Hash Join",
      "Join Type": "Inner",
      "Startup Cost": 1,
      "Total Cost": 100,
      "Plan Rows": 50,
      "Hash Cond": "(p.cliente_id = c.id)",
      Plans: [
        { "Node Type": "Seq Scan", "Relation Name": "pedidos", Alias: "p", "Startup Cost": 0, "Total Cost": 70, "Plan Rows": 500, Filter: "(total > 10)" },
        {
          "Node Type": "Hash",
          "Total Cost": 20,
          Plans: [{ "Node Type": "Index Scan", "Relation Name": "clientes", Alias: "clientes", "Index Name": "clientes_pkey", "Total Cost": 18 }],
        },
      ],
    },
    "Planning Time": 0.2,
  },
]);

describe("lerPlano", () => {
  test("monta a árvore com tipo, alvo e detalhes", () => {
    const p = lerPlano(PLANO);
    expect(p).not.toBeNull();
    if (p === null) return;
    expect(p.raiz.tipo).toBe("Inner Hash Join");
    expect(p.raiz.filhos[0]?.alvo).toBe("pedidos p");
    expect(p.raiz.filhos[0]?.detalhes).toEqual(["Filter: (total > 10)"]);
    // Alias igual ao nome não repete; índice entre parênteses.
    expect(p.raiz.filhos[1]?.filhos[0]?.alvo).toBe("clientes (clientes_pkey)");
    expect(p.tempoPlanejamento).toBe(0.2);
    expect(p.analisado).toBe(false);
  });

  test("mais caro é pelo custo exclusivo, não pelo total da raiz", () => {
    const p = lerPlano(PLANO);
    // raiz: 100-90=10; seq scan: 70; hash: 2; index: 18.
    expect(p?.maisCaro).toBe(1);
    expect(p?.total).toBe(100);
  });

  test("com ANALYZE usa tempo real × loops", () => {
    const p = lerPlano(JSON.stringify([{ Plan: {
      "Node Type": "Nested Loop", "Total Cost": 5, "Actual Total Time": 10, "Actual Loops": 1, "Actual Rows": 3,
      Plans: [
        { "Node Type": "Seq Scan", "Total Cost": 1, "Actual Total Time": 1, "Actual Loops": 1 },
        { "Node Type": "Index Scan", "Total Cost": 4, "Actual Total Time": 0.5, "Actual Loops": 16 },
      ],
    }, "Execution Time": 10.5 }]));
    expect(p?.analisado).toBe(true);
    expect(p?.raiz.filhos[1]?.tempoReal).toBe(8);
    expect(p?.maisCaro).toBe(2);
    expect(p?.tempoExecucao).toBe(10.5);
  });

  test("texto que não é plano devolve null", () => {
    expect(lerPlano("não é json")).toBeNull();
    expect(lerPlano("[]")).toBeNull();
    expect(lerPlano('{"x":1}')).toBeNull();
  });
});
