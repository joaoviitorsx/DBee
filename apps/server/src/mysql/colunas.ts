import type { ResultColumn } from "@dbee/shared";

import { type CampoMysql } from "./tipos";

/**
 * O nome do tipo de cada coluna do resultado, como o usuário o reconhece.
 *
 * O `mysql2` expõe o número do tipo do **protocolo** — `LONG`, `VAR_STRING`,
 * `BLOB` — e ninguém escreve `LONG` num `CREATE TABLE`. A tela usa
 * `dataTypeName` para decidir alinhamento e formatação, então ela precisa do
 * nome do SQL: `int`, `varchar`, `text`.
 *
 * O mapa abaixo é conferido contra a resposta do **próprio servidor**
 * (`information_schema.COLUMNS.DATA_TYPE`) em `colunas.integration.test.ts`.
 * Não é uma tabela que eu escrevi de memória: é uma tabela que o MySQL e o
 * MariaDB validam coluna a coluna.
 *
 * ## O que o fio não distingue, e por que isso é dito e não escondido
 *
 * Medido: `TEXT` e `LONGTEXT` chegam **idênticos** — tipo 252, charset de
 * texto, mesmos flags. O tamanho não viaja no metadado do resultado. Então os
 * dois viram `text`, e o mesmo vale para as variantes de `BLOB`. Um cliente que
 * chutasse `longtext` acertaria metade das vezes; dizer `text` é a informação
 * que de fato existe no resultado.
 */

/** `characterSet` 63 é `binary`: separa `BLOB` de `TEXT` e `BINARY` de `CHAR`. */
const CHARSET_BINARIO = 63;

/**
 * Flags que o protocolo manda junto da coluna.
 *
 * `BINARY_FLAG` (128) **não** está aqui de propósito: medido, ele vem ligado em
 * `DATE`, `DATETIME`, `TIMESTAMP` e `TIME`, que não têm nada de binário. Quem
 * decide binário é o charset.
 */
const ENUM_FLAG = 256;
const SET_FLAG = 2048;

/** Tipos do protocolo que têm nome de SQL direto, sem depender de charset. */
const NOME_DIRETO: Readonly<Record<number, string>> = {
  0: "decimal",
  1: "tinyint",
  2: "smallint",
  3: "int",
  4: "float",
  5: "double",
  6: "null",
  7: "timestamp",
  8: "bigint",
  9: "mediumint",
  10: "date",
  11: "time",
  12: "datetime",
  13: "year",
  15: "varchar",
  16: "bit",
  17: "timestamp",
  18: "datetime",
  19: "time",
  245: "json",
  246: "decimal",
  247: "enum",
  248: "set",
  255: "geometry",
};

/** Tipos de bloco, cujo nome depende do charset ser binário ou não. */
const NOME_POR_CHARSET: Readonly<Record<number, { binario: string; texto: string }>> = {
  249: { binario: "tinyblob", texto: "tinytext" },
  250: { binario: "mediumblob", texto: "mediumtext" },
  251: { binario: "longblob", texto: "longtext" },
  252: { binario: "blob", texto: "text" },
  253: { binario: "varbinary", texto: "varchar" },
  254: { binario: "binary", texto: "char" },
};

/**
 * O nome SQL do tipo de uma coluna do resultado.
 *
 * A ordem importa: `ENUM` e `SET` chegam como `STRING` (254) e só os flags os
 * separam de um `CHAR`, então eles são testados antes do mapa por charset.
 */
export function nomeDoTipo(campo: CampoMysql & { readonly flags?: number }): string {
  const flags = campo.flags ?? 0;
  if ((flags & ENUM_FLAG) !== 0) return "enum";
  if ((flags & SET_FLAG) !== 0) return "set";

  const porCharset = NOME_POR_CHARSET[campo.columnType];
  if (porCharset !== undefined) {
    return campo.characterSet === CHARSET_BINARIO ? porCharset.binario : porCharset.texto;
  }

  // Tipo que o servidor inventar depois vira o número, e não uma mentira
  // plausível: a tela mostra algo estranho e alguém investiga, em vez de todo
  // mundo acreditar num `varchar` que não é.
  return NOME_DIRETO[campo.columnType] ?? `tipo_${String(campo.columnType)}`;
}

/** Os metadados de coluna do resultado, no formato que a API declara. */
export function colunasDoResultado(
  campos: readonly (CampoMysql & { readonly flags?: number })[],
): ResultColumn[] {
  return campos.map((campo) => ({
    name: campo.name,
    // O número do tipo do protocolo ocupa o lugar do OID do Postgres: serve
    // para a tela casar coluna de resultado com coluna de catálogo, e o valor
    // só precisa ser estável dentro de uma engine.
    dataTypeId: campo.columnType,
    dataTypeName: nomeDoTipo(campo),
  }));
}
