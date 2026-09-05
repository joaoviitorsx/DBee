/**
 * Tema claro/escuro.
 *
 * **Dois estados, não três.** Havia um "seguir o sistema" e ele saiu: um botão
 * que cicla por três estados obriga a pessoa a passar pelo que ela não quer
 * para chegar no que quer, e "sistema" é o único dos três cuja aparência
 * depende de algo fora desta tela — o que torna o próprio botão ambíguo.
 *
 * O padrão de primeira visita é **escuro**: é a identidade do produto, e é o
 * tema em que a paleta nasceu.
 *
 * O atributo vai no `<html>` e não numa classe do `<body>`: o `color-scheme`
 * precisa estar no elemento raiz para o navegador desenhar scrollbar nativa,
 * `<select>` e autofill no tom certo.
 */
export type Tema = "light" | "dark";

const CHAVE = "dbee:tema";
const PADRAO: Tema = "dark";

export function lerTema(): Tema {
  try {
    return localStorage.getItem(CHAVE) === "light" ? "light" : PADRAO;
  } catch {
    // Aba anônima, cookies bloqueados: o padrão serve e o app não quebra por
    // causa de uma preferência de aparência.
    return PADRAO;
  }
}

export function guardarTema(tema: Tema): void {
  try {
    localStorage.setItem(CHAVE, tema);
  } catch {
    /* sem persistência: a escolha vale para esta aba */
  }
}

export const alternar = (tema: Tema): Tema => (tema === "dark" ? "light" : "dark");

/** Escreve o tema no `<html>`. */
export function aplicar(tema: Tema): void {
  document.documentElement.dataset["theme"] = tema;
}

/**
 * Aplica o que estiver guardado. Seguro para rodar antes do React — e precisa
 * rodar antes: depois, a primeira pintura sairia escura e piscaria branco para
 * quem escolheu claro.
 */
export function aplicarTemaGuardado(): Tema {
  const tema = lerTema();
  aplicar(tema);
  return tema;
}
