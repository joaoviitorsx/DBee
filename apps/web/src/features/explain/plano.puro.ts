/**
 * Leitura do plano do `EXPLAIN (FORMAT JSON)` (ADR 017, roadmap-dbeaver item 8).
 *
 * O servidor devolve o plano como **texto** (regra 10); aqui ele vira uma
 * árvore tipada. Puro: sem I/O, testado sem mock. Nada aqui decide segurança —
 * é só leitura do que o Postgres respondeu.
 *
 * "Mais caro" é pelo custo **exclusivo** (custo total do nó menos o total dos
 * filhos): o nó raiz sempre tem o maior custo total, e destacá-lo não diria
 * nada. Com ANALYZE, o tempo exclusivo real (× loops) é a medida que vale.
 */
export interface NoPlano {
  readonly id: number;
  readonly tipo: string;
  /** "clientes c", "idx_x", condição de junção — o que identifica o nó. */
  readonly alvo: string | null;
  readonly detalhes: readonly string[];
  readonly custoInicial: number | null;
  readonly custoTotal: number | null;
  readonly linhasEstimadas: number | null;
  readonly linhasReais: number | null;
  readonly loops: number | null;
  /** ms, já multiplicado por loops (tempo total gasto no nó e abaixo). */
  readonly tempoReal: number | null;
  /** Custo (ou tempo, com ANALYZE) gasto só neste nó. */
  readonly exclusivo: number;
  readonly filhos: readonly NoPlano[];
}

export interface Plano {
  readonly raiz: NoPlano;
  readonly analisado: boolean;
  readonly tempoPlanejamento: number | null;
  readonly tempoExecucao: number | null;
  /** Id do nó de maior `exclusivo`. */
  readonly maisCaro: number;
  /** Soma dos `exclusivo` — base para a fração de cada nó. */
  readonly total: number;
}

type Bruto = Readonly<Record<string, unknown>>;

const ehObjeto = (v: unknown): v is Bruto => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Chaves que viram linhas de detalhe, na ordem em que interessam. */
const DETALHES = [
  "Index Cond",
  "Hash Cond",
  "Merge Cond",
  "Join Filter",
  "Filter",
  "Recheck Cond",
  "Sort Key",
  "Group Key",
] as const;

function alvoDe(n: Bruto): string | null {
  const rel = str(n["Relation Name"]);
  const alias = str(n["Alias"]);
  const indice = str(n["Index Name"]);
  const partes: string[] = [];
  if (rel !== null) partes.push(alias !== null && alias !== rel ? `${rel} ${alias}` : rel);
  if (indice !== null) partes.push(`(${indice})`);
  const cte = str(n["CTE Name"]) ?? str(n["Function Name"]);
  if (cte !== null && partes.length === 0) partes.push(cte);
  return partes.length === 0 ? null : partes.join(" ");
}

function detalhesDe(n: Bruto): string[] {
  const saida: string[] = [];
  for (const k of DETALHES) {
    const v = n[k];
    if (typeof v === "string") saida.push(`${k}: ${v}`);
    else if (Array.isArray(v)) saida.push(`${k}: ${v.filter((x) => typeof x === "string").join(", ")}`);
  }
  const removidas = num(n["Rows Removed by Filter"]);
  if (removidas !== null) saida.push(`Rows Removed by Filter: ${String(removidas)}`);
  return saida;
}

export function lerPlano(texto: string): Plano | null {
  let json: unknown;
  try {
    json = JSON.parse(texto) as unknown;
  } catch {
    // Texto que não é JSON não é plano: a UI mostra o texto cru.
    return null;
  }
  const topo: unknown = Array.isArray(json) ? (json as unknown[])[0] : json;
  if (!ehObjeto(topo) || !ehObjeto(topo["Plan"])) return null;

  let proximo = 0;
  const construir = (n: Bruto): NoPlano => {
    const id = proximo++;
    const filhosBrutos = Array.isArray(n["Plans"]) ? n["Plans"].filter(ehObjeto) : [];
    const filhos = filhosBrutos.map(construir);
    const loops = num(n["Actual Loops"]);
    const tempoUnit = num(n["Actual Total Time"]);
    const tempoReal = tempoUnit === null ? null : tempoUnit * (loops ?? 1);
    const custoTotal = num(n["Total Cost"]);
    const medida = (x: NoPlano): number => x.tempoReal ?? x.custoTotal ?? 0;
    const proprio = tempoReal ?? custoTotal ?? 0;
    const exclusivo = Math.max(0, proprio - filhos.reduce((s, f) => s + medida(f), 0));
    const join = str(n["Join Type"]);
    const tipoBase = str(n["Node Type"]) ?? "?";
    return {
      id,
      tipo: join !== null && /Join|Nested Loop/.test(tipoBase) ? `${join} ${tipoBase}` : tipoBase,
      alvo: alvoDe(n),
      detalhes: detalhesDe(n),
      custoInicial: num(n["Startup Cost"]),
      custoTotal,
      linhasEstimadas: num(n["Plan Rows"]),
      linhasReais: num(n["Actual Rows"]),
      loops,
      tempoReal,
      exclusivo,
      filhos,
    };
  };
  const raiz = construir(topo["Plan"]);

  let maisCaro = raiz;
  let total = 0;
  const visitar = (n: NoPlano): void => {
    total += n.exclusivo;
    if (n.exclusivo > maisCaro.exclusivo) maisCaro = n;
    n.filhos.forEach(visitar);
  };
  visitar(raiz);

  return {
    raiz,
    analisado: raiz.tempoReal !== null,
    tempoPlanejamento: num(topo["Planning Time"]),
    tempoExecucao: num(topo["Execution Time"]),
    maisCaro: maisCaro.id,
    total,
  };
}
