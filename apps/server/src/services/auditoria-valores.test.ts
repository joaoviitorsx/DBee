import { describe, expect, it } from "bun:test";

import { comValores } from "./rows.service";

/**
 * O achado #6 da auditoria: o `query_log` da grade guardava só `$1`, então
 * "quem consultou o CPF de fulano" não era respondível. Estes testes travam o
 * formato — inclusive o que ele **não** faz, que é produzir SQL executável.
 */
describe("comValores", () => {
  it("devolve o SQL intacto quando não há parâmetro", () => {
    expect(comValores("SELECT 1", [])).toBe("SELECT 1");
  });

  it("anexa os valores como comentário, na ordem", () => {
    expect(comValores('SELECT * FROM t WHERE "cpf" = $1', ["12345678900"])).toBe(
      'SELECT * FROM t WHERE "cpf" = $1\n-- args: ["12345678900"]',
    );
  });

  /*
   * `null` é filtro `IS NULL`; a string "null" é o texto. O log não pode
   * confundir os dois, senão a auditoria responde a pergunta errada.
   */
  it("distingue null do texto \"null\"", () => {
    expect(comValores("q", [null, "null"])).toBe('q\n-- args: [null, "null"]');
  });

  /*
   * A linha do log vai para uma tela e pode ser copiada. Um valor com aspas,
   * ponto e vírgula ou quebra de linha não pode fechar o comentário e virar
   * comando.
   */
  it("um valor com aspas, ponto e vírgula e quebra de linha continua sendo um valor", () => {
    const veneno = "'; DROP TABLE users; --\nx";
    const linha = comValores("SELECT 1", [veneno]);
    const [primeira, ...resto] = linha.split("\n");
    expect(primeira).toBe("SELECT 1");
    // O veneno inteiro está numa linha só: a quebra dele foi escapada.
    expect(resto).toHaveLength(1);
    expect(resto[0]).toContain("\\n");
    expect(resto[0]).toStartWith("-- args: [");
  });

  it("trunca valor gigante e diz quanto sobrou", () => {
    const grande = "a".repeat(500);
    const linha = comValores("q", [grande]);
    expect(linha).toContain("…(+300)");
    expect(linha.length).toBeLessThan(300);
  });
});
