import type { RedisClient } from "bun";

import type { RowCursor, RowFilter, RowsRequest, RowsResponse } from "@dbee/shared";

import { RowsError } from "../driver/erros";
import { lerValor, type ChaveRedis, type TipoRedis } from "./tipos";

/**
 * A grade de chaves de um db Redis, navegada por `SCAN`.
 *
 * ## `SCAN`, nunca `KEYS`
 *
 * `KEYS *` trava um Redis de produção — é O(n) bloqueante no servidor inteiro.
 * `SCAN` é incremental: devolve um cursor opaco e um punhado de chaves por vez,
 * sem bloquear. O cursor do DBee (`RowCursor`) carrega esse cursor do Redis na
 * chave primária, e a paginação é ele avançando. Não há ordenação: o `SCAN` não
 * a promete, e forçá-la exigiria `KEYS` — exatamente o que não se pode fazer.
 *
 * ## O filtro é `MATCH`, e só sobre a chave
 *
 * O único filtro que o `SCAN` aceita é `MATCH pattern` sobre o **nome da
 * chave** — glob, não regex. Então os operadores da grade que fazem sentido são
 * os de texto na coluna `key`; qualquer filtro sobre `value`/`type`/`ttl` é
 * aplicado **depois**, na página lida (o Redis não indexa valor). A grade
 * avisa que o filtro é sobre a chave; filtrar valor varreria o banco.
 *
 * ## Uma página custa N+1 comandos
 *
 * Para cada chave o tipo (`TYPE`), o ttl (`TTL`) e o valor (um comando por
 * tipo). É o preço de o Redis não ter catálogo: não há como saber o tipo de uma
 * chave sem perguntar. Uma página de 100 chaves são ~300 comandos, todos
 * pequenos e no mesmo pipeline TCP — medido em poucos ms.
 */

const LIMITE_PADRAO = 100;

/** O glob de `MATCH` a partir dos filtros da grade sobre a coluna `key`. */
function padraoMatch(filtros: readonly RowFilter[]): string {
  for (const f of filtros) {
    if (f.column !== "key") continue;
    const v = f.value ?? "";
    switch (f.operator) {
      case "eq":
        return escaparGlob(v);
      case "contains":
        return `*${escaparGlob(v)}*`;
      case "startsWith":
        return `${escaparGlob(v)}*`;
      default:
        break;
    }
  }
  return "*";
}

/** Escapa os metacaracteres de glob do Redis (`*`, `?`, `[`, `]`, `\`). */
function escaparGlob(texto: string): string {
  return texto.replace(/[*?[\]\\]/g, "\\$&");
}

export interface PlanoRedis {
  readonly match: string;
  readonly cursorScan: string;
  readonly limite: number;
  /** Filtros que não são sobre a `key` — aplicados na página lida. */
  readonly posFiltros: readonly RowFilter[];
}

export function planejarLinhas(request: RowsRequest): PlanoRedis {
  const filtros = request.filters ?? [];
  const colunasValidas = new Set(["key", "type", "ttl", "value"]);
  for (const f of filtros) {
    if (!colunasValidas.has(f.column)) {
      throw new RowsError("unknown_column", `a coluna "${f.column}" não existe em keys`);
    }
  }
  return {
    match: padraoMatch(filtros),
    // O cursor do Redis vem na chave primária do RowCursor; "0" inicia.
    cursorScan: request.after?.primaryKey[0] ?? "0",
    limite: request.limit ?? LIMITE_PADRAO,
    posFiltros: filtros.filter((f) => f.column !== "key"),
  };
}

/** Um filtro de pós-página casa contra a linha já lida. */
function casaPosFiltro(chave: ChaveRedis, f: RowFilter): boolean {
  const alvo = f.column === "type" ? chave.type : f.column === "ttl" ? String(chave.ttl) : (chave.value ?? "");
  const v = f.value ?? "";
  switch (f.operator) {
    case "eq":
      return alvo === v;
    case "ne":
      return alvo !== v;
    case "contains":
      return alvo.includes(v);
    case "startsWith":
      return alvo.startsWith(v);
    case "isNull":
      return chave.value === null;
    case "isNotNull":
      return chave.value !== null;
    default:
      return true;
  }
}

