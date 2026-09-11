import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import mysql from "mysql2/promise";

import { citar, condicaoKeyset, ordenacao, type CursorKeyset, type Direcao } from "./keyset";

/**
 * Paginação por keyset contra MySQL e MariaDB reais.
 *
 * Duas coisas, e as duas só o servidor prova:
 *
 * - **Correção.** Percorrer a tabela inteira em páginas pequenas tem que ver
 *   cada linha **exatamente uma vez**, com valores repetidos na coluna de
 *   ordenação e com NULL no meio. É onde o keyset erra quando a chave primária
 *   não desempata, ou quando a região dos NULL é tratada como no Postgres — e
 *   aqui ela fica do outro lado (medido: `ASC` põe NULL primeiro).
 * - **Plano.** A forma canônica existe para o otimizador transformá-la em busca
 *   por faixa. Se um dia ela virar varredura, a paginação continua correta e
 *   fica vinte vezes mais lenta, em silêncio — então o plano é verificado.
 */

const SERVIDORES = [
  { nome: "MySQL 8.4", container: "dbee-ks-mysql", porta: 55514, imagem: "mysql:8.4", envSenha: "MYSQL_ROOT_PASSWORD", envDb: "MYSQL_DATABASE" },
  { nome: "MariaDB 11", container: "dbee-ks-mariadb", porta: 55515, imagem: "mariadb:11", envSenha: "MARIADB_ROOT_PASSWORD", envDb: "MARIADB_DATABASE" },
] as const;

const SENHA = "Ks7pQz2mVx4T";
const TOTAL = 600;
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;
const conexoes = new Map<string, mysql.Connection>();

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
          database: "loja", connectTimeout: 1000,
        });
        await t.query("SELECT 1");
        c = t;
        break;
      } catch { await Bun.sleep(500); }
    }
    if (c === undefined) throw new Error(`${s.nome} não ficou pronto`);

    await c.query("CREATE TABLE p (id INT PRIMARY KEY, nome VARCHAR(20), KEY k (nome, id))");
    /*
     * Só 30 nomes distintos para 600 linhas: cada valor da coluna de ordenação
     * se repete ~20 vezes, que é exatamente onde o keyset sem desempate pula
     * ou repete. E uma em cada sete é NULL, para a região de NULL ter tamanho.
     */
    const valores: string[] = [];
    for (let i = 1; i <= TOTAL; i += 1) {
      const nome = i % 7 === 0 ? "NULL" : `'n${String(i % 30).padStart(2, "0")}'`;
      valores.push(`(${String(i)}, ${nome})`);
    }
    await c.query(`INSERT INTO p (id, nome) VALUES ${valores.join(",")}`);
    conexoes.set(s.nome, c);
  }
}, 240_000);

afterAll(async () => {
  for (const c of conexoes.values()) { try { await c.end(); } catch { /* já foi */ } }
  for (const s of SERVIDORES) sh("docker", "rm", "-f", s.container);
});

/** Percorre a tabela inteira em páginas, devolvendo os ids na ordem vista. */
async function paginar(
  c: mysql.Connection,
  colunaOrdem: string | null,
  direcao: Direcao,
  anulavel: boolean,
  tamanho: number,
): Promise<number[]> {
  const vistos: number[] = [];
  let cursor: CursorKeyset | undefined;
  const ordem = ordenacao(colunaOrdem, ["id"], direcao);

  // Teto proporcional: com página de uma linha são 600 voltas, e um teto fixo
  // de 200 faria o teste "falhar" por conta do próprio laço.
  for (let pagina = 0; pagina < TOTAL + 10; pagina += 1) {
    let sql = `SELECT id, ${citar(colunaOrdem ?? "id")} AS ov FROM p`;
    let valores: unknown[] = [];
    if (cursor !== undefined) {
      const cond = condicaoKeyset(cursor, colunaOrdem, ["id"], direcao, anulavel);
      sql += ` WHERE ${cond.sql}`;
      valores = cond.valores;
    }
    sql += ` ORDER BY ${ordem} LIMIT ${String(tamanho)}`;

    const [linhas] = await c.query<mysql.RowDataPacket[]>(sql, valores);
    const lote = linhas as unknown as { id: number; ov: string | null }[];
    if (lote.length === 0) break;
    for (const l of lote) vistos.push(l.id);
    const ultima = lote[lote.length - 1];
    if (ultima === undefined) break;
    cursor = {
      orderValue: ultima.ov,
      orderValueIsNull: ultima.ov === null,
      primaryKey: [String(ultima.id)],
    };
    if (lote.length < tamanho) break;
  }
  return vistos;
}

