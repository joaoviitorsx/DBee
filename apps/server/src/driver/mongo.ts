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
import { ClienteMongo } from "../mongo/cliente";
import {
  introspectarArvore,
  introspectarCompleto,
  listarDatabases,
  NOME_PADRAO,
} from "../mongo/introspect";
import { lerLinhas, planejarLinhas } from "../mongo/rows";
import { testConnectionMongo } from "../mongo/test-connection";
import type { DriverLeitura, ResultadoExecucao, ResultadoLinhas } from "./tipos";

/**
 * O driver de MongoDB, em leitura.
 *
 * ## Onde ele diverge das engines SQL
 *
 * O Mongo não tem SQL, então `executar` — o editor de SQL livre — **não existe**
 * nesta engine (`capacidadesDe("mongodb").sqlLivre === false`); a rota nem o
 * chama. A navegação é pela grade de documentos e pelos filtros, que o `linhas`
 * atende traduzindo os operadores fechados da grade em query do Mongo.
 *
 * Sem transação somente-leitura (como as outras de credencial), sem diagrama
 * (sem schema fixo e sem FK), sem cancelamento (o driver não expõe um id de
 * operação estável para `killOp`). Cada uma dessas é uma capacidade declarada
 * `false`, e a tela esconde o que a engine não faz.
 *
 * A escrita de documento é a fatia seguinte — leitura primeiro, como MySQL e
 * libSQL entraram.
 */
export class DriverMongo implements DriverLeitura {
  readonly engine: Engine = "mongodb";
  readonly #clientes: ClienteMongo;

  constructor(caCert: string | undefined) {
    this.#clientes = new ClienteMongo(caCert);
  }

  /** O database dos dados, com o padrão quando a conexão não deu um. */
  #db(conexao: ResolvedConnection, database: string): string {
    const escolhido = database === "" ? conexao.database : database;
    return escolhido === "" ? NOME_PADRAO : escolhido;
  }

  async testarConexao(conexao: ResolvedConnection): Promise<TestConnectionResult> {
    return await testConnectionMongo(conexao, undefined);
  }

  async listarDatabases(conexao: ResolvedConnection): Promise<DatabaseInfo[]> {
    const cliente = await this.#clientes.leitura(conexao);
    return await listarDatabases(cliente, conexao.database);
  }

  async arvore(conexao: ResolvedConnection, database: string): Promise<DatabaseTree> {
    const cliente = await this.#clientes.leitura(conexao);
    return await introspectarArvore(cliente, this.#db(conexao, database));
  }

  async esquema(conexao: ResolvedConnection, database: string): Promise<DatabaseSchema> {
    const cliente = await this.#clientes.leitura(conexao);
    return await introspectarCompleto(cliente, this.#db(conexao, database));
  }

  async linhas(
    conexao: ResolvedConnection,
    database: string,
    // O Mongo não tem nível de schema: o database qualifica a coleção.
    _schema: string,
    relacao: Relation,
    pedido: RowsRequest,
  ): Promise<ResultadoLinhas> {
    const cliente = await this.#clientes.leitura(conexao);
    const db = this.#db(conexao, database);
    const plano = planejarLinhas(relacao, pedido);
    return {
      resposta: await lerLinhas(cliente, db, relacao, pedido),
      // O "SQL" que a auditoria registra é a query do Mongo, em JSON. Não é
      // executável como SQL, mas descreve exatamente o que rodou — que é o
      // ponto da auditoria.
      sql: `db.${relacao.name}.find(${JSON.stringify(plano.filtro)})`,
      // Os valores de filtro já estão dentro do JSON acima; não há marcadores
      // posicionais como no SQL. Vazio evita duplicar no log.
      parametros: [],
    };
  }

  // Sem params: o Mongo não tem SQL, e um método pode omitir o que ignora e
  // ainda satisfazer a interface. `sqlLivre: false` faz a tela nem oferecer o
  // editor; chegar aqui é a rota chamando o que não devia.
  // eslint-disable-next-line @typescript-eslint/require-await -- o contrato é assíncrono.
  async executar(): Promise<ResultadoExecucao> {
    throw new Error("o MongoDB não tem editor de SQL livre — a navegação é pela grade e filtros");
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- o contrato é assíncrono.
  async cancelar(): Promise<boolean> {
    // `capacidadesDe("mongodb").cancelarQuery` é `false`: a tela não oferece o
    // botão. `false` aqui é a mesma resposta para quem chamar mesmo assim.
    return false;
  }

  async esquecer(id: string): Promise<void> {
    await this.#clientes.esquecer(id);
  }

  async desligar(): Promise<void> {
    await this.#clientes.desligar();
  }
}
