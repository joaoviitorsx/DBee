import { describe, expect, it } from "bun:test";

import { decrypt, deriveKey, encrypt, newSalt, sameSalt } from "./crypto";

// scrypt N=2^17 custa ~700 ms. Deriva uma vez e reusa — é exatamente a razão
// pela qual o app deriva no boot e guarda em memória.
const salt = newSalt();
const key = deriveKey("segredo-de-teste", salt);

describe("crypto", () => {
  it("faz round-trip da senha", () => {
    const secret = "s3nh4 com espaço, acento çãó e emoji 🐝";
    expect(decrypt(key, encrypt(key, secret))).toBe(secret);
  });

  it("gera IV diferente a cada chamada", () => {
    // Reusar IV em GCM quebra a cifra, não só a integridade.
    const a = encrypt(key, "mesma senha");
    const b = encrypt(key, "mesma senha");
    expect(a).not.toBe(b);
    expect(decrypt(key, a)).toBe(decrypt(key, b));
  });

  it("não deixa a senha em claro no payload", () => {
    const payload = encrypt(key, "senha-super-secreta");
    expect(payload).not.toContain("senha-super-secreta");
  });

  it("recusa payload cifrado com outra chave (APP_SECRET trocado)", () => {
    const outra = deriveKey("outro-segredo", salt);
    expect(() => decrypt(outra, encrypt(key, "x"))).toThrow(/APP_SECRET pode ter mudado/);
  });

  it("recusa payload adulterado", () => {
    const payload = encrypt(key, "x");
    const parts = payload.split(".");
    const ct = parts[3] ?? "";
    parts[3] = ct.startsWith("A") ? `B${ct.slice(1)}` : `A${ct.slice(1)}`;
    expect(() => decrypt(key, parts.join("."))).toThrow();
  });

  it("recusa payload malformado", () => {
    expect(() => decrypt(key, "lixo")).toThrow(/malformado/);
    expect(() => decrypt(key, "v9.a.b.c")).toThrow(/formato de cifra desconhecido/);
  });

  it("salt tem 32 bytes e é diferente a cada instalação", () => {
    const a = newSalt();
    const b = newSalt();
    expect(a.length).toBe(32);
    expect(sameSalt(a, b)).toBe(false);
    expect(sameSalt(a, Buffer.from(a))).toBe(true);
  });
});
