/**
 * Filtro da lista de abas (I6). Casa por título, conexão ou tipo, sem caixa
 * nem acento — "Consulta" acha "consulta 3", "producao" acha "Produção".
 */
const normal = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function filtrarAbas<T extends { readonly titulo: string; readonly conexao: string; readonly tipo: string }>(
  linhas: readonly T[],
  texto: string,
): T[] {
  const q = normal(texto.trim());
  if (q === "") return [...linhas];
  return linhas.filter((l) => normal(`${l.titulo} ${l.conexao} ${l.tipo}`).includes(q));
}
