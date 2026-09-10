import {
  construirDelete,
  construirInsert,
  construirUpdate,
  type RowDeleteRequest,
  type RowInsertRequest,
  type RowMutationResult,
  type RowUpdateRequest,
  type SqlConstruido,
  type TiposDeColuna,
} from "@dbee/shared";

import type { Ator } from "../lib/ator";
import type { ConnectionsRepository } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import type { PoolClient } from "pg";

import type { PoolManager } from "../pg/pool";
import type { Drivers } from "../driver/registro";
import type { MutacaoLinha } from "../driver/tipos";
import { MutacaoError } from "../driver/erros";
import { gravaPorCredencialSeparada } from "@dbee/shared/puro";
import { exigirPostgres } from "./engine.guarda";
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
  /** Quem fala com cada engine — para rotear a edição das engines de credencial. */
  readonly drivers?: Drivers;
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
 * literal, os valores (que estão no próprio SQL) e o ator.
 */
export class MutationService {
  readonly #repository: ConnectionsRepository;
  readonly #pools: PoolManager;
  readonly #log: QueryLogRepository;
  readonly #drivers: Drivers | undefined;

  constructor({ repository, pools, log, drivers }: MutationServiceDeps) {
    this.#repository = repository;
    this.#pools = pools;
    this.#log = log;
    this.#drivers = drivers;
  }

