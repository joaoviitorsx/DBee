import initial from "./001_initial.sql" with { type: "text" };

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/**
 * Migrations são importadas como texto, não lidas do disco: `bun build
 * --compile` embute o conteúdo no binário, e o container não tem os `.sql`
 * (DBee.md §11.9). Adicionar migration = adicionar arquivo + linha aqui.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "001_initial", sql: initial },
];
