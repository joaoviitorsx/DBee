import { describe, expect, it } from "bun:test";

import { ehLinkLocal, ehMetadadoDeNuvem } from "./rede";
import { alvoValidado } from "../libsql/cliente";

/**
 * Achado #11 da auditoria: a URL do servidor libSQL chegava ao `fetch` sem
 * passar por nada. Diferente do webhook de deploy, **aqui o corpo da resposta
 * vira a grade na tela** — o alcance não é disparar, é ler.
 */
describe("endereços barrados", () => {
  it("o 169.254.169.254 das nuvens é link-local", () => {
    expect(ehLinkLocal("169.254.169.254")).toBe(true);
    expect(ehLinkLocal("169.254.0.1")).toBe(true);
  });

  it("fe80::/10 e o fd00:ec2::254 da AWS, com ou sem colchete", () => {
    expect(ehLinkLocal("fe80::1")).toBe(true);
    expect(ehLinkLocal("[fe80::1]")).toBe(true);
    expect(ehLinkLocal("fd00:ec2::254")).toBe(true);
    expect(ehLinkLocal("[FD00:EC2::254]")).toBe(true);
  });

  it("o metadado do Google também tem nome", () => {
    expect(ehMetadadoDeNuvem("metadata.google.internal")).toBe(true);
    expect(ehMetadadoDeNuvem("METADATA.GOOG")).toBe(true);
  });

  /*
   * O que NÃO é bloqueado é decisão, não esquecimento: o DBee é self-hosted e o
   * banco normalmente vive na rede privada do compose ou num `100.x` da
   * tailnet. Bloquear isso mataria o produto.
   */
  it("faixa privada e tailnet continuam alcançáveis, de propósito", () => {
    for (const h of ["10.0.0.5", "172.16.3.9", "192.168.1.20", "100.101.102.103", "localhost"]) {
      expect(`${h}: ${String(ehMetadadoDeNuvem(h))}`).toBe(`${h}: false`);
    }
  });

  /*
   * `169.254` é prefixo de texto. Um host que só COMEÇA parecido não pode cair
   * junto — `169.2540.1` não é endereço, mas `169.254.169.254.exemplo.com` é um
   * domínio legítimo e não deve ser confundido com o endereço.
   */
  it("não confunde 16.9.254 nem um domínio que contém o número", () => {
    expect(ehMetadadoDeNuvem("16.9.254.1")).toBe(false);
    expect(ehMetadadoDeNuvem("meu-169.254.169.254.exemplo.com")).toBe(false);
  });
});

describe("alvoValidado (libSQL)", () => {
  it("aceita http e https e tira a barra final", () => {
    expect(alvoValidado("http://libsql.local:8080/")).toBe("http://libsql.local:8080");
    expect(alvoValidado("https://db.exemplo.com")).toBe("https://db.exemplo.com");
  });

  it("recusa o serviço de metadado", () => {
    expect(() => alvoValidado("http://169.254.169.254/latest/meta-data/")).toThrow(
      "serviço de metadado",
    );
    expect(() => alvoValidado("http://metadata.google.internal/")).toThrow("serviço de metadado");
  });

  /*
   * Sem a checagem de protocolo, `file:///etc/passwd` e um `data:` chegariam ao
   * `fetch`. Nenhum dos dois é servidor libSQL.
   */
  it("recusa protocolo que não é http", () => {
    for (const u of ["file:///etc/passwd", "ftp://x/", "data:text/plain,oi"]) {
      expect(() => alvoValidado(u)).toThrow("http ou https");
    }
  });

  it("recusa texto que não é URL", () => {
    expect(() => alvoValidado("libsql.local:8080")).toThrow();
    expect(() => alvoValidado("")).toThrow();
  });
});
