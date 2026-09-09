import { describe, expect, it } from "bun:test";

import { citar, condicaoKeyset, ordenacao } from "./keyset";

const cursor = (v: string | null, ehNulo: boolean, pk: string[]) => ({
  orderValue: v,
  orderValueIsNull: ehNulo,
  primaryKey: pk,
});

describe("citação de identificador", () => {
  it("usa crase, e duplica a crase interna", () => {
    expect(citar("nome")).toBe("`nome`");
    // Nome vindo do catálogo pode conter crase; fechar aqui é barato.
    expect(citar("es`quisito")).toBe("`es``quisito`");
  });
});

describe("condição de keyset", () => {
  /*
   * A forma canônica, e não `(c, pk) > (?, ?)`. Medido: a comparação de linha é
   * correta e vinte vezes mais lenta no MySQL, porque vira varredura de índice.
   * Este caso trava a FORMA, que é o que decide o plano.
   */
  it("expande em disjunção, e não em comparação de linha", () => {
    const { sql, valores } = condicaoKeyset(cursor("b", false, ["2"]), "nome", ["id"], "asc", false);
    expect(sql).toBe("(`nome` > ? OR (`nome` = ? AND `id` > ?))");
    expect(valores).toEqual(["b", "b", "2"]);
    // A forma compacta é justamente a que não pode aparecer.
    expect(sql).not.toContain("(`nome`, `id`)");
  });

  it("chave primária composta vira uma cadeia de igualdades", () => {
    const { sql, valores } = condicaoKeyset(cursor(null, false, ["1", "10"]), null, ["a", "b"], "asc", false);
    expect(sql).toBe("(`a` > ? OR (`a` = ? AND `b` > ?))");
    expect(valores).toEqual(["1", "1", "10"]);
  });

  it("chave primária de uma coluna não ganha parênteses à toa", () => {
    const { sql } = condicaoKeyset(cursor(null, false, ["7"]), null, ["id"], "asc", false);
    expect(sql).toBe("`id` > ?");
  });

  it("desc inverte o comparador", () => {
    const { sql } = condicaoKeyset(cursor("b", false, ["2"]), "nome", ["id"], "desc", false);
    expect(sql).toBe("(`nome` < ? OR (`nome` = ? AND `id` < ?))");
  });

  /*
   * A região dos NULL fica no COMEÇO em asc — o contrário do Postgres, medido.
   * Então um cursor dentro dela ainda tem todo o resto pela frente.
   */
  it("asc: cursor entre os NULL ainda tem os não-NULL pela frente", () => {
    const { sql, valores } = condicaoKeyset(cursor(null, true, ["4"]), "v", ["id"], "asc", true);
    expect(sql).toBe("(`v` IS NULL AND `id` > ?) OR `v` IS NOT NULL");
    expect(valores).toEqual(["4"]);
  });

  it("desc: cursor entre os NULL não tem mais nada depois", () => {
    const { sql } = condicaoKeyset(cursor(null, true, ["4"]), "v", ["id"], "desc", true);
    expect(sql).toBe("`v` IS NULL AND `id` < ?");
  });

  /*
   * Em desc os NULL vêm por último, então um cursor fora deles ainda vai
   * alcançá-los. Em asc já passaram, e `v > ?` os exclui sozinho — comparação
   * com NULL nunca é verdadeira.
   */
  it("desc em coluna anulável precisa alcançar os NULL; asc não", () => {
    const comNull = condicaoKeyset(cursor("b", false, ["2"]), "v", ["id"], "desc", true);
    expect(comNull.sql).toContain("OR `v` IS NULL");

    const semNull = condicaoKeyset(cursor("b", false, ["2"]), "v", ["id"], "asc", true);
    expect(semNull.sql).not.toContain("IS NULL");
  });

  it("coluna NOT NULL não paga pelo ramo de NULL em direção nenhuma", () => {
    for (const dir of ["asc", "desc"] as const) {
      const { sql } = condicaoKeyset(cursor("b", false, ["2"]), "v", ["id"], dir, false);
      expect(sql, dir).not.toContain("IS NULL");
    }
  });
});

describe("ordenação", () => {
  /*
   * A PK entra junto e na mesma direção. Sem isso, coluna de ordenação com
   * valores repetidos deixa a ordem indefinida entre páginas, e o keyset pula
   * ou repete linhas.
   */
  it("a chave primária desempata, na mesma direção", () => {
    expect(ordenacao("nome", ["id"], "asc")).toBe("`nome` ASC, `id` ASC");
    expect(ordenacao("nome", ["a", "b"], "desc")).toBe("`nome` DESC, `a` DESC, `b` DESC");
  });

  it("sem coluna de ordenação, ordena só pela chave primária", () => {
    expect(ordenacao(null, ["id"], "asc")).toBe("`id` ASC");
  });

  /* `NULLS LAST` não existe no MySQL — é erro de sintaxe. Medido. */
  it("nunca escreve NULLS LAST, que o MySQL não tem", () => {
    for (const dir of ["asc", "desc"] as const) {
      expect(ordenacao("v", ["id"], dir).toUpperCase()).not.toContain("NULLS");
    }
  });
});
