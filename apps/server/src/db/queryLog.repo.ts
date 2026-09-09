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
  /**
   * Recorta o log às conexões que **este usuário** enxerga (migração 005).
   *
   * `undefined` significa "sem recorte", e é o que o `admin` recebe. Para um
   * `member` sem isto, a auditoria devolveria o SQL de conexões que ele nem vê
   * na árvore — em contexto contábil, a query de um usuário visível a outro já
   * é vazamento de dado, mesmo que ele não consiga executá-la.
   */
  readonly visivelPara?: string | undefined;
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
   * A montagem do SQL vive em `montarBusca`, fora da classe, para o teste poder
   * conferir o **plano** do statement que de fato executa. Ver lá o porquê.
   */
  search(filtros: AuditFiltros): AuditPage {
    const { sql, params } = montarBusca(filtros);
    const linhas = this.#db.query<Row, (string | number)[]>(sql).all(...params);

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

/**
 * Monta o SQL da busca de auditoria.
 *
 * **Fora da classe, e exportada, de propósito.** Os índices da migration 006 só
 * valem se o planejador de fato os usar, e "usa o índice" é afirmação que
 * precisa de teste. O teste roda `EXPLAIN QUERY PLAN` sobre o que esta função
 * devolve — o statement real, não uma cópia que divergiria no primeiro filtro
 * novo.
 *
 * O `WHERE` é dinâmico, mas **só a estrutura**: todo valor entra por `?`
 * (parâmetro do bun:sqlite), nunca concatenado. O texto do SQL é casado por
 * `instr(lower(...))` — substring, sem semântica de curinga, então um `%`
 * digitado procura um `%` literal.
 */
export function montarBusca(filtros: AuditFiltros): {
  sql: string;
  params: (string | number)[];
} {
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
  if (filtros.visivelPara !== undefined) {
    // Subconsulta, não JOIN: o `connection_access` tem no máximo uma linha por
    // par, então o `IN` não duplica, e o índice `idx_connection_access_user`
    // atende exatamente esta pergunta.
    clausulas.push(
      "connection_id IN (SELECT connection_id FROM connection_access WHERE user_id = ?)",
    );
    params.push(filtros.visivelPara);
  }
  if (filtros.cursor !== undefined) {
    const corte = filtros.cursor.lastIndexOf("|");
    if (corte > 0) {
      const execAt = filtros.cursor.slice(0, corte);
      const id = filtros.cursor.slice(corte + 1);
      /*
       * Comparação de TUPLA, não a forma canônica em `OR`.
       *
       * As duas dizem a mesma coisa e devolvem as mesmas linhas (há teste), mas
       * o planejador do SQLite trata cada uma de um jeito: o `OR` vira
       * `MULTI-INDEX OR`, que **varre** o índice, enquanto a tupla vira
       * `SEARCH … ((executed_at,id)<(?,?))`, que salta direto para a posição.
       *
       * Medido num `query_log` de 1.000.000 de linhas, já com o índice de keyset
       * criado: 46 ms no `OR`, 0,096 ms na tupla. O índice sozinho não resolvia
       * — a forma do `WHERE` é metade do conserto.
       *
       * `(a, b) < (x, y)` é comparação de valor de linha, do SQLite 3.15 em
       * diante; o Bun embute uma versão muito posterior.
       */
      clausulas.push("(executed_at, id) < (?, ?)");
      params.push(execAt, id);
    }
  }

  const where = clausulas.length === 0 ? "" : `WHERE ${clausulas.join(" AND ")}`;
  // Uma linha a mais que a página: se vier, há próxima.
  params.push(filtros.limit + 1);

  return {
    sql: `SELECT ${COLUNAS} FROM query_log ${where} ORDER BY executed_at DESC, id DESC LIMIT ?`,
    params,
  };
}

export { AUDIT_PAGE_SIZE };
