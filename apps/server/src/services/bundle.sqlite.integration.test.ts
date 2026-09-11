import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExportBundleRequest } from "@dbee/shared";

import type { ResolvedConnection } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import type { ConnectionsRepository } from "../db/connections.repo";
import type { PoolManager } from "../pg/pool";
import { Drivers } from "../driver/registro";
import { SchemaService } from "./schema.service";
import { ExportService } from "./export.service";
import type { Ator } from "../lib/ator";

/**
 * Dump de várias tabelas nas engines não-Postgres, ponta a ponta contra um
 * SQLite real e **autocontido** (sem Docker).
 *
 * A asserção que vale mais que todas: **o `.sql` gerado recarrega num segundo
 * banco vazio**, com os valores intactos — aspa simples, NULL e DEFAULT. Um
 * dump que "parece certo" e não recarrega é pior que dump nenhum. O reload usa
 * um `bun:sqlite` limpo (`:memory:`), o mesmo motor que ninguém pode acusar de
 * ser condescendente com o dialeto.
 */

let raiz: string;
let drivers: Drivers;
let service: ExportService;
let registros: { sql: string; status: string; rowCount: number | null }[] = [];

const ATOR: Ator = { id: "u1", role: "admin" };

const conexao: ResolvedConnection = {
  id: "sq1", name: "sqlite", color: null, engine: "sqlite",
  host: "", port: 0, database: "loja.db", username: "", password: "",
  sslMode: "disable", timezone: "UTC", statementTimeoutMs: 30_000,
  writeEnabled: false, hasWriteCredential: false, authSource: null,
  filePath: "loja.db", createdAt: "", updatedAt: "",
};

async function drenar(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const leitor = stream.getReader();
  const partes: Buffer[] = [];
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    partes.push(Buffer.from(value));
  }
  return Buffer.concat(partes);
}

const texto = async (stream: ReadableStream<Uint8Array>): Promise<string> =>
  (await drenar(stream)).toString("utf8");

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), "dbee-bundle-sqlite-"));
  process.env["DBEE_SQLITE_ROOT"] = raiz;
  const db = new Database(join(raiz, "loja.db"), { create: true });
  // Duas tabelas, com o que costuma quebrar um dump: aspa simples, NULL, um
  // DEFAULT literal (o SQLite devolve `'BR'` já citado), e mais de um lote.
  db.run(
    "CREATE TABLE cliente (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, apelido TEXT, origem TEXT DEFAULT 'BR')",
  );
  const insC = db.prepare("INSERT INTO cliente VALUES (?, ?, ?, ?)");
  insC.run(1, "O'Brien & Cia", null, "BR");
  insC.run(2, "Produção Ltda", "produção", "PT");
  // 1.500 linhas no total força o produtor a cruzar mais de um lote (1000).
  for (let i = 3; i <= 1500; i++) insC.run(i, `cliente ${String(i)}`, null, "BR");

  db.run("CREATE TABLE nota (id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL, valor REAL)");
  const insN = db.prepare("INSERT INTO nota VALUES (?, ?, ?)");
  insN.run(1, 1, 10.5);
  insN.run(2, 2, null);
  db.close();

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
});

afterAll(async () => {
  await drivers.desligar();
  rmSync(raiz, { recursive: true, force: true });
});

function pedido(over: Partial<ExportBundleRequest>): ExportBundleRequest {
  return {
    tables: [
      { schema: "loja.db", table: "cliente", structure: true, data: true },
      { schema: "loja.db", table: "nota", structure: true, data: true },
    ],
    ...over,
  };
}

