import type { Database, Statement } from "bun:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { SESSION_TTL_MS, type Locale, type SessionUser } from "@dbee/shared";

import { nanoid } from "../lib/ids";

/**
 * Usuários e sessões (DBee.md §7).
 *
 * `password_hash` **nunca** aparece na lista de colunas públicas — mesma
 * barreira dupla de `connections.repo.ts`: o tipo não tem o campo, e o SELECT
 * não pede a coluna.
 */
const PUBLIC_COLUMNS = `
  id, username,
  must_change_password AS mustChangePassword,
  locale,
  created_at AS createdAt
`;

interface UserRow {
  id: string;
  username: string;
  mustChangePassword: number;
  locale: string;
  createdAt: string;
}

const toUser = (row: UserRow): SessionUser => ({
  ...row,
  mustChangePassword: row.mustChangePassword === 1,
  // O CHECK da migração 003 garante o domínio; o cast só reconcilia o tipo
  // largo do SQLite (string) com a união fechada de `Locale`.
  locale: row.locale as Locale,
});

/**
 * O token da sessão tem 256 bits de aleatoriedade, então **SHA-256 basta** para
 * guardá-lo — não é senha de gente, é segredo de alta entropia. argon2id aqui
 * custaria ~180 ms **por requisição autenticada**, para proteger contra um
 * ataque de dicionário que não existe sobre 256 bits.
 */
const hashToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

/** Token novo: 32 bytes, base64url — cabe num cookie sem escape. */
const novoToken = (): string => randomBytes(32).toString("base64url");

export interface SessaoResolvida {
  readonly user: SessionUser;
  readonly tokenHash: string;
}

interface SessionRow {
  token_hash: string;
  user_id: string;
  expires_at: string;
}

export class UsersRepository {
  readonly #db: Database;

  readonly #porNome: Statement<UserRow & { password_hash: string }, [string]>;
  readonly #porId: Statement<UserRow, [string]>;
  readonly #contar: Statement<{ n: number }, []>;
  readonly #criar: Statement<unknown, [string, string, string, number, string, string]>;
  readonly #trocarSenha: Statement<unknown, [string, string, string]>;
  readonly #atualizarIdioma: Statement<unknown, [string, string, string]>;

  readonly #criarSessao: Statement<unknown, [string, string, string, string]>;
  readonly #buscarSessao: Statement<SessionRow, [string]>;
  readonly #apagarSessao: Statement<unknown, [string]>;
  readonly #apagarSessoesDoUsuario: Statement<unknown, [string]>;
  readonly #limparExpiradas: Statement<unknown, [string]>;

