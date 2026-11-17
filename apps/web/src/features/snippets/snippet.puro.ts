import { nomearParametros, splitStatements, type DialetoSql } from "@dbee/shared/puro";

/**
 * O que fazer com o SQL antes de executar, quanto a variáveis `:nome` (ADR 019).
 *
 * - `sem`: nenhuma variável — executa como está.
 * - `variaveis`: Postgres, um statement — pedir valores e mandar `$n` + params.
 * - `recusa`: variáveis fora do que o servidor aceita (outra engine, ou mais
 *   de um statement: os `$n` valem por statement). Recusar aqui, com o motivo,
 *   em vez de mandar e colher um 400 genérico.
 *
 * Só olha variáveis no dialeto Postgres: em MySQL/SQLite `:x` não é sintaxe
 * do DBee, e a varredura é a do Postgres — mas o caso "colou um snippet de
 * time numa conexão MySQL" precisa da recusa clara, então ela também roda lá.
 */
export type PreparoSnippet =
  | { readonly tipo: "sem" }
  | { readonly tipo: "variaveis"; readonly sql: string; readonly nomes: readonly string[] }
  | { readonly tipo: "recusa"; readonly motivo: "engine" | "varios" };

export function prepararSnippet(sql: string, dialeto: DialetoSql): PreparoSnippet {
  const { sql: convertido, nomes } = nomearParametros(sql);
  if (nomes.length === 0) return { tipo: "sem" };
  if (dialeto !== "postgres") return { tipo: "recusa", motivo: "engine" };
  if (splitStatements(sql, dialeto).length > 1) return { tipo: "recusa", motivo: "varios" };
  return { tipo: "variaveis", sql: convertido, nomes };
}
