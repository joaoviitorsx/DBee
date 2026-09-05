import {
  construirDelete,
  construirInsert,
  construirUpdate,
  type RowDeleteRequest,
  type RowInsertRequest,
  type RowMutationResult,
  type RowUpdateRequest,
  type SqlConstruido,
} from "@dbee/shared";

import type { ConnectionsRepository } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import type { PoolManager } from "../pg/pool";
import { type MutationResult, mutFail, mutOk } from "./result";

/**
 * Sinaliza que o `UPDATE`/`DELETE` não afetou exatamente uma linha. Lançada
 * **dentro** da transação para o `withTransaction` reverter antes do commit — a
 * prova de cardinalidade acontece antes de qualquer escrita ser gravada.
 */
class CardinalidadeError extends Error {
  constructor(readonly rowCount: number) {
    super(`rowCount ${String(rowCount)}`);
    this.name = "CardinalidadeError";
  }
}

export interface MutationServiceDeps {
  readonly repository: ConnectionsRepository;
  readonly pools: PoolManager;
  readonly log: QueryLogRepository;
}

/**
 * Edição de linha — UPDATE de célula e DELETE de linha (v0.2).
 *
 * A segurança está em três camadas, e todas moram aqui:
 *
 * 1. **Escrita explícita.** Só roda com `write_enabled` na conexão; o schema já
 *    exige `readOnly: false` na requisição (omitir recusa na validação).
 * 2. **Concorrência otimista.** O `WHERE` do UPDATE repete os valores originais
 *    das colunas alteradas (ver `construirUpdate`): linha mudada desde a leitura
 *    casa 0 e aborta.
 * 3. **Cardinalidade provada antes do commit.** Roda o statement, confere que
 *    afetou exatamente 1 linha e só então deixa a transação commitar. Diferente
 *    de 1 lança e reverte — nada é gravado.
 *
 * E **toda** aplicação, com sucesso ou aborto, vai ao `query_log` com o SQL
 * literal, os valores (que estão no próprio SQL) e o actor.
 */
export class MutationService {
  readonly #repository: ConnectionsRepository;
  readonly #pools: PoolManager;
  readonly #log: QueryLogRepository;

  constructor({ repository, pools, log }: MutationServiceDeps) {
    this.#repository = repository;
    this.#pools = pools;
    this.#log = log;
  }

  update(
    connectionId: string,
    request: RowUpdateRequest,
    actor: string,
  ): Promise<MutationResult<RowMutationResult>> {
    return this.#aplicar(connectionId, request.database, actor, construirUpdate(request));
  }

  delete(
    connectionId: string,
    request: RowDeleteRequest,
    actor: string,
  ): Promise<MutationResult<RowMutationResult>> {
    return this.#aplicar(connectionId, request.database, actor, construirDelete(request));
  }

  insert(
    connectionId: string,
    request: RowInsertRequest,
    actor: string,
  ): Promise<MutationResult<RowMutationResult>> {
    // Reusa #aplicar: um INSERT de uma linha afeta exatamente 1 (ou o Postgres
    // recusa por constraint, e o erro vai inteiro para a tela).
    return this.#aplicar(connectionId, request.database, actor, construirInsert(request));
  }

  async #aplicar(
    connectionId: string,
    database: string,
    actor: string,
    construido: SqlConstruido,
  ): Promise<MutationResult<RowMutationResult>> {
    const inicio = performance.now();

    let connection;
    try {
      connection = this.#repository.resolve(connectionId);
    } catch {
      return mutFail("decryption_failed");
    }
    if (connection === null) return mutFail("not_found");
    // A conexão manda: sem `write_enabled`, nem a requisição mais explícita
    // libera escrita. (O `readOnly: false` já é exigido pelo schema.) A tentativa
    // negada vai ao query_log: escrita barrada é justamente o evento que uma
    // auditoria existe para registrar. O SQL literal já traz a intenção completa.
    if (!connection.writeEnabled) {
      this.#registrar(
        connectionId,
        database,
        construido.literal,
        "error",
        "escrita negada: write_enabled desligado na conexão",
        null,
        inicio,
        actor,
      );
      return mutFail("write_forbidden");
    }

    try {
      const rowCount = await this.#pools.withTransaction(
        connection,
        database,
        false,
        async (client) => {
          const res = await client.query(construido.text, construido.params);
          const rc = res.rowCount ?? 0;
          if (rc !== 1) throw new CardinalidadeError(rc);
          return rc;
        },
      );

      this.#registrar(connectionId, database, construido.literal, "ok", null, rowCount, inicio, actor);
      return mutOk({ rowCount, sql: construido.literal });
    } catch (err: unknown) {
      if (err instanceof CardinalidadeError) {
        // 0 linhas: a linha mudou (guarda otimista) ou sumiu. >1: o WHERE casaria
        // mais de uma — a transação já reverteu, nada foi gravado.
        const failure = err.rowCount === 0 ? "row_changed" : "ambiguous_row";
        const mensagem =
          err.rowCount === 0
            ? "a linha mudou desde que você a leu — recarregue a linha e refaça a edição"
            : `a condição casaria ${String(err.rowCount)} linhas`;
        this.#registrar(
          connectionId,
          database,
          construido.literal,
          "error",
          mensagem,
          err.rowCount,
          inicio,
          actor,
        );
        return mutFail(failure, mensagem);
      }

      const message = err instanceof Error ? err.message : "erro desconhecido";
      this.#registrar(connectionId, database, construido.literal, "error", message, null, inicio, actor);
      return mutFail("upstream_error", message);
    }
  }

  #registrar(
    connectionId: string,
    database: string,
    sql: string,
    status: "ok" | "error",
    error: string | null,
    rowCount: number | null,
    inicio: number,
    actor: string,
  ): void {
    this.#log.record({
      connectionId,
      database,
      sql,
      status,
      error,
      rowCount,
      durationMs: Math.round(performance.now() - inicio),
      readOnly: false,
      actor,
    });
  }
}
