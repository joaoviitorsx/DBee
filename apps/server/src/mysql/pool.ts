import mysql, { type Connection } from "mysql2/promise";

import type { ResolvedConnection } from "../db/connections.repo";
import { ehRecusa, sslMysqlPara } from "./conexao";
import {
  SQL_SEM_NO_BACKSLASH_ESCAPES,
  ehFusoDesconhecido,
  saborDaVersao,
  sqlDeFusoPorDeslocamento,
  sqlDeFusoPorNome,
  sqlDeTimeout,
  type Sabor,
} from "./sessao";

/**
 * As conexões MySQL/MariaDB do DBee.
 *
 * ## Por que não o pool do `mysql2`
 *
 * O `mysql2` tem pool próprio, e ele **não serve aqui**. A configuração de
 * sessão do DBee é assíncrona — descobrir o sabor por `VERSION()`, aplicar o
 * limite de tempo com o nome de variável certo, aplicar o fuso com queda para
 * deslocamento numérico. O pool do `mysql2` avisa a conexão nova pelo evento
 * `connection`, e **não espera** o ouvinte: em `lib/base/pool.js` o
 * `this.emit('connection', …)` é seguido na linha seguinte por
 * `cb(null, connection)`. A primeira consulta do usuário correria com o `SET`
 * de fuso, e às vezes ganharia — datas erradas de forma intermitente, que é o
 * pior tipo de defeito.
 *
 * Aqui a conexão só entra em circulação **depois** que a sessão está pronta.
 *
 * ## Descartar não é acidente
 *
 * `usar` decide entre devolver e fechar a partir do que a tarefa devolve. Isso
 * existe porque parar no meio de um resultado grande deixa a conexão bloqueada
 * enquanto o driver drena — medido em `executor.ts`, 15,2 s. Devolver essa
 * conexão ao pool é entregar ao próximo usuário uma conexão inutilizável, e
 * confiar em quem chama para lembrar disso é confiar demais.
 */

/** Quantas conexões vivas o DBee mantém por conexão configurada. */
const MAXIMO_POR_CONEXAO = 4;

/** O que uma tarefa devolve: o resultado, e se a conexão ainda serve. */
export interface Resultado<T> {
  readonly valor: T;
  readonly descartarConexao: boolean;
}

interface Viva {
  readonly conexao: Connection;
  readonly sabor: Sabor;
  /**
   * O grupo de onde ela saiu.
   *
   * Guardado para o descarte poder ser **verificado**: depois de um `evict` o
   * grupo é outro objeto, e uma conexão em uso que voltasse seria devolvida a
   * um pool que já não deveria tê-la — falando com o servidor antigo, que é o
   * que o `evict` existe para impedir.
   */
  readonly grupo: Grupo;
}

interface Grupo {
  /**
   * Conexão **e** database.
   *
   * A mesma conexão configurada pode ser aberta em vários databases, e a sessão
   * de cada uma já está apontada para o seu — reusar uma no outro daria a
   * árvore do database errado. O `evict` continua sendo por conexão: quando ela
   * muda, todos os databases dela vão junto.
   */
  readonly chave: string;
  readonly id: string;
  readonly ociosas: Viva[];
  /** Vivas no total, ociosas ou em uso — o que o teto limita. */
  vivas: number;
  /** Quem espera por uma **vaga**, não por uma conexão específica. */
  readonly espera: (() => void)[];
}

export class PoolMysql {
  readonly #grupos = new Map<string, Grupo>();
  readonly #caCert: string | undefined;

  constructor(caCert: string | undefined) {
    this.#caCert = caCert;
  }

  /**
   * Roda uma tarefa com uma conexão pronta, e devolve ou fecha conforme o que
   * a tarefa disser.
   *
   * A conexão também é fechada quando a tarefa **lança**: um erro no meio de um
   * resultado deixa a conexão num estado que não vale a pena adivinhar.
   */
  async usar<T>(
    conexao: ResolvedConnection,
    tarefa: (c: Connection) => Promise<Resultado<T>>,
  ): Promise<T> {
    const viva = await this.#adquirir(conexao);
    try {
      const r = await tarefa(viva.conexao);
      if (r.descartarConexao) {
        await this.#fechar(viva);
      } else {
        this.#devolver(viva);
      }
      return r.valor;
    } catch (erro) {
      await this.#fechar(viva);
      throw erro;
    }
  }

  /** O sabor do servidor de uma conexão, sem executar tarefa nenhuma. */
  async sabor(conexao: ResolvedConnection): Promise<Sabor> {
    const viva = await this.#adquirir(conexao);
    this.#devolver(viva);
    return viva.sabor;
  }

