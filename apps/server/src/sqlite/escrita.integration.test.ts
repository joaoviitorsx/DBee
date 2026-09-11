import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolvedConnection } from "../db/connections.repo";
import { DriverSqlite } from "../driver/sqlite";

/**
 * Escrita no SQLite local — o modelo de dois handles.
 *
 * O que os testes travam:
 * - a escrita (row-edit e SQL livre) grava pelo handle r/w quando autorizada;
 * - uma conexão **sem** escrita (o handle readonly) recusa o INSERT — a
 *   garantia é o handle, não um PRAGMA;
 * - a guarda otimista pega o valor mudado (row_changed).
 */

let raiz: string;
let driver: DriverSqlite;

const conexao = (writeEnabled: boolean): ResolvedConnection =>
  ({
    id: `sqw-${String(writeEnabled)}`, name: "sqlite", color: null, engine: "sqlite",
    host: "", port: 0, database: "", username: "", password: "",
    sslMode: "disable", timezone: "UTC", statementTimeoutMs: 30_000,
    writeEnabled, hasWriteCredential: false, authSource: null,
    filePath: "loja.db", createdAt: "", updatedAt: "",
  }) satisfies ResolvedConnection;

function contar(): number {
  const db = new Database(join(raiz, "loja.db"), { readonly: true });
  const n = (db.query("SELECT COUNT(*) AS c FROM produto").get() as { c: number }).c;
  db.close();
  return n;
}

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), "dbee-sqlw-"));
  process.env["DBEE_SQLITE_ROOT"] = raiz;
  const db = new Database(join(raiz, "loja.db"), { create: true });
  db.run("CREATE TABLE produto (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, preco REAL)");
  db.run("INSERT INTO produto VALUES (1,'Café',18.9),(2,'Chá',12.5)");
  db.close();
  driver = new DriverSqlite();
});

afterAll(async () => {
  await driver.desligar();
  rmSync(raiz, { recursive: true, force: true });
});

const alvo = (extra: Record<string, unknown>): Record<string, unknown> => ({
  database: "loja.db", schema: "loja.db", table: "produto", readOnly: false, ...extra,
});

describe("escrita no SQLite local", () => {
  it("row-edit atualiza pelo handle r/w quando writeEnabled", async () => {
    const r = await driver.mutarLinha(conexao(true), {
      tipo: "update",
      req: alvo({ pk: [{ column: "id", value: "1" }], changes: [{ column: "preco", from: "18.9", to: "19.9" }] }) as never,
    });
    expect(r.rowCount).toBe(1);
    const db = new Database(join(raiz, "loja.db"), { readonly: true });
    expect((db.query("SELECT preco FROM produto WHERE id=1").get() as { preco: number }).preco).toBe(19.9);
    db.close();
  });

  it("a guarda otimista pega o valor original errado", async () => {
    const r = await driver.mutarLinha(conexao(true), {
      tipo: "update",
      req: alvo({ pk: [{ column: "id", value: "2" }], changes: [{ column: "preco", from: "99", to: "1" }] }) as never,
    });
    expect(r.rowCount).toBe(0);
  });

  it("insere e exclui pelo handle r/w", async () => {
    const antes = contar();
    const ins = await driver.mutarLinha(conexao(true), {
      tipo: "insert",
      req: alvo({ values: [{ column: "id", value: "3" }, { column: "nome", value: "Suco" }] }) as never,
    });
    expect(ins.rowCount).toBe(1);
    expect(contar()).toBe(antes + 1);

    const del = await driver.mutarLinha(conexao(true), {
      tipo: "delete",
      req: alvo({ pk: [{ column: "id", value: "3" }], guard: [{ column: "nome", value: "Suco" }] }) as never,
    });
    expect(del.rowCount).toBe(1);
    expect(contar()).toBe(antes);
  });

  it("SQL livre de escrita grava quando somenteLeitura=false", async () => {
    const r = await driver.executar(conexao(true), {
      sql: "UPDATE produto SET nome='Café forte' WHERE id=1",
      database: "loja.db", maxRows: 100, somenteLeitura: false,
    });
    expect(r.error).toBeNull();
    const db = new Database(join(raiz, "loja.db"), { readonly: true });
    expect((db.query("SELECT nome FROM produto WHERE id=1").get() as { nome: string }).nome).toBe("Café forte");
    db.close();
  });

  /*
   * A garantia: com somenteLeitura=true (o caminho de um member sem concessão),
   * a escrita cai no handle readonly e o SQLite recusa.
   */
  it("SQL de escrita com somenteLeitura=true falha no handle readonly", async () => {
    const r = await driver.executar(conexao(true), {
      sql: "UPDATE produto SET nome='hack' WHERE id=1",
      database: "loja.db", maxRows: 100, somenteLeitura: true,
    });
    expect(r.error).not.toBeNull();
    expect(r.error?.message.toLowerCase()).toContain("readonly");
  });
});
