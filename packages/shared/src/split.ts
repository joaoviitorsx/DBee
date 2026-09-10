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
 *
 * ## Dialeto
 *
 * A lista acima é o Postgres. O MySQL escreve as mesmas coisas de outro jeito,
 * e usar a leitura do Postgres no SQL do MySQL **quebra em silêncio** — foi o
 * achado #9 da auditoria. As diferenças que importam para achar o `;`:
 *
 * | forma | Postgres | MySQL |
 * |---|---|---|
 * | `'a\'b'` | `\` é literal, a string fecha no `'` do meio | `\'` escapa, a string continua |
 * | `"..."` | identificador | **string**, com escape por `\` |
 * | `` `...` `` | não existe | identificador, escape por `` `` `` |
 * | `# ...` | não é comentário | comentário de linha |
 * | `/* /* *\/` | aninha | **não** aninha: fecha no primeiro `*\/` |
 * | `$tag$` | dollar quoting | não existe |
 * | `E'...'` | escape por barra invertida | não existe |
 *
 * Cada uma delas é um `;` caindo no lado errado da fronteira. Um `;` a mais
 * significa mandar meio comando ao servidor (erro de sintaxe, barulhento); um
 * `;` a menos significa mandar **dois comandos como um** — e é esse que
 * importa, porque o executor conta statements para decidir o que registrar.
 *
 * O MySQL escapa com barra invertida por padrão, e o DBee **garante** esse
 * padrão: a sessão desliga `NO_BACKSLASH_ESCAPES` ao abrir
 * (`mysql/sessao.ts`), justamente para o servidor ler a string do mesmo jeito
 * que esta função. Sem essa garantia não haveria leitura correta possível —
 * o mesmo texto teria dois significados.
 */

/**
 * Qual gramática ler.
 *
 * MariaDB lê como MySQL: as diferenças entre os dois (medidas em
 * `docs/multi-engine.md`) não tocam em aspas nem em comentário.
 */
export type DialetoSql = "postgres" | "mysql";

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

export function splitStatements(sql: string, dialeto: DialetoSql = "postgres"): Statement[] {
  const mysql = dialeto === "mysql";
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

    /*
     * Comentário de linha. No MySQL o `--` só abre comentário se vier seguido
     * de branco — `a--b` é `a - (-b)` — e o `#` também abre. No Postgres o `--`
     * abre sempre e o `#` não é comentário nenhum.
     */
    const abreLinha =
      (ch === "-" && sql[i + 1] === "-" && (!mysql || /[\s]/.test(sql[i + 2] ?? " "))) ||
      (mysql && ch === "#");
    if (abreLinha) {
      const quebra = sql.indexOf("\n", i);
      i = quebra === -1 ? sql.length : quebra + 1;
      continue;
    }

    /*
     * Comentário de bloco. Aninha no Postgres, não aninha no MySQL — e o
     * `/*! ... *\/` do MySQL (comentário que o servidor executa) fecha no
     * primeiro `*\/` como qualquer outro, então não precisa de caso próprio.
     */
    if (ch === "/" && sql[i + 1] === "*") {
      let profundidade = 1;
      i += 2;
      while (i < sql.length && profundidade > 0) {
        if (!mysql && sql[i] === "/" && sql[i + 1] === "*") { profundidade++; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { profundidade--; i += 2; continue; }
        i++;
      }
      continue;
    }

    // E'...' — escape por barra invertida. Só existe no Postgres.
    if (!mysql && (ch === "E" || ch === "e") && sql[i + 1] === "'") {
      i += 2;
      while (i < sql.length) {
        if (sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }

    /*
     * '...' — aspa dobrada nos dois; no MySQL a barra invertida também escapa
     * (é o padrão do servidor, e a sessão do DBee garante que ele fique nesse
     * padrão). Sem isto, `'O\'Brien; DROP'` viraria dois statements.
     */
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (mysql && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }

    /*
     * "..." — identificador no Postgres, **string** no MySQL (a menos de
     * `ANSI_QUOTES`). Para achar o `;` a diferença que conta é o escape: as
     * duas formas fecham na aspa dobrada, e a do MySQL fecha também depois de
     * uma barra invertida. Tratar os dois casos aqui vale para as duas
     * leituras do `"`, então `ANSI_QUOTES` não muda o resultado.
     */
    if (ch === '"') {
      i++;
      while (i < sql.length) {
        if (mysql && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === '"' && sql[i + 1] === '"') { i += 2; continue; }
        if (sql[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }

    // `...` — identificador do MySQL, escape por crase dobrada.
    if (mysql && ch === "`") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "`" && sql[i + 1] === "`") { i += 2; continue; }
        if (sql[i] === "`") { i++; break; }
        i++;
      }
      continue;
    }

    // $tag$ ... $tag$
    const tag = mysql ? null : dollarTagAt(sql, i);
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
