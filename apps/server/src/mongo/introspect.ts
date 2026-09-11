import type { MongoClient, Document } from "mongodb";

import type {
  Column,
  DatabaseInfo,
  DatabaseSchema,
  DatabaseTree,
  Index,
  Relation,
  RelationTree,
} from "@dbee/shared";

/**
 * Ler o catálogo de um MongoDB.
 *
 * ## Um Mongo não tem schema, e é isso que muda tudo
 *
 * Não há colunas declaradas, nem tipos fixos, nem chave estrangeira. O que
 * existe é: cluster → database → coleção → documentos, e cada documento é livre.
 * O DBee mapeia isso na forma relacional que a grade já entende, **inferindo**
 * as colunas por amostragem:
 *
 * - a coleção vira uma `Relation` de `kind: "table"` (o glifo da conexão já diz
 *   que é Mongo; um `kind` novo cascataria exaustividade por toda a UI);
 * - as **colunas** são os campos de primeiro nível vistos numa amostra de
 *   documentos — não são o schema, são o que a amostra revelou, e a UI mostra
 *   isso como "os campos que aparecem", não como uma promessa;
 * - a **chave primária** é sempre `["_id"]`, que todo documento tem e que é o
 *   cursor natural da paginação;
 * - sem chaves estrangeiras e sem índices declarados como no SQL (os índices
 *   reais existem, e entram, mas não há FK a inferir).
 */

/** Quantos documentos amostrar para descobrir os campos. */
const AMOSTRA = 25;

/** Nome do "database" quando a conexão não dá um. */
export const NOME_PADRAO = "test";

/**
 * Os databases visíveis ao usuário, marcando o da conexão.
 *
 * `admin`, `config` e `local` são internos do Mongo; ficam de fora da árvore
 * porque ninguém navega neles no dia a dia, e mostrá-los é ruído — exceto se um
 * deles for o database configurado (raro, mas então é intencional).
 */
const INTERNOS = new Set(["admin", "config", "local"]);

export async function listarDatabases(
  cliente: MongoClient,
  databaseDaConexao: string,
): Promise<DatabaseInfo[]> {
  const alvo = databaseDaConexao === "" ? NOME_PADRAO : databaseDaConexao;
  const { databases } = await cliente.db("admin").admin().listDatabases({ nameOnly: true });
  const nomes = databases
    .map((d) => d.name)
    .filter((nome) => !INTERNOS.has(nome) || nome === alvo);
  // Garante que o database da conexão aparece, mesmo vazio (o Mongo só lista
  // database depois que ele tem dados).
  if (!nomes.includes(alvo)) nomes.unshift(alvo);
  return nomes.sort().map((name) => ({ name, isDefault: name === alvo }));
}

