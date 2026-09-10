import type { RedisClient } from "bun";

/**
 * O valor de uma chave Redis como **texto** (regra 10) — e são seis formas.
 *
 * O Redis não tem linha nem coluna: tem chave → valor, e o valor tem seis tipos
 * (`string`, `hash`, `list`, `set`, `zset`, `stream`), cada um lido por um
 * comando diferente. A grade do DBee mostra uma linha por chave, e a coluna
 * `value` traz o valor **renderizado por tipo**, sempre em texto:
 *
 * - `string` → o texto como está
 * - `hash`   → JSON do objeto campo→valor
 * - `list`   → JSON do array (ordem preservada)
 * - `set`    → JSON do array (ordem do servidor)
 * - `zset`   → JSON de `[membro, score]` na ordem do score
 * - `stream` → resumo `N entradas (primeiro… último)`, porque um stream inteiro
 *   não cabe numa célula e o valor útil é o tamanho e a janela de ids
 *
 * O valor é **truncado** por tamanho: a grade é uma visão, não um dump. Um
 * `string` de megabytes ou uma `list` de milhões vira uma amostra com a marca
 * do quanto sobrou — ver `LIMITE_VALOR`.
 */

/** Quantos itens de uma coleção (hash/list/set/zset) trazer para a célula. */
const LIMITE_ITENS = 100;
/** Teto de caracteres do texto renderizado numa célula. */
const LIMITE_VALOR = 2000;

/** O tipo de uma chave (`TYPE`), num literal fechado. `none` = chave sumiu. */
export type TipoRedis = "string" | "hash" | "list" | "set" | "zset" | "stream" | "none";

/** O que o `SCAN` de uma página produz por chave, antes de virar linha. */
export interface ChaveRedis {
  readonly key: string;
  readonly type: TipoRedis;
  /** Segundos até expirar; `-1` sem expiração, `-2` chave inexistente. */
  readonly ttl: number;
  readonly value: string | null;
}

/** Trunca com marca do que sobrou. */
function truncar(texto: string): string {
  if (texto.length <= LIMITE_VALOR) return texto;
  return `${texto.slice(0, LIMITE_VALOR)}…(+${String(texto.length - LIMITE_VALOR)})`;
}

/**
 * Lê o valor de uma chave, pelo tipo, já em texto e truncado.
 *
 * Um comando por tipo — não há como ler "o valor" de uma chave Redis sem saber
 * o tipo dela primeiro. O `tipo` vem do `TYPE`, feito antes.
 */
export async function lerValor(
  cliente: RedisClient,
  key: string,
  tipo: TipoRedis,
): Promise<string | null> {
  switch (tipo) {
    case "none":
      return null;
    case "string":
      return truncar((await cliente.send("GET", [key])) as string);
    case "hash": {
      const plano = (await cliente.send("HGETALL", [key])) as Record<string, string>;
      return truncar(JSON.stringify(plano));
    }
    case "list": {
      const itens = (await cliente.send("LRANGE", [key, "0", String(LIMITE_ITENS - 1)])) as string[];
      return truncar(JSON.stringify(itens));
    }
    case "set": {
      const itens = (await cliente.send("SSCAN", [key, "0", "COUNT", String(LIMITE_ITENS)])) as [
        string,
        string[],
      ];
      return truncar(JSON.stringify(itens[1]));
    }
    case "zset": {
      const plano = (await cliente.send("ZRANGE", [
        key,
        "0",
        String(LIMITE_ITENS - 1),
        "WITHSCORES",
      ])) as unknown[];
      // O Bun devolve `zrange WITHSCORES` como pares `[membro, score]`; passa como está.
      return truncar(JSON.stringify(plano));
    }
    case "stream": {
      const total = (await cliente.send("XLEN", [key])) as number;
      const primeiro = (await cliente.send("XRANGE", [key, "-", "+", "COUNT", "1"])) as unknown[];
      const ultimo = (await cliente.send("XREVRANGE", [key, "+", "-", "COUNT", "1"])) as unknown[];
      const idDe = (e: unknown): string => (Array.isArray(e) && typeof e[0] === "string" ? e[0] : "?");
      return `${String(total)} entradas (${idDe(primeiro[0])}…${idDe(ultimo[0])})`;
    }
  }
}
