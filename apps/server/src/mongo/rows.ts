import { ObjectId } from "mongodb";
import type { Filter, MongoClient, Document, Sort } from "mongodb";

import type { Relation, RowCursor, RowFilter, RowsRequest, RowsResponse } from "@dbee/shared";

import { RowsError } from "../driver/erros";
import { documentoEmLinha, paraTexto } from "./tipos";
import { coagir } from "./valores";

/**
 * A grade de documentos do MongoDB: filtro, ordenação e paginação.
 *
 * ## O que muda em relação às engines SQL
 *
 * Não há SQL — o filtro vira um objeto de query do Mongo, montado a partir da
 * mesma lista fechada de operadores que a grade usa nas outras engines. O nome
 * do campo é validado contra as colunas inferidas (o catálogo), como lá; o
 * valor vai como valor de query, nunca concatenado — no Mongo não existe
 * "concatenar no SQL", mas a disciplina é a mesma: entrada de usuário é dado.
 *
 * ## A paginação é por `_id`
 *
 * Todo documento tem `_id`, e ele é o cursor natural: ordenar por `_id` e
 * buscar `> ultimo._id` é keyset de graça, sempre determinístico. Quando a
 * pessoa ordena por outro campo, o `_id` entra como desempate — a mesma
 * armadilha de coluna repetida das outras engines, resolvida do mesmo jeito.
 *
 * ## As colunas vêm da amostra
 *
 * O catálogo inferiu os campos por amostragem. A resposta usa **essas** colunas,
 * então dois documentos com campos diferentes ainda caem nas mesmas colunas, e
 * um campo que só existe em alguns vira `null` onde falta.
 */

const LIMITE_PADRAO = 100;

type Direcao = "asc" | "desc";

/** O operador de comparação do Mongo para cada operador da grade. */
const OPERADOR: Record<string, string> = {
  eq: "$eq",
  ne: "$ne",
  lt: "$lt",
  lte: "$lte",
  gt: "$gt",
  gte: "$gte",
};


/** Um filtro da grade vira uma cláusula de query do Mongo. */
function clausula(filtro: RowFilter, tipos: ReadonlyMap<string, string>): Document {
  const campo = filtro.column;
  const tipo = tipos.get(campo);
  switch (filtro.operator) {
    case "isNull":
      // No Mongo, "nulo" e "ausente" são coisas diferentes; a grade quer as
      // duas — `null` casa os dois com `$eq: null`.
      return { [campo]: null };
    case "isNotNull":
      return { [campo]: { $ne: null } };
    case "contains":
      // `$regex` com o texto escapado: o valor do usuário não pode virar padrão.
      return { [campo]: { $regex: escaparRegex(filtro.value ?? ""), $options: "i" } };
    case "startsWith":
      return { [campo]: { $regex: `^${escaparRegex(filtro.value ?? "")}`, $options: "i" } };
    default: {
      const op = OPERADOR[filtro.operator];
      if (op === undefined) throw new RowsError("unknown_column", `operador desconhecido: ${filtro.operator}`);
      return { [campo]: { [op]: filtro.value == null ? null : coagir(filtro.value, tipo) } };
    }
  }
}

/** Escapa os metacaracteres de regex, para o valor ser literal. */
function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface PlanoMongo {
  readonly filtro: Filter<Document>;
  readonly ordenacao: Sort;
  readonly colunas: string[];
  readonly limite: number;
  readonly orderColumn: string | null;
}

/**
 * Monta o plano da página: filtro, ordenação (com `_id` de desempate) e as
 * colunas a projetar.
 */
export function planejarLinhas(relation: Relation, request: RowsRequest): PlanoMongo {
  const conhecidas = new Set(relation.columns.map((c) => c.name));
  const exigirColuna = (nome: string): void => {
    // O catálogo (amostra) é a autoridade sobre nome de campo. `_id` sempre
    // existe mesmo que a amostra não o tenha revelado como coluna.
    if (nome !== "_id" && !conhecidas.has(nome)) {
      throw new RowsError("unknown_column", `o campo "${nome}" não aparece em ${relation.name}`);
    }
  };

  // O tipo inferido de cada campo, para coagir o texto do filtro/cursor de volta.
  const tipos = new Map(relation.columns.map((c) => [c.name, c.dataType]));

  const direcao: Direcao = request.orderDirection ?? "asc";
  const orderColumn = request.orderBy ?? null;
  if (orderColumn !== null) exigirColuna(orderColumn);
  for (const f of request.filters ?? []) exigirColuna(f.column);

  const clausulas = (request.filters ?? []).map((f) => clausula(f, tipos));
  const filtroBase: Document = clausulas.length === 0 ? {} : { $and: clausulas };

  // O cursor: avança depois do último visto. Com coluna de ordenação, o keyset
  // é sobre `(coluna, _id)`; sem, é só `_id`. O valor de ordenação do cursor é
  // coagido pelo mesmo tipo da coluna.
  const cursorFiltro =
    request.after === undefined
      ? undefined
      : condicaoKeyset(request.after, orderColumn, direcao, orderColumn === null ? undefined : tipos.get(orderColumn));
  const filtro: Filter<Document> =
    cursorFiltro === undefined
      ? filtroBase
      : clausulas.length === 0
        ? cursorFiltro
        : { $and: [...clausulas, cursorFiltro] };

  const dir = direcao === "asc" ? 1 : -1;
  const ordenacao: Sort = orderColumn === null ? { _id: dir } : { [orderColumn]: dir, _id: dir };

  const colunas = ["_id", ...relation.columns.map((c) => c.name).filter((n) => n !== "_id")];

  return {
    filtro,
    ordenacao,
    colunas,
    limite: request.limit ?? LIMITE_PADRAO,
    orderColumn,
  };
}

