import { useEffect, useRef, useState } from "react";

import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { IdiomaToggle } from "../idioma/IdiomaToggle";
import { CenaLogin } from "./CenaLogin";

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
  descricao,
  recusado = false,
  children,
  rodape,
}: {
  readonly titulo: string;
  /** Opcional: quando o título já diz tudo ("Entrar"), não há subtítulo. */
  readonly descricao?: string;
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
    /*
      A página **é** o cartão.

      Antes era um cartão de 64rem centrado num fundo grande com cachos de favo
      — numa tela de 1440 sobravam 350px de nada de cada lado, e a tela lia como
      um diálogo perdido em vez de uma porta de entrada. Agora o cartão ocupa a
      janela e não há fundo para decorar.
    */
    /*
      Cadeia de altura determinística: `h-dvh` no `main`, `h-full` no grid.

      Antes o `main` era `grid place-items-center`, que dá ao filho altura de
      **conteúdo** — e aí o `h-full` de dentro resolvia contra uma caixa que não
      era a da janela, e a ilustração vazava por baixo da borda.

      E sem `padding` aqui: ele era uma margem invisível em volta da página
      inteira, e o favo do canto direito ficava cortado por ela em vez de sangrar
      na borda da janela. O recuo da ilustração é dela própria.
    */
    <main className="h-dvh overflow-hidden bg-sunken">
      {/*
        Teto na composição.

        Sem ele, numa janela de 1920 a ilustração ficava com 960px e o
        formulário virava um bloco pequeno perdido num vazio — a tela lia como
        duas coisas soltas em vez de um par. O contêiner é centrado e limitado;
        como o fundo é o mesmo `bg-surface` dos dois lados, não vira "cartão
        flutuando", continua sendo a página.
      */}
      <div
        className={cn(
          "relative grid h-full w-full grid-cols-1 grid-rows-[auto_1fr] overflow-hidden",
          // Preenche a janela inteira. O que impede o campo de virar uma faixa
          // de 900px num ultrawide é o teto do CONTEÚDO (32rem), não um teto da
          // coluna — capar a coluna deixava tarjas de fundo dos dois lados.
          "lg:grid-cols-2 lg:grid-rows-1",
        )}
      >
      {/*
        Ilustração — embutida, não sangrando: uma margem em volta e cantos
        arredondados, para ela ler como uma janela dentro da tela e não como
        metade do fundo. Só a partir de `lg`: abaixo disso ela empurrava o campo
        de usuário para a segunda dobra, e no celular quem abre a tela quer
        entrar. Sem véu, sem slogan, sem gradiente: a imagem fala sozinha.
      */}
      <div className="order-1 hidden lg:block lg:p-6">
        {/*
          A moldura arredondada recorta a imagem nos cantos.
        */}
        {/*
          A cena animada no lugar da vitrine 3D (identidade.md, "uma abelha
          só"): a abelha plana leva uma consulta de um banco até a grade.
          Sobre a superfície rebaixada, sem slogan, sem gradiente.
        */}
        <figure className="flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border border-line bg-sunken p-10">
          <CenaLogin />
        </figure>
      </div>

      {/*
        Abaixo de `lg`: a mesma cena como vinheta de 144 px (consulta + topo do
        favo + abelha), acima do formulário. Baixa o bastante para o campo de
        usuário continuar na primeira dobra em 375×667.
      */}
      <div className="order-1 h-36 shrink-0 px-4 sm:h-48 border-b border-line lg:hidden">
        <CenaLogin compacta />
      </div>

      {/* Formulário. */}
      <div
        key={gesto}
        className={cn(
          "relative order-2 flex min-h-0 justify-center overflow-y-auto px-6 pb-8 sm:px-10 lg:px-12",
          // `pt` maior no empilhado: o seletor de idioma vive no canto desta
          // coluna, e sem folga ele encosta no lockup da marca.
          "pt-14 sm:pt-10 lg:pt-8",
          // Centrado na altura que sobra. Antes o vão morto vinha de as linhas
          // do grid serem `auto`: a segunda não crescia e o conteúdo boiava.
          // Com `1fr` a linha ocupa o resto, e centralizar fica equilibrado
          // tanto em 375 quanto em 768.
          "items-center",
          recusado && "animate-refuse",
        )}
      >
        {/*
          O seletor mora aqui, e não solto sobre a tela: no empilhado ele caía
          em cima do céu da ilustração — texto claro sobre azul claro.
        */}
        <IdiomaToggle className="absolute right-4 top-4 z-20 text-muted hover:text-ink" />
        {/*
          A coluna cresce com a janela, mas o conteúdo não: acima de ~32rem um
          campo de usuário vira uma faixa larga e o olho perde o começo da
          linha. `animate-settle` é o único momento de entrada da tela — um, não
          uma cascata por elemento, que é o tique de página gerada.
        */}
        <div className="animate-settle relative z-10 w-full max-w-[32rem]">
          {/*
            Dois níveis, não três: o lockup é assinatura (pequeno, em cima) e o
            título é a única coisa grande. A tagline virou a linha de apoio do
            título quando a tela não traz descrição própria.

            "Bee" usa `text-amber`, o âmbar vibrante: a WCAG isenta logotipo de
            contraste, e é a única palavra âmbar fora do modo escrita (§4b).
          */}
          <div className="flex items-center gap-2.5">
            <img src="/icon-192.png" alt="" aria-hidden className="h-9 w-9 shrink-0" />
            <span className="font-marca text-2xl font-bold leading-none tracking-[-0.03em]">
              <span className="text-ink">D</span>
              <span className="text-amber">Bee</span>
            </span>
          </div>

          <h1 className="mt-12 text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink max-lg:mt-8">
            {titulo}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {descricao ?? t("login.marcaTagline")}
          </p>

          <div className="mt-6">{children}</div>

          {rodape === undefined ? null : (
            <p className="mt-6 border-t border-line/70 pt-4 text-2xs leading-relaxed text-subtle">
              {rodape}
            </p>
          )}
        </div>
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
  /** Ícone à esquerda do campo — passa de `subtle` a `ink` no foco. */
  readonly icone?: React.ReactNode;
  readonly invalido?: boolean;
}) {
  return (
    <div className="group">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        {/* Foco sem âmbar: âmbar é o selo do modo escrita (§1.4), e a primeira
            tela do dia não pode treinar o olho a lê-lo como "campo ativo". */}
        <label
          htmlFor={id}
          className="text-xs font-medium text-muted transition-colors duration-(--motion-fast) group-focus-within:text-ink"
        >
          {rotulo}
        </label>
        {dica === undefined ? null : <span className="text-2xs text-subtle">{dica}</span>}
      </div>

      <div className="relative">
        {icone === undefined ? null : (
          // O ícone guia o campo (usuário, cadeado) e escurece no foco.
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center text-subtle transition-colors duration-(--motion-fast) group-hover:text-muted group-focus-within:text-ink">
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
            // Mesmo raio e altura do resto do app (§3): a tela de entrada é a
            // ferramenta, não uma landing page com cápsulas.
            // Mais claro que a página, não mais escuro: com o fundo em `sunken`, um
            // campo `sunken` sumiria. `surface` é o passo acima nos dois temas.
            "h-11 w-full rounded-[6px] border bg-surface px-4 font-mono text-sm text-ink",
            "transition-[border-color,box-shadow,background-color] duration-(--motion-base) ease-(--ease-enter) placeholder:text-subtle",
            // Anel neutro de 3 px, não âmbar: a borda escurece e o anel abre
            // em volta, como um campo que recebeu a mão (§9 pede foco visível).
            "focus:bg-raised focus:outline-none focus:ring-[3px] focus:ring-ink/10",
            icone === undefined ? "" : "pl-11",
            acao === undefined ? "" : "pr-12",
            invalido
              ? "border-danger/60 focus:border-danger focus:ring-danger/15"
              : "border-line hover:border-line-strong focus:border-muted",
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
