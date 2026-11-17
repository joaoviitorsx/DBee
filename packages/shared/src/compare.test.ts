import { describe, expect, it } from "bun:test";

import { compararDados, compararSchemas, literal, montarInserts } from "./compare.puro";
import type { Column, Relation, SchemaNode } from "./schema";

describe("compararDados", () => {
  const esq = {
    columns: ["id", "nome", "so_esq"],
    rows: [["1", "Ana", "x"], ["2", "Beto", "x"], ["3", "O'Hara", "x"]],
  };
  const dir = {
    columns: ["id", "nome"],
    rows: [["1", "Ana"], ["2", "Bento"], ["9", null]],
  };

  it("conta, amostra e gera SQL que leva a direita à esquerda", () => {
    const r = compararDados(esq, dir, ["id"], { schema: "public", table: "p", dialeto: "postgres" }, 10);
    expect([r.onlyLeft, r.onlyRight, r.different, r.equal]).toEqual([1, 1, 1, 1]);
    expect(r.ignoredColumns).toEqual(["so_esq"]);
    expect(r.sql).toContain(`INSERT INTO "public"."p" ("id", "nome") VALUES ('3', 'O''Hara');`);
    expect(r.sql).toContain(`UPDATE "public"."p" SET "nome" = 'Beto' WHERE "id" = '2';`);
    expect(r.sql).toContain(`DELETE FROM "public"."p" WHERE "id" = '9';`);
    expect(r.samples.find((s) => s.kind === "different")?.changedColumns).toEqual(["nome"]);
  });

  it("NULL e a string 'null' não colidem na chave", () => {
    const r = compararDados(
      { columns: ["k"], rows: [[null]] },
      { columns: ["k"], rows: [["null"]] },
      ["k"],
      { schema: "s", table: "t", dialeto: "postgres" },
      0,
    );
    expect([r.onlyLeft, r.onlyRight]).toEqual([1, 1]);
    expect(r.samples).toEqual([]);
  });

  it("MySQL: crase no identificador e barra dobrada no literal", () => {
    expect(literal("a\\'b", "mysql")).toBe("'a\\\\''b'");
    expect(literal("a\\b", "postgres")).toBe("'a\\b'");
    const r = compararDados({ columns: ["id"], rows: [["1"]] }, { columns: ["id"], rows: [] }, ["id"], { schema: "loja", table: "t`x", dialeto: "mysql" }, 0);
    expect(r.sql).toContain("INSERT INTO `loja`.`t``x` (`id`) VALUES ('1');");
  });
});

const col = (name: string, dataType: string, extra: Partial<Column> = {}): Column => ({
  name, dataType, dataTypeId: 0, nullable: true, defaultValue: null, position: 1, isPrimaryKey: false, comment: null, ...extra,
});
const rel = (name: string, columns: Column[], extra: Partial<Relation> = {}): Relation => ({
  name, kind: "table", comment: null, estimatedRows: null, columns, primaryKey: [], foreignKeys: [], indexes: [], ...extra,
});

describe("compararSchemas", () => {
  it("adições prontas, remoções comentadas", () => {
    const a: SchemaNode = {
      name: "dev",
      relations: [
        rel("cliente", [col("id", "integer", { nullable: false }), col("email", "text", { nullable: false })], { primaryKey: ["id"] }),
        rel("novo", [col("id", "bigint")]),
      ],
    };
    const b: SchemaNode = {
      name: "prod",
      relations: [
        rel("cliente", [col("id", "bigint", { nullable: false }), col("velha", "text")], { primaryKey: ["id"] }),
        rel("antiga", [col("x", "int")]),
      ],
    };
    const r = compararSchemas(a, b);
    expect(r.differences.map((d) => d.kind).sort()).toEqual(
      ["column_only_left", "column_only_right", "column_type", "table_only_left", "table_only_right"],
    );
    expect(r.ddl).toContain(`ALTER TABLE "prod"."cliente" ADD COLUMN "email" text NOT NULL;`);
    expect(r.ddl).toContain(`ALTER TABLE "prod"."cliente" ALTER COLUMN "id" TYPE integer;`);
    expect(r.ddl).toContain(`CREATE TABLE "prod"."novo"`);
    expect(r.ddl).toContain(`-- ALTER TABLE "prod"."cliente" DROP COLUMN "velha";`);
    expect(r.ddl).toContain(`-- DROP TABLE "prod"."antiga";`);
    // Nenhuma linha de DROP sem comentário.
    for (const linha of r.ddl.split("\n")) {
      if (linha.includes("DROP ") && !linha.includes("DROP NOT NULL") && !linha.includes("DROP DEFAULT")) {
        expect(linha.trimStart().startsWith("--")).toBe(true);
      }
    }
  });

  it("nome hostil com quebra de linha não escapa do comentário", () => {
    const hostil = "x\nDROP TABLE public.notas; --";
    const a: SchemaNode = { name: "dev", relations: [rel("t", [col("id", "int")])] };
    const b: SchemaNode = {
      name: "prod",
      relations: [rel("t", [col("id", "int"), col(hostil, "text")]), rel(`y\r\nDROP TABLE z; --`, [col("a", "int")])],
    };
    const r = compararSchemas(a, b);
    for (const linha of r.ddl.split("\n")) {
      if (linha.includes("DROP")) expect(linha.trimStart().startsWith("--")).toBe(true);
    }
  });
});

describe("montarInserts — valores hostis", () => {
  const hostis: (string | null)[] = ["it's", "a\\b", "'); DROP TABLE t; --", "ção 🐝 中文", '"duplas"', null];

  it("Postgres: aspas dobradas, barra literal, cast pelo tipo, NULL sem cast", () => {
    const sql = montarInserts(
      { schema: "s", table: "t", dialeto: "postgres" },
      ["v"],
      hostis.map((h) => [h]),
      new Map([["v", "text"]]),
    );
    expect(sql).toContain("VALUES ('it''s'::text);");
    expect(sql).toContain("VALUES ('a\\b'::text);");
    expect(sql).toContain("VALUES ('''); DROP TABLE t; --'::text);");
    expect(sql).toContain("VALUES ('ção 🐝 中文'::text);");
    expect(sql).toContain("VALUES (NULL);");
  });

  it("MySQL: barra invertida dobrada e crase", () => {
    const sql = montarInserts({ schema: "s", table: "t", dialeto: "mysql" }, ["v"], [["a\\'b"]]);
    expect(sql).toBe("INSERT INTO `s`.`t` (`v`) VALUES ('a\\\\''b');");
  });

  it("SQLite: só aspas dobradas", () => {
    expect(montarInserts({ schema: "main", table: "t", dialeto: "sqlite" }, ["v"], [["a\\'b"]])).toBe(
      "INSERT INTO \"main\".\"t\" (\"v\") VALUES ('a\\''b');",
    );
  });

  it("NUL no Postgres é recusado", () => {
    expect(() => montarInserts({ schema: "s", table: "t", dialeto: "postgres" }, ["v"], [["a\u0000b"]])).toThrow();
  });
});
