import { MongoClient, type MongoClientOptions } from "mongodb";

import type { ResolvedConnection } from "../db/connections.repo";
import { ehMetadadoDeNuvem } from "../lib/rede";

/**
 * Falar com o MongoDB — um cache de `MongoClient`, não um pool próprio.
 *
 * ## Por que o driver, e por que a versão 6
 *
 * O projeto evita **módulo nativo** (regra 4, que quebra `bun build --compile`),
 * não driver JS puro — `mysql2` e `pg` são drivers de verdade. O `mongodb@6` é
 * JS puro e compila; o `@7` puxa `bson@7`, que chama `node:v8 isBuildingSnapshot`
 * (não implementado no Bun 1.3.14) e nem importa. Medido: `mongodb@6` conecta,
 * lê e **compila num binário** que roda. Falar o protocolo de fio (BSON binário
 * + SCRAM) à mão seria a saída do libSQL levada longe demais.
 *
 * ## Cache, não pool
 *
 * O `MongoClient` **já tem pool interno**. Abrir um por consulta jogaria fora o
 * handshake e o pool dele. Então o cache guarda um cliente por
 * `(conexão, credencial)` — leitura e escrita têm clientes distintos, chaveados
 * pelo usuário, como o pool do MySQL. `esquecer` fecha os da conexão; `desligar`
 * fecha todos.
 */
export class ClienteMongo {
  readonly #porChave = new Map<string, MongoClient>();
  readonly #caCert: string | undefined;

  constructor(caCert: string | undefined) {
    this.#caCert = caCert;
  }

  /**
   * A URI e as opções, montadas dos campos da conexão.
   *
   * `authSource` é campo próprio: o database da credencial não é o dos dados
   * (medido). Host e porta vão na URI; usuário e senha nas opções (`auth`), não
   * na URI, para nenhum caractere especial da senha precisar de escape e nunca
   * aparecer numa string logável.
   */
  #opcoes(conexao: ResolvedConnection, usuario: string, senha: string): MongoClientOptions {
    const tls = conexao.sslMode !== "disable";
    return {
      auth: { username: usuario, password: senha },
      authSource: conexao.authSource ?? "admin",
      tls,
      // `require` cifra sem autenticar; `verify-full` valida. Igual às outras.
      ...(tls
        ? {
            tlsAllowInvalidCertificates: conexao.sslMode !== "verify-full",
            tlsAllowInvalidHostnames: conexao.sslMode !== "verify-full",
            ...(this.#caCert === undefined ? {} : { ca: this.#caCert }),
          }
        : {}),
      // Sem espera longa: uma conexão morta tem que falhar rápido, não pendurar.
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      // O DBee é multiusuário; um cliente não pode monopolizar conexões.
      maxPoolSize: 4,
    };
  }

  #chave(conexao: ResolvedConnection, usuario: string): string {
    return `${conexao.id}\u0000${usuario}`;
  }

  /** O cliente conectado para uma credencial, criando e cacheando sob demanda. */
  async #cliente(conexao: ResolvedConnection, usuario: string, senha: string): Promise<MongoClient> {
    const chave = this.#chave(conexao, usuario);
    const existente = this.#porChave.get(chave);
    if (existente !== undefined) return existente;

    /*
     * Consistência com o libSQL (ADR/achado do red-team): nenhuma engine deve
     * discar para o serviço de metadado da nuvem. O Mongo fala protocolo
     * binário — o metadado (HTTP) não completa o handshake —, então o risco é
     * menor que no libSQL, mas a regra é a mesma e barata.
     */
    if (ehMetadadoDeNuvem(conexao.host)) {
      throw new Error("esse endereço é um serviço de metadado de nuvem, não um MongoDB");
    }
    const uri = `mongodb://${conexao.host}:${String(conexao.port)}`;
    const cliente = new MongoClient(uri, this.#opcoes(conexao, usuario, senha));
    await cliente.connect();
    this.#porChave.set(chave, cliente);
    return cliente;
  }

  /** O cliente de **leitura** (a credencial de sempre). */
  async leitura(conexao: ResolvedConnection): Promise<MongoClient> {
    return this.#cliente(conexao, conexao.username, conexao.password);
  }

  /**
   * O cliente de **escrita**. Estoura sem credencial de escrita — o serviço
   * barra antes, e chegar aqui sem ela é defeito.
   */
  async escrita(conexao: ResolvedConnection): Promise<MongoClient> {
    const wc = conexao.writeCredential;
    if (wc === undefined) throw new Error("escrita pedida sem credencial de escrita nesta conexão");
    return this.#cliente(conexao, wc.username, wc.password);
  }

  /** Fecha e esquece os clientes de uma conexão (ela mudou, ou saiu). */
  async esquecer(id: string): Promise<void> {
    const prefixo = `${id}\u0000`;
    const fechar: Promise<void>[] = [];
    for (const [chave, cliente] of [...this.#porChave.entries()]) {
      if (chave.startsWith(prefixo)) {
        this.#porChave.delete(chave);
        fechar.push(cliente.close().catch(() => undefined));
      }
    }
    await Promise.all(fechar);
  }

  async desligar(): Promise<void> {
    const clientes = [...this.#porChave.values()];
    this.#porChave.clear();
    await Promise.all(clientes.map((c) => c.close().catch(() => undefined)));
  }
}
