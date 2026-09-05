import { Pool, type PoolClient } from "pg";

import type { ResolvedConnection } from "../db/connections.repo";
import { sslConfigFor } from "./ssl";

/**
 * Gerência de pools (DBee.md §6).
 *
 * Um pool por `connection_id` **e database**: a mesma conexão pode apontar para
 * vários databases do cluster (`?database=X` na §5), e `pg` fixa o database na
 * criação do pool.
 *
 * `max: 5`, `idleTimeoutMillis: 30000`. Pool sem uso há mais de 10 min é
 * destruído — o app fica aberto o dia inteiro numa aba, e segurar conexão em
 * banco de produção à toa é problema de quem administra o banco.
 */
const MAX_CLIENTS = 5;
const IDLE_TIMEOUT_MS = 30_000;
const POOL_TTL_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

interface Entry {
  readonly pool: Pool;
  lastUsedAt: number;
  /**
   * Clientes emprestados agora. Um pool com empréstimo em aberto **nunca** é
   * varrido: `statement_timeout` vai até 600 s e o TTL do pool é 10 min, então
   * uma query longa expiraria o pool embaixo da própria transação.
   */
  leases: number;
  /**
   * Marcado pelo `evict` quando ainda há cliente emprestado. O pool sai do
   * mapa na hora — nenhuma requisição nova o pega — e é encerrado quando o
   * último empréstimo volta.
   */
  doomed: boolean;
}

export class PoolManager {
  /**
   * `connectionId -> database -> Entry`, aninhado em vez de chave composta.
   *
   * Uma chave `"id separador database"` obriga a casar prefixo no `evict` e
   * depende de o separador não aparecer em nenhum dos dois lados — frágil, e
   * já custou um bug: uma edição trocou o espaço por um byte NUL invisível, e
   * o `evict` passou a comparar contra outro separador. Mapa aninhado não tem
   * separador para errar.
   */
  readonly #pools = new Map<string, Map<string, Entry>>();
  readonly #caCert: string | undefined;
  #sweeper: ReturnType<typeof setInterval> | undefined;

  constructor(caCert: string | undefined) {
    this.#caCert = caCert;
  }

  /** Inicia a varredura de pools ociosos. Chamado no boot, não no construtor. */
  start(): void {
    if (this.#sweeper !== undefined) return;
    this.#sweeper = setInterval(() => { this.sweep(); }, SWEEP_INTERVAL_MS);
    // Não segura o processo vivo só por causa do timer.
    this.#sweeper.unref();
  }

  #entry(connectionId: string, database: string): Entry | undefined {
    return this.#pools.get(connectionId)?.get(database);
  }

