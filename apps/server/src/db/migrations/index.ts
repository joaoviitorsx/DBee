import initial from "./001_initial.sql" with { type: "text" };
import users from "./002_users.sql" with { type: "text" };
import userLocale from "./003_user_locale.sql" with { type: "text" };
import userRoles from "./004_user_roles.sql" with { type: "text" };
import connectionAccess from "./005_connection_access.sql" with { type: "text" };
import auditIndexes from "./006_audit_indexes.sql" with { type: "text" };
import connectionEngine from "./007_connection_engine.sql" with { type: "text" };
import writeCredential from "./008_write_credential.sql" with { type: "text" };

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
  { version: 2, name: "002_users", sql: users },
  { version: 3, name: "003_user_locale", sql: userLocale },
  { version: 4, name: "004_user_roles", sql: userRoles },
  { version: 5, name: "005_connection_access", sql: connectionAccess },
  { version: 6, name: "006_audit_indexes", sql: auditIndexes },
  { version: 7, name: "007_connection_engine", sql: connectionEngine },
  { version: 8, name: "008_write_credential", sql: writeCredential },
];

/**
 * Versão de schema que ESTE código exige. É a maior das migrations acima — o
 * teste "EXPECTED_SCHEMA casa com a última migration" trava o valor para não
 * derivar. O boot aborta se o banco aberto ficar abaixo disto (mesmo padrão do
 * aborto por porta ocupada): migrate não rodou, banco em mount read-only, ou
 * arquivo de db errado/velho. Backend velho servindo schema defasado já bloqueou
 * duas vezes, e uma se disfarçou de erro de conexão na UI — erro alto no boot é
 * mais barato que diagnóstico errado na tela.
 */
export const EXPECTED_SCHEMA = 8;