  /** Quantas conexões vivas existem para esta conexão e database. Para teste. */
  vivas(conexao: ResolvedConnection): number {
    return this.#grupos.get(PoolMysql.chaveDe(conexao))?.vivas ?? 0;
  }

  /**
   * Esquece as conexões de uma conexão configurada.
   *
   * Chamado quando ela muda: host, credencial, limite de tempo e fuso já foram
   * aplicados às sessões vivas, e continuar usando-as seria falar com o
   * servidor antigo com as regras antigas. As que estão **em uso** são fechadas
   * quando voltarem, pela verificação de grupo em `#devolver`.
   */
  async evict(id: string): Promise<void> {
    // Todos os databases desta conexão, e não só um: o que mudou foi a conexão.
    const alvos = [...this.#grupos.values()].filter((g) => g.id === id);
    const fechando: Promise<unknown>[] = [];
    for (const grupo of alvos) {
      this.#grupos.delete(grupo.chave);
      // Quem esperava vaga neste grupo tenta de novo e cai num grupo novo.
      for (const acordar of grupo.espera.splice(0)) acordar();
      for (const v of grupo.ociosas.splice(0)) fechando.push(v.conexao.end().catch(() => undefined));
    }
    await Promise.all(fechando);
  }

  /** Fecha tudo de um database específico. */
  async evictDatabase(conexao: ResolvedConnection): Promise<void> {
    const chave = PoolMysql.chaveDe(conexao);
    const grupo = this.#grupos.get(chave);
    if (grupo === undefined) return;
    this.#grupos.delete(chave);
    for (const acordar of grupo.espera.splice(0)) acordar();
    await Promise.all(grupo.ociosas.splice(0).map(async (v) => v.conexao.end().catch(() => undefined)));
  }

  /**
   * O id da thread de uma conexão — o que o `KILL QUERY` endereça.
   *
   * É o equivalente do PID do backend no Postgres. O `mysql2/promise` o guarda
   * na conexão de callbacks que embrulha.
   */
  static threadDe(conexao: Connection): number {
    return (conexao as unknown as { connection: { threadId: number } }).connection.threadId;
  }

  /**
   * Cancela a consulta que roda numa thread, por uma conexão à parte.
   *
   * `KILL QUERY` mata **a consulta**, não a sessão — é o que corresponde ao
   * `pg_cancel_backend` do lado Postgres, e não ao `pg_terminate_backend`.
   *
   * Medido (`docs/papeis-mysql.md`): funciona com a credencial restrita, sem
   * privilégio `PROCESS`, desde que a thread seja **do mesmo usuário**. É o que
   * torna o cancelamento viável na engine cuja garantia é a credencial.
   *
   * Devolve `false` em vez de lançar quando a thread não existe ou não é dela:
   * cancelar o que já terminou é o caso comum — a pessoa clica em cancelar
   * enquanto a consulta responde — e não é erro.
   */
  async cancelarConsulta(conexao: ResolvedConnection, thread: number): Promise<boolean> {
    const ssl = sslMysqlPara(conexao.sslMode, this.#caCert, conexao.host);
    if (ehRecusa(ssl)) throw new Error(ssl.motivo);

    const c = await mysql.createConnection({
      host: conexao.host,
      port: conexao.port,
      database: conexao.database,
      user: conexao.username,
      password: conexao.password,
      ...(ssl.ssl === false ? {} : { ssl: ssl.ssl }),
      connectTimeout: 5000,
    });
    try {
      // O número vem de `threadDe`, nunca do usuário, e `KILL` não aceita
      // placeholder. `Number.isInteger` é a trava que impede qualquer outra
      // coisa de chegar à concatenação.
      if (!Number.isInteger(thread) || thread <= 0) return false;
      await c.query(`KILL QUERY ${String(thread)}`);
      return true;
    } catch {
      // Thread inexistente (1094) ou de outro dono (1095): não há o que
      // cancelar, e isso não é falha do cancelamento.
      return false;
    } finally {
      await c.end().catch(() => undefined);
    }
  }

  async shutdown(): Promise<void> {
    const grupos = [...this.#grupos.values()];
    this.#grupos.clear();
    const fechando: Promise<unknown>[] = [];
    for (const grupo of grupos) {
      for (const acordar of grupo.espera.splice(0)) acordar();
      for (const v of grupo.ociosas.splice(0)) fechando.push(v.conexao.end().catch(() => undefined));
    }
    await Promise.all(fechando);
  }

  static chaveDe(conexao: ResolvedConnection): string {
    // `\u0000` como separador: não aparece em id nem em nome de database, então
    // não há como duas conexões diferentes colidirem numa chave só.
    return `${conexao.id}\u0000${conexao.database}`;
  }

  #grupo(conexao: ResolvedConnection): Grupo {
    const chave = PoolMysql.chaveDe(conexao);
    const existente = this.#grupos.get(chave);
    if (existente !== undefined) return existente;
    const novo: Grupo = { chave, id: conexao.id, ociosas: [], vivas: 0, espera: [] };
    this.#grupos.set(chave, novo);
    return novo;
  }

  /** Acorda um esperador, se houver. Ele reavalia tudo do zero. */
  #acordar(grupo: Grupo): void {
    grupo.espera.shift()?.();
  }

  async #adquirir(conexao: ResolvedConnection): Promise<Viva> {
    for (;;) {
      // Relê o grupo a cada volta: um `evict` no meio da espera troca o objeto,
      // e continuar com o antigo contaria vagas que não existem mais.
      const grupo = this.#grupo(conexao);

      const ociosa = grupo.ociosas.pop();
      if (ociosa !== undefined) return ociosa;

      if (grupo.vivas < MAXIMO_POR_CONEXAO) {
        grupo.vivas += 1;
        try {
          const { conexao: c, sabor } = await this.#abrirCrua(conexao);
          return { conexao: c, sabor, grupo };
        } catch (erro) {
          grupo.vivas -= 1;
          // A vaga que eu não usei volta para quem está esperando.
          this.#acordar(grupo);
          throw erro;
        }
      }

      await new Promise<void>((resolver) => grupo.espera.push(resolver));
    }
  }

