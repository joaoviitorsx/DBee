import { describe, expect, it } from "bun:test";

import { nomearParametros, valoresDosParametros } from "./variaveis.puro";

describe("nomearParametros", () => {
  it("mesmo nome vira o mesmo $n, na ordem da 1ª aparição", () => {
    const r = nomearParametros("SELECT * FROM t WHERE a = :ini AND b < :fim OR c = :ini");
    expect(r.sql).toBe("SELECT * FROM t WHERE a = $1 AND b < $2 OR c = $1");
    expect(r.nomes).toEqual(["ini", "fim"]);
  });

  it("ignora ::cast, :=, strings, identificadores, comentários e dollar-quote", () => {
    const sql = [
      "SELECT :a::int, ':nao', E'\\':nao', \"col:nao\", $$ :nao $$, $f$ :nao $f$",
      "-- :nao",
      "/* :nao /* :nao */ :nao */ x := 1, :b",
    ].join("\n");
    const r = nomearParametros(sql);
    expect(r.nomes).toEqual(["a", "b"]);
    expect(r.sql).toContain("$1::int");
    expect(r.sql).toContain("':nao'");
    expect(r.sql.endsWith("x := 1, $2")).toBe(true);
  });

  it("aspas dobradas não fecham a string", () => {
    expect(nomearParametros("SELECT 'it''s :nao', :sim").nomes).toEqual(["sim"]);
  });

  it("valor nunca entra no texto", () => {
    const { sql, nomes } = nomearParametros("SELECT :v");
    const r = valoresDosParametros(nomes, { v: "'; DROP TABLE x; --" });
    expect(sql).toBe("SELECT $1");
    expect(r).toEqual({ ok: true, params: ["'; DROP TABLE x; --"] });
  });

  it("variável sem valor é erro, não NULL silencioso", () => {
    expect(valoresDosParametros(["a", "b"], { a: "1" })).toEqual({ ok: false, faltando: ["b"] });
    expect(valoresDosParametros(["a"], { a: null })).toEqual({ ok: true, params: [null] });
  });
});
