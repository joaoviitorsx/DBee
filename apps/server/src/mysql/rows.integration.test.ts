import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import mysql from "mysql2/promise";

import type { Relation, RowCursor } from "@dbee/shared";

import { RowsError } from "../driver/erros";
import { introspectarCompleto } from "./introspect";
import { lerLinhas, planejarLinhas } from "./rows";

/**
 * A grade de linhas contra MySQL e MariaDB reais.
 *
 * O que só o servidor prova: percorrer a tabela inteira em páginas vê cada
 * linha **exatamente uma vez**, com valores repetidos na coluna de ordenação e
 * com NULL no meio — e a relação usada é a que a introspecção devolve, não uma
 * inventada no teste. Se o catálogo e o planejador discordarem sobre o nome da
 * chave primária, é aqui que aparece.
 */

const SERVIDORES = [
  { nome: "MySQL 8.4", container: "dbee-rw-mysql", porta: 55522, imagem: "mysql:8.4", envSenha: "MYSQL_ROOT_PASSWORD", envDb: "MYSQL_DATABASE" },
  { nome: "MariaDB 11", container: "dbee-rw-mariadb", porta: 55523, imagem: "mariadb:11", envSenha: "MARIADB_ROOT_PASSWORD", envDb: "MARIADB_DATABASE" },
] as const;

const SENHA = "Rw7pQz2mVx4T";
const TOTAL = 300;
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;
const conexoes = new Map<string, mysql.Connection>();
const catalogos = new Map<string, Relation[]>();

beforeAll(async () => {
  if (!temDocker) return;
  for (const s of SERVIDORES) {
    sh("docker", "rm", "-f", s.container);
    sh("docker", "run", "-d", "--name", s.container,
      "-e", `${s.envSenha}=${SENHA}`, "-e", `${s.envDb}=loja`,
      "-p", `${String(s.porta)}:3306`, s.imagem);
  }
  for (const s of SERVIDORES) {
    let c: mysql.Connection | undefined;
    for (let i = 0; i < 120; i++) {
      try {
        const t = await mysql.createConnection({
          host: "127.0.0.1", port: s.porta, user: "root", password: SENHA,
          database: "loja", connectTimeout: 1000, charset: "utf8mb4",
          rowsAsArray: true, typeCast: (campo) => campo.buffer(),
        });
        await t.query("SELECT 1");
        c = t;
        break;
      } catch { await Bun.sleep(500); }
    }
    if (c === undefined) throw new Error(`${s.nome} não ficou pronto`);

    await c.query("CREATE TABLE peca (id INT PRIMARY KEY, grupo VARCHAR(20), nota INT, KEY k (grupo, id))");
    // 15 grupos para 300 linhas: cada valor se repete 20 vezes, e um sétimo é
    // NULL — é onde o keyset sem desempate pula ou repete.
    const linhas: string[] = [];
    for (let i = 1; i <= TOTAL; i += 1) {
      const grupo = i % 7 === 0 ? "NULL" : `'g${String(i % 15).padStart(2, "0")}'`;
      linhas.push(`(${String(i)}, ${grupo}, ${String(i * 3)})`);
    }
    await c.query(`INSERT INTO peca (id, grupo, nota) VALUES ${linhas.join(",")}`);
    // Sem chave primária: o keyset é impossível e a resposta tem que dizer.
    await c.query("CREATE TABLE sem_pk (a INT, b VARCHAR(10))");
    await c.query("INSERT INTO sem_pk VALUES (1,'x'),(2,'y'),(3,'z')");

    conexoes.set(s.nome, c);
    const esquema = await introspectarCompleto(c, "loja");
    catalogos.set(s.nome, esquema.schemas[0]?.relations ?? []);
  }
}, 300_000);

afterAll(async () => {
  for (const c of conexoes.values()) { try { await c.end(); } catch { /* já foi */ } }
  for (const s of SERVIDORES) sh("docker", "rm", "-f", s.container);
});

