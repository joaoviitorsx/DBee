/**
 * A dica do gesto de arrastar a grade — vista uma vez, nunca mais.
 *
 * ## Por que persiste, e por que some sozinha
 *
 * Arrastar a tabela não tem affordance: não há alça, não há cursor diferente
 * antes do gesto começar, e a barra de rolagem horizontal continua ali dizendo
 * que o jeito de navegar é ela. Um gesto que ninguém descobre é um gesto que
 * não existe — daí a dica.
 *
 * Mas dica que fica é ruído, e ruído permanente numa ferramenta de uso diário
 * é pior que a ausência dela: some assim que o conteúdo anda na horizontal,
 * por arrasto **ou** por qualquer outro meio. Quem já sabe navegar não precisa
 * ser ensinado, e a barra de rolagem prova isso tão bem quanto o arrasto.
 *
 * Espelha `lib/theme.ts` no tratamento do `localStorage`: aba anônima ou
 * cookies bloqueados não podem quebrar a grade.
 */

const CHAVE = "dbee:dica-arrasto";

export function dicaVista(): boolean {
  try {
    return localStorage.getItem(CHAVE) === "1";
  } catch {
    // Sem persistência, mostra. Errar para o lado de ensinar custa uma linha
    // de texto que some no primeiro gesto; errar para o outro esconde a única
    // pista que o gesto tem.
    return false;
  }
}

export function marcarDicaVista(): void {
  try {
    localStorage.setItem(CHAVE, "1");
  } catch {
    /* sem persistência: a dica volta na próxima sessão desta aba */
  }
}
