import type { SearchHit, SearchHitKind } from "@dbee/shared";

/**
 * Agrupa os hits da busca global por tipo (F8, paleta Cmd+K).
 *
 * A ordem dos grupos é a da intenção mais comum — quem abre a paleta quase
 * sempre quer uma tabela —, e dentro do grupo vale a ordem do servidor. O
 * índice plano é o que as setas percorrem: grupos são só cabeçalho visual.
 */
const ORDEM: readonly SearchHitKind[] = ["relation", "column", "schema"];

export interface GrupoBusca {
  readonly kind: SearchHitKind;
  /** Índice plano do primeiro item deste grupo. */
  readonly inicio: number;
  readonly hits: readonly SearchHit[];
}

export function agrupar(hits: readonly SearchHit[]): { grupos: readonly GrupoBusca[]; planos: readonly SearchHit[] } {
  const grupos: GrupoBusca[] = [];
  const planos: SearchHit[] = [];
  for (const kind of ORDEM) {
    const doTipo = hits.filter((h) => h.kind === kind);
    if (doTipo.length === 0) continue;
    grupos.push({ kind, inicio: planos.length, hits: doTipo });
    planos.push(...doTipo);
  }
  return { grupos, planos };
}

/** Nome principal do hit: o caminho até ele dentro do database. */
export function rotuloDoHit(h: SearchHit): string {
  return [h.schema, h.relation, h.column].filter((p): p is string => p !== null).join(".");
}

/** Índice seguinte/anterior dando a volta (setas na lista). */
export function mover(atual: number, total: number, passo: 1 | -1): number {
  if (total === 0) return 0;
  return (atual + passo + total) % total;
}
