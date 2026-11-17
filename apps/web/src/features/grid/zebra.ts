/**
 * Linha zebrada: preferência por pessoa, no navegador, desligada por padrão
 * (decisão do autor, ui-detalhes §4 #14). Leitura e escrita em try/catch —
 * janela privada ou armazenamento bloqueado caem no padrão.
 */
const CHAVE = "dbee:zebra";

export function lerZebra(): boolean {
  try {
    return localStorage.getItem(CHAVE) === "1";
  } catch {
    return false;
  }
}

export function gravarZebra(ligada: boolean): void {
  try {
    localStorage.setItem(CHAVE, ligada ? "1" : "0");
  } catch {
    // sem armazenamento: a preferência vale só nesta sessão
  }
}