/** A árvore leve: as coleções de um database. */
export async function introspectarArvore(
  cliente: MongoClient,
  database: string,
): Promise<DatabaseTree> {
  const colecoes = await listarColecoes(cliente, database);
  const relations: RelationTree[] = colecoes.map((nome) => ({
    name: nome,
    kind: "table",
    // Sem contagem: `estimatedDocumentCount` é barato, mas a árvore leve não
    // conta linha nenhuma nas outras engines. `null`, e a grade conta ao abrir.
    estimatedRows: null,
  }));
  return {
    database,
    schemas: [{ name: database, relations }],
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

/** O catálogo completo: uma `Relation` por coleção, com campos inferidos. */
export async function introspectarCompleto(
  cliente: MongoClient,
  database: string,
): Promise<DatabaseSchema> {
  const db = cliente.db(database);
  const nomes = await listarColecoes(cliente, database);

  const relations: Relation[] = [];
  for (const nome of nomes) {
    const colecao = db.collection(nome);
    // Amostra os primeiros documentos para descobrir os campos. `find().limit`
    // e não `$sample`: `$sample` custa mais e a ordem não importa para inferir.
    const amostra = await colecao.find({}, { limit: AMOSTRA }).toArray();
    const columns = inferirColunas(amostra);

    let indexes: Index[];
    try {
      const idx = await colecao.indexes();
      indexes = idx.map((i): Index => ({
        name: typeof i.name === "string" ? i.name : "(sem nome)",
        columns: Object.keys(i.key as Record<string, unknown>),
        isUnique: i.unique === true,
        isPrimary: i.name === "_id_",
        definition: `${i.unique === true ? "UNIQUE " : ""}INDEX ${JSON.stringify(i.key)}`,
      }));
    } catch {
      indexes = [];
    }

    relations.push({
      name: nome,
      kind: "table",
      comment: null,
      estimatedRows: null,
      columns,
      primaryKey: ["_id"],
      foreignKeys: [],
      indexes,
    });
  }

  return {
    database,
    schemas: [{ name: database, relations }],
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

/** Nomes das coleções de um database (sem as coleções de sistema). */
async function listarColecoes(cliente: MongoClient, database: string): Promise<string[]> {
  const cols = await cliente.db(database).listCollections({}, { nameOnly: true }).toArray();
  return cols
    .map((c) => c.name)
    .filter((nome) => !nome.startsWith("system."))
    .sort();
}

/**
 * Os campos de primeiro nível de uma amostra de documentos, como colunas.
 *
 * `_id` vem sempre primeiro (todo documento tem, e é a chave). O resto na ordem
 * em que aparece — a ordem dos campos num documento Mongo é significativa e
 * estável, então segui-la dá a tabela mais parecida com o que a pessoa vê.
 *
 * O tipo é **inferido da amostra**, e diz "mixed" quando a coleção é
 * heterogênea — que é a verdade, e melhor que fingir um tipo único.
 */
function inferirColunas(amostra: readonly Document[]): Column[] {
  const ordem: string[] = [];
  const tipos = new Map<string, Set<string>>();

  for (const doc of amostra) {
    for (const chave of Object.keys(doc)) {
      if (!tipos.has(chave)) {
        tipos.set(chave, new Set());
        ordem.push(chave);
      }
      tipos.get(chave)?.add(tipoBson((doc as Record<string, unknown>)[chave]));
    }
  }

  // `_id` na frente, o resto na ordem de aparição.
  ordem.sort((a, b) => (a === "_id" ? -1 : b === "_id" ? 1 : 0));

  return ordem.map((nome, i) => {
    const conjunto = tipos.get(nome) ?? new Set<string>();
    const dataType = conjunto.size === 1 ? [...conjunto][0] ?? "mixed" : "mixed";
    return {
      name: nome,
      dataType,
      // O `dataTypeId` não vem de um OID (Mongo não tem): é um índice estável
      // dentro da engine, e a posição serve.
      dataTypeId: i,
      // Todo campo Mongo é opcional; dizer o contrário seria mentira.
      nullable: nome !== "_id",
      defaultValue: null,
      position: i,
      isPrimaryKey: nome === "_id",
      comment: null,
    };
  });
}

/**
 * O catálogo de campos de uma coleção, para o caminho de **escrita**.
 *
 * `topo` é o mesmo catálogo que as colunas da grade usam — campo de primeiro
 * nível → tipo inferido. `aninhados` são os nomes de campo vistos em
 * profundidade (dentro de sub-documento ou de elemento de array), que o
 * validador de path da edição aninhada consulta. São mapas separados de
 * propósito: o primeiro segmento de um path tem que ser um campo de topo, e um
 * nome que só existe no topo não pode, por acidente, valer como segmento
 * aninhado (ver `exigirPath` em `mutacao.ts`).
 */
export interface CatalogoCampos {
  readonly topo: ReadonlyMap<string, string>;
  readonly aninhados: ReadonlyMap<string, string>;
}

/**
 * Amostra uma coleção **uma vez** e infere os campos de topo e os aninhados.
 *
 * É o que a edição de documento chama pela credencial de leitura para tipar os
 * valores e validar os nomes de campo. Amostra só a coleção alvo — mais barato
 * que introspectar o database inteiro só para pegar uma coleção.
 */
export async function inferirCatalogoCampos(
  cliente: MongoClient,
  database: string,
  colecao: string,
): Promise<CatalogoCampos> {
  const amostra = await cliente.db(database).collection(colecao).find({}, { limit: AMOSTRA }).toArray();
  const topo = new Map(inferirColunas(amostra).map((c) => [c.name, c.dataType]));
  return { topo, aninhados: inferirCamposAninhados(amostra) };
}

/**
 * Os nomes de campo vistos em qualquer nível **aninhado** (profundidade >= 1)
 * da amostra, cada um com o tipo inferido (`mixed` se aparece com tipos
 * diferentes).
 *
 * Serve ao validador de path da escrita: um segmento não-primeiro de
 * `endereco.cidade` só passa se `cidade` for um campo que a amostra de fato
 * revelou dentro de algum documento. Campo de **topo** não entra aqui — o
 * primeiro segmento é validado contra o catálogo de topo, e um nome que só
 * existe no topo não pode virar, por acidente, um segmento aninhado válido.
 */
function inferirCamposAninhados(amostra: readonly Document[]): Map<string, string> {
  const vistos = new Map<string, Set<string>>();

  const descer = (valor: unknown): void => {
    if (Array.isArray(valor)) {
      // Um elemento de array pode ser um sub-documento com campos próprios; o
      // índice em si não é nome de campo (o validador o aceita como dígito).
      for (const item of valor) descer(item);
      return;
    }
    if (!ehSubDocumento(valor)) return;
    for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
      if (!vistos.has(chave)) vistos.set(chave, new Set());
      vistos.get(chave)?.add(tipoBson(v));
      descer(v);
    }
  };

  // Só os VALORES de topo entram no `descer` — as chaves de topo são o catálogo
  // de topo, não campos aninhados.
  for (const doc of amostra) {
    const registro = doc as Record<string, unknown>;
    for (const chave of Object.keys(registro)) descer(registro[chave]);
  }

  return new Map(
    [...vistos].map(([nome, conjunto]) => [nome, conjunto.size === 1 ? [...conjunto][0] ?? "mixed" : "mixed"]),
  );
}

/**
 * É um sub-documento navegável (objeto simples), e não um valor BSON que só
 * *parece* objeto? Data, `ObjectId`, `Decimal128` etc. são folhas — descer
 * neles inventaria "campos" como `_bsontype`, que não existem no documento.
 */
function ehSubDocumento(valor: unknown): boolean {
  if (valor === null || typeof valor !== "object") return false;
  if (Array.isArray(valor) || valor instanceof Date) return false;
  return (valor as { _bsontype?: string })._bsontype === undefined;
}

/** O tipo BSON de um valor, num nome curto para a coluna. */
function tipoBson(valor: unknown): string {
  if (valor === null || valor === undefined) return "null";
  if (typeof valor === "string") return "string";
  if (typeof valor === "boolean") return "bool";
  if (typeof valor === "number") return "number";
  if (Array.isArray(valor)) return "array";
  if (valor instanceof Date) return "date";
  if (typeof valor === "object") {
    const b = (valor as { _bsontype?: string })._bsontype;
    if (b === "ObjectId") return "objectId";
    if (typeof b === "string") return b.toLowerCase();
    return "object";
  }
  return "mixed";
}
