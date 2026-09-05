import type { Locale, LoginRequest, SessionUser, SetupRequest } from "@dbee/shared";

import { apagarTokenSetup, tokenSetupConfere } from "../db/bootstrap";
import type { UsersRepository } from "../db/users.repo";
import { RateLimiter } from "../lib/rateLimit";
import { type AuthResult, authFail, authOk } from "./result";

/**
 * Autenticação (DBee.md §7).
 *
 * Três coisas aqui não são detalhe de implementação — são as três formas mais
 * comuns de uma autenticação vazar, e cada uma tem teste próprio:
 *
 * 1. **Logout invalida no servidor**, não só apaga o cookie. Ver `logout()`.
 * 2. **Falha de login não distingue** "usuário não existe" de "senha errada",
 *    nem na mensagem nem no tempo. Ver `login()`.
 * 3. **Senha trocada derruba as sessões** do usuário (no repositório).
 */

/**
 * Hash de comparação para usuário inexistente.
 *
 * Sem isto, "usuário não existe" responde em ~0 ms e "senha errada" em ~180 ms
 * — e a diferença é medível de fora, entregando a lista de quem tem conta. Com
 * isto, os dois caminhos gastam um argon2id.
 *
 * Não é credencial: é o hash de uma string aleatória descartada na geração, e
 * nenhuma conta o usa. Está fixo no fonte de propósito — calcular no boot
 * deixaria a **primeira** tentativa mais rápida que as seguintes, que é o
 * mesmo vazamento com outra forma.
 */
const HASH_DE_COMPARACAO =
  "$argon2id$v=19$m=65536,t=2,p=1$Oh+HGT4/PHErrfqezMrUV4x8bKs9ORIVgiGIUwrKUxI$TJYyfsLOlVkn0W6M4VNgTNztVXBdoLcjLATAbQbBFdo";

/**
 * 10 tentativas em 15 minutos, por usuário **e** por origem.
 *
 * Duas chaves porque elas cobrem ataques diferentes: por usuário barra quem
 * martela uma conta de vários lugares; por origem barra quem varre vários
 * nomes do mesmo lugar. Uma só deixaria o outro passar.
 */
const LIMITE = { tentativas: 10, janelaMs: 15 * 60_000 };

export interface AuthServiceDeps {
  readonly users: UsersRepository;
  /**
   * Diretório de dados, onde vive o `setup-token`. Ausente em testes que não
   * exercitam o setup — aí `concluirSetup` recusa por falta de token.
   */
  readonly dataDir?: string | undefined;
}

export interface LoginOk {
  readonly user: SessionUser;
  readonly token: string;
  readonly expiraEm: Date;
}

export class AuthService {
  readonly #users: UsersRepository;
  readonly #dataDir: string | undefined;
  readonly #porUsuario = new RateLimiter(LIMITE);
  readonly #porOrigem = new RateLimiter(LIMITE);
  readonly #porSetup = new RateLimiter(LIMITE);

  constructor({ users, dataDir }: AuthServiceDeps) {
    this.#users = users;
    this.#dataDir = dataDir;
  }

  /** Modo setup: verdadeiro enquanto não existe nenhuma conta. */
  setupRequerido(): boolean {
    return this.#users.contar() === 0;
  }

