/**
 * Aviso de "escrita confirmada" para a marca do cabeçalho zumbir
 * (identidade.md, direção A; design-system §7).
 *
 * Evento de janela, e não contexto React: quem confirma a escrita mora em
 * modais e abas de features diferentes, e a marca está no cabeçalho. Um evento
 * evita que cada feature importe o shell. Só a marca escuta.
 */
export const EVENTO_ZUMBIDO = "dbee:escrita-confirmada";

/** Chame no `onSuccess` de uma escrita que de fato gravou. */
export function zumbir(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENTO_ZUMBIDO));
}
