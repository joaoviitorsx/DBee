/**
 * Tema: claro, escuro ou seguir o sistema (ideia I5, DBeaver #21600).
 *
 * **Preferência ≠ tema aplicado.** A preferência tem três valores; o que vai
 * no `<html>` é sempre `light` ou `dark`. "Sistema" resolve por
 * `prefers-color-scheme` e acompanha a mudança do SO enquanto a aba está
 * aberta (`ouvirSistema`).
 *
 * O padrão de primeira visita continua **escuro**: é a identidade do produto, e
 * é o tema em que a paleta nasceu. "Sistema" é escolha explícita.
 *
 * O atributo vai no `<html>` e não numa classe do `<body>`: o `color-scheme`
 * precisa estar no elemento raiz para o navegador desenhar scrollbar nativa,
 * `<select>` e autofill no tom certo.
 */
export type Tema = "light" | "dark";
export type PreferenciaTema = Tema | "system";

const CHAVE = "dbee:tema";
const PADRAO: PreferenciaTema = "dark";
const CONSULTA = "(prefers-color-scheme: light)";

const ehPreferencia = (v: unknown): v is PreferenciaTema => v === "light" || v === "dark" || v === "system";

export function lerPreferencia(): PreferenciaTema {
  try {
    const v = localStorage.getItem(CHAVE);
    return ehPreferencia(v) ? v : PADRAO;
  } catch {
    // Aba anônima, cookies bloqueados: o padrão serve e o app não quebra por
    // causa de uma preferência de aparência.
    return PADRAO;
  }
}

export function guardarPreferencia(p: PreferenciaTema): void {
  try {
    localStorage.setItem(CHAVE, p);
  } catch {
    /* sem persistência: a escolha vale para esta aba */
  }
}

/** Ordem do ciclo do botão: escuro → claro → sistema → escuro. */
export const proximaPreferencia = (p: PreferenciaTema): PreferenciaTema =>
  p === "dark" ? "light" : p === "light" ? "system" : "dark";

/** Puro: a preferência mais o que o sistema diz viram o tema aplicado. */
export const resolver = (p: PreferenciaTema, sistemaClaro: boolean): Tema =>
  p === "system" ? (sistemaClaro ? "light" : "dark") : p;

function sistemaClaro(): boolean {
  try {
    return window.matchMedia(CONSULTA).matches;
  } catch {
    return false;
  }
}

export const temaDe = (p: PreferenciaTema): Tema => resolver(p, sistemaClaro());

/** Escreve o tema no `<html>`. */
export function aplicar(tema: Tema): void {
  document.documentElement.dataset["theme"] = tema;
}

/** Avisa quando o SO troca claro/escuro. Devolve o desligamento. */
export function ouvirSistema(aoMudar: () => void): () => void {
  try {
    const mq = window.matchMedia(CONSULTA);
    mq.addEventListener("change", aoMudar);
    return () => { mq.removeEventListener("change", aoMudar); };
  } catch {
    return () => undefined;
  }
}

/**
 * Aplica o que estiver guardado. Seguro para rodar antes do React — e precisa
 * rodar antes: depois, a primeira pintura sairia escura e piscaria branco para
 * quem escolheu claro.
 */
export function aplicarTemaGuardado(): Tema {
  const tema = temaDe(lerPreferencia());
  aplicar(tema);
  return tema;
}
