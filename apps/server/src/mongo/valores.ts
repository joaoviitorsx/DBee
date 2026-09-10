import { ObjectId } from "mongodb";

/**
 * O valor (texto, regra 10) coagido ao **tipo inferido da coluna**.
 *
 * Compartilhado pela leitura (filtro/cursor) e pela escrita (guarda/`$set`).
 * O Mongo compara e casa **por tipo**: `{idade: "30"}` não casa `idade: 30`, e
 * `{_id: "507f…"}` não casa um `ObjectId`. O catálogo inferiu o tipo de cada
 * campo por amostragem, e é ele que diz como o texto volta ao tipo do banco:
 *
 * - `number` → número; `bool` → booleano; `date` → `Date`; `objectId` → `ObjectId`;
 * - o resto (inclusive `mixed`) fica texto — o comportamento seguro.
 *
 * Coerção que falha (texto não-numérico numa coluna `number`) devolve o texto
 * original: melhor não casar nada do que estourar.
 */
export function coagir(texto: string, tipo: string | undefined): unknown {
  switch (tipo) {
    case "number": {
      const n = Number(texto);
      return Number.isFinite(n) ? n : texto;
    }
    case "bool":
      return texto === "true" ? true : texto === "false" ? false : texto;
    case "date": {
      const d = new Date(texto);
      return Number.isNaN(d.getTime()) ? texto : d;
    }
    case "objectId":
      return /^[0-9a-f]{24}$/i.test(texto) ? new ObjectId(texto) : texto;
    default:
      return texto;
  }
}
