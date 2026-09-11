import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExportRequest } from "@dbee/shared";

import type { ResolvedConnection } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import type { ConnectionsRepository } from "../db/connections.repo";
import type { PoolManager } from "../pg/pool";
import { Drivers } from "../driver/registro";
import { SchemaService } from "./schema.service";
import { ExportService } from "./export.service";
import type { Ator } from "../lib/ator";

/**
 * A exportação das engines não-Postgres, ponta a ponta contra um SQLite real.
 *
 * Prova o caminho do driver (`#exportDriver`): a origem tabela paginando pela
 * grade de keyset até o fim, a origem consulta pelo `executar`, e os formatos
 * (CSV/JSON/SQL) com o identificador citado pelo dialeto `sqlite`. O Postgres
 * continua no seu caminho de cursor — aqui é o que esse caminho **não** cobre.
 */

let raiz: string;
let drivers: Drivers;
let service: ExportService;
/** O que o `query_log` recebeu — para provar que o SELECT real é auditado. */
let registros: { sql: string; status: string; rowCount: number | null }[] = [];

const ATOR: Ator = { id: "u1", role: "admin" };

const conexao: ResolvedConnection = {
  id: "sq1", name: "sqlite", color: null, engine: "sqlite",
  host: "", port: 0, database: "loja.db", username: "", password: "",
  sslMode: "disable", timezone: "UTC", statementTimeoutMs: 30_000,
  writeEnabled: false, hasWriteCredential: false, authSource: null,
  filePath: "loja.db", createdAt: "", updatedAt: "",
};

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

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), "dbee-export-sqlite-"));
  process.env["DBEE_SQLITE_ROOT"] = raiz;
  const db = new Database(join(raiz, "loja.db"), { create: true });
  db.run("CREATE TABLE produto (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, preco REAL)");
  // 2.500 linhas: força o laço de keyset a cruzar mais de uma página (lote 1000).
  const ins = db.prepare("INSERT INTO produto VALUES (?, ?, ?)");
  for (let i = 1; i <= 2500; i++) ins.run(i, i === 7 ? "com'aspa" : `item ${String(i)}`, i + 0.5);
  // Tabela SEM chave primária: exercita o caminho de OFFSET do produtor.
  db.run("CREATE TABLE evento (rotulo TEXT NOT NULL, valor INTEGER)");
  const insE = db.prepare("INSERT INTO evento VALUES (?, ?)");
  for (let i = 1; i <= 1200; i++) insE.run(`ev-${String(i).padStart(4, "0")}`, i);
  // Tabela vazia: a página de 0 linhas tem de encerrar o stream.
  db.run("CREATE TABLE vazia (id INTEGER PRIMARY KEY, x TEXT)");
  db.close();

  drivers = new Drivers(undefined as unknown as PoolManager, undefined);
  const repository = {
    resolve: (): ResolvedConnection => conexao,
  } as unknown as ConnectionsRepository;
  registros = [];
  const log = {
    record: (e: { sql: string; status: string; rowCount: number | null }) => {
      registros.push({ sql: e.sql, status: e.status, rowCount: e.rowCount });
      return "log-id";
    },
  } as unknown as QueryLogRepository;
  const schema = new SchemaService({
    repository,
    pools: undefined as unknown as PoolManager,
    drivers,
  });
  service = new ExportService({
    repository,
    pools: undefined as unknown as PoolManager,
    schema,
    log,
    drivers,
  });
});

afterAll(async () => {
  await drivers.desligar();
  rmSync(raiz, { recursive: true, force: true });
});

function pedido(over: Partial<ExportRequest>): ExportRequest {
  return {
    source: { kind: "table", schema: "loja.db", table: "produto" },
    format: "csv",
    ...over,
  };
}

