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
 *
 * ## Formatos
 *
 * - `v2.<iv>.<tag>.<ct>` — **atual**. Usa o id da conexão como AAD.
 * - `v1.<iv>.<tag>.<ct>` — legado, sem AAD. Só o migrador lê, e só uma vez.
 *
 * ### Por que o AAD
 *
 * Sem AAD o tag GCM autentica apenas o ciphertext. Quem tivesse escrita no
 * `dbee.sqlite` poderia **trocar o `password_enc` entre duas conexões** e a
 * troca seria indetectável: a senha do banco de produção passaria a ser enviada
 * ao host de homologação — ou o inverso, que é pior. Amarrar o registro ao id
 * faz essa troca falhar na decifragem.
 */
const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

const KEY_BYTES = 32; // AES-256
const SALT_BYTES = 32;
const IV_BYTES = 12; // recomendado para GCM
const TAG_BYTES = 16;

const FORMAT_V1 = "v1";
const FORMAT_V2 = "v2";

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

/** O AAD amarra o registro à conexão a que ele pertence. */
const aadFor = (connectionId: string): Buffer =>
  Buffer.from(`${FORMAT_V2}:${connectionId}`, "utf8");

interface Parts {
  readonly version: string;
  readonly iv: Buffer;
  readonly tag: Buffer;
  readonly data: Buffer;
}

function split(payload: string): Parts {
  const parts = payload.split(".");
  if (parts.length !== 4) throw new Error("payload cifrado malformado");

  const [version, ivB64, tagB64, dataB64] = parts;
  if (version === undefined || ivB64 === undefined || tagB64 === undefined || dataB64 === undefined) {
    throw new Error("payload cifrado malformado");
  }

  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  // Sem estas checagens o node:crypto aceita tag truncada, e a forja fica
  // viável.
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("payload cifrado malformado");
  }

  return { version, iv, tag, data: Buffer.from(dataB64, "base64url") };
}

/** Verdadeiro para um payload no formato legado, sem AAD. */
export function isLegacyV1(payload: string): boolean {
  return payload.startsWith(`${FORMAT_V1}.`);
}

/**
 * `v2.<iv>.<tag>.<ct>`, tudo base64url. IV aleatório por registro — reusar IV
 * em GCM quebra a cifra, não só a integridade.
 */
export function encrypt(key: EncryptionKey, connectionId: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key.bytes, iv);
  cipher.setAAD(aadFor(connectionId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT_V2,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

const NAO_DECIFRA =
  "não foi possível decifrar a senha da conexão — APP_SECRET pode ter mudado (ver DBee.md §11.5)";

function open(key: EncryptionKey, parts: Parts, aad: Buffer | null): string {
  const decipher = createDecipheriv("aes-256-gcm", key.bytes, parts.iv);
  if (aad !== null) decipher.setAAD(aad);
  decipher.setAuthTag(parts.tag);
  try {
    return Buffer.concat([decipher.update(parts.data), decipher.final()]).toString("utf8");
  } catch {
    // GCM falhou a autenticação: chave errada, AAD errado ou registro
    // adulterado. Não repassar o erro original, que varia conforme o motivo.
    throw new Error(NAO_DECIFRA);
  }
}

/**
 * Decifra um registro `v2`, exigindo que ele pertença a esta conexão.
 *
 * **Recusa `v1`.** O caminho legado existe só em `decryptLegacyV1`, usado uma
 * única vez pelo migrador do boot: deixar o formato antigo legível para sempre
 * manteria aberta a troca de registro entre conexões que o AAD veio fechar.
 */
export function decrypt(key: EncryptionKey, connectionId: string, payload: string): string {
  const parts = split(payload);

  if (parts.version === FORMAT_V1) {
    throw new Error(
      "registro cifrado no formato v1 encontrado depois da migração — " +
        "isso indica escrita externa no banco (ver ADR 005)",
    );
  }
  if (parts.version !== FORMAT_V2) {
    throw new Error(`formato de cifra desconhecido: ${parts.version}`);
  }

  return open(key, parts, aadFor(connectionId));
}

/**
 * Decifra um registro `v1` — sem AAD.
 *
 * **Só o migrador do boot chama isto.** Não use em caminho de requisição.
 */
export function decryptLegacyV1(key: EncryptionKey, payload: string): string {
  const parts = split(payload);
  if (parts.version !== FORMAT_V1) {
    throw new Error(`esperado v1, veio ${parts.version}`);
  }
  return open(key, parts, null);
}

/** Comparação de salt em tempo constante, para uso em teste e verificação. */
export function sameSalt(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
