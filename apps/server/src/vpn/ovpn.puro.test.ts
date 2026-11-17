import { describe, expect, test } from "bun:test";

import { validarOvpn } from "./ovpn.puro";

const BASE = `client
dev tun
remote 192.0.2.10 1194 udp4
auth-user-pass
<ca>
-----BEGIN CERTIFICATE-----
abc
-----END CERTIFICATE-----
</ca>
key-direction 1
`;

describe("validarOvpn", () => {
  test("config típica do pfSense passa", () => {
    expect(validarOvpn(BASE)).toBeNull();
  });

  test.each(["up /tmp/x.sh", "script-security 2", "plugin /lib/x.so", "management 0.0.0.0 1",
    "log /etc/passwd", "cd /", "config /x", "route-up /x", "setenv FOO 1", "daemon", "status /x"])(
    "recusa %s", (linha) => {
      expect(validarOvpn(`${BASE}${linha}\n`)?.tipo).toBe("diretiva");
    });

  test("recusa auth-user-pass com arquivo", () => {
    expect(validarOvpn(BASE.replace("auth-user-pass", "auth-user-pass /etc/shadow"))?.tipo).toBe("diretiva");
  });

  test("recusa bloco inline que não é cripto", () => {
    expect(validarOvpn(`${BASE}<connection>\nremote x\n</connection>\n`)?.tipo).toBe("bloco");
  });

  test("diretiva dentro de bloco cripto não conta", () => {
    expect(validarOvpn(`${BASE}<key>\nup /x\n</key>\n`)).toBeNull();
  });

  test("bloco sem fechar, sem remote e vazio", () => {
    expect(validarOvpn(`${BASE}<key>\nabc\n`)?.tipo).toBe("bloco");
    expect(validarOvpn("client\n")?.tipo).toBe("sem_remote");
    expect(validarOvpn("  ")?.tipo).toBe("vazio");
  });

  test("forma --diretiva também é checada", () => {
    expect(validarOvpn(`${BASE}--up /x\n`)?.tipo).toBe("diretiva");
  });

  test("contorno da revisão: NBSP + fechamento por prefixo não contrabandeia plugin", () => {
    const poc = [
      "client", "dev tun", "remote 127.0.0.1 1194",
      "ignore-unknown-option \u00a0</ca>",
      "<ca>", "</ca>x",
      'plugin /usr/lib/openvpn/plugins/openvpn-plugin-down-root.so "/bin/touch /tmp/pwned"',
      "log-append /tmp/arbitrario",
      "\u00a0</ca>",
    ].join("\n");
    expect(validarOvpn(poc)).not.toBeNull();
  });

  test("fechamento com lixo depois da tag é recusado", () => {
    expect(validarOvpn(`${BASE}<key>\nabc\n</key>x\nup /x\n`)?.tipo).toBe("bloco");
  });

  test("fora de ASCII imprimível ou linha longa é recusado", () => {
    expect(validarOvpn(`${BASE}verb\u00a03\n`)?.tipo).toBe("caractere");
    expect(validarOvpn(`${BASE}# ${"x".repeat(300)}\n`)?.tipo).toBe("caractere");
  });

  test("ignore-unknown-option e setenv-safe não são permitidos", () => {
    expect(validarOvpn(`${BASE}ignore-unknown-option foo\n`)?.tipo).toBe("diretiva");
    expect(validarOvpn(`${BASE}setenv-safe X 1\n`)?.tipo).toBe("diretiva");
  });

  test("CRLF continua aceito", () => {
    expect(validarOvpn(BASE.replace(/\n/g, "\r\n"))).toBeNull();
  });
});
