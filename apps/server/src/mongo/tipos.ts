import { Binary, ObjectId, Timestamp, type Document } from "mongodb";

/**
 * O valor de um campo BSON como **texto** — o `TUDO_TEXTO` do MongoDB (regra 10).
 *
 * O documento do Mongo é aninhado e tipado; a grade é uma tabela de células de
 * texto. Cada valor de campo de primeiro nível vira uma string, e a regra é
 * dizer a verdade sobre o tipo sem inventar precisão que o JSON não tem:
 *
 * - `null`/ausente → `null` (SQL NULL, não a string "null")
 * - `ObjectId` → o hex de 24 caracteres, que é como todo mundo o lê
 * - `Date` → ISO 8601 em UTC (o Mongo guarda em UTC; não há fuso de sessão)
 * - `number`/`bigint`/`Decimal128`/`Long` → o texto do número, sem passar por
 *   `Number` onde a precisão morreria (um `Long` de 64 bits não cabe em `number`)
 * - `boolean` → "true"/"false"
 * - `Binary`/`Buffer` → hexadecimal `0x…`, como o `bytea` e o `BLOB`
 * - objeto/array aninhado → **JSON**, para o caso comum (documento raso) caber
 *   na tabela; o valor completo continua disponível quando a linha é aberta
 * - `Timestamp` (interno do Mongo) → `segundos.incremento`
 *
 * O JSON aninhado não é a vista final — o roadmap pede uma árvore de documentos
 * —, mas é a projeção que faz a grade existente servir ao caso comum sem uma UI
 * nova. É o "com projeção das chaves de primeiro nível numa tabela" do plano.
 */
export function paraTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "string") return valor;
  if (typeof valor === "boolean") return valor ? "true" : "false";
  if (typeof valor === "number") return String(valor);
  if (typeof valor === "bigint") return valor.toString();

  if (valor instanceof ObjectId) return valor.toHexString();
  if (valor instanceof Date) return valor.toISOString();
  if (valor instanceof Timestamp) return `${String(valor.getHighBits())}.${String(valor.getLowBits())}`;

  if (valor instanceof Binary) return bytesParaHex(valor.buffer);
  if (valor instanceof Uint8Array) return bytesParaHex(valor);

  /*
   * `Decimal128`, `Long`, `Double`, `Int32` e afins do BSON têm um
   * `toString()` que dá o número **exato** — é por isso que não passam por
   * `Number`. Qualquer objeto com `_bsontype` cai aqui.
   */
  if (typeof valor === "object") {
    const obj = valor as { _bsontype?: string; toString: () => string };
    if (typeof obj._bsontype === "string") {
      // Tipo BSON escalar (`Decimal128`, `Long`, …): o `toString()` dá o número
      // exato. Chamada explícita, não stringify implícito.
      return obj.toString();
    }
    // Objeto/array comum: JSON, com os valores internos também normalizados
    // (uma data aninhada vira ISO, um ObjectId aninhado vira hex).
    return JSON.stringify(valor, substituto);
  }

  // Só sobram `symbol` e `function`, que não aparecem num documento BSON. A
  // conversão explícita evita o stringify implícito que o lint barra.
  return typeof valor === "symbol" ? valor.toString() : "[valor não serializável]";
}

/** `JSON.stringify` reviver que normaliza os tipos BSON dentro de um aninhado. */
function substituto(_chave: string, valor: unknown): unknown {
  if (valor instanceof ObjectId) return valor.toHexString();
  if (valor instanceof Binary) return bytesParaHex(valor.buffer);
  if (valor instanceof Uint8Array) return bytesParaHex(valor);
  // `Date` o `JSON.stringify` já serializa como ISO; deixa passar.
  if (typeof valor === "object" && valor !== null) {
    const obj = valor as { _bsontype?: string; toString?: () => string };
    if (typeof obj._bsontype === "string" && obj._bsontype !== "ObjectId" && typeof obj.toString === "function") {
      return obj.toString();
    }
  }
  return valor;
}

function bytesParaHex(bytes: Uint8Array): string {
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * A projeção de um documento numa linha da grade, na ordem das colunas dadas.
 *
 * Uma coluna ausente no documento vira `null` — no Mongo dois documentos da
 * mesma coleção não têm os mesmos campos, e a grade tem que aguentar isso sem
 * embaralhar as colunas.
 */
export function documentoEmLinha(doc: Document, colunas: readonly string[]): (string | null)[] {
  return colunas.map((c) => paraTexto((doc as Record<string, unknown>)[c]));
}
