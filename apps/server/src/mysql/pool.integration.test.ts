import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import mysql from "mysql2/promise";

import type { ResolvedConnection } from "../db/connections.repo";
import { executarUm } from "./executor";
import { PoolMysql } from "./pool";

/**
 * O pool contra MySQL e MariaDB reais.
 *
 * O que ele precisa provar:
 *
 * - A sessão está **pronta antes** da primeira consulta — foi por isso que o
 *   pool do `mysql2` foi recusado: ele emite `connection` e devolve a conexão
 *   na linha seguinte, sem esperar o ouvinte.
 * - Reusa a conexão quando a tarefa diz que ela serve.
 * - **Fecha** quando a tarefa diz que não serve, e quando a tarefa lança.
 * - Respeita o teto sem travar: quem espera vaga acorda, inclusive quando a
 *   vaga vem de um descarte e não de uma devolução.
 * - `evict` não deixa conexão velha voltar para o pool.
 */

const SERVIDORES = [
  { nome: "MySQL 8.4", container: "dbee-pool-mysql", porta: 55512, imagem: "mysql:8.4", envSenha: "MYSQL_ROOT_PASSWORD", envDb: "MYSQL_DATABASE", sabor: "mysql" as const },
  { nome: "MariaDB 11", container: "dbee-pool-mariadb", porta: 55513, imagem: "mariadb:11", envSenha: "MARIADB_ROOT_PASSWORD", envDb: "MARIADB_DATABASE", sabor: "mariadb" as const },
] as const;

const SENHA = "Po7pQz2mVx4T";
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

function conexao(porta: number, extra: Partial<ResolvedConnection> = {}): ResolvedConnection {
  return {
    id: `c-${String(porta)}`, name: "teste", color: null, engine: "mysql",
    host: "127.0.0.1", port: porta, database: "loja",
    username: "root", password: SENHA,
    sslMode: "disable", timezone: "America/Bahia", statementTimeoutMs: 30_000,
    writeEnabled: false, createdAt: "", updatedAt: "",
    ...extra,
  };
}

beforeAll(async () => {
  if (!temDocker) return;
  for (const s of SERVIDORES) {
    sh("docker", "rm", "-f", s.container);
    sh("docker", "run", "-d", "--name", s.container,
      "-e", `${s.envSenha}=${SENHA}`, "-e", `${s.envDb}=loja`,
      "-p", `${String(s.porta)}:3306`, s.imagem);
  }
  for (const s of SERVIDORES) {
    let pronto = false;
    for (let i = 0; i < 120; i++) {
      try {
        const c = await mysql.createConnection({
          host: "127.0.0.1", port: s.porta, user: "root", password: SENHA,
          database: "loja", connectTimeout: 1000,
        });
        await c.query("CREATE TABLE IF NOT EXISTS t (id INT PRIMARY KEY)");
        await c.query("INSERT IGNORE INTO t VALUES (1),(2),(3)");
        await c.end();
        pronto = true;
        break;
      } catch { await Bun.sleep(500); }
    }
    if (!pronto) throw new Error(`${s.nome} não ficou pronto`);
  }
}, 240_000);

afterAll(() => {
  for (const s of SERVIDORES) sh("docker", "rm", "-f", s.container);
});

