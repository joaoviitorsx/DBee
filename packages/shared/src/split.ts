/**
 * Separa o SQL do usuário em statements pelo `;` (DBee.md §6).
 *
 * **Vive em `packages/shared` porque o editor e o servidor precisam da MESMA
 * função.** "Executar o statement sob o cursor" decide, no front, qual trecho
 * mandar; o servidor decide, de novo, onde cada statement começa e termina. Se
 * as duas decisões viessem de implementações diferentes, o editor destacaria um
 * trecho e o servidor executaria outro — divergência garantida, e do tipo que
 * só aparece no SQL estranho (dollar quoting, `;` dentro de string).
 *
 * **Isto não é validação de SQL.** A regra 8 do `CLAUDE.md` proíbe usar regex ou
 * parser para decidir se uma query escreve — essa proteção é `BEGIN READ ONLY`,
 * e continua sendo. O que este arquivo faz é achar onde um statement termina,
 * que a §6 exige para executar múltiplos comandos em sequência. Ele não
 * interpreta nada: não sabe o que é `SELECT`, não distingue leitura de escrita,
 * e um erro dele produz erro de sintaxe do Postgres, não permissão indevida.
 *
 * Um `split(";")` ingênuo estaria errado de forma silenciosa: `SELECT ';'`
 * viraria dois statements quebrados. Por isso o percurso reconhece as formas em
 * que um `;` **não** termina statement:
 *
 * - `'...'` com escape `''`
 * - `E'...'` com escape por barra invertida
 * - `"..."` de identificador, com escape `""`
 * - `$tag$ ... $tag$` (dollar quoting, com tag arbitrária)
 * - `-- comentário de linha`
 * - `/* comentário de bloco *\/`, que no Postgres **aninha**
 */

export interface Statement {
  /** O texto do statement, já aparado. */
  readonly sql: string;
  /** Deslocamento do início dele dentro do SQL original, em caracteres. */
  readonly offset: number;
}

/** Tag de dollar quoting a partir de `$`, ou `null` se não for uma. */
function dollarTagAt(sql: string, i: number): string | null {
  if (sql[i] !== "$") return null;
  let j = i + 1;
  while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j] ?? "")) j++;
  return sql[j] === "$" ? sql.slice(i, j + 1) : null;
}

export function splitStatements(sql: string): Statement[] {
  const out: Statement[] = [];
  let inicio = 0;
  let i = 0;

  const empurra = (fim: number): void => {
    const bruto = sql.slice(inicio, fim);
    const texto = bruto.trim();
    if (texto === "") return;
    // O offset aponta para o primeiro caractere não-branco: é o que faz a
    // `position` do Postgres casar com a coluna certa do SQL do usuário.
    out.push({ sql: texto, offset: inicio + bruto.indexOf(texto[0] ?? "") });
  };

  while (i < sql.length) {
    const ch = sql[i];

    // -- comentário até o fim da linha
    if (ch === "-" && sql[i + 1] === "-") {
      const quebra = sql.indexOf("\n", i);
      i = quebra === -1 ? sql.length : quebra + 1;
      continue;
    }

    // /* comentário de bloco */ — aninha no Postgres
    if (ch === "/" && sql[i + 1] === "*") {
      let profundidade = 1;
      i += 2;
      while (i < sql.length && profundidade > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { profundidade++; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { profundidade--; i += 2; continue; }
        i++;
      }
      continue;
    }

    // E'...' — escape por barra invertida
    if ((ch === "E" || ch === "e") && sql[i + 1] === "'") {
      i += 2;
      while (i < sql.length) {
        if (sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }

    // '...' — escape por aspa dobrada
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }

    // "..." — identificador, escape por aspa dobrada
    if (ch === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') { i += 2; continue; }
        if (sql[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }

    // $tag$ ... $tag$
    const tag = dollarTagAt(sql, i);
    if (tag !== null) {
      const fim = sql.indexOf(tag, i + tag.length);
      i = fim === -1 ? sql.length : fim + tag.length;
      continue;
    }

    if (ch === ";") {
      empurra(i);
      i++;
      inicio = i;
      continue;
    }

    i++;
  }

  empurra(sql.length);
  return out;
}
