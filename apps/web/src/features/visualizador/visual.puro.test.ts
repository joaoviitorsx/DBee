import { describe, expect, it } from "bun:test";

import { formatarXml, temVisualizador, tipoVisual } from "./visual.puro";

describe("tipoVisual", () => {
  it("por tipo da coluna", () => {
    expect(tipoVisual("jsonb", "{}")).toBe("json");
    expect(tipoVisual("text[]", "{a}")).toBe("array");
    expect(tipoVisual("bytea", "\\x00")).toBe("bytea");
    expect(tipoVisual("xml", "<a/>")).toBe("xml");
  });
  it("texto que parseia como JSON ganha a árvore; o que não parseia, não", () => {
    expect(tipoVisual("text", '{"a":1}')).toBe("json");
    expect(tipoVisual("text", "{oi")).toBe("texto");
  });
});

describe("temVisualizador", () => {
  it("estruturado sempre; texto só longo ou multilinha", () => {
    expect(temVisualizador("jsonb", "{}")).toBe(true);
    expect(temVisualizador("text", "curto")).toBe(false);
    expect(temVisualizador("text", "a\nb")).toBe(true);
    expect(temVisualizador("character varying(255)", "x".repeat(61))).toBe(true);
  });
});

describe("formatarXml", () => {
  it("indenta por nível sem tocar no conteúdo", () => {
    expect(formatarXml("<a><b>1</b><c/></a>")).toBe("<a>\n  <b>1</b>\n  <c/>\n</a>");
  });
});