  /** Tira um pool do mapa e o encerra. */
  #discard(connectionId: string, database: string): void {
    const byDatabase = this.#pools.get(connectionId);
    const entry = byDatabase?.get(database);
    if (byDatabase === undefined || entry === undefined) return;
    byDatabase.delete(database);
    if (byDatabase.size === 0) this.#pools.delete(connectionId);
    void entry.pool.end().catch(() => undefined);
  }

  /**
   * Devolve a **Entry**, não o `Pool`.
   *
   * Reler o mapa depois do `await connect()` contaria o empréstimo na entrada
   * errada: um `evict()` naquela janela troca a Entry, e o lease acabaria na
   * nova — deixando sem proteção justamente o pool que segura o cliente.
   */
  #acquire(connection: ResolvedConnection, database: string): Entry {
    const existing = this.#entry(connection.id, database);
    if (existing !== undefined) {
      existing.lastUsedAt = Date.now();
      return existing;
    }

    const pool = new Pool({
      host: connection.host,
      port: connection.port,
      database,
      user: connection.username,
      password: connection.password,
      ssl: sslConfigFor(connection.sslMode, this.#caCert, connection.host),
      application_name: "dbee",
      max: MAX_CLIENTS,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: 10_000,
    });

    // Um erro em cliente ocioso não pode derrubar o processo.
    pool.on("error", () => undefined);

    let byDatabase = this.#pools.get(connection.id);
    if (byDatabase === undefined) {
      byDatabase = new Map();
      this.#pools.set(connection.id, byDatabase);
    }
    const entry: Entry = { pool, lastUsedAt: Date.now(), leases: 0, doomed: false };
    byDatabase.set(database, entry);
    return entry;
  }

  /**
   * Roda `fn` dentro de uma transação read-only, com timeout e timezone da
   * conexão. Sempre `ROLLBACK`: nada aqui escreve, e rollback é mais barato que
   * commit numa transação sem escrita.
   *
   * O modo vai no `BEGIN` (ADR 001) — nunca em `SET` posterior.
   */
  async withReadOnly<T>(
    connection: ResolvedConnection,
    database: string,
    fn: (client: PoolClient) => Promise<T>,
    /**
     * `repeatable-read` quando várias consultas precisam ver o MESMO instante.
     *
     * O default do Postgres é READ COMMITTED, em que cada statement pega um
     * snapshot novo — `BEGIN READ ONLY` fixa o modo de acesso, não o
     * isolamento. A introspecção depende disso: um DDL entre a consulta de
     * relações e a de colunas produziria uma tabela com zero colunas na
     * árvore, sem erro nenhum.
     */
    isolation: "read-committed" | "repeatable-read" = "read-committed",
  ): Promise<T> {
    return this.withTransaction(connection, database, true, fn, isolation);
  }

  /**
   * Igual, com o modo explícito.
   *
   * `readOnly` decide entre `BEGIN READ ONLY` e `BEGIN READ WRITE` — nunca
   * `BEGIN` pelado, para o modo estar sempre visível no código e no log
   * (ADR 001). No modo escrita a transação é **commitada**; no de leitura,
   * revertida.
   */
  async withTransaction<T>(
    connection: ResolvedConnection,
    database: string,
    readOnly: boolean,
    fn: (client: PoolClient) => Promise<T>,
    isolation: "read-committed" | "repeatable-read" = "read-committed",
  ): Promise<T> {
    // A Entry é capturada ANTES do await: o empréstimo tem que ser contado no
    // pool que de fato vai emprestar o cliente.
    const entry = this.#acquire(connection, database);
    entry.leases++;

    let client: PoolClient;
    try {
      client = await entry.pool.connect();
    } catch (err: unknown) {
      entry.leases--;
      // O pool entra no mapa antes de a conexão ser tentada. Se ela falhar,
      // ele ficaria lá por 10 min até o sweep — e `?database=` é string livre,
      // então uma requisição por nome inventado acumularia um pool morto (e
      // mais uma cópia da senha na heap) para cada nome.
      this.#discard(connection.id, database);
      throw err;
    }

    // Marcado quando o ROLLBACK falha: o cliente é descartado em vez de
    // reciclado.
    let sujo = false;

    try {
      const modo = readOnly ? "READ ONLY" : "READ WRITE";
      await client.query(
        isolation === "repeatable-read"
          ? `BEGIN ${modo} ISOLATION LEVEL REPEATABLE READ`
          : `BEGIN ${modo}`,
      );
      // `SET` é comando utilitário e NÃO aceita placeholder — `SET x = $1` dá
      // erro de sintaxe. `set_config(nome, valor, is_local)` é a forma
      // parametrizável, e `is_local = true` equivale a `SET LOCAL`.
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        String(connection.statementTimeoutMs),
      ]);
      // TimeZone fixado por sessão: sem isso o mesmo timestamptz aparece
      // diferente conforme o servidor (DBee.md §6).
      await client.query("SELECT set_config('TimeZone', $1, true)", [connection.timezone]);
      const result = await fn(client);
      // Escrita commita; leitura reverte, que é mais barato numa transação sem
      // escrita e deixa explícito que nada foi gravado.
      await client.query(readOnly ? "ROLLBACK" : "COMMIT");
      return result;
    } catch (err: unknown) {
      // Se o ROLLBACK também falhar, o cliente pode voltar ao pool ainda dentro
      // de uma transação — e um BEGIN aninhado é só um WARNING no Postgres, o
      // que faria o `BEGIN READ ONLY` da requisição seguinte virar no-op.
      // Passar o erro ao release manda o pool DESTRUIR o cliente.
      const rollbackOk = await client
        .query("ROLLBACK")
        .then(() => true)
        .catch(() => false);
      sujo = !rollbackOk;
      throw err;
    } finally {
      // Contabilidade PRIMEIRO: se `release()` lançar (o pg-pool lança em
      // double release), o lease ficaria preso e o pool nunca mais seria
      // varrido.
      entry.leases--;
      // Reconta o ocioso a partir da devolução, não do início da transação.
      entry.lastUsedAt = Date.now();
      try {
        client.release(sujo || undefined);
      } finally {
        // Pool marcado para morrer durante a transação: encerra agora que o
        // último cliente voltou.
        if (entry.doomed && entry.leases === 0) {
          void entry.pool.end().catch(() => undefined);
        }
      }
    }
  }

  /**
   * Destrói pools parados há mais de 10 min.
   *
   * Pool com cliente emprestado é pulado, por mais antigo que seja o
   * `lastUsedAt`: transação aberta não pode perder o pool embaixo dela. Ele
   * será varrido na passada seguinte, depois do `release`.
   */
  sweep(now = Date.now()): number {
    let closed = 0;
    for (const [connectionId, byDatabase] of this.#pools) {
      for (const [database, entry] of byDatabase) {
        if (entry.leases > 0) continue;
        if (now - entry.lastUsedAt < POOL_TTL_MS) continue;
        byDatabase.delete(database);
        void entry.pool.end().catch(() => undefined);
        closed++;
      }
      if (byDatabase.size === 0) this.#pools.delete(connectionId);
    }
    return closed;
  }

  /** Descarta os pools de uma conexão — usar quando ela é editada ou apagada. */
  evict(connectionId: string): void {
    const byDatabase = this.#pools.get(connectionId);
    if (byDatabase === undefined) return;
    this.#pools.delete(connectionId);

    for (const entry of byDatabase.values()) {
      if (entry.leases > 0) {
        // Encerrar aqui abandonaria quem está na fila do `connect()` — o
        // pedido só falharia 10 s depois, por connectionTimeoutMillis, e a
        // rota culparia o Postgres com um 502. Sai do mapa agora e morre
        // quando o último cliente voltar.
        entry.doomed = true;
        continue;
      }
      void entry.pool.end().catch(() => undefined);
    }
  }

  /** Total de pools abertos, somando todos os databases de todas as conexões. */
  get size(): number {
    let total = 0;
    for (const byDatabase of this.#pools.values()) total += byDatabase.size;
    return total;
  }

  /** Empréstimos em aberto — para teste e diagnóstico. */
  get activeLeases(): number {
    let total = 0;
    for (const byDatabase of this.#pools.values()) {
      for (const entry of byDatabase.values()) total += entry.leases;
    }
    return total;
  }

  /** Injeta um pool para teste, sem abrir conexão de verdade. */
  seedForTest(
    connectionId: string,
    database: string,
    pool: Pool,
    lastUsedAt: number,
    leases = 0,
  ): void {
    let byDatabase = this.#pools.get(connectionId);
    if (byDatabase === undefined) {
      byDatabase = new Map();
      this.#pools.set(connectionId, byDatabase);
    }
    byDatabase.set(database, { pool, lastUsedAt, leases, doomed: false });
  }

  async shutdown(): Promise<void> {
    if (this.#sweeper !== undefined) {
      clearInterval(this.#sweeper);
      // Sem isto um `start()` posterior vira no-op silencioso.
      this.#sweeper = undefined;
    }
    const pools = [...this.#pools.values()].flatMap((byDatabase) =>
      [...byDatabase.values()].map((entry) => entry.pool),
    );
    this.#pools.clear();
    await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
  }
}
