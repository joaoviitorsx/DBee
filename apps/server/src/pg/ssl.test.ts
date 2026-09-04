import type { PeerCertificate } from "node:tls";
import { describe, expect, it } from "bun:test";

import { SSL_MODES } from "@dbee/shared";

import { checkIdentityForIp, sslConfigFor } from "./ssl";

/** Certificado mínimo: só o campo que a verificação de identidade consulta. */
const cert = (subjectaltname: string | undefined): PeerCertificate =>
  ({ subjectaltname, subject: { CN: "10.0.0.4" } }) as unknown as PeerCertificate;

describe("ssl — os três modos (ADR 003)", () => {
  it("disable não usa TLS", () => {
    expect(sslConfigFor("disable", undefined)).toBe(false);
  });

  it("require criptografa mas NÃO autentica o servidor", () => {
    // rejectUnauthorized: false é o que torna require vulnerável a MITM.
    expect(sslConfigFor("require", undefined)).toEqual({ rejectUnauthorized: false });
  });

  it("verify-full valida a cadeia", () => {
    expect(sslConfigFor("verify-full", undefined, "db.interno")).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("verify-full aceita CA próprio", () => {
    expect(sslConfigFor("verify-full", "-----BEGIN CERTIFICATE-----", "db.interno")).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----",
    });
  });

  it("só existem três modos — prefer e allow foram removidos", () => {
    expect([...SSL_MODES]).toEqual(["disable", "require", "verify-full"]);
  });
});

describe("verify-full com host IP usa verificação própria", () => {
  it("host DNS não recebe checkServerIdentity — o node já confere", () => {
    const config = sslConfigFor("verify-full", undefined, "db.interno");
    expect(config).not.toBe(false);
    expect(config === false ? undefined : config.checkServerIdentity).toBeUndefined();
  });

  it.each([["10.0.0.4"], ["100.64.1.2"], ["127.0.0.1"], ["2001:db8::1"]])(
    "host %s recebe checkServerIdentity",
    (host) => {
      const config = sslConfigFor("verify-full", undefined, host);
      expect(config === false ? undefined : typeof config.checkServerIdentity).toBe("function");
    },
  );

  it("require e disable não ganham verificação, mesmo com IP", () => {
    const r = sslConfigFor("require", undefined, "10.0.0.4");
    expect(r === false ? undefined : "checkServerIdentity" in r).toBe(false);
    expect(sslConfigFor("disable", undefined, "10.0.0.4")).toBe(false);
  });
});

describe("checkIdentityForIp", () => {
  const check = checkIdentityForIp("10.0.0.4");

  it("aceita certificado com o IP no SAN", () => {
    expect(check("qualquer", cert("IP Address:10.0.0.4, DNS:db.interno"))).toBeUndefined();
  });

  it("aceita quando há vários SANs de IP e um deles casa", () => {
    expect(check("x", cert("IP Address:10.0.0.9, IP Address:10.0.0.4"))).toBeUndefined();
  });

  it("recusa certificado sem o IP, dizendo quais SANs existem", () => {
    const erro = check("x", cert("IP Address:10.0.0.9"));
    expect(erro).toBeInstanceOf(Error);
    expect(erro?.message).toContain("não cobre o IP 10.0.0.4");
    expect(erro?.message).toContain("10.0.0.9");
  });

  it("falha fechada quando o certificado só tem SAN de DNS", () => {
    const erro = check("x", cert("DNS:db.interno"));
    expect(erro?.message).toContain("não declara nenhum SAN do tipo IP");
    // A mensagem tem que dizer o que fazer, não só "erro de TLS".
    expect(erro?.message).toContain("IP:10.0.0.4");
  });

  it("falha fechada quando não há SAN nenhum", () => {
    expect(check("x", cert(undefined))?.message).toContain("não declara nenhum SAN do tipo IP");
    expect(check("x", cert(""))?.message).toContain("não declara nenhum SAN do tipo IP");
  });

  it("NÃO cai para o CN, mesmo quando o CN é o IP certo", () => {
    // CN é obsoleto para identidade (RFC 6125). Aceitá-lo reabriria a porta
    // que o SAN fechou — o certificado só-CN é gerado por qualquer um.
    const erro = check("x", cert("DNS:outro.host"));
    expect(erro).toBeInstanceOf(Error);
  });

  it("NÃO casa por substring", () => {
    // 10.0.0.4 não pode casar 110.0.0.42 nem 10.0.0.40.
    expect(check("x", cert("IP Address:110.0.0.42"))).toBeInstanceOf(Error);
    expect(check("x", cert("IP Address:10.0.0.40"))).toBeInstanceOf(Error);
    expect(check("x", cert("IP Address:210.0.0.4"))).toBeInstanceOf(Error);
  });

  it("ignora espaçamento e caixa", () => {
    expect(check("x", cert("DNS:a,  IP Address:10.0.0.4  "))).toBeUndefined();
  });

  it("IPv6 casa em minúsculas e sem colchetes", () => {
    const v6 = checkIdentityForIp("[2001:DB8::1]");
    expect(v6("x", cert("IP Address:2001:db8::1"))).toBeUndefined();
    expect(v6("x", cert("IP Address:2001:db8::2"))).toBeInstanceOf(Error);
  });
});
