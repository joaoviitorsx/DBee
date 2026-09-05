import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
/**
 * Modo setup — token no volume, nunca no log (DBee.md §7).
 *
 * Enquanto não há conta, o primeiro acesso se faz por uma tela de setup: o boot
 * grava um token aleatório em `<dataDir>/setup-token` com permissão `0600`, e o
 * operador o lê do volume (`docker exec … cat`, ou o terminal do serviço no
 * Dokploy) para criar a primeira conta. **A senha nunca é gerada nem impressa** —
 * senha em log é senha visível para quem tem o painel. O token troca "quem leu o
 * log" por "quem tem acesso ao volume", que já é quem tem o SQLite inteiro.
 */
const NOME_TOKEN = "setup-token";

export function caminhoTokenSetup(dataDir: string): string {
  return join(dataDir, NOME_TOKEN);
}

/**
 * Garante o estado de setup no boot. Sem usuário: cria o token se faltar e
 * imprime só o **caminho** (nunca o token). Com usuário: remove o token, que já
 * não tem função e não deve sobreviver no volume.
 */
export function garantirSetup(dataDir: string, temUsuarios: boolean): void {
  const caminho = caminhoTokenSetup(dataDir);
  if (temUsuarios) {
    if (existsSync(caminho)) rmSync(caminho, { force: true });
    return;
  }
  if (!existsSync(caminho)) {
    // `mode` no write respeita o umask; o chmod depois crava o 0600 de fato.
    writeFileSync(caminho, randomBytes(32).toString("base64url"), { mode: 0o600 });
    chmodSync(caminho, 0o600);
  }
  const linha = "─".repeat(64);
  console.log(
    `\n${linha}\n` +
      `  SETUP — nenhuma conta ainda.\n\n` +
      `  Leia o token e crie a primeira conta na tela de setup:\n` +
      `    docker exec <container> cat ${caminho}\n` +
      `  (no Dokploy, use o terminal do serviço). O token NÃO aparece no log.\n${linha}\n`,
  );
}

/** Confere o token fornecido contra o do volume, em tempo constante. */
export function tokenSetupConfere(dataDir: string, fornecido: string): boolean {
  const caminho = caminhoTokenSetup(dataDir);
  if (!existsSync(caminho)) return false;
  const real = Buffer.from(readFileSync(caminho, "utf8").trim());
  const dado = Buffer.from(fornecido);
  // `timingSafeEqual` exige o mesmo comprimento; comparar antes vaza só o
  // tamanho, não o conteúdo — e o token tem tamanho fixo de qualquer forma.
  if (real.length !== dado.length) return false;
  return timingSafeEqual(real, dado);
}

/** Apaga o token após o setup concluir. */
export function apagarTokenSetup(dataDir: string): void {
  rmSync(caminhoTokenSetup(dataDir), { force: true });
}
