import type { Database, Statement } from "bun:sqlite";

import { decrypt, encrypt, type EncryptionKey } from "../lib/crypto";

/**
 * O .ovpn de cada usuário, por perfil (ADR 014, migration 011).
 *
 * Cifrado com AAD `vpn:<userId>:<perfil>`: o arquivo embute a chave privada do
 * certificado DAQUELA pessoa, e um blob copiado para outra linha não decifra.
 * Nenhum método devolve o conteúdo para a API — só `ler`, consumido pelo
 * serviço na hora de abrir o túnel.
 */
const aad = (userId: string, perfil: string): string => `vpn:${userId}:${perfil}`;

export class VpnProfilesRepository {
  readonly #key: EncryptionKey;
  readonly #salvar: Statement<unknown, [string, string, string, string]>;
  readonly #ler: Statement<{ ovpn_enc: string }, [string, string]>;
  readonly #perfis: Statement<{ perfil: string }, [string]>;
  readonly #remover: Statement<unknown, [string, string]>;

  constructor(db: Database, key: EncryptionKey) {
    this.#key = key;
    this.#salvar = db.query(
      `INSERT INTO vpn_profiles (user_id, perfil, ovpn_enc, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, perfil) DO UPDATE SET ovpn_enc = excluded.ovpn_enc, updated_at = excluded.updated_at`,
    );
    this.#ler = db.query(`SELECT ovpn_enc FROM vpn_profiles WHERE user_id = ? AND perfil = ?`);
    this.#perfis = db.query(`SELECT perfil FROM vpn_profiles WHERE user_id = ?`);
    this.#remover = db.query(`DELETE FROM vpn_profiles WHERE user_id = ? AND perfil = ?`);
  }

  salvar(userId: string, perfil: string, ovpn: string): void {
    this.#salvar.run(userId, perfil, encrypt(this.#key, aad(userId, perfil), ovpn), new Date().toISOString());
  }

  /** Decifra. Lança se o blob não for deste usuário/perfil (AAD). */
  ler(userId: string, perfil: string): string | null {
    const row = this.#ler.get(userId, perfil);
    return row === null ? null : decrypt(this.#key, aad(userId, perfil), row.ovpn_enc);
  }

  perfisComArquivo(userId: string): ReadonlySet<string> {
    return new Set(this.#perfis.all(userId).map((r) => r.perfil));
  }

  remover(userId: string, perfil: string): boolean {
    return this.#remover.run(userId, perfil).changes > 0;
  }
}
