import type {
  Column,
  DatabaseInfo,
  DatabaseSchema,
  DatabaseTree,
  ForeignKey,
  Index,
  Relation,
  RelationKind,
  RelationTree,
} from "@dbee/shared";

import { arg, executarSql, type AlvoLibsql } from "./cliente";
import { paraTexto, type ResultadoLibsql } from "./protocolo";

/**
 * Ler o catálogo de um libSQL.
 *
 * ## Um arquivo, um database, nenhum schema
 *
 * O Postgres tem conexão → database → schema → tabela; o MySQL corta o schema;
 * aqui **corta os dois**: a URL aponta para um banco, e dentro dele há tabelas.
 * Não existe "listar os outros databases" — o servidor expõe um.
 *
 * A resposta da API mantém a forma de sempre. `listarDatabases` devolve **um**
 * item, e a árvore devolve **um** nó de schema; os dois carregam o nome que a
 * conexão deu ao banco, para qualquer tela que os desenhe dizer algo
 * verdadeiro. É a mesma decisão do MySQL, um nível mais fundo.
 *
 * ## O catálogo é o do SQLite
 *
 * `sqlite_master` para as relações e as funções `pragma_*` para colunas,
 * índices e chaves estrangeiras. Elas são **funções de tabela**, então cabem
 * numa consulta normal e aceitam parâmetro ligado — o nome da tabela nunca
 * entra concatenado.
 */

/** Nome do "database" quando a conexão não dá um. A URL não carrega um nome. */
export const NOME_PADRAO = "main";

const RELACOES_SQL = `
  SELECT type, name
    FROM sqlite_master
   WHERE type IN ('table', 'view')
     AND name NOT LIKE 'sqlite_%'
   ORDER BY name
`;

/** Uma linha de resultado, já em texto. */
type Linha = Record<string, string | null>;

function emTexto(r: ResultadoLibsql | undefined): Linha[] {
  if (r === undefined) return [];
  return r.rows.map((linha) => {
    const saida: Linha = {};
    r.cols.forEach((col, i) => {
      saida[col.name] = paraTexto(linha[i] ?? { type: "null" });
    });
    return saida;
  });
}

function especieDe(tipo: string | null): RelationKind {
  return tipo === "view" ? "view" : "table";
}

/**
 * O database único desta conexão.
 *
 * Devolver lista vazia faria a árvore não ter por onde expandir; devolver os
 * databases do servidor é impossível, porque ele expõe um só. Um item, marcado
 * como padrão, é o que existe.
 */
export function listarDatabases(nome: string): DatabaseInfo[] {
  return [{ name: nome === "" ? NOME_PADRAO : nome, isDefault: true }];
}

