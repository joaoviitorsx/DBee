import type { Connection, RowDataPacket } from "mysql2/promise";

import type {
  Column,
  DatabaseSchema,
  ForeignKey,
  Index,
  DatabaseTree,
  Relation,
  RelationKind,
  RelationTree,
} from "@dbee/shared";

import { numeroDoTipo } from "./colunas";
import { linhasDeTexto, type CampoMysql } from "./tipos";

/**
 * Ler o catálogo do MySQL e do MariaDB.
 *
 * ## O nível que não existe
 *
 * O Postgres tem conexão → database → **schema** → tabela. O MySQL tem
 * conexão → database → tabela: `SCHEMA` e `DATABASE` são a mesma coisa lá, e
 * não há nada entre o database e a tabela.
 *
 * A resposta da API continua com a forma de sempre (`DatabaseTree` com
 * `schemas[]`), e a engine devolve **um** nó de schema com o nome do próprio
 * database. Mudar o formato do fio quebraria o Eden e todas as rotas por causa
 * de uma engine; quem esconde o nível é a tela, que já sabe disso pela
 * capacidade `niveis: "conexao/database/tabela"`. O nó carrega o nome do
 * database, e não uma string vazia, para que qualquer caminho que o desenhe
 * ainda diga algo verdadeiro.
 *
 * ## A permissão já vem aplicada
 *
 * `information_schema` filtra por grant sozinho — medido: um usuário com
 * `GRANT SELECT ON loja.clientes` vê exatamente `clientes` em
 * `information_schema.TABLES`, e nada mais do database. Isso é o equivalente do
 * `has_table_privilege` que a introspecção do Postgres precisa pedir à mão, e
 * significa que a árvore não mostra o que o usuário não pode abrir.
 */

/**
 * Os databases internos do servidor.
 *
 * É o análogo dos templates que a listagem do Postgres esconde: existem em todo
 * servidor, nunca guardam dado do usuário, e numa instalação com um único
 * database real eles seriam quatro quintos da lista. `information_schema`
 * continua alcançável escrevendo o nome numa consulta — some da árvore, não do
 * servidor.
 */
const DATABASES_DO_SERVIDOR: ReadonlySet<string> = new Set([
  "information_schema",
  "performance_schema",
  "mysql",
  "sys",
]);

const DATABASES_SQL = `
  SELECT SCHEMA_NAME AS nome
    FROM information_schema.SCHEMATA
   ORDER BY SCHEMA_NAME
`;

/**
 * `TABLE_ROWS` é **estimativa** no InnoDB, não contagem — é por isso que o campo
 * do lado de cá se chama `estimatedRows`. Em view vem `NULL`, e `null` é a
 * resposta honesta: uma view não tem cardinalidade guardada.
 */
const ARVORE_SQL = `
  SELECT TABLE_NAME AS nome, TABLE_TYPE AS tipo, TABLE_ROWS AS linhas
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = ?
   ORDER BY TABLE_NAME
`;

/**
 * `TABLE_TYPE` para o vocabulário do DBee.
 *
 * `SEQUENCE` só existe no MariaDB — quinta divergência medida entre as duas — e
 * vira `table` porque é isso que ela é ali: um objeto de uma linha que se lê com
 * `SELECT`. Chamar de outra coisa exigiria um `RelationKind` novo que só uma
 * engine produz.
 *
 * O `default` é `table` e não um erro: catálogo de servidor futuro pode inventar
 * um tipo, e sumir com a relação da árvore seria pior que classificá-la de
 * forma conservadora.
 */
function especieDe(tipo: string | null): RelationKind {
  switch (tipo) {
    case "VIEW":
    case "SYSTEM VIEW":
      return "view";
    default:
      return "table";
  }
}

/** `TABLE_ROWS` como inteiro, ou `null` quando o servidor não estima. */
function estimativa(valor: string | null): number | null {
  if (valor === null) return null;
  const n = Number.parseInt(valor, 10);
  return Number.isNaN(n) ? null : n;
}

async function consultar(
  conexao: Connection,
  sql: string,
  parametros: unknown[] = [],
): Promise<Record<string, string | null>[]> {
  /*
   * `query` e nunca `execute`: só o protocolo de texto entrega número e data em
   * ASCII, que é o que a conversão de `tipos.ts` espera. Com `execute` o mesmo
   * código produz lixo silencioso.
   */
  const [linhas, campos] = await conexao.query<RowDataPacket[]>(sql, parametros);
  // `rowsAsArray` na conexão do driver: a linha é array e o metadado dá a ordem.
  const emArray = linhas as unknown as (Buffer | null)[][];
  /*
   * `FieldPacket` do `mysql2` declara `characterSet` e `columnType` como
   * opcionais, e `CampoMysql` os exige — porque sem eles não há como decidir
   * texto ou hexadecimal. O servidor sempre os manda; a conversão está aqui,
   * num ponto só, em vez de espalhada por cada chamador.
   */
  return linhasDeTexto(emArray, campos as unknown as CampoMysql[]);
}

