import { describe, expect, it } from "bun:test";

import { hexDump, itensDoArray, paraCsv, paraJson, paraMarkdown } from "./formatos.puro";

const cols = ["id", "nome"];
const linhas = [["1", 'a,"b"'], ["2", null], ["3", ""]] as const;

describe("formatos de cópia", () => {
  it("CSV distingue NULL de vazio e escapa aspas", () => {
    expect(paraCsv(cols, linhas)).toBe('id,nome\r\n1,"a,""b"""\r\n2,\r\n3,""');
  });
  it("Markdown escapa pipe e marca NULL", () => {
    expect(paraMarkdown(["a|b"], [["x|y"], [null]])).toBe("| a\\|b |\n| --- |\n| x\\|y |\n| *NULL* |");
  });
  it("JSON mantém strings e null", () => {
    expect(JSON.parse(paraJson(cols, linhas))).toEqual([
      { id: "1", nome: 'a,"b"' },
      { id: "2", nome: null },
      { id: "3", nome: "" },
    ]);
  });
});

describe("itensDoArray", () => {
  it("separa respeitando aspas, NULL literal e sub-array", () => {
    expect(itensDoArray('{a,"b,c",NULL,"NULL","d\\"e",{1,2}}')).toEqual(["a", "b,c", null, "NULL", 'd"e', "{1,2}"]);
    expect(itensDoArray("{}")).toEqual([]);
    expect(itensDoArray("x")).toBeNull();
  });
});

describe("hexDump", () => {
  it("16 bytes por linha com ASCII", () => {
    const d = hexDump("\\x48656c6c6f00");
    expect(d).toHaveLength(1);
    expect(d[0]).toContain("48 65 6c 6c 6f 00");
    expect(d[0]?.endsWith("Hello.")).toBe(true);
  });
});
