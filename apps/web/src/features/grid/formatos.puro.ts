/**
 * Copiar seleção em outros formatos (roadmap: CSV/Markdown/JSON), a partir das
 * strings do grid — o valor bruto, nunca o formatado (regra 10). NULL é
 * distinguível em todos: vazio sem aspas no CSV, `NULL` no Markdown, `null` no
 * JSON. INSERT não é gerado aqui: vem da rota do servidor (o front não monta
 * SQL por concatenação).
 */

type Linhas = readonly (readonly (string | null)[])[];

const campoCsv = (v: string | null): string =>
  v === null ? "" : /[",\r\n]/.test(v) || v === "" || v.trim() !== v ? `"${v.replace(/"/g, '""')}"` : v;

/** RFC 4180; string vazia sai como `""` para não colapsar com NULL. */
export function paraCsv(colunas: readonly string[], linhas: Linhas): string {
  return [colunas.map(campoCsv), ...linhas.map((l) => l.map(campoCsv))].map((l) => l.join(",")).join("\r\n");
}

const celulaMd = (v: string | null): string =>
  v === null ? "*NULL*" : v.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

export function paraMarkdown(colunas: readonly string[], linhas: Linhas): string {
  const cab = `| ${colunas.map(celulaMd).join(" | ")} |`;
  const sep = `| ${colunas.map(() => "---").join(" | ")} |`;
  return [cab, sep, ...linhas.map((l) => `| ${l.map(celulaMd).join(" | ")} |`)].join("\n");
}

/** Array de objetos; valores continuam strings (o driver já entregou assim). */
export function paraJson(colunas: readonly string[], linhas: Linhas): string {
  return JSON.stringify(
    linhas.map((l) => Object.fromEntries(colunas.map((c, i) => [c, l[i] ?? null]))),
    null,
    2,
  );
}

/** Itens de topo de um literal de array do Postgres, sem as aspas de proteção. */
export function itensDoArray(texto: string): (string | null)[] | null {
  const s = texto.replace(/^\[[^\]]*\]=/, "");
  if (!s.startsWith("{") || !s.endsWith("}")) return null;
  const miolo = s.slice(1, -1);
  if (miolo === "") return [];
  const out: (string | null)[] = [];
  let atual = "";
  let prof = 0;
  let aspas = false;
  let citado = false;
  for (let i = 0; i < miolo.length; i++) {
    const c = miolo[i] ?? "";
    if (aspas) {
      if (c === "\\") { atual += miolo[i + 1] ?? ""; i++; }
      else if (c === '"') aspas = false;
      else atual += c;
      continue;
    }
    if (c === '"' && prof === 0) { aspas = true; citado = true; continue; }
    if (c === "{") prof++;
    if (c === "}") prof--;
    if (c === "," && prof === 0) {
      out.push(!citado && atual === "NULL" ? null : atual);
      atual = "";
      citado = false;
      continue;
    }
    atual += c;
  }
  out.push(!citado && atual === "NULL" ? null : atual);
  return out;
}

/** Hex dump de prévia: 16 bytes por linha, até `max` bytes. */
export function hexDump(texto: string, max = 4096): string[] {
  if (!texto.startsWith("\\x")) return [];
  const hex = texto.slice(2, 2 + max * 2);
  const linhas: string[] = [];
  for (let o = 0; o < hex.length; o += 32) {
    const pedaco = hex.slice(o, o + 32);
    const bytes = pedaco.match(/../g) ?? [];
    const ascii = bytes
      .map((b) => {
        const n = parseInt(b, 16);
        return n >= 32 && n < 127 ? String.fromCharCode(n) : ".";
      })
      .join("");
    linhas.push(`${(o / 2).toString(16).padStart(6, "0")}  ${bytes.join(" ").padEnd(47)}  ${ascii}`);
  }
  return linhas;
}
