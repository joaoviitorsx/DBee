/**
 * O `TUDO_TEXTO` do MySQL — como a regra 10 é cumprida aqui.
 *
 * A regra 10 do `CLAUDE.md` diz que **todo valor de célula trafega como
 * string**, e que a conversão automática do driver não é para ser confiada. No
 * Postgres isso sai barato: o protocolo já manda texto e basta não interpretar.
 * No MySQL cada driver inventa a sua conversão, e as duas que eu medi estão
 * erradas de formas diferentes.
 *
 * ## Por que não `Bun.SQL`
 *
 * O Bun 1.3.14 fala MySQL nativamente, e a regra 3 manda preferir a primitiva
 * do Bun a uma dependência. Ele foi medido primeiro e **reprovou**: converte
 * tipos sem opção documentada de desligar, e a conversão de `DATE` depende de
 * qual API se chama. Contra o mesmo servidor, mesma linha, coluna `DATE`
 * guardada como `2026-03-01`:
 *
 *   template tag   -> 2026-03-01T03:00:00.000Z   (meia-noite local)
 *   sql.unsafe()   -> 2026-03-01T00:00:00.000Z   (meia-noite UTC)
 *
 * Em `America/Bahia` a segunda **aparece como 28 de fevereiro**. E `unsafe()` é
 * exatamente o caminho do editor de SQL, onde a consulta é texto do usuário.
 * Um cliente de banco que mostra o dia errado não é utilizável, então a regra 3
 * cede aqui: o Bun não resolve, e entra o `mysql2` — JS puro, sem módulo
 * nativo, então a regra 4 (`bun build --compile`) segue de pé.
 *
 * ## Como o texto é obtido
 *
 * O `typeCast` do `mysql2` devolve **os bytes crus** (`campo.buffer()`), e a
 * decisão entre texto e hexadecimal sai dos **metadados de coluna**. Tem que
 * ser assim porque o objeto que o `typeCast` recebe não expõe charset: ali
 * `TEXT` e `BLOB` são os dois `BLOB`, e `CHAR`, `BINARY`, `ENUM` e `SET` são os
 * quatro `STRING`. Sem charset não há como separar bytes de letras.
 *
 * Isso **exige `query()` e não `execute()`**: no protocolo de texto os números
 * e as datas chegam como ASCII, que é o que faz `Buffer.toString("utf8")`
 * devolver exatamente o que o servidor escreveu. No protocolo binário de
 * `execute()` eles chegam como bytes, e o mesmo código produziria lixo.
 */

/** `characterSet` 63 é `binary` — a coluna não tem conjunto de caracteres. */
const CHARSET_BINARIO = 63;

/**
 * Os únicos tipos que podem de fato carregar bytes.
 *
 * Esta lista é a correção de duas regras minhas que a medição desmentiu:
 *
 * 1. `BINARY_FLAG` (128) parecia bastar. Não basta: o **MariaDB liga esse flag
 *    no JSON**, que é texto. (No MySQL o JSON é `columnType` 245; no MariaDB é
 *    `BLOB` 252 com `extendedFormat: "json"` — mais uma em que as duas divergem.)
 * 2. `charset === 63` sozinho também não basta: coluna **numérica e temporal
 *    também diz 63**, porque não tem charset nenhum. Sem esta lista o inteiro
 *    `1` virava `"0x31"` e a data `2026-03-01` virava
 *    `"0x323032362d30332d3031"`.
 *
 * Números e datas ficam de fora de propósito: no protocolo de texto eles já
 * chegam em ASCII, e decodificar é a resposta certa.
 */
const PODEM_CARREGAR_BYTES: ReadonlySet<number> = new Set([
  16,  // BIT
  249, // TINY_BLOB
  250, // MEDIUM_BLOB
  251, // LONG_BLOB
  252, // BLOB — e também TEXT, que se separa pelo charset
  253, // VAR_STRING — VARCHAR e VARBINARY
  254, // STRING — CHAR, BINARY, ENUM e SET
  255, // GEOMETRY
]);

/** O que este módulo precisa saber de uma coluna do resultado. */
export interface CampoMysql {
  readonly name: string;
  readonly characterSet: number;
  readonly columnType: number;
}

/**
 * Se os bytes desta coluna são dados binários, e não texto.
 *
 * Medido contra MySQL 8.4.11 e MariaDB 11.8.9 com as 24 colunas de
 * `tipos.integration.test.ts`. As duas condições são necessárias: veja acima o
 * que cada uma sozinha deixa passar.
 */
export function ehBinaria(campo: CampoMysql): boolean {
  return campo.characterSet === CHARSET_BINARIO && PODEM_CARREGAR_BYTES.has(campo.columnType);
}

/**
 * Os bytes de uma célula como string, ou `null` se a célula é `NULL`.
 *
 * Binário vira hexadecimal com prefixo `0x`, que é a mesma escolha do `bytea`
 * do Postgres nesta base: representação sem perda e legível, em vez de
 * decodificar bytes arbitrários como UTF-8 e produzir caracteres de
 * substituição irreversíveis.
 *
 * `BIT` entra no hexadecimal por isso mesmo — `b'10101010'` vira `0xaa`.
 */
export function paraTexto(bytes: Buffer | null, campo: CampoMysql): string | null {
  if (bytes === null) return null;
  return ehBinaria(campo) ? `0x${bytes.toString("hex")}` : bytes.toString("utf8");
}

/**
 * Um resultado inteiro convertido para texto, coluna por coluna.
 *
 * O `typeCast` entrega `Buffer`; a decisão texto/hexadecimal precisa dos
 * metadados, que só chegam ao lado do resultado. Este é o ponto onde os dois se
 * encontram, e por isso ele é o **único** lugar do driver que sabe da regra.
 *
 * Serve tanto para linha de tabela quanto para consulta de catálogo: o catálogo
 * passa pela mesma conexão e recebe o mesmo `typeCast`, então também chega em
 * bytes.
 */
export function linhasDeTexto(
  linhas: readonly Record<string, unknown>[],
  campos: readonly CampoMysql[],
): Record<string, string | null>[] {
  return linhas.map((linha) => {
    const saida: Record<string, string | null> = {};
    for (const campo of campos) {
      saida[campo.name] = paraTexto((linha[campo.name] ?? null) as Buffer | null, campo);
    }
    return saida;
  });
}
