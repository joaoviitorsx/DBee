import type { PoolClient } from "pg";

import type { ColumnStatsResponse, Relation, RowFilter } from "@dbee/shared";

import { RowsError } from "../driver/erros";
import { Parametros, cite, condicaoFiltro } from "./rows";
import { TUDO_TEXTO } from "./tipos";

/** Teto da estatística: é um clique no cabeçalho, não um relatório. */
export const STATS_TIMEOUT_MS = 5000;

/**
 * Monta as três consultas. Coluna e filtros conferidos contra o catálogo
 * (`relation`); valores do filtro por `$n` — o mesmo construtor da aba Dados.
 */
export function planStats(
  relation: Relation,
  schema: string,
  coluna: string,
  filtros: readonly RowFilter[],
): { contagem: string; extremos: string; top: string; valores: (string | null)[] } {
  const tipos = new Map(relation.columns.map((c) => [c.name, c.dataType]));
  const tipoDe = (nome: string): string => {
    const t = tipos.get(nome);
    if (t === undefined) throw new RowsError("unknown_column", `a coluna "${nome}" não existe em ${relation.name}`);
    return t;
  };
  tipoDe(coluna);
  const params = new Parametros();
  const onde = filtros.map((f) => condicaoFiltro(f.column, tipoDe(f.column), f, params));
  const alvo = `${cite(schema)}.${cite(relation.name)}${onde.length > 0 ? ` WHERE ${onde.join(" AND ")}` : ""}`;
  const c = cite(coluna);
  return {
    contagem: `SELECT count(*)::text, count(*) FILTER (WHERE ${c} IS NULL)::text, count(DISTINCT ${c})::text FROM ${alvo}`,
    extremos: `SELECT min(${c})::text, max(${c})::text FROM ${alvo}`,
    top: `SELECT ${c}::text, count(*)::text FROM ${alvo} GROUP BY ${c} ORDER BY count(*) DESC, 1 LIMIT 5`,
    valores: params.valores,
  };
}

/**
 * Roda dentro da transação READ ONLY de quem chama. Mín./máx. e top em
 * SAVEPOINT: tipo sem ordem ou sem igualdade (json, point) não derruba a
 * contagem — só deixa aquele pedaço vazio.
 */
export async function columnStats(
  client: PoolClient,
  plano: ReturnType<typeof planStats>,
): Promise<Omit<ColumnStatsResponse, "durationMs">> {
  await client.query("SELECT set_config('statement_timeout', $1, true)", [String(STATS_TIMEOUT_MS)]);
  const q = (text: string) =>
    client.query<(string | null)[]>({ text, values: plano.valores, rowMode: "array", types: TUDO_TEXTO });

  const cont = (await q(plano.contagem)).rows[0] ?? ["0", "0", "0"];
  const opcional = async <T>(text: string, ler: (rows: (string | null)[][]) => T, vazio: T): Promise<T> => {
    await client.query("SAVEPOINT dbee_stats");
    try {
      const r = ler((await q(text)).rows);
      await client.query("RELEASE SAVEPOINT dbee_stats");
      return r;
    } catch (e: unknown) {
      await client.query("ROLLBACK TO SAVEPOINT dbee_stats");
      // Tempo esgotado não é "tipo sem ordem": sobe como erro.
      if ((e as { code?: unknown }).code === "57014") throw e;
      return vazio;
    }
  };
  const [min, max] = await opcional(plano.extremos, (r) => [r[0]?.[0] ?? null, r[0]?.[1] ?? null], [null, null]);
  const top = await opcional(
    plano.top,
    (r) => r.map((l) => ({ value: l[0] ?? null, count: l[1] ?? "0" })),
    [] as { value: string | null; count: string }[],
  );
  return { total: cont[0] ?? "0", nulls: cont[1] ?? "0", distinct: cont[2] ?? "0", min, max, top };
}
