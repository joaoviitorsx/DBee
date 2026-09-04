import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "bun:test";

import {
  decrypt,
  decryptLegacyV1,
  deriveKey,
  encrypt,
  isLegacyV1,
  newSalt,
  sameSalt,
} from "./crypto";

// scrypt N=2^17 custa ~700 ms. Deriva uma vez e reusa — é exatamente a razão
// pela qual o app deriva no boot e guarda em memória.
const salt = newSalt();
const key = deriveKey("segredo-de-teste", salt);

const ID = "conexao-alvo-000000001";
const OUTRO_ID = "conexao-outra-00000002";

/** Cifra no formato antigo, sem AAD — para exercitar o caminho de migração. */
function encryptV1(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.bytes, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

describe("crypto", () => {
  it("faz round-trip da senha", () => {
    const secret = "s3nh4 com espaço, acento çãó e emoji 🐝";
    expect(decrypt(key, ID, encrypt(key, ID, secret))).toBe(secret);
  });

  it("gera IV diferente a cada chamada", () => {
    // Reusar IV em GCM quebra a cifra, não só a integridade.
    const a = encrypt(key, ID, "mesma senha");
    const b = encrypt(key, ID, "mesma senha");
    expect(a).not.toBe(b);
    expect(decrypt(key, ID, a)).toBe(decrypt(key, ID, b));
  });

  it("não deixa a senha em claro no payload", () => {
    expect(encrypt(key, ID, "senha-super-secreta")).not.toContain("senha-super-secreta");
  });

  it("recusa payload cifrado com outra chave (APP_SECRET trocado)", () => {
    const outra = deriveKey("outro-segredo", salt);
    expect(() => decrypt(outra, ID, encrypt(key, ID, "x"))).toThrow(/APP_SECRET pode ter mudado/);
  });

  it("recusa payload adulterado", () => {
    const parts = encrypt(key, ID, "x").split(".");
    const ct = parts[3] ?? "";
    parts[3] = ct.startsWith("A") ? `B${ct.slice(1)}` : `A${ct.slice(1)}`;
    expect(() => decrypt(key, ID, parts.join("."))).toThrow();
  });

  it("recusa payload malformado", () => {
    expect(() => decrypt(key, ID, "lixo")).toThrow(/malformado/);
    expect(() => decrypt(key, ID, "v9.a.b.c")).toThrow(/malformado/);
  });

  it("salt tem 32 bytes e é diferente a cada instalação", () => {
    const a = newSalt();
    const b = newSalt();
    expect(a.length).toBe(32);
    expect(sameSalt(a, b)).toBe(false);
    expect(sameSalt(a, Buffer.from(a))).toBe(true);
  });
});

describe("AAD amarra o registro à conexão (ADR 005)", () => {
  it("um password_enc movido para outra conexão NÃO decifra", () => {
    // Sem AAD, trocar o password_enc entre duas conexões era indetectável: a
    // senha de produção passava a ser enviada ao host de homologação.
    const payload = encrypt(key, ID, "senha-de-producao");
    expect(decrypt(key, ID, payload)).toBe("senha-de-producao");
    expect(() => decrypt(key, OUTRO_ID, payload)).toThrow(/APP_SECRET pode ter mudado/);
  });

  it("a troca falha nos dois sentidos", () => {
    const producao = encrypt(key, ID, "senha-prod");
    const homolog = encrypt(key, OUTRO_ID, "senha-hml");
    expect(() => decrypt(key, OUTRO_ID, producao)).toThrow();
    expect(() => decrypt(key, ID, homolog)).toThrow();
  });

  it("id vazio ainda é um AAD distinto de qualquer outro", () => {
    const payload = encrypt(key, "", "x");
    expect(decrypt(key, "", payload)).toBe("x");
    expect(() => decrypt(key, "a", payload)).toThrow();
  });
});

describe("formato legado v1", () => {
  it("isLegacyV1 distingue os formatos", () => {
    expect(isLegacyV1(encryptV1("x"))).toBe(true);
    expect(isLegacyV1(encrypt(key, ID, "x"))).toBe(false);
  });

  it("decryptLegacyV1 lê o formato antigo, sem AAD", () => {
    expect(decryptLegacyV1(key, encryptV1("senha-antiga"))).toBe("senha-antiga");
  });

  it("decrypt RECUSA v1 — o caminho legado não fica aberto para sempre", () => {
    // Se v1 continuasse legível no caminho de requisição, a troca de registro
    // entre conexões continuaria possível: bastaria manter o formato antigo.
    expect(() => decrypt(key, ID, encryptV1("x"))).toThrow(/formato v1 encontrado/);
  });

  it("decryptLegacyV1 recusa um payload v2", () => {
    expect(() => decryptLegacyV1(key, encrypt(key, ID, "x"))).toThrow(/esperado v1/);
  });

  it("encrypt sempre grava v2", () => {
    expect(encrypt(key, ID, "x").startsWith("v2.")).toBe(true);
  });
});
