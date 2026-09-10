import type {
  DatabaseInfo,
  DatabaseSchema,
  DatabaseTree,
  Engine,
  Relation,
  RowsRequest,
  TestConnectionResult,
} from "@dbee/shared";

import type { ResolvedConnection } from "../db/connections.repo";
import { ClienteRedis } from "../redis/cliente";
import {
  introspectarArvore,
  introspectarCompleto,
  listarDatabases,
  numeroDoDb,
} from "../redis/introspect";
import { lerLinhas, planejarLinhas } from "../redis/rows";
import { testConnectionRedis } from "../redis/test-connection";
import type { DriverLeitura, ResultadoExecucao, ResultadoLinhas } from "./tipos";

/**
 * O driver de Redis, em leitura.
 *
 * A engine mais distante do que o DBee é. O que a árvore chama de "database" é
 * o db numerado (0..N); a única "relação" de cada db é `keys`, a grade de
 * chaves navegada por `SCAN` (nunca `KEYS`, que trava o servidor).
 *
 * Sem SQL (`sqlLivre: false` — a tela nem oferece o editor), sem diagrama, sem
 * cancelamento. A garantia de somente-leitura é a ACL do usuário, como nas
 * outras engines de credencial. A escrita (SET/DEL por chave) é a fatia
 * seguinte — leitura primeiro.
 */
export class DriverRedis implements DriverLeitura {
  readonly engine: Engine = "redis";
  readonly #clientes: ClienteRedis;

  constructor(caCert: string | undefined) {
    this.#clientes = new ClienteRedis(caCert);
  }

  async testarConexao(conexao: ResolvedConnection): Promise<TestConnectionResult> {
    return await testConnectionRedis(conexao, undefined);
  }

  async listarDatabases(conexao: ResolvedConnection): Promise<DatabaseInfo[]> {
    return await listarDatabases(this.#clientes, conexao);
  }

  async arvore(conexao: ResolvedConnection, database: string): Promise<DatabaseTree> {
    return await introspectarArvore(this.#clientes, conexao, database === "" ? "db0" : database);
  }

  async esquema(conexao: ResolvedConnection, database: string): Promise<DatabaseSchema> {
    return await introspectarCompleto(this.#clientes, conexao, database === "" ? "db0" : database);
  }

  async linhas(
    conexao: ResolvedConnection,
    database: string,
    // O Redis não tem schema; o "database" é o db numerado.
    _schema: string,
    _relacao: Relation,
    pedido: RowsRequest,
  ): Promise<ResultadoLinhas> {
    const db = numeroDoDb(database === "" ? "db0" : database);
    const cliente = await this.#clientes.cliente(conexao, db);
    const plano = planejarLinhas(pedido);
    return {
      resposta: await lerLinhas(cliente, pedido),
      // A auditoria registra o comando conceitual: um SCAN com o MATCH usado.
      sql: `SCAN 0 MATCH ${plano.match} COUNT ${String(plano.limite)}`,
      parametros: [],
    };
  }

  // Redis não tem SQL. `sqlLivre: false` faz a tela nem oferecer o editor.
  // eslint-disable-next-line @typescript-eslint/require-await -- o contrato é assíncrono.
  async executar(): Promise<ResultadoExecucao> {
    throw new Error("o Redis não tem editor de SQL — a navegação é pela grade de chaves");
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- o contrato é assíncrono.
  async cancelar(): Promise<boolean> {
    // `cancelarQuery: false`: a tela não oferece o botão.
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- fecho é síncrono no cliente.
  async esquecer(id: string): Promise<void> {
    this.#clientes.esquecer(id);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- fecho é síncrono no cliente.
  async desligar(): Promise<void> {
    this.#clientes.desligar();
  }
}
