import {
  DdlInvalido,
  montarCreateDatabase,
  montarCreateTable,
  type CreateDatabaseRequest,
  type CreateTableRequest,
} from "@dbee/shared";

import type { ConnectionsRepository, ResolvedConnection } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import type { PoolManager } from "../pg/pool";

/**
 * DDL aditivo por formulário (ADR 010).
 *
 * Três controles, e nenhum deles é a UI esconder o botão:
 *
 * 1. **Modo escrita na conexão.** Igual à `MutationService`: sem
 *    `write_enabled`, recusa — e a recusa vai ao `query_log`, porque tentativa
 *    barrada é o evento que uma auditoria existe para registrar.
 * 2. **O comando é montado no servidor.** O cliente manda campos, nunca SQL.
 * 3. **Tudo cai no `query_log`** com o `actor`, o comando literal e o
 *    resultado.
 */

export type FalhaDdl =
  | "not_found"
  | "decryption_failed"
  | "write_forbidden"
  | "invalid"
  | "upstream_error";

export interface ResultadoDdl {
  readonly ok: boolean;
  readonly sql: string;
  readonly failure?: FalhaDdl;
  readonly message?: string;
}

/** Database em que o `CREATE DATABASE` é emitido — ele age no cluster, não nela. */
const DATABASE_DE_CONTROLE = "postgres";

export interface DdlDeps {
  readonly repository: ConnectionsRepository;
  readonly pools: PoolManager;
  readonly log: QueryLogRepository;
}

export class DdlService {
  readonly #repository: ConnectionsRepository;
  readonly #pools: PoolManager;
  readonly #log: QueryLogRepository;

  constructor(deps: DdlDeps) {
    this.#repository = deps.repository;
    this.#pools = deps.pools;
    this.#log = deps.log;
  }

  /**
   * `CREATE TABLE` — transação normal de escrita.
   *
   * Não precisa do caminho sem transação: DDL de tabela é transacional no
   * Postgres (medido), então ele passa pelo mesmo `BEGIN READ WRITE` de
   * qualquer escrita. Se falhar, a transação reverte e nada fica pela metade.
   */
  async criarTabela(
    connectionId: string,
    pedido: CreateTableRequest,
    actor: string,
  ): Promise<ResultadoDdl> {
    return await this.#executar(connectionId, pedido.database, actor, {
      montar: () => montarCreateTable(pedido),
      rodar: async (connection, sql) => {
        await this.#pools.withTransaction(
          connection,
          pedido.database,
          false,
          async (client) => client.query(sql),
        );
      },
    });
  }

  /**
   * `CREATE DATABASE` — o único comando do app fora de transação.
   *
   * Emitido contra `postgres`, não contra o database da aba: o comando age no
   * cluster, e apontá-lo para a database corrente daria o mesmo resultado com
   * uma conexão a mais ocupada à toa.
   */
  async criarDatabase(
    connectionId: string,
    pedido: CreateDatabaseRequest,
    actor: string,
  ): Promise<ResultadoDdl> {
    return await this.#executar(connectionId, DATABASE_DE_CONTROLE, actor, {
      montar: () => montarCreateDatabase(pedido),
      rodar: async (connection, sql) => {
        await this.#pools.withAutocommit(connection, DATABASE_DE_CONTROLE, async (client) =>
          client.query(sql),
        );
      },
    });
  }

  /**
   * O caminho comum: resolve a conexão, exige escrita, monta, roda, registra.
   *
   * Um só para os dois comandos porque a ordem dos controles é o que importa e
   * duplicá-la seria o jeito de um deles ficar sem um. O que muda entre eles é
   * só `montar` e `rodar`.
   */
  async #executar(
    connectionId: string,
    database: string,
    actor: string,
    passos: {
      readonly montar: () => string;
      readonly rodar: (connection: ResolvedConnection, sql: string) => Promise<void>;
    },
  ): Promise<ResultadoDdl> {
    const inicio = performance.now();

    let connection;
    try {
      connection = this.#repository.resolve(connectionId);
    } catch {
      return { ok: false, sql: "", failure: "decryption_failed" };
    }
    if (connection === null) return { ok: false, sql: "", failure: "not_found" };

    // Monta ANTES de checar escrita, para a recusa registrar o comando que teria
    // rodado — o `query_log` sem o SQL da tentativa é auditoria pela metade.
    let sql: string;
    try {
      sql = passos.montar();
    } catch (erro: unknown) {
      if (erro instanceof DdlInvalido) {
        return { ok: false, sql: "", failure: "invalid", message: erro.message };
      }
      throw erro;
    }

    if (!connection.writeEnabled) {
      this.#registrar(connectionId, database, sql, "error", "escrita negada: write_enabled desligado na conexão", inicio, actor);
      return { ok: false, sql, failure: "write_forbidden" };
    }

    try {
      await passos.rodar(connection, sql);
      this.#registrar(connectionId, database, sql, "ok", null, inicio, actor);
      return { ok: true, sql };
    } catch (err: unknown) {
      // O erro do Postgres vai inteiro para a UI: "already exists", "permission
      // denied", "invalid locale" são informação útil, não ruído (CLAUDE.md).
      const message = err instanceof Error ? err.message : "erro desconhecido";
      this.#registrar(connectionId, database, sql, "error", message, inicio, actor);
      return { ok: false, sql, failure: "upstream_error", message };
    }
  }

  #registrar(
    connectionId: string,
    database: string,
    sql: string,
    status: "ok" | "error",
    error: string | null,
    inicio: number,
    actor: string,
  ): void {
    this.#log.record({
      connectionId,
      database,
      sql,
      status,
      error,
      rowCount: null,
      durationMs: Math.round(performance.now() - inicio),
      readOnly: false,
      actor,
    });
  }
}
