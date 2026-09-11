import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import mysql from "mysql2/promise";

import type { ExportBundleRequest } from "@dbee/shared";

import type { ConnectionsRepository, ResolvedConnection } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import type { PoolManager } from "../pg/pool";
import { Drivers } from "../driver/registro";
import { SchemaService } from "./schema.service";
import { ExportService } from "./export.service";
import type { Ator } from "../lib/ator";

/**
 * Dump de várias tabelas em MySQL real, ponta a ponta pelo serviço.
 *
 * A asserção que vale mais que todas: **o `.sql` gerado recarrega num banco
 * MySQL vazio**, com os valores intactos — aspa simples, acento, NULL e
 * decimal. O reload usa `mysql2` cru contra um segundo database do mesmo
 * servidor, não o driver do DBee: se o dialeto sair errado, é aqui que aparece.
 */

const PORTA = 55531;
const CONTAINER = "dbee-bundle-mysql";
const SENHA = "Rw7pQz2mVx4T";
const TOTAL_CLIENTES = 1200;

const temDocker = ((): boolean => {
  try {
    return Bun.spawnSync(["docker", "version"]).exitCode === 0;
  } catch {
    return false;
  }
})();

const sh = (...args: string[]): boolean => Bun.spawnSync(args).exitCode === 0;

let drivers: Drivers;
let service: ExportService;
let semear: mysql.Connection | undefined;
let registros: { sql: string; status: string; rowCount: number | null }[] = [];

const ATOR: Ator = { id: "u1", role: "admin" };

const conexao: ResolvedConnection = {
  id: "my1", name: "mysql", color: null, engine: "mysql",
  host: "127.0.0.1", port: PORTA, database: "loja", username: "root", password: SENHA,
  sslMode: "disable", timezone: "UTC", statementTimeoutMs: 30_000,
  writeEnabled: false, hasWriteCredential: false, authSource: null,
  filePath: null, createdAt: "", updatedAt: "",
} as unknown as ResolvedConnection;

async function drenar(stream: ReadableStream<Uint8Array>): Promise<string> {
  const leitor = stream.getReader();
  const partes: Buffer[] = [];
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    partes.push(Buffer.from(value));
  }
  return Buffer.concat(partes).toString("utf8");
}

async function conectar(database: string): Promise<mysql.Connection> {
  return await mysql.createConnection({
    host: "127.0.0.1", port: PORTA, user: "root", password: SENHA,
    database, connectTimeout: 1000, charset: "utf8mb4", multipleStatements: true,
  });
}

beforeAll(async () => {
  if (!temDocker) return;

  sh("docker", "rm", "-f", CONTAINER);
  sh("docker", "run", "-d", "--name", CONTAINER,
    "-e", `MYSQL_ROOT_PASSWORD=${SENHA}`, "-e", "MYSQL_DATABASE=loja",
    "-p", `${String(PORTA)}:3306`, "mysql:8.4");

  let c: mysql.Connection | undefined;
  for (let i = 0; i < 120; i++) {
    try {
      const t = await conectar("loja");
      await t.query("SELECT 1");
      c = t;
      break;
    } catch {
      await Bun.sleep(500);
    }
  }
  if (c === undefined) throw new Error("MySQL de teste não subiu");
  semear = c;

  // Dados com o que costuma quebrar um dump: aspa simples, acento, NULL,
  // decimal com casas, e mais de um lote (1000) para cruzar página.
  await c.query(
    "CREATE TABLE cliente (id INT PRIMARY KEY, nome VARCHAR(60) NOT NULL, apelido VARCHAR(60), saldo DECIMAL(12,2) NOT NULL)",
  );
  await c.query(
    "INSERT INTO cliente (id, nome, apelido, saldo) VALUES (1, 'O''Brien & Cia', NULL, 1234.56), (2, 'Produção Ltda', 'produção', -0.10)",
  );
  const linhas: string[] = [];
  for (let i = 3; i <= TOTAL_CLIENTES; i++) linhas.push(`(${String(i)}, 'cliente ${String(i)}', NULL, ${String(i)}.00)`);
  await c.query(`INSERT INTO cliente (id, nome, apelido, saldo) VALUES ${linhas.join(",")}`);

  await c.query("CREATE TABLE nota (id INT PRIMARY KEY, cliente_id INT NOT NULL, valor DECIMAL(10,2))");
  await c.query("INSERT INTO nota (id, cliente_id, valor) VALUES (1, 1, 10.00), (2, 2, 20.50)");

  drivers = new Drivers(undefined as unknown as PoolManager, undefined);
  const repository = { resolve: (): ResolvedConnection => conexao } as unknown as ConnectionsRepository;
  registros = [];
  const log = {
    record: (e: { sql: string; status: string; rowCount: number | null }) => {
      registros.push({ sql: e.sql, status: e.status, rowCount: e.rowCount });
      return "log-id";
    },
  } as unknown as QueryLogRepository;
  const schema = new SchemaService({
    repository, pools: undefined as unknown as PoolManager, drivers,
  });
  service = new ExportService({
    repository, pools: undefined as unknown as PoolManager, schema, log, drivers,
  });
}, 300_000);

