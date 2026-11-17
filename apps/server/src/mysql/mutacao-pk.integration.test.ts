import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import mysql from "mysql2/promise";

import { createApp } from "../app";
import { openTestStore } from "../db/client";
import { autenticar } from "../test/sessao";

/**
 * Edição de linha com PK composta e sem PK, contra MySQL e MariaDB reais
 * (ideias-comunidade I7).
 *
 * Nestas engines a edição de linha pela grade **não existe** (a escrita é pelo
 * editor de SQL, com a credencial de escrita — ADR 011). O que se trava aqui é
 * o que a tela depende para não oferecer edição errada:
 * - a grade reporta a PK composta inteira, e `[]` na tabela sem PK;
 * - a rota de edição recusa com erro claro (`write_forbidden`) mesmo com
 *   credencial de escrita e concessão, e **nada** muda no banco.
 */

const SERVIDORES = [
  { nome: "MySQL 8.4", container: "dbee-mutpk-mysql", porta: 55605, imagem: "mysql:8.4", envSenha: "MYSQL_ROOT_PASSWORD", envDb: "MYSQL_DATABASE" },
  { nome: "MariaDB 11", container: "dbee-mutpk-mariadb", porta: 55606, imagem: "mariadb:11", envSenha: "MARIADB_ROOT_PASSWORD", envDb: "MARIADB_DATABASE" },
] as const;

const SENHA = "Mk3pQz8mVx1T";
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;
const diretas = new Map<string, mysql.Connection>();
const ids = new Map<string, string>();

const store = openTestStore();
const app = createApp({ store, caCert: undefined });
let cookie = "";

const call = (path: string, body: unknown): Promise<Response> =>
  app.handle(new Request(`http://localhost${path}`, {
    method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body),
  }));

async function foto(nome: string, tabela: string): Promise<string> {
  const c = diretas.get(nome);
  if (c === undefined) throw new Error("sem conexão direta");
  const [linhas] = await c.query(`SELECT * FROM ${tabela} ORDER BY 1, 2, 3`);
  return JSON.stringify(linhas);
}

beforeAll(async () => {
  if (!temDocker) return;
  ({ cookie } = await autenticar(store));
  for (const s of SERVIDORES) {
    sh("docker", "rm", "-f", s.container);
    sh("docker", "run", "-d", "--name", s.container,
      "-e", `${s.envSenha}=${SENHA}`, "-e", `${s.envDb}=loja`,
      "-p", `${String(s.porta)}:3306`, s.imagem);
  }
  for (const s of SERVIDORES) {
    let c: mysql.Connection | undefined;
    for (let i = 0; i < 160; i++) {
      try {
        const t = await mysql.createConnection({
          host: "127.0.0.1", port: s.porta, user: "root", password: SENHA,
          database: "loja", connectTimeout: 1000, dateStrings: true,
        });
        await t.query("SELECT 1");
        c = t;
        break;
      } catch { await Bun.sleep(500); }
    }
    if (c === undefined) throw new Error(`${s.nome} não ficou pronto`);
    // PK declarada (b, a, c) — ordem diferente da das colunas, de propósito.
    await c.query("CREATE TABLE c3 (a VARCHAR(10), b INT, c DATETIME(6), v VARCHAR(10), PRIMARY KEY (b, a, c))");
    await c.query(`INSERT INTO c3 VALUES
      ('k',1,'2026-01-01 10:00:00.123456','a'),
      ('k',1,'2026-01-01 10:00:00.123457','b'),
      ('k',2,'2026-01-01 10:00:00.123456','c ')`);
    await c.query("CREATE TABLE sem_pk (k VARCHAR(10), v VARCHAR(10), w VARCHAR(10))");
    await c.query("INSERT INTO sem_pk VALUES ('u','1','x'),('d','1','x'),('d','1','x')");
    // Credencial de escrita distinta da de leitura (o serviço recusa as duas iguais).
    await c.query(`CREATE USER 'gravador'@'%' IDENTIFIED BY '${SENHA}w'`);
    await c.query("GRANT ALL ON loja.* TO 'gravador'@'%'");
    diretas.set(s.nome, c);

    const res = await call("/api/connections", {
      name: s.nome, engine: s.nome.startsWith("MySQL") ? "mysql" : "mariadb",
      host: "127.0.0.1", port: s.porta, database: "loja", username: "root", password: SENHA,
      writeUsername: "gravador", writePassword: `${SENHA}w`,
    });
    const criada = (await res.json()) as { id?: string };
    if (criada.id === undefined) throw new Error(`criar conexão falhou: ${String(res.status)} ${JSON.stringify(criada)}`);
    ids.set(s.nome, criada.id);
  }
}, 300_000);

afterAll(async () => {
  for (const c of diretas.values()) { try { await c.end(); } catch { /* já foi */ } }
  for (const s of SERVIDORES) sh("docker", "rm", "-f", s.container);
});

for (const s of SERVIDORES) {
  describe.skipIf(!temDocker)(`edição de linha contra ${s.nome}`, () => {
    const id = (): string => ids.get(s.nome) ?? "";
    const alvo = (table: string) => ({ database: "loja", schema: "loja", table, readOnly: false as const });

    it("a grade reporta a PK composta inteira, e o µs da PK em texto", async () => {
      const res = await call(`/api/connections/${id()}/tables/loja/c3/rows`, { database: "loja" });
      expect(res.status).toBe(200);
      const l = (await res.json()) as { primaryKey: string[]; rows: (string | null)[][] };
      // A ordem sai a das colunas, não a da chave (b, a, c) — irrelevante para
      // identificar a linha (é um conjunto), registrado como observação.
      expect([...l.primaryKey].sort()).toEqual(["a", "b", "c"]);
      expect(l.rows.map((r) => r[2])).toContain("2026-01-01 10:00:00.123457");
      expect(l.rows.map((r) => r[3])).toContain("c ");
    }, 60_000);

    it("a grade reporta [] na tabela sem PK", async () => {
      const res = await call(`/api/connections/${id()}/tables/loja/sem_pk/rows`, { database: "loja" });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { primaryKey: string[] }).primaryKey).toEqual([]);
    }, 60_000);

    it("UPDATE pela PK composta completa é recusado com erro claro e nada muda", async () => {
      const antes = await foto(s.nome, "c3");
      const res = await call(`/api/connections/${id()}/rows/update`, {
        ...alvo("c3"),
        pk: [{ column: "b", value: "1" }, { column: "a", value: "k" }, { column: "c", value: "2026-01-01 10:00:00.123457" }],
        changes: [{ column: "v", from: "b", to: "B" }],
      });
      expect(res.status).toBe(403);
      const corpo = (await res.json()) as { code: string; message: string };
      expect(corpo.code).toBe("write_forbidden");
      expect(corpo.message).toContain("edição de linhas");
      expect(await foto(s.nome, "c3")).toBe(antes);
    }, 60_000);

    it("DELETE em tabela sem PK é recusado e nada é apagado", async () => {
      const antes = await foto(s.nome, "sem_pk");
      const res = await call(`/api/connections/${id()}/rows/delete`, {
        ...alvo("sem_pk"), pk: [{ column: "k", value: "d" }],
        guard: [{ column: "v", value: "1" }, { column: "w", value: "x" }],
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe("write_forbidden");
      expect(await foto(s.nome, "sem_pk")).toBe(antes);
      expect(JSON.parse(antes)).toHaveLength(3);
    }, 60_000);
  });
}
