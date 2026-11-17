import { randomBytes } from "node:crypto";

import type { ApiTokenSummary, CreateApiTokenResponse, SessionUser } from "@dbee/shared";

import type { ApiTokensRepository } from "../db/apiTokens.repo";
import type { UsersRepository } from "../db/users.repo";
import type { Ator } from "../lib/ator";
import { RateLimiter } from "../lib/rateLimit";

/**
 * Tokens pessoais para o MCP (ADR 015).
 *
 * Formato `dbee_<prefixo>_<segredo>`: o prefixo (12 hex, público) acha a linha
 * por índice; o segredo (32 bytes base64url) é verificado contra o hash
 * argon2id. O token inteiro só existe na resposta de criação.
 */
const FORMATO = /^dbee_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

/**
 * Falhas de token por origem. Mesmo limite do login: quem erra token é
 * script mal configurado, não pessoa — 10 em 15 min é folga de sobra para o
 * legítimo e trava varredura.
 */
const LIMITE = { tentativas: 10, janelaMs: 15 * 60_000 };

export type FalhaDeToken = "unauthenticated" | "password_change_required" | "rate_limited";

export interface AutenticacaoMcp {
  readonly user: SessionUser;
  readonly tokenId: string;
  readonly tokenName: string;
}

export class ApiTokensService {
  readonly #tokens: ApiTokensRepository;
  readonly #users: UsersRepository;
  readonly #falhas = new RateLimiter(LIMITE);

  constructor(tokens: ApiTokensRepository, users: UsersRepository) {
    this.#tokens = tokens;
    this.#users = users;
  }

  listar(userId: string): ApiTokenSummary[] {
    return this.#tokens.listar(userId);
  }

  async criar(userId: string, name: string): Promise<CreateApiTokenResponse> {
    const prefix = randomBytes(6).toString("hex");
    const segredo = randomBytes(32).toString("base64url");
    const hash = await Bun.password.hash(segredo, { algorithm: "argon2id" });
    const token = this.#tokens.criar(userId, name.trim(), prefix, hash);
    return { token, secret: `dbee_${prefix}_${segredo}` };
  }

  /**
   * Revoga. O dono revoga o seu; admin revoga qualquer um (token de quem saiu
   * da equipe, por exemplo). `false` cobre "não existe" e "não é seu" — a
   * mesma resposta para os dois, como no `resolve` de conexão.
   */
  revogar(id: string, ator: Ator): boolean {
    const token = this.#tokens.porId(id);
    if (token === null) return false;
    if (token.userId !== ator.id && ator.role !== "admin") return false;
    this.#tokens.revogar(id);
    return true;
  }

  /**
   * Resolve `Authorization: Bearer …` num usuário, ou numa falha.
   *
   * Toda falha de token conta no rate limit da origem, inclusive formato
   * errado — senão a varredura só precisaria acertar o formato. Usuário com
   * troca de senha pendente é recusado: a senha provisória é conhecida por
   * quem a entregou, e o token não pode ser o atalho em volta da troca.
   */
  async autenticar(
    authorization: string | null,
    origem: string,
  ): Promise<{ ok: true; value: AutenticacaoMcp } | { ok: false; failure: FalhaDeToken }> {
    if (!this.#falhas.consultar(origem).permitido) return { ok: false, failure: "rate_limited" };

    const falhar = (): { ok: false; failure: FalhaDeToken } => {
      this.#falhas.registrar(origem);
      return { ok: false, failure: "unauthenticated" };
    };

    const bruto = authorization?.startsWith("Bearer ") === true ? authorization.slice(7).trim() : null;
    if (bruto === null) return falhar();
    const partes = FORMATO.exec(bruto);
    const prefix = partes?.[1];
    const segredo = partes?.[2];
    if (prefix === undefined || segredo === undefined) return falhar();

    const linha = this.#tokens.porPrefixo(prefix);
    if (linha === null) return falhar();
    if (!(await Bun.password.verify(segredo, linha.hash))) return falhar();

    // Usuário removido some por CASCADE; o `porId` nulo é a corrida entre os dois.
    const user = this.#users.porId(linha.userId);
    if (user === null) return falhar();
    if (user.mustChangePassword) return { ok: false, failure: "password_change_required" };

    this.#falhas.limpar(origem);
    this.#tokens.tocar(linha.id);
    return { ok: true, value: { user, tokenId: linha.id, tokenName: linha.name } };
  }
}
