import type { Filter, MongoClient, Document } from "mongodb";
import { ObjectId } from "mongodb";

import type {
  RowDeleteRequest,
  RowInsertRequest,
  RowMutationResult,
  RowUpdateRequest,
} from "@dbee/shared";

import { MutacaoError } from "../driver/erros";
import { coagir } from "./valores";

/**
 * Edição de documento no MongoDB, pela credencial de escrita.
 *
 * O DBee edita "linha" — célula, exclusão, inserção. No Mongo isso vira, na
 * mesma ordem: `updateOne({_id, ...guarda}, {$set})`, `deleteOne({_id,
 * ...guarda})`, `insertOne(doc)`. A guarda otimista (os valores originais que a
 * grade leu) entra **no filtro**: se outra pessoa mexeu no documento entre a
 * leitura e o clique, o filtro casa zero e nada muda — o mesmo contrato do
 * `WHERE` da guarda no Postgres.
 *
 * ## O `_id` volta ao tipo
 *
 * A grade manda o `_id` como texto (regra 10). Um `updateOne({_id: "1"})` não
 * casa `_id: 1`, e `{_id: "507f…"}` não casa um `ObjectId`. `valorId` reconstrói
 * o tipo — ObjectId de hex-24, número de dígitos, texto no resto. É o mesmo de
 * `rows.ts`, e a ambiguidade (um `_id` string de dígitos) é a mesma e rara.
 */

/** O `_id` para o filtro: ObjectId, número ou texto. */
function valorId(texto: string): unknown {
  if (/^[0-9a-f]{24}$/i.test(texto)) return new ObjectId(texto);
  if (/^-?\d+$/.test(texto)) return Number(texto);
  return texto;
}

/**
 * Um valor de célula (texto|null) vira valor de documento, coagido ao tipo
 * inferido do campo. É o que faz a guarda casar (`{preco: 18.9}`, não
 * `{preco: "18.9"}`) e o `$set` gravar o tipo certo.
 */
function valorCelula(v: string | null, tipo: string | undefined): unknown {
  return v === null ? null : coagir(v, tipo);
}

/** O filtro base: o `_id` da PK. O Mongo só tem `_id` como chave. */
function filtroId(pk: readonly { column: string; value: string }[]): Filter<Document> {
  const id = pk.find((p) => p.column === "_id");
  if (id === undefined) {
    throw new MutacaoError("a edição no MongoDB exige o _id do documento");
  }
  return { _id: valorId(id.value) } as Filter<Document>;
}

/**
 * Recusa um nome de campo que não seja do catálogo, ou que comece com `$`/`.`.
 *
 * O caminho de leitura já valida nome de campo contra o catálogo (`rows.ts`
 * `exigirColuna`). A escrita precisa da mesma tranca: sem ela, um
 * `column: "$where"` na guarda vira operador do Mongo — JavaScript no servidor
 * (achado ALTO do red-team). O `_id` sempre passa; o resto tem que estar nos
 * tipos inferidos e nunca começar com `$` (operador) nem conter `.`
 * (dot-notation, que navega para outro campo).
 */
function exigirCampo(nome: string, tipos: ReadonlyMap<string, string>): void {
  if (nome === "_id") return;
  if (nome.startsWith("$") || nome.includes(".")) {
    throw new MutacaoError(`nome de campo inválido: "${nome}"`);
  }
  if (!tipos.has(nome)) {
    throw new MutacaoError(`o campo "${nome}" não existe nesta coleção`);
  }
}

export async function atualizar(
  cliente: MongoClient,
  database: string,
  colecao: string,
  req: RowUpdateRequest,
  tipos: ReadonlyMap<string, string>,
): Promise<RowMutationResult> {
  for (const c of req.changes) exigirCampo(c.column, tipos);
  const filtro: Document = { ...filtroId(req.pk) };
  // Guarda otimista: o valor ORIGINAL de cada campo alterado entra no filtro.
  for (const c of req.changes) filtro[c.column] = valorCelula(c.from, tipos.get(c.column));
  const set: Document = {};
  for (const c of req.changes) set[c.column] = valorCelula(c.to, tipos.get(c.column));

  const r = await cliente.db(database).collection(colecao).updateOne(filtro, { $set: set });
  const sql = `db.${colecao}.updateOne(${JSON.stringify(filtro)}, { $set: ${JSON.stringify(set)} })`;
  return { rowCount: r.matchedCount, sql };
}

export async function excluir(
  cliente: MongoClient,
  database: string,
  colecao: string,
  req: RowDeleteRequest,
  tipos: ReadonlyMap<string, string>,
): Promise<RowMutationResult> {
  for (const g of req.guard) exigirCampo(g.column, tipos);
  const filtro: Document = { ...filtroId(req.pk) };
  // Guarda: os valores originais das colunas não-PK lidas.
  for (const g of req.guard) filtro[g.column] = valorCelula(g.value, tipos.get(g.column));

  const r = await cliente.db(database).collection(colecao).deleteOne(filtro);
  const sql = `db.${colecao}.deleteOne(${JSON.stringify(filtro)})`;
  return { rowCount: r.deletedCount, sql };
}

export async function inserir(
  cliente: MongoClient,
  database: string,
  colecao: string,
  req: RowInsertRequest,
  tipos: ReadonlyMap<string, string>,
): Promise<RowMutationResult> {
  for (const v of req.values) {
    // Insert pode criar campos novos (não exige catálogo), mas nunca operador.
    if (v.column.startsWith("$") || v.column.includes(".")) {
      throw new MutacaoError(`nome de campo inválido: "${v.column}"`);
    }
  }
  const doc: Document = {};
  for (const v of req.values) doc[v.column] = valorCelula(v.value, tipos.get(v.column));
  // Se o usuário deu `_id` texto, respeita o tipo; senão o Mongo gera um ObjectId.
  if (typeof doc["_id"] === "string") doc["_id"] = valorId(doc["_id"]);

  const r = await cliente.db(database).collection(colecao).insertOne(doc);
  const sql = `db.${colecao}.insertOne(${JSON.stringify(doc)})`;
  return { rowCount: r.acknowledged ? 1 : 0, sql };
}
