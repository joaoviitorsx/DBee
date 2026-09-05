import { randomBytes } from "node:crypto";

import type { SessionUser } from "@dbee/shared";

import type { UsersRepository } from "./users.repo";

/**
 * Primeiro usuário, no primeiro boot (DBee.md §7).
 *
 * Sem isto o app sobe sem ninguém e sem caminho de entrada — e a alternativa
 * comum, um usuário `admin/admin` fixo, é pior que não ter auth: dá aparência
 * de proteção com uma senha que todo mundo sabe.
 */

export const USUARIO_INICIAL = "admin";

/**
 * Senha de 24 caracteres de um alfabeto sem par ambíguo.
 *
 * `0/O`, `1/l/I` e `5/S` estão fora porque esta senha vai ser **lida de um log
 * e digitada à mão** — e uma senha correta digitada errada por causa da fonte
 * do terminal vira um chamado de suporte que parece bug de autenticação.
 *
 * Sobram 53 símbolos: 24 deles são ~137 bits, muito além do que argon2id
 * precisa proteger. O teste trava a exclusão, porque foi ela que eu errei da
 * primeira vez — o comentário dizia `5/S` e o alfabeto os continha.
 */
const ALFABETO = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRTUVWXYZ2346789";
const COMPRIMENTO = 24;

function senhaAleatoria(): string {
  // 55 símbolos não divide 256, então `% 55` enviesaria (§ ids.ts). Rejeição
  // dos bytes acima do maior múltiplo de 55 abaixo de 256 remove o viés.
  const teto = Math.floor(256 / ALFABETO.length) * ALFABETO.length;
  let senha = "";
  while (senha.length < COMPRIMENTO) {
    for (const b of randomBytes(COMPRIMENTO)) {
      if (b >= teto) continue;
      senha += ALFABETO.charAt(b % ALFABETO.length);
      if (senha.length === COMPRIMENTO) break;
    }
  }
  return senha;
}

export interface PrimeiroUsuario {
  readonly user: SessionUser;
  readonly senha: string;
}

/**
 * Cria o primeiro usuário se não houver nenhum. Devolve `null` quando já há.
 *
 * A senha nasce com `mustChangePassword`: ela vai para o stdout, e stdout vai
 * para o log do Docker, para o Dokploy e para quem tiver acesso a qualquer um
 * dos dois. Senha impressa em log é senha conhecida — a única postura honesta é
 * tratá-la como temporária desde o primeiro segundo.
 */
export async function criarPrimeiroUsuario(
  users: UsersRepository,
): Promise<PrimeiroUsuario | null> {
  if (users.contar() > 0) return null;

  const senha = senhaAleatoria();
  const hash = await Bun.password.hash(senha, { algorithm: "argon2id" });
  const user = users.criar(USUARIO_INICIAL, hash, true);
  return { user, senha };
}

/** O aviso do primeiro boot, impresso **uma vez** e nunca mais. */
export function avisarPrimeiroUsuario({ user, senha }: PrimeiroUsuario): void {
  const linha = "─".repeat(64);
  console.log(
    `\n${linha}\n` +
      `  PRIMEIRO ACESSO — este bloco aparece uma única vez.\n\n` +
      `    usuário: ${user.username}\n` +
      `    senha:   ${senha}\n\n` +
      `  A troca é obrigatória no primeiro login: a senha acima está no log\n` +
      `  do container, então já não é secreta.\n${linha}\n`,
  );
}
