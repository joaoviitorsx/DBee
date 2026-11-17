import { describe, expect, it } from "bun:test";

import { agruparMilhares, itensDeArray, lerCelula, resumoJson, tamanhoBytea } from "./celula.puro";

describe("lerCelula", () => {
  it("boolean do Postgres vira glifo, nos dois formatos", () => {
    expect(lerCelula("t", "boolean", "pt")).toEqual({ tipo: "bool", valor: true });
    expect(lerCelula("false", "bool", "pt")).toEqual({ tipo: "bool", valor: false });
  });

  it("timestamptz: data e minuto à frente, resto (segundos, fração, fuso) separado — sem Date()", () => {
    expect(lerCelula("2026-11-17 17:56:00.842+00", "timestamp with time zone", "pt")).toEqual({
      tipo: "data",
      principal: "17/11/2026 17:56",
      resto: ":00.842+00",
    });
    expect(lerCelula("2026-11-17 17:56:00", "timestamp without time zone", "en")).toEqual({
      tipo: "data",
      principal: "2026-11-17 17:56",
      resto: ":00",
    });
  });

  it("date puro e valor que não casa (infinity) caem no texto", () => {
    expect(lerCelula("2026-01-02", "date", "pt")).toEqual({ tipo: "data", principal: "02/01/2026", resto: "" });
    expect(lerCelula("infinity", "date", "pt").tipo).toBe("texto");
  });

  it("uuid encurtado", () => {
    expect(lerCelula("3f2a8c1e-0000-4000-8000-00000000c1e9", "uuid", "pt")).toEqual({
      tipo: "uuid",
      curto: "3f2a8c1e…c1e9",
    });
  });

  it("texto: primeira linha, linhas extras e espaços nas bordas", () => {
    expect(lerCelula("  oi \nmundo\n!", "text", "pt")).toEqual({
      tipo: "texto",
      texto: "  oi ",
      linhasExtras: 2,
      espacosInicio: 2,
      espacosFim: 0,
    });
    expect(lerCelula("fim  ", "text", "pt")).toMatchObject({ espacosFim: 2 });
    // só espaços: conta no início, não duplica no fim
    expect(lerCelula("   ", "text", "pt")).toMatchObject({ espacosInicio: 3, espacosFim: 0 });
  });

  it("numeric agrupa só para leitura; integer (ids) fica como veio", () => {
    expect(lerCelula("1234567.891", "numeric(12,3)", "pt")).toEqual({ tipo: "numero", texto: "1 234 567.891" });
    expect(lerCelula("1234567", "integer", "pt").tipo).toBe("texto");
  });
});

describe("auxiliares", () => {
  it("resumoJson conta o nível de cima e respeita o teto", () => {
    expect(resumoJson('{"a":1,"b":[1,2]}')).toBe("{2}");
    expect(resumoJson("[1,2,3]")).toBe("[3]");
    expect(resumoJson('"so string"')).toBeNull();
    expect(resumoJson("x".repeat(70_000))).toBeNull();
  });

  it("itensDeArray respeita aspas, escape e sub-array", () => {
    expect(itensDeArray('{a,"b,c",NULL,"d\\"e"}')).toBe(4);
    expect(itensDeArray("{{1,2},{3,4}}")).toBe(2);
    expect(itensDeArray("{}")).toBe(0);
    expect(itensDeArray("[0:1]={7,8}")).toBe(2);
    expect(itensDeArray("nao")).toBeNull();
  });

  it("tamanhoBytea", () => {
    expect(tamanhoBytea("\\xdeadbeef")).toEqual({ bytes: 4, rotulo: "4 B" });
    expect(tamanhoBytea(`\\x${"00".repeat(2048)}`)?.rotulo).toBe("2.0 KB");
    expect(tamanhoBytea("abc")).toBeNull();
  });

  it("agruparMilhares não mexe no que não é número simples", () => {
    expect(agruparMilhares("1e10")).toBe("1e10");
    expect(agruparMilhares("NaN")).toBe("NaN");
    expect(agruparMilhares("-12345")).toBe("-12 345");
    expect(agruparMilhares("1234")).toBe("1234");
  });
});
