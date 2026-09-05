/**
 * Quais requisições a árvore deve disparar, dado o estado de expansão.
 *
 * Função pura e separada do componente **de propósito**: é o invariante mais
 * caro da tela e precisa ser verificável sem montar React. Cada database
 * planejado aqui vira uma introspecção de catálogo inteira no Postgres do
 * cliente; planejar de mais abre conexão em banco de produção que o usuário nem
 * tocou hoje.
 */

import { connectionNode, databaseNode } from "./keys";

export interface SchemaTarget {
  readonly connectionId: string;
  readonly database: string;
}

/** Conexões cujos databases devem ser listados: só as expandidas. */
export function plannedDatabaseTargets(
  connectionIds: readonly string[],
  expanded: ReadonlySet<string>,
): string[] {
  return connectionIds.filter((id) => expanded.has(connectionNode(id)));
}

/**
 * Databases cuja árvore deve ser buscada.
 *
 * Exige as duas expansões: a da conexão **e** a do database. Colapsar a conexão
 * cancela a busca dos databases dentro dela, mesmo que eles tenham ficado
 * marcados como expandidos — que é o que o usuário espera ao fechar um nó.
 */
export function plannedSchemaTargets(
  databasesPorConexao: readonly { connectionId: string; databases: readonly string[] }[],
  expanded: ReadonlySet<string>,
): SchemaTarget[] {
  return databasesPorConexao
    .filter((entry) => expanded.has(connectionNode(entry.connectionId)))
    .flatMap((entry) =>
      entry.databases
        .filter((database) => expanded.has(databaseNode(entry.connectionId, database)))
        .map((database) => ({ connectionId: entry.connectionId, database })),
    );
}
