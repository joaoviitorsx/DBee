import type { Connection } from "mysql2/promise";

import type { QueryError, ResultColumn } from "@dbee/shared";

import { colunasDoResultado } from "./colunas";
import { paraTexto, type CampoMysql } from "./tipos";

/**
 * Executar **um** statement no MySQL/MariaDB, sem trazer a tabela inteira.
 *
 * ## Por que streaming, e não `LIMIT`
 *
 * O executor do Postgres embrulha o SQL num `DECLARE … CURSOR` e busca
 * `maxRows + 1` linhas: uma a mais revela truncamento sem contar a tabela. O
 * MySQL **não tem cursor** fora de procedure, e a regra 8 proíbe reescrever o
 * SQL do usuário — injetar `LIMIT` seria exatamente isso, e mudaria o
 * resultado de uma consulta que já tem `LIMIT` ou `UNION`.
 *
 * O equivalente é o streaming do `mysql2`: as linhas chegam uma a uma e o
 * fluxo é destruído assim que há `maxRows + 1`. Medido contra uma tabela de
 * 262 144 linhas:
 *
 *   buffered  — 262 144 linhas em 188 ms, **+75 MB** de heap
 *   streaming — parou em 101 linhas em **6 ms**
 *
 * ## Parar cedo custa a conexão — e por que isso é o certo
 *
 * O `destroy` **não** faz o servidor parar: o driver drena o resto antes de
 * aceitar a próxima consulta. Medido contra um `JOIN` de 67 milhões de linhas:
 * parar em 101 linhas leva 11 ms, e a **consulta seguinte na mesma conexão leva
 * 15,2 s**. Numa conexão de pool isso é uma conexão inutilizável por tempo
 * indeterminado — o pool passa fome por causa de um `SELECT` sem `WHERE`.
 *
 * `KILL QUERY` mata o dreno, mas deixa a conexão fechada: a consulta seguinte
 * volta `Query execution was interrupted` e a próxima,
 * `connection is in closed state`.
 *
 * Medido o que resolve os dois: **fechar a conexão**. Um segundo e meio depois
 * de fechar, a thread sumiu do `information_schema.PROCESSLIST` — com ou sem
 * `KILL`. O servidor para quando o cliente vai embora.
 *
 * Por isso o resultado carrega `descartarConexao`. Quando o executor trunca,
 * ele leu parte de um resultado que continua vindo, e a única saída barata é
 * jogar a conexão fora. Reabrir custa milissegundos; segurar uma conexão
 * bloqueada custa o pool inteiro.
 *
 * Isso não substitui o limite de tempo de `sessao.ts` nem o `KILL QUERY` do
 * cancelamento: são três coisas diferentes — memória, tempo e vontade do
 * usuário.
 */

/** O que o executor devolve por statement, antes de virar `StatementResult`. */
export interface ParcialMysql {
  readonly columns: ResultColumn[];
  readonly rows: (string | null)[][];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly command: string | null;
  readonly viaCursor: false;
  /**
   * Quantas linhas o executor de fato puxou do fio.
   *
   * É o número que **prova** que ele parou cedo: nunca passa de
   * `maxRows + 1`, por maior que seja a tabela do outro lado. Existe porque a
   * propriedade "não traz o resultado inteiro" não é observável de fora — duas
   * tentativas de medi-la por memória e por tempo falharam, uma medindo a
   * própria folga e outra medindo o otimizador do servidor.
   */
  readonly linhasLidas: number;
  /**
   * A conexão precisa ser **fechada**, não devolvida ao pool.
   *
   * `true` quando o executor parou no meio de um resultado que o servidor
   * continua produzindo. Devolver essa conexão ao pool a entrega bloqueada
   * para o próximo uso — medido, 15,2 s num `JOIN` de 67 milhões de linhas.
   * Está no tipo, e não num comentário, para o pool não poder esquecer.
   */
  readonly descartarConexao: boolean;
}

interface ErroMysql {
  readonly code?: unknown;
  readonly errno?: unknown;
  readonly sqlMessage?: unknown;
  readonly message?: unknown;
}

/**
 * Erro do servidor no formato que a UI espera.
 *
 * `position` é sempre `null`: o protocolo do MySQL **não manda a posição** do
 * erro no texto, ao contrário do Postgres. Inventar uma posição para o editor
 * destacar seria destacar o lugar errado, o que é pior que não destacar.
 */
