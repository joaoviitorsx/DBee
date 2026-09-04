import { randomFillSync } from "node:crypto";

// Alfabeto do nanoid: URL-safe, sem caractere ambíguo em log ou URL.
const ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const SIZE = 21;

/**
 * nanoid sem dependência: 21 chars do mesmo alfabeto, ~121 bits de entropia
 * (CLAUDE.md regra 3 — primitiva antes de pacote).
 *
 * O alfabeto tem 64 símbolos, então 6 bits por caractere saem da máscara sem
 * viés: cada byte vira exatamente um caractere.
 */
export function nanoid(): string {
  const bytes = randomFillSync(new Uint8Array(SIZE));
  let id = "";
  for (const b of bytes) id += ALPHABET.charAt(b & 63);
  return id;
}
