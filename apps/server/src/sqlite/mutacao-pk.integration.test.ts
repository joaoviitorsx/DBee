import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolvedConnection } from "../db/connections.repo";
import { MutacaoError, NaoEhChavePrimaria } from "../driver/erros";
import { DriverSqlite } from "../driver/sqlite";

/**
 * Edição de linha no SQLite com PK composta e sem PK (ideias-comunidade I7).
 *
 * Trava duas coisas que a suíte anterior não via:
 * - a prova de cardinalidade tem de valer **antes** de gravar — o `changes > 1`
 *   era conferido depois de um `.run()` fora de transação, então um DELETE que
 *   casava duas linhas apagava as duas e só depois reclamava;
 * - edição só pela chave primária completa: sem PK (ou com coluna avulsa) é
 *   recusada, nunca aplicada por aproximação.
 */

let raiz: string;
let driver: DriverSqlite;

const conexao: ResolvedConnection = {
  id: "sq-pk", name: "sqlite", color: null, engine: "sqlite",
  host: "", port: 0, database: "", username: "", password: "",
  sslMode: "disable", timezone: "UTC", statementTimeoutMs: 30_000,
  writeEnabled: true, hasWriteCredential: false, authSource: null,
  filePath: "pk.db", vpn: null, environment: null, createdAt: "", updatedAt: "",
};

const foto = (tabela: string): string => {
  const db = new Database(join(raiz, "pk.db"), { readonly: true });
  const linhas = db.query(`SELECT * FROM ${tabela} ORDER BY 1, 2, 3`).values();
  db.close();
  return JSON.stringify(linhas);
};

const alvo = (table: string, extra: Record<string, unknown>): never =>
  ({ database: "pk.db", schema: "pk.db", table, readOnly: false, ...extra }) as never;

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), "dbee-sqpk-"));
  process.env["DBEE_SQLITE_ROOT"] = raiz;
  const db = new Database(join(raiz, "pk.db"), { create: true });
  db.run("CREATE TABLE c3 (a TEXT, b INTEGER, c TEXT, v TEXT, PRIMARY KEY (a, b, c))");
  db.run(`INSERT INTO c3 VALUES
    ('k',1,'2026-01-01 10:00:00.123456','a'),
    ('k',1,'2026-01-01 10:00:00.123457','b'),
    ('k',2,'2026-01-01 10:00:00.123456','c ')`);
  db.run("CREATE TABLE sem_pk (k TEXT, v TEXT, w TEXT)");
  db.run("INSERT INTO sem_pk VALUES ('u','1','x'),('d','1','x'),('d','1','x')");
  db.close();
  driver = new DriverSqlite();
});

afterAll(async () => {
  await driver.desligar();
  rmSync(raiz, { recursive: true, force: true });
});

describe("SQLite — PK composta", () => {
  it("edita só a linha cuja PK difere no microssegundo; texto com espaço no fim volta idêntico", async () => {
    const r = await driver.mutarLinha(conexao, {
      tipo: "update",
      req: alvo("c3", {
        pk: [
          { column: "a", value: "k" }, { column: "b", value: "1" },
          { column: "c", value: "2026-01-01 10:00:00.123457" },
        ],
        changes: [{ column: "v", from: "b", to: "B" }],
      }),
    });
    expect(r.rowCount).toBe(1);
    expect(foto("c3")).toBe(JSON.stringify([
      ["k", 1, "2026-01-01 10:00:00.123456", "a"],
      ["k", 1, "2026-01-01 10:00:00.123457", "B"],
      ["k", 2, "2026-01-01 10:00:00.123456", "c "],
    ]));
  });

  it("guarda sem o espaço do fim não casa (row_changed = rowCount 0) e nada muda", async () => {
    const antes = foto("c3");
    const r = await driver.mutarLinha(conexao, {
      tipo: "delete",
      req: alvo("c3", {
        pk: [
          { column: "a", value: "k" }, { column: "b", value: "2" },
          { column: "c", value: "2026-01-01 10:00:00.123456" },
        ],
        guard: [{ column: "v", value: "c" }],
      }),
    });
    expect(r.rowCount).toBe(0);
    expect(foto("c3")).toBe(antes);
  });

  it("PK parcial é recusada", async () => {
    const antes = foto("c3");
    const p = driver.mutarLinha(conexao, {
      tipo: "update",
      req: alvo("c3", { pk: [{ column: "a", value: "k" }], changes: [{ column: "v", from: "a", to: "z" }] }),
    });
    expect(p).rejects.toBeInstanceOf(NaoEhChavePrimaria);
    await p.catch(() => undefined);
    expect(foto("c3")).toBe(antes);
  });
});

describe("SQLite — tabela sem PK", () => {
  it("DELETE de linhas duplicadas é recusado e NADA é apagado", async () => {
    const p = driver.mutarLinha(conexao, {
      tipo: "delete",
      req: alvo("sem_pk", { pk: [{ column: "k", value: "d" }], guard: [{ column: "v", value: "1" }, { column: "w", value: "x" }] }),
    });
    expect(p).rejects.toBeInstanceOf(MutacaoError);
    await p.catch(() => undefined);
    expect(foto("sem_pk")).toBe(JSON.stringify([["d", "1", "x"], ["d", "1", "x"], ["u", "1", "x"]]));
  });

  it("UPDATE por coluna que casaria uma linha só também é recusado", async () => {
    const p = driver.mutarLinha(conexao, {
      tipo: "update",
      req: alvo("sem_pk", { pk: [{ column: "k", value: "u" }], changes: [{ column: "v", from: "1", to: "2" }] }),
    });
    expect(p).rejects.toBeInstanceOf(NaoEhChavePrimaria);
    await p.catch(() => undefined);
    expect(foto("sem_pk")).toBe(JSON.stringify([["d", "1", "x"], ["d", "1", "x"], ["u", "1", "x"]]));
  });
});