export function erroDeConsulta(err: unknown): QueryError {
  if (typeof err !== "object" || err === null) {
    return { code: null, message: String(err), position: null, detail: null, hint: null };
  }
  const e = err as ErroMysql;
  const codigo =
    typeof e.code === "string" ? e.code : typeof e.errno === "number" ? String(e.errno) : null;
  const mensagem =
    typeof e.sqlMessage === "string"
      ? e.sqlMessage
      : typeof e.message === "string"
        ? e.message
        : "erro desconhecido";
  return { code: codigo, message: mensagem, position: null, detail: null, hint: null };
}

/**
 * A conexão de eventos por dentro da de promessas.
 *
 * O `mysql2/promise` não expõe streaming; o wrapper guarda a conexão de
 * callbacks em `.connection`, e é ela que tem `query(...).stream()`. É a forma
 * documentada pelo próprio driver, e é o preço de não trazer a tabela inteira
 * para a memória.
 */
interface ConsultaStream {
  on: (evento: string, ouvinte: (dado: unknown) => void) => void;
  stream: () => NodeJS.ReadableStream & { destroy: () => void };
}
interface ConexaoBruta {
  query: (sql: string) => ConsultaStream;
}

function bruta(conexao: Connection): ConexaoBruta {
  return (conexao as unknown as { connection: ConexaoBruta }).connection;
}

export async function executarUm(
  conexao: Connection,
  sql: string,
  maxRows: number,
): Promise<ParcialMysql> {
  const consulta = bruta(conexao).query(sql);

  let campos: CampoMysql[] | undefined;
  consulta.on("fields", (f: unknown) => {
    if (Array.isArray(f)) campos = f as CampoMysql[];
  });

  const brutas: unknown[] = [];
  let cabecalho: { affectedRows?: number } | undefined;
  let falha: unknown;

  await new Promise<void>((resolver) => {
    const fluxo = consulta.stream();
    fluxo.on("data", (dado: unknown) => {
      if (Array.isArray(dado)) {
        brutas.push(dado);
        // Uma linha a mais que o pedido revela truncamento sem contar a tabela.
        if (brutas.length > maxRows) {
          fluxo.destroy();
          resolver();
        }
        return;
      }
      // Statement sem conjunto de resultado (SET, DDL, INSERT): vem um
      // ResultSetHeader em vez de linha.
      cabecalho = dado as { affectedRows?: number };
    });
    fluxo.on("error", (e: unknown) => {
      falha = e;
      resolver();
    });
    fluxo.on("end", resolver);
  });

  if (falha !== undefined) {
    /*
     * O erro do `mysql2` é relançado inteiro, porque `erroDeConsulta` lê dele o
     * `code`, o `errno` e o `sqlMessage`. Embrulhar num `Error` genérico
     * perderia justamente o que a UI mostra.
     */
    if (falha instanceof Error) throw falha;
    // Não-Error no fluxo é teórico; `erroDeConsulta` já sabe descrever qualquer
    // coisa, então ele é quem produz o texto em vez de um `String(...)` que
    // viraria "[object Object]".
    throw new Error(erroDeConsulta(falha).message);
  }

  /*
   * Sem `fields` não houve conjunto de resultado. `command` fica `null` porque
   * o protocolo do MySQL **não carrega o rótulo do comando** que o Postgres
   * manda ("SELECT", "UPDATE"): devolver um rótulo aqui seria inventá-lo.
   */
  if (campos === undefined) {
    return {
      columns: [],
      rows: [],
      rowCount: cabecalho?.affectedRows ?? 0,
      truncated: false,
      command: null,
      viaCursor: false,
      linhasLidas: 0,
      descartarConexao: false,
    };
  }

  const truncated = brutas.length > maxRows;
  const usadas = truncated ? brutas.slice(0, maxRows) : brutas;
  const colunas = campos;

  const rows = usadas.map((linha) =>
    (linha as (Buffer | null)[]).map((celula, i) => {
      const campo = colunas[i];
      return campo === undefined ? null : paraTexto(celula, campo);
    }),
  );

  return {
    columns: colunasDoResultado(colunas),
    rows,
    rowCount: rows.length,
    truncated,
    // Houve conjunto de resultado: foi leitura. É o mesmo que o executor do
    // Postgres faz quando passa por cursor.
    command: "SELECT",
    // Streaming não é cursor. Chamar de cursor afirmaria um mecanismo que o
    // MySQL não tem fora de procedure.
    viaCursor: false,
    linhasLidas: brutas.length,
    // Truncou: sobrou resultado vindo pelo fio, e a conexão não serve mais.
    descartarConexao: truncated,
  };
}
