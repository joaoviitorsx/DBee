import { RedisClient } from "bun";

import type { ResolvedConnection } from "../db/connections.repo";

/**
 * Falar com o Redis pela **primitiva do Bun** (`Bun.RedisClient`), sem dependência.
 *
 * A regra 3 manda preferir a primitiva do Bun a um pacote, e aqui ela existe e
 * basta: `RedisClient` fala RESP, tem pool interno e um `send(cmd, args)` que
 * cobre qualquer comando. Medido: conecta, faz `SCAN`/`TYPE`/`HGETALL` e
 * **compila num binário** que roda (1 módulo — é embutido). Não há `ioredis` no
 * `package.json`, e é assim que fica.
 *
 * ## Cache por conexão **e por db**
 *
 * O Redis tem bancos numerados (0..N), e o db é escolhido com `SELECT` **na
 * conexão** — é estado de sessão, como o database do MySQL. Então o cache
 * chaveia por `(conexão, db)`: cada db numerado tem seu cliente, já apontado, e
 * uma consulta ao db 3 nunca pega um cliente parado no db 0. O db vai na URL
 * (`redis://host:porta/3`), que o `RedisClient` respeita no connect.
 */
export class ClienteRedis {
  readonly #porChave = new Map<string, RedisClient>();
  readonly #caCert: string | undefined;

  constructor(caCert: string | undefined) {
    this.#caCert = caCert;
  }

  #url(conexao: ResolvedConnection, db: number): string {
    const esquema = conexao.sslMode === "disable" ? "redis" : "rediss";
    const auth = conexao.password === "" ? "" : `:${encodeURIComponent(conexao.password)}@`;
    return `${esquema}://${auth}${conexao.host}:${String(conexao.port)}/${String(db)}`;
  }

  #chave(id: string, db: number): string {
    return `${id}\u0000${String(db)}`;
  }

  /** O cliente conectado para um db numerado, criando e cacheando sob demanda. */
  async cliente(conexao: ResolvedConnection, db: number): Promise<RedisClient> {
    const chave = this.#chave(conexao.id, db);
    const existente = this.#porChave.get(chave);
    if (existente !== undefined) return existente;

    const cliente = new RedisClient(this.#url(conexao, db), {
      // Uma conexão morta tem que falhar rápido, não pendurar a requisição.
      connectionTimeout: 8000,
      // `rediss://` já liga TLS; a CA própria entra aqui quando há uma.
      ...(conexao.sslMode !== "disable" && this.#caCert !== undefined
        ? { tls: { ca: this.#caCert } }
        : {}),
    });
    await cliente.connect();
    this.#porChave.set(chave, cliente);
    return cliente;
  }

  /** Fecha e esquece os clientes de uma conexão (todos os dbs dela). */
  esquecer(id: string): void {
    const prefixo = `${id}\u0000`;
    for (const [chave, cliente] of [...this.#porChave.entries()]) {
      if (chave.startsWith(prefixo)) {
        this.#porChave.delete(chave);
        cliente.close();
      }
    }
  }

  desligar(): void {
    for (const cliente of this.#porChave.values()) cliente.close();
    this.#porChave.clear();
  }
}
