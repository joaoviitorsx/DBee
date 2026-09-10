/**
 * O protocolo do libSQL — e por que ele é falado com `fetch`, sem cliente.
 *
 * ## Sem dependência, por medição
 *
 * A regra 3 do `CLAUDE.md` manda preferir a primitiva do Bun a uma dependência,
 * e aqui nem primitiva é preciso: o `sqld` expõe `POST /v2/pipeline`, JSON puro,
 * e `fetch` resolve. O cliente oficial (`@libsql/client`) foi medido e
 * **reprovou em duas frentes**:
 *
 * 1. **Traz módulo nativo** (`@libsql/linux-x64-gnu/index.node`, 23 MB no
 *    `node_modules`). A regra 4 proíbe módulo nativo no backend porque quebra o
 *    `bun build --compile`.
 * 2. **Quebra numa tabela que o DBee precisa conseguir ler.** Uma coluna `REAL`
 *    contendo infinito faz o cliente lançar
 *    `HRANA_PROTO_ERROR: Expected number, received null` e a consulta inteira
 *    falha. Com `fetch` a mesma tabela é lida, e o caso é tratado abaixo.
 *
 * ## A regra 10 vem de graça — quase
 *
 * O protocolo manda cada célula com o tipo explícito e o valor **já como
 * string**:
 *
 * ```json
 * {"type":"integer","value":"9223372036854775807"}
 * ```
 *
 * Inteiro de 64 bits chega inteiro, sem passar por `number` — o que no MySQL
 * exigiu `typeCast` e no Postgres exigiu `TUDO_TEXTO`, aqui o servidor já faz.
 *
 * As três exceções, medidas:
 *
 * - **`float` vem como número JSON**, não string. A precisão sobrevive (é IEEE
 *   754 dos dois lados, e `0.30000000000000004` chegou inteiro), mas a
 *   formatação é nossa.
 * - **`blob` vem em `base64`**, num campo próprio, e não em `value`.
 * - **infinito vira `null`**, e é o único caso em que o protocolo **perde
 *   dado** — ver `paraTexto`.
 */

/** Uma célula como o protocolo a entrega. */
export interface CelulaLibsql {
  readonly type: "null" | "integer" | "float" | "text" | "blob";
  readonly value?: string | number | null;
  readonly base64?: string;
}

export interface ColunaLibsql {
  readonly name: string;
  /** O tipo **declarado** no `CREATE TABLE`. `null` em expressão. */
  readonly decltype: string | null;
}

export interface ResultadoLibsql {
  readonly cols: ColunaLibsql[];
  readonly rows: CelulaLibsql[][];
  readonly affected_row_count: number;
}

/**
 * O valor de uma célula como texto, cumprindo a regra 10.
 *
 * ## O caso em que o protocolo perde dado
 *
 * O SQLite guarda infinito numa coluna `REAL` sem reclamar — `typeof` devolve
 * `real` e `CAST(v AS TEXT)` devolve `Inf`. Mas JSON não tem como representar
 * infinito, e o `sqld` manda `{"type":"float","value":null}`.
 *
 * Devolver `null` aqui seria dizer que a célula é `NULL`, e **ela não é**: uma
 * célula `NULL` de verdade chega com `type: "null"`. O tipo ainda distingue as
 * duas, e é isso que torna a honestidade possível.
 *
 * O sinal, porém, **não** sobrevive: `+Inf` e `-Inf` chegam idênticos. Então o
 * texto devolvido diz o que se sabe e não inventa o que não se sabe. Quem
 * precisar do sinal tem saída no próprio SQL — `CAST(coluna AS TEXT)` devolve
 * `Inf` ou `-Inf` como texto, e aí o protocolo carrega.
 */
export function paraTexto(celula: CelulaLibsql): string | null {
  switch (celula.type) {
    case "null":
      return null;

    case "blob": {
      const b64 = celula.base64 ?? "";
      if (b64 === "") return "0x";
      // Hexadecimal com prefixo `0x`, a mesma representação que o `bytea` do
      // Postgres e o `BLOB` do MySQL recebem nesta base.
      return `0x${Buffer.from(b64, "base64").toString("hex")}`;
    }

    case "float": {
      if (celula.value === null || celula.value === undefined) {
        // Não é NULL — `NULL` chega como `type: "null"`. É um float que o JSON
        // não conseguiu carregar, e o único que existe é o infinito.
        return "±Inf";
      }
      return String(celula.value);
    }

    default:
      // `integer` e `text` já vêm como string. `?? null` cobre a célula
      // malformada em vez de deixar `undefined` viajar como se fosse valor.
      return celula.value === undefined || celula.value === null
        ? null
        : String(celula.value);
  }
}
