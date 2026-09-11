import { splitStatements, type QueryError, type StatementResult } from "@dbee/shared";

import { executarSql, ErroLibsql, type AlvoLibsql } from "./cliente";
import { colunasDoResultado } from "./colunas";
import { paraTexto } from "./protocolo";

/**
 * Executar o SQL do usuário no libSQL, statement a statement.
 *
 * ## Não há streaming, e não há como fingir que há
 *
 * O executor do Postgres embrulha em `DECLARE … CURSOR` e busca `maxRows + 1`;
 * o do MySQL destrói o fluxo depois de `maxRows + 1` linhas. Aqui **o protocolo
 * é requisição e resposta**: o `POST /v2/pipeline` devolve o resultado inteiro
 * num JSON, e não há ponto em que parar de ler.
 *
 * Injetar `LIMIT` no SQL do usuário está fora de questão — a regra 8 proíbe
 * reescrever o SQL, e além disso mudaria o resultado de uma consulta que já tem
 * `LIMIT`, `UNION` ou `ORDER BY`. Então o corte é **na leitura**: as linhas
 * excedentes são descartadas depois de chegar, e `truncated` diz a verdade.
 *
 * Isso é um limite real desta engine, e a documentação o registra em vez de
 * escondê-lo: um `SELECT` sem `WHERE` numa tabela grande materializa a resposta
 * inteira na memória do servidor **e** na do DBee. O que existe para conter isso
 * é o limite de tempo da requisição (`timeoutMs` do alvo), que aborta o `fetch`.
 *
 * ## Cada statement é um `POST`
 *
 * O `/v2/pipeline` aceita vários numa requisição, e mesmo assim eles vão um por
 * vez. O motivo é o comportamento na falha: mandados juntos, o erro do terceiro
 * chega depois de o primeiro e o segundo já terem executado, e o DBee precisa
 * relatar **quais rodaram** — que é o contrato do `StatementResult[]` mais
 * `error.index`. Mandados um a um, a conta é exata.
 */

export interface ResultadoExecucaoLibsql {
  readonly results: StatementResult[];
  readonly error: (QueryError & { index: number }) | null;
}

/**
 * O verbo do statement, para a tela dizer "3 linhas afetadas" ou "SELECT".
 *
 * Lido do texto porque o protocolo não o informa. **Isto não decide nada sobre
 * permissão** (a regra 8 proíbe validar SQL por texto): erra e o pior que
 * acontece é um rótulo errado na tela.
 */
function comandoDe(sql: string): string | null {
  const m = /^\s*([A-Za-z]+)/.exec(sql);
  return m?.[1] === undefined ? null : m[1].toUpperCase();
}

export async function executar(
  alvo: AlvoLibsql,
  sql: string,
  maxRows: number,
): Promise<ResultadoExecucaoLibsql> {
  const statements = splitStatements(sql, "sqlite");
  const results: StatementResult[] = [];

  for (const [index, statement] of statements.entries()) {
    const inicio = performance.now();
    try {
      const [saida] = await executarSql(alvo, [{ sql: statement.sql }]);
      const brutas = saida?.rows ?? [];
      const truncated = brutas.length > maxRows;
      const usadas = truncated ? brutas.slice(0, maxRows) : brutas;
      const cols = saida?.cols ?? [];

      results.push({
        index,
        sql: statement.sql,
        columns: colunasDoResultado(cols),
        rows: usadas.map((linha) => cols.map((_, i) => paraTexto(linha[i] ?? { type: "null" }))),
        /*
         * `rowCount` é o que a operação tocou. Num `SELECT` são as linhas
         * devolvidas (antes do corte, senão a tela mostraria o corte como se
         * fosse o total); num `INSERT`/`UPDATE`/`DELETE` é o
         * `affected_row_count` do protocolo.
         */
        rowCount: cols.length > 0 ? brutas.length : (saida?.affected_row_count ?? 0),
        truncated,
        durationMs: Math.round(performance.now() - inicio),
        command: comandoDe(statement.sql),
        // Não há cursor nesta engine, e dizer `true` aqui seria a resposta
        // afirmando um mecanismo que não existe.
        viaCursor: false,
      });
    } catch (err: unknown) {
      const erro: QueryError & { index: number } = {
        code: err instanceof ErroLibsql ? (err.code ?? "libsql_error") : "libsql_error",
        message: err instanceof Error ? err.message : String(err),
        /*
         * O protocolo não devolve posição do erro dentro do statement — o
         * SQLite a tem internamente, o `sqld` não a propaga. `null` é honesto:
         * a UI destaca o statement inteiro em vez de apontar o caractere
         * errado.
         */
        position: null,
        detail: null,
        hint: null,
        index,
      };
      // Para no primeiro erro, como as outras engines: o que veio antes já
      // executou e é relatado; o que vinha depois não roda.
      return { results, error: erro };
    }
  }

  return { results, error: null };
}