  #devolver(viva: Viva): void {
    const { grupo } = viva;
    if (this.#grupos.get(grupo.chave) !== grupo) {
      // O grupo foi descartado enquanto esta conexão estava em uso: ela não
      // volta ao pool, some.
      grupo.vivas -= 1;
      void viva.conexao.end().catch(() => undefined);
      return;
    }
    grupo.ociosas.push(viva);
    this.#acordar(grupo);
  }

  async #fechar(viva: Viva): Promise<void> {
    const { grupo } = viva;
    grupo.vivas -= 1;
    await viva.conexao.end().catch(() => undefined);
    // A vaga liberada acorda quem espera, que então abre a sua própria conexão.
    if (this.#grupos.get(grupo.chave) === grupo) this.#acordar(grupo);
  }

  /** Abre e prepara, sem mexer na contabilidade do grupo. */
  async #abrirCrua(conexao: ResolvedConnection): Promise<{ conexao: Connection; sabor: Sabor }> {
    const ssl = sslMysqlPara(conexao.sslMode, this.#caCert, conexao.host);
    if (ehRecusa(ssl)) throw new Error(ssl.motivo);

    const c = await mysql.createConnection({
      host: conexao.host,
      port: conexao.port,
      database: conexao.database,
      user: conexao.username,
      password: conexao.password,
      ...(ssl.ssl === false ? {} : { ssl: ssl.ssl }),
      connectTimeout: 10_000,
      // O contrato do driver, num lugar só: linhas em array e células em bytes
      // crus, que é o que `tipos.ts` espera para cumprir a regra 10.
      rowsAsArray: true,
      typeCast: (campo) => campo.buffer(),
    });

    try {
      const sabor = await this.#prepararSessao(c, conexao);
      return { conexao: c, sabor };
    } catch (erro) {
      await c.end().catch(() => undefined);
      throw erro;
    }
  }

  /** Sabor, limite de tempo e fuso — antes de a conexão ver a primeira consulta. */
  async #prepararSessao(c: Connection, conexao: ResolvedConnection): Promise<Sabor> {
    const [linhas] = await c.query<mysql.RowDataPacket[]>("SELECT VERSION()");
    const bruto = (linhas as unknown as (Buffer | null)[][])[0]?.[0];
    const sabor = saborDaVersao(bruto?.toString("utf8") ?? "");

    /*
     * Primeiro de todos: o escape do driver depende disso ser verdade.
     *
     * Com `NO_BACKSLASH_ESCAPES` no servidor, o `?` do `mysql2` — que é
     * interpolação no cliente, não placeholder — produz SQL injetável. Medido.
     * Ver `sessao.ts`.
     */
    await c.query(SQL_SEM_NO_BACKSLASH_ESCAPES);

    await c.query(sqlDeTimeout(sabor, conexao.statementTimeoutMs));

    try {
      await c.query(sqlDeFusoPorNome(conexao.timezone));
    } catch (erro) {
      // Servidor sem as tabelas de fuso: cai para o deslocamento numérico. Só
      // este erro; qualquer outro sobe, porque calar aqui deixaria a sessão no
      // fuso do servidor e as datas erradas em silêncio.
      if (!ehFusoDesconhecido(erro)) throw erro;
      await c.query(sqlDeFusoPorDeslocamento(conexao.timezone));
    }

    return sabor;
  }
}
