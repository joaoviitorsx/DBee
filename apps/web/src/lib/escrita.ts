import { gravaPorCredencialSeparada } from "@dbee/shared/puro";
import type { Connection } from "@dbee/shared";

/**
 * "Esta conexão pode escrever?" — a mesma regra que o servidor aplica em
 * `writeEnabledEfetivo`.
 *
 * A garantia de escrita difere por engine, e a tela precisa espelhar a do
 * servidor, senão ela habilita edição onde o servidor recusa (ou, pior,
 * esconde a edição onde ele aceita — foi o caso do Redis/Mongo, cuja edição
 * existia na API mas nunca acendia na grade, porque a tela olhava só
 * `writeEnabled`):
 *
 * - **credencial** (MySQL, MariaDB, libSQL, Mongo, Redis): pode escrever quando
 *   há uma credencial de escrita configurada (`hasWriteCredential`);
 * - **transação/handle** (Postgres, SQLite): pode escrever quando
 *   `writeEnabled` está ligado na conexão.
 *
 * `gravaPorCredencialSeparada` (de `@dbee/shared/puro`) é quem decide a família,
 * a partir da tabela de capacidades — a mesma fonte que o servidor lê.
 */
export function conexaoGrava(
  c: Pick<Connection, "engine" | "writeEnabled" | "hasWriteCredential">,
): boolean {
  return gravaPorCredencialSeparada(c.engine) ? c.hasWriteCredential : c.writeEnabled;
}
