import { splitStatements } from "@dbee/shared/puro";
import type {
  DatabaseInfo,
  DatabaseSchema,
  DatabaseTree,
  Engine,
  Relation,
  RowsRequest,
  StatementResult,
  TestConnectionResult,
} from "@dbee/shared";

import type { ResolvedConnection } from "../db/connections.repo";
import { erroDeConsulta, executarUm } from "../mysql/executor";
import { introspectarArvore, introspectarCompleto, listarDatabases } from "../mysql/introspect";
import { PoolMysql } from "../mysql/pool";
import { lerLinhas, planejarLinhas } from "../mysql/rows";
import { privilegiosDeEscrita, testConnectionMysql } from "../mysql/test-connection";
import type { DriverLeitura, OpcoesExecucao, ResultadoExecucao, ResultadoLinhas } from "./tipos";

/**
 * O driver de MySQL e MariaDB, em leitura.
 *
 * Ele é fino de propósito: cada peça já foi medida e testada no seu próprio
 * arquivo em `mysql/`, e aqui só se junta o que o serviço pede ao que a engine
 * faz. Se este arquivo começar a decidir coisas, é sinal de que a decisão está
 * no lugar errado.
 */
export class DriverMysql implements DriverLeitura {
  readonly engine: Engine = "mysql";
  readonly #pool: PoolMysql;
  readonly #caCert: string | undefined;

  constructor(caCert: string | undefined) {
    this.#caCert = caCert;
    this.#pool = new PoolMysql(caCert);
  }

  /** A conexão apontada para outro database, mantendo o resto. */
  #em(conexao: ResolvedConnection, database: string): ResolvedConnection {
    return database === conexao.database ? conexao : { ...conexao, database };
  }

  async testarConexao(conexao: ResolvedConnection): Promise<TestConnectionResult> {
    return await testConnectionMysql(conexao, this.#caCert);
  }

  async listarDatabases(conexao: ResolvedConnection, database: string): Promise<DatabaseInfo[]> {
    const alvo = this.#em(conexao, database);
    return await this.#pool.usar(alvo, async (c) => ({
      valor: await listarDatabases(c, conexao.database),
      descartarConexao: false,
    }));
  }

  async arvore(conexao: ResolvedConnection, database: string): Promise<DatabaseTree> {
    const alvo = this.#em(conexao, database);
    return await this.#pool.usar(alvo, async (c) => ({
      valor: await introspectarArvore(c, database),
      descartarConexao: false,
    }));
  }

  async esquema(conexao: ResolvedConnection, database: string): Promise<DatabaseSchema> {
    const alvo = this.#em(conexao, database);
    return await this.#pool.usar(alvo, async (c) => ({
      valor: await introspectarCompleto(c, database),
      descartarConexao: false,
    }));
  }

  async linhas(
    conexao: ResolvedConnection,
    database: string,
    // O MySQL não tem nível de schema: o database já qualifica a tabela.
    _schema: string,
    relacao: Relation,
    pedido: RowsRequest,
  ): Promise<ResultadoLinhas> {
    const alvo = this.#em(conexao, database);
    // Montado antes de executar, como no Postgres: a auditoria registra o
    // comando mesmo quando a execução falha.
    const plano = planejarLinhas(relacao, database, pedido);
    return await this.#pool.usar<ResultadoLinhas>(alvo, async (c) => ({
      valor: {
        resposta: await lerLinhas(c, relacao, database, pedido),
        sql: plano.sql,
        // Já são texto ou `null` por construção (regra 10) — nada a converter.
        parametros: plano.valores,
      },
      descartarConexao: false,
    }));
  }

  async executar(conexao: ResolvedConnection, opcoes: OpcoesExecucao): Promise<ResultadoExecucao> {
    if (!opcoes.somenteLeitura) {
      /*
       * Não há modo de escrita por execução aqui. Medido: dentro de
       * `START TRANSACTION READ ONLY` o `TRUNCATE` esvazia a tabela e o
       * `CREATE USER` cria usuário — a garantia mora na credencial
       * (`docs/papeis-mysql.md`). Aceitar `false` seria a API dizendo que
       * ligou uma chave que não existe.
       */
      throw new Error(
        "o MySQL/MariaDB não tem modo de escrita por execução: a garantia é a credencial " +
          "(ver docs/papeis-mysql.md). Esta conexão executa apenas leitura.",
      );
    }

    const alvo = this.#em(conexao, opcoes.database);
    /*
     * `"mysql"` não é decoração: a leitura do Postgres não conhece `\'`, `#`
     * nem crase, e no SQL do MySQL isso põe o `;` no lugar errado — achado #9
     * da auditoria. `'O\'Brien; DROP ...'` viraria dois statements.
     */
    const statements = splitStatements(opcoes.sql, "mysql");

    return await this.#pool.usar<ResultadoExecucao>(alvo, async (c) => {
      opcoes.aoIniciar?.(PoolMysql.threadDe(c));

      const results: StatementResult[] = [];
      // Truncar deixa a conexão drenando: o pool precisa saber, e uma vez que
      // um statement truncou, a conexão não serve para os seguintes.
      let descartar = false;

      for (const [index, statement] of statements.entries()) {
        const inicio = performance.now();
        try {
          const parcial = await executarUm(c, statement.sql, opcoes.maxRows);
          results.push({
            index,
            sql: statement.sql,
            columns: parcial.columns,
            rows: parcial.rows,
            rowCount: parcial.rowCount,
            truncated: parcial.truncated,
            command: parcial.command,
            viaCursor: parcial.viaCursor,
            durationMs: Math.round(performance.now() - inicio),
          });
          if (parcial.descartarConexao) {
            // Truncou: sobrou resultado vindo pelo fio. Os statements seguintes
            // não podem usar esta conexão, e ela não volta ao pool.
            descartar = true;
            break;
          }
        } catch (err: unknown) {
          return {
            valor: { results, error: { ...erroDeConsulta(err), index } },
            // Erro no meio de um resultado: a conexão não vale a pena adivinhar.
            descartarConexao: true,
          };
        }
      }

      return { valor: { results, error: null }, descartarConexao: descartar };
    });
  }

  /**
   * Se a credencial desta conexão pode escrever, com resposta guardada.
   *
   * A consulta de privilégios é barata mas não é de graça, e a resposta só muda
   * quando alguém mexe no `GRANT` do servidor — o que não acontece entre duas
   * consultas do mesmo usuário. O cache é por conexão configurada e some no
   * `esquecer`, que é exatamente quando a credencial pode ter mudado.
   */
  readonly #credencialGrava = new Map<string, boolean>();

  async credencialGrava(conexao: ResolvedConnection): Promise<boolean> {
    const guardado = this.#credencialGrava.get(conexao.id);
    if (guardado !== undefined) return guardado;

    const grava = await this.#pool.usar(conexao, async (c) => ({
      valor: (await privilegiosDeEscrita(c)).length > 0,
      descartarConexao: false,
    }));
    this.#credencialGrava.set(conexao.id, grava);
    return grava;
  }

  async cancelar(conexao: ResolvedConnection, database: string, token: number): Promise<boolean> {
    return await this.#pool.cancelarConsulta(this.#em(conexao, database), token);
  }

  async esquecer(id: string): Promise<void> {
    // O cache de privilégio sai junto: `esquecer` é chamado quando a conexão
    // muda, e a credencial é uma das coisas que podem ter mudado.
    this.#credencialGrava.delete(id);
    await this.#pool.evict(id);
  }

  async desligar(): Promise<void> {
    await this.#pool.shutdown();
  }
}
