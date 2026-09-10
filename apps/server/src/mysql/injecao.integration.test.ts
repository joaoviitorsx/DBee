import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import mysql from "mysql2/promise";

import type { ResolvedConnection } from "../db/connections.repo";
import { introspectarCompleto } from "./introspect";
import { PoolMysql } from "./pool";
import { lerLinhas } from "./rows";

/**
 * A grade contra um MySQL com **`NO_BACKSLASH_ESCAPES`**.
 *
 * ## O buraco que este arquivo existe para não deixar voltar
 *
 * O `?` do `mysql2` em `.query()` não é placeholder de servidor: é interpolação
 * no cliente, que escapa aspa como `\\'`. Num servidor com
 * `NO_BACKSLASH_ESCAPES` a barra é literal, a aspa fecha a string, e o resto do
 * valor vira comando. Medido antes da correção, contra este mesmo servidor:
 *
 *     filtro `Ana`            -> 1 linha, correta
 *     filtro `x' OR 1=1 -- `  -> AS 3 LINHAS DA TABELA
 *     filtro `O'Brien`        -> erro de sintaxe
 *
 * Toda a suíte de MySQL passava, porque ela roda contra servidor com `sql_mode`
 * padrão, onde o escape do driver está certo. O modo é do servidor **do
 * cliente**: o DBee não escolhe, só herda.
 *
 * A correção é normalizar a sessão (`sessao.ts`), e é o pool que a aplica —
 * por isso este teste passa pelo pool, e não por uma conexão crua. Uma conexão
 * aberta à mão não tem a correção e continuaria vulnerável, o que é
 * exatamente o que o teste precisa distinguir.
 */

const CONTAINER = "dbee-inj-it";
const PORTA = 55530;
const SENHA = "Ij7pQz2mVx4T";
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

const conexao: ResolvedConnection = {
  id: "inj", name: "injecao", color: null, engine: "mysql",
  host: "127.0.0.1", port: PORTA, database: "loja",
  username: "root", password: SENHA,
  sslMode: "disable", timezone: "UTC", statementTimeoutMs: 30_000,
  writeEnabled: false, hasWriteCredential: false, createdAt: "", updatedAt: "",
};

let pool: PoolMysql;

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER,
    "-e", `MYSQL_ROOT_PASSWORD=${SENHA}`, "-e", "MYSQL_DATABASE=loja",
    "-p", `${String(PORTA)}:3306`, "mysql:8.4",
    // O modo que quebra o escape do driver. É legítimo e não é raro.
    "--sql-mode=NO_BACKSLASH_ESCAPES,STRICT_TRANS_TABLES");

  for (let i = 0; i < 120; i++) {
    try {
      const c = await mysql.createConnection({
        host: "127.0.0.1", port: PORTA, user: "root", password: SENHA,
        database: "loja", connectTimeout: 1000,
      });
      await c.query("CREATE TABLE clientes (id INT PRIMARY KEY, nome VARCHAR(60))");
      await c.query("INSERT INTO clientes VALUES (1,'Ana'),(2,'Bruno'),(3,'Carla')");
      await c.end();
      break;
    } catch { await Bun.sleep(500); }
  }
  pool = new PoolMysql(undefined);
}, 300_000);

afterAll(async () => {
  await pool.shutdown();
  sh("docker", "rm", "-f", CONTAINER);
});

describe("grade de linhas com NO_BACKSLASH_ESCAPES no servidor", () => {
  const comRelacao = async <T>(
    tarefa: (c: mysql.Connection, rel: Awaited<ReturnType<typeof introspectarCompleto>>["schemas"][number]["relations"][number]) => Promise<T>,
  ): Promise<T> =>
    pool.usar(conexao, async (c) => {
      const e = await introspectarCompleto(c, "loja");
      const rel = e.schemas[0]?.relations.find((r) => r.name === "clientes");
      if (rel === undefined) throw new Error("relação não encontrada");
      return { valor: await tarefa(c, rel), descartarConexao: false };
    });

  it("o servidor está mesmo em NO_BACKSLASH_ESCAPES — senão o teste não testa nada", async () => {
    if (!temDocker) return;
    const global = await pool.usar(conexao, async (c) => {
      const [r] = await c.query<mysql.RowDataPacket[]>("SELECT @@GLOBAL.sql_mode");
      return {
        valor: ((r as unknown as (Buffer | null)[][])[0]?.[0])?.toString("utf8") ?? "",
        descartarConexao: false,
      };
    });
    expect(global).toContain("NO_BACKSLASH_ESCAPES");
  }, 120_000);

  it("a sessão do pool sai sem o modo — é o que torna o escape do driver verdadeiro", async () => {
    if (!temDocker) return;
    const sessao = await pool.usar(conexao, async (c) => {
      const [r] = await c.query<mysql.RowDataPacket[]>("SELECT @@SESSION.sql_mode");
      return {
        valor: ((r as unknown as (Buffer | null)[][])[0]?.[0])?.toString("utf8") ?? "",
        descartarConexao: false,
      };
    });
    expect(sessao).not.toContain("NO_BACKSLASH_ESCAPES");
  }, 120_000);

  /*
   * O caso do achado. Antes da correção isto devolvia as três linhas.
   */
  it("filtro com aspa e OR 1=1 não escapa da string — devolve ZERO linhas", async () => {
    if (!temDocker) return;
    const linhas = await comRelacao(async (c, rel) => {
      const p = await lerLinhas(c, rel, "loja", {
        limit: 100,
        filters: [{ column: "nome", operator: "eq", value: "x' OR 1=1 -- " }],
      });
      return p.rows.length;
    });
    expect(linhas, "o filtro devolveu linhas que ele exclui — a string foi fechada").toBe(0);
  }, 120_000);

  it("apóstrofo em dado comum funciona, em vez de quebrar a tela", async () => {
    if (!temDocker) return;
    const rows = await comRelacao(async (c, rel) => {
      await c.query("INSERT INTO clientes VALUES (4, ?)", ["O'Brien"]);
      const p = await lerLinhas(c, rel, "loja", {
        limit: 100,
        filters: [{ column: "nome", operator: "eq", value: "O'Brien" }],
      });
      return p.rows.map((l) => l[1]);
    });
    expect(rows).toEqual(["O'Brien"]);
  }, 120_000);

  it("o filtro normal continua filtrando", async () => {
    if (!temDocker) return;
    const rows = await comRelacao(async (c, rel) => {
      const p = await lerLinhas(c, rel, "loja", {
        limit: 100, filters: [{ column: "nome", operator: "eq", value: "Ana" }],
      });
      return p.rows.map((l) => l[1]);
    });
    expect(rows).toEqual(["Ana"]);
  }, 120_000);

  /*
   * O cursor do keyset carrega valores do usuário pelos mesmos `?`. Se a
   * correção não cobrisse esse caminho, a injeção continuaria por ele.
   */
  it("o cursor do keyset também não é caminho de injeção", async () => {
    if (!temDocker) return;
    const total = await comRelacao(async (c, rel) => {
      const p = await lerLinhas(c, rel, "loja", {
        limit: 100,
        orderBy: "nome",
        after: {
          orderValue: "x' OR 1=1 -- ",
          orderValueIsNull: false,
          primaryKey: ["1' OR '1'='1"],
        },
      });
      return p.rows.length;
    });
    // Nenhum nome é maior que a injeção como texto; o que importa é não
    // estourar e não devolver a tabela por um `OR` colado no comando.
    expect(total).toBeLessThan(4);
  }, 120_000);
});