afterAll(async () => {
  if (!temDocker) return;
  try {
    await semear?.end();
  } catch {
    /* já foi */
  }
  // Fecha os pools do driver ANTES de derrubar o container, senão as conexões
  // ociosas recebem um erro sem dono e o `bun test` sai com código 1.
  await drivers.desligar();
  sh("docker", "rm", "-f", CONTAINER);
}, 60_000);

function pedido(over: Partial<ExportBundleRequest>): ExportBundleRequest {
  return {
    tables: [
      { schema: "loja", table: "cliente", structure: true, data: true },
      { schema: "loja", table: "nota", structure: true, data: true },
    ],
    ...over,
  };
}

describe.if(temDocker)("ExportService.exportBundle — MySQL real", () => {
  it("traz CREATE TABLE com crase e dados das duas tabelas num arquivo só", async () => {
    const r = await service.exportBundle("my1", pedido({ format: "sql" }), ATOR);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const t = await drenar(r.value.stream);

    // Identificador citado com crase (dialeto mysql), não aspas duplas.
    expect(t).toContain("CREATE TABLE `cliente`");
    expect(t).toContain("CREATE TABLE `nota`");
    expect(t).toContain("PRIMARY KEY (`id`)");
    // Aspa simples dobrada.
    expect(t).toContain("'O''Brien & Cia'");
    expect(t).toContain("NULL");
    expect(t).toContain("SEM snapshot único");
    expect(r.value.contentType).toContain("application/sql");
  }, 60_000);

  it("o .sql gerado recarrega num MySQL vazio, com os valores intactos", async () => {
    const r = await service.exportBundle("my1", pedido({ format: "sql" }), ATOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dump = await drenar(r.value.stream);

    const admin = semear;
    expect(admin).toBeDefined();
    if (admin === undefined) return;
    await admin.query("DROP DATABASE IF EXISTS restaurado");
    await admin.query("CREATE DATABASE restaurado");

    // Conexão nova apontada para o banco vazio, e o dump rodado cru por mysql2.
    const alvo = await conectar("restaurado");
    try {
      // Não lança = o arquivo é SQL válido para o MySQL (colunas, PK, INSERTs).
      await alvo.query(dump);

      const [cli] = await alvo.query<mysql.RowDataPacket[]>(
        "SELECT CONCAT(nome, '|', COALESCE(apelido, '<null>'), '|', saldo) AS v FROM cliente ORDER BY id LIMIT 2",
      );
      expect(cli[0]?.["v"]).toBe("O'Brien & Cia|<null>|1234.56");
      expect(cli[1]?.["v"]).toBe("Produção Ltda|produção|-0.10");

      const [total] = await alvo.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS c FROM cliente");
      expect(Number(total[0]?.["c"])).toBe(TOTAL_CLIENTES);

      const [nota] = await alvo.query<mysql.RowDataPacket[]>(
        "SELECT valor FROM nota ORDER BY id",
      );
      expect(String(nota[0]?.["valor"])).toBe("10.00");
      expect(String(nota[1]?.["valor"])).toBe("20.50");
    } finally {
      await alvo.end();
    }
  }, 60_000);

  it("csv de várias tabelas vira um zip com um arquivo por tabela", async () => {
    const r = await service.exportBundle("my1", pedido({ format: "csv" }), ATOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.contentType).toBe("application/zip");
    const bytes = new TextEncoder().encode(await drenar(r.value.stream));
    // Assinatura ZIP local ("PK\x03\x04"). O conteúdo detalhado já é coberto
    // pelo teste de Postgres; aqui basta provar que o container sai correto.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  }, 60_000);

  it("índices/triggers/rotinas são ignorados (são do Postgres), não recusados", async () => {
    const r = await service.exportBundle(
      "my1",
      {
        indexes: true, triggers: true, routines: true,
        tables: [{ schema: "loja", table: "cliente", structure: true, data: false }],
      },
      ATOR,
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const t = await drenar(r.value.stream);
    expect(t).toContain("CREATE TABLE `cliente`");
    expect(t).not.toContain("CREATE INDEX");
    expect(t).not.toContain("CREATE TRIGGER");
    expect(t).not.toContain("CREATE FUNCTION");
  }, 60_000);

  it("o dump cai no query_log com a lista de tabelas e a contagem", async () => {
    registros.length = 0;
    const r = await service.exportBundle(
      "my1",
      { tables: [{ schema: "loja", table: "nota", structure: true, data: true }], format: "sql" },
      ATOR,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await drenar(r.value.stream);
    const entrada = registros.at(-1);
    expect(entrada?.status).toBe("ok");
    expect(entrada?.sql).toContain("loja.nota");
    expect(entrada?.rowCount).toBe(2);
  }, 60_000);
});
