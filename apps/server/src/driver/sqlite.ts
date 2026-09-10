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
import { atualizar, excluir, inserir } from "../sqlite/mutacao";
import type {
  DriverLeitura,
  MutacaoLinha,
  OpcoesExecucao,
  ResultadoExecucao,
  ResultadoLinhas,
} from "./tipos";
import type { RowMutationResult } from "@dbee/shared";

/**
 * O driver de SQLite local, em leitura.
 *
 * O SQLite não é servidor: é um arquivo. A garantia de leitura é o **handle**
 * (aberto `readonly`), não um PRAGMA que o SQL do usuário possa desligar. E ele
 * roda **fora do event loop**, num worker (`GerenteSqlite`), porque o
 * `bun:sqlite` é síncrono e travaria o processo — medido, e a razão de esta fase
 * ter sido adiada até agora.
 *
 * O cancelamento é por **terminação do worker** (a consulta síncrona não para
 * por mensagem): o gerente rejeita a promessa em voo e mata a thread. Serve
 * tanto ao timeout quanto ao cancelamento pedido pelo usuário — por isso
 * `cancelarQuery` é `true`.
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
    /*
     * `somenteLeitura` escolhe o handle: leitura pelo readonly, escrita pelo
     * r/w. O serviço só manda `somenteLeitura: false` depois de confirmar
     * `writeEnabled` + concessão — um member sem concessão cai no handle
     * readonly, e a escrita dele falha no próprio SQLite.
     */
    /*
     * O alvo cancelável do SQLite é a **conexão** (o gerente cancela por id,
     * matando o worker). Não há PID de backend — o token é simbólico; quem
     * cancela devolve `conexao.id` implicitamente. Avisar `aoIniciar` agora faz
     * o serviço registrar a janela cancelável pela duração da execução.
     */
    opcoes.aoIniciar?.(0);
    return await executarSqlite(this.#gerente, conexao, opcoes.sql, opcoes.maxRows, !opcoes.somenteLeitura);
  }

  /**
   * Edição de linha pelo handle r/w. Diferente das engines de credencial, a
   * garantia de escrita do SQLite é o handle (não uma segunda credencial), e o
   * serviço a gateia por `writeEnabled` + concessão antes de chamar aqui.
   */
  async mutarLinha(conexao: ResolvedConnection, mut: MutacaoLinha): Promise<RowMutationResult> {
    switch (mut.tipo) {
      case "update":
        return await atualizar(this.#gerente, conexao, mut.req);
      case "delete":
        return await excluir(this.#gerente, conexao, mut.req);
      case "insert":
        return await inserir(this.#gerente, conexao, mut.req);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- cancelar é síncrono.
  async cancelar(conexao: ResolvedConnection): Promise<boolean> {
    // O alvo é a conexão, não um `token` (não há PID de backend): o gerente
    // rejeita as consultas em voo desta conexão e mata o worker — a única forma
    // de interromper o `bun:sqlite` síncrono. Coarse por conexão. Os parâmetros
    // `database`/`token` do contrato não se aplicam e são omitidos (como nos
    // drivers libSQL/Mongo/Redis, que também não cancelam por token).
    return this.#gerente.cancelar(conexao.id);
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