for (const s of SERVIDORES) {
  describe(`pool contra ${s.nome} real`, () => {
    it("entrega a conexão com a sessão já configurada", async () => {
      if (!temDocker) return;
      const pool = new PoolMysql(undefined);
      const c = conexao(s.porta);

      // Fuso e limite de tempo, lidos na PRIMEIRA consulta da conexão: se a
      // configuração corresse com ela, isto pegaria o valor do servidor.
      const fuso = await pool.usar(c, async (conn) => {
        const [r] = await conn.query<mysql.RowDataPacket[]>("SELECT @@session.time_zone");
        const bruto = (r as unknown as (Buffer | null)[][])[0]?.[0];
        return { valor: bruto?.toString("utf8") ?? "", descartarConexao: false };
      });
      expect(fuso).toBe("America/Bahia");

      expect(await pool.sabor(c)).toBe(s.sabor);
      await pool.shutdown();
    }, 60_000);

    it("reusa a conexão quando a tarefa diz que ela serve", async () => {
      if (!temDocker) return;
      const pool = new PoolMysql(undefined);
      const c = conexao(s.porta);
      for (let i = 0; i < 5; i++) {
        await pool.usar(c, async (conn) => {
          const r = await executarUm(conn, "SELECT id FROM t ORDER BY id", 100);
          return { valor: r.rows.length, descartarConexao: r.descartarConexao };
        });
      }
      // Cinco usos, uma conexão só.
      expect(pool.vivas(c.id)).toBe(1);
      await pool.shutdown();
    }, 60_000);

    /*
     * O contrato que veio do executor: truncar deixa a conexão drenando, e
     * devolvê-la ao pool entrega uma conexão bloqueada ao próximo usuário.
     */
    it("fecha a conexão quando a tarefa manda descartar", async () => {
      if (!temDocker) return;
      const pool = new PoolMysql(undefined);
      const c = conexao(s.porta);
      await pool.usar(c, () => Promise.resolve({ valor: 1, descartarConexao: false }));
      expect(pool.vivas(c.id)).toBe(1);
      await pool.usar(c, () => Promise.resolve({ valor: 2, descartarConexao: true }));
      expect(pool.vivas(c.id), "descartada, não devolvida").toBe(0);
      await pool.shutdown();
    }, 60_000);

    it("fecha a conexão quando a tarefa lança", async () => {
      if (!temDocker) return;
      const pool = new PoolMysql(undefined);
      const c = conexao(s.porta);
      let capturado: unknown;
      try {
        await pool.usar(c, () => Promise.reject(new Error("estourou")));
      } catch (e) { capturado = e; }
      expect((capturado as Error | undefined)?.message).toBe("estourou");
      expect(pool.vivas(c.id)).toBe(0);
      await pool.shutdown();
    }, 60_000);

    /*
     * O teto, e o caso que a primeira versão do pool travava: as vagas todas
     * ocupadas por tarefas que DESCARTAM. Se o descarte não acordasse quem
     * espera, o sexto pedido nunca voltaria.
     */
    it("respeita o teto e não trava quando a vaga vem de um descarte", async () => {
      if (!temDocker) return;
      const pool = new PoolMysql(undefined);
      const c = conexao(s.porta);
      const feitas: number[] = [];
      const tarefas = Array.from({ length: 10 }, (_, i) =>
        pool.usar(c, async (conn) => {
          await conn.query("SELECT 1");
          feitas.push(i);
          // Todas descartam: a vaga só pode vir do fechamento.
          return { valor: i, descartarConexao: true };
        }),
      );
      const resultados = await Promise.all(tarefas);
      expect(resultados.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(feitas).toHaveLength(10);
      expect(pool.vivas(c.id)).toBe(0);
      await pool.shutdown();
    }, 90_000);

    it("nunca abre mais que o teto ao mesmo tempo", async () => {
      if (!temDocker) return;
      const pool = new PoolMysql(undefined);
      const c = conexao(s.porta);
      let simultaneas = 0;
      let pico = 0;
      await Promise.all(
        Array.from({ length: 12 }, () =>
          pool.usar(c, async (conn) => {
            simultaneas += 1;
            pico = Math.max(pico, simultaneas);
            await conn.query("SELECT SLEEP(0.05)");
            simultaneas -= 1;
            return { valor: 0, descartarConexao: false };
          }),
        ),
      );
      expect(pico, `pico de ${String(pico)} conexões simultâneas`).toBeLessThanOrEqual(4);
      await pool.shutdown();
    }, 90_000);

    /*
     * Uma conexão em uso durante o `evict` não pode voltar ao pool: ela fala
     * com o servidor antigo, com as regras antigas.
     *
     * A primeira versão deste caso olhava `pool.vivas(id)` e **não pegava o
     * defeito**: sem a verificação de grupo a conexão é empurrada para o grupo
     * já apagado, que ninguém mais lê, então `vivas` do grupo novo dá zero de
     * qualquer jeito. O que de fato acontece é uma conexão **aberta no
     * servidor** que nunca fecha. Então é isso que se mede — do lado do
     * servidor, não da contabilidade do pool.
     */
    it("evict fecha a conexão em uso; ela não vaza aberta no servidor", async () => {
      if (!temDocker) return;
      const espia = await mysql.createConnection({
        host: "127.0.0.1", port: s.porta, user: "root", password: SENHA, database: "loja",
      });
      const conectadas = async (): Promise<number> => {
        const [r] = await espia.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST",
        );
        return Number((r as unknown as { n: unknown }[])[0]?.n ?? 0);
      };

      const pool = new PoolMysql(undefined);
      const c = conexao(s.porta);
      const antes = await conectadas();

      await pool.usar(c, async (conn) => {
        // Descarta o grupo enquanto esta conexão está em uso.
        await pool.evict(c.id);
        await conn.query("SELECT 1");
        return { valor: 0, descartarConexao: false };
      });

      // O fechamento é assíncrono; dá um instante para o servidor notar.
      await Bun.sleep(1200);
      const depois = await conectadas();
      expect(
        depois,
        `${String(antes)} conexões antes, ${String(depois)} depois — sobrou uma aberta`,
      ).toBeLessThanOrEqual(antes);

      await pool.shutdown();
      await espia.end().catch(() => undefined);
    }, 60_000);

    it("shutdown fecha tudo", async () => {
      if (!temDocker) return;
      const pool = new PoolMysql(undefined);
      const c = conexao(s.porta);
      await pool.usar(c, () => Promise.resolve({ valor: 0, descartarConexao: false }));
      expect(pool.vivas(c.id)).toBe(1);
      await pool.shutdown();
      expect(pool.vivas(c.id)).toBe(0);
    }, 60_000);
  });
}
