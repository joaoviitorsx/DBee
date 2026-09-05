import type { DatabaseSchema } from "@dbee/shared";
import type { Completion } from "@codemirror/autocomplete";

/**
 * Traduz a árvore de schema no `SQLNamespace` que o `@codemirror/lang-sql`
 * consome (conferido no ATRITO: transformação pura, sem rota nova).
 *
 * ## Por que qualificado E não-qualificado
 *
 * O Postgres resolve `notas` por `search_path`, mas o editor não conhece o
 * `search_path` da sessão. Então cada tabela entra em **dois lugares**:
 * `schema.tabela` (sempre certo) e no topo, sob o schema padrão, para
 * `SELECT * FROM not…` completar sem obrigar a digitar `fiscal.` antes. O
 * `defaultSchema` do editor decide qual topo é esse.
 *
 * ## O detalhe que evita o erro que o usuário citou
 *
 * Tabelas de nome parecido em schemas diferentes (`fiscal.notas`,
 * `arquivo.notas`) ficam ambíguas no topo. Por isso cada completon carrega o
 * schema em `detail`: a lista mostra `notas — fiscal` e `notas — arquivo`, e a
 * pessoa escolhe a certa em vez de adivinhar.
 */

/** Tipos de completion, para o ícone que o CodeMirror desenha. */
const TIPO_RELACAO: Record<string, Completion["type"]> = {
  table: "type",
  view: "type",
  materialized_view: "type",
  partitioned_table: "type",
  foreign_table: "type",
};

interface NamespaceObjeto {
  [nome: string]: SQLNamespaceValor;
}
type SQLNamespaceValor =
  | NamespaceObjeto
  | { self: Completion; children: SQLNamespaceValor }
  | readonly (Completion | string)[];

export interface SchemaCompletion {
  readonly schema: SQLNamespaceValor;
  /** O schema onde as tabelas também aparecem sem qualificar. */
  readonly defaultSchema: string;
}

/** As colunas de uma relação viram a lista de completions daquele nível. */
function colunasDe(
  colunas: readonly { name: string; dataType: string; isPrimaryKey: boolean }[],
): readonly Completion[] {
  return colunas.map((c) => ({
    label: c.name,
    type: c.isPrimaryKey ? "keyword" : "property",
    // O tipo real vira a legenda da sugestão — é o que separa `valor numeric`
    // de `valor text` quando os dois existem em tabelas diferentes.
    detail: c.isPrimaryKey ? `${c.dataType} · PK` : c.dataType,
  }));
}

/**
 * Escolhe o schema padrão do editor.
 *
 * `public` quando existe — é o `search_path` da esmagadora maioria dos bancos.
 * Senão, o primeiro schema com relações, para o topo não ficar vazio num banco
 * que não usa `public`.
 */
function escolherDefault(schema: DatabaseSchema): string {
  if (schema.schemas.some((s) => s.name === "public")) return "public";
  return schema.schemas.find((s) => s.relations.length > 0)?.name ?? "public";
}

export function construirCompletion(schema: DatabaseSchema): SchemaCompletion {
  const defaultSchema = escolherDefault(schema);
  // `Object.create(null)`: uma tabela ou schema chamado `__proto__` ou
  // `constructor` num objeto literal invocaria o setter de protótipo — a
  // tabela sumiria do autocomplete e o proto do namespace mudaria. Sem
  // protótipo, qualquer nome é chave comum.
  const ns = Object.create(null) as NamespaceObjeto;

  for (const s of schema.schemas) {
    const dentroDoSchema = Object.create(null) as NamespaceObjeto;

    for (const rel of s.relations) {
      const completions = colunasDe(rel.columns);
      const self: Completion = {
        label: rel.name,
        type: TIPO_RELACAO[rel.kind] ?? "type",
        // Qual schema, para desambiguar nomes iguais em schemas diferentes.
        detail: s.name,
      };

      // `schema.relacao` — o caminho sempre válido.
      dentroDoSchema[rel.name] = { self, children: completions };

      // No topo, sob o schema padrão, para completar sem qualificar. Não
      // sobrescreve: a primeira relação com aquele nome vence, e o caminho
      // qualificado cobre as demais.
      if (s.name === defaultSchema && !Object.hasOwn(ns, rel.name)) {
        ns[rel.name] = { self, children: completions };
      }
    }

    ns[s.name] = dentroDoSchema;
  }

  return { schema: ns, defaultSchema };
}