for (const s of SERVIDORES) {
  describe(`grade de linhas contra ${s.nome} real`, () => {
    const conn = (): mysql.Connection | undefined => conexoes.get(s.nome);
    const rel = (nome: string): Relation | undefined =>
      catalogos.get(s.nome)?.find((r) => r.name === nome);

    it("a primeira página traz colunas, linhas em texto e o cursor", async () => {
      if (!temDocker) return;
      const c = conn(); const r = rel("peca");
      expect(c).toBeDefined(); expect(r).toBeDefined();
      if (c === undefined || r === undefined) return;

      const p = await lerLinhas(c, r, "loja", { limit: 5, orderBy: "grupo", orderDirection: "asc" });
      expect(p.rows).toHaveLength(5);
      expect(p.keyset).toBe(true);
      expect(p.primaryKey).toEqual(["id"]);
      expect(p.hasMore).toBe(true);
      expect(p.nextCursor).not.toBeNull();
      for (const linha of p.rows) {
        for (const celula of linha) {
          if (celula !== null) expect(typeof celula).toBe("string");
        }
      }
    }, 90_000);

    /*
     * O caso que importa: paginar a tabela inteira tem que ver cada linha uma
     * vez só, com o valor de ordenação repetindo 20 vezes e NULL no meio.
     */
    it("paginar tudo vê cada linha exatamente uma vez", async () => {
      if (!temDocker) return;
      const c = conn(); const r = rel("peca");
      if (c === undefined || r === undefined) return;

      const vistos: string[] = [];
      let after: RowCursor | undefined;
      for (let pagina = 0; pagina < TOTAL + 10; pagina += 1) {
        const p = await lerLinhas(c, r, "loja", {
          limit: 25, orderBy: "grupo", orderDirection: "asc",
          ...(after === undefined ? {} : { after }),
        });
        const iCol = p.columns.findIndex((x) => x.name === "id");
        for (const linha of p.rows) vistos.push(linha[iCol] ?? "");
        if (!p.hasMore || p.nextCursor === null) break;
        after = p.nextCursor;
      }
      expect(vistos).toHaveLength(TOTAL);
      expect(new Set(vistos).size, "linha vista duas vezes").toBe(TOTAL);
    }, 120_000);

    it("desc percorre tudo também, sem pular nem repetir", async () => {
      if (!temDocker) return;
      const c = conn(); const r = rel("peca");
      if (c === undefined || r === undefined) return;
      const vistos: string[] = [];
      let after: RowCursor | undefined;
      for (let pagina = 0; pagina < TOTAL + 10; pagina += 1) {
        const p = await lerLinhas(c, r, "loja", {
          limit: 25, orderBy: "grupo", orderDirection: "desc",
          ...(after === undefined ? {} : { after }),
        });
        const iCol = p.columns.findIndex((x) => x.name === "id");
        for (const linha of p.rows) vistos.push(linha[iCol] ?? "");
        if (!p.hasMore || p.nextCursor === null) break;
        after = p.nextCursor;
      }
      expect(new Set(vistos).size).toBe(TOTAL);
    }, 120_000);

    it("filtros: igualdade, nulo e busca por trecho", async () => {
      if (!temDocker) return;
      const c = conn(); const r = rel("peca");
      if (c === undefined || r === undefined) return;

      const iguais = await lerLinhas(c, r, "loja", {
        limit: 100, filters: [{ column: "grupo", operator: "eq", value: "g03" }],
      });
      const iGrupo = iguais.columns.findIndex((x) => x.name === "grupo");
      for (const l of iguais.rows) expect(l[iGrupo]).toBe("g03");

      const nulos = await lerLinhas(c, r, "loja", {
        limit: 100, filters: [{ column: "grupo", operator: "isNull" }],
      });
      for (const l of nulos.rows) expect(l[iGrupo]).toBeNull();
      expect(nulos.rows.length).toBeGreaterThan(0);

      const trecho = await lerLinhas(c, r, "loja", {
        limit: 100, filters: [{ column: "grupo", operator: "startsWith", value: "g0" }],
      });
      for (const l of trecho.rows) expect(l[iGrupo]?.startsWith("g0")).toBe(true);
    }, 90_000);

    /*
     * Comparação numérica tem que ser numérica. Se o filtro casasse a coluna
     * como texto, `9 > 10` seria verdadeiro e o resultado viria errado sem
     * nenhum erro.
     */
    it("comparação de número é numérica, não alfabética", async () => {
      if (!temDocker) return;
      const c = conn(); const r = rel("peca");
      if (c === undefined || r === undefined) return;
      const p = await lerLinhas(c, r, "loja", {
        limit: 100, filters: [{ column: "nota", operator: "gt", value: "890" }],
      });
      const iNota = p.columns.findIndex((x) => x.name === "nota");
      for (const l of p.rows) expect(Number(l[iNota])).toBeGreaterThan(890);
      // `9` como texto seria maior que `890`; como número, não.
      expect(p.rows.every((l) => Number(l[iNota]) > 890)).toBe(true);
    }, 90_000);

    it("tabela sem chave primária diz que não há keyset", async () => {
      if (!temDocker) return;
      const c = conn(); const r = rel("sem_pk");
      expect(r, "a tabela sem PK tem que estar no catálogo").toBeDefined();
      if (c === undefined || r === undefined) return;
      const p = await lerLinhas(c, r, "loja", { limit: 2 });
      // A tela precisa avisar: sem PK a navegação cai para OFFSET.
      expect(p.keyset).toBe(false);
      expect(p.primaryKey).toEqual([]);
      expect(p.nextCursor).toBeNull();
    }, 90_000);

    it("coluna que não existe é erro do usuário, com o nome dela", () => {
      if (!temDocker) return;
      const r = rel("peca");
      if (r === undefined) return;
      let capturado: unknown;
      try {
        planejarLinhas(r, "loja", { orderBy: "nao_existe" });
      } catch (e) { capturado = e; }
      expect(capturado).toBeInstanceOf(RowsError);
      expect((capturado as RowsError).code).toBe("unknown_column");
      expect((capturado as Error).message).toContain("nao_existe");
    });

    it("filtro em coluna inexistente também é barrado antes de virar SQL", () => {
      if (!temDocker) return;
      const r = rel("peca");
      if (r === undefined) return;
      expect(() =>
        planejarLinhas(r, "loja", { filters: [{ column: "injeta", operator: "eq", value: "x" }] }),
      ).toThrow(RowsError);
    });

    /*
     * O SQL montado usa crase e placeholder posicional, e o valor NUNCA entra
     * nele. Este caso trava a forma, que é o que separa parâmetro de injeção.
     */
    it("o SQL cita com crase e manda todo valor por parâmetro", () => {
      if (!temDocker) return;
      const r = rel("peca");
      if (r === undefined) return;
      const plano = planejarLinhas(r, "loja", {
        limit: 10, orderBy: "grupo",
        filters: [{ column: "grupo", operator: "eq", value: "g'; DROP TABLE peca; --" }],
      });
      expect(plano.sql).toContain("`loja`.`peca`");
      expect(plano.sql).toContain("`grupo` = ?");
      // O valor hostil está nos parâmetros, não no comando.
      expect(plano.sql).not.toContain("DROP TABLE");
      expect(plano.valores).toContain("g'; DROP TABLE peca; --");
    });
  });
}
