import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { migrate } from "./migrate";
import { EXPECTED_SCHEMA, MIGRATIONS } from "./migrations";

const latest = Math.max(...MIGRATIONS.map((m) => m.version));

describe("migrations", () => {
  it("EXPECTED_SCHEMA casa com a última migration", () => {
    // O boot aborta se o banco ficar abaixo de EXPECTED_SCHEMA. Se este valor
    // derivar da última migration, ou o boot rejeita um banco atual, ou deixa
    // passar um defasado. Trava os dois.
    expect(EXPECTED_SCHEMA).toBe(latest);
  });

  it("aplica tudo num banco vazio", () => {
    const db = new Database(":memory:");
    expect(migrate(db)).toBe(latest);

    const tables = (
      db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(tables).toContain("connections");
    expect(tables).toContain("app_meta");
    expect(tables).toContain("query_log");
    expect(tables).toContain("saved_queries");
  });

  it("é idempotente", () => {
    const db = new Database(":memory:");
    migrate(db);
    expect(migrate(db)).toBe(latest);
    expect(migrate(db)).toBe(latest);
  });

  it("guarda a versão em app_meta", () => {
    const db = new Database(":memory:");
    migrate(db);
    const row = db.query("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | null;
    expect(row?.value).toBe(String(latest));
  });

  it("o CHECK de ssl_mode recusa prefer e allow (ADR 003)", () => {
    const db = new Database(":memory:");
    migrate(db);
    const insert = (mode: string): void => {
      db.query(
        `INSERT INTO connections (id, name, host, port, database, username, password_enc,
           ssl_mode, created_at, updated_at)
         VALUES (?, 'x', 'h', 5432, 'd', 'u', 'e', ?, '', '')`,
      ).run(`id-${mode}`, mode);
    };
    expect(() => { insert("prefer"); }).toThrow();
    expect(() => { insert("allow"); }).toThrow();
    expect(() => { insert("require"); }).not.toThrow();
  });
});

describe("ordem das migrations", () => {
  it("aplica por versão, não pela ordem do array", () => {
    // O array é mantido à mão; um rebase de dois branches basta para inverter
    // duas linhas. Com a versão congelada da leitura inicial, a 002 rodava
    // depois da 003 e regravava schema_version = 2 — e no boot seguinte a 003
    // reaplicava, estourando em "already exists" e deixando o container em
    // loop de restart.
    const versoes = MIGRATIONS.map((m) => m.version);
    expect([...versoes].sort((a, b) => a - b)).toEqual(versoes);
  });

  it("não há versão duplicada", () => {
    const versoes = MIGRATIONS.map((m) => m.version);
    expect(new Set(versoes).size).toBe(versoes.length);
  });

  it("toda migration tem SQL não vazio", () => {
    for (const m of MIGRATIONS) {
      expect(m.sql.trim().length).toBeGreaterThan(0);
    }
  });
});