/** Lê uma página de chaves via `SCAN`, com tipo, ttl e valor de cada. */
export async function lerLinhas(
  cliente: RedisClient,
  request: RowsRequest,
): Promise<RowsResponse> {
  const inicio = performance.now();
  const plano = planejarLinhas(request);

  /*
   * `SCAN` pode devolver menos (ou zero) chaves e ainda ter mais — o cursor é
   * quem diz. Itera até juntar `limite` chaves ou o cursor voltar a "0" (fim).
   * O `COUNT` é uma dica, não um limite; pedimos o dobro do limite para reduzir
   * as idas quando o `MATCH` filtra muito.
   */
  const chaves: ChaveRedis[] = [];
  let cursor = plano.cursorScan;
  let voltas = 0;

  do {
    const [novoCursor, lote] = (await cliente.send("SCAN", [
      cursor,
      "MATCH",
      plano.match,
      "COUNT",
      String(plano.limite * 2),
    ])) as [string, string[]];

    /*
     * O lote inteiro é consumido — **nunca** um break no meio. O cursor do
     * `SCAN` avança depois do lote todo; parar na metade perderia as chaves
     * restantes dele, que nenhum cursor retomaria. O corte de página é a
     * condição do `while`, checada só ao fim de cada lote.
     */
    for (const key of lote) {
      const tipo = (await cliente.send("TYPE", [key])) as TipoRedis;
      const ttl = (await cliente.send("TTL", [key])) as number;
      const value = await lerValor(cliente, key, tipo);
      const chave: ChaveRedis = { key, type: tipo, ttl, value };
      if (plano.posFiltros.every((f) => casaPosFiltro(chave, f))) chaves.push(chave);
    }

    cursor = novoCursor;
    voltas += 1;
    // Para quando o Redis fecha o ciclo ("0"), quando a página já tem o
    // suficiente, ou num teto de voltas — um MATCH muito seletivo poderia
    // varrer o banco todo.
  } while (cursor !== "0" && chaves.length < plano.limite && voltas < 50);

  /*
   * O tamanho da página segue o `SCAN`, não um corte fixo — e a razão é o
   * cursor "0", que significa **início e fim ao mesmo tempo**. Se cortássemos
   * em `limite` e o `SCAN` já tivesse fechado o ciclo (cursor "0"), as chaves
   * cortadas se perderiam: não há cursor que as retome, e devolver "0" como
   * próxima página reiniciaria do começo. Então:
   *
   * - ciclo fechado (`cursor === "0"`): **todas** as chaves coletadas viram a
   *   página, e não há próxima. A página pode passar de `limite` — é o preço de
   *   o SCAN não cortar onde a gente quer.
   * - ciclo aberto: a página é o que juntamos, e a próxima retoma no `cursor`.
   */
  const fim = cursor === "0";
  const rows = chaves.map((c) => [c.key, c.type, String(c.ttl), c.value]);

  const nextCursor: RowCursor | null = fim
    ? null
    : { orderValue: null, orderValueIsNull: false, primaryKey: [cursor] };
  const hasMore = !fim;

  return {
    columns: [
      { name: "key", dataTypeId: 0, dataTypeName: "string" },
      { name: "type", dataTypeId: 1, dataTypeName: "string" },
      { name: "ttl", dataTypeId: 2, dataTypeName: "number" },
      { name: "value", dataTypeId: 3, dataTypeName: "string" },
    ],
    rows,
    nextCursor,
    hasMore,
    durationMs: Math.round(performance.now() - inicio),
    // Keyset por cursor do SCAN — determinístico no sentido do Redis (cada
    // chave é vista uma vez ao longo de um ciclo completo).
    keyset: true,
    primaryKey: ["key"],
  };
}

export { RowsError } from "../driver/erros";
