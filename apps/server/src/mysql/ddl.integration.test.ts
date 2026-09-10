import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import mysql from "mysql2/promise";

import { montarCreateDatabase, montarCreateTable, type CreateTableRequest } from "@dbee/shared";

/**
 * O `CREATE TABLE` gerado no dialeto MySQL **recarrega num MySQL de verdade**.
 *
 * É o risco do gerador cross-dialect: `serial` → `AUTO_INCREMENT`, `jsonb` →
 * `JSON`, `boolean` → `TINYINT(1)`, crase no identificador. Um build verde não
 * diz nada disso — rodar o comando num MySQL real diz. Executa direto por
 * `mysql2` (o caminho do driver tem seu próprio teste de escrita); aqui o que se
 * prova é a **sintaxe do DDL montado**.
 */

const CONTAINER = "dbee-ddl-mysql-it";
const PORTA = 55531;
const SENHA = "Dd7pQz2mVx4T";
const temDocker = Bun.spawnSync(["docker", "version"]).exitCode === 0;
const sh = (...a: string[]): void => { Bun.spawnSync(a); };

let conn: mysql.Connection;

beforeAll(async () => {
  if (!temDocker) return;
  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER,
    "-e", `MYSQL_ROOT_PASSWORD=${SENHA}`, "-e", "MYSQL_DATABASE=loja",
    "-p", `${String(PORTA)}:3306`, "mysql:8.4");
  for (let i = 0; i < 120; i++) {
    try {
      conn = await mysql.createConnection({
        host: "127.0.0.1", port: PORTA, user: "root", password: SENHA,
        database: "loja", connectTimeout: 1000, multipleStatements: false,
      });
      await conn.query("SELECT 1");
      break;
    } catch { await Bun.sleep(500); }
  }
}, 300_000);

afterAll(async () => {
  if (temDocker) {
    try { await conn.end(); } catch { /* já caiu */ }
    sh("docker", "rm", "-f", CONTAINER);
  }
});

function pedido(over: Partial<CreateTableRequest>): CreateTableRequest {
  return {
    database: "loja", schema: "loja", name: "clientes",
    columns: [
      { name: "id", type: "bigserial", primaryKey: true },
      { name: "nome", type: "varchar", length: 120, notNull: true },
      { name: "dados", type: "jsonb" },
      { name: "ativo", type: "boolean", defaultValue: "1" },
      { name: "criado", type: "timestamp", defaultExpression: "now()" },
    ],
    ...over,
  };
}

describe.if(temDocker)("CREATE TABLE gerado recarrega no MySQL", () => {
  it("cria a tabela, AUTO_INCREMENT funciona, tipos batem", async () => {
    const sql = montarCreateTable(pedido({}), "mysql");
    await conn.query(sql);

    // A tabela existe com as colunas certas.
    const [cols] = await conn.query(
      "SELECT column_name AS nome, data_type AS dt, extra AS ex FROM information_schema.columns WHERE table_schema='loja' AND table_name='clientes' ORDER BY ordinal_position",
    );
    const linhas = cols as { nome: string; dt: string; ex: string }[];
    expect(linhas.map((c) => c.nome.toLowerCase())).toEqual(["id", "nome", "dados", "ativo", "criado"]);
    const id = linhas.find((c) => c.nome.toLowerCase() === "id");
    expect(id?.dt.toLowerCase()).toBe("bigint");
    expect(id?.ex.toLowerCase()).toContain("auto_increment");
    expect(linhas.find((c) => c.nome.toLowerCase() === "dados")?.dt.toLowerCase()).toBe("json");

    // AUTO_INCREMENT de verdade: dois inserts sem id → 1 e 2.
    await conn.query("INSERT INTO `clientes` (`nome`) VALUES ('A'), ('B')");
    const [rows] = await conn.query("SELECT id FROM clientes ORDER BY id");
    expect((rows as { id: number }[]).map((r) => r.id)).toEqual([1, 2]);
  });

  it("CREATE DATABASE no dialeto MySQL cria o schema", async () => {
    await conn.query(montarCreateDatabase({ name: "criada_pelo_dbee" }, "mysql"));
    const [rows] = await conn.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name='criada_pelo_dbee'",
    );
    expect((rows as unknown[]).length).toBe(1);
  });
});