export async function listarDatabases(
  conexao: Connection,
  atual: string,
): Promise<{ name: string; isDefault: boolean }[]> {
  const linhas = await consultar(conexao, DATABASES_SQL);
  return linhas
    .map((l) => l["nome"])
    .filter((nome): nome is string => nome !== null && nome !== undefined)
    .filter((nome) => !DATABASES_DO_SERVIDOR.has(nome))
    .map((nome) => ({ name: nome, isDefault: nome === atual }));
}

export async function introspectarArvore(
  conexao: Connection,
  database: string,
): Promise<DatabaseTree> {
  const linhas = await consultar(conexao, ARVORE_SQL, [database]);
  const relations: RelationTree[] = linhas.map((l) => ({
    name: l["nome"] ?? "",
    kind: especieDe(l["tipo"] ?? null),
    estimatedRows: estimativa(l["linhas"] ?? null),
  }));

  return {
    database,
    // O nó único que ocupa o lugar do schema que o MySQL não tem.
    schemas: [{ name: database, relations }],
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

/**
 * Comentário de tabela — com a armadilha do MySQL descontada.
 *
 * Medido: `TABLE_COMMENT` de uma **view** vem literalmente `"VIEW"`. Não é
 * comentário de ninguém, é o servidor dizendo o que o objeto é no campo errado.
 * Sem este filtro, toda view do catálogo apareceria com um comentário falso.
 */
function comentarioDeTabela(bruto: string | null, especie: RelationKind): string | null {
  if (bruto === null || bruto === "") return null;
  if (especie === "view" && bruto === "VIEW") return null;
  return bruto;
}

const TABELAS_SQL = `
  SELECT TABLE_NAME AS nome, TABLE_TYPE AS tipo, TABLE_ROWS AS linhas,
         TABLE_COMMENT AS comentario
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = ?
   ORDER BY TABLE_NAME
`;

/**
 * `COLUMN_TYPE` e não `DATA_TYPE`: o primeiro traz `varchar(80)` e
 * `decimal(18,4)`, que é o que a pessoa escreveu no `CREATE TABLE` e o
 * equivalente do `format_type` do Postgres. O segundo traz só `varchar`, e a
 * tela perderia o tamanho.
 *
 * `DATA_TYPE` ainda é lido, mas para outra coisa: casar com o número do tipo do
 * protocolo, que é como a tela liga catálogo e resultado de consulta.
 */
const COLUNAS_SQL = `
  SELECT TABLE_NAME AS tabela, COLUMN_NAME AS nome, COLUMN_TYPE AS tipo,
         DATA_TYPE AS familia, IS_NULLABLE AS anulavel, COLUMN_DEFAULT AS padrao,
         ORDINAL_POSITION AS posicao, COLUMN_KEY AS chave, COLUMN_COMMENT AS comentario
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ?
   ORDER BY TABLE_NAME, ORDINAL_POSITION
`;

/**
 * `NON_UNIQUE = 0` significa único — o nome da coluna é a negação, e ler ao
 * contrário é o erro que ela convida.
 */
const INDICES_SQL = `
  SELECT TABLE_NAME AS tabela, INDEX_NAME AS nome, SEQ_IN_INDEX AS ordem,
         COLUMN_NAME AS coluna, NON_UNIQUE AS naoUnico
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = ?
   ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
`;

/**
 * Chaves estrangeiras, com as colunas na ordem da constraint.
 *
 * `ORDINAL_POSITION` é o que mantém `columns[i]` casando com
 * `referencedColumns[i]` numa chave composta — trocar a ordem faz o salto da
 * tela ir para a linha errada, e nada acusa.
 */
const FKS_SQL = `
  SELECT CONSTRAINT_NAME AS nome, TABLE_NAME AS tabela, COLUMN_NAME AS coluna,
         REFERENCED_TABLE_SCHEMA AS refSchema, REFERENCED_TABLE_NAME AS refTabela,
         REFERENCED_COLUMN_NAME AS refColuna, ORDINAL_POSITION AS ordem
    FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
   ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION
`;

/** Agrupa linhas por uma chave, preservando a ordem de chegada. */
function agrupar<T>(linhas: readonly T[], chave: (l: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const l of linhas) {
    const k = chave(l);
    const atual = mapa.get(k);
    if (atual === undefined) mapa.set(k, [l]);
    else atual.push(l);
  }
  return mapa;
}

/**
 * A introspecção **completa** de um database: colunas, chave primária, índices
 * e chaves estrangeiras.
 *
 * Quatro consultas ao `information_schema`, uma por assunto, filtradas pelo
 * database. Não são cinco nem uma: juntar tudo num `JOIN` multiplicaria linhas
 * (uma coluna que participa de três índices apareceria três vezes) e separar
 * mais faria uma ida ao servidor por tabela.
 *
 * A permissão vem aplicada pelo próprio `information_schema` — medido: um papel
 * com `GRANT SELECT` numa tabela só vê aquela tabela. Vale para as quatro.
 */
export async function introspectarCompleto(
  conexao: Connection,
  database: string,
): Promise<DatabaseSchema> {
  /*
   * Em sequência, e **sem snapshot consistente** — a diferença com o Postgres
   * merece ser dita.
   *
   * Lá as quatro consultas rodam em `repeatable-read`, então um DDL no meio não
   * produz relação sem coluna. Aqui isso não tem equivalente: o
   * `information_schema` do MySQL é gerado do dicionário de dados e **não entra
   * no snapshot da transação**, então `START TRANSACTION WITH CONSISTENT
   * SNAPSHOT` não protegeria nada. A janela existe, é de milissegundos, e
   * fingir que ela não existe seria pior que registrá-la.
   *
   * Sequencial e não `Promise.all` pelo mesmo motivo do lado Postgres: a
   * conexão executa uma por vez de qualquer jeito, e paralelizar só embaralha o
   * relatório de erro.
   */
  const tabelas = await consultar(conexao, TABELAS_SQL, [database]);
  const colunas = await consultar(conexao, COLUNAS_SQL, [database]);
  const indices = await consultar(conexao, INDICES_SQL, [database]);
  const fks = await consultar(conexao, FKS_SQL, [database]);

  const colunasPorTabela = agrupar(colunas, (l) => l["tabela"] ?? "");
  const indicesPorTabela = agrupar(indices, (l) => l["tabela"] ?? "");
  const fksPorTabela = agrupar(fks, (l) => l["tabela"] ?? "");

  const relations: Relation[] = tabelas.map((t) => {
    const nome = t["nome"] ?? "";
    const especie = especieDe(t["tipo"] ?? null);

    const cols = colunasPorTabela.get(nome) ?? [];
    const columns: Column[] = cols.map((c) => ({
      name: c["nome"] ?? "",
      // `COLUMN_TYPE`: traz o tamanho, como o `format_type` do Postgres.
      dataType: c["tipo"] ?? "",
      dataTypeId: numeroDoTipo(c["familia"] ?? ""),
      nullable: c["anulavel"] === "YES",
      defaultValue: c["padrao"] ?? null,
      position: Number.parseInt(c["posicao"] ?? "0", 10),
      isPrimaryKey: c["chave"] === "PRI",
      comment: c["comentario"] === "" ? null : (c["comentario"] ?? null),
    }));

    const primaryKey = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

    const porIndice = agrupar(indicesPorTabela.get(nome) ?? [], (l) => l["nome"] ?? "");
    const indexes: Index[] = [...porIndice].map(([indice, partes]) => {
      const colunasDoIndice = partes.map((p) => p["coluna"] ?? "");
      // `NON_UNIQUE = 0` é único. A negação no nome do campo é a armadilha.
      const unico = partes[0]?.["naoUnico"] === "0";
      return {
        name: indice,
        columns: colunasDoIndice,
        isUnique: unico,
        isPrimary: indice === "PRIMARY",
        // O MySQL não guarda a definição textual do índice como o
        // `pg_get_indexdef`. Montar uma equivalente é honesto e é o que a tela
        // mostra quando o índice não cabe numa lista de colunas.
        definition:
          `${unico && indice !== "PRIMARY" ? "UNIQUE " : ""}KEY \`${indice}\` ` +
          `(${colunasDoIndice.map((c) => `\`${c}\``).join(", ")})`,
      };
    });

    const porFk = agrupar(fksPorTabela.get(nome) ?? [], (l) => l["nome"] ?? "");
    const foreignKeys: ForeignKey[] = [...porFk].map(([constraint, partes]) => ({
      name: constraint,
      columns: partes.map((p) => p["coluna"] ?? ""),
      // O MySQL não tem schema: o "schema referenciado" é o database, e é o que
      // mantém o salto da tela apontando para o lugar certo.
      referencedSchema: partes[0]?.["refSchema"] ?? database,
      referencedTable: partes[0]?.["refTabela"] ?? "",
      referencedColumns: partes.map((p) => p["refColuna"] ?? ""),
    }));

    return {
      name: nome,
      kind: especie,
      comment: comentarioDeTabela(t["comentario"] ?? null, especie),
      estimatedRows: estimativa(t["linhas"] ?? null),
      columns,
      primaryKey,
      foreignKeys,
      indexes,
    };
  });

  return {
    database,
    schemas: [{ name: database, relations }],
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}
