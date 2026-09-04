#!/usr/bin/env bun
/**
 * Falha se algum arquivo fonte tiver byte de controle fora de tab e newline.
 *
 * Motivo concreto: uma edição trocou o espaço separador de uma chave de mapa em
 * `pg/pool.ts` por um byte NUL. O NUL é invisível no terminal e no editor, e o
 * efeito no ferramental foi pior que o bug:
 *
 *   grep -rn "BEGIN READ ONLY" apps/     → o arquivo era pulado em silêncio
 *   git grep -n "BEGIN READ ONLY"        → "Binary file ... matches", sem linha
 *   git diff pool.ts                     → "Binary files differ", sem diff
 *
 * Ou seja: o único arquivo que abre a transação read-only saiu do alcance de
 * busca e de revisão, sem que nada acusasse. O ADR 001 institui como controle
 * "revisão de PR que veja essa string deve barrar" — controle que nunca veria
 * aquele arquivo.
 *
 * Um arquivo pode sair do alcance de grep e de diff sem que nada acuse. Isto
 * acusa.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname;

const EXTENSOES = [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".css", ".html", ".sql", ".yml", ".yaml"];
/** Nomes de diretório ignorados em qualquer profundidade. */
const IGNORAR_DIR = new Set(["node_modules", ".git", "dist", "coverage", "png"]);

/** Tab (0x09), LF (0x0A) e CR (0x0D) são os únicos controles aceitos. */
const PERMITIDOS = new Set([0x09, 0x0a, 0x0d]);

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (IGNORAR_DIR.has(nome)) return [];
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return EXTENSOES.some((e) => nome.endsWith(e)) ? [caminho] : [];
  });
}

interface Achado {
  readonly arquivo: string;
  readonly linha: number;
  readonly byte: string;
}

const achados: Achado[] = [];

for (const caminho of arquivos(RAIZ)) {
  const bytes = readFileSync(caminho);
  let linha = 1;
  for (const byte of bytes) {
    if (byte === 0x0a) { linha++; continue; }
    if (byte >= 0x20 || PERMITIDOS.has(byte)) continue;
    achados.push({
      arquivo: relative(RAIZ, caminho),
      linha,
      byte: `0x${byte.toString(16).padStart(2, "0")}`,
    });
  }
}

if (achados.length === 0) {
  console.log(`ok — ${arquivos(RAIZ).length} arquivos, nenhum byte de controle inesperado`);
  process.exit(0);
}

console.error("byte de controle encontrado em arquivo fonte:\n");
for (const a of achados.slice(0, 50)) {
  console.error(`  ${a.arquivo}:${a.linha}  ${a.byte}`);
}
if (achados.length > 50) console.error(`  ... e mais ${achados.length - 50}`);
console.error(
  "\nBytes de controle deixam o arquivo invisível para grep e fazem o git tratá-lo\n" +
    "como binário — sem diff em revisão. Substitua por um escape (\\u0000) ou remova.",
);
process.exit(1);
