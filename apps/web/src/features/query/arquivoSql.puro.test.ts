import { describe, expect, it } from "bun:test";

import { LIMITE_ARQUIVO_SQL, nomeArquivoSql } from "./arquivoSql.puro";

describe("arquivo .sql", () => {
  it("nome vem do título, sem caractere proibido", () => {
    expect(nomeArquivoSql("Consulta 3")).toBe("Consulta 3.sql");
    expect(nomeArquivoSql("public/clientes:x")).toBe("public_clientes_x.sql");
    expect(nomeArquivoSql("a.sql")).toBe("a.sql");
    expect(nomeArquivoSql("  ")).toBe("consulta.sql");
  });
  it("teto é 2 MB", () => {
    expect(LIMITE_ARQUIVO_SQL).toBe(2_097_152);
  });
});
