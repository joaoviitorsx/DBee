import { describe, expect, it } from "bun:test";

import { SSL_MODES } from "@dbee/shared";

import { sslConfigFor } from "./ssl";

describe("ssl (ADR 003)", () => {
  it("disable não usa TLS", () => {
    expect(sslConfigFor("disable", undefined)).toBe(false);
  });

  it("require criptografa mas NÃO autentica o servidor", () => {
    // rejectUnauthorized: false é o que torna require vulnerável a MITM.
    expect(sslConfigFor("require", undefined)).toEqual({ rejectUnauthorized: false });
  });

  it("verify-full valida a cadeia", () => {
    expect(sslConfigFor("verify-full", undefined)).toEqual({ rejectUnauthorized: true });
  });

  it("verify-full aceita CA próprio", () => {
    expect(sslConfigFor("verify-full", "-----BEGIN CERTIFICATE-----")).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----",
    });
  });

  it("só existem três modos — prefer e allow foram removidos", () => {
    expect([...SSL_MODES]).toEqual(["disable", "require", "verify-full"]);
  });
});
