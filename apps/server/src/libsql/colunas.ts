import type { ResultColumn } from "@dbee/shared";

import type { ColunaLibsql } from "./protocolo";

/**
 * O tipo de uma coluna no SQLite — que **não é uma propriedade da coluna**.
 *
 * ## Por que isto não é o `colunas.ts` do MySQL
 *
 * No Postgres cada coluna de resultado carrega um OID; no MySQL, um número de
 * protocolo. No SQLite não existe nem um nem outro: o tipo é **do valor**, não
 * da coluna, e a mesma coluna pode ter um inteiro numa linha e um texto na
 * seguinte. O que o protocolo entrega por coluna é o `decltype` — o texto que
 * estava no `CREATE TABLE`, e `null` quando a coluna é uma expressão.
 *
 * A tela precisa de um `dataTypeId` estável para casar coluna de resultado com
 * coluna de catálogo, e de um `dataTypeName` para decidir alinhamento. Então o
 * `decltype` vira **afinidade**, pelas cinco regras da documentação do SQLite,
 * aplicadas na ordem — e é a ordem que importa: `"CHARINT"` contém `INT`, mas
 * contém `CHAR` antes, e a regra 1 (`INT`) vence de propósito.
 *
 * ## Os números
 *
 * São nossos, não do protocolo — o SQLite não tem números de tipo para copiar.
 * Só precisam ser estáveis dentro da engine, que é o que a tela usa. Ficam
 * pequenos e fixos aqui, e mudá-los é mudança de comportamento visível.
 */
export const AFINIDADES = {
  INTEGER: 1,
  TEXT: 2,
  BLOB: 3,
  REAL: 4,
  NUMERIC: 5,
} as const;

export type Afinidade = keyof typeof AFINIDADES;

/**
 * As cinco regras de afinidade do SQLite, na ordem em que ele as aplica.
 *
 * 1. contém `INT` → `INTEGER`
 * 2. contém `CHAR`, `CLOB` ou `TEXT` → `TEXT`
 * 3. contém `BLOB`, ou é vazio/ausente → `BLOB`
 * 4. contém `REAL`, `FLOA` ou `DOUB` → `REAL`
 * 5. o resto → `NUMERIC`
 */
export function afinidadeDe(decltype: string | null): Afinidade {
  const t = (decltype ?? "").toUpperCase();
  if (t === "") return "BLOB";
  if (t.includes("INT")) return "INTEGER";
  if (t.includes("CHAR") || t.includes("CLOB") || t.includes("TEXT")) return "TEXT";
  if (t.includes("BLOB")) return "BLOB";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) return "REAL";
  return "NUMERIC";
}

/**
 * As colunas de um resultado, no formato da API.
 *
 * `dataTypeName` guarda o `decltype` **como o autor da tabela escreveu** quando
 * ele existe — `VARCHAR(40)` diz mais a quem lê do que `TEXT`, e é o que
 * qualquer outro cliente daquele banco mostraria. A afinidade só entra quando
 * não há `decltype` (expressão, ou coluna sem tipo declarado, que o SQLite
 * permite).
 */
export function colunasDoResultado(cols: readonly ColunaLibsql[]): ResultColumn[] {
  return cols.map((c) => ({
    name: c.name,
    dataTypeId: AFINIDADES[afinidadeDe(c.decltype)],
    dataTypeName: c.decltype ?? afinidadeDe(null),
  }));
}
