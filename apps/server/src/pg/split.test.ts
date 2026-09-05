import { describe, expect, it } from "bun:test";

import { splitStatements } from "./split";

const sqls = (s: string): string[] => splitStatements(s).map((x) => x.sql);

describe("separação de statements", () => {
  it("um statement", () => {
    expect(sqls("SELECT 1")).toEqual(["SELECT 1"]);
  });

  it("dois separados por ;", () => {
    expect(sqls("SELECT 1; SELECT 2")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("ignora ; final e vazios", () => {
    expect(sqls("SELECT 1;")).toEqual(["SELECT 1"]);
    expect(sqls(";;SELECT 1;;;")).toEqual(["SELECT 1"]);
    expect(sqls("   \n  ")).toEqual([]);
    expect(sqls("")).toEqual([]);
  });
});

describe("; que NÃO termina statement", () => {
  it("dentro de string simples", () => {
    // Um split(";") ingênuo quebraria isto em dois statements inválidos.
    expect(sqls("SELECT ';'")).toEqual(["SELECT ';'"]);
    expect(sqls("SELECT 'a;b', 'c;d'; SELECT 2")).toEqual(["SELECT 'a;b', 'c;d'", "SELECT 2"]);
  });

  it("com aspa escapada dentro da string", () => {
    expect(sqls("SELECT 'it''s; ok'; SELECT 2")).toEqual(["SELECT 'it''s; ok'", "SELECT 2"]);
  });

  it("dentro de string E'' com barra invertida", () => {
    expect(sqls("SELECT E'a\\';b'; SELECT 2")).toEqual(["SELECT E'a\\';b'", "SELECT 2"]);
  });

  it("dentro de identificador entre aspas duplas", () => {
    expect(sqls('SELECT "col;na" FROM t; SELECT 2')).toEqual(['SELECT "col;na" FROM t', "SELECT 2"]);
  });

  it("dentro de dollar quoting", () => {
    expect(sqls("SELECT $$a;b$$; SELECT 2")).toEqual(["SELECT $$a;b$$", "SELECT 2"]);
  });

  it("dentro de dollar quoting com tag", () => {
    const sql = "SELECT $corpo$ um; dois; $corpo$; SELECT 2";
    expect(sqls(sql)).toEqual(["SELECT $corpo$ um; dois; $corpo$", "SELECT 2"]);
  });

  it("corpo de função com dollar quoting e ; dentro", () => {
    const sql = `CREATE FUNCTION f() RETURNS int AS $fn$
BEGIN
  PERFORM 1;
  RETURN 2;
END;
$fn$ LANGUAGE plpgsql; SELECT 3`;
    const r = sqls(sql);
    expect(r).toHaveLength(2);
    expect(r[0]).toContain("RETURN 2;");
    expect(r[1]).toBe("SELECT 3");
  });

  it("dentro de comentário de linha", () => {
    expect(sqls("SELECT 1 -- isto; não conta\n; SELECT 2")).toEqual([
      "SELECT 1 -- isto; não conta",
      "SELECT 2",
    ]);
  });

  it("dentro de comentário de bloco", () => {
    expect(sqls("SELECT 1 /* a; b */; SELECT 2")).toEqual(["SELECT 1 /* a; b */", "SELECT 2"]);
  });

  it("comentário de bloco aninhado — o Postgres aninha", () => {
    expect(sqls("SELECT 1 /* a /* b; c */ d; */; SELECT 2")).toEqual([
      "SELECT 1 /* a /* b; c */ d; */",
      "SELECT 2",
    ]);
  });

  it("string não fechada não perde o resto", () => {
    // Entrada inválida: o Postgres é que reporta o erro, não o separador.
    expect(sqls("SELECT 'aberta")).toEqual(["SELECT 'aberta"]);
  });
});

describe("offset aponta para o SQL original", () => {
  it("o offset do primeiro statement pula o espaço à esquerda", () => {
    const s = splitStatements("  \n SELECT 1");
    expect(s[0]?.offset).toBe(4);
    expect("  \n SELECT 1".slice(s[0]?.offset ?? 0)).toBe("SELECT 1");
  });

  it("o offset do segundo aponta para onde ele começa", () => {
    const original = "SELECT 1;\n  SELECT 2";
    const s = splitStatements(original);
    expect(original.slice(s[1]?.offset ?? 0)).toBe("SELECT 2");
  });

  it("offset correto mesmo depois de comentário e string", () => {
    const original = "-- nota\nSELECT ';';\n  SELECT 2";
    const s = splitStatements(original);
    expect(original.slice(s[1]?.offset ?? 0)).toBe("SELECT 2");
  });
});
