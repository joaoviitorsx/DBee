import type { Database, Statement } from "bun:sqlite";

import type { Connection, CreateConnection, SslMode, UpdateConnection } from "@dbee/shared";

import { decrypt, encrypt, type EncryptionKey } from "../lib/crypto";
import { nanoid } from "../lib/ids";

/**
 * Colunas devolvidas pela API. `password_enc` está fora da lista de propósito:
 * a segunda barreira, depois do tipo `Connection`, é o SELECT não pedir a
 * coluna (DBee.md §5, §7 — nunca retornar credencial).
 */
const PUBLIC_COLUMNS = `
  id, name, color, host, port, database, username,
  ssl_mode AS sslMode, write_enabled AS writeEnabled,
  statement_timeout_ms AS statementTimeoutMs, timezone,
  created_at AS createdAt, updated_at AS updatedAt
`;

/** Linha crua: SQLite não tem boolean, `write_enabled` volta 0 ou 1. */
interface ConnectionRow {
  id: string;
  name: string;
  color: string | null;
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode: SslMode;
  writeEnabled: number;
  statementTimeoutMs: number;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

function toConnection(row: ConnectionRow): Connection {
  return { ...row, writeEnabled: row.writeEnabled === 1 };
}

/** Conexão com a senha já decifrada — só circula dentro do servidor. */
export interface ResolvedConnection extends Connection {
  readonly password: string;
}

export class ConnectionsRepository {
  readonly #db: Database;
  readonly #key: EncryptionKey;

  // Statements preparados uma vez (CLAUDE.md, "Ao escrever código").
  readonly #list: Statement<ConnectionRow, []>;
  readonly #byId: Statement<ConnectionRow, [string]>;
  readonly #secretById: Statement<{ password_enc: string }, [string]>;
  readonly #delete: Statement<unknown, [string]>;

  constructor(db: Database, key: EncryptionKey) {
    this.#db = db;
    this.#key = key;
    this.#list = db.query<ConnectionRow, []>(
      `SELECT ${PUBLIC_COLUMNS} FROM connections ORDER BY name`,
    );
    this.#byId = db.query<ConnectionRow, [string]>(
      `SELECT ${PUBLIC_COLUMNS} FROM connections WHERE id = ?`,
    );
    this.#secretById = db.query<{ password_enc: string }, [string]>(
      "SELECT password_enc FROM connections WHERE id = ?",
    );
    this.#delete = db.query<unknown, [string]>("DELETE FROM connections WHERE id = ?");
  }

  list(): Connection[] {
    return this.#list.all().map(toConnection);
  }

  find(id: string): Connection | null {
    const row = this.#byId.get(id);
    return row === null ? null : toConnection(row);
  }

  /**
   * Conexão com a senha decifrada. Só para abrir conexão no Postgres — nunca
   * serializar o retorno disto numa resposta HTTP.
   */
  resolve(id: string): ResolvedConnection | null {
    const connection = this.find(id);
    if (connection === null) return null;

    const row = this.#secretById.get(id);
    if (row === null) return null;

    // O id entra como AAD: um password_enc movido para outra conexão não
    // decifra (ADR 005).
    return { ...connection, password: decrypt(this.#key, id, row.password_enc) };
  }

  create(input: CreateConnection): Connection {
    const now = new Date().toISOString();
    const id = nanoid();

    this.#db
      .query<unknown, (string | number | null)[]>(
        `INSERT INTO connections (
           id, name, color, host, port, database, username, password_enc,
           ssl_mode, write_enabled, statement_timeout_ms, timezone,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.color ?? null,
        input.host,
        input.port ?? 5432,
        input.database,
        input.username,
        encrypt(this.#key, id, input.password),
        input.sslMode ?? "disable",
        input.writeEnabled === true ? 1 : 0,
        input.statementTimeoutMs ?? 30000,
        input.timezone ?? "UTC",
        now,
        now,
      );

    const created = this.find(id);
    if (created === null) throw new Error("conexão sumiu logo após ser criada");
    return created;
  }

  /** `password` ausente no patch significa "não mexe na senha". */
  update(id: string, patch: UpdateConnection): Connection | null {
    if (this.find(id) === null) return null;

    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    const put = (column: string, value: string | number | null): void => {
      sets.push(`${column} = ?`);
      values.push(value);
    };

    if (patch.name !== undefined) put("name", patch.name);
    if (patch.color !== undefined) put("color", patch.color);
    if (patch.host !== undefined) put("host", patch.host);
    if (patch.port !== undefined) put("port", patch.port);
    if (patch.database !== undefined) put("database", patch.database);
    if (patch.username !== undefined) put("username", patch.username);
    if (patch.password !== undefined) put("password_enc", encrypt(this.#key, id, patch.password));
    if (patch.sslMode !== undefined) put("ssl_mode", patch.sslMode);
    if (patch.writeEnabled !== undefined) put("write_enabled", patch.writeEnabled ? 1 : 0);
    if (patch.statementTimeoutMs !== undefined) {
      put("statement_timeout_ms", patch.statementTimeoutMs);
    }
    if (patch.timezone !== undefined) put("timezone", patch.timezone);

    if (sets.length > 0) {
      put("updated_at", new Date().toISOString());
      this.#db
        .query<unknown, (string | number | null)[]>(
          `UPDATE connections SET ${sets.join(", ")} WHERE id = ?`,
        )
        .run(...values, id);
    }

    return this.find(id);
  }

  delete(id: string): boolean {
    return this.#delete.run(id).changes > 0;
  }
}
