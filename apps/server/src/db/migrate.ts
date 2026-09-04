import type { Database } from "bun:sqlite";

import { MIGRATIONS } from "./migrations";

const VERSION_KEY = "schema_version";

interface MetaRow {
  value: string;
}

function currentVersion(db: Database): number {
  const hasMeta = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'",
    )
    .get();
  if (hasMeta === null) return 0;

  const row = db
    .query<MetaRow, [string]>("SELECT value FROM app_meta WHERE key = ?")
    .get(VERSION_KEY);
  return row === null ? 0 : Number(row.value);
}

/**
 * Aplica as migrations pendentes em ordem, cada uma numa transação junto com o
 * bump da versão: falha no meio não deixa schema meio aplicado.
 */
export function migrate(db: Database): number {
  const from = currentVersion(db);

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;

    db.transaction(() => {
      db.run(migration.sql);
      db.query<unknown, [string, string]>(
        "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(VERSION_KEY, String(migration.version));
    })();
  }

  return currentVersion(db);
}
