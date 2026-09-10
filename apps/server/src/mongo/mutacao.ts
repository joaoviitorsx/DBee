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
 * Recusa um nome de campo de **topo** que não seja do catálogo, ou que comece
 * com `$`/`.`.
 *
 * O caminho de leitura já valida nome de campo contra o catálogo (`rows.ts`
 * `exigirColuna`). A escrita precisa da mesma tranca: sem ela, um
 * `column: "$where"` na guarda vira operador do Mongo — JavaScript no servidor
 * (achado ALTO do red-team). O `_id` sempre passa; o resto tem que estar nos
 * tipos inferidos e nunca começar com `$` (operador) nem conter `.`
 * (dot-notation, que navega para outro campo).
 *
 * Continua sendo a tranca do **primeiro segmento** de um path — `exigirPath` o
 * chama para o topo e estende a validação para os segmentos aninhados.
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

/**
 * Valida um path de campo — de topo (`preco`) ou aninhado (`endereco.cidade`) —
 * antes de ele virar chave de filtro ou de `$set`.
 *
 * ## A decisão de segurança
 *
 * No Mongo, a chave de um filtro/atualização é dot-notation: `"a.b"` navega até
 * o campo aninhado, e um nome começado por `$` é **operador**. Um
 * `$set: {"$where": …}`, ou um filtro `{"endereco.$gt": …}`, executaria lógica
 * do servidor a partir de entrada do usuário — o mesmo achado ALTO que travou a
 * edição de topo, agora pela porta do path. A regra §8 proíbe parser de
 * SQL/NoSQL do usuário, então a defesa é dupla e puramente estrutural:
 *
 *  1. **Sintática, por segmento, sem catálogo:** recusa path/segmento vazio e
 *     todo `$` e espaço em qualquer segmento. É o que barra `$where`, `a.$gt`,
 *     `endereco.$op` — nenhum operador do Mongo chega à chave, venha ele no
 *     começo ou no meio de um path.
 *  2. **Por catálogo:** o primeiro segmento tem que ser um campo de topo
 *     conhecido (`exigirCampo`, a tranca de sempre); cada segmento seguinte tem
 *     que ser um campo que a amostra revelou em profundidade, ou um índice de
 *     array (só dígitos). Um `__proto__`, ou um campo que ninguém amostrou, é
 *     desconhecido → recusado.
 *
 * O catálogo **não** amarra a estrutura pai→filho: o Mongo é sem schema e os
 * documentos são heterogêneos, então exigir que `cidade` só valha sob
 * `endereco` recusaria edição legítima de um documento com forma diferente da
 * amostrada. Ele amarra o **vocabulário** — o segmento é um nome de campo que a
 * coleção de fato usa, não uma string arbitrária vinda do cliente. É contenção
 * do acidente e da injeção, não promessa de schema.
 */
function exigirPath(
  path: string,
  topo: ReadonlyMap<string, string>,
  aninhados: ReadonlyMap<string, string>,
): void {
  if (!path.includes(".")) {
    exigirCampo(path, topo);
    return;
  }
  // `forEach` dá o segmento já como `string` (não `string | undefined` do índice
  // cru) e o `i` para tratar o primeiro segmento contra o catálogo de topo.
  path.split(".").forEach((seg, i) => {
    // Segmento vazio pega `""`, `"a."`, `".a"` e `"a..b"` — path malformado.
    if (seg === "") throw new MutacaoError(`path de campo inválido: "${path}"`);
    // `$` em qualquer posição é operador; espaço não é nome de campo aqui.
    if (seg.includes("$") || seg.includes(" ")) {
      throw new MutacaoError(`nome de campo inválido: "${seg}"`);
    }
    if (i === 0) {
      // Primeiro segmento: a tranca de topo de sempre.
      exigirCampo(seg, topo);
      return;
    }
    // Demais: campo aninhado conhecido, ou índice de array (dígitos).
    if (/^\d+$/.test(seg)) return;
    if (!aninhados.has(seg)) {
      throw new MutacaoError(`o campo "${seg}" (em "${path}") não aparece nesta coleção`);
    }
  });
}

/**
 * O tipo inferido para coagir o valor de um path (regra 10: valor é texto).
 *
 * Path de topo → tipo do catálogo de topo. Path aninhado → tipo da folha no
 * catálogo aninhado. Folha que é índice de array (ou campo não catalogado) fica
 * sem tipo → o texto passa como está, que é o padrão seguro de `coagir`.
 */
function tipoDePath(
  path: string,
  topo: ReadonlyMap<string, string>,
  aninhados: ReadonlyMap<string, string>,
): string | undefined {
  if (!path.includes(".")) return topo.get(path);
  const folha = path.split(".").at(-1);
  // Folha ausente (impossível: há `.`) ou índice de array → sem tipo → texto.
  if (folha === undefined || /^\d+$/.test(folha)) return undefined;
  return aninhados.get(folha);
}

export async function atualizar(
  cliente: MongoClient,
  database: string,
  colecao: string,
  req: RowUpdateRequest,
  tipos: ReadonlyMap<string, string>,
  aninhados: ReadonlyMap<string, string>,
): Promise<RowMutationResult> {
  for (const c of req.changes) exigirPath(c.column, tipos, aninhados);
  const filtro: Document = { ...filtroId(req.pk) };
  // Guarda otimista: o valor ORIGINAL de cada campo alterado entra no filtro.
  // Num path aninhado a chave é dot-notation (`{"endereco.cidade": "X"}`), que
  // casa o campo aninhado — se mudou desde a leitura, casa 0 → conflito.
  for (const c of req.changes) filtro[c.column] = valorCelula(c.from, tipoDePath(c.column, tipos, aninhados));
  // `$set` por path preserva o resto do documento (e os tipos BSON dos outros
  // campos): NUNCA reescrevemos o documento inteiro. Valor nulo vira
  // `$set: {path: null}` — "a célula é nula", como na edição de topo —, e não
  // `$unset`, para o contrato (e a guarda otimista) serem os mesmos dos dois.
  const set: Document = {};
  for (const c of req.changes) set[c.column] = valorCelula(c.to, tipoDePath(c.column, tipos, aninhados));

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
  aninhados: ReadonlyMap<string, string>,
): Promise<RowMutationResult> {
  for (const g of req.guard) exigirPath(g.column, tipos, aninhados);
  const filtro: Document = { ...filtroId(req.pk) };
  // Guarda: os valores originais das colunas não-PK lidas (path aninhado casa
  // por dot-notation, como no update).
  for (const g of req.guard) filtro[g.column] = valorCelula(g.value, tipoDePath(g.column, tipos, aninhados));

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
