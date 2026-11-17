/**
 * Schema inteiro em texto compacto para LLM (tool MCP `describe_schema_compact`,
 * ideia I3 de `docs/ideias-comunidade.md`). Puro: recebe o catálogo já lido.
 *
 * Formato estável (uma relação por bloco, ordem do catálogo):
 *
 *   public.pedidos table ~1200
 *     id bigint NOT NULL PK
 *     cliente_id integer NOT NULL
 *     criado_em timestamptz = now()
 *     FK (cliente_id) -> public.clientes(id)
 *     IDX U pedidos_x (a, b)
 *
 * Paginação por relação: `offset` é o índice da relação, e a página para antes
 * de passar de `maxChars` (mas sempre leva pelo menos uma relação, para não
 * travar num bloco grande). `nextOffset = null` quando acabou.
 */
import type { Relation, SchemaNode } from "./schema";

export const SCHEMA_COMPACTO_MAX_CHARS = 20_000;
export const SCHEMA_COMPACTO_TETO_CHARS = 100_000;

export interface PaginaSchemaCompacto {
  readonly text: string;
  readonly totalRelations: number;
  readonly returnedRelations: number;
  readonly nextOffset: number | null;
}

/**
 * Nome (ou default) com espaço/controle sai entre aspas JSON: um identificador
 * com quebra de linha não pode forjar linhas novas no texto que o modelo lê.
 */
const n = (v: string): string => (/[\s\p{C}]/u.test(v) ? JSON.stringify(v) : v);
/** Tipo e default têm espaço legítimo ("timestamp with time zone"); só controle os quota. */
const e = (v: string): string => (/[\p{C}\u2028\u2029]/u.test(v) ? JSON.stringify(v) : v);

export function blocoRelacao(schema: string, r: Relation): string {
  const linhas = [`${n(schema)}.${n(r.name)} ${r.kind}${r.estimatedRows === null ? "" : ` ~${String(r.estimatedRows)}`}`];
  for (const c of r.columns) {
    linhas.push(
      `  ${n(c.name)} ${e(c.dataType)}${c.nullable ? "" : " NOT NULL"}${c.defaultValue === null ? "" : ` = ${e(c.defaultValue)}`}${
        c.isPrimaryKey ? " PK" : ""
      }`,
    );
  }
  for (const fk of r.foreignKeys) {
    linhas.push(
      `  FK (${fk.columns.map(n).join(", ")}) -> ${n(fk.referencedSchema)}.${n(fk.referencedTable)}(${fk.referencedColumns.map(n).join(", ")})`,
    );
  }
  for (const i of r.indexes) {
    if (i.isPrimary) continue;
    linhas.push(`  IDX${i.isUnique ? " U" : ""} ${n(i.name)} (${i.columns.map(n).join(", ")})`);
  }
  return linhas.join("\n");
}

export function formatarSchemaCompacto(
  schemas: readonly SchemaNode[],
  opcoes: { readonly schema?: string; readonly offset: number; readonly maxChars: number },
): PaginaSchemaCompacto {
  const todas = schemas
    .filter((s) => opcoes.schema === undefined || s.name === opcoes.schema)
    .flatMap((s) => s.relations.map((r) => blocoRelacao(s.name, r)));
  const blocos: string[] = [];
  let tamanho = 0;
  let i = opcoes.offset;
  for (; i < todas.length; i++) {
    const bruto = todas[i] ?? "";
    // Bloco único maior que o teto (tabela de centenas de colunas): corta.
    const b = bruto.length > opcoes.maxChars ? `${bruto.slice(0, opcoes.maxChars)}\n  …(truncado)` : bruto;
    if (blocos.length > 0 && tamanho + b.length + 2 > opcoes.maxChars) break;
    blocos.push(b);
    tamanho += b.length + 2;
  }
  return {
    text: blocos.join("\n\n"),
    totalRelations: todas.length,
    returnedRelations: blocos.length,
    nextOffset: i < todas.length ? i : null,
  };
}
