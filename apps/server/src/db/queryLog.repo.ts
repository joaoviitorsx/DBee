import type { Database, Statement } from "bun:sqlite";

import type { QueryLogEntry } from "@dbee/shared";

import { nanoid } from "../lib/ids";

/**
 * `query_log` — toda query executada fica registrada (DBee.md §2.4).
 *
 * "Contexto contábil/fiscal exige isso": o registro não é telemetria, é
 * auditoria. Grava tanto sucesso quanto erro, e grava **antes** de qualquer
 * decisão de exibição — o que o usuário vê não muda o que ficou registrado.
 *
 * O SQL vai para cá e **não** para o stdout (§7).
 */
export interface NewLogEntry {
  readonly connectionId: string;
  readonly database: string;
  readonly sql: string;
  readonly status: "ok" | "error" | "cancelled";
  readonly error: string | null;
  readonly rowCount: number | null;
  readonly durationMs: number | null;
  readonly readOnly: boolean;
  readonly actor: string;
}

interface Row {
  id: string;
  connectionId: string;
  database: string;
  sql: string;
  status: "ok" | "error" | "cancelled";
  error: string | null;
  rowCount: number | null;
  durationMs: number | null;
  readOnly: number;
  actor: string;
  executedAt: string;
}

const COLUNAS = `
  id, connection_id AS connectionId, database, sql, status, error,
  row_count AS rowCount, duration_ms AS durationMs,
  read_only AS readOnly, actor, executed_at AS executedAt
`;

export class QueryLogRepository {
  readonly #inserir: Statement<unknown, (string | number | null)[]>;
  readonly #recentes: Statement<Row, [number]>;
  readonly #porConexao: Statement<Row, [string, number]>;

  constructor(db: Database) {
    this.#inserir = db.query(
      `INSERT INTO query_log
         (id, connection_id, database, sql, status, error, row_count,
          duration_ms, read_only, actor, executed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.#recentes = db.query<Row, [number]>(
      `SELECT ${COLUNAS} FROM query_log ORDER BY executed_at DESC LIMIT ?`,
    );
    this.#porConexao = db.query<Row, [string, number]>(
      `SELECT ${COLUNAS} FROM query_log WHERE connection_id = ?
        ORDER BY executed_at DESC LIMIT ?`,
    );
  }

  record(entry: NewLogEntry): string {
    const id = nanoid();
    this.#inserir.run(
      id,
      entry.connectionId,
      entry.database,
      entry.sql,
      entry.status,
      entry.error,
      entry.rowCount,
      entry.durationMs,
      entry.readOnly ? 1 : 0,
      entry.actor,
      new Date().toISOString(),
    );
    return id;
  }

  list(limit = 100, connectionId?: string): QueryLogEntry[] {
    const linhas =
      connectionId === undefined
        ? this.#recentes.all(limit)
        : this.#porConexao.all(connectionId, limit);

    return linhas.map((r) => ({ ...r, readOnly: r.readOnly === 1 }));
  }
}
