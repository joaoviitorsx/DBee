import { describe, expect, it } from "bun:test";

import { csvField, csvLine, csvOptions, exportFilename, tsvLine } from "./export";

describe("escape de CSV", () => {
  it("valor simples sai sem aspas", () => {
    expect(csvField("abc", ";")).toBe("abc");
  });

  it("valor com o separador vai entre aspas", () => {
    expect(csvField("a;b", ";")).toBe('"a;b"');
    // Com vírgula como separador, o ";" deixa de exigir aspas.
    expect(csvField("a;b", ",")).toBe("a;b");
    expect(csvField("a,b", ",")).toBe('"a,b"');
  });

  it("aspas são dobradas", () => {
    expect(csvField('diz "oi"', ";")).toBe('"diz ""oi"""');
  });

  it("quebra de linha vai entre aspas", () => {
    expect(csvField("linha1\nlinha2", ";")).toBe('"linha1\nlinha2"');
    expect(csvField("com\rretorno", ";")).toBe('"com\rretorno"');
  });

  it("NULL e string vazia saem os dois como campo vazio", () => {
    // Ambiguidade real do formato: sem inventar convenção não há como
    // distinguir, e convenção inventada seria lida errado pelo Excel.
    expect(csvField(null, ";")).toBe("");
    expect(csvField("", ";")).toBe("");
  });

  it("linha termina em CRLF", () => {
    expect(csvLine(["a", "b"], ";")).toBe("a;b\r\n");
  });

  it("linha com null no meio preserva as posições", () => {
    expect(csvLine(["a", null, "c"], ";")).toBe("a;;c\r\n");
  });
});

describe("defaults do CSV são os que funcionam no Excel brasileiro", () => {
  it("separador ; e BOM por padrão", () => {
    expect(csvOptions(undefined)).toEqual({ delimiter: ";", bom: true, header: true });
  });

  it("dá para escolher vírgula e sem BOM", () => {
    expect(csvOptions({ delimiter: ",", bom: false })).toEqual({
      delimiter: ",",
      bom: false,
      header: true,
    });
  });
});

describe("TSV para colar em planilha", () => {
  it("junta com tab", () => {
    expect(tsvLine(["a", "b", "c"])).toBe("a\tb\tc");
  });

  it("tab e quebra dentro do valor viram espaço", () => {
    // Não há escape em TSV: o tab dentro do valor quebraria as colunas.
    expect(tsvLine(["a\tb", "c\nd"])).toBe("a b\tc d");
  });

  it("null vira campo vazio", () => {
    expect(tsvLine(["a", null])).toBe("a\t");
  });
});

describe("nome de arquivo", () => {
  it("limpa caractere problemático e carimba a data", () => {
    const nome = exportFilename("vendas.cliente", "csv");
    expect(nome).toMatch(/^vendas\.cliente_\d{4}-\d{2}-\d{2}T[\d-]+\.csv$/);
  });

  it("acento e espaço viram _, e consecutivos colapsam num só", () => {
    // "çã" são dois caracteres seguidos fora de [A-Za-z0-9_.-]: viram um _.
    expect(exportFilename("Produção Assertivus", "csv")).toContain("Produ_o_Assertivus");
  });

  it("base vazia não gera arquivo sem nome", () => {
    expect(exportFilename("", "ndjson")).toMatch(/^dbee_.*\.ndjson$/);
  });
});
