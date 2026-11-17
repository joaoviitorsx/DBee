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
/** AAD da senha lembrada: distinto do .ovpn, um não decifra como o outro. */
const aadSenha = (userId: string, perfil: string): string => `${aad(userId, perfil)}#senha`;

export interface CredencialLembrada {
  readonly usuario: string;
  /** Parte fixa da senha (PIN). Pode ser vazia: VPN só com usuário + TOTP. */
  readonly senha: string;
}

export class VpnProfilesRepository {
  readonly #key: EncryptionKey;
  readonly #salvar: Statement<unknown, [string, string, string, string]>;
  readonly #ler: Statement<{ ovpn_enc: string }, [string, string]>;
  readonly #perfis: Statement<{ perfil: string }, [string]>;
  readonly #remover: Statement<unknown, [string, string]>;
  readonly #lembrar: Statement<unknown, [string | null, string | null, string, string]>;
  readonly #credencial: Statement<{ usuario: string | null; senha_enc: string | null }, [string, string]>;
  readonly #comCredencial: Statement<{ perfil: string; usuario: string }, [string]>;

  constructor(db: Database, key: EncryptionKey) {
    this.#key = key;
    this.#salvar = db.query(
      `INSERT INTO vpn_profiles (user_id, perfil, ovpn_enc, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, perfil) DO UPDATE SET ovpn_enc = excluded.ovpn_enc, updated_at = excluded.updated_at`,
    );
    this.#ler = db.query(`SELECT ovpn_enc FROM vpn_profiles WHERE user_id = ? AND perfil = ?`);
    this.#perfis = db.query(`SELECT perfil FROM vpn_profiles WHERE user_id = ?`);
    this.#remover = db.query(`DELETE FROM vpn_profiles WHERE user_id = ? AND perfil = ?`);
    this.#lembrar = db.query(
      `UPDATE vpn_profiles SET usuario = ?, senha_enc = ? WHERE user_id = ? AND perfil = ?`,
    );
    this.#credencial = db.query(
      `SELECT usuario, senha_enc FROM vpn_profiles WHERE user_id = ? AND perfil = ?`,
    );
    this.#comCredencial = db.query(
      `SELECT perfil, usuario FROM vpn_profiles WHERE user_id = ? AND usuario IS NOT NULL`,
    );
  }

  /** Grava usuário + parte fixa da senha, cifrada. Só existe se há .ovpn. */
  lembrar(userId: string, perfil: string, c: CredencialLembrada): void {
    this.#lembrar.run(c.usuario, encrypt(this.#key, aadSenha(userId, perfil), c.senha), userId, perfil);
  }

  esquecer(userId: string, perfil: string): void {
    this.#lembrar.run(null, null, userId, perfil);
  }

  /** Decifra. Lança se o blob não for desta pessoa/perfil (AAD). */
  credencial(userId: string, perfil: string): CredencialLembrada | null {
    const row = this.#credencial.get(userId, perfil);
    if (row?.usuario == null || row.senha_enc === null) return null;
    return { usuario: row.usuario, senha: decrypt(this.#key, aadSenha(userId, perfil), row.senha_enc) };
  }

  /** Perfis com credencial lembrada → usuário (nunca a senha). */
  usuariosLembrados(userId: string): ReadonlyMap<string, string> {
    return new Map(this.#comCredencial.all(userId).map((r) => [r.perfil, r.usuario]));
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