  async update(
    connectionId: string,
    request: RowUpdateRequest,
    ator: Ator,
  ): Promise<MutationResult<RowMutationResult>> {
    const viaDriver = await this.#viaDriver(connectionId, request.database, ator, {
      tipo: "update",
      req: request,
    });
    if (viaDriver !== null) return viaDriver;
    return this.#aplicar(connectionId, request.database, ator, request, (tipos) =>
      construirUpdate(request, tipos),
    );
  }

  async delete(
    connectionId: string,
    request: RowDeleteRequest,
    ator: Ator,
  ): Promise<MutationResult<RowMutationResult>> {
    const viaDriver = await this.#viaDriver(connectionId, request.database, ator, {
      tipo: "delete",
      req: request,
    });
    if (viaDriver !== null) return viaDriver;
    return this.#aplicar(connectionId, request.database, ator, request, (tipos) =>
      construirDelete(request, tipos),
    );
  }

  async insert(
    connectionId: string,
    request: RowInsertRequest,
    ator: Ator,
  ): Promise<MutationResult<RowMutationResult>> {
    const viaDriver = await this.#viaDriver(connectionId, request.database, ator, {
      tipo: "insert",
      req: request,
    });
    if (viaDriver !== null) return viaDriver;
    // Reusa #aplicar: um INSERT de uma linha afeta exatamente 1 (ou o Postgres
    // recusa por constraint, e o erro vai inteiro para a tela).
    //
    // `null` no alvo: INSERT não tem guarda otimista, então não precisa dos
    // tipos — e não paga a ida ao catálogo.
    return this.#aplicar(connectionId, request.database, ator, null, () =>
      construirInsert(request),
    );
  }

  /**
   * Os tipos das colunas da tabela alvo, do catálogo da conexão em uso.
   *
   * **Lido do servidor, dentro da transação** — nunca aceito da requisição. O
   * tipo é interpolado no SQL da guarda; vindo do cliente seria injeção. E
   * lido agora, não do schema em cache: cache velho daria um cast que não
   * corresponde à coluna.
   *
   * `format_type` já devolve identificador citado quando precisa, então um
   * tipo com nome hostil sai escapado (há teste que trava isso).
   *
   * ## Domínio é resolvido até o tipo base
   *
   * Se a coluna é `CREATE DOMAIN cnpj AS char(14)`, o tipo **declarado** é
   * `cnpj`, e castar o valor de volta por ele **roda o `CHECK` do domínio**.
   * Em carga legada isso é fatal: a constraint costuma entrar com `NOT VALID`
   * justamente porque parte das linhas antigas não passa — e aí a linha suja
   * não pode mais ser corrigida nem excluída, que é exatamente o defeito que
   * esta guarda foi reescrita para matar, voltando por outra porta. O mesmo
   * vale para domínio ou enum num schema sem `USAGE` para o papel da conexão:
   * ler funciona, castar dá `permission denied`.
   *
   * A guarda só precisa do ida-e-volta textual; a validação do domínio não tem
   * papel nenhum nela. O `CASE` sobre `typtypmod` preserva o comprimento (o
   * `atttypmod` de coluna de domínio é -1 — o tamanho mora no domínio), então
   * `cnpj` continua resolvendo para `character(14)` e a correção do `char(n)`
   * se mantém. Recursivo porque domínio sobre domínio é legal.
   *
   * ## Tipo que este papel não pode citar sai do mapa
   *
   * Enum ou composite num schema sem `USAGE` (extensão instalada em schema
   * próprio, tipo de infra) é **legível** — a linha aparece na tela — mas o
   * cast dá `permission denied for schema`. Emitir esse cast trocaria uma
   * guarda fraca por uma linha que não pode ser excluída, de novo. O
   * `has_schema_privilege` deixa a coluna de fora do mapa e ela cai na forma
   * antiga: menos exata, e funcionando.
   */
  static async #tiposDaTabela(
    client: PoolClient,
    schema: string,
    table: string,
  ): Promise<TiposDeColuna> {
    const res = await client.query<{ nome: string; tipo: string }>(
      `WITH RECURSIVE base AS (
         SELECT a.attname, a.atttypid AS oid, a.atttypmod AS typmod, 0 AS nivel
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2
            AND a.attnum > 0 AND NOT a.attisdropped
         UNION ALL
         SELECT b.attname, t.typbasetype,
                CASE WHEN t.typtypmod <> -1 THEN t.typtypmod ELSE b.typmod END,
                b.nivel + 1
           FROM base b
           JOIN pg_type t ON t.oid = b.oid
          WHERE t.typtype = 'd' AND b.nivel < 16
       )
       SELECT r.nome, r.tipo
         FROM (
           SELECT DISTINCT ON (b.attname)
                  b.attname AS nome, b.oid AS oid, format_type(b.oid, b.typmod) AS tipo
             FROM base b ORDER BY b.attname, b.nivel DESC
         ) r
         JOIN pg_type t ON t.oid = r.oid
         JOIN pg_namespace tn ON tn.oid = t.typnamespace
        WHERE pg_catalog.has_schema_privilege(tn.oid, 'USAGE')`,
      [schema, table],
    );
    return new Map(res.rows.map((r) => [r.nome, r.tipo]));
  }

  async #aplicar(
    connectionId: string,
    database: string,
    ator: Ator,
    alvo: { readonly schema: string; readonly table: string } | null,
    montar: (tipos: TiposDeColuna) => SqlConstruido,
  ): Promise<MutationResult<RowMutationResult>> {
    const inicio = performance.now();

    let connection;
    try {
      connection = this.#repository.resolve(connectionId, ator);
    } catch {
      return mutFail("decryption_failed");
    }
    if (connection === null) return mutFail("not_found");
    /*
     * Só o Postgres faz isto. Sem esta guarda, uma conexão MySQL faria o
     * `PoolManager` do Postgres falar protocolo de Postgres com a porta 3306,
     * e o erro seria de handshake — sem relação com a verdade, que é
     * "isto não existe aqui".
     */
    const semSuporte = exigirPostgres<never>(connection.engine, "edição de linhas");
    // `write_forbidden` pelo motivo mais forte: a engine não oferece escrita.
    if (semSuporte !== null && !semSuporte.ok) return mutFail("write_forbidden", semSuporte.detail);
    // A conexão manda: sem `write_enabled`, nem a requisição mais explícita
    // libera escrita. (O `readOnly: false` já é exigido pelo schema.) A tentativa
    // negada vai ao query_log: escrita barrada é justamente o evento que uma
    // auditoria existe para registrar. O SQL literal já traz a intenção completa.
    if (!connection.writeEnabled) {
      /*
       * Negado antes de tocar o banco — então não há catálogo para consultar, e
       * o literal registrado sai com a guarda na forma sem tipo. Nada executou:
       * o que a auditoria precisa provar (tabela, colunas, valores, ator) é
       * idêntico, e abrir conexão só para enfeitar o log de uma escrita
       * recusada seria o custo pelo lado errado.
       */
      this.#registrar(
        connectionId,
        database,
        montar(new Map()).literal,
        "error",
        "escrita negada: write_enabled desligado na conexão",
        null,
        inicio,
        ator,
      );
      return mutFail("write_forbidden");
    }

    /*
     * O SQL só fica pronto DENTRO da transação, porque a guarda depende dos
     * tipos das colunas e eles vêm do catálogo da conexão.
     *
     * A variável nasce com a forma sem tipo para que o `catch` sempre tenha um
     * literal para registrar — inclusive se a falha for a própria leitura do
     * catálogo, antes de qualquer statement.
     */
    let construido: SqlConstruido = montar(new Map());

    try {
      const rowCount = await this.#pools.withTransaction(
        connection,
        database,
        false,
        async (client) => {
          if (alvo !== null) {
            construido = montar(await MutationService.#tiposDaTabela(client, alvo.schema, alvo.table));
          }
          const res = await client.query(construido.text, construido.params);
          const rc = res.rowCount ?? 0;
          if (rc !== 1) throw new CardinalidadeError(rc);
          return rc;
        },
      );

      this.#registrar(connectionId, database, construido.literal, "ok", null, rowCount, inicio, ator);
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
          ator,
        );
        return mutFail(failure, mensagem);
      }

      const message = err instanceof Error ? err.message : "erro desconhecido";
      this.#registrar(connectionId, database, construido.literal, "error", message, null, inicio, ator);
      return mutFail("upstream_error", message);
    }
  }

  /**
   * Aplica a edição pela **credencial de escrita**, nas engines que gravam por
   * credencial (Mongo/Redis). Devolve `null` quando não é o caso — e aí o
   * chamador segue pelo caminho SQL (Postgres).
   *
   * O portão é o mesmo do SQL livre: a credencial de escrita tem que existir na
   * conexão **e** o ator ter concessão. Faltando qualquer uma, recusa com
   * `write_forbidden` e registra a tentativa — escrita barrada é o evento que a
   * auditoria existe para provar.
   */
  async #viaDriver(
    connectionId: string,
    database: string,
    ator: Ator,
    mut: MutacaoLinha,
  ): Promise<MutationResult<RowMutationResult> | null> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId, ator);
    } catch {
      return mutFail("decryption_failed");
    }
    if (connection === null) return mutFail("not_found");

    // Só as engines com `mutarLinha` roteiam por aqui (Mongo, Redis, SQLite); o
    // Postgres não a tem e segue pelo caminho SQL parametrizado.
    const driver = this.#drivers?.para(connection.engine);
    if (driver?.mutarLinha === undefined) return null;

    const inicio = performance.now();

    /*
     * O portão difere por família de garantia:
     * - credencial (Mongo/Redis): precisa da credencial de escrita presente **e**
     *   da concessão do ator;
     * - handle (SQLite): não há credencial — a escrita é abrir o arquivo r/w —,
     *   então o portão é `writeEnabled` da conexão **e** a concessão.
     * `podeEscrever` já dobra a concessão nos dois casos.
     */
    const porCredencial = gravaPorCredencialSeparada(connection.engine);
    const temAutorizacaoBase = porCredencial ? connection.hasWriteCredential : connection.writeEnabled;
    const podeGravar = temAutorizacaoBase && this.#repository.podeEscrever(connectionId, ator);
    if (!podeGravar) {
      const motivo = !temAutorizacaoBase
        ? porCredencial
          ? "esta conexão não tem credencial de escrita configurada"
          : "escrita não habilitada nesta conexão"
        : "você não tem concessão de escrita nesta conexão";
      this.#registrar(
        connectionId,
        database,
        `-- edição recusada: ${motivo}`,
        "error",
        `write_forbidden: ${motivo}`,
        null,
        inicio,
        ator,
      );
      return mutFail("write_forbidden", motivo);
    }

    try {
      const r = await driver.mutarLinha(connection, mut);
      this.#registrar(connectionId, database, r.sql, "ok", null, r.rowCount, inicio, ator);
      /*
       * `matchedCount`/`deletedCount` 0 é a guarda otimista pegando: a linha
       * mudou (ou sumiu) entre a leitura e o clique. Reporta como conflito, não
       * como sucesso silencioso — o mesmo espírito da prova de cardinalidade do
       * Postgres.
       */
      if (r.rowCount === 0 && mut.tipo !== "insert") {
        return mutFail("row_changed");
      }
      return mutOk(r);
    } catch (err: unknown) {
      const message =
        err instanceof MutacaoError ? err.message : err instanceof Error ? err.message : String(err);
      this.#registrar(connectionId, database, `-- ${mut.tipo}`, "error", message, null, inicio, ator);
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
    ator: Ator,
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
      actor: ator.id,
    });
  }
}