describe("ExportService.exportBundle — SQLite (caminho do driver)", () => {
  it("traz CREATE TABLE no dialeto e dados das duas tabelas num arquivo só", async () => {
    const r = await service.exportBundle("sq1", pedido({ format: "sql" }), ATOR);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const t = await texto(r.value.stream);

    // Identificador citado com aspas duplas (dialeto sqlite), não crase.
    expect(t).toContain('CREATE TABLE "cliente"');
    expect(t).toContain('CREATE TABLE "nota"');
    expect(t).toContain('PRIMARY KEY ("id")');
    // O DEFAULT literal do SQLite entra cru e recarrega.
    expect(t).toContain("DEFAULT 'BR'");
    // Aspa simples dobrada, não escapada com barra (dialeto sqlite).
    expect(t).toContain("'O''Brien & Cia'");
    expect(t).toContain("NULL");
    // O cabeçalho é honesto sobre o que este caminho NÃO garante.
    expect(t).toContain("SEM snapshot único");
    expect(t).toContain("NÃO é um mysqldump");
    expect(r.value.contentType).toContain("application/sql");
    expect(r.value.filename).toContain(".sql");
  });

  /** A prova de que serve para algo: recriar num banco vazio e conferir. */
  it("o .sql gerado recarrega num segundo bun:sqlite, com os valores intactos", async () => {
    const r = await service.exportBundle("sq1", pedido({ format: "sql" }), ATOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dump = await texto(r.value.stream);

    // Um bun:sqlite limpo e independente do arquivo de origem.
    const alvo = new Database(":memory:");
    // Não lança = o arquivo é SQL válido para o SQLite (colunas, PK, INSERTs).
    alvo.run(dump);

    const cliente = alvo
      .query<{ v: string }, []>(
        "SELECT nome || '|' || coalesce(apelido,'<null>') || '|' || origem AS v FROM cliente ORDER BY id LIMIT 2",
      )
      .all();
    expect(cliente[0]?.v).toBe("O'Brien & Cia|<null>|BR");
    expect(cliente[1]?.v).toBe("Produção Ltda|produção|PT");

    const total = alvo.query<{ c: number }, []>("SELECT count(*) AS c FROM cliente").get();
    expect(total?.c).toBe(1500);

    // A segunda tabela também recarregou, com o NULL do valor preservado.
    const nota = alvo
      .query<{ id: number; valor: number | null }, []>("SELECT id, valor FROM nota ORDER BY id")
      .all();
    expect(nota).toHaveLength(2);
    expect(nota[0]?.valor).toBe(10.5);
    expect(nota[1]?.valor).toBeNull();
    alvo.close();
  });

  it("só estrutura não emite INSERT; só dados não emite CREATE", async () => {
    const rEstrutura = await service.exportBundle(
      "sq1",
      { tables: [{ schema: "loja.db", table: "cliente", structure: true, data: false }] },
      ATOR,
    );
    expect(rEstrutura.ok).toBe(true);
    if (!rEstrutura.ok) return;
    const soEstrutura = await texto(rEstrutura.value.stream);
    expect(soEstrutura).toContain("CREATE TABLE");
    expect(soEstrutura).not.toContain("INSERT INTO");

    const rDados = await service.exportBundle(
      "sq1",
      { tables: [{ schema: "loja.db", table: "cliente", structure: false, data: true }] },
      ATOR,
    );
    expect(rDados.ok).toBe(true);
    if (!rDados.ok) return;
    const soDados = await texto(rDados.value.stream);
    expect(soDados).not.toContain("CREATE TABLE");
    expect(soDados).toContain("INSERT INTO");
  });

  it("structure drop-create emite DROP TABLE IF EXISTS antes do CREATE, sem CASCADE", async () => {
    const r = await service.exportBundle(
      "sq1",
      {
        structure: "drop-create",
        tables: [{ schema: "loja.db", table: "cliente", structure: true, data: false }],
      },
      ATOR,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = await texto(r.value.stream);
    expect(t).toContain('DROP TABLE IF EXISTS "cliente";');
    // CASCADE não existe em DROP TABLE no SQLite: sairia inválido.
    expect(t).not.toContain("CASCADE");
    expect(t.indexOf("DROP TABLE")).toBeLessThan(t.indexOf("CREATE TABLE"));
  });

  it("índices/triggers/rotinas são ignorados (são do Postgres), não recusados", async () => {
    const r = await service.exportBundle(
      "sq1",
      {
        indexes: true, triggers: true, routines: true,
        tables: [{ schema: "loja.db", table: "cliente", structure: true, data: true }],
      },
      ATOR,
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const t = await texto(r.value.stream);
    // O pedido não é recusado, e nenhum CREATE INDEX/TRIGGER/FUNCTION aparece.
    expect(t).toContain('CREATE TABLE "cliente"');
    expect(t).not.toContain("CREATE INDEX");
    expect(t).not.toContain("CREATE TRIGGER");
    expect(t).not.toContain("CREATE FUNCTION");
  });

  it("csv de várias tabelas vira um zip com um arquivo por tabela", async () => {
    const r = await service.exportBundle("sq1", pedido({ format: "csv" }), ATOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.contentType).toBe("application/zip");
    expect(r.value.filename).toContain(".zip");

    const dir = mkdtempSync(join(tmpdir(), "dbee-bundle-sqlite-zip-"));
    const caminho = join(dir, "d.zip");
    await Bun.write(caminho, await drenar(r.value.stream));

    expect(Bun.spawnSync(["unzip", "-t", caminho]).stdout.toString()).toContain(
      "No errors detected",
    );
    Bun.spawnSync(["unzip", "-o", "-q", caminho, "-d", dir]);
    const cli = await Bun.file(join(dir, "loja.db.cliente.csv")).text();
    // Cabeçalho de coluna e separador `;` (padrão Excel pt-BR).
    expect(cli.split("\r\n")[0]).toBe("id;nome;apelido;origem");
    expect(cli).toContain("O'Brien & Cia");
    expect(await Bun.file(join(dir, "loja.db.nota.csv")).text()).toContain("id;cliente_id;valor");
    rmSync(dir, { recursive: true, force: true });
  });

  it("json vira um array válido por tabela dentro do zip", async () => {
    const r = await service.exportBundle(
      "sq1",
      { format: "json", tables: [{ schema: "loja.db", table: "nota", structure: false, data: true }] },
      ATOR,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dir = mkdtempSync(join(tmpdir(), "dbee-bundle-sqlite-json-"));
    await Bun.write(join(dir, "j.zip"), await drenar(r.value.stream));
    Bun.spawnSync(["unzip", "-o", "-q", join(dir, "j.zip"), "-d", dir]);
    const linhas = JSON.parse(await Bun.file(join(dir, "loja.db.nota.json")).text()) as {
      id: string;
      cliente_id: string;
      valor: string | null;
    }[];
    expect(linhas).toHaveLength(2);
    // Regra 10: toda célula é texto, inclusive número. E o NULL vira `null`.
    expect(linhas[0]).toEqual({ id: "1", cliente_id: "1", valor: "10.5" });
    expect(linhas[1]?.valor).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("tabela inexistente volta 404; tudo desmarcado volta 400", async () => {
    const naoExiste = await service.exportBundle(
      "sq1",
      { tables: [{ schema: "loja.db", table: "nao_existe", structure: true, data: true }] },
      ATOR,
    );
    expect(naoExiste.ok).toBe(false);
    if (!naoExiste.ok) expect(naoExiste.failure).toBe("not_found");

    const desmarcado = await service.exportBundle(
      "sq1",
      { tables: [{ schema: "loja.db", table: "cliente", structure: false, data: false }] },
      ATOR,
    );
    expect(desmarcado.ok).toBe(false);
    if (!desmarcado.ok) expect(desmarcado.failure).toBe("bad_request");
  });

  it("o dump cai no query_log com a lista de tabelas e a contagem de linhas", async () => {
    registros.length = 0;
    const r = await service.exportBundle(
      "sq1",
      { tables: [{ schema: "loja.db", table: "nota", structure: true, data: true }], format: "sql" },
      ATOR,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await texto(r.value.stream);
    const entrada = registros.at(-1);
    expect(entrada?.status).toBe("ok");
    expect(entrada?.sql).toContain("loja.db.nota");
    expect(entrada?.rowCount).toBe(2);
  });
});
