import { useEffect, useRef, useState } from "react";

import vitrine from "../../assets/vitrine-login.webp";
import { HoneycombCluster } from "../../components/HoneycombCluster";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { IdiomaToggle } from "../idioma/IdiomaToggle";

/**
 * A moldura das telas de entrada: um cartão com a ilustração à esquerda e o
 * formulário à direita.
 *
 * ## A ilustração carrega a marca sozinha
 *
 * Antes, a vitrine empilhava selo, mascote com halo, duas auroras animadas,
 * favo de fundo, slogan e três provas — sete elementos disputando a mesma
 * coluna, e o formulário do lado com um cacho de favo de canto. Agora a
 * ilustração **é** a vitrine. Um elemento memorável, e tudo em volta quieto:
 * o resto da tela só precisa levar a pessoa ao campo de usuário.
 *
 * O mascote saiu junto, e não é perda: a cena já tem a abelha. Repeti-la ao
 * lado seria a redundância que o design-system lista no §1.4.
 *
 * ## O que a tela NÃO tem
 *
 * Não há "criar conta", "esqueci minha senha" nem "lembrar de mim". Não é
 * esquecimento: **nenhum dos três existe no servidor.** Não há rota de
 * recuperação, e a sessão tem expiração absoluta de 12 h (§7), sem modo
 * prolongado. Um controle que não faz nada é pior que a ausência dele — quem
 * perdeu a senha precisa saber que o caminho é o servidor, e o rodapé diz
 * isso.
 */
export function AuthPanel({
  titulo,
  tituloDestaque,
  descricao,
  recusado = false,
  children,
  rodape,
}: {
  readonly titulo: string;
  /**
   * Fecho do título, em âmbar. "Bem-vindo" + "de volta" — a cor separa a
   * saudação do estado, sem precisar de duas linhas.
   */
  readonly tituloDestaque?: string;
  readonly descricao: string;
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
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-sunken p-4 sm:p-6">
      {/*
        Dois cachos de favo nos cantos opostos, bem apagados. É a única
        decoração do fundo: papel de parede atrás de um cartão escuro vira
        ruído, e a tesselação cheia competia com a ilustração.
      */}
      <HoneycombCluster
        aria-hidden
        className="pointer-events-none absolute -left-16 -top-16 h-72 w-72 text-accent opacity-[0.07]"
        size={22}
      />
      <HoneycombCluster
        aria-hidden
        className="pointer-events-none absolute -bottom-16 -right-16 h-72 w-72 -scale-x-100 text-accent opacity-[0.07]"
        size={22}
      />

      <IdiomaToggle className="absolute right-4 top-4 z-20 text-muted hover:text-ink" />

      <div
        key={gesto}
        className={cn(
          // Um único momento de entrada, no cartão inteiro — não uma cascata
          // por elemento, que é o tique de página gerada (design-system).
          "animate-settle relative z-10 w-full max-w-5xl overflow-hidden rounded-2xl",
          "border border-line/70 bg-surface shadow-[0_32px_80px_-32px_rgba(20,12,2,0.85)]",
          "grid grid-cols-1 lg:grid-cols-[1fr_1.05fr]",
          recusado && "animate-refuse",
        )}
      >
        {/*
          Ilustração à esquerda.

          Em telas estreitas ela vira uma faixa curta no topo, com o
          enquadramento no alto: é onde estão o céu e a abelha. `object-cover`
          com `object-top` mantém o assunto visível em qualquer proporção, em
          vez de cortar pelo meio.
        */}
        <div className="relative order-1 h-36 overflow-hidden sm:h-48 lg:h-auto">
          <img
            src={vitrine}
            alt=""
            aria-hidden
            width={900}
            height={1125}
            // Sem animação contínua: o próprio CSS do projeto diz que nada
            // anima só por decoração, e uma imagem pulsando não leva ninguém
            // ao campo de usuário. O estado de carregando vive no botão.
            className="h-full w-full object-cover object-top"
          />
          {/*
            Véu que escurece a base da ilustração no empilhado, para o topo do
            formulário não encostar num azul saturado. No desktop a divisa é a
            borda do cartão e o véu some.
          */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface to-transparent lg:hidden"
          />
        </div>

        {/* Formulário. */}
        <div className="order-2 flex flex-col justify-center px-6 py-8 sm:px-10 sm:py-10 lg:px-12">
          {/* Marca — ícone, lockup e a linha que diz o que é. */}
          <div className="flex items-center gap-3">
            <img src="/icon-192.png" alt="" aria-hidden className="h-10 w-10 shrink-0" />
            <div className="min-w-0">
              {/*
                "D" e "Bee" no mesmo corpo — a distinção é só de cor, então
                "DB" alinha em altura.
              */}
              <span className="font-marca text-2xl font-bold leading-none tracking-[-0.03em]">
                <span className="text-ink">D</span>
                <span className="text-accent">Bee</span>
              </span>
              <p className="mt-1 text-2xs text-subtle">{t("login.marcaTagline")}</p>
            </div>
          </div>

          <h1 className="mt-8 text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[1.75rem]">
            {titulo}
            {tituloDestaque === undefined ? null : (
              <>
                {" "}
                <span className="text-accent">{tituloDestaque}</span>
              </>
            )}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{descricao}</p>

          <div className="mt-7">{children}</div>

          {rodape === undefined ? null : (
            <p className="mt-6 border-t border-line/70 pt-4 text-2xs leading-relaxed text-subtle">
              {rodape}
            </p>
          )}
        </div>
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
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center text-subtle transition-colors group-focus-within:text-accent">
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
            // Cápsula alta, como na referência: alvo generoso para a mão pesada
            // de quem já errou a senha duas vezes.
            "h-12 w-full rounded-full border bg-sunken/70 px-4 font-mono text-sm text-ink",
            "transition-[color,border-color,box-shadow] duration-150 placeholder:text-subtle",
            "focus:outline-none focus:ring-4 focus:ring-accent/15",
            icone === undefined ? "" : "pl-11",
            acao === undefined ? "" : "pr-12",
            invalido
              ? "border-danger/60 focus:border-danger"
              : "border-line/80 hover:border-line-strong focus:border-accent",
          )}
        />
        {acao === undefined ? null : (
          <div className="absolute inset-y-0 right-1.5 flex items-center">{acao}</div>
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
