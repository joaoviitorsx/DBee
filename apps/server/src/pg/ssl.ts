import type { SslMode } from "@dbee/shared";

/** O que o `pg` aceita em `ssl`. Nada de negociação — ADR 003. */
export type PgSslConfig = false | { rejectUnauthorized: boolean; ca?: string };

/**
 * Três modos, nenhum com fallback (ADR 003):
 *
 * - `disable`     → texto claro, dito em voz alta
 * - `require`     → criptografa, **não** autentica o servidor (não protege MITM)
 * - `verify-full` → criptografa e valida cadeia e hostname
 *
 * `prefer` e `allow` não existem: cair para texto claro em silêncio faz o
 * usuário acreditar que está protegido quando não está.
 */
export function sslConfigFor(mode: SslMode, caCert: string | undefined): PgSslConfig {
  switch (mode) {
    case "disable":
      return false;
    case "require":
      return { rejectUnauthorized: false };
    case "verify-full":
      // Sem `ca` explícito, o `rejectUnauthorized: true` valida contra o CA
      // store do sistema. O hostname é conferido pelo próprio node:tls.
      return caCert === undefined ? { rejectUnauthorized: true } : { rejectUnauthorized: true, ca: caCert };
  }
}
