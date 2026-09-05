import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { aplicarIdioma, detectarInicial, guardarIdioma, tagIntl, type Locale } from "../lib/idioma";
import { useSession, useDefinirIdioma } from "../features/auth/useSession";
import { en } from "./en";
import { pt, type ChaveI18n } from "./pt";

/**
 * i18n do DBee (fechamento da v0.1).
 *
 * Um `t()` próprio sobre dicionário plano — sem `react-i18next` (~40 KB para
 * dois idiomas sem pluralização complexa, CLAUDE.md/ATRITO). A UI inteira passa
 * por aqui; número e data por `Intl`. O erro do Postgres **não** passa: vai
 * inteiro para a tela, no idioma do cluster.
 *
 * Ordem de precedência do idioma: o **usuário no servidor** vence, porque a
 * escolha o acompanha entre dispositivos; antes do login, o `localStorage` /
 * navegador serve a tela de entrada.
 */

export type Tradutor = (chave: ChaveI18n, params?: Record<string, string | number>) => string;

interface IdiomaCtx {
  readonly locale: Locale;
  readonly t: Tradutor;
  readonly setLocale: (locale: Locale) => void;
  readonly formatarNumero: (n: number) => string;
  readonly formatarData: (iso: string) => string;
}

const Ctx = createContext<IdiomaCtx | null>(null);

function criarTradutor(locale: Locale): Tradutor {
  const dicionario = locale === "pt" ? pt : en;
  return (chave, params) => {
    // `en` é `Record<ChaveI18n, string>` e `pt` é a fonte: a chave sempre
    // resolve, então não há fallback a fazer — o tipo garante a totalidade.
    let texto: string = dicionario[chave];
    if (params !== undefined) {
      for (const [nome, valor] of Object.entries(params)) {
        texto = texto.replaceAll(`{${nome}}`, String(valor));
      }
    }
    return texto;
  };
}

export function IdiomaProvider({ children }: { readonly children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectarInicial);
  const { data: sessao } = useSession();
  const definir = useDefinirIdioma();

  // O servidor manda: ao chegar (ou mudar) o usuário, adota o idioma dele.
  // Padrão "ajustar estado no render com o valor anterior guardado" — sem
  // efeito colateral aqui; a escrita no DOM/storage fica no efeito abaixo.
  const servidor = sessao?.locale ?? null;
  const [ultimoServidor, setUltimoServidor] = useState<Locale | null>(null);
  if (servidor !== null && servidor !== ultimoServidor) {
    setUltimoServidor(servidor);
    if (servidor !== locale) setLocaleState(servidor);
  }

  // Aplica e persiste sempre que o idioma muda, venha do toggle ou do servidor.
  useEffect(() => {
    aplicarIdioma(locale);
    guardarIdioma(locale);
  }, [locale]);

  const setLocale = useCallback(
    (novo: Locale) => {
      setLocaleState(novo);
      // Com sessão, grava no usuário; sem sessão (login), fica só local.
      if (sessao != null) definir.mutate(novo);
    },
    [sessao, definir],
  );

  const value = useMemo<IdiomaCtx>(() => {
    const tag = tagIntl(locale);
    return {
      locale,
      t: criarTradutor(locale),
      setLocale,
      formatarNumero: (n) => new Intl.NumberFormat(tag).format(n),
      formatarData: (iso) =>
        new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(iso),
        ),
    };
  }, [locale, setLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIdioma(): IdiomaCtx {
  const ctx = useContext(Ctx);
  if (ctx === null) throw new Error("useIdioma fora de IdiomaProvider");
  return ctx;
}

/** Atalho: só o tradutor, o uso mais comum. */
export const useT = (): Tradutor => useIdioma().t;

/**
 * Mensagem de erro do servidor traduzida **pelo código**, com a `message` do
 * servidor como fallback quando não há tradução para aquele código. O erro do
 * Postgres, que chega como `message` sem código conhecido, passa reto.
 */
export function mensagemDoCodigo(t: Tradutor, code: string | undefined, fallback: string): string {
  const chave = `erro.${code ?? ""}`;
  return chave in pt ? t(chave as ChaveI18n) : fallback;
}
