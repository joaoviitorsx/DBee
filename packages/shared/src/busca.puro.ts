/**
 * Casamento da busca global — puro, sem I/O (testado sem mock).
 *
 * Ordem: nome igual ao termo > começa com > contém; dentro de cada faixa,
 * schema e relação antes de coluna, e nome mais curto antes. Sem distinção de
 * caixa. Para no `limite + 1` para saber se truncou sem montar tudo.
 */
export interface CatalogoBuscavel {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly database: string;
  readonly schemas: readonly {
    readonly name: string;
    readonly relations: readonly {
      readonly name: string;
      readonly kind: "table" | "view" | "materialized_view" | "partitioned_table" | "foreign_table";
      readonly columns?: readonly { readonly name: string }[];
    }[];
  }[];
}

export interface HitBusca {
  readonly kind: "schema" | "relation" | "column";
  readonly connectionId: string;
  readonly connectionName: string;
  readonly database: string;
  readonly schema: string;
  readonly relation: string | null;
  readonly relationKind: CatalogoBuscavel["schemas"][number]["relations"][number]["kind"] | null;
  readonly column: string | null;
}

/** 0 = igual, 1 = prefixo, 2 = contém, -1 = não casa. */
function faixa(nome: string, termo: string): number {
  const n = nome.toLowerCase();
  if (n === termo) return 0;
  if (n.startsWith(termo)) return 1;
  return n.includes(termo) ? 2 : -1;
}

const PESO_TIPO = { schema: 0, relation: 0, column: 1 } as const;

export function buscarNoCatalogo(
  catalogos: readonly CatalogoBuscavel[],
  termoCru: string,
  limite: number,
): { hits: HitBusca[]; truncated: boolean } {
  const termo = termoCru.trim().toLowerCase();
  if (termo === "") return { hits: [], truncated: false };

  const achados: { hit: HitBusca; f: number; nome: string }[] = [];
  const base = (c: CatalogoBuscavel, schema: string) => ({
    connectionId: c.connectionId,
    connectionName: c.connectionName,
    database: c.database,
    schema,
  });

  for (const c of catalogos) {
    for (const s of c.schemas) {
      const fs = faixa(s.name, termo);
      if (fs >= 0) {
        achados.push({ f: fs, nome: s.name, hit: { ...base(c, s.name), kind: "schema", relation: null, relationKind: null, column: null } });
      }
      for (const r of s.relations) {
        const fr = faixa(r.name, termo);
        if (fr >= 0) {
          achados.push({ f: fr, nome: r.name, hit: { ...base(c, s.name), kind: "relation", relation: r.name, relationKind: r.kind, column: null } });
        }
        for (const col of r.columns ?? []) {
          const fc = faixa(col.name, termo);
          if (fc >= 0) {
            achados.push({ f: fc, nome: col.name, hit: { ...base(c, s.name), kind: "column", relation: r.name, relationKind: r.kind, column: col.name } });
          }
        }
      }
    }
  }

  achados.sort(
    (a, b) =>
      a.f - b.f ||
      PESO_TIPO[a.hit.kind] - PESO_TIPO[b.hit.kind] ||
      a.nome.length - b.nome.length ||
      a.nome.localeCompare(b.nome),
  );
  return { hits: achados.slice(0, limite).map((a) => a.hit), truncated: achados.length > limite };
}
