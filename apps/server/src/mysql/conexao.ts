import { isIP } from "node:net";

import type { SslMode } from "@dbee/shared";

/**
 * Como o DBee fala TLS com MySQL e MariaDB — e o único modo que ele **recusa**.
 *
 * O ADR 003 diz que existem três modos e que cada um significa o que promete.
 * No `pg` isso custou uma verificação de identidade escrita à mão, porque o
 * driver não confere SAN de IP. No `mysql2` o mesmo remendo **não é possível**,
 * e essa diferença é o assunto deste arquivo.
 *
 * ## O que foi medido (`docs/multi-engine.md` §3c)
 *
 * MySQL 8.4 com TLS, CA própria, três certificados — SAN de IP correto, SAN de
 * nome errado, e outra CA:
 *
 * | configuração do `mysql2` | cadeia | identidade |
 * |---|---|---|
 * | `rejectUnauthorized: true` | verificada | **não conferida** |
 * | `+ verifyIdentity`, host é nome | verificada | conferida, correta |
 * | `+ verifyIdentity`, host é IP | verificada | **quebrada** — recusa o certificado legítimo |
 * | `checkServerIdentity` próprio | verificada | **ignorado** |
 *
 * A causa está em `mysql2/lib/base/connection.js`:
 *
 * ```js
 * const servername = Net.isIP(this.config.host) ? undefined : this.config.host;
 * ```
 *
 * Com IP o `servername` some, o `checkServerIdentity` do `node:tls` cai no
 * padrão `localhost`, e a reconferência seguinte é guardada por
 * `typeof servername === 'string'` — não roda. E o driver **sobrescreve**
 * `checkServerIdentity`, então a saída que o `pg/ssl.ts` usa está fechada aqui.
 * Reproduzido igual sob Bun 1.3.14 e Node 22: é o driver, não o runtime.
 *
 * ## Por que recusar em vez de aceitar em silêncio
 *
 * Restaria conectar com `rejectUnauthorized: true` sem conferir identidade e
 * chamar isso de `verify-full`. Seria mentira com consequência: quem tem
 * qualquer certificado emitido por aquela mesma CA passaria a se fazer passar
 * pelo servidor, e a senha do banco vai no fio **depois** do TLS subir — ou
 * seja, direto para o impostor.
 *
 * Conferir depois do handshake também não salva: a credencial já foi.
 *
 * Então a combinação `verify-full` + host que é IP é **recusada**, com o motivo
 * escrito. Tirar `verify-full` da engine inteira puniria quem usa nome de host,
 * onde ele funciona de verdade — medido.
 */

/** O que o `mysql2` aceita em `ssl`. Sem negociação, como no `pg` (ADR 003). */
export interface MysqlSslConfig {
  readonly rejectUnauthorized: boolean;
  readonly ca?: string;
  /** Ligar a conferência de identidade do próprio driver. Só serve com host DNS. */
  readonly verifyIdentity?: boolean;
}

/** Recusa explicada, para virar erro com texto útil na camada de cima. */
export interface RecusaSsl {
  readonly recusado: true;
  readonly motivo: string;
}

export type ResultadoSsl = { readonly recusado: false; readonly ssl: MysqlSslConfig | false } | RecusaSsl;

export function ehRecusa(r: ResultadoSsl): r is RecusaSsl {
  return r.recusado;
}

/**
 * A configuração de TLS para uma conexão MySQL/MariaDB.
 *
 * - `disable`     → texto claro, dito em voz alta
 * - `require`     → criptografa, **não** autentica o servidor
 * - `verify-full` → criptografa, valida cadeia e identidade — só com host DNS
 */
export function sslMysqlPara(
  modo: SslMode,
  caCert: string | undefined,
  host: string,
): ResultadoSsl {
  switch (modo) {
    case "disable":
      return { recusado: false, ssl: false };
    case "require":
      // Sem `verifyIdentity`: `require` promete sigilo, não identidade, e
      // ligar a conferência aqui faria o modo mais permissivo recusar mais que
      // o mais restrito.
      return { recusado: false, ssl: { rejectUnauthorized: false } };
    case "verify-full": {
      if (isIP(host) !== 0) {
        return {
          recusado: true,
          motivo:
            `verify-full não é possível para MySQL/MariaDB quando o host é um endereço IP (${host}). ` +
            `O driver mysql2 descarta o nome do servidor quando o host é numérico, e a conferência de ` +
            `identidade passa a comparar contra "localhost" — ela recusaria até um certificado com ` +
            `"IP:${host}" entre os SANs. Use um hostname DNS nesta conexão, ou escolha require, ` +
            `ciente de que ele criptografa sem autenticar o servidor.`,
        };
      }
      const base: MysqlSslConfig =
        caCert === undefined
          ? { rejectUnauthorized: true, verifyIdentity: true }
          : { rejectUnauthorized: true, ca: caCert, verifyIdentity: true };
      return { recusado: false, ssl: base };
    }
  }
}
