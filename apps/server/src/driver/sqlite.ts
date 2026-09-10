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
import { GerenteSqlite, validarCaminho } from "../sqlite/gerente";
import {
  introspectarArvore,
  introspectarCompleto,
  listarDatabases,
} from "../sqlite/introspect";
import { executar as executarSqlite, lerLinhas } from "../sqlite/rows";
import type { DriverLeitura, OpcoesExecucao, ResultadoExecucao, ResultadoLinhas } from "./tipos";

/**
 * O driver de SQLite local, em leitura.
 *
 * O SQLite não é servidor: é um arquivo. A garantia de leitura é o **handle**
 * (aberto `readonly`), não um PRAGMA que o SQL do usuário possa desligar. E ele
 * roda **fora do event loop**, num worker (`GerenteSqlite`), porque o
 * `bun:sqlite` é síncrono e travaria o processo — medido, e a razão de esta fase
 * ter sido adiada até agora.
 *
 * Sem cancelamento por sinal (a consulta síncrona não é interrompível por
 * mensagem); o que existe é o **timeout por terminação do worker**, dentro do
 * gerente. `cancelarQuery` é `false`.
 */
export class DriverSqlite implements DriverLeitura {
  readonly engine: Engine = "sqlite";
  readonly #gerente = new GerenteSqlite();

  async testarConexao(conexao: ResolvedConnection): Promise<TestConnectionResult> {
    const inicio = performance.now();
    try {
      // Valida o caminho antes de abrir (travessia de diretório), e prova que o
      // arquivo é um SQLite legível com uma consulta ao `sqlite_version()`.
      validarCaminho(conexao.filePath ?? "");
      const r = await this.#gerente.consulta(conexao, "SELECT sqlite_version() AS v", [], 1);
      const versao = r.rows[0]?.[0] ?? "desconhecida";
      return {
        ok: true,
        serverVersion: `SQLite ${versao} (local)`,
        durationMs: Math.round(performance.now() - inicio),
        // O handle é readonly: não há credencial gravável que avisar. A escrita
        // no SQLite local é fatia futura (abrir r/w sob `writeEnabled`).
        warnings: [],
      };
    } catch (err: unknown) {
      return {
        ok: false,
        code: null,
        message: err instanceof Error ? err.message : String(err),
        durationMs: Math.round(performance.now() - inicio),
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- o contrato é assíncrono; a lista é local.
  async listarDatabases(conexao: ResolvedConnection): Promise<DatabaseInfo[]> {
    return listarDatabases(conexao);
  }

  async arvore(conexao: ResolvedConnection): Promise<DatabaseTree> {
    return await introspectarArvore(this.#gerente, conexao);
  }

  async esquema(conexao: ResolvedConnection): Promise<DatabaseSchema> {
    return await introspectarCompleto(this.#gerente, conexao);
  }

  async linhas(
    conexao: ResolvedConnection,
    _database: string,
    _schema: string,
    relacao: Relation,
    pedido: RowsRequest,
  ): Promise<ResultadoLinhas> {
    const { resposta, sql, parametros } = await lerLinhas(this.#gerente, conexao, relacao, pedido);
    return { resposta, sql, parametros };
  }

  async executar(conexao: ResolvedConnection, opcoes: OpcoesExecucao): Promise<ResultadoExecucao> {
    // Só leitura: o arquivo é aberto readonly, e o SQLite recusa escrita no
    // próprio servidor. `somenteLeitura: false` não muda isso — não há modo de
    // escrita no v1.
    return await executarSqlite(this.#gerente, conexao, opcoes.sql, opcoes.maxRows);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- o contrato é assíncrono.
  async cancelar(): Promise<boolean> {
    // Sem cancelamento por sinal; o timeout do gerente mata o worker.
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- terminar o worker é síncrono.
  async esquecer(id: string): Promise<void> {
    this.#gerente.esquecer(id);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- idem.
  async desligar(): Promise<void> {
    this.#gerente.desligar();
  }
}
