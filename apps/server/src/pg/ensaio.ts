import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

import { splitStatements, type StatementResult } from "@dbee/shared";

import { execute, toQueryError, type ExecutionOutcome } from "./executor";

/**
 * Ensaio de escrita e aplicação conferida (ADR 021).
 *
 * Roda **dentro** de uma transação `BEGIN READ WRITE` aberta por quem chama
 * (`PoolManager.withWriteDecision`). Quem decide `COMMIT` ou `ROLLBACK` é o
 * serviço, a partir do `rowCount` que o banco devolveu — nunca do texto do SQL.
 *
 * ## O portão de DML (`PREPARE`) — por que existe
 *
 * O ensaio promete "nada foi gravado". Essa promessa quebra se o próprio SQL do
 * usuário encerrar a transação: `UPDATE t …; COMMIT` grava o UPDATE antes do
 * nosso `ROLLBACK`, e `COMMIT AND CHAIN` abre uma transação nova em que o
 * `SAVEPOINT` do executor continua funcionando (a trava do `executeOne` não
 * alcança). Detectar isso depois é tarde: o dado já foi gravado.
 *
 * A trava é pedir ao **servidor** que prepare cada statement antes de
 * executá-lo: `PREPARE … AS <stmt>` só aceita `SELECT`, `INSERT`, `UPDATE`,
 * `DELETE`, `MERGE` e `VALUES`. `COMMIT`, `ROLLBACK`, `CALL`, DDL e `SET`
 * são recusados pela gramática do Postgres. Não é parser nosso nem regex
 * (regra 8): é o mesmo expediente do `DECLARE … CURSOR FOR` do executor — o
 * servidor classifica, nós só lemos se ele aceitou. Em protocolo estendido um
 * único comando por mensagem, então `x; COMMIT` também é recusado.
 *
 * Função chamada pelo DML também não encerra a transação: dentro de um bloco
 * `BEGIN`, `COMMIT` em procedimento falha com 2D000. O que escapa da transação
 * por natureza (sequência, `dblink`, `NOTIFY` não — este é transacional) está
 * nas ressalvas do ADR.
 *
 * O `SAVEPOINT` de guarda, conferido no fim, é cinto e suspensório: se algo
 * ainda assim encerrasse a transação, o `RELEASE` falha e o ensaio vira erro
 * em vez de "afetaria N linhas" mentiroso.
 */

const nome = (prefixo: string): string => `${prefixo}_${randomBytes(6).toString("hex")}`;

/** Executa o lote statement a statement, com o portão de DML em cada um. */
export async function executarConferido(
  client: PoolClient,
  sql: string,
  maxRows: number,
): Promise<ExecutionOutcome> {
  const guarda = nome("dbee_ensaio");
  await client.query(`SAVEPOINT ${guarda}`);

  const results: StatementResult[] = [];
  for (const [index, statement] of splitStatements(sql).entries()) {
    const preparado = nome("dbee_dml");
    const prefixo = `PREPARE ${preparado} AS `;
    try {
      await client.query({ text: prefixo + statement.sql, queryMode: "extended" });
    } catch (causa: unknown) {
      const erro = toQueryError(causa, prefixo.length, statement.offset);
      return {
        results,
        error: {
          ...erro,
          index,
          message:
            "o ensaio aceita só comandos DML (SELECT, INSERT, UPDATE, DELETE, MERGE, VALUES) — " +
            `o servidor recusou este statement: ${erro.message}`,
        },
      };
    }
    // Prepared statement NÃO é transacional: sobreviveria ao ROLLBACK e ficaria
    // na sessão do pool. Desaloca antes de qualquer outra coisa.
    await client.query(`DEALLOCATE ${preparado}`);

    const um = await execute(client, statement.sql, maxRows);
    // `execute` vê um statement só: reindexa e devolve a posição ao lote.
    for (const r of um.results) results.push({ ...r, index });
    if (um.error !== null) {
      return {
        results,
        error: {
          ...um.error,
          index,
          position: um.error.position === null ? null : um.error.position + statement.offset,
        },
      };
    }
  }

  // A transação ainda é a nossa? Se o SQL a tivesse encerrado, o savepoint não
  // existiria mais (3B001) ou não haveria bloco (25P01).
  await client.query(`RELEASE SAVEPOINT ${guarda}`);
  return { results, error: null };
}
