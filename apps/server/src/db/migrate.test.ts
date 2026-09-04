import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { migrate } from "./migrate";
import { MIGRATIONS } from "./migrations";

const latest = Math.max(...MIGRATIONS.map((m) => m.version));

describe("migrations", () => {
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
