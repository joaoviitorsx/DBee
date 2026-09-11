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

  /*
   * O bypass que o red-team achou. `[::ffff:169.254.169.254]` é o metadado por
   * outra escrita: o `URL` normaliza para `[::ffff:a9fe:a9fe]`, que não começa
   * com `169.254.`, e o `fetch` do Bun roteia o mapeado para o IPv4 real. Aqui
   * as duas escritas — a que sai do `URL` (`hostname`, sem colchete) e a crua
   * com colchete — têm que ser barradas.
   */
  it("o IPv4-mapeado é o mesmo endereço e é barrado (achado do red-team)", () => {
    for (const h of [
      "::ffff:a9fe:a9fe",
      "[::ffff:a9fe:a9fe]",
      "::ffff:169.254.169.254",
      "[::ffff:169.254.169.254]",
    ]) {
      expect(`${h}: ${String(ehLinkLocal(h))}`).toBe(`${h}: true`);
    }
    // E pela porta de entrada real: o que o `URL` produz do texto que o
    // atacante digita.
    expect(ehMetadadoDeNuvem(new URL("http://[::ffff:169.254.169.254]/").hostname)).toBe(true);
  });

  /*
   * O mapeado de um endereço NÃO-metadado continua liberado — o desembrulho não
   * pode virar um bloqueio cego de todo `::ffff:`. `127.0.0.1` mapeado é
   * localhost, e faixa privada mapeada é faixa privada.
   */
  it("o mapeado de um endereço comum não é barrado por engano", () => {
    expect(ehLinkLocal("::ffff:7f00:1")).toBe(false);
    expect(ehLinkLocal("::ffff:127.0.0.1")).toBe(false);
    expect(ehLinkLocal("::ffff:0a00:0005")).toBe(false);
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
   * Ponta a ponta pelo caminho que a conexão libSQL usa: as escritas
   * alternativas do metadado têm que estourar antes de chegar ao `fetch`.
   */
  it("recusa o metadado em IPv6 mapeado, octal, hex e decimal", () => {
    for (const u of [
      "http://[::ffff:169.254.169.254]:8080/",
      "http://[0:0:0:0:0:ffff:169.254.169.254]/",
      "http://0xa9fea9fe/",
      "http://2852039166/",
      "http://0251.0376.0251.0376/",
    ]) {
      expect(() => alvoValidado(u), u).toThrow("serviço de metadado");
    }
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
