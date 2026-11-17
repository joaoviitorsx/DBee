import { describe, expect, it } from "bun:test";

import { formatarSchemaCompacto, montarScriptCopia, tipoNoDestino } from "./puro";
import type { Relation } from "./schema";

const col = (name: string, dataType: string, extra: Partial<Relation["columns"][number]> = {}) => ({
  name, dataType, dataTypeId: 0, nullable: true, defaultValue: null, position: 1, isPrimaryKey: false, comment: null, ...extra,
});

const rel: Relation = {
  name: "pedidos",
  kind: "table",
  comment: null,
  estimatedRows: 10,
  columns: [
    col("id", "bigint", { nullable: false, isPrimaryKey: true, defaultValue: "nextval('pedidos_id_seq'::regclass)" }),
    col("nome", "character varying(50)", { defaultValue: "'x'::character varying" }),
    col("valor", "numeric(10,2)"),
    col("geo", "geometry"),
  ],
  primaryKey: ["id"],
  foreignKeys: [{ name: "fk", columns: ["id"], referencedSchema: "public", referencedTable: "c", referencedColumns: ["id"] }],
  indexes: [{ name: "pk", columns: ["id"], isUnique: true, isPrimary: true, definition: "" }],
};

describe("tipoNoDestino", () => {
  it("mesmo dialeto é literal; famílias mapeiam; desconhecido → null", () => {
    expect(tipoNoDestino("geometry", "postgres", "postgres")).toBe("geometry");
    expect(tipoNoDestino("character varying(50)", "postgres", "mysql")).toBe("VARCHAR(50)");
    expect(tipoNoDestino("tinyint(1)", "mysql", "postgres")).toBe("boolean");
    expect(tipoNoDestino("int", "mysql", "postgres")).toBe("integer");
    expect(tipoNoDestino("numeric(10,2)", "postgres", "sqlite")).toBe("NUMERIC");
    expect(tipoNoDestino("timestamp with time zone", "postgres", "mysql")).toBe("DATETIME(6)");
    expect(tipoNoDestino("geometry", "postgres", "mysql")).toBeNull();
  });
});

describe("montarScriptCopia", () => {
  const base = {
    relacao: rel, origem: "postgres" as const, schemaDestino: "public", tabelaDestino: "pedidos",
    colunas: ["id", "nome", "valor", "geo"], linhas: [["1", "O'Brien", "1.50", null]], truncado: false,
    descricaoOrigem: "prod\n-- injetado · public.pedidos",
  };

  it("postgres → postgres: tipos literais, default sem nextval, INSERT com cast, comentário sem quebra", () => {
    const { sql, warnings } = montarScriptCopia({ ...base, destino: "postgres" });
    expect(sql).toContain(`CREATE TABLE "public"."pedidos" (`);
    expect(sql).toContain(`"id" bigint NOT NULL`);
    expect(sql.slice(sql.indexOf("CREATE TABLE"))).not.toContain("nextval");
    expect(sql).toContain(`"nome" character varying(50) DEFAULT 'x'::character varying`);
    expect(sql).toContain(`PRIMARY KEY ("id")`);
    expect(sql).toContain(`'O''Brien'::character varying(50)`);
    expect(sql).not.toContain("\n-- injetado");
    expect(warnings.some((w) => w.includes("chaves estrangeiras"))).toBe(true);
  });

  it("postgres → mysql: crase, tipo mapeado, desconhecido vira LONGTEXT com aviso", () => {
    const { sql, warnings } = montarScriptCopia({ ...base, destino: "mysql", schemaDestino: "app" });
    expect(sql).toContain("CREATE TABLE `app`.`pedidos`");
    expect(sql).toContain("`nome` VARCHAR(50)");
    expect(sql).toContain("`geo` LONGTEXT");
    expect(sql).not.toContain("DEFAULT");
    expect(warnings.some((w) => w.includes("geometry"))).toBe(true);
    expect(sql).toContain("INSERT INTO `app`.`pedidos`");
  });

  it("sem linhas: só estrutura; truncado avisa", () => {
    const { sql, warnings } = montarScriptCopia({ ...base, destino: "sqlite", linhas: [], truncado: true });
    expect(sql).not.toContain("INSERT");
    expect(warnings.some((w) => w.includes("truncados"))).toBe(true);
  });
});

describe("formatarSchemaCompacto", () => {
  const schemas = [
    { name: "public", relations: [rel, { ...rel, name: "outra" }] },
    { name: "aux", relations: [{ ...rel, name: "x" }] },
  ];

  it("formato estável com PK, FK, sem índice primário", () => {
    const p = formatarSchemaCompacto(schemas, { offset: 0, maxChars: 100_000 });
    expect(p.text.split("\n").slice(0, 2)).toEqual(["public.pedidos table ~10", "  id bigint NOT NULL = nextval('pedidos_id_seq'::regclass) PK"]);
    expect(p.text).toContain("  FK (id) -> public.c(id)");
    expect(p.text).not.toContain("IDX");
    expect(p.totalRelations).toBe(3);
    expect(p.nextOffset).toBeNull();
  });

  it("pagina por relação respeitando maxChars e filtra por schema", () => {
    const um = formatarSchemaCompacto(schemas, { offset: 0, maxChars: 200 });
    expect(um.returnedRelations).toBe(1);
    expect(um.nextOffset).toBe(1);
    const resto = formatarSchemaCompacto(schemas, { offset: 1, maxChars: 200 });
    expect(resto.text.startsWith("public.outra")).toBe(true);
    expect(formatarSchemaCompacto(schemas, { schema: "aux", offset: 0, maxChars: 1000 }).totalRelations).toBe(1);
  });

  it("bloco maior que o teto é cortado", () => {
    const p = formatarSchemaCompacto(schemas, { offset: 0, maxChars: 50 });
    expect(p.text.endsWith("…(truncado)")).toBe(true);
  });
});
