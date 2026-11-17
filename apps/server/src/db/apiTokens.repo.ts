import type { Database, Statement } from "bun:sqlite";

import type { ApiTokenSummary } from "@dbee/shared";

import { nanoid } from "../lib/ids";

/**
 * Tokens pessoais de API (migração 012, ADR 015).
 *
 * `hash` **nunca** aparece nas colunas públicas — mesma barreira dupla de
 * `users.repo.ts`: o tipo não tem o campo e o SELECT da lista não o pede. O
 * único caminho que lê o hash é `porPrefixo`, usado só pela autenticação.
 */
const PUBLIC_COLUMNS = `
  id, name, prefix,
  created_at AS createdAt,
  last_used_at AS lastUsedAt,
  revoked_at AS revokedAt
`;

export interface TokenParaVerificar {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly hash: string;
}

export class ApiTokensRepository {
  readonly #listar: Statement<ApiTokenSummary, [string]>;
  readonly #porId: Statement<ApiTokenSummary & { userId: string }, [string]>;
  readonly #criar: Statement<unknown, [string, string, string, string, string, string]>;
  readonly #porPrefixo: Statement<TokenParaVerificar, [string]>;
  readonly #revogar: Statement<unknown, [string, string]>;
  readonly #tocar: Statement<unknown, [string, string]>;

  constructor(db: Database) {
    this.#listar = db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`,
    );
    this.#porId = db.query(`SELECT ${PUBLIC_COLUMNS}, user_id AS userId FROM api_tokens WHERE id = ?`);
    this.#criar = db.query(
      `INSERT INTO api_tokens (id, user_id, name, prefix, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // Revogado não volta: o filtro está no SELECT, então a autenticação nem vê.
    this.#porPrefixo = db.query(
      `SELECT id, user_id AS userId, name, hash FROM api_tokens
        WHERE prefix = ? AND revoked_at IS NULL`,
    );
    this.#revogar = db.query(
      `UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
    );
    this.#tocar = db.query(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`);
  }

  listar(userId: string): ApiTokenSummary[] {
    return this.#listar.all(userId);
  }

  /** Com o dono, para a rota decidir quem pode revogar. */
  porId(id: string): (ApiTokenSummary & { userId: string }) | null {
    return this.#porId.get(id);
  }

  criar(userId: string, name: string, prefix: string, hash: string): ApiTokenSummary {
    const id = nanoid();
    const agora = new Date().toISOString();
    this.#criar.run(id, userId, name, prefix, hash, agora);
    return { id, name, prefix, createdAt: agora, lastUsedAt: null, revokedAt: null };
  }

  porPrefixo(prefix: string): TokenParaVerificar | null {
    return this.#porPrefixo.get(prefix);
  }

  revogar(id: string): void {
    this.#revogar.run(new Date().toISOString(), id);
  }

  tocar(id: string): void {
    this.#tocar.run(new Date().toISOString(), id);
  }
}
