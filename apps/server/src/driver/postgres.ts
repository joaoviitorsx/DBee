import type { DatabaseInfo, DatabaseTree, Engine, TestConnectionResult } from "@dbee/shared";

import type { ResolvedConnection } from "../db/connections.repo";
import { execute } from "../pg/executor";
import { introspectTree, listDatabases } from "../pg/introspect";
import type { PoolManager } from "../pg/pool";
import { testConnection } from "../pg/test-connection";
import type { DriverLeitura, OpcoesExecucao, ResultadoExecucao } from "./tipos";

/**
 * O driver de PostgreSQL, em leitura.
 *
 * Adaptador puro: cada método delega para a função que sempre existiu em
 * `pg/`. **Nada de comportamento novo** — é o que torna esta fatia verificável,
 * porque a suíte inteira do Postgres continua passando sem alteração.
 *
 * O `PoolManager` vem de fora em vez de ser criado aqui: ele já é compartilhado
 * com os serviços que fazem mais que ler (exportação, DDL, mutação), e ter dois
 * pools para o mesmo servidor dobraria as conexões sem motivo.
 */
export class DriverPostgres implements DriverLeitura {
  readonly engine: Engine = "postgres";
  readonly #pools: PoolManager;
  readonly #caCert: string | undefined;

  constructor(pools: PoolManager, caCert: string | undefined) {
    this.#pools = pools;
    this.#caCert = caCert;
  }

  async testarConexao(conexao: ResolvedConnection): Promise<TestConnectionResult> {
    return await testConnection(conexao, this.#caCert);
  }

  async listarDatabases(conexao: ResolvedConnection, database: string): Promise<DatabaseInfo[]> {
    return await this.#pools.withReadOnly(conexao, database, async (client) =>
      listDatabases(client, conexao.database),
    );
  }

  async arvore(conexao: ResolvedConnection, database: string): Promise<DatabaseTree> {
    return await this.#pools.withReadOnly(conexao, database, async (client) =>
      introspectTree(client, database),
    );
  }

  async executar(conexao: ResolvedConnection, opcoes: OpcoesExecucao): Promise<ResultadoExecucao> {
    return await this.#pools.withTransaction(
      conexao,
      opcoes.database,
      opcoes.somenteLeitura,
      async (client) => {
        // O PID do backend está disponível assim que o cliente conecta, e é o
        // que o `pg_cancel_backend` endereça.
        opcoes.aoIniciar?.((client as unknown as { processID: number }).processID);
        return await execute(client, opcoes.sql, opcoes.maxRows);
      },
    );
  }

  async cancelar(conexao: ResolvedConnection, database: string, token: number): Promise<boolean> {
    return await this.#pools.cancelBackend(conexao, database, token);
  }

  async esquecer(id: string): Promise<void> {
    // O `PoolManager` do Postgres é dono de mais coisas que este driver, então
    // quem o desliga é quem o criou. Aqui só o esquecimento por conexão.
    this.#pools.evict(id);
    await Promise.resolve();
  }

  async desligar(): Promise<void> {
    // Deliberadamente sem `shutdown`: o `PoolManager` é compartilhado, e
    // desligá-lo daqui derrubaria exportação, DDL e mutação junto.
    await Promise.resolve();
  }
}
