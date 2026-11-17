import type { DryRunResponse } from "@dbee/shared";

/**
 * O que vai em `expectedRowCounts` no aplicar (ADR 021): o `rowCount` de cada
 * statement, na ordem. `null` quando não há o que aplicar — o ensaio falhou
 * num statement (o servidor parou ali, a lista está incompleta) ou não rodou
 * nada. Aplicar com a lista incompleta divergiria sempre pela contagem.
 */
export function contagensEsperadas(ensaio: Pick<DryRunResponse, "results" | "error">): number[] | null {
  if (ensaio.error !== null || ensaio.results.length === 0) return null;
  return ensaio.results.map((r) => r.rowCount);
}