describe("ExportService — SQLite (caminho do driver)", () => {
  it("CSV de tabela pagina por keyset até o fim (2.500 linhas)", async () => {
    const r = await service.export("sq1", pedido({ format: "csv" }), ATOR);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const texto = await drenar(r.value.stream);
    const linhas = texto.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    // 1 cabeçalho + 2.500 dados.
    expect(linhas).toHaveLength(2501);
    expect(linhas[0]).toBe("id;nome;preco");
    expect(linhas[2500]).toBe("2500;item 2500;2500.5");
    expect(r.value.filename).toContain(".csv");
  });

  it("maxRows corta a exportação", async () => {
    const r = await service.export("sq1", pedido({ format: "csv", maxRows: 10 }), ATOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const linhas = (await drenar(r.value.stream)).replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    expect(linhas).toHaveLength(11); // cabeçalho + 10
  });

  it("SQL de tabela: CREATE TABLE de referência + INSERT com aspas duplas e valor escapado", async () => {
    const r = await service.export("sq1", pedido({ format: "sql", maxRows: 10 }), ATOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const texto = await drenar(r.value.stream);
    expect(texto).toContain('CREATE TABLE "produto"');
    expect(texto).toContain('"id" INTEGER');
    expect(texto).toContain('PRIMARY KEY ("id")');
    expect(texto).toContain('INSERT INTO "produto" ("id", "nome", "preco") VALUES');
    // Aspa simples no dado sai dobrada (linha id=7).
    expect(texto).toContain("'com''aspa'");
  });

  it("SQL recusa a origem consulta (sem tabela de destino)", async () => {
    const r = await service.export(
      "sq1",
      { source: { kind: "query", sql: "SELECT 1" }, format: "sql" },
      ATOR,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toBe("bad_request");
  });

  it("JSON de consulta livre vira array de objetos", async () => {
    const r = await service.export(
      "sq1",
      {
        source: { kind: "query", sql: "SELECT id, nome FROM produto ORDER BY id LIMIT 3" },
        format: "json",
      },
      ATOR,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dados = JSON.parse(await drenar(r.value.stream)) as { id: string; nome: string }[];
    expect(dados).toHaveLength(3);
    expect(dados[0]).toEqual({ id: "1", nome: "item 1" });
  });

  it("a auditoria registra o SELECT real com o filtro, não um comentário", async () => {
    registros.length = 0;
    const r = await service.export(
      "sq1",
      pedido({ format: "csv", source: {
        kind: "table", schema: "loja.db", table: "produto",
        filters: [{ column: "id", operator: "eq", value: "7" }],
      } }),
      ATOR,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await drenar(r.value.stream);
    // O log tem de nomear a tabela E a coluna filtrada — senão "exportou tudo" e
    // "exportou só o id 7" ficam indistinguíveis.
    const entrada = registros.at(-1);
    expect(entrada?.status).toBe("ok");
    expect(entrada?.sql).toContain("produto");
    expect(entrada?.sql.toLowerCase()).toContain("where");
    expect(entrada?.sql).toContain("id");
    expect(entrada?.sql.startsWith("--")).toBe(false);
  });

  it("tabela sem PK exporta por OFFSET, todas as linhas e sem duplicar", async () => {
    const r = await service.export(
      "sq1",
      { source: { kind: "table", schema: "loja.db", table: "evento" }, format: "csv" },
      ATOR,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const linhas = (await drenar(r.value.stream)).replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    const dados = linhas.slice(1); // tira o cabeçalho
    expect(dados).toHaveLength(1200);
    // Sem duplicatas nem buracos: os 1200 rótulos distintos aparecem uma vez.
    expect(new Set(dados).size).toBe(1200);
  });

  it("tabela vazia: CSV só com cabeçalho, JSON com []", async () => {
    const csv = await service.export(
      "sq1",
      { source: { kind: "table", schema: "loja.db", table: "vazia" }, format: "csv" },
      ATOR,
    );
    expect(csv.ok).toBe(true);
    if (!csv.ok) return;
    const linhasCsv = (await drenar(csv.value.stream)).replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    expect(linhasCsv).toEqual(["id;x"]);

    const json = await service.export(
      "sq1",
      { source: { kind: "table", schema: "loja.db", table: "vazia" }, format: "json" },
      ATOR,
    );
    expect(json.ok).toBe(true);
    if (!json.ok) return;
    expect(JSON.parse(await drenar(json.value.stream))).toEqual([]);
  });

  it("maxRows no limite exato de um lote (1000) não sangra para a página seguinte", async () => {
    const r = await service.export("sq1", pedido({ format: "csv", maxRows: 1000 }), ATOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const linhas = (await drenar(r.value.stream)).replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    expect(linhas).toHaveLength(1001); // cabeçalho + 1000
    expect(registros.at(-1)?.rowCount).toBe(1000);
  });
});
