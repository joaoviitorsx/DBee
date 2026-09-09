import type { Connection, RowDataPacket } from "mysql2/promise";

import type { DatabaseTree, RelationKind, RelationTree } from "@dbee/shared";

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
  /*
   * `FieldPacket` do `mysql2` declara `characterSet` e `columnType` como
   * opcionais, e `CampoMysql` os exige — porque sem eles não há como decidir
   * texto ou hexadecimal. O servidor sempre os manda; a conversão está aqui,
   * num ponto só, em vez de espalhada por cada chamador.
   */
  return linhasDeTexto(linhas, campos as unknown as CampoMysql[]);
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
