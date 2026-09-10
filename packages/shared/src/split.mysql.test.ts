import { describe, expect, it } from "bun:test";

import { splitStatements } from "./split";

/**
 * Achado #9 da auditoria: o separador era o do Postgres e rodava também sobre o
 * SQL do MySQL. Cada caso aqui é um `;` que caía do lado errado da fronteira.
 *
 * O que está em jogo não é estética: um `;` a menos manda **dois comandos como
 * um**, e o executor conta statements para decidir o que registrar em auditoria
 * e o que devolver como resultado.
 */
const textos = (sql: string, d: "postgres" | "mysql"): string[] =>
  splitStatements(sql, d).map((s) => s.sql);

describe("splitStatements — dialeto do MySQL", () => {
  /*
   * O caso que mais importa. No MySQL a barra invertida escapa dentro da string
   * (padrão do servidor, garantido pela sessão do DBee), então o `;` está
   * DENTRO do literal. Lido como Postgres, a string fecha no `'` do meio e o
   * `;` seguinte quebra o comando em dois.
   */
  it("a barra invertida escapa a aspa dentro da string", () => {
    const sql = "SELECT 'O\\'Brien; DROP TABLE t' AS nome";
    expect(textos(sql, "mysql")).toHaveLength(1);
    expect(textos(sql, "postgres")).toHaveLength(2);
  });

  it("a aspa dobrada continua valendo, como no Postgres", () => {
    expect(textos("SELECT 'a;''b;c'", "mysql")).toHaveLength(1);
  });

  it('a barra invertida também escapa dentro de "..."', () => {
    const sql = 'SELECT "a\\";b" AS x';
    expect(textos(sql, "mysql")).toHaveLength(1);
    expect(textos(sql, "postgres")).toHaveLength(2);
  });

  it("crase é identificador e engole o ponto e vírgula", () => {
    const sql = "SELECT * FROM `tab;ela`";
    expect(textos(sql, "mysql")).toHaveLength(1);
    // No Postgres a crase não é nada: o `;` corta.
    expect(textos(sql, "postgres")).toHaveLength(2);
  });

  it("crase dobrada é uma crase dentro do nome", () => {
    expect(textos("SELECT * FROM `a``b;c`", "mysql")).toHaveLength(1);
  });

  it("# abre comentário de linha no MySQL e não no Postgres", () => {
    const sql = "SELECT 1 # comentário; ainda comentário\n";
    expect(textos(sql, "mysql")).toEqual(["SELECT 1 # comentário; ainda comentário"]);
    expect(textos(sql, "postgres")).toHaveLength(2);
  });

  /*
   * `a--b` no MySQL é `a - (-b)`, não comentário: o `--` só comenta seguido de
   * branco. Com a leitura do Postgres, o resto da linha — inclusive o `;` que
   * fecha o statement — sumiria dentro de um comentário que não existe.
   */
  it("-- sem branco depois não é comentário no MySQL", () => {
    expect(textos("SELECT 1--2; SELECT 3", "mysql")).toEqual(["SELECT 1--2", "SELECT 3"]);
    expect(textos("SELECT 1--2; SELECT 3", "postgres")).toEqual(["SELECT 1--2; SELECT 3"]);
  });

  it("-- com branco depois comenta, como sempre", () => {
    expect(textos("SELECT 1 -- x; y\n", "mysql")).toEqual(["SELECT 1 -- x; y"]);
  });

  /*
   * Comentário de bloco aninha no Postgres e não no MySQL. O fechamento do meio
   * já encerra o comentário lá, então o que vem depois é comando — e o `;` que
   * o termina existe. Lido como Postgres, o comentário continua aberto e os
   * dois comandos viram um só.
   *
   * O separador não remove comentário do texto do statement (o servidor
   * aceita), então o primeiro trecho sai com o comentário na frente.
   */
  it("o comentário de bloco não aninha no MySQL", () => {
    const sql = "/* a /* b */ SELECT 1; SELECT 2";
    expect(textos(sql, "mysql")).toEqual(["/* a /* b */ SELECT 1", "SELECT 2"]);
    expect(textos(sql, "postgres")).toEqual(["/* a /* b */ SELECT 1; SELECT 2"]);
  });

  it("o comentário executável /*! ... */ fecha no primeiro fechamento", () => {
    expect(textos("/*!40101 SET NAMES utf8 */; SELECT 1", "mysql")).toEqual([
      "/*!40101 SET NAMES utf8 */",
      "SELECT 1",
    ]);
  });

  /*
   * Dollar quoting e `E'...'` não existem no MySQL: `$1$` ali é só texto, e um
   * `E` antes da aspa é um alias. Lidos como Postgres, os dois engoliriam
   * comandos inteiros.
   */
  it("dollar quoting não existe no MySQL", () => {
    expect(textos("SELECT $a$; SELECT 2", "mysql")).toHaveLength(2);
    expect(textos("SELECT $a$; SELECT 2", "postgres")).toHaveLength(1);
  });

  it("E'...' não é escape no MySQL", () => {
    // `E'x\\'` — no Postgres a barra escapa a aspa e a string continua até o
    // próximo `'`; no MySQL o `E` é alias e a string `'x\\'` já fechou... com a
    // barra escapando. Os dois leem uma string só, mas por caminhos diferentes.
    expect(textos("SELECT E'a;b'", "mysql")).toHaveLength(1);
    expect(textos("SELECT E'a;b'", "postgres")).toHaveLength(1);
  });

  it("o offset continua apontando o começo real de cada statement", () => {
    const sql = "SELECT `a;b`;  SELECT 2";
    const st = splitStatements(sql, "mysql");
    expect(st).toHaveLength(2);
    expect(sql.slice(st[1]?.offset ?? 0)).toBe("SELECT 2");
  });
});
