/**
 * Que visualizador uma célula ganha (ui-detalhes §6). Puro: decide por tipo
 * da coluna e, só para `text`, pelo próprio valor da célula focada.
 */

export type TipoVisual = "json" | "array" | "bytea" | "xml" | "texto";

const base = (tipo: string): string => tipo.replace(/\(.*/, "").trim().toLowerCase();

export function tipoVisual(tipo: string, valor: string): TipoVisual {
  const b = base(tipo);
  if (b === "json" || b === "jsonb") return "json";
  if (b.endsWith("[]") || b.startsWith("_")) return "array";
  if (b === "bytea" && valor.startsWith("\\x")) return "bytea";
  if (b === "xml") return "xml";
  // Texto que "parece JSON" ganha a árvore se parsear (só a célula aberta).
  const t = valor.trimStart();
  if ((t.startsWith("{") || t.startsWith("[")) && t.length <= 5 * 1024 * 1024) {
    try {
      JSON.parse(valor);
      return "json";
    } catch {
      return "texto";
    }
  }
  return "texto";
}

/**
 * A célula merece o ícone de abrir? Tipos estruturados sempre; texto só quando
 * tem quebra de linha ou passa de 60 caracteres (o que a coluna truncaria).
 */
export function temVisualizador(tipo: string, valor: string): boolean {
  const b = base(tipo);
  if (b === "json" || b === "jsonb" || b === "xml" || b === "bytea") return true;
  if (b.endsWith("[]") || b.startsWith("_")) return true;
  return valor.length > 60 || valor.includes("\n");
}

/** Indentação simples de XML para leitura (não valida, não reescreve conteúdo). */
export function formatarXml(xml: string): string {
  const pedacos = xml.replace(/>\s*</g, ">\n<").split("\n");
  let nivel = 0;
  return pedacos
    .map((p) => {
      const fecha = p.startsWith("</");
      const abreEFecha = /^<[^!?/][^>]*>.*<\/[^>]+>$/.test(p) || p.endsWith("/>") || /^<[!?]/.test(p);
      if (fecha) nivel = Math.max(0, nivel - 1);
      const linha = `${"  ".repeat(nivel)}${p}`;
      if (!fecha && !abreEFecha && /^<[^!?]/.test(p)) nivel++;
      return linha;
    })
    .join("\n");
}
