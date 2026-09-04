import type { PoolClient } from "pg";
import { describe, expect, it } from "bun:test";

import { introspect } from "./introspect";

/**
 * Cliente falso que devolve linhas de catálogo canônicas.
 *
 * Testa a montagem da árvore — agrupamento, ordem de chave composta, descarte
 * de FK órfã, índice de expressão — sem depender de um Postgres de pé. As
 * consultas em si são verificadas à mão contra um banco real; o que quebra em
 * silêncio numa refatoração é a montagem, e é ela que fica travada aqui.
 */
function fakeClient(rows: {
  relations: unknown[];
  columns: unknown[];
  constraints: unknown[];
  indexes: unknown[];
}): PoolClient {
  const dispatch = (sql: string): unknown[] => {
    if (sql.includes("FROM pg_class c")) return rows.relations;
    if (sql.includes("FROM pg_attribute a")) return rows.columns;
    if (sql.includes("FROM pg_constraint")) return rows.constraints;
    if (sql.includes("FROM pg_index")) return rows.indexes;
    throw new Error(`consulta inesperada: ${sql.slice(0, 40)}`);
  };

  return {
    query: (sql: string) => Promise.resolve({ rows: dispatch(sql) }),
  } as unknown as PoolClient;
}

// OIDs chegam como string: são lidos com `::bigint` para não dar wrap
// negativo acima de 2^31 (o `pg` expõe o dataTypeID de um resultado sem sinal).
const relation = (oid: number, schema: string, name: string, relkind = "r", reltuples = 10) => ({
  oid: String(oid), schema, name, relkind, comment: null, reltuples,
});

const column = (oid: number, name: string, position: number) => ({
  oid: String(oid), name, data_type: "text", data_type_id: "25", nullable: true,
  default_value: null, position, comment: null,
});

describe("introspect — montagem da árvore", () => {
  it("agrupa relações por schema", async () => {
    const tree = await introspect(
      fakeClient({
        relations: [
          relation(1, "public", "a"),
          relation(2, "vendas", "b"),
          relation(3, "public", "c"),
        ],
        columns: [], constraints: [], indexes: [],
      }),
      "db",
    );

    expect(tree.schemas.map((s) => s.name)).toEqual(["public", "vendas"]);
    expect(tree.schemas[0]?.relations.map((r) => r.name)).toEqual(["a", "c"]);
    expect(tree.database).toBe("db");
    expect(tree.cached).toBe(false);
  });

  it("traduz relkind para o vocabulário da UI", async () => {
    const tree = await introspect(
      fakeClient({
        relations: [
          relation(1, "s", "t", "r"), relation(2, "s", "v", "v"),
          relation(3, "s", "m", "m"), relation(4, "s", "p", "p"),
          relation(5, "s", "f", "f"),
        ],
        columns: [], constraints: [], indexes: [],
      }),
      "db",
    );

    expect(tree.schemas[0]?.relations.map((r) => r.kind)).toEqual([
      "table", "view", "materialized_view", "partitioned_table", "foreign_table",
    ]);
  });

  it("preserva a ordem de uma chave primária composta", async () => {
    const tree = await introspect(
      fakeClient({
        relations: [relation(1, "s", "item")],
        columns: [column(1, "pedido_id", 1), column(1, "linha", 2), column(1, "produto", 3)],
        constraints: [
          { oid: "1", name: "item_pkey", contype: "p", columns: ["pedido_id", "linha"],
            ref_schema: null, ref_table: null, ref_columns: null },
        ],
        indexes: [],
      }),
      "db",
    );

    const item = tree.schemas[0]?.relations[0];
    expect(item?.primaryKey).toEqual(["pedido_id", "linha"]);
    // Coluna que faz parte da PK vem marcada, a que não faz não.
    expect(item?.columns.map((c) => [c.name, c.isPrimaryKey])).toEqual([
      ["pedido_id", true], ["linha", true], ["produto", false],
    ]);
  });

  it("monta chave estrangeira composta com os dois lados", async () => {
    const tree = await introspect(
      fakeClient({
        relations: [relation(1, "s", "item_nota")],
        columns: [],
        constraints: [
          { oid: "1", name: "fk_item", contype: "f", columns: ["pedido_id", "linha"],
            ref_schema: "vendas", ref_table: "item", ref_columns: ["pedido_id", "linha"] },
        ],
        indexes: [],
      }),
      "db",
    );

    expect(tree.schemas[0]?.relations[0]?.foreignKeys).toEqual([
      {
        name: "fk_item",
        columns: ["pedido_id", "linha"],
        referencedSchema: "vendas",
        referencedTable: "item",
        referencedColumns: ["pedido_id", "linha"],
      },
    ]);
  });

  it("descarta FK sem alvo resolvido em vez de emitir entrada vazia", async () => {
    const tree = await introspect(
      fakeClient({
        relations: [relation(1, "s", "t")],
        columns: [],
        constraints: [
          { oid: "1", name: "fk_quebrada", contype: "f", columns: ["x"],
            ref_schema: null, ref_table: null, ref_columns: null },
        ],
        indexes: [],
      }),
      "db",
    );

    expect(tree.schemas[0]?.relations[0]?.foreignKeys).toEqual([]);
  });

  it("índice sobre expressão vem com columns vazio e a definição literal", async () => {
    const tree = await introspect(
      fakeClient({
        relations: [relation(1, "s", "cliente")],
        columns: [],
        constraints: [],
        indexes: [
          // array_agg devolve NULL quando o índice é sobre expressão.
          { oid: "1", name: "idx_lower_email", columns: null, is_unique: false,
            is_primary: false, definition: "CREATE INDEX idx_lower_email ON s.cliente (lower(email))" },
          { oid: "1", name: "cliente_pkey", columns: ["id"], is_unique: true,
            is_primary: true, definition: "CREATE UNIQUE INDEX cliente_pkey ON s.cliente (id)" },
        ],
      }),
      "db",
    );

    const indexes = tree.schemas[0]?.relations[0]?.indexes ?? [];
    expect(indexes[0]?.columns).toEqual([]);
    expect(indexes[0]?.definition).toContain("lower(email)");
    expect(indexes[1]?.columns).toEqual(["id"]);
    expect(indexes[1]?.isPrimary).toBe(true);
  });

  it("reltuples negativo vira null — relação nunca analisada", async () => {
    const tree = await introspect(
      fakeClient({
        relations: [relation(1, "s", "nova", "r", -1), relation(2, "s", "velha", "r", 4999.6)],
        columns: [], constraints: [], indexes: [],
      }),
      "db",
    );

    expect(tree.schemas[0]?.relations[0]?.estimatedRows).toBeNull();
    expect(tree.schemas[0]?.relations[1]?.estimatedRows).toBe(5000);
  });

  it("relação sem colunas, sem chave e sem índice não quebra", async () => {
    const tree = await introspect(
      fakeClient({ relations: [relation(1, "s", "vazia")], columns: [], constraints: [], indexes: [] }),
      "db",
    );

    const rel = tree.schemas[0]?.relations[0];
    expect(rel?.columns).toEqual([]);
    expect(rel?.primaryKey).toEqual([]);
    expect(rel?.foreignKeys).toEqual([]);
    expect(rel?.indexes).toEqual([]);
  });
});
