import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CreateTableRequest } from "@dbee/shared";

import type { ConnectionsRepository, ResolvedConnection } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import type { PoolManager } from "../pg/pool";
import { Drivers } from "../driver/registro";
import { DdlService } from "./ddl.service";
import type { Ator } from "../lib/ator";

/**
 * DDL de tabela no SQLite, pelo `DdlService` real — e o que importa: o
 * `CREATE TABLE` gerado **cria a tabela de verdade** (o dialeto certo) e o
 * `serial` PK vira `INTEGER PRIMARY KEY AUTOINCREMENT` que de fato
 * auto-incrementa. Build verde não prova isso; recarregar o DDL prova.
 */

let raiz: string;
let drivers: Drivers;
let service: DdlService;

const ATOR: Ator = { id: "u1", role: "admin" };

const conexao: ResolvedConnection = {
  id: "sq1", name: "sqlite", color: null, engine: "sqlite",
  host: "", port: 0, database: "app.db", username: "", password: "",
  sslMode: "disable", timezone: "UTC", statementTimeoutMs: 30_000,
  // SQLite escreve pelo handle r/w: a base do portão é `writeEnabled`.
  writeEnabled: true, hasWriteCredential: false, authSource: null,
  filePath: "app.db", createdAt: "", updatedAt: "",
};

function pedido(over: Partial<CreateTableRequest>): CreateTableRequest {
  return {
    database: "app.db", schema: "app.db", name: "produto",
    columns: [
      { name: "id", type: "bigserial", primaryKey: true },
      { name: "nome", type: "text", notNull: true },
      { name: "preco", type: "numeric" },
    ],
    ...over,
  };
}

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), "dbee-ddl-sqlite-"));
  process.env["DBEE_SQLITE_ROOT"] = raiz;
  // O arquivo precisa existir (o handle r/w abre com `create: false`).
  new Database(join(raiz, "app.db"), { create: true }).close();

  drivers = new Drivers(undefined as unknown as PoolManager, undefined);
  const repository = {
    resolve: (): ResolvedConnection => conexao,
    podeEscrever: (): boolean => true,
  } as unknown as ConnectionsRepository;
  const log = { record: () => "log-id" } as unknown as QueryLogRepository;
  service = new DdlService({
    repository,
    pools: undefined as unknown as PoolManager,
    log,
    drivers,
  });
});

afterAll(async () => {
  await drivers.desligar();
  rmSync(raiz, { recursive: true, force: true });
});

describe("DdlService — CREATE TABLE no SQLite", () => {
  it("cria a tabela e o AUTOINCREMENT funciona", async () => {
    const r = await service.criarTabela("sq1", pedido({}), ATOR);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');

    // Confere no arquivo: a tabela existe, com as colunas e a PK certas, e o id
    // auto-incrementa (prova que o DDL não só é válido, mas faz o que promete).
    const db = new Database(join(raiz, "app.db"));
    const cols = db.query("PRAGMA table_info(produto)").all() as { name: string; pk: number }[];
    expect(cols.map((c) => c.name)).toEqual(["id", "nome", "preco"]);
    expect(cols.find((c) => c.name === "id")?.pk).toBe(1);

    db.run("INSERT INTO produto (nome, preco) VALUES ('A', '1.5')");
    db.run("INSERT INTO produto (nome, preco) VALUES ('B', '2.5')");
    const ids = (db.query("SELECT id FROM produto ORDER BY id").all() as { id: number }[]).map((x) => x.id);
    expect(ids).toEqual([1, 2]);
    db.close();
  });

  it("criar database é recusado no SQLite (é um arquivo)", async () => {
    const r = await service.criarDatabase("sq1", { name: "novo" }, ATOR);
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("invalid");
  });

  it("sem writeEnabled, recusa com write_forbidden", async () => {
    const semEscrita = {
      resolve: (): ResolvedConnection => ({ ...conexao, writeEnabled: false }),
      podeEscrever: (): boolean => true,
    } as unknown as ConnectionsRepository;
    const s = new DdlService({
      repository: semEscrita, pools: undefined as unknown as PoolManager,
      log: { record: () => "x" } as unknown as QueryLogRepository, drivers,
    });
    const r = await s.criarTabela("sq1", pedido({ name: "bloqueada" }), ATOR);
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("write_forbidden");
  });
});
