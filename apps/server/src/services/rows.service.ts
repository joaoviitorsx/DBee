import type { RowsRequest, RowsResponse } from "@dbee/shared";

import type { Ator } from "../lib/ator";
import type { ConnectionsRepository } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import { capacidadesDe } from "@dbee/shared/puro";

import type { Drivers } from "../driver/registro";
import { RowsError } from "../pg/rows";
import type { SchemaService } from "./schema.service";
import { type ServiceResult, fail, ok } from "./result";


export interface RowsServiceDeps {
  /** Quem sabe falar com cada engine. */
  readonly drivers?: Drivers;
  readonly repository: ConnectionsRepository;
  readonly schema: SchemaService;
  readonly log: QueryLogRepository;
}

/** Teto por valor no log. Ver `comValores`. */
const MAX_VALOR_NO_LOG = 200;

/**
 * O SQL da grade, seguido dos valores que foram ligados a ele.
 *
 * ## Por que
 *
 * O SQL da grade é parametrizado — é o que o torna não-injetável — e por isso
 * o `query_log` guardava `... WHERE "cpf" = $1` e nunca o CPF. A auditoria
 * então respondia "alguém filtrou por CPF" quando a pergunta que ela existe
 * para responder é **qual** CPF. §2.4 chama a grade de leitura de dado de
 * cliente; leitura sem o termo procurado é meia auditoria.
 *
 * ## Forma
 *
 * Vai como comentário no fim (`-- args: [...]`), não interpolado no SQL: o
 * texto do log não pode virar um comando executável se alguém um dia copiar a
 * linha e rodar. Cada valor é serializado por `JSON.stringify`, então aspas e
 * quebra de linha aparecem escapadas e um valor de múltiplas linhas não
 * quebra a leitura do log.
 *
 * `null` sai como `null` e não como `"null"` — no filtro os dois significam
 * coisas diferentes (`IS NULL` contra o texto "null").
 *
 * Valor acima de `MAX_VALOR_NO_LOG` caracteres é truncado com a marca `…(+N)`.
 * O log é para responder "quem procurou o quê", não para guardar uma cópia do
 * que foi procurado: um filtro colado com meio megabyte de texto encheria o
 * SQLite sem acrescentar nada à resposta.
 */
export function comValores(sql: string, valores: readonly (string | null)[]): string {
  if (valores.length === 0) return sql;
  const partes = valores.map((v) => {
    if (v === null) return "null";
    if (v.length <= MAX_VALOR_NO_LOG) return JSON.stringify(v);
    const sobra = v.length - MAX_VALOR_NO_LOG;
    return `${JSON.stringify(v.slice(0, MAX_VALOR_NO_LOG))}…(+${sobra})`;
  });
  return `${sql}\n-- args: [${partes.join(", ")}]`;
}

/**
 * Leitura de linhas de uma relação.
 *
 * A relação e as colunas vêm do **catálogo já introspectado**, não da
 * requisição: é isso que torna seguro montar `ORDER BY` e `WHERE` com nome de
 * coluna, que não é parametrizável em SQL.
 *
 * Roda em `BEGIN READ ONLY` com o mesmo TimeZone e `statement_timeout` da
 * conexão, e grava no `query_log` como qualquer execução — "abrir a tabela e
 * olhar" é leitura de dado de cliente e entra na auditoria igual (§2.4).
 */
export class RowsService {
  readonly #repository: ConnectionsRepository;
  readonly #schema: SchemaService;
  readonly #log: QueryLogRepository;

  readonly #drivers: Drivers | undefined;

  constructor({ repository, schema, log, drivers }: RowsServiceDeps) {
    this.#repository = repository;
    this.#schema = schema;
    this.#drivers = drivers;
    this.#log = log;
  }

  async read(
    connectionId: string,
    schemaName: string,
    tableName: string,
    request: RowsRequest,
    /**
     * Quem executou, para o `query_log` (DBee.md §2.4, §7).
     *
     * Chega como parâmetro vindo da sessão, e **não** tem valor padrão: um padrão
     * aqui seria o caminho por onde uma rota nova grava auditoria anônima sem
     * ninguém notar. Sem sessão a requisição nem chega ao serviço — o guard barra
     * antes.
     */
    ator: Ator,
  ): Promise<ServiceResult<RowsResponse>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId, ator);
    } catch {
      return fail("decryption_failed");
    }
    if (connection === null) return fail("not_found");

    const database = request.database ?? connection.database;

    // A árvore do catálogo é a fonte da verdade sobre o que existe.
    const arvore = await this.#schema.get(connectionId, database, false, ator);
    if (!arvore.ok) return arvore;

    const relation = arvore.value.schemas
      .find((s) => s.name === schemaName)
      ?.relations.find((r) => r.name === tableName);

    if (relation === undefined) {
      return fail("not_found", `${schemaName}.${tableName} não existe neste database`);
    }

    const inicio = performance.now();
    let sqlExecutado = "";
    let parametros: readonly (string | null)[] = [];

    try {
      /*
       * O driver da engine monta e executa. O SQL sobe junto porque a auditoria
       * o registra — o `query_log` sem o comando é auditoria pela metade — e
       * ele é montado antes de executar, para a falha também ficar registrada
       * com o comando que teria rodado.
       */
      if (this.#drivers === undefined) return fail("bad_request");
      const {
        resposta: parcial,
        sql,
        parametros: valores,
      } = await this.#drivers
        .para(connection.engine)
        .linhas(connection, database, schemaName, relation, request);
      sqlExecutado = sql;
      parametros = valores;

      const durationMs = Math.round(performance.now() - inicio);
      this.#log.record({
        connectionId,
        database,
        sql: comValores(sqlExecutado, parametros),
        status: "ok",
        error: null,
        rowCount: parcial.rows.length,
        durationMs,
        /*
         * A grade é leitura por construção — o SQL é montado aqui, nunca vem do
         * usuário. Mas "protegida pela transação" é outra coisa: nas engines de
         * credencial não há transação somente-leitura, e o campo tem que dizer o
         * que era verdade, não o que era a intenção.
         */
        readOnly: capacidadesDe(connection.engine)?.escopoReadOnly === "transacao",
        actor: ator.id,
      });

      return ok({ ...parcial, durationMs });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "erro desconhecido";

      this.#log.record({
        connectionId,
        database,
        sql:
          sqlExecutado === ""
            ? `${schemaName}.${tableName}`
            : comValores(sqlExecutado, parametros),
        status: "error",
        error: message,
        rowCount: null,
        durationMs: Math.round(performance.now() - inicio),
        /*
         * A grade é leitura por construção — o SQL é montado aqui, nunca vem do
         * usuário. Mas "protegida pela transação" é outra coisa: nas engines de
         * credencial não há transação somente-leitura, e o campo tem que dizer o
         * que era verdade, não o que era a intenção.
         */
        readOnly: capacidadesDe(connection.engine)?.escopoReadOnly === "transacao",
        actor: ator.id,
      });

      // Coluna inexistente ou cursor inválido é erro de entrada, não do banco.
      if (err instanceof RowsError) return fail("bad_request", message);
      return fail("upstream_error", message);
    }
  }
}
