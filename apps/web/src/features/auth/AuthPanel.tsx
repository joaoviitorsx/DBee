import { useEffect, useRef, useState } from "react";

import vitrine from "../../assets/vitrine-login.webp";
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
          "relative grid h-full w-full grid-cols-1 grid-rows-[1fr] overflow-hidden",
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
        <figure className="relative h-full w-full overflow-hidden rounded-2xl">
          <img
            src={vitrine}
            alt=""
            aria-hidden
            width={1800}
            height={2249}
            // Sem animação contínua: o próprio CSS do projeto diz que nada anima
            // só por decoração. O estado de carregando vive no botão.
            // `object-cover` de volta: `contain` mostrava a cena inteira mas
            // deixava tarjas vazias dos dois lados da coluna, e a tela lia como
            // desalinhada. O `object-position` em 20% da altura é o que mantém a
            // abelha enquadrada mesmo com o corte.
            className="h-full w-full object-cover object-[50%_20%]"
          />

        </figure>
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
          {/* Marca — ícone, lockup e a linha que diz o que é. */}
          <div className="flex items-center gap-3">
            <img src="/icon-192.png" alt="" aria-hidden className="h-16 w-16 shrink-0 sm:h-20 sm:w-20" />
            <div className="min-w-0">
              {/*
                "D" e "Bee" no mesmo corpo — a distinção é só de cor, então
                "DB" alinha em altura.

                "Bee" usa `text-amber`, o âmbar VIBRANTE, e não o `accent`
                legível. Medido: sobre o creme do tema claro o vibrante dá
                1,83:1, longe do mínimo AA de 4,5:1 — e mesmo assim é o certo
                aqui, porque a WCAG isenta **logotipo** de contraste. O mesmo
                amarelo em "de volta" logo abaixo seria violação: lá é texto de
                cabeçalho, não marca.
              */}
              <span className="font-marca text-[2.6rem] font-bold leading-none tracking-[-0.03em] sm:text-[3.1rem]">
                <span className="text-ink">D</span>
                <span className="text-amber">Bee</span>
              </span>
              <p className="mt-2 text-sm text-muted">{t("login.marcaTagline")}</p>
            </div>
          </div>

          <h1 className="mt-10 text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink">
            {titulo}
          </h1>
          {descricao === undefined ? null : (
            <p className="mt-2 text-sm leading-relaxed text-muted">{descricao}</p>
          )}

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
          className="text-xs font-medium tracking-[-0.01em] text-ink transition-colors "
        >
          {rotulo}
        </label>
        {dica === undefined ? null : <span className="text-2xs text-subtle">{dica}</span>}
      </div>

      <div className="relative">
        {icone === undefined ? null : (
          // O ícone guia o campo (usuário, cadeado) e escurece no foco.
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center text-subtle transition-colors group-focus-within:text-ink">
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
            "h-10 w-full rounded-[6px] border bg-surface max-lg:h-11 px-4 font-mono text-sm text-ink",
            "transition-[color,border-color,box-shadow] duration-150 placeholder:text-subtle",
            "focus:outline-none focus:ring-1 focus:ring-line-strong",
            icone === undefined ? "" : "pl-11",
            acao === undefined ? "" : "pr-12",
            invalido
              ? "border-danger/60 focus:border-danger"
              : "border-line/80 hover:border-line-strong focus:border-line-strong",
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