/** A mesma ordem, pedida de uma vez só — a resposta do servidor, sem keyset. */
async function tudoDeUmaVez(
  c: mysql.Connection,
  colunaOrdem: string | null,
  direcao: Direcao,
): Promise<number[]> {
  const [linhas] = await c.query<mysql.RowDataPacket[]>(
    `SELECT id FROM p ORDER BY ${ordenacao(colunaOrdem, ["id"], direcao)}`,
  );
  return (linhas as unknown as { id: number }[]).map((l) => l.id);
}

for (const s of SERVIDORES) {
  describe(`keyset contra ${s.nome} real`, () => {
    const conn = (): mysql.Connection | undefined => conexoes.get(s.nome);

    for (const direcao of ["asc", "desc"] as Direcao[]) {
      it(`${direcao}: paginar dá exatamente a mesma ordem que pedir tudo`, async () => {
        if (!temDocker) return;
        const c = conn();
        expect(c).toBeDefined();
        if (c === undefined) return;

        const paginado = await paginar(c, "nome", direcao, true, 25);
        const inteiro = await tudoDeUmaVez(c, "nome", direcao);

        expect(paginado).toHaveLength(TOTAL);
        expect(new Set(paginado).size, "linha vista duas vezes").toBe(TOTAL);
        expect(paginado).toEqual(inteiro);
      }, 60_000);
    }

    it("página de uma linha só também não pula nem repete", async () => {
      if (!temDocker) return;
      const c = conn();
      if (c === undefined) return;
      // Tamanho 1 é o caso extremo: todo avanço depende do cursor.
      const paginado = await paginar(c, "nome", "asc", true, 1);
      expect(paginado).toEqual(await tudoDeUmaVez(c, "nome", "asc"));
    }, 60_000);

    it("sem coluna de ordenação, a chave primária basta", async () => {
      if (!temDocker) return;
      const c = conn();
      if (c === undefined) return;
      const paginado = await paginar(c, null, "asc", false, 25);
      expect(paginado).toEqual(await tudoDeUmaVez(c, null, "asc"));
    }, 60_000);

    /*
     * A ordem nativa: NULL primeiro em asc. Não é preferência — é o que a
     * engine faz, e forçar o contrário exigiria `ORDER BY (v IS NULL), v`, que
     * o índice não cobre.
     */
    it("asc começa pelos NULL, como a engine ordena", async () => {
      if (!temDocker) return;
      const c = conn();
      if (c === undefined) return;
      const [linhas] = await c.query<mysql.RowDataPacket[]>(
        `SELECT nome FROM p ORDER BY ${ordenacao("nome", ["id"], "asc")} LIMIT 3`,
      );
      for (const l of linhas as unknown as { nome: string | null }[]) {
        expect(l.nome).toBeNull();
      }
    }, 30_000);

    /*
     * O plano. A forma canônica existe para virar busca por faixa; se virar
     * varredura, a paginação segue correta e fica vinte vezes mais lenta em
     * silêncio.
     */
    it("a condição vira busca por faixa, não varredura", async () => {
      if (!temDocker) return;
      const c = conn();
      if (c === undefined) return;
      const cond = condicaoKeyset(
        { orderValue: "n15", orderValueIsNull: false, primaryKey: ["300"] },
        "nome", ["id"], "asc", false,
      );
      const [plano] = await c.query<mysql.RowDataPacket[]>(
        `EXPLAIN SELECT id FROM p WHERE ${cond.sql} ORDER BY ${ordenacao("nome", ["id"], "asc")} LIMIT 25`,
        cond.valores,
      );
      const l = (plano as Record<string, unknown>[])[0];
      expect(String(l?.["key"]), "não usou o índice").toBe("k");
      expect(String(l?.["type"]), `plano ${String(l?.["type"])} — a forma deixou de ser indexável`).toBe("range");
    }, 30_000);
  });
}
