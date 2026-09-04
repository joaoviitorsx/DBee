import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { deriveKey, newSalt, type EncryptionKey } from "../lib/crypto";
import type { Config } from "../lib/config";
import { migrate } from "./migrate";

const SALT_KEY = "encryption_salt";

export interface Store {
  readonly db: Database;
  readonly key: EncryptionKey;
  readonly schemaVersion: number;
}

interface MetaRow {
  value: string;
}

/**
 * Salt fixo por instalação, guardado em `app_meta` (DBee.md §7). Gerado no
 * primeiro boot; a partir daí é lido. Se sumir, todas as senhas viram ilegíveis
 * mesmo com o `APP_SECRET` certo — por isso ele vive no mesmo volume do banco.
 */
function loadOrCreateSalt(db: Database): Buffer {
  const row = db
    .query<MetaRow, [string]>("SELECT value FROM app_meta WHERE key = ?")
    .get(SALT_KEY);
  if (row !== null) return Buffer.from(row.value, "base64");

  const salt = newSalt();
  db.query<unknown, [string, string]>("INSERT INTO app_meta (key, value) VALUES (?, ?)").run(
    SALT_KEY,
    salt.toString("base64"),
  );
  return salt;
}

/**
 * Abre o SQLite, aplica migrations e deriva a chave de cifra **uma vez**.
 * A derivação custa ~700 ms — é o preço do boot, não de cada requisição.
 */
export function openStore(config: Config): Store {
  mkdirSync(config.dataDir, { recursive: true });

  const db = new Database(join(config.dataDir, "dbee.sqlite"), { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");

  const schemaVersion = migrate(db);
  const key = deriveKey(config.appSecret, loadOrCreateSalt(db));

  return { db, key, schemaVersion };
}

/** Store em memória para teste — mesmas migrations, salt efêmero. */
export function openTestStore(appSecret = "test-secret"): Store {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  const schemaVersion = migrate(db);
  const key = deriveKey(appSecret, loadOrCreateSalt(db));
  return { db, key, schemaVersion };
}
