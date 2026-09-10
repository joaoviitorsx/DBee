import type { CancelResponse, QueryLogEntry, QueryRequest, QueryResponse } from "@dbee/shared";
import { capacidadesDe, gravaPorCredencialSeparada } from "@dbee/shared/puro";

import type { Ator } from "../lib/ator";
import type { ConnectionsRepository, ResolvedConnection } from "../db/connections.repo";
import type { QueryLogRepository } from "../db/queryLog.repo";
import type { Drivers } from "../driver/registro";
import { type ServiceResult, fail, ok } from "./result";

/** Default de `maxRows` (DBee.md §6). */
const MAX_ROWS_PADRAO = 1000;

/**
 * Ator do `query_log` enquanto não há autenticação.
 *
 * **Não é "admin".** Chamar de `admin` daria ao registro a aparência de
 * identidade sem ter identidade nenhuma — e um log de auditoria que não
 * distingue pessoas, em contexto fiscal, é pior que não ter log: dá aparência
 * de controle. `unauthenticated` diz a verdade sobre o que se sabe.
 *
 * Vira o id do usuário quando a fatia de autenticação entrar (DBee.md §7).
 */

export interface QueryServiceDeps {
  /** Quem sabe falar com cada engine. */
  readonly drivers?: Drivers;
  readonly repository: ConnectionsRepository;
  readonly log: QueryLogRepository;
}

export class QueryService {
  readonly #repository: ConnectionsRepository;
  readonly #log: QueryLogRepository;
  /**
   * Queries em execução, por `queryId`, com o backend PID e o suficiente para
   * abrir a conexão de cancelamento. Em memória, uma instância só (DBee.md §7):
   * some no restart, que é o comportamento certo — nada está rodando depois.
   */
  readonly #emExecucao = new Map<
    string,
    { readonly pid: number; readonly connection: ResolvedConnection; readonly database: string }
  >();

  readonly #drivers: Drivers | undefined;

  constructor({ repository, log, drivers }: QueryServiceDeps) {
    this.#repository = repository;
    this.#log = log;
    this.#drivers = drivers;
  }

