/** Chaves estáveis dos nós expansíveis da árvore. */

export const connectionNode = (id: string): string => `c:${id}`;
export const databaseNode = (id: string, database: string): string => `d:${id}:${database}`;
export const schemaNode = (id: string, database: string, schema: string): string =>
  `s:${id}:${database}:${schema}`;
