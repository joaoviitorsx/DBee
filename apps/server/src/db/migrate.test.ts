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

/**
 * O caminho que de fato acontece em produção: um banco que JÁ existe sobe para
 * a versão nova, com dados dentro.
 *
 * "Aplica num banco vazio" não prova isso. A 006 derruba um índice e cria
 * outros três; se o `DROP INDEX` errasse o nome, ou se um `CREATE INDEX`
 * colidisse com algo já presente, o container entraria em loop de restart — e o
 * dado do cliente estaria do outro lado dessa falha.
 */
describe("subir um banco existente para a 006", () => {
  /** Um banco parado na v5, com dado dentro, como o de quem roda a v0.3.1. */
  const bancoNaV5 = (): Database => {
    const db = new Database(":memory:");
    const ate5 = MIGRATIONS.filter((m) => m.version <= 5);
    db.run("BEGIN");
    for (const m of ate5) db.run(m.sql);
    db.run(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.run(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '5')`);
    db.run("COMMIT");
    db.query(
      `INSERT INTO connections (id, name, host, port, database, username, password_enc,
         ssl_mode, created_at, updated_at)
       VALUES ('c1', 'x', 'h', 5432, 'd', 'u', 'e', 'require', '', '')`,
    ).run();
    for (let i = 0; i < 25; i++) {
      db.query(
        `INSERT INTO query_log (id, connection_id, database, sql, status, error, row_count,
           duration_ms, read_only, actor, executed_at)
         VALUES (?, 'c1', 'd', 'SELECT 1', 'ok', NULL, 1, 5, 1, 'joao', ?)`,
      ).run(`log_${String(i)}`, new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString());
    }
    return db;
  };

  it("o banco na v5 nasce com o índice antigo, e só com ele", () => {
    const db = bancoNaV5();
    const nomes = db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master
          WHERE type='index' AND tbl_name='query_log'
            -- o autoíndice da PK TEXT não é decisão de ninguém: sai da conta
            AND name NOT LIKE 'sqlite_autoindex%'`,
      )
      .all()
      .map((r) => r.name);
    expect(nomes).toEqual(["idx_query_log_recent"]);
  });

  it("migra para a 006 sem perder linha nenhuma", () => {
    const db = bancoNaV5();
    expect(migrate(db)).toBe(latest);

    const n = db.query<{ n: number }, []>("SELECT count(*) AS n FROM query_log").get()?.n;
    expect(n).toBe(25);

    const nomes = db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master
          WHERE type='index' AND tbl_name='query_log'
            AND name NOT LIKE 'sqlite_autoindex%'
          ORDER BY name`,
      )
      .all()
      .map((r) => r.name);
    expect(nomes).toEqual(["idx_query_log_ator", "idx_query_log_keyset", "idx_query_log_status"]);
  });

  it("rodar a migração de novo sobre o banco já migrado não estoura", () => {
    const db = bancoNaV5();
    migrate(db);
    expect(migrate(db)).toBe(latest);
    expect(migrate(db)).toBe(latest);
  });
});

/**
 * A 007 sobre um banco que já existe, com conexões dentro.
 *
 * É aditiva de propósito, e é isso que mantém rollback de deploy como opção:
 * um binário anterior continua abrindo um banco v7 porque não pede a coluna
 * nova. O teste trava as duas pontas — a coluna aparece com o valor certo, e
 * nenhuma linha se perde.
 */
describe("subir um banco existente para a 007", () => {
  const bancoNaV6 = (): Database => {
    const db = new Database(":memory:");
    db.run("BEGIN");
    for (const m of MIGRATIONS.filter((x) => x.version <= 6)) db.run(m.sql);
    db.run("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '6')");
    db.run("COMMIT");
    for (let i = 0; i < 4; i++) {
      db.query(
        `INSERT INTO connections (id, name, host, port, database, username, password_enc,
           ssl_mode, created_at, updated_at)
         VALUES (?, ?, 'h', 5432, 'd', 'u', 'enc', 'require', '', '')`,
      ).run(`c${String(i)}`, `conexao ${String(i)}`);
    }
    return db;
  };

  it("a coluna engine não existe na v6", () => {
    const db = bancoNaV6();
    const colunas = db
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('connections')")
      .all()
      .map((r) => r.name);
    expect(colunas).not.toContain("engine");
  });

  it("migra sem perder conexão, e toda linha existente vira postgres", () => {
    const db = bancoNaV6();
    expect(migrate(db)).toBe(latest);

    const linhas = db
      .query<{ id: string; engine: string }, []>("SELECT id, engine FROM connections ORDER BY id")
      .all();
    expect(linhas).toHaveLength(4);
    // Não é chute: Postgres É a única engine que o DBee falava quando essas
    // linhas foram gravadas.
    expect(linhas.every((l) => l.engine === "postgres")).toBe(true);
  });

  it("o CHECK recusa engine que não existe", () => {
    const db = bancoNaV6();
    migrate(db);
    expect(() => {
      db.query(
        `INSERT INTO connections (id, name, engine, host, port, database, username,
           password_enc, ssl_mode, created_at, updated_at)
         VALUES ('x', 'x', 'oracle', 'h', 1, 'd', 'u', 'e', 'require', '', '')`,
      ).run();
    }).toThrow();
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
