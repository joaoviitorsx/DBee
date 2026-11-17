/**
 * Variáveis de snippet (`:nome`) → parâmetros posicionais (`$1..$n`).
 *
 * Puro, sem I/O. **Nunca** substitui o valor no texto: o SQL sai com `$n` e
 * os valores vão como bind no protocolo estendido (regra 8 / §6 — SQL montado
 * por concatenação de valor é exatamente o que o DBee não faz).
 *
 * Varredura léxica mínima, só para não confundir `:` que não é variável:
 * - dentro de `'string'` (com `''` escapado), `E'...'` (com `\'`),
 *   `"identificador"`, `$tag$ dollar $tag$`;
 * - dentro de comentário de linha e de bloco (aninhável, como no Postgres);
 * - `::cast` e `:=`.
 *
 * Nome: letra ou `_`, depois letras, dígitos ou `_`. O mesmo nome repetido
 * vira o mesmo `$n`. Postgres apenas (ADR 019).
 */
export interface SqlParametrizado {
  readonly sql: string;
  /** Nomes na ordem dos `$n`: `nomes[0]` é `$1`. */
  readonly nomes: readonly string[];
}

const INICIO_NOME = /[A-Za-z_]/;
const PARTE_NOME = /[A-Za-z0-9_]/;

/** Fim (exclusivo) de um literal entre `aspa`, com a aspa dobrada como escape. */
function fimDoLiteral(sql: string, inicio: number, aspa: string, barraEscapa: boolean): number {
  let j = inicio + 1;
  while (j < sql.length) {
    const ch = sql[j];
    if (barraEscapa && ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === aspa) {
      if (sql[j + 1] === aspa) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return sql.length;
}

/** Fim (exclusivo) de um comentário de bloco, respeitando aninhamento. */
function fimDoBloco(sql: string, inicio: number): number {
  let j = inicio + 2;
  let nivel = 1;
  while (j < sql.length && nivel > 0) {
    if (sql[j] === "/" && sql[j + 1] === "*") {
      nivel++;
      j += 2;
    } else if (sql[j] === "*" && sql[j + 1] === "/") {
      nivel--;
      j += 2;
    } else {
      j++;
    }
  }
  return j;
}

/** Onde termina o trecho opaco que começa em `i`, ou `null` se não é opaco. */
function fimDoOpaco(sql: string, i: number): number | null {
  const c = sql[i];
  const prox = sql[i + 1];
  if (c === "-" && prox === "-") {
    const fim = sql.indexOf("\n", i);
    return fim === -1 ? sql.length : fim;
  }
  if (c === "/" && prox === "*") return fimDoBloco(sql, i);
  if (c === "'") {
    const prefixoE = /[eE]/.test(sql[i - 1] ?? "") && !PARTE_NOME.test(sql[i - 2] ?? "");
    return fimDoLiteral(sql, i, "'", prefixoE);
  }
  if (c === '"') return fimDoLiteral(sql, i, '"', false);
  if (c === "$" && !PARTE_NOME.test(sql[i - 1] ?? "")) {
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
    if (m !== null) {
      const fim = sql.indexOf(m[0], i + m[0].length);
      return fim === -1 ? sql.length : fim + m[0].length;
    }
  }
  return null;
}

export function nomearParametros(sql: string): SqlParametrizado {
  const nomes: string[] = [];
  const indice = new Map<string, number>();
  let saida = "";
  let i = 0;

  while (i < sql.length) {
    const opaco = fimDoOpaco(sql, i);
    if (opaco !== null) {
      saida += sql.slice(i, opaco);
      i = opaco;
      continue;
    }
    const c = sql[i] ?? "";
    const prox = sql[i + 1] ?? "";
    if (c === ":" && (prox === ":" || prox === "=")) {
      saida += c + prox;
      i += 2;
      continue;
    }
    if (c === ":" && INICIO_NOME.test(prox)) {
      let j = i + 1;
      while (j < sql.length && PARTE_NOME.test(sql[j] ?? "")) j++;
      const nome = sql.slice(i + 1, j);
      let pos = indice.get(nome);
      if (pos === undefined) {
        nomes.push(nome);
        pos = nomes.length;
        indice.set(nome, pos);
      }
      saida += `$${String(pos)}`;
      i = j;
      continue;
    }
    saida += c;
    i++;
  }
  return { sql: saida, nomes };
}

/**
 * Os valores na ordem dos `$n`. Variável sem valor é erro (devolve o nome que
 * falta) — mandar `NULL` em silêncio mudaria o resultado sem a pessoa saber.
 */
export function valoresDosParametros(
  nomes: readonly string[],
  valores: Readonly<Record<string, string | null>>,
): { ok: true; params: (string | null)[] } | { ok: false; faltando: string[] } {
  const faltando = nomes.filter((nome) => !Object.hasOwn(valores, nome));
  if (faltando.length > 0) return { ok: false, faltando };
  return { ok: true, params: nomes.map((nome) => valores[nome] ?? null) };
}
