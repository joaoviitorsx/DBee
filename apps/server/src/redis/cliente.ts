import { RedisClient } from "bun";

import type { ResolvedConnection } from "../db/connections.repo";
import { ehMetadadoDeNuvem } from "../lib/rede";

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

  #url(conexao: ResolvedConnection, db: number, usuario: string, senha: string): string {
    const esquema = conexao.sslMode === "disable" ? "redis" : "rediss";
    /*
     * `user:senha@` quando há usuário (ACL, Redis 6+); `:senha@` quando é só a
     * senha do `requirepass`; nada quando não há credencial. Sem o usuário na
     * URL, uma conexão com usuário ACL (onde mora a garantia `+@read`) nem
     * conecta — achado do red-team.
     */
    const cred =
      senha === "" && usuario === ""
        ? ""
        : `${encodeURIComponent(usuario)}:${encodeURIComponent(senha)}@`;
    return `${esquema}://${cred}${conexao.host}:${String(conexao.port)}/${String(db)}`;
  }

  #chave(id: string, db: number, usuario: string): string {
    // O usuario entra na chave pelo mesmo motivo do Mongo/MySQL: leitura e
    // escrita usam credenciais distintas e nao podem compartilhar cliente —
    // senao a escrita cacheada serviria leitura sob a credencial gravavel, ou
    // a leitura cacheada faria a escrita falhar com NOPERM (achado do red-team).
    return `${id}\u0000${String(db)}\u0000${usuario}`;
  }

  /**
   * O cliente conectado para um db numerado e uma credencial, criando e
   * cacheando sob demanda. `usuario`/`senha` explicitos: a leitura passa os da
   * conexao; a escrita, os da credencial de escrita.
   */
  async cliente(
    conexao: ResolvedConnection,
    db: number,
    usuario: string = conexao.username,
    senha: string = conexao.password,
  ): Promise<RedisClient> {
    const chave = this.#chave(conexao.id, db, usuario);
    const existente = this.#porChave.get(chave);
    if (existente !== undefined) return existente;

    // Consistência com o libSQL: nenhuma engine disca para o metadado de nuvem.
    if (ehMetadadoDeNuvem(conexao.host)) {
      throw new Error("esse endereço é um serviço de metadado de nuvem, não um Redis");
    }

    const cliente = new RedisClient(this.#url(conexao, db, usuario, senha), {
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
