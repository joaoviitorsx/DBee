import type { FilterOperator, RowFilter } from "@dbee/shared";

/**
 * Links compartilháveis (ADR 020). Só identificadores no hash — nunca SQL livre,
 * nunca estado no servidor. Abrir um link **não executa nada**: a tabela faz a
 * mesma leitura READ ONLY de um clique, a query salva só preenche o editor.
 *
 *   /#c/<connId>/t/<schema>/<tabela>?db=<database>&f=<filtros>&o=<coluna>&d=<asc|desc>
 *   /#q/<savedQueryId>
 */

export type LinkDbee =
  | {
      readonly tipo: "tabela";
      readonly connectionId: string;
      readonly database: string | null;
      readonly schema: string;
      readonly tabela: string;
      readonly filtros: readonly RowFilter[];
      readonly ordem: { readonly column: string; readonly direction: "asc" | "desc" } | null;
    }
  | { readonly tipo: "salva"; readonly id: string };

const OPERADORES = [
  "eq", "ne", "lt", "lte", "gt", "gte", "contains", "startsWith", "isNull", "isNotNull", "in",
] as const satisfies readonly FilterOperator[];
// Trava de compilação: se o shared ganhar operador novo, isto deixa de compilar.
type _Faltando = Exclude<FilterOperator, (typeof OPERADORES)[number]>;
export const _exaustivo: [_Faltando] extends [never] ? true : false = true;

const ehOperador = (v: unknown): v is FilterOperator =>
  typeof v === "string" && (OPERADORES as readonly string[]).includes(v);

/**
 * Filtros vindos de fora (URL, localStorage) passam por aqui. O servidor
 * revalida tudo contra o catálogo; isto só garante a forma, para um link
 * adulterado virar "sem filtro" em vez de exceção na montagem.
 */
export function filtrosValidos(v: unknown): RowFilter[] | null {
  if (!Array.isArray(v)) return null;
  const saida: RowFilter[] = [];
  for (const f of v) {
    if (typeof f !== "object" || f === null) return null;
    const { column, operator, value, values } = f as Record<string, unknown>;
    if (typeof column !== "string" || column === "" || !ehOperador(operator)) return null;
    if (value !== undefined && typeof value !== "string") return null;
    if (values !== undefined && (!Array.isArray(values) || !values.every((x) => typeof x === "string"))) return null;
    saida.push({
      column,
      operator,
      ...(typeof value === "string" ? { value } : {}),
      ...(Array.isArray(values) ? { values } : {}),
    });
  }
  return saida;
}

const seg = (s: string): string => encodeURIComponent(s);

export function linkDeTabela(alvo: {
  connectionId: string;
  database: string;
  schema: string;
  tabela: string;
  filtros?: readonly RowFilter[];
  ordem?: { column: string; direction: "asc" | "desc" } | null;
}): string {
  const q = new URLSearchParams();
  q.set("db", alvo.database);
  if (alvo.filtros !== undefined && alvo.filtros.length > 0) q.set("f", JSON.stringify(alvo.filtros));
  if (alvo.ordem != null) {
    q.set("o", alvo.ordem.column);
    q.set("d", alvo.ordem.direction);
  }
  return `#c/${seg(alvo.connectionId)}/t/${seg(alvo.schema)}/${seg(alvo.tabela)}?${q.toString()}`;
}

export const linkDeSalva = (id: string): string => `#q/${seg(id)}`;

function decodificar(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Lê o hash (com ou sem `#`). Qualquer coisa fora do formato → `null`. */
export function lerLink(hash: string): LinkDbee | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const [caminho = "", busca = ""] = h.split("?", 2);
  const partes = caminho.split("/").map(decodificar);
  if (partes.some((p) => p === null || p === "")) return null;
  const p = partes.map((x) => x ?? "");

  if (p.length === 2 && p[0] === "q") return { tipo: "salva", id: p[1] ?? "" };

  if (p.length === 5 && p[0] === "c" && p[2] === "t") {
    const q = new URLSearchParams(busca);
    const f = q.get("f");
    let filtros: RowFilter[] = [];
    if (f !== null) {
      try {
        filtros = filtrosValidos(JSON.parse(f)) ?? [];
      } catch {
        filtros = []; // filtro ilegível: abre sem filtro, que é o recorte mais largo e honesto
      }
    }
    const o = q.get("o");
    const d = q.get("d");
    return {
      tipo: "tabela",
      connectionId: p[1] ?? "",
      database: q.get("db"),
      schema: p[3] ?? "",
      tabela: p[4] ?? "",
      filtros,
      ordem: o !== null && o !== "" ? { column: o, direction: d === "desc" ? "desc" : "asc" } : null,
    };
  }
  return null;
}
