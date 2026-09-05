import type { Database, Statement } from "bun:sqlite";

import { AUDIT_PAGE_SIZE, type AuditPage, type QueryLogEntry } from "@dbee/shared";

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

/** Filtros da busca de auditoria — todos opcionais, combinam com AND. */
export interface AuditFiltros {
  readonly q?: string | undefined;
  readonly status?: "ok" | "error" | "cancelled" | undefined;
  readonly connectionId?: string | undefined;
  readonly actor?: string | undefined;
  readonly limit: number;
  /** `executedAt|id` da última linha da página anterior. */
  readonly cursor?: string | undefined;
}

export class QueryLogRepository {
  readonly #db: Database;
  readonly #inserir: Statement<unknown, (string | number | null)[]>;
  readonly #recentes: Statement<Row, [number]>;
  readonly #porConexao: Statement<Row, [string, number]>;

  constructor(db: Database) {
    this.#db = db;
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

  /**
   * Busca de auditoria — filtros combinados e paginação por keyset.
   *
   * O `WHERE` é montado dinamicamente, mas **só a estrutura**: todo valor entra
   * por `?` (parâmetro do bun:sqlite), nunca concatenado. O texto do SQL é
   * casado por `instr(lower(...))` — substring, sem semântica de curinga, então
   * um `%` digitado procura um `%` literal.
   *
   * Keyset sobre `(executed_at, id)` decrescente: estável mesmo com o log
   * crescendo entre páginas, ao contrário de `OFFSET`. Pede uma linha a mais que
   * a página para saber se há próxima sem um `COUNT`.
   */
  search(filtros: AuditFiltros): AuditPage {
    const clausulas: string[] = [];
    const params: (string | number)[] = [];

    if (filtros.q !== undefined && filtros.q !== "") {
      clausulas.push("instr(lower(sql), lower(?)) > 0");
      params.push(filtros.q);
    }
    if (filtros.status !== undefined) {
      clausulas.push("status = ?");
      params.push(filtros.status);
    }
    if (filtros.connectionId !== undefined) {
      clausulas.push("connection_id = ?");
      params.push(filtros.connectionId);
    }
    if (filtros.actor !== undefined && filtros.actor !== "") {
      clausulas.push("actor = ?");
      params.push(filtros.actor);
    }
    if (filtros.cursor !== undefined) {
      const corte = filtros.cursor.lastIndexOf("|");
      if (corte > 0) {
        const execAt = filtros.cursor.slice(0, corte);
        const id = filtros.cursor.slice(corte + 1);
        // `(executed_at, id) < (execAt, id)` na forma canônica em OR — a mesma
        // comparação de linha do keyset de `rows`.
        clausulas.push("(executed_at < ? OR (executed_at = ? AND id < ?))");
        params.push(execAt, execAt, id);
      }
    }

    const where = clausulas.length === 0 ? "" : `WHERE ${clausulas.join(" AND ")}`;
    // Uma linha a mais que a página: se vier, há próxima.
    params.push(filtros.limit + 1);

    const linhas = this.#db
      .query<Row, (string | number)[]>(
        `SELECT ${COLUNAS} FROM query_log ${where} ORDER BY executed_at DESC, id DESC LIMIT ?`,
      )
      .all(...params);

    const temMais = linhas.length > filtros.limit;
    const pagina = temMais ? linhas.slice(0, filtros.limit) : linhas;
    const ultima = pagina.at(-1);
    const nextCursor =
      temMais && ultima !== undefined ? `${ultima.executedAt}|${ultima.id}` : null;

    return {
      entries: pagina.map((r) => ({ ...r, readOnly: r.readOnly === 1 })),
      nextCursor,
    };
  }
}

export { AUDIT_PAGE_SIZE };
