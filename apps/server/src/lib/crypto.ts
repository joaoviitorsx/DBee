import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/**
 * Cifra das senhas de conexão — AES-256-GCM com chave derivada de `APP_SECRET`
 * via scrypt (DBee.md §7).
 *
 * Parâmetros do scrypt: N = 2^17, r = 8, p = 1. O `maxmem` default do
 * `node:crypto` é 32 MB e estoura com esse N — a conta é 128 * N * r =
 * 128 MB —, então precisa ser passado explicitamente.
 *
 * **A derivação custa ~700 ms** (medido, Bun 1.3.14). Ela acontece UMA vez, no
 * boot, e a chave fica em memória: derivar por operação faria listar 8 conexões
 * gastar segundos de CPU à toa.
 */
const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

const KEY_BYTES = 32; // AES-256
const SALT_BYTES = 32;
const IV_BYTES = 12; // recomendado para GCM
const TAG_BYTES = 16;

/** Prefixo de versão: permite trocar o esquema depois sem adivinhar formato. */
const FORMAT = "v1";

/** Chave derivada. Opaca de propósito — nada fora daqui lê os bytes. */
export interface EncryptionKey {
  readonly __brand: "EncryptionKey";
  readonly bytes: Buffer;
}

export function newSalt(): Buffer {
  return randomBytes(SALT_BYTES);
}

/** Chamar UMA vez no boot. ~700 ms. */
export function deriveKey(appSecret: string, salt: Buffer): EncryptionKey {
  if (salt.length !== SALT_BYTES) {
    throw new Error(`salt deve ter ${SALT_BYTES} bytes, veio com ${salt.length}`);
  }
  const bytes = scryptSync(appSecret, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return { __brand: "EncryptionKey", bytes };
}

/**
 * `v1.<iv>.<tag>.<ciphertext>`, tudo base64url. IV aleatório por registro —
 * reusar IV em GCM quebra a cifra, não só a integridade.
 */
export function encrypt(key: EncryptionKey, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key.bytes, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Lança se o registro foi cifrado com outra chave — o caso de `APP_SECRET`
 * trocado (DBee.md §11.5). A mensagem não vaza nada do conteúdo.
 */
export function decrypt(key: EncryptionKey, payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4) throw new Error("payload cifrado malformado");

  const [version, ivB64, tagB64, dataB64] = parts;
  if (version !== FORMAT) throw new Error(`formato de cifra desconhecido: ${String(version)}`);
  if (ivB64 === undefined || tagB64 === undefined || dataB64 === undefined) {
    throw new Error("payload cifrado malformado");
  }

  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("payload cifrado malformado");
  }

  const decipher = createDecipheriv("aes-256-gcm", key.bytes, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // GCM falhou a autenticação: chave errada ou registro adulterado. Não
    // repassar o erro original, que varia conforme o motivo.
    throw new Error(
      "não foi possível decifrar a senha da conexão — APP_SECRET pode ter mudado (ver DBee.md §11.5)",
    );
  }
}

/** Comparação de salt em tempo constante, para uso em teste e verificação. */
export function sameSalt(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