  constructor(db: Database) {
    this.#db = db;

    this.#porNome = db.query(
      `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE username = ?`,
    );
    this.#porId = db.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`);
    this.#contar = db.query("SELECT COUNT(*) AS n FROM users");
    this.#criar = db.query(
      `INSERT INTO users (id, username, password_hash, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.#trocarSenha = db.query(
      `UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`,
    );
    this.#atualizarIdioma = db.query(
      `UPDATE users SET locale = ?, updated_at = ? WHERE id = ?`,
    );

    this.#criarSessao = db.query(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
    );
    this.#buscarSessao = db.query(
      "SELECT token_hash, user_id, expires_at FROM sessions WHERE token_hash = ?",
    );
    this.#apagarSessao = db.query("DELETE FROM sessions WHERE token_hash = ?");
    this.#apagarSessoesDoUsuario = db.query("DELETE FROM sessions WHERE user_id = ?");
    this.#limparExpiradas = db.query("DELETE FROM sessions WHERE expires_at <= ?");
  }

  contar(): number {
    return this.#contar.get()?.n ?? 0;
  }

  /**
   * Devolve o usuário **com o hash** — só o serviço de auth chama, e é o único
   * caminho em que o hash sai da tabela.
   */
  comHashPorNome(username: string): { user: SessionUser; passwordHash: string } | null {
    const row = this.#porNome.get(username);
    if (row === null) return null;
    const { password_hash, ...publico } = row;
    return { user: toUser(publico), passwordHash: password_hash };
  }

  porId(id: string): SessionUser | null {
    const row = this.#porId.get(id);
    return row === null ? null : toUser(row);
  }

  criar(username: string, passwordHash: string, mustChangePassword: boolean): SessionUser {
    const id = nanoid();
    const agora = new Date().toISOString();
    this.#criar.run(id, username, passwordHash, mustChangePassword ? 1 : 0, agora, agora);
    return { id, username, mustChangePassword, locale: "pt", createdAt: agora };
  }

  /**
   * Troca a senha e **derruba todas as sessões do usuário**, numa transação só.
   *
   * Trocar senha sem invalidar sessão deixa quem já estava dentro continuar
   * dentro — e trocar senha é justamente o que se faz quando se suspeita que
   * alguém está.
   */
  trocarSenha(userId: string, passwordHash: string): void {
    this.#db.transaction(() => {
      this.#trocarSenha.run(passwordHash, new Date().toISOString(), userId);
      this.#apagarSessoesDoUsuario.run(userId);
    })();
  }

  /** Grava o idioma escolhido. Não derruba sessão — é preferência, não segredo. */
  atualizarIdioma(userId: string, locale: Locale): void {
    this.#atualizarIdioma.run(locale, new Date().toISOString(), userId);
  }

  abrirSessao(userId: string): { token: string; expiraEm: Date } {
    const token = novoToken();
    const agora = new Date();
    const expira = new Date(agora.getTime() + SESSION_TTL_MS);

    // Oportunidade barata de limpeza: uma linha por login, sem varredura.
    this.#limparExpiradas.run(agora.toISOString());
    this.#criarSessao.run(hashToken(token), userId, agora.toISOString(), expira.toISOString());
    return { token, expiraEm: expira };
  }

  /**
   * Resolve o cookie numa sessão viva.
   *
   * Só leitura, sem `UPDATE`: é chamado duas vezes por requisição — uma no
   * guard (que roda em `onRequest`, antes de o corpo ser lido) e outra no
   * `derive` que tipa o contexto. Duas leituras indexadas custam ~0,04 ms;
   * duas escritas por requisição seriam amplificação para alimentar um campo
   * que nenhuma regra consulta.
   *
   * Sessão expirada é **apagada**, não só ignorada: deixá-la na tabela faz o
   * arquivo crescer e mantém uma linha que já não vale nada.
   */
  resolverSessao(token: string): SessaoResolvida | null {
    const tokenHash = hashToken(token);
    const sessao = this.#buscarSessao.get(tokenHash);
    if (sessao === null) return null;

    if (new Date(sessao.expires_at).getTime() <= Date.now()) {
      this.#apagarSessao.run(tokenHash);
      return null;
    }

    const user = this.#porId.get(sessao.user_id);
    if (user === null) {
      this.#apagarSessao.run(tokenHash);
      return null;
    }

    return { user: toUser(user), tokenHash };
  }

  /**
   * Fecha a sessão **no servidor** (DBee.md §7).
   *
   * Apagar só o cookie no cliente não é logout: o token continua válido, e
   * quem tiver uma cópia dele — extensão, proxy, log de requisição — continua
   * autenticado. O apagar aqui é o que torna o logout real.
   */
  fecharSessao(tokenHash: string): void {
    this.#apagarSessao.run(tokenHash);
  }

  /** Só para teste: quantas sessões vivas o usuário tem. */
  contarSessoes(userId: string): number {
    return (
      this.#db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?")
        .get(userId)?.n ?? 0
    );
  }
}

/**
 * Comparação de tokens em tempo constante.
 *
 * Não é usada no caminho do cookie (ali o índice do SQLite já faz a busca pelo
 * hash), e sim onde dois segredos precisam ser comparados diretamente.
 */
export function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
