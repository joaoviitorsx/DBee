/**
 * Leitura de célula por tipo (docs/ui-detalhes.md §4 e §6.2).
 *
 * Só EXIBIÇÃO. O valor bruto (string) continua sendo o que se copia, edita,
 * filtra e exporta (CLAUDE.md regra 10). Tudo aqui opera sobre a string:
 * nada de `Date` (o fuso do navegador mentiria) nem `Number` (numeric perde
 * precisão). Puro e O(tamanho da célula) — roda só nas células visíveis.
 */

export type Leitura =
  | { readonly tipo: "bool"; readonly valor: boolean }
  | { readonly tipo: "data"; readonly principal: string; readonly resto: string }
  | { readonly tipo: "json"; readonly resumo: string | null; readonly texto: string }
  | { readonly tipo: "array"; readonly itens: number | null; readonly texto: string }
  | { readonly tipo: "uuid"; readonly curto: string }
  | { readonly tipo: "bytea"; readonly tamanho: string; readonly inicio: string }
  | { readonly tipo: "numero"; readonly texto: string }
  | {
      readonly tipo: "texto";
      readonly texto: string;
      /** Quebras de linha além da primeira (o texto já vem só com a 1ª linha). */
      readonly linhasExtras: number;
      readonly espacosInicio: number;
      readonly espacosFim: number;
    };

export type Idioma = "pt" | "en";

const base = (tipo: string): string => tipo.replace(/\(.*/, "").trim().toLowerCase();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_HORA = /^(\d{4,})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(.*))?$/;
const AGRUPAVEIS = new Set(["numeric", "decimal", "money", "real", "double precision"]);

/** Teto acima do qual o JSON não é parseado para resumo (custo por célula). */
export const TETO_JSON_RESUMO = 64 * 1024;

const cacheJson = new Map<string, string | null>();

/** `{ 4 }` / `[ 12 ]` — contagem do nível de cima, ou `null` se não couber. */
export function resumoJson(texto: string): string | null {
  if (texto.length > TETO_JSON_RESUMO) return null;
  const guardado = cacheJson.get(texto);
  if (guardado !== undefined) return guardado;
  let r: string | null = null;
  try {
    const v: unknown = JSON.parse(texto);
    if (Array.isArray(v)) r = `[${String(v.length)}]`;
    else if (v !== null && typeof v === "object") r = `{${String(Object.keys(v).length)}}`;
  } catch {
    r = null; // json inválido numa coluna `json` não acontece; em texto, sem resumo
  }
  if (cacheJson.size > 2000) cacheJson.clear();
  cacheJson.set(texto, r);
  return r;
}

/**
 * Itens de topo de um array literal do Postgres (`{a,"b,c",NULL,{1,2}}`).
 * Respeita aspas, escapes e sub-arrays. `null` se não for um literal de array.
 */
export function itensDeArray(texto: string): number | null {
  const s = texto.replace(/^\[[^\]]*\]=/, ""); // limites explícitos: [0:2]={…}
  if (!s.startsWith("{") || !s.endsWith("}")) return null;
  const miolo = s.slice(1, -1);
  if (miolo.trim() === "") return 0;
  let n = 1;
  let prof = 0;
  let aspas = false;
  for (let i = 0; i < miolo.length; i++) {
    const c = miolo[i];
    if (aspas) {
      if (c === "\\") i++;
      else if (c === '"') aspas = false;
      continue;
    }
    if (c === '"') aspas = true;
    else if (c === "{") prof++;
    else if (c === "}") prof--;
    else if (c === "," && prof === 0) n++;
  }
  return n;
}

/** Tamanho legível de um `bytea` em hex (`\x…`). */
export function tamanhoBytea(texto: string): { bytes: number; rotulo: string } | null {
  if (!texto.startsWith("\\x")) return null;
  const bytes = Math.floor((texto.length - 2) / 2);
  const rotulo =
    bytes < 1024 ? `${String(bytes)} B`
    : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return { bytes, rotulo };
}

/**
 * Agrupa milhares só para leitura, com espaço fino inquebrável (U+202F).
 * Não troca o separador decimal: `1 234 567.89` continua sendo o mesmo número
 * que a pessoa vai colar. Notação científica, NaN e Infinity passam intactos.
 */
export function agruparMilhares(texto: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(texto.replace(/^\$/, ""));
  if (m === null) return texto;
  const [, sinal = "", inteiro = "", frac = ""] = m;
  if (inteiro.length < 5) return texto;
  const agrupado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${texto.startsWith("$") ? "$" : ""}${sinal}${agrupado}${frac}`;
}

function lerData(texto: string, idioma: Idioma): Leitura | null {
  const m = DATA_HORA.exec(texto);
  if (m === null) return null;
  const [, a = "", mes = "", d = "", h, min, resto] = m;
  const data = idioma === "pt" ? `${d}/${mes}/${a}` : `${a}-${mes}-${d}`;
  if (h === undefined || min === undefined) {
    // `date` puro; BC e outros sufixos ficam no resto
    return { tipo: "data", principal: data, resto: "" };
  }
  return { tipo: "data", principal: `${data} ${h}:${min}`, resto: resto ?? "" };
}

function lerTexto(texto: string): Leitura {
  const quebra = texto.indexOf("\n");
  const primeira = quebra === -1 ? texto : texto.slice(0, quebra);
  const linhasExtras = quebra === -1 ? 0 : texto.split("\n").length - 1;
  const espacosInicio = /^ */.exec(texto)?.[0].length ?? 0;
  const espacosFim = texto.trim() === "" ? 0 : (/ *$/.exec(texto)?.[0].length ?? 0);
  return { tipo: "texto", texto: primeira, linhasExtras, espacosInicio, espacosFim };
}

/** Decide a leitura de uma célula não nula e não vazia pelo tipo da coluna. */
export function lerCelula(valor: string, dataTypeName: string, idioma: Idioma): Leitura {
  const tipo = base(dataTypeName);

  if (tipo === "boolean" || tipo === "bool") {
    if (valor === "t" || valor === "true") return { tipo: "bool", valor: true };
    if (valor === "f" || valor === "false") return { tipo: "bool", valor: false };
  }
  if (tipo.startsWith("timestamp") || tipo === "date") {
    const d = lerData(valor, idioma);
    if (d !== null) return d;
  }
  if (tipo === "json" || tipo === "jsonb") {
    return { tipo: "json", resumo: resumoJson(valor), texto: valor };
  }
  if (tipo.endsWith("[]") || tipo.startsWith("_")) {
    return { tipo: "array", itens: itensDeArray(valor), texto: valor };
  }
  if (tipo === "uuid" && UUID.test(valor)) {
    return { tipo: "uuid", curto: `${valor.slice(0, 8)}…${valor.slice(-4)}` };
  }
  if (tipo === "bytea") {
    const t = tamanhoBytea(valor);
    if (t !== null) return { tipo: "bytea", tamanho: t.rotulo, inicio: valor.slice(2, 18) };
  }
  if (AGRUPAVEIS.has(tipo)) return { tipo: "numero", texto: agruparMilhares(valor) };
  return lerTexto(valor);
}
