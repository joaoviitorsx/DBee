import { Hexagon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Honeycomb } from "../../components/Honeycomb";
import { HoneycombCluster } from "../../components/HoneycombCluster";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { IdiomaToggle } from "../idioma/IdiomaToggle";
import { Mascote, type Humor } from "../mascote";

/**
 * A moldura das telas de entrada — duas colunas.
 *
 * À **esquerda**, a vitrine: fundo âmbar profundo com favo de mel (o motivo da
 * abelha) e o mascote flutuando, com a marca. É o rosto do produto na porta. À
 * **direita**, o formulário, sobre o material do app. No mobile a vitrine vira
 * uma faixa curta no topo — o mascote continua presente sem comer a tela do
 * teclado.
 *
 * O favo aparece **de leve** também atrás do formulário: costura os dois lados,
 * para a divisa não parecer dois produtos colados.
 */
export function AuthPanel({
  titulo,
  descricao,
  humor,
  ocupado = false,
  recusado = false,
  children,
  rodape,
}: {
  readonly titulo: string;
  readonly descricao: string;
  /** Humor do mascote na vitrine. */
  readonly humor: Humor;
  /** O mascote flutua enquanto a requisição está no ar. */
  readonly ocupado?: boolean;
  /** Dispara o gesto de recusa uma vez. */
  readonly recusado?: boolean;
  readonly children: React.ReactNode;
  readonly rodape?: React.ReactNode;
}) {
  // A animação de recusa precisa **reiniciar** a cada tentativa. Sem a chave
  // trocando, o React reaproveita o nó e a segunda senha errada não sacode.
  const [gesto, setGesto] = useState(0);
  const anterior = useRef(recusado);
  useEffect(() => {
    if (recusado && !anterior.current) setGesto((n) => n + 1);
    anterior.current = recusado;
  }, [recusado]);
  const t = useT();

  return (
    <main className="relative grid min-h-dvh grid-rows-[auto_1fr] bg-sunken lg:grid-cols-[1.05fr_1fr] lg:grid-rows-1">
      {/* Idioma escolhível antes do login — quem só lê inglês troca aqui. */}
      <IdiomaToggle className="absolute right-3 top-3 z-10 text-bone/80 hover:text-bone lg:text-ink/70 lg:hover:text-ink" />
      {/* Vitrine — marca, favo e mascote. */}
      <div className="relative overflow-hidden bg-graphite lg:border-r lg:border-line">
        {/* Gradiente âmbar quente, o fundo de marca. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 120% at 20% 0%, color-mix(in oklab, var(--color-amber) 22%, var(--color-graphite)) 0%, var(--color-graphite) 60%)",
          }}
        />
        {/*
         * Aurora — dois glows âmbar que derivam devagar atrás do favo e do
         * mascote. É o "vivo" da tela; fica no fundo, desfocado, então nunca
         * disputa leitura com a marca. Congelado sob prefers-reduced-motion.
         */}
        <div
          aria-hidden
          className="animate-aurora absolute -left-1/4 -top-1/4 h-[80%] w-[80%] rounded-full blur-[80px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--color-amber) 52%, transparent), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="animate-aurora absolute -bottom-1/4 -right-1/4 h-[70%] w-[70%] rounded-full blur-[90px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--color-amber) 34%, transparent), transparent 70%)",
            animationDelay: "-9s",
            animationDuration: "26s",
          }}
        />
        <Honeycomb className="absolute inset-0 text-amber" size={26} opacity={0.12} />

        <div className="relative flex h-full flex-col items-center justify-center gap-5 px-6 py-8 lg:gap-7 lg:px-10 lg:py-12">
          {/* Selo — o que é, em uma linha, antes do resto. */}
          <span
            className="animate-enter inline-flex items-center gap-1.5 rounded-full border border-amber/25 bg-amber/10 px-3 py-1 text-2xs font-medium text-amber"
            style={{ animationDelay: "40ms" }}
          >
            <Hexagon aria-hidden className="h-3 w-3" fill="currentColor" strokeWidth={0} />
            {t("login.selo")}
          </span>

          {/*
           * O mascote é o herói da vitrine: um halo âmbar difuso atrás dá
           * profundidade sem virar movimento decorativo (o halo é estático; só
           * o mascote flutua). O `float` para enquanto a requisição está no ar.
           */}
          <div className="animate-enter relative" style={{ animationDelay: "120ms" }}>
            <div
              aria-hidden
              className="absolute inset-0 -z-10 scale-[1.6] rounded-full opacity-70 blur-2xl"
              style={{
                background:
                  "radial-gradient(circle at 50% 45%, color-mix(in oklab, var(--color-amber) 40%, transparent), transparent 68%)",
              }}
            />
            <Mascote
              humor={humor}
              float={!ocupado}
              className="h-28 w-28 drop-shadow-[0_18px_36px_rgba(0,0,0,.45)] lg:h-44 lg:w-44"
            />
          </div>

          {/* Marca + frase de efeito. */}
          <div
            className="animate-enter max-w-sm space-y-2.5 text-center"
            style={{ animationDelay: "200ms" }}
          >
            <div className="flex items-center justify-center gap-2">
              <img src="/icon-192.png" alt="" aria-hidden className="h-8 w-8" />
              {/*
               * "D" e "Bee" no mesmo tamanho — a distinção é só de cor: "Bee"
               * em âmbar (a abelha, o produto), "D" em osso. Sem diferença de
               * corpo, então "DB" alinha em altura.
               */}
              <span className="font-marca text-3xl font-bold tracking-[-0.03em]">
                <span className="text-bone">D</span>
                <span className="text-amber">Bee</span>
              </span>
            </div>
            {/*
             * A assinatura da marca, em três tempos — "Build What's Next." é a
             * batida final, em âmbar. Fica em inglês de propósito: é o slogan,
             * não corpo de texto (o subtítulo abaixo fala português).
             */}
            <h2 className="text-2xl font-bold leading-[1.12] tracking-[-0.03em] text-bone lg:text-[1.7rem]">
              {t("login.slogan1")}{" "}
              <span className="text-amber">{t("login.slogan2")}</span>
            </h2>
            <p className="hidden max-w-[22rem] text-sm leading-relaxed text-bone/65 lg:block">
              {t("login.subtitulo")}
            </p>
          </div>

          {/* Provas — três motivos, com marcador de favo. */}
          <ul
            className="animate-enter hidden w-full max-w-xs space-y-2.5 lg:block"
            style={{ animationDelay: "300ms" }}
          >
            {[
              [t("login.provaLeituraTitulo"), t("login.provaLeituraDetalhe")],
              [t("login.provaHistoricoTitulo"), t("login.provaHistoricoDetalhe")],
              [t("login.provaExportTitulo"), t("login.provaExportDetalhe")],
            ].map(([titulo, detalhe]) => (
              <li key={titulo} className="flex items-start gap-2.5">
                <Hexagon
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber"
                  fill="currentColor"
                  strokeWidth={0}
                />
                <span className="text-xs leading-relaxed">
                  <span className="font-medium text-bone">{titulo}</span>
                  <span className="text-bone/55"> — {detalhe}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Formulário. */}
      <div className="relative flex items-center justify-center overflow-hidden px-5 py-10">
        {/*
         * O detalhe de canto: um cacho de favo no canto inferior direito, âmbar
         * do tema (traço no claro, mais quente no escuro). Substitui a
         * tesselação de fundo que competia com o formulário — aqui é um selo, a
         * marca assinando o rodapé, não papel de parede.
         */}
        <HoneycombCluster
          className="absolute bottom-0 right-0 h-52 w-52 translate-x-8 translate-y-8 text-accent opacity-[0.16] lg:h-64 lg:w-64"
          size={19}
        />
        <section
          key={gesto}
          className={cn(
            // Cartão do formulário: material do app com um leve desfoque de fundo
            // (o favo atrás ganha profundidade) e uma sombra contida e quente —
            // não a sombra cinza difusa de card genérico. A régua âmbar à
            // esquerda é a única moldura de marca; sem fio de luz no topo nem
            // brilho decorativo, para não ter cara de template.
            "relative w-full max-w-[25rem] rounded-2xl p-7 sm:p-9",
            "border border-line/70 bg-surface/88 shadow-[0_24px_60px_-24px_rgba(20,12,2,0.75)] backdrop-blur-md",
            "animate-settle border-l-[3px] border-l-accent",
            recusado && "animate-refuse",
          )}
        >
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink">{titulo}</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{descricao}</p>

          <div className="mt-7">{children}</div>

          {rodape === undefined ? null : (
            <p className="mt-6 border-t border-line/70 pt-4 text-2xs leading-relaxed text-subtle">
              {rodape}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

/**
 * Campo de credencial.
 *
 * Monoespaçado nos dois: usuário e senha são digitados **literalmente**, e a
 * fonte mono é o que diz isso — além de separar `l` de `1` e `O` de `0` na hora
 * de conferir o que foi digitado, que é exatamente o problema da senha do
 * primeiro boot.
 *
 * Rótulo visível, nunca só placeholder: placeholder some quando se começa a
 * digitar, e aí o campo perde o nome justamente para quem voltou a ele.
 */
export function CampoCredencial({
  id,
  rotulo,
  tipo,
  valor,
  onChange,
  autoComplete,
  autoFocus = false,
  dica,
  aviso,
  acao,
  icone,
  invalido = false,
}: {
  readonly id: string;
  readonly rotulo: string;
  readonly tipo: "text" | "password";
  readonly valor: string;
  readonly onChange: (v: string) => void;
  readonly autoComplete: string;
  readonly autoFocus?: boolean;
  readonly dica?: string;
  readonly aviso?: string | null;
  readonly acao?: React.ReactNode;
  /** Ícone à esquerda do campo — acende em âmbar junto com o rótulo no foco. */
  readonly icone?: React.ReactNode;
  readonly invalido?: boolean;
}) {
  return (
    <div className="group">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        {/* O rótulo acende em âmbar quando o campo recebe foco: diz "é aqui
            que você está" sem depender só do anel do input. */}
        <label
          htmlFor={id}
          className="text-xs font-medium tracking-[-0.01em] text-ink transition-colors group-focus-within:text-accent"
        >
          {rotulo}
        </label>
        {dica === undefined ? null : <span className="text-2xs text-subtle">{dica}</span>}
      </div>

      <div className="relative">
        {icone === undefined ? null : (
          // O ícone guia o campo (usuário, cadeado) e acende no foco junto do
          // rótulo — detalhe de login moderno, não enfeite: diz o que digitar.
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-subtle transition-colors group-focus-within:text-accent">
            {icone}
          </div>
        )}
        <input
          id={id}
          type={tipo}
          value={valor}
          onChange={(e) => { onChange(e.target.value); }}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-invalid={invalido}
          aria-describedby={aviso === null || aviso === undefined ? undefined : `${id}-aviso`}
          spellCheck={false}
          autoCapitalize="none"
          className={cn(
            // 48px de altura: campo generoso de login moderno, e a mão pesada
            // de quem digita senha errado duas vezes agradece o alvo grande.
            "h-12 w-full rounded-lg border bg-sunken/60 px-3.5 font-mono text-sm text-ink",
            "transition-[color,border-color,box-shadow] duration-150 placeholder:text-subtle",
            "focus:outline-none focus:ring-4 focus:ring-accent/15",
            icone === undefined ? "" : "pl-10",
            acao === undefined ? "" : "pr-11",
            invalido
              ? "border-danger/60 focus:border-danger"
              : "border-line/80 hover:border-line-strong focus:border-accent",
          )}
        />
        {acao === undefined ? null : (
          <div className="absolute inset-y-0 right-1 flex items-center">{acao}</div>
        )}
      </div>

      {aviso === null || aviso === undefined ? null : (
        <p id={`${id}-aviso`} className="mt-1.5 text-2xs text-accent">
          {aviso}
        </p>
      )}
    </div>
  );
}
