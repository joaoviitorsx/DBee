import type { Locale } from "@dbee/shared";

/**
 * Idioma da UI (PT/EN) — fechamento da v0.1.
 *
 * Espelha `theme.ts`: a escolha vale antes de o React montar (o `lang` do
 * `<html>` e o primeiro texto já saem no idioma certo) e persiste em
 * `localStorage` para a tela de login — que aparece **antes** de haver usuário,
 * então não pode depender do registro no servidor. Depois do login, o idioma
 * salvo no usuário vence e é reescrito aqui (ver `IdiomaProvider`).
 *
 * O erro do Postgres **não** passa por aqui: vai inteiro para a tela, no idioma
 * do `lc_messages` do cluster. Traduzir seria reescrever o que o banco disse.
 */

export type { Locale };

const CHAVE = "dbee:idioma";
const PADRAO: Locale = "pt";

const ehLocale = (v: unknown): v is Locale => v === "pt" || v === "en";

/**
 * Primeiro idioma: o guardado, senão o do navegador, senão português.
 *
 * O produto nasceu em pt-BR para escritório contábil no Brasil, então só cai em
 * inglês quando o navegador claramente pede inglês — um `fr-FR` fica em
 * português, que é o idioma que a equipe entende.
 */
export function detectarInicial(): Locale {
  try {
    const guardado = localStorage.getItem(CHAVE);
    if (ehLocale(guardado)) return guardado;
  } catch {
    /* aba anônima / cookies bloqueados: segue para o navegador */
  }
  try {
    if (navigator.language.toLowerCase().startsWith("en")) return "en";
  } catch {
    /* sem navigator.language: padrão */
  }
  return PADRAO;
}

export function guardarIdioma(locale: Locale): void {
  try {
    localStorage.setItem(CHAVE, locale);
  } catch {
    /* sem persistência: vale para esta aba */
  }
}

/** Escreve o `lang` no `<html>` — hifenização, leitor de tela e `Intl` do CSS. */
export function aplicarIdioma(locale: Locale): void {
  document.documentElement.lang = locale === "pt" ? "pt-BR" : "en";
}

/** Aplica o guardado antes do React montar, como o tema. */
export function aplicarIdiomaGuardado(): Locale {
  const locale = detectarInicial();
  aplicarIdioma(locale);
  return locale;
}

/** Tag BCP-47 para os `Intl.*` — número e data no formato do idioma. */
export const tagIntl = (locale: Locale): string => (locale === "pt" ? "pt-BR" : "en-US");
