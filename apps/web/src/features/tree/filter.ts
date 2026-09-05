import type { DatabaseTree, RelationTree, SchemaTreeNode } from "@dbee/shared";

/**
 * Filtro da árvore por nome (DBee.md §9, trazido da v0.3 para a v0.1).
 *
 * Com dois ou três schemas de cliente a árvore passa de cem nós, e sem busca
 * vira rolagem. Casa em schema e em relação, sem diferenciar acento nem caixa —
 * quem digita "producao" espera achar "produção".
 */

/** Minúsculas e sem diacrítico. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function matches(needle: string, haystack: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

export interface FilteredSchema {
  readonly node: SchemaTreeNode;
  /** `true` quando o próprio nome do schema casou: mostra tudo dentro dele. */
  readonly schemaMatched: boolean;
  readonly relations: readonly RelationTree[];
}

/**
 * Filtra a árvore de um database.
 *
 * Schema que casa aparece inteiro — se você buscou "vendas", quer ver o que tem
 * em vendas, não só as tabelas com "vendas" no nome. Schema que não casa
 * aparece só com as relações que casaram, e some se nenhuma casar.
 */
export function filterSchema(tree: DatabaseTree, query: string): FilteredSchema[] {
  const termo = query.trim();
  if (termo === "") {
    return tree.schemas.map((node) => ({ node, schemaMatched: true, relations: node.relations }));
  }

  return tree.schemas.flatMap((node): FilteredSchema[] => {
    if (matches(termo, node.name)) {
      return [{ node, schemaMatched: true, relations: node.relations }];
    }
    const relations = node.relations.filter((rel) => matches(termo, rel.name));
    return relations.length === 0 ? [] : [{ node, schemaMatched: false, relations }];
  });
}

/** Quantas relações sobraram — usado para o rótulo de "nada encontrado". */
export function countRelations(filtered: readonly FilteredSchema[]): number {
  return filtered.reduce((total, s) => total + s.relations.length, 0);
}
