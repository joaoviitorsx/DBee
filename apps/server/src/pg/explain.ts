import type { PoolClient } from "pg";

import type { QueryError } from "@dbee/shared";

import { toQueryError } from "./executor";
import { TUDO_TEXTO } from "./tipos";

/** O prefixo que o DBee põe antes do SQL do usuário. Fixo — nada do cliente. */
export function prefixoExplain(analyze: boolean): string {
  return analyze ? "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " : "EXPLAIN (FORMAT JSON) ";
}

/**
 * Roda o EXPLAIN **já dentro da transação** aberta por quem chama (ADR 017).
 *
 * `queryMode: "extended"` pelo mesmo motivo do executor (§11, revisão do MCP):
 * no protocolo estendido o servidor recusa mais de um comando por Parse, então
 * `SELECT 1; COMMIT; …` não sai do modo da transação por trás do EXPLAIN.
 *
 * @param offset onde o statement começa no SQL original, para a `position`.
 */
export async function explicar(
  client: PoolClient,
  sql: string,
  offset: number,
  analyze: boolean,
  parametros: readonly (string | null)[],
): Promise<{ plano: string | null; erro: QueryError | null }> {
  const prefixo = prefixoExplain(analyze);
  try {
    const res = await client.query<(string | null)[]>({
      text: prefixo + sql,
      rowMode: "array",
      types: TUDO_TEXTO,
      queryMode: "extended",
      ...(parametros.length > 0 ? { values: [...parametros] } : {}),
    });
    return { plano: res.rows[0]?.[0] ?? null, erro: null };
  } catch (e: unknown) {
    return { plano: null, erro: toQueryError(e, prefixo.length, offset) };
  }
}
