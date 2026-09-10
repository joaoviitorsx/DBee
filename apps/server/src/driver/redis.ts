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
import { atualizar, excluir, inserir } from "../redis/mutacao";
import { testConnectionRedis } from "../redis/test-connection";
import type {
  DriverLeitura,
  MutacaoLinha,
  ResultadoExecucao,
  ResultadoLinhas,
} from "./tipos";
import type { RowMutationResult } from "@dbee/shared";

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

  /**
   * Edição de chave pela credencial de **escrita**. O db numerado vem do
   * `database` do request; a chave, da PK. O serviço só chega aqui com a
   * credencial de escrita e o ator concedido.
   */
  async mutarLinha(conexao: ResolvedConnection, mut: MutacaoLinha): Promise<RowMutationResult> {
    const db = numeroDoDb(mut.req.database === "" ? "db0" : mut.req.database);
    /*
     * A escrita usa o cliente da credencial de **escrita** — a mesma conexão
     * apontada para o db, mas autenticada com o token/senha gravável. No Redis
     * a credencial é só senha; o `writeCredential.password` é o que muda.
     */
    const wc = conexao.writeCredential;
    if (wc === undefined) {
      throw new Error("escrita pedida sem credencial de escrita nesta conexão");
    }
    const conexaoEscrita: ResolvedConnection = { ...conexao, password: wc.password };
    const cliente = await this.#clientes.cliente(conexaoEscrita, db);

    switch (mut.tipo) {
      case "update":
        return await atualizar(cliente, mut.req);
      case "delete":
        return await excluir(cliente, mut.req);
      case "insert":
        return await inserir(cliente, mut.req);
    }
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
