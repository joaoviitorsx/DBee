import { engineImplementada, type Engine } from "@dbee/shared/puro";

import type { PoolManager } from "../pg/pool";
import { DriverLibsql } from "./libsql";
import { DriverMongo } from "./mongo";
import { DriverRedis } from "./redis";
import { DriverMysql } from "./mysql";
import { DriverPostgres } from "./postgres";
import type { DriverLeitura } from "./tipos";

/**
 * Qual driver atende cada engine.
 *
 * Os drivers são criados uma vez e vivem enquanto o processo viver: cada um é
 * dono do seu pool, e recriá-los por requisição abriria conexão nova a cada
 * clique.
 *
 * O de Postgres **recebe** o `PoolManager` em vez de criar o seu: ele já é
 * compartilhado com a exportação, o DDL e a mutação, e um segundo pool para o
 * mesmo servidor dobraria as conexões sem motivo.
 */
export class Drivers {
  readonly #porEngine = new Map<Engine, DriverLeitura>();

  constructor(pools: PoolManager, caCert: string | undefined) {
    const postgres = new DriverPostgres(pools, caCert);
    const mysql = new DriverMysql(caCert);

    this.#porEngine.set("postgres", postgres);
    /*
     * MySQL e MariaDB compartilham o mesmo driver. Eles divergem em coisas
     * medidas — nome da variável de timeout, tipo do JSON, `SEQUENCE`, lock de
     * leitura — e todas essas diferenças moram **dentro** dele, decididas pelo
     * sabor que a sessão descobre em `VERSION()`. Dois drivers seriam duas
     * cópias do mesmo código divergindo com o tempo.
     */
    this.#porEngine.set("mysql", mysql);
    this.#porEngine.set("mariadb", mysql);
    /*
     * O libSQL recebe o `caCert` como os outros: o `fetch` do Bun aceita `tls`
     * por requisição, e é isso que faz `verify-full` validar contra uma CA
     * própria e `require` cifrar sem validar. Sem a CA, `verify-full` só
     * funcionaria contra certificado de CA pública.
     */
    this.#porEngine.set("libsql", new DriverLibsql(caCert));
    /*
     * MongoDB. Cache de `MongoClient` próprio, como o de MySQL tem o seu pool.
     * O `caCert` vai para o TLS do cliente (o `verify-full` valida contra ele).
     */
    this.#porEngine.set("mongodb", new DriverMongo(caCert));
    /*
     * Redis. Cliente próprio via `Bun.RedisClient` (primitiva, sem dependência).
     * O `caCert` vai para o TLS do `rediss://`.
     */
    this.#porEngine.set("redis", new DriverRedis(caCert));
  }

  /**
   * O driver de uma engine.
   *
   * Lança para engine sem driver. Não é caminho alcançável pela tela — o
   * seletor só oferece as implementadas, e `POST /connections` recusa o resto —
   * mas uma conexão guardada antes de uma engine sair da lista chegaria aqui, e
   * uma mensagem clara vale mais que um `undefined` viajando.
   */
  para(engine: Engine): DriverLeitura {
    const driver = this.#porEngine.get(engine);
    if (driver === undefined) {
      throw new Error(
        `o DBee ainda não fala ${engine}` +
          (engineImplementada(engine) ? " — driver ausente para engine marcada como implementada" : ""),
      );
    }
    return driver;
  }

  /** Se existe driver para esta engine. */
  temDriver(engine: Engine): boolean {
    return this.#porEngine.has(engine);
  }

  /** Esquece as conexões de uma conexão configurada, em todos os drivers. */
  async esquecer(id: string): Promise<void> {
    // Em todos, e não só no da engine dela: a engine é imutável, mas esquecer
    // onde não há nada é barato, e depender do valor certo aqui seria depender
    // de um invariante mantido noutra camada.
    await Promise.all([...new Set(this.#porEngine.values())].map(async (d) => d.esquecer(id)));
  }

  async desligar(): Promise<void> {
    await Promise.all([...new Set(this.#porEngine.values())].map(async (d) => d.desligar()));
  }
}