  /**
   * Cria a primeira conta a partir do token de setup e já abre a sessão.
   *
   * Recusa se já há conta (`setup_done`) — a rota é aberta, então esta é a trava
   * que impede alguém criar uma segunda "primeira conta" depois. O token é
   * conferido em tempo constante contra o arquivo do volume; senha e usuário são
   * os que o operador escolheu (sem `mustChangePassword` — ninguém os imprimiu).
   */
  async concluirSetup(
    body: SetupRequest,
    origem: string,
  ): Promise<AuthResult<LoginOk, "setup_done" | "invalid_token" | "rate_limited">> {
    if (this.#users.contar() > 0) return authFail("setup_done");

    const antes = this.#porSetup.consultar(origem);
    if (!antes.permitido) {
      return authFail("rate_limited", `tente de novo em ${String(antes.esperarSegundos)}s`);
    }
    this.#porSetup.registrar(origem);

    if (this.#dataDir === undefined || !tokenSetupConfere(this.#dataDir, body.token)) {
      return authFail("invalid_token");
    }

    const username = body.username.trim().toLowerCase();
    const hash = await Bun.password.hash(body.password, { algorithm: "argon2id" });
    const user = this.#users.criar(username, hash, false);
    apagarTokenSetup(this.#dataDir);
    this.#porSetup.limpar(origem);

    const { token, expiraEm } = this.#users.abrirSessao(user.id);
    return authOk({ user, token, expiraEm });
  }

  async login(
    body: LoginRequest,
    origem: string,
  ): Promise<AuthResult<LoginOk, "invalid_credentials" | "rate_limited">> {
    const username = body.username.trim().toLowerCase();

    // Consulta antes de trabalhar: um argon2id por tentativa é justamente o
    // que o limite existe para não deixar acontecer sem teto.
    const antesUsuario = this.#porUsuario.consultar(username);
    const antesOrigem = this.#porOrigem.consultar(origem);
    if (!antesUsuario.permitido || !antesOrigem.permitido) {
      const espera = Math.max(antesUsuario.esperarSegundos, antesOrigem.esperarSegundos);
      return authFail("rate_limited", `tente de novo em ${String(espera)}s`);
    }

    this.#porUsuario.registrar(username);
    this.#porOrigem.registrar(origem);

    const encontrado = this.#users.comHashPorNome(username);

    // O `verify` roda **nos dois caminhos**. Sair antes quando o usuário não
    // existe é o vazamento de tempo descrito em HASH_DE_COMPARACAO.
    const hash = encontrado?.passwordHash ?? HASH_DE_COMPARACAO;
    const senhaConfere = await Bun.password.verify(body.password, hash);

    if (encontrado === null || !senhaConfere) {
      return authFail("invalid_credentials");
    }

    this.#porUsuario.limpar(username);
    this.#porOrigem.limpar(origem);

    const { token, expiraEm } = this.#users.abrirSessao(encontrado.user.id);
    return authOk({ user: encontrado.user, token, expiraEm });
  }

  /**
   * Fecha a sessão **no servidor**.
   *
   * Apagar só o cookie no cliente deixaria o token válido: quem tiver uma
   * cópia dele — extensão, proxy, log de requisição, backup do navegador —
   * continua autenticado depois do "sair". O que torna o logout real é a linha
   * sumir da tabela.
   */
  logout(tokenHash: string): void {
    this.#users.fecharSessao(tokenHash);
  }

  /**
   * Troca de senha.
   *
   * Exige a senha atual mesmo com sessão válida: sessão roubada não deve poder
   * trancar o dono para fora. E derruba **todas** as sessões do usuário,
   * inclusive a que fez a troca — trocar senha é o que se faz quando se
   * suspeita que outra pessoa está dentro.
   */
  async trocarSenha(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthResult<SessionUser, "unauthenticated" | "invalid_credentials">> {
    const user = this.#users.porId(userId);
    if (user === null) return authFail("unauthenticated");

    const encontrado = this.#users.comHashPorNome(user.username);
    if (encontrado === null) return authFail("unauthenticated");

    if (!(await Bun.password.verify(currentPassword, encontrado.passwordHash))) {
      return authFail("invalid_credentials", "a senha atual não confere");
    }

    const hash = await Bun.password.hash(newPassword, { algorithm: "argon2id" });
    this.#users.trocarSenha(userId, hash);
    return authOk({ ...user, mustChangePassword: false });
  }

  /**
   * Grava o idioma escolhido e devolve o usuário atualizado, para o `/me` do
   * front reidratar sem uma segunda ida ao servidor.
   */
  definirIdioma(
    userId: string,
    locale: Locale,
  ): AuthResult<SessionUser, "unauthenticated"> {
    const user = this.#users.porId(userId);
    if (user === null) return authFail("unauthenticated");
    this.#users.atualizarIdioma(userId, locale);
    return authOk({ ...user, locale });
  }
}
