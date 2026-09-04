import { Database } from "bun:sqlite";
import { createCipheriv, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "bun:test";

import { decrypt, deriveKey, encrypt, isLegacyV1, newSalt, type EncryptionKey } from "../lib/crypto";
import { migrate } from "./migrate";
import { recipherToV2 } from "./recipher";

let key: EncryptionKey;

beforeAll(() => {
  key = deriveKey("segredo-de-teste", newSalt());
});

function encryptV1(k: EncryptionKey, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k.bytes, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

function bancoCom(registros: readonly { id: string; enc: string }[]): Database {
  const db = new Database(":memory:");
  migrate(db);
  for (const r of registros) {
    db.query<unknown, [string, string, string]>(
      `INSERT INTO connections (id, name, host, port, database, username, password_enc,
         created_at, updated_at)
       VALUES (?, ?, 'h', 5432, 'd', 'u', ?, '', '')`,
    ).run(r.id, `nome-${r.id}`, r.enc);
  }
  return db;
}

const encOf = (db: Database, id: string): string =>
  (db.query<{ password_enc: string }, [string]>("SELECT password_enc FROM connections WHERE id = ?").get(id) ?? { password_enc: "" }).password_enc;

describe("migração de cifra v1 → v2 (ADR 005)", () => {
  it("converte os v1 e devolve quantos", () => {
    const db = bancoCom([
      { id: "a", enc: encryptV1(key, "senha-a") },
      { id: "b", enc: encryptV1(key, "senha-b") },
    ]);

    expect(recipherToV2(db, key)).toBe(2);
    expect(isLegacyV1(encOf(db, "a"))).toBe(false);
    // A senha sobrevive à conversão, e agora está amarrada ao id.
    expect(decrypt(key, "a", encOf(db, "a"))).toBe("senha-a");
    expect(decrypt(key, "b", encOf(db, "b"))).toBe("senha-b");
  });

  it("o registro convertido já recusa ser lido como de outra conexão", () => {
    const db = bancoCom([{ id: "a", enc: encryptV1(key, "senha-a") }]);
    recipherToV2(db, key);
    expect(() => decrypt(key, "b", encOf(db, "a"))).toThrow();
  });

  it("é idempotente: a segunda passada não converte nada", () => {
    const db = bancoCom([{ id: "a", enc: encryptV1(key, "x") }]);
    expect(recipherToV2(db, key)).toBe(1);
    expect(recipherToV2(db, key)).toBe(0);
    expect(recipherToV2(db, key)).toBe(0);
  });

  it("banco só com v2 não é tocado", () => {
    const db = bancoCom([{ id: "a", enc: encrypt(key, "a", "x") }]);
    const antes = encOf(db, "a");
    expect(recipherToV2(db, key)).toBe(0);
    expect(encOf(db, "a")).toBe(antes);
  });

  it("banco vazio devolve 0", () => {
    expect(recipherToV2(bancoCom([]), key)).toBe(0);
  });

  it("mistura de v1 e v2 converte só os v1", () => {
    const db = bancoCom([
      { id: "velha", enc: encryptV1(key, "antiga") },
      { id: "nova", enc: encrypt(key, "nova", "recente") },
    ]);
    expect(recipherToV2(db, key)).toBe(1);
    expect(decrypt(key, "velha", encOf(db, "velha"))).toBe("antiga");
    expect(decrypt(key, "nova", encOf(db, "nova"))).toBe("recente");
  });

  it("chave errada reverte TUDO — nada fica meio migrado", () => {
    const db = bancoCom([
      { id: "a", enc: encryptV1(key, "senha-a") },
      { id: "b", enc: "v1.aaaa.bbbb.cccc" }, // ilegível
    ]);
    const antesA = encOf(db, "a");

    expect(() => recipherToV2(db, key)).toThrow();

    // Estado parcial deixaria conexões ilegíveis se o processo morresse aqui.
    expect(encOf(db, "a")).toBe(antesA);
    expect(isLegacyV1(encOf(db, "a"))).toBe(true);
  });
});
