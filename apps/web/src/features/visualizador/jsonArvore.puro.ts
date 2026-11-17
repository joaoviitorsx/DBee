/**
 * Núcleo puro do visualizador de JSON (docs/ui-detalhes.md §6.1): achata o
 * valor parseado numa lista de nós visíveis (o que a árvore virtualizada
 * renderiza), formata caminhos e casa a busca. Sem DOM, sem React — testado
 * sem mock.
 */

export type TipoJson = "objeto" | "array" | "string" | "numero" | "bool" | "null";
export type Parte = string | number;

export interface NoJson {
  /** Chave estável do nó (caminho serializado). */
  readonly id: string;
  readonly partes: readonly Parte[];
  readonly nivel: number;
  /** Rótulo à esquerda: a chave do objeto ou o índice do array. */
  readonly chave: Parte | null;
  readonly tipo: TipoJson;
  /** Escalar como texto de exibição; contêiner: `null`. */
  readonly texto: string | null;
  /** Filhos diretos (contêiner). */
  readonly filhos: number;
  readonly aberto: boolean;
}

export function tipoDe(v: unknown): TipoJson {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "object": return "objeto";
    case "string": return "string";
    case "number": return "numero";
    case "boolean": return "bool";
    default: return "null";
  }
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** `preferencias.tags[0]`, `["chave com espaço"]` — o caminho que se cola em código. */
export function formatarCaminho(partes: readonly Parte[], raiz = ""): string {
  let s = raiz;
  for (const p of partes) {
    if (typeof p === "number") s += `[${String(p)}]`;
    else if (IDENT.test(p)) s += s === "" ? p : `.${p}`;
    else s += `[${JSON.stringify(p)}]`;
  }
  return s;
}

export const idDe = (partes: readonly Parte[]): string => JSON.stringify(partes);

function filhosDe(v: unknown): [Parte, unknown][] {
  if (Array.isArray(v)) return v.map((x, i) => [i, x]);
  if (v !== null && typeof v === "object") return Object.entries(v);
  return [];
}

function textoEscalar(v: unknown): string {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

/**
 * Ids abertos por padrão: até o nível `ate` (a raiz é nível 0). Nível 3+
 * começa recolhido — o resumo `{ 4 }` diz o tamanho sem despejar tudo.
 */
export function abertosAte(raiz: unknown, ate: number): Set<string> {
  const abertos = new Set<string>();
  const visitar = (v: unknown, partes: Parte[], nivel: number): void => {
    if (nivel >= ate) return;
    const f = filhosDe(v);
    if (f.length === 0) return;
    abertos.add(idDe(partes));
    for (const [k, x] of f) visitar(x, [...partes, k], nivel + 1);
  };
  visitar(raiz, [], 0);
  return abertos;
}

/** Todos os contêineres (para "expandir tudo"). */
export const todosAbertos = (raiz: unknown): Set<string> => abertosAte(raiz, Number.POSITIVE_INFINITY);

/** Lista achatada dos nós visíveis, na ordem de leitura. */
export function achatar(raiz: unknown, abertos: ReadonlySet<string>): NoJson[] {
  const out: NoJson[] = [];
  const visitar = (v: unknown, partes: Parte[], chave: Parte | null, nivel: number): void => {
    const tipo = tipoDe(v);
    const f = filhosDe(v);
    const id = idDe(partes);
    const conteiner = tipo === "objeto" || tipo === "array";
    const aberto = conteiner && abertos.has(id);
    out.push({
      id,
      partes,
      nivel,
      chave,
      tipo,
      texto: conteiner ? null : textoEscalar(v),
      filhos: f.length,
      aberto,
    });
    if (aberto) for (const [k, x] of f) visitar(x, [...partes, k], k, nivel + 1);
  };
  visitar(raiz, [], null, 0);
  return out;
}

/**
 * Busca: ids dos nós cuja chave ou valor escalar contém `q` (sem caixa), e os
 * ancestrais que precisam abrir para eles aparecerem.
 */
export function buscar(raiz: unknown, q: string): { achados: string[]; abrir: Set<string> } {
  const termo = q.trim().toLowerCase();
  const achados: string[] = [];
  const abrir = new Set<string>();
  if (termo === "") return { achados, abrir };
  const visitar = (v: unknown, partes: Parte[], chave: Parte | null): void => {
    const casaChave = chave !== null && String(chave).toLowerCase().includes(termo);
    const f = filhosDe(v);
    const casaValor = f.length === 0 && tipoDe(v) !== "objeto" && tipoDe(v) !== "array"
      && String(v).toLowerCase().includes(termo);
    if (casaChave || casaValor) {
      achados.push(idDe(partes));
      for (let i = 0; i < partes.length; i++) abrir.add(idDe(partes.slice(0, i)));
    }
    for (const [k, x] of f) visitar(x, [...partes, k], k);
  };
  visitar(raiz, [], null);
  return { achados, abrir };
}

/** Valor do nó: escalar como texto puro (string sem aspas), contêiner como JSON. */
export function valorDoNo(raiz: unknown, partes: readonly Parte[]): { texto: string; reformatado: boolean } {
  let v: unknown = raiz;
  for (const p of partes) {
    v = Array.isArray(v) ? v[p as number] : (v as Record<string, unknown>)[p as string];
  }
  const tipo = tipoDe(v);
  if (tipo === "objeto" || tipo === "array") return { texto: JSON.stringify(v, null, 2), reformatado: true };
  return { texto: typeof v === "string" ? v : String(v), reformatado: false };
}
