import type { Database, Statement } from "bun:sqlite";

import { decryptLegacyV1, encrypt, isLegacyV1, type EncryptionKey } from "../lib/crypto";

/**
 * Migração de cifra v1 → v2 (ADR 005).
 *
 * Roda uma vez no boot, depois das migrations de schema e da derivação da
 * chave. O v1 não tem AAD, então um `password_enc` podia ser trocado entre duas
 * conexões sem que a decifragem percebesse — a senha de produção indo para o
 * host de homologação.
 *
 * Depois desta passada, `decrypt` recusa v1: manter o caminho legado aberto
 * para sempre anularia a proteção que o AAD veio dar.
 *
 * Numa transação só: ou todos os registros migram, ou nenhum. Um estado
 * parcial deixaria conexões ilegíveis se o processo morresse no meio.
 */
export function recipherToV2(db: Database, key: EncryptionKey): number {
  const linhas = db
    .query<{ id: string; password_enc: string }, []>(
      "SELECT id, password_enc FROM connections",
    )
    .all();

  const legadas = linhas.filter((linha) => isLegacyV1(linha.password_enc));
  if (legadas.length === 0) return 0;

  const atualiza: Statement<unknown, [string, string]> = db.query(
    "UPDATE connections SET password_enc = ? WHERE id = ?",
  );

  db.transaction(() => {
    for (const linha of legadas) {
      // Se a chave estiver errada, isto lança e a transação inteira reverte —
      // o banco fica como estava, e o boot falha com uma mensagem clara em vez
      // de deixar metade migrada.
      const senha = decryptLegacyV1(key, linha.password_enc);
      atualiza.run(encrypt(key, linha.id, senha), linha.id);
    }
  })();

  return legadas.length;
}
