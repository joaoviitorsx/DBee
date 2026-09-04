import { isIP } from "node:net";
import { checkServerIdentity as defaultCheck, type PeerCertificate } from "node:tls";

import type { SslMode } from "@dbee/shared";

/** O que o `pg` aceita em `ssl`. Nada de negociação — ADR 003. */
export type PgSslConfig =
  | false
  | {
      rejectUnauthorized: boolean;
      ca?: string;
      checkServerIdentity?: (hostname: string, cert: PeerCertificate) => Error | undefined;
    };

/**
 * Normaliza um IP para comparação textual.
 *
 * IPv4 é comparado literalmente. IPv6 é comparado em minúsculas e sem os
 * colchetes que às vezes acompanham a forma literal; não fazemos expansão de
 * `::` porque tanto o campo `host` quanto o SAN vêm do mesmo formato canônico
 * do OpenSSL na prática — e, na dúvida, a comparação falha fechada.
 */
function normalizeIp(value: string): string {
  return value.trim().replace(/^\[|]$/g, "").toLowerCase();
}

/**
 * Extrai os SANs do tipo `IP Address` do certificado.
 *
 * `subjectaltname` vem como `"DNS:a.b, IP Address:10.0.0.4, IP Address:..."`.
 * Só as entradas de IP interessam: DNS não cobre um host numérico.
 */
function ipSans(cert: PeerCertificate): string[] {
  const raw = cert.subjectaltname;
  if (typeof raw !== "string" || raw === "") return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("IP Address:"))
    .map((entry) => normalizeIp(entry.slice("IP Address:".length)));
}

/**
 * Verificação de identidade quando o host é um **IP** (ADR 003).
 *
 * O `pg` só define `servername` quando o host é nome DNS (`net.isIP === 0`), e
 * passa a `tls.connect` apenas `{ socket, ...ssl }` — sem `host`. Com IP, o
 * `node:tls` não tem contra o que comparar e cai para `localhost`, então
 * `verify-full` falha por mais correto que o certificado seja. Como o cenário
 * real do DBee é `10.x` e Tailscale `100.x`, isso deixaria o único modo que
 * autentica o servidor inutilizável — e empurraria todo mundo para `require`,
 * que criptografa sem autenticar ninguém.
 *
 * Regras, todas deliberadas:
 *
 * - Compara o IP **apenas** contra SANs do tipo `iPAddress`.
 * - **Não** cai para o CN. CN é obsoleto para identidade (RFC 6125) e aceitar
 *   um CN numérico reabriria a porta que o SAN fechou.
 * - **Não** casa por substring: `10.0.0.4` não pode casar `110.0.0.42`.
 * - **Falha fechada** quando não há SAN de IP nenhum.
 * - A mensagem diz que o certificado não cobre aquele IP — não "erro de TLS".
 */
export function checkIdentityForIp(host: string): (
  hostname: string,
  cert: PeerCertificate,
) => Error | undefined {
  const alvo = normalizeIp(host);

  return (_hostname, cert) => {
    const sans = ipSans(cert);

    if (sans.length === 0) {
      return new Error(
        `o certificado do servidor não declara nenhum SAN do tipo IP, e a conexão é por ` +
          `endereço (${host}). Emita o certificado com "IP:${host}" entre os SANs, ` +
          `ou use um hostname DNS nesta conexão.`,
      );
    }

    // Igualdade exata, nunca substring.
    if (sans.includes(alvo)) return undefined;

    return new Error(
      `o certificado do servidor não cobre o IP ${host}. ` +
        `SANs de IP presentes: ${sans.join(", ")}.`,
    );
  };
}

/**
 * Três modos, nenhum com fallback (ADR 003):
 *
 * - `disable`     → texto claro, dito em voz alta
 * - `require`     → criptografa, **não** autentica o servidor (não protege MITM)
 * - `verify-full` → criptografa e valida cadeia e identidade
 *
 * `prefer` e `allow` não existem: cair para texto claro em silêncio faz o
 * usuário acreditar que está protegido quando não está.
 */
export function sslConfigFor(
  mode: SslMode,
  caCert: string | undefined,
  host?: string,
): PgSslConfig {
  switch (mode) {
    case "disable":
      return false;
    case "require":
      return { rejectUnauthorized: false };
    case "verify-full": {
      const base: { rejectUnauthorized: boolean; ca?: string } =
        caCert === undefined
          ? { rejectUnauthorized: true }
          : { rejectUnauthorized: true, ca: caCert };

      // Host DNS: o `node:tls` já confere o hostname pelo `servername` que o
      // `pg` define. Só o caso de IP precisa da verificação própria.
      if (host === undefined || isIP(host) === 0) return base;

      return { ...base, checkServerIdentity: checkIdentityForIp(host) };
    }
  }
}

/** Reexportado para teste: garante que o default do node continua acessível. */
export const nodeDefaultCheck = defaultCheck;
