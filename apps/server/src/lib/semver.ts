/**
 * Comparação de versão para o aviso de atualização (DBee.md §8).
 *
 * Existe porque **comparação de string erra**: `"v0.1.10" < "v0.1.9"` é
 * verdadeiro em ordem lexicográfica, e o efeito seria o pior tipo de bug deste
 * recurso — o badge some justamente na décima release e ninguém percebe que
 * parou de avisar. Compara número a número.
 *
 * Não é um semver completo e não pretende ser: o que entra aqui são tags do
 * próprio repo (`vX.Y.Z`) e o `dev` do ambiente local. Sem faixas, sem `^`, sem
 * ordenação de metadado de build.
 */

interface Versao {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** `null` = release final. Release final é **maior** que qualquer pré. */
  readonly pre: string | null;
}

/** Marca o binário fora de container. Nunca compara — ver `haNovaVersao`. */
export const VERSAO_DEV = "dev";

const FORMATO = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** `null` para qualquer coisa que não seja `vX.Y.Z` — inclusive `dev`. */
export function parseVersao(bruta: string): Versao | null {
  const m = FORMATO.exec(bruta.trim());
  if (m === null) return null;

  const [, major, minor, patch, pre] = m;
  if (major === undefined || minor === undefined || patch === undefined) return null;

  // Tag absurda (`v99999999999999999999.0.0`) não pode virar Infinity e ganhar
  // toda comparação: fora da faixa segura, trata como ilegível.
  const nMajor = Number(major);
  const nMinor = Number(minor);
  const nPatch = Number(patch);
  if (![nMajor, nMinor, nPatch].every(Number.isSafeInteger)) return null;

  return { major: nMajor, minor: nMinor, patch: nPatch, pre: pre ?? null };
}

/** Ordena os identificadores de pré-release conforme a regra do semver. */
function compararPre(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i];
    const y = pb[i];
    // Menos identificadores = menor precedência, quando o prefixo é igual.
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;

    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    // Numérico sempre tem precedência menor que alfanumérico.
    if (nx && ny) return Number(x) - Number(y);
    if (nx) return -1;
    if (ny) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Negativo se `a < b`, zero se iguais, positivo se `a > b`. */
export function compararVersoes(a: Versao, b: Versao): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.pre === b.pre) return 0;
  // 1.0.0 > 1.0.0-rc.1: a ausência de pré-release é a versão final.
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return compararPre(a.pre, b.pre);
}

/**
 * Só é "nova versão" se `latest` for **estritamente maior** que `current`.
 *
 * Devolve `false` no que não dá para provar: versão ilegível dos dois lados,
 * `dev`, `latest` ausente. Rollback deliberado (rodar a v0.1.2 com a v0.1.3
 * publicada) também não acende o badge — a UI ficaria pedindo para desfazer uma
 * decisão que alguém tomou de propósito.
 */
export function haNovaVersao(current: string, latest: string | null): boolean {
  if (latest === null) return false;
  const atual = parseVersao(current);
  const nova = parseVersao(latest);
  if (atual === null || nova === null) return false;
  return compararVersoes(nova, atual) > 0;
}