/**
 * A condição de keyset para o Mongo, na forma canônica com `$or` — e com a
 * região de null/ausente tratada como nas engines SQL.
 *
 * No Mongo, **campo ausente ordena como null**, e null é o menor valor: em
 * `asc` ele vem primeiro, em `desc` por último. `{campo: null}` casa os dois
 * (ausente e null); `{campo: {$ne: null}}` casa os presentes não-nulos. É com
 * essas duas peças que a fronteira da região de null é atravessada sem pular
 * nem repetir — a mesma armadilha do keyset com NULL, na gramática do Mongo.
 *
 * `$gt: null`/`$lt: null` **não** servem: a comparação do Mongo é por faixa de
 * tipo, e null é sua própria faixa — `$gt: null` não casa valor nenhum. Por
 * isso o "resto depois dos nulls" é `{$ne: null}`, não `{$gt: null}`.
 */
function condicaoKeyset(
  cursor: RowCursor,
  orderColumn: string | null,
  direcao: Direcao,
  tipoOrdem: string | undefined,
): Document {
  const cmp = direcao === "asc" ? "$gt" : "$lt";
  const idValor = valorId(cursor.primaryKey[0] ?? "");

  if (orderColumn === null) {
    return { _id: { [cmp]: idValor } };
  }

  if (cursor.orderValueIsNull) {
    // Cursor dentro da região de null/ausente.
    if (direcao === "asc") {
      // Ainda há o resto dos nulls (desempate por _id) e depois todos os não-nulos.
      return { $or: [{ [orderColumn]: null, _id: { $gt: idValor } }, { [orderColumn]: { $ne: null } }] };
    }
    // Em desc os nulls vêm por último: só sobra o resto da região de null.
    return { [orderColumn]: null, _id: { $lt: idValor } };
  }

  // O valor de ordenação do cursor volta ao tipo da coluna, como no filtro.
  const v = cursor.orderValue === null ? null : coagir(cursor.orderValue, tipoOrdem);
  const canonica: Document[] = [
    { [orderColumn]: { [cmp]: v } },
    { [orderColumn]: v, _id: { [cmp]: idValor } },
  ];
  // Cursor num valor não-nulo. Em desc, a região de null ainda está por vir e
  // precisa entrar; em asc, ela já passou (null é o menor) e `{$gt: v}` a exclui.
  if (direcao === "desc") canonica.push({ [orderColumn]: null });
  return { $or: canonica };
}

/**
 * O valor de `_id` para comparar, reconstruído do texto do cursor.
 *
 * O `_id` do Mongo é de qualquer tipo, e a comparação dele é **por faixa de
 * tipo**: um `_id` inteiro nunca é maior que a string `"1"`. Então o texto do
 * cursor tem que voltar ao tipo original:
 *
 * - hex de 24 → `ObjectId` (o caso esmagadoramente comum);
 * - inteiro → `number` (coleções com `_id` numérico);
 * - o resto → a string como está.
 *
 * Um `_id` string de dígitos puros (raro) seria lido como número — a única
 * ambiguidade, e o preço de o cursor viajar em texto (regra 10).
 */
function valorId(texto: string): unknown {
  if (/^[0-9a-f]{24}$/i.test(texto)) return new ObjectId(texto);
  if (/^-?\d+$/.test(texto)) return Number(texto);
  return texto;
}

/** Executa o plano e monta a resposta, com o cursor da próxima página. */
export async function lerLinhas(
  cliente: MongoClient,
  database: string,
  relation: Relation,
  request: RowsRequest,
): Promise<RowsResponse> {
  const inicio = performance.now();
  const plano = planejarLinhas(relation, request);

  const docs = await cliente
    .db(database)
    .collection(relation.name)
    .find(plano.filtro, { sort: plano.ordenacao, limit: plano.limite + 1 })
    .toArray();

  const hasMore = docs.length > plano.limite;
  const usadas = hasMore ? docs.slice(0, plano.limite) : docs;
  const rows = usadas.map((doc) => documentoEmLinha(doc, plano.colunas));

  const ultima = usadas[usadas.length - 1];
  const nextCursor: RowCursor | null =
    !hasMore || ultima === undefined
      ? null
      : {
          orderValue: plano.orderColumn === null ? null : paraTexto((ultima as Record<string, unknown>)[plano.orderColumn]),
          orderValueIsNull:
            plano.orderColumn !== null &&
            paraTexto((ultima as Record<string, unknown>)[plano.orderColumn]) === null,
          primaryKey: [paraTexto((ultima as Record<string, unknown>)["_id"]) ?? ""],
        };

  return {
    columns: relation.columns.map((c) => ({
      name: c.name,
      dataTypeId: c.dataTypeId,
      dataTypeName: c.dataType,
    })),
    rows,
    nextCursor,
    hasMore,
    durationMs: Math.round(performance.now() - inicio),
    // Sempre keyset: `_id` está sempre disponível.
    keyset: true,
    primaryKey: ["_id"],
  };
}

export { RowsError } from "../driver/erros";
