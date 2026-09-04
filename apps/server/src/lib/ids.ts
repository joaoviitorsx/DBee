import { randomFillSync } from "node:crypto";

/**
 * Alfabeto do nanoid: URL-safe, sem caractere ambíguo em log ou URL.
 * São **64 símbolos**, e esse número não é casual — ver `nanoid()` abaixo.
 */
const ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const SIZE = 21;

/**
 * nanoid sem dependência (CLAUDE.md regra 3 — primitiva antes de pacote).
 * 21 caracteres, ~125 bits de entropia.
 *
 * ## Por que `b & 63` não enviesa
 *
 * O alfabeto tem exatamente 64 símbolos, e 64 é potência de 2. Um byte tem 256
 * valores; `b & 63` mapeia esses 256 valores em 64 símbolos, **quatro valores
 * para cada um**, sem sobra. Distribuição uniforme, sem precisar rejeitar byte
 * nenhum.
 *
 * ## Não "otimize" para 62
 *
 * É tentador cortar o alfabeto para 62 (alfanumérico puro, sem `-` e `_`).
 * **Isso quebra a uniformidade:** 256 não é divisível por 62, então
 * `b % 62` daria aos 8 primeiros símbolos uma chance de 5/256 e aos outros 54
 * uma chance de 4/256 — 25% a mais para uma parte do alfabeto. O viés não
 * aparece em teste casual e reduz a entropia real.
 *
 * Se o alfabeto precisar mudar de tamanho, ou ele continua sendo potência de 2,
 * ou este código passa a precisar de rejeição de bytes fora do maior múltiplo
 * de N abaixo de 256. Não existe terceira opção correta.
 */
export function nanoid(): string {
  const bytes = randomFillSync(new Uint8Array(SIZE));
  let id = "";
  for (const b of bytes) id += ALPHABET.charAt(b & 63);
  return id;
}

/** Exportado só para o teste conferir a premissa da potência de 2. */
export const ID_ALPHABET = ALPHABET;
export const ID_SIZE = SIZE;