export async function introspectarArvore(
  alvo: AlvoLibsql,
  database: string,
): Promise<DatabaseTree> {
  const [relacoes] = await executarSql(alvo, [{ sql: RELACOES_SQL }]);

  /*
   * Sem estimativa de linhas. O SQLite só a tem se `ANALYZE` já rodou, e ler
   * `sqlite_stat1` num banco sem `ANALYZE` devolveria erro de tabela
   * inexistente. `null` é a resposta honesta: a tela mostra "—" em vez de um
   * número inventado, e continua contando sob demanda quando alguém abre a
   * tabela.
   */
  const relations: RelationTree[] = emTexto(relacoes).map((l) => ({
    name: l["name"] ?? "",
    kind: especieDe(l["type"] ?? null),
    estimatedRows: null,
  }));

  return {
    database,
    schemas: [{ name: database, relations }],
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

/**
 * O catálogo completo.
 *
 * As `pragma_*` são por tabela, então o número de consultas cresce com o número
 * de relações. Elas vão num **lote só** por `/v2/pipeline` — uma ida à rede em
 * vez de três por tabela, que num catálogo de 200 tabelas seria a diferença
 * entre uma requisição e seiscentas.
 */
export async function introspectarCompleto(
  alvo: AlvoLibsql,
  database: string,
): Promise<DatabaseSchema> {
  const [relacoes] = await executarSql(alvo, [{ sql: RELACOES_SQL }]);
  const nomes = emTexto(relacoes).map((l) => ({
    nome: l["name"] ?? "",
    especie: especieDe(l["type"] ?? null),
  }));

  if (nomes.length === 0) {
    return { database, schemas: [{ name: database, relations: [] }], fetchedAt: new Date().toISOString(), cached: false };
  }

  // Três consultas por tabela, num lote só. O nome vai por parâmetro ligado:
  // ele vem do catálogo, mas ligar é o que torna a origem irrelevante.
  const lote = nomes.flatMap(({ nome }) => [
    { sql: "SELECT cid, name, type, [notnull], dflt_value, pk FROM pragma_table_info(?)", args: [arg(nome)] },
    { sql: "SELECT [table], [from], [to], seq, id FROM pragma_foreign_key_list(?)", args: [arg(nome)] },
    { sql: "SELECT name, [unique], origin FROM pragma_index_list(?)", args: [arg(nome)] },
  ]);

  const saidas = await executarSql(alvo, lote);

  /*
   * Segunda rodada: as colunas de cada índice.
   *
   * `pragma_index_list` dá os índices, e só `pragma_index_info` dá as colunas
   * de cada um — não dá para pedir as duas coisas antes de saber os nomes. Duas
   * idas à rede no total, e não uma por índice: a primeira descobre os nomes, a
   * segunda pergunta por todos de uma vez.
   *
   * Deixar a lista vazia seria mentira por omissão: a tela mostra as colunas do
   * índice, e um índice sem colunas parece um índice sobre nada.
   */
  const indicesPorTabela = nomes.map((_, i) => emTexto(saidas[i * 3 + 2]));
  const nomesDeIndice = indicesPorTabela.flatMap((lista) =>
    lista.map((ix) => ix["name"] ?? "").filter((n) => n !== ""),
  );
  const colunasDeIndice = new Map<string, string[]>();
  if (nomesDeIndice.length > 0) {
    const infos = await executarSql(
      alvo,
      nomesDeIndice.map((n) => ({
        sql: "SELECT seqno, name FROM pragma_index_info(?)",
        args: [arg(n)],
      })),
    );
    nomesDeIndice.forEach((n, i) => {
      const partes = emTexto(infos[i]);
      colunasDeIndice.set(
        n,
        [...partes]
          .sort((a, b) => Number.parseInt(a["seqno"] ?? "0", 10) - Number.parseInt(b["seqno"] ?? "0", 10))
          // Índice sobre expressão devolve `name` nulo: a posição existe e a
          // coluna não. Vira o marcador, e não uma string vazia que parece nome.
          .map((x) => x["name"] ?? "(expressão)"),
      );
    });
  }

  const relations: Relation[] = [];
  for (const [i, { nome, especie }] of nomes.entries()) {
    const cols = emTexto(saidas[i * 3]);
    const fks = emTexto(saidas[i * 3 + 1]);
    const idxs = emTexto(saidas[i * 3 + 2]);

    const columns: Column[] = cols.map((c) => ({
      name: c["name"] ?? "",
      // O tipo **declarado**, como está no `CREATE TABLE`. O SQLite é de
      // tipagem dinâmica: a coluna aceita qualquer coisa, e este campo é a
      // intenção de quem criou. Vazio numa coluna sem tipo declarado.
      dataType: c["type"] ?? "",
      // Não há OID nem número de protocolo: o tipo vem por célula, e a tela
      // casa catálogo e resultado pelo **nome** da coluna aqui.
      dataTypeId: 0,
      nullable: c["notnull"] !== "1",
      defaultValue: c["dflt_value"] ?? null,
      position: Number.parseInt(c["cid"] ?? "0", 10) + 1,
      isPrimaryKey: (c["pk"] ?? "0") !== "0",
      // O SQLite não guarda comentário de coluna nem de tabela.
      comment: null,
    }));

    /*
     * A ordem da chave primária composta é a do campo `pk` (1, 2, 3…), **não** a
     * ordem das colunas na tabela. Ordenar errado aqui quebra o keyset: ele
     * desempata pela PK, e a página seguinte pularia ou repetiria linhas.
     */
    const primaryKey = columns
      .filter((c) => c.isPrimaryKey)
      .map((c) => ({ nome: c.name, ordem: Number.parseInt(cols.find((x) => x["name"] === c.name)?.["pk"] ?? "0", 10) }))
      .sort((a, b) => a.ordem - b.ordem)
      .map((c) => c.nome);

    // `pragma_foreign_key_list` numera cada constraint em `id` e cada coluna
    // dela em `seq`: é o que mantém `columns[i]` pareado com
    // `referencedColumns[i]` numa chave composta.
    const porConstraint = new Map<string, Linha[]>();
    for (const f of fks) {
      const id = f["id"] ?? "0";
      const atual = porConstraint.get(id);
      if (atual === undefined) porConstraint.set(id, [f]);
      else atual.push(f);
    }
    const foreignKeys: ForeignKey[] = [...porConstraint].map(([id, partes]) => {
      const ordenadas = [...partes].sort(
        (a, b) => Number.parseInt(a["seq"] ?? "0", 10) - Number.parseInt(b["seq"] ?? "0", 10),
      );
      return {
        // O SQLite não nomeia a constraint no catálogo; o número dela é o que
        // existe, e inventar um nome seria pior que mostrar o número.
        name: `fk_${nome}_${id}`,
        columns: ordenadas.map((p) => p["from"] ?? ""),
        referencedSchema: database,
        referencedTable: ordenadas[0]?.["table"] ?? "",
        referencedColumns: ordenadas.map((p) => p["to"] ?? ""),
      };
    });

    const indexes: Index[] = idxs.map((ix) => {
      const nomeIx = ix["name"] ?? "";
      const colunas = colunasDeIndice.get(nomeIx) ?? [];
      const unico = (ix["unique"] ?? "0") === "1";
      return {
        name: nomeIx,
        columns: colunas,
        isUnique: unico,
        // `origin` é `pk` quando o índice é o da chave primária.
        isPrimary: (ix["origin"] ?? "") === "pk",
        definition:
          `${unico ? "UNIQUE " : ""}INDEX "${nomeIx}"` +
          (colunas.length === 0 ? "" : ` (${colunas.map((c) => `"${c}"`).join(", ")})`),
      };
    });

    relations.push({
      name: nome,
      kind: especie,
      comment: null,
      estimatedRows: null,
      columns,
      primaryKey,
      foreignKeys,
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
