import { describe, expect, it } from "bun:test";

import { construirDelete, construirInsert, construirUpdate } from "./mutation";

describe("construirUpdate", () => {
  it("SET com os novos valores, WHERE com PK e valores originais", () => {
    const c = construirUpdate({
      database: "app",
      schema: "public",
      table: "clientes",
      readOnly: false,
      pk: [{ column: "id", value: "42" }],
      changes: [{ column: "nome", from: "Ana", to: "Ana Maria" }],
    });

    expect(c.text).toBe(
      'UPDATE "public"."clientes" SET "nome" = $1 WHERE "id" = $2 AND "nome"::text = $3',
    );
    // Ordem dos params: SET (to), depois PK, depois guarda (from).
    expect(c.params).toEqual(["Ana Maria", "42", "Ana"]);
    expect(c.literal).toBe(
      `UPDATE "public"."clientes" SET "nome" = 'Ana Maria' WHERE "id" = '42' AND "nome"::text = 'Ana'`,
    );
  });

  it("valor original NULL vira IS NULL, sem parâmetro", () => {
    const c = construirUpdate({
      database: "app",
      schema: "public",
      table: "t",
      readOnly: false,
      pk: [{ column: "id", value: "1" }],
      changes: [{ column: "apelido", from: null, to: "novo" }],
    });

    expect(c.text).toBe(
      'UPDATE "public"."t" SET "apelido" = $1 WHERE "id" = $2 AND "apelido" IS NULL',
    );
    expect(c.params).toEqual(["novo", "1"]);
    expect(c.literal).toContain(`"apelido" IS NULL`);
  });

  it("novo valor NULL vai como parâmetro (SET x = NULL no literal)", () => {
    const c = construirUpdate({
      database: "app",
      schema: "public",
      table: "t",
      readOnly: false,
      pk: [{ column: "id", value: "1" }],
      changes: [{ column: "apelido", from: "x", to: null }],
    });

    expect(c.params).toEqual([null, "1", "x"]);
    expect(c.literal).toContain(`SET "apelido" = NULL`);
  });

  it("aspas em identificador e apóstrofo em valor são escapados", () => {
    const c = construirUpdate({
      database: "app",
      schema: "pub",
      table: 'ta"bela',
      readOnly: false,
      pk: [{ column: "id", value: "1" }],
      changes: [{ column: "nome", from: "d'Ávila", to: "O'Brien" }],
    });

    expect(c.text).toContain('"ta""bela"');
    // O literal escapa o apóstrofo dobrando — inerte, mas correto.
    expect(c.literal).toContain(`'O''Brien'`);
    expect(c.literal).toContain(`'d''Ávila'`);
    // O executado manda o valor cru por parâmetro, sem escape manual.
    expect(c.params).toContain("O'Brien");
  });

  it("PK composta entra inteira no WHERE", () => {
    const c = construirUpdate({
      database: "app",
      schema: "public",
      table: "itens",
      readOnly: false,
      pk: [
        { column: "pedido_id", value: "10" },
        { column: "produto_id", value: "20" },
      ],
      changes: [{ column: "qtd", from: "1", to: "2" }],
    });

    expect(c.text).toBe(
      'UPDATE "public"."itens" SET "qtd" = $1 WHERE "pedido_id" = $2 AND "produto_id" = $3 AND "qtd"::text = $4',
    );
    expect(c.params).toEqual(["2", "10", "20", "1"]);
  });
});

describe("construirInsert", () => {
  it("só as colunas informadas; NULL vai como parâmetro", () => {
    const c = construirInsert({
      database: "app",
      schema: "public",
      table: "pessoas",
      readOnly: false,
      values: [
        { column: "nome", value: "Ana" },
        { column: "apelido", value: null },
      ],
    });

    expect(c.text).toBe('INSERT INTO "public"."pessoas" ("nome", "apelido") VALUES ($1, $2)');
    expect(c.params).toEqual(["Ana", null]);
    expect(c.literal).toBe(
      `INSERT INTO "public"."pessoas" ("nome", "apelido") VALUES ('Ana', NULL)`,
    );
  });
});

describe("construirDelete", () => {
  it("PK sem cast, guarda por ::text nas colunas não-chave", () => {
    const c = construirDelete({
      database: "app",
      schema: "public",
      table: "clientes",
      readOnly: false,
      pk: [{ column: "id", value: "7" }],
      guard: [
        { column: "nome", value: "Ana" },
        { column: "apelido", value: null },
      ],
    });

    expect(c.text).toBe(
      'DELETE FROM "public"."clientes" WHERE "id" = $1 AND "nome"::text = $2 AND "apelido" IS NULL',
    );
    // A PK entra primeiro (índice), depois as guardas com valor.
    expect(c.params).toEqual(["7", "Ana"]);
    expect(c.literal).toBe(
      `DELETE FROM "public"."clientes" WHERE "id" = '7' AND "nome"::text = 'Ana' AND "apelido" IS NULL`,
    );
  });

  it("tabela só-PK: guarda vazia, DELETE só pela PK", () => {
    const c = construirDelete({
      database: "app",
      schema: "public",
      table: "chaves",
      readOnly: false,
      pk: [{ column: "id", value: "7" }],
      guard: [],
    });

    expect(c.text).toBe('DELETE FROM "public"."chaves" WHERE "id" = $1');
    expect(c.params).toEqual(["7"]);
  });
});