  /**
   * Executa o SQL do usuário e **sempre** registra no `query_log`.
   *
   * `BEGIN READ WRITE` exige **as duas coisas**: `write_enabled = 1` na conexão
   * **e** `readOnly: false` explícito na requisição.
   *
   * Omitir o campo significa leitura. É deliberado: o padrão de um campo
   * ausente tem que ser o estado seguro, senão uma tela que esqueça de mandar
   * a flag ganha escrita por acidente numa conexão de produção.
   *
   * Mandar `readOnly: false` numa conexão de leitura não libera nada — a
   * proteção é da conexão, e a requisição só pode ser mais restritiva.
   */
  async run(
    connectionId: string,
    request: QueryRequest,
    /**
     * Quem executou, para o `query_log` (DBee.md §2.4, §7).
     *
     * Chega como parâmetro vindo da sessão, e **não** tem valor padrão: um padrão
     * aqui seria o caminho por onde uma rota nova grava auditoria anônima sem
     * ninguém notar. Sem sessão a requisição nem chega ao serviço — o guard barra
     * antes.
     */
    ator: Ator,
  ): Promise<ServiceResult<QueryResponse>> {
    let connection;
    try {
      connection = this.#repository.resolve(connectionId, ator);
    } catch {
      return fail("decryption_failed");
    }
    if (connection === null) return fail("not_found");

    const database = request.database ?? connection.database;
    const maxRows = request.maxRows ?? MAX_ROWS_PADRAO;

    /*
     * Gravável só quando a conexão permite **e** a requisição pede escrita — e
     * "a conexão permite" muda por engine:
     *
     * - Postgres: `writeEnabled` (que já dobra a concessão do ator no `resolve`).
     *   A escrita é o modo da transação, na mesma credencial.
     * - Credencial (MySQL/MariaDB/libSQL): existe uma **credencial de escrita**
     *   nesta conexão E o ator tem concessão. A escrita roda por ela, não por
     *   um modo de transação — é o que a fase da credencial de escrita destrava.
     */
    const separada = gravaPorCredencialSeparada(connection.engine);
    const podeGravar = separada
      ? connection.hasWriteCredential && this.#repository.podeEscrever(connectionId, ator)
      : connection.writeEnabled;
    const readOnly = !(podeGravar && request.readOnly === false);

    /*
     * Pedido de escrita explícito numa engine de credencial que **não** pode
     * ser atendido: recusa clara, em vez de rebaixar para leitura e deixar o
     * servidor negar com uma mensagem críptica ("INSERT command denied").
     *
     * Dois motivos, duas mensagens: falta a credencial de escrita na conexão,
     * ou falta a concessão do ator. Cada uma diz o que fazer.
     */
    if (separada && request.readOnly === false && !podeGravar) {
      const motivo = !connection.hasWriteCredential
        ? "esta conexão não tem credencial de escrita configurada. Para gravar numa " +
          "engine de credencial, adicione uma credencial de escrita à conexão (ver " +
          "docs/papeis-mysql.md)."
        : "você não tem concessão de escrita nesta conexão. A credencial de escrita " +
          "existe, mas escrever por ela exige a concessão — peça a um administrador.";
      this.#log.record({
        connectionId,
        database,
        sql: request.sql,
        status: "error",
        error: "write_forbidden: escrita pedida sem credencial ou sem concessão",
        rowCount: null,
        durationMs: 0,
        readOnly: false,
        actor: ator.id,
      });
      return fail("bad_request", motivo);
    }

    /*
     * O que vai para a auditoria **não** é o que a requisição pediu: é se a
     * execução estava de fato protegida.
     *
     * No Postgres as duas coisas coincidem por construção — `BEGIN READ ONLY`
     * recusa a escrita, então "pedi leitura" implica "não escreveu". Nas engines
     * cuja garantia é a credencial isso deixou de valer, e o `query_log` passou
     * a carimbar `read_only: 1` em cima de `DROP TABLE` que executou. Um log
     * assim é pior que campo ausente: quem auditar filtra por `read_only = 0`
     * para achar as alterações e não acha justamente essa.
     */
    const capacidades = capacidadesDe(connection.engine);
    const protegida = capacidades?.escopoReadOnly === "transacao";
    const readOnlyAuditado = readOnly && protegida;

    /*
     * O portão de escrita, nas engines em que ele não existe no servidor.
     *
     * No Postgres, `BEGIN READ ONLY` recusa a escrita — quem não tem concessão
     * simplesmente não consegue escrever, e o portão é o modo da transação.
     * Nas engines de credencial não há nada disso: medido, um `member` com
     * `canWrite: false` executou `INSERT` e `DROP TABLE` pelo editor de SQL, e
     * a resposta ainda dizia `readOnly: true`. O portão do DBee não era
     * atravessado — ele era contornado, porque nenhuma escrita passava por ele.
     *
     * A grade de linhas continua livre: o SQL dela é montado aqui e é leitura
     * por construção. O que precisa de portão é o **SQL livre**, e ele passa
     * quando uma das duas coisas é verdade:
     *
     *   - a credencial não escreve (verificado no servidor, não prometido); ou
     *   - o ator tem concessão de escrita naquela conexão.
     *
     * Recusar sempre mataria o uso legítimo — quem conectou com `GRANT SELECT`
     * está seguro e deve poder consultar.
     */
    if (capacidades?.escopoReadOnly === "credencial" && readOnly) {
      const recusa = await this.#recusarSqlLivreSemPortao(connectionId, connection, ator);
      if (recusa !== null) {
        this.#log.record({
          connectionId,
          database,
          sql: request.sql,
          status: "error",
          error: "write_forbidden: credencial gravável sem concessão de escrita",
          rowCount: null,
          durationMs: 0,
          readOnly: false,
          actor: ator.id,
        });
        return recusa;
      }
    }

    const inicio = performance.now();

    try {
      if (this.#drivers === undefined) return fail("bad_request");
      /*
       * O driver da engine, e não `pg/` fixo.
       *
       * O token que ele entrega em `aoIniciar` é o PID do backend no Postgres e
       * o id da thread no MySQL — quem cancela só precisa devolvê-lo. Registrar
       * sob o `queryId` faz a janela cancelável ser exatamente a da execução.
       */
      /*
       * O `finally` é de segurança, não de arrumação.
       *
       * A entrada guarda a `ResolvedConnection` — **com a senha do banco em
       * claro** — e a versão anterior só a apagava no caminho de sucesso.
       * Execução que falhasse depois do `aoIniciar` deixava a senha retida no
       * heap para sempre, e o `queryId` vem do cliente, então um laço de
       * consultas que falham fazia o mapa crescer sem teto. Nada disso é
       * serializado; é retenção de segredo em memória, que é o que importa num
       * cenário de dump do processo.
       */
      let outcome;
      try {
        outcome = await this.#drivers.para(connection.engine).executar(connection, {
          sql: request.sql,
          database,
          maxRows,
          somenteLeitura: readOnly,
          aoIniciar: (token) => {
            if (request.queryId !== undefined) {
              this.#emExecucao.set(request.queryId, { pid: token, connection, database });
            }
          },
        });
      } finally {
        if (request.queryId !== undefined) this.#emExecucao.delete(request.queryId);
      }

      const totalDurationMs = Math.round(performance.now() - inicio);
      const linhas = outcome.results.reduce((soma, r) => soma + r.rowCount, 0);
      // `57014` = "canceling statement due to user request": o cancelamento
      // pedido, não um erro de SQL. Vira status próprio no log.
      const cancelada = outcome.error !== null && outcome.error.code === "57014";

      this.#log.record({
        connectionId,
        database,
        sql: request.sql,
        status: outcome.error === null ? "ok" : cancelada ? "cancelled" : "error",
        error:
          outcome.error === null
            ? null
            : `${outcome.error.code ?? "?"}: ${outcome.error.message}`,
        rowCount: outcome.error === null ? linhas : null,
        durationMs: totalDurationMs,
        readOnly: readOnlyAuditado,
        actor: ator.id,
      });

      return ok({ ...outcome, totalDurationMs, readOnly });
    } catch (err: unknown) {
      // Falha de conexão ou de transação: o statement nem chegou a rodar. O
      // registro acontece do mesmo jeito — auditoria não pode ter buraco só
      // porque o banco estava fora do ar.
      const message = err instanceof Error ? err.message : "erro desconhecido";

      this.#log.record({
        connectionId,
        database,
        sql: request.sql,
        status: "error",
        error: message,
        rowCount: null,
        durationMs: Math.round(performance.now() - inicio),
        readOnly: readOnlyAuditado,
        actor: ator.id,
      });

      return fail("upstream_error", message);
    }
  }

  /**
   * Cancela uma query em execução pelo `queryId`.
   *
   * Não resolve conexão nem toca no `query_log`: usa o backend PID já
   * registrado por `run`, e o cancelamento faz a query original voltar com
   * `57014`, que `run` grava como `cancelled`. Se o `queryId` não está em
   * execução (já terminou, ou nunca existiu), devolve `cancelled: false` — não é
   * erro, é o cancelamento chegando tarde. O `connectionId` do caminho tem que
   * bater com o registrado: um id não impede cancelar a query de outra conexão.
   */
  /**
   * A recusa de SQL livre numa conexão de credencial gravável sem concessão.
   *
   * Devolve `null` quando pode executar. A pergunta ao servidor só acontece
   * quando o ator **não** tem concessão — quem tem, não precisa da resposta, e
   * quem não tem paga uma consulta de catálogo que fica em cache.
   */
  async #recusarSqlLivreSemPortao(
    connectionId: string,
    connection: ResolvedConnection,
    ator: Ator,
  ): Promise<ServiceResult<QueryResponse> | null> {
    if (this.#repository.podeEscrever(connectionId, ator)) return null;

    const driver = this.#drivers?.para(connection.engine);
    const pergunta = driver?.credencialGrava;
    // Driver que não sabe responder: recusar seria quebrar quem funciona hoje,
    // e liberar seria fingir. Como só engines de credencial chegam aqui e as
    // duas que existem respondem, isto é o caminho impossível — e ele libera,
    // porque a alternativa é derrubar leitura legítima por um método ausente.
    if (pergunta === undefined || driver === undefined) return null;

    let grava: boolean;
    try {
      grava = await pergunta.call(driver, connection);
    } catch {
      // Não deu para perguntar: não recusa. O aviso do teste de conexão
      // continua sendo o caminho por onde isso aparece para a pessoa.
      return null;
    }
    if (!grava) return null;

    return fail(
      "bad_request",
      "esta conexão usa uma credencial que pode escrever no banco, e nesta engine " +
        "não existe transação somente-leitura que impeça isso. Como você não tem " +
        "concessão de escrita nela, o editor de SQL está bloqueado — a grade de " +
        "linhas continua disponível. Para liberar, peça a concessão de escrita, ou " +
        "reconecte esta conexão com uma credencial de leitura (ver docs/papeis-mysql.md).",
    );
  }

  async cancelar(
    connectionId: string,
    queryId: string,
    ator: Ator,
  ): Promise<ServiceResult<CancelResponse>> {
    /*
     * Prova de acesso antes de qualquer coisa, e **404**, não `cancelled:false`.
     *
     * As duas respostas escondem a mesma quantidade de informação, mas 404 é a
     * que o resto das rotas com id dá — e a varredura de `acesso.test.ts` exige
     * uniformidade justamente para que "esta rota responde diferente" seja
     * sinal de que alguém esqueceu de resolver pelo ator.
     *
     * Não é explorável hoje: o `queryId` é um UUIDv4 gerado no cliente. Mas é
     * rota que recebe id de recurso e não provava acesso no servidor, e o dia
     * em que o `queryId` virar um contador isso é cancelamento arbitrário.
     */
    if (this.#repository.find(connectionId, ator) === null) return fail("not_found");

    const reg = this.#emExecucao.get(queryId);
    // `undefined` (já terminou) e conexão diferente caem no mesmo lugar: nada a
    // cancelar sob este id nesta conexão.
    if (reg?.connection.id !== connectionId) return ok({ cancelled: false });
    try {
      if (this.#drivers === undefined) return ok({ cancelled: false });
      const cancelled = await this.#drivers
        .para(reg.connection.engine)
        .cancelar(reg.connection, reg.database, reg.pid);
      return ok({ cancelled });
    } catch {
      return ok({ cancelled: false });
    }
  }

  /**
   * O histórico daquela conexão.
   *
   * **Exige o ator**, e essa era a falha: a rota não pedia sessão e devolvia o
   * `query_log` de qualquer conexão a qualquer conta. O id não precisava nem ser
   * adivinhado — `GET /saved-queries` é lista global por desenho e entrega o
   * `connectionId` de conexões invisíveis.
   *
   * A invariante da fase 2 estava formulada como "`resolve(id, ator)`, por onde
   * passa todo caminho que fala com o Postgres", e essa formulação deixou de
   * fora justamente a rota que lê dado sensível **sem** abrir conexão: aqui a
   * leitura é no SQLite.
   */
  history(connectionId: string, limit: number, ator: Ator): ServiceResult<QueryLogEntry[]> {
    if (this.#repository.find(connectionId, ator) === null) return fail("not_found");
    return ok(this.#log.list(limit, connectionId));
  }
}
