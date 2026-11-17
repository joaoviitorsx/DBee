import type { RelationKind, RowFilter, ValueSearchHit } from "@dbee/shared";

/**
 * Lógica pura da tela "Buscar valor no banco" (ADR 023). Sem I/O.
 */

/** Tabelas por pedido. Pequeno para o progresso andar por tabela e o cancelar valer logo. */
export const TABELAS_POR_LOTE = 5;

/** Só o que tem linhas próprias: view e partição já são cobertas pela origem. */
const KINDS_BUSCAVEIS: ReadonlySet<RelationKind> = new Set<RelationKind>(["table", "partitioned_table"]);
export const ehBuscavel = (kind: RelationKind): boolean => KINDS_BUSCAVEIS.has(kind);

export function emLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

export interface GrupoColuna {
  readonly column: string;
  readonly hits: readonly ValueSearchHit[];
}
export interface GrupoTabela {
  readonly schema: string;
  readonly table: string;
  readonly colunas: readonly GrupoColuna[];
  readonly total: number;
}

/** Agrupa por tabela e, dentro dela, por coluna, na ordem em que chegaram. */
export function agruparHits(hits: readonly ValueSearchHit[]): GrupoTabela[] {
  const tabelas = new Map<string, { schema: string; table: string; colunas: Map<string, ValueSearchHit[]> }>();
  for (const h of hits) {
    const chave = JSON.stringify([h.schema, h.table]);
    let tab = tabelas.get(chave);
    if (tab === undefined) {
      tab = { schema: h.schema, table: h.table, colunas: new Map() };
      tabelas.set(chave, tab);
    }
    const lista = tab.colunas.get(h.column) ?? [];
    lista.push(h);
    tab.colunas.set(h.column, lista);
  }
  return [...tabelas.values()].map((t) => {
    const colunas = [...t.colunas.entries()].map(([column, hs]) => ({ column, hits: hs }));
    return { schema: t.schema, table: t.table, colunas, total: colunas.reduce((n, c) => n + c.hits.length, 0) };
  });
}

/** PK da ocorrência → filtros da aba Dados (igualdade; `null` vira `isNull`). */
export function filtrosDaPk(pk: Readonly<Record<string, string | null>>): RowFilter[] {
  return Object.entries(pk).map(([column, value]) =>
    value === null ? { column, operator: "isNull" } : { column, operator: "eq", value },
  );
}

/** Rótulo curto da PK: `id=7, tenant=a`. */
export const rotuloPk = (pk: Readonly<Record<string, string | null>>): string =>
  Object.entries(pk).map(([k, v]) => `${k}=${v ?? "NULL"}`).join(", ");
