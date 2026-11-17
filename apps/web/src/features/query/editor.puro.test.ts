import { describe, expect, test } from "bun:test";

import { formatarSql } from "./formatar.puro";
import { localizar, trechoDoErro } from "./posicaoErro.puro";
import { nomeDoSqlstate } from "./sqlstate.puro";

describe("localizar", () => {
  test("linha e coluna 1-based", () => {
    expect(localizar("SELECT 1;\nSELEC x", 11)).toEqual({ linha: 2, coluna: 1, texto: "SELEC x" });
    expect(localizar("SELECT nome FROM x", 8)).toEqual({ linha: 1, coluna: 8, texto: "SELECT nome FROM x" });
  });
});

describe("trechoDoErro", () => {
  test("sublinha a palavra inteira", () => {
    expect(trechoDoErro("SELECT nomee FROM t", 7)).toEqual({ de: 7, ate: 12 });
  });
  test("identificador citado e qualificado", () => {
    expect(trechoDoErro('FROM "Minha Tabela" x', 5)).toEqual({ de: 5, ate: 19 });
    expect(trechoDoErro("FROM vendas.pedido x", 5)).toEqual({ de: 5, ate: 18 });
  });
  test("símbolo vira um caractere; fora do fim é preso ao último", () => {
    expect(trechoDoErro("a , b", 2)).toEqual({ de: 2, ate: 3 });
    expect(trechoDoErro("abc", 99)).toEqual({ de: 2, ate: 3 });
    expect(trechoDoErro("", 0)).toBeNull();
  });
});

describe("nomeDoSqlstate", () => {
  test("código conhecido, classe e desconhecido", () => {
    expect(nomeDoSqlstate("42P01")).toBe("undefined_table");
    expect(nomeDoSqlstate("22999")).toBe("data_exception");
    expect(nomeDoSqlstate("ZZ000")).toBeNull();
  });
});

describe("formatarSql", () => {
  test("quebra cláusulas e mantém :nome de snippet", () => {
    const f = formatarSql("select id, nome from clientes where id = :id and x::int > 1", "postgres");
    expect(f).toContain("SELECT\n");
    expect(f).toContain(":id");
    expect(f).toContain("::int");
  });
  test("crase do MySQL sobrevive", () => {
    expect(formatarSql("select `a` from `t`", "mysql")).toContain("`a`");
  });
  test("vazio não formata", () => {
    expect(formatarSql("   ", "postgres")).toBeNull();
  });
});
