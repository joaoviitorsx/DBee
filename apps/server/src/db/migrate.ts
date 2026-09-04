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
  // Ordena por versão em vez de confiar na ordem do array. O array é mantido à
  // mão, e é exatamente ao acrescentar uma migration que a ordem se perde — um
  // rebase de dois branches basta. Aplicar 003 antes de 002 grava
  // `schema_version = 2` no fim, e no boot seguinte a 003 roda de novo e
  // estoura em `CREATE TABLE ... already exists`, deixando o container em loop
  // de restart.
  const ordenadas = [...MIGRATIONS].sort((a, b) => a.version - b.version);

  const versoes = ordenadas.map((m) => m.version);
  if (new Set(versoes).size !== versoes.length) {
    throw new Error(`migrations com versão duplicada: ${versoes.join(", ")}`);
  }

  for (const migration of ordenadas) {
    // Relê a versão a cada passo: comparar sempre com a leitura inicial faria
    // uma migration fora de ordem sobrescrever a versão de outra já aplicada.
    if (migration.version <= currentVersion(db)) continue;

    db.transaction(() => {
      db.run(migration.sql);
      db.query<unknown, [string, string]>(
        "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(VERSION_KEY, String(migration.version));
    })();
  }

  return currentVersion(db);
}
