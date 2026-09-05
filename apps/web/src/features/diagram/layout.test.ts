import { describe, expect, it } from "bun:test";

import type { DatabaseSchema } from "@dbee/shared";

import { calcularLayout, construirGrafo, nodeId } from "./layout";

const col = (name: string, pk = false) => ({
  name, dataType: "int", dataTypeId: 0, nullable: true, defaultValue: null,
  position: 1, isPrimaryKey: pk, comment: null,
});

const fk = (col: string, refSchema: string, refTable: string, refCol: string) => ({
  name: `fk_${col}`, columns: [col], referencedSchema: refSchema,
  referencedTable: refTable, referencedColumns: [refCol],
});

const rel = (name: string, colunas: ReturnType<typeof col>[], fks: ReturnType<typeof fk>[] = []) => ({
  name, kind: "table" as const, comment: null, estimatedRows: null,
  columns: colunas, primaryKey: colunas.filter((c) => c.isPrimaryKey).map((c) => c.name),
  foreignKeys: fks, indexes: [],
});

const schema = (schemas: DatabaseSchema["schemas"]): DatabaseSchema => ({
  database: "d", schemas, fetchedAt: "2026-01-01T00:00:00Z", cached: false,
});

const NOTAS_EMPRESAS = schema([
  {
    name: "public",
    relations: [
      rel("empresas", [col("id", true), col("nome")]),
      rel("notas", [col("id", true), col("empresa_id")], [fk("empresa_id", "public", "empresas", "id")]),
    ],
  },
]);

describe("grafo do ERD", () => {
  it("um nó por relação, uma aresta por FK", () => {
    const { nodes, edges } = construirGrafo(NOTAS_EMPRESAS);
    expect(nodes.map((n) => n.id).sort()).toEqual([nodeId("public", "empresas"), nodeId("public", "notas")].sort());
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: nodeId("public", "notas"), to: nodeId("public", "empresas") });
  });

  it("marca PK e FK nas colunas", () => {
    const { nodes } = construirGrafo(NOTAS_EMPRESAS);
    const notas = nodes.find((n) => n.id === nodeId("public", "notas"));
    expect(notas?.columns.find((c) => c.name === "id")?.pk).toBe(true);
    expect(notas?.columns.find((c) => c.name === "empresa_id")?.fk).toBe(true);
  });

  it("FK para tabela fora do schema carregado não vira aresta órfã", () => {
    const s = schema([
      { name: "public", relations: [
        rel("notas", [col("id", true), col("x")], [fk("x", "outro", "sumiu", "id")]),
      ] },
    ]);
    expect(construirGrafo(s).edges).toHaveLength(0);
  });
});

describe("layout", () => {
  it("é determinístico — mesma entrada, mesmas posições", () => {
    const a = calcularLayout(NOTAS_EMPRESAS);
    const b = calcularLayout(NOTAS_EMPRESAS);
    expect(a.nodes.map((n) => [n.id, Math.round(n.x), Math.round(n.y)]))
      .toEqual(b.nodes.map((n) => [n.id, Math.round(n.x), Math.round(n.y)]));
  });

  it("nenhum nó fica sobreposto a outro depois de assentar", () => {
    // Cinco tabelas em estrela: uma central, quatro apontando para ela.
    const central = rel("dim", [col("id", true)]);
    const fatos = [1, 2, 3, 4].map((i) =>
      rel(`fato${String(i)}`, [col("id", true), col("dim_id")], [fk("dim_id", "public", "dim", "id")]),
    );
    const s = schema([{ name: "public", relations: [central, ...fatos] }]);
    const { nodes } = calcularLayout(s);

    let sobrepostos = 0;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (a === undefined || b === undefined) continue;
        const sobrepoeX = a.x < b.x + b.width && a.x + a.width > b.x;
        const sobrepoeY = a.y < b.y + b.height && a.y + a.height > b.y;
        if (sobrepoeX && sobrepoeY) sobrepostos++;
      }
    }
    expect(sobrepostos).toBe(0);
  });

  it("a tabela referenciada fica num posto à esquerda da que a referencia", () => {
    // Propriedade de layout em camadas (dagre, rankdir LR): o pai da FK entra
    // num posto anterior ao da filha — a leitura "esta depende daquela".
    const dim = rel("dim", [col("id", true)]);
    const fato = rel("fato", [col("id", true), col("dim_id")], [fk("dim_id", "public", "dim", "id")]);
    const s = schema([{ name: "public", relations: [dim, fato] }]);
    const { nodes } = calcularLayout(s);

    const nDim = nodes.find((n) => n.id === nodeId("public", "dim"));
    const nFato = nodes.find((n) => n.id === nodeId("public", "fato"));
    if (nDim === undefined || nFato === undefined) throw new Error("nós faltando");
    expect(nDim.x).toBeLessThan(nFato.x);
  });

  it("nós sem FK não explodem a extensão do desenho", () => {
    // Cinco tabelas soltas, sem nenhuma FK: a gravidade central tem de mantê-las
    // agrupadas, senão a repulsão as espalha e o desenho vira pontinhos.
    const soltas = [1, 2, 3, 4, 5].map((i) => rel(`solta${String(i)}`, [col("id", true)]));
    const s = schema([{ name: "public", relations: soltas }]);
    const l = calcularLayout(s);
    // Cinco caixas de 220px cabem folgadas em bem menos que 4000px de lado.
    expect(l.width).toBeLessThan(4000);
    expect(l.height).toBeLessThan(4000);
  });

  it("schema vazio não estoura", () => {
    const l = calcularLayout(schema([]));
    expect(l.nodes).toHaveLength(0);
    expect(l.width).toBeGreaterThan(0);
  });
});
