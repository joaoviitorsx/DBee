import type {
  DataCompareRequest,
  DataCompareResponse,
  DataCompareSide,
  RowsResponse,
  SchemaCompareRequest,
  SchemaCompareResponse,
} from "@dbee/shared";
import { compararDados, compararSchemas, dialetoDe, type LadoLido } from "@dbee/shared/puro";

import type { ConnectionsRepository } from "../db/connections.repo";
import type { Ator } from "../lib/ator";
import { type ServiceResult, fail, ok } from "./result";
import type { RowsService } from "./rows.service";
import type { SchemaService } from "./schema.service";

/** Linhas por página do keyset de cada lado. */
const PAGINA = 1000;
const MAX_ROWS_PADRAO = 10_000;

/**
 * Data compare e schema compare (ADR 018). **Não executa nada que escreva:**
 *
 * - os dados vêm do `RowsService` — o mesmo caminho da aba Dados: permissão
 *   pelo ator, relação conferida no catálogo, keyset paginado com cada página
 *   em `BEGIN READ ONLY` (ou na credencial, nas engines de credencial), e cada
 *   página no `query_log`;
 * - o catálogo vem do `SchemaService` (cache, `READ ONLY`);
 * - o SQL de sincronização é **texto** montado por função pura.
 */
export class CompareService {
  readonly #rows: RowsService;
  readonly #schema: SchemaService;
  readonly #conexoes: ConnectionsRepository;

  constructor(deps: { rows: RowsService; schema: SchemaService; conexoes: ConnectionsRepository }) {
    this.#rows = deps.rows;
    this.#schema = deps.schema;
    this.#conexoes = deps.conexoes;
  }

  async dados(req: DataCompareRequest, ator: Ator): Promise<ServiceResult<DataCompareResponse>> {
    const direita = this.#conexoes.find(req.right.connectionId, ator);
    if (direita === null || this.#conexoes.find(req.left.connectionId, ator) === null) return fail("not_found");

    const maxRows = req.maxRows ?? MAX_ROWS_PADRAO;
    const esq = await this.#lerTudo(req.left, maxRows, ator);
    if (!esq.ok) return esq;
    const dir = await this.#lerTudo(req.right, maxRows, ator);
    if (!dir.ok) return dir;

    const pk = esq.value.primaryKey;
    if (pk.length === 0) return fail("bad_request", "o lado esquerdo não tem chave primária: sem PK não há como parear linhas");
    if (pk.join("\u0000") !== dir.value.primaryKey.join("\u0000")) {
      return fail("bad_request", `as chaves primárias diferem: (${pk.join(", ")}) × (${dir.value.primaryKey.join(", ")})`);
    }

    const r = compararDados(
      esq.value.lado,
      dir.value.lado,
      pk,
      { schema: req.right.schema, table: req.right.table, dialeto: dialetoDe(direita.engine) },
      req.sampleSize ?? 50,
    );
    return ok({ ...r, primaryKey: pk, truncated: esq.value.truncado || dir.value.truncado });
  }

  async schemas(req: SchemaCompareRequest, ator: Ator): Promise<ServiceResult<SchemaCompareResponse>> {
    for (const lado of [req.left, req.right]) {
      const c = this.#conexoes.find(lado.connectionId, ator);
      if (c === null) return fail("not_found");
      if (c.engine !== "postgres") {
        return fail("bad_request", `engine_not_supported: schema compare só no Postgres por enquanto (${c.engine})`);
      }
    }
    const esq = await this.#schema.get(req.left.connectionId, req.left.database, false, ator);
    if (!esq.ok) return esq;
    const dir = await this.#schema.get(req.right.connectionId, req.right.database, false, ator);
    if (!dir.ok) return dir;

    const a = esq.value.schemas.find((s) => s.name === req.left.schema);
    const b = dir.value.schemas.find((s) => s.name === req.right.schema);
    if (a === undefined || b === undefined) {
      return fail("not_found", `schema ${a === undefined ? req.left.schema : req.right.schema} não existe`);
    }
    return ok(compararSchemas(a, b));
  }

  /** Lê um lado inteiro em páginas de keyset, até `maxRows`. */
  async #lerTudo(
    lado: DataCompareSide,
    maxRows: number,
    ator: Ator,
  ): Promise<ServiceResult<{ lado: LadoLido; primaryKey: string[]; truncado: boolean }>> {
    const rows: (string | null)[][] = [];
    let after: RowsResponse["nextCursor"] = null;

    for (;;) {
      const falta = maxRows - rows.length;
      const r = await this.#rows.read(
        lado.connectionId,
        lado.schema,
        lado.table,
        {
          limit: Math.min(PAGINA, falta),
          ...(lado.database === undefined ? {} : { database: lado.database }),
          ...(after === null ? {} : { after }),
        },
        ator,
      );
      if (!r.ok) return r;
      const columns = r.value.columns.map((c) => c.name);
      const primaryKey = r.value.primaryKey;
      if (!r.value.keyset) {
        return fail("bad_request", `${lado.schema}.${lado.table} não tem chave primária: sem PK não há como parear linhas`);
      }
      rows.push(...r.value.rows);
      if (!r.value.hasMore || r.value.nextCursor === null) {
        return ok({ lado: { columns, rows }, primaryKey, truncado: false });
      }
      if (rows.length >= maxRows) return ok({ lado: { columns, rows }, primaryKey, truncado: true });
      after = r.value.nextCursor;
    }
  }
}
