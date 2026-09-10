import {
  DdlInvalido,
  montarCreateDatabase,
  montarCreateTable,
  type CreateDatabaseRequest,
  type CreateTableRequest,
} from "@dbee/shared";
import { capacidadesDe, dialetoDe, gravaPorCredencialSeparada, type DialetoSql } from "@dbee/shared/puro";

import type { Ator } from "../lib/ator";
import type { ConnectionsRepository, ResolvedConnection } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import type { Drivers } from "../driver/registro";
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
 * 3. **Tudo cai no `query_log`** com o `ator`, o comando literal e o
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
  readonly drivers: Drivers;
}

export class DdlService {
  readonly #repository: ConnectionsRepository;
  readonly #pools: PoolManager;
  readonly #log: QueryLogRepository;
  readonly #drivers: Drivers;

  constructor(deps: DdlDeps) {
    this.#repository = deps.repository;
    this.#pools = deps.pools;
    this.#log = deps.log;
    this.#drivers = deps.drivers;
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
    ator: Ator,
  ): Promise<ResultadoDdl> {
    return await this.#executar(connectionId, "table", pedido.database, ator, (dialeto) =>
      montarCreateTable(pedido, dialeto),
    );
  }

  /**
   * `CREATE DATABASE`.
   *
   * No Postgres é o único comando do app fora de transação, emitido contra
   * `postgres` (age no cluster, não na database da aba). No MySQL/MariaDB roda
   * pela própria conexão. SQLite e libSQL não têm `CREATE DATABASE` — um é
   * arquivo, o outro é banco único — e são recusados.
   */
  async criarDatabase(
    connectionId: string,
    pedido: CreateDatabaseRequest,
    ator: Ator,
  ): Promise<ResultadoDdl> {
    return await this.#executar(connectionId, "database", DATABASE_DE_CONTROLE, ator, (dialeto) =>
      montarCreateDatabase(pedido, dialeto),
    );
  }

  /**
   * O caminho comum: resolve, exige a engine e a escrita, monta no dialeto,
   * roda e registra. A ordem dos controles é o que importa; duplicá-la seria o
   * jeito de um comando ficar sem um.
   *
   * O Postgres roda pelo `PoolManager` (transação de tabela, autocommit do
   * database). As outras engines SQL rodam pelo **driver**, no caminho de
   * escrita (`somenteLeitura: false`) — o mesmo que a edição de linha usa.
   */
  async #executar(
    connectionId: string,
    tipo: "table" | "database",
    databasePg: string,
    ator: Ator,
    montar: (dialeto: DialetoSql) => string,
  ): Promise<ResultadoDdl> {
    const inicio = performance.now();

    let connection;
    try {
      connection = this.#repository.resolve(connectionId, ator);
    } catch {
      return { ok: false, sql: "", failure: "decryption_failed" };
    }
    if (connection === null) return { ok: false, sql: "", failure: "not_found" };

    const engine = connection.engine;
    // Mongo/Redis não têm DDL de tabela (sem SQL livre). E `CREATE DATABASE` não
    // existe no SQLite (arquivo) nem no libSQL (banco único).
    if (capacidadesDe(engine)?.sqlLivre !== true) {
      return { ok: false, sql: "", failure: "write_forbidden", message: `DDL não existe em ${engine} no DBee.` };
    }
    if (tipo === "database" && (engine === "sqlite" || engine === "libsql")) {
      return {
        ok: false, sql: "", failure: "invalid",
        message: `criar database não existe em ${engine} — ${engine === "sqlite" ? "o banco é um arquivo" : "a conexão aponta para um banco único"}.`,
      };
    }

    const dialeto = dialetoDe(engine);
    const database = engine === "postgres" ? databasePg : connection.database;

    // Monta ANTES de checar escrita, para a recusa registrar o comando que teria
    // rodado — o `query_log` sem o SQL da tentativa é auditoria pela metade.
    let sql: string;
    try {
      sql = montar(dialeto);
    } catch (erro: unknown) {
      if (erro instanceof DdlInvalido) {
        return { ok: false, sql: "", failure: "invalid", message: erro.message };
      }
      throw erro;
    }

    /*
     * O portão de escrita, igual ao da edição de linha (`mutation.service`):
     * a base difere por família — credencial (MySQL/MariaDB/libSQL) exige a
     * credencial de escrita; transação/handle (Postgres/SQLite) exige o
     * `writeEnabled` — e, além da base, a **concessão do ator**.
     */
    const porCredencial = gravaPorCredencialSeparada(engine);
    const base = porCredencial ? connection.hasWriteCredential : connection.writeEnabled;
    const podeGravar = base && this.#repository.podeEscrever(connectionId, ator);
    if (!podeGravar) {
      const motivo = !base
        ? porCredencial
          ? "esta conexão não tem credencial de escrita configurada"
          : "escrita não habilitada nesta conexão"
        : "você não tem concessão de escrita nesta conexão";
      this.#registrar(connectionId, database, sql, "error", `write_forbidden: ${motivo}`, inicio, ator);
      return { ok: false, sql, failure: "write_forbidden", message: motivo };
    }

    try {
      const message = await this.#rodar(connection, tipo, database, sql);
      if (message !== null) {
        this.#registrar(connectionId, database, sql, "error", message, inicio, ator);
        return { ok: false, sql, failure: "upstream_error", message };
      }
      this.#registrar(connectionId, database, sql, "ok", null, inicio, ator);
      return { ok: true, sql };
    } catch (err: unknown) {
      // O erro do banco vai inteiro para a UI: "already exists", "permission
      // denied", "invalid locale" são informação útil, não ruído (CLAUDE.md).
      const message = err instanceof Error ? err.message : "erro desconhecido";
      this.#registrar(connectionId, database, sql, "error", message, inicio, ator);
      return { ok: false, sql, failure: "upstream_error", message };
    }
  }

  /**
   * Roda o DDL na engine. Devolve `null` no sucesso, ou a mensagem de erro do
   * banco (o driver reporta erro no resultado, não por exceção).
   */
  async #rodar(
    connection: ResolvedConnection,
    tipo: "table" | "database",
    database: string,
    sql: string,
  ): Promise<string | null> {
    if (connection.engine === "postgres") {
      // Tabela é transacional (reverte se falhar); database roda em autocommit.
      if (tipo === "table") {
        await this.#pools.withTransaction(connection, database, false, async (c) => c.query(sql));
      } else {
        await this.#pools.withAutocommit(connection, DATABASE_DE_CONTROLE, async (c) => c.query(sql));
      }
      return null;
    }

    const r = await this.#drivers.para(connection.engine).executar(connection, {
      sql, database, maxRows: 0, somenteLeitura: false,
    });
    return r.error === null ? null : `${r.error.code ?? "?"}: ${r.error.message}`;
  }

  #registrar(
    connectionId: string,
    database: string,
    sql: string,
    status: "ok" | "error",
    error: string | null,
    inicio: number,
    ator: Ator,
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
      actor: ator.id,
    });
  }
}
