import { describe, expect, it } from "bun:test";

import {
  citarIdent,
  exportarEmStream,
  type PaginaExport,
  type PlanoExportDriver,
} from "./exportador";

/** Drena o stream para texto, ignorando o BOM do CSV para comparar conteúdo. */
async function drenar(stream: ReadableStream<Uint8Array>): Promise<string> {
  const leitor = stream.getReader();
  const partes: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    partes.push(value);
  }
  return Buffer.concat(partes.map((p) => Buffer.from(p))).toString("utf8");
}

/** Produtor de páginas a partir de uma lista fixa (uma página por elemento). */
function produtorDe(paginas: PaginaExport[]): () => Promise<PaginaExport | null> {
  let i = 0;
  return async () => {
    if (i >= paginas.length) return null;
    return paginas[i++] ?? null;
  };
}

function planoBase(over: Partial<PlanoExportDriver>): PlanoExportDriver {
  return {
    format: "csv",
    csv: undefined,
    dialeto: "postgres",
    proximaPagina: produtorDe([]),
    ...over,
  };
}

describe("citarIdent", () => {
  it("usa crase no MySQL e dobra a crase interna", () => {
    expect(citarIdent("es`quisito", "mysql")).toBe("`es``quisito`");
  });
  it("usa aspas duplas no SQLite/libSQL e dobra a aspa interna", () => {
    expect(citarIdent('a"b', "sqlite")).toBe('"a""b"');
    expect(citarIdent("tab", "postgres")).toBe('"tab"');
  });
});

describe("exportarEmStream — formatos", () => {
  const pagina: PaginaExport = {
    columns: ["id", "nome"],
    rows: [
      ["1", "ana"],
      ["2", null],
    ],
  };

  it("CSV com header e BOM, NULL vira campo vazio", async () => {
    let resumo: { rows: number } | null = null;
    const { stream } = exportarEmStream(
      planoBase({ format: "csv", proximaPagina: produtorDe([pagina]) }),
      (r) => { resumo = r; },
    );
    const texto = await drenar(stream);
    expect(texto.startsWith("﻿")).toBe(true);
    expect(texto).toContain("id;nome\r\n");
    expect(texto).toContain("1;ana\r\n");
    expect(texto).toContain("2;\r\n");
    expect(resumo).not.toBeNull();
    expect(resumo!.rows).toBe(2);
  });

  it("JSON vira um array de objetos", async () => {
    const { stream } = exportarEmStream(
      planoBase({ format: "json", proximaPagina: produtorDe([pagina]) }),
      () => {},
    );
    const texto = await drenar(stream);
    expect(JSON.parse(texto)).toEqual([
      { id: "1", nome: "ana" },
      { id: "2", nome: null },
    ]);
  });

  it("NDJSON: um objeto por linha", async () => {
    const { stream } = exportarEmStream(
      planoBase({ format: "ndjson", proximaPagina: produtorDe([pagina]) }),
      () => {},
    );
    const texto = await drenar(stream);
    const linhas = texto.trimEnd().split("\n");
    expect(linhas).toHaveLength(2);
    expect(JSON.parse(linhas[0]!)).toEqual({ id: "1", nome: "ana" });
  });

  it("JSON vazio fecha como []", async () => {
    const { stream } = exportarEmStream(
      planoBase({ format: "json", proximaPagina: produtorDe([]) }),
      () => {},
    );
    expect(await drenar(stream)).toBe("[]");
  });

  it("SQL: INSERT por linha, identificador pelo dialeto", async () => {
    const mysql = exportarEmStream(
      planoBase({
        format: "sql",
        dialeto: "mysql",
        sqlTabela: "`t`",
        sqlPrelude: "CREATE TABLE `t` (...);\n",
        proximaPagina: produtorDe([pagina]),
      }),
      () => {},
    );
    const texto = await drenar(mysql.stream);
    expect(texto).toContain("CREATE TABLE `t`");
    expect(texto).toContain("INSERT INTO `t` (`id`, `nome`) VALUES ('1', 'ana');");
    expect(texto).toContain("VALUES ('2', NULL);");
  });

  it("SQL no MySQL escapa a contrabarra (NO_BACKSLASH_ESCAPES desligado)", async () => {
    const { stream } = exportarEmStream(
      planoBase({
        format: "sql",
        dialeto: "mysql",
        sqlTabela: "`t`",
        proximaPagina: produtorDe([{ columns: ["c"], rows: [["a\\nb"]] }]),
      }),
      () => {},
    );
    const texto = await drenar(stream);
    // A contrabarra literal sai dobrada — senão o MySQL a leria como escape.
    expect(texto).toContain("VALUES ('a\\\\nb');");
  });

  it("propaga erro do produtor ao onDone e ao consumidor", async () => {
    let erroVisto: string | null = null;
    const { stream } = exportarEmStream(
      planoBase({
        format: "csv",
        proximaPagina: async () => { throw new Error("falha no driver"); },
      }),
      (_r, erro) => { erroVisto = erro; },
    );
    await expect(drenar(stream)).rejects.toThrow("falha no driver");
    expect(erroVisto).toBe("falha no driver");
  });
});
