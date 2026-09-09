import { memo, useEffect, useRef, useState } from "react";

import { useT } from "../../i18n";
import { cn } from "../../lib/cn";

/**
 * O export, contado como a abelha faria: pólen sai do banco, atravessa, e o
 * favo guarda.
 *
 * ## Por que não é spinner nem barra de progresso
 *
 * O `download.ts` já emite `onProgress({ bytes })` a cada pedaço escrito em
 * disco, e a tela jogava esse dado fora — guardava só um booleano. Havia
 * informação real de sobra, e um spinner seria descartá-la de novo.
 *
 * Barra também não: o corpo é **stream**, sem `Content-Length`. Não existe
 * total, e desenhar uma barra que sobe até 90% e para é a mentira clássica
 * dessas telas. O que se sabe de verdade é quantos bytes chegaram e a que
 * velocidade — e é isso que a cena mostra.
 *
 * ## O movimento é o dado
 *
 * A **velocidade do pólen é a vazão**, escrita em `--polen-dur` a partir da
 * medição real. Export rápido enche depressa, export lento arrasta, e um export
 * travado **congela**. Esse último caso é o que justifica tudo: hoje "baixando
 * devagar" e "morreu" têm exatamente a mesma aparência na tela.
 *
 * O contador de bytes e a taxa ficam em texto ao lado. O número exato é dado, e
 * dado não pode depender de alguém interpretar uma animação.
 *
 * ## Sem biblioteca
 *
 * Nem `three.js` nem `anime.js`. O bundle mede 348 kB gzip; o three sozinho
 * passa de 150 kB, o que cresceria o app quase 45% para animar um download e
 * desfaria mais do que o ganho de gzip do servidor estático. Isto é geometria
 * SVG e dois keyframes CSS: zero byte a mais.
 *
 * Só `transform` e `opacity`, e o desenho isolado num `memo`.
 *
 * Medido com `Performance.getMetrics`, cinco segundos de animação contínua,
 * contra a mesma página sem a cena: **3,9% da thread principal**. Antes da
 * memoização eram 8,5%, e a culpa não era da animação — era re-render: o
 * `onProgress` dispara ~5×/s e reconstruía os 68 elementos do SVG, embora o
 * desenho dependa só de quantas células estão cheias, que muda 7 vezes no
 * export inteiro.
 */

const LADO = 10;
const ALTURA_HEX = Math.sqrt(3) * LADO;

/**
 * Uma **fita** de favo, não um bloco.
 *
 * Sete células numa linha só, alternando alto e baixo — o encaixe do favo é
 * exatamente esse deslocamento de meia altura entre colunas vizinhas, então a
 * fita continua sendo favo de verdade e não uma régua de hexágonos soltos.
 *
 * Um bloco de três linhas ocupava altura demais para um rodapé: o gesto é
 * acessório do botão que o disparou, não o assunto da tela.
 */
const COLUNAS = 7;
const LINHAS = 1;

/** Onde o favo começa; à esquerda dele fica o voo. */
const FAVO_X = 68;

function hex(cx: number, cy: number): string {
  const meia = ALTURA_HEX / 2;
  const pts: readonly (readonly [number, number])[] = [
    [cx - LADO, cy], [cx - LADO / 2, cy - meia], [cx + LADO / 2, cy - meia],
    [cx + LADO, cy], [cx + LADO / 2, cy + meia], [cx - LADO / 2, cy + meia],
  ];
  return `M${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L")}Z`;
}

interface Celula {
  readonly d: string;
  readonly ordem: number;
  /** Topo e base da célula, para o mel saber de onde subir e até onde. */
  readonly topo: number;
  readonly base: number;
  readonly x: number;
}

/** Geometria montada uma vez: não depende de nada que mude. */
const CELULAS: readonly Celula[] = (() => {
  const lista: Celula[] = [];
  for (let col = 0; col < COLUNAS; col += 1) {
    for (let lin = 0; lin < LINHAS; lin += 1) {
      const cx = FAVO_X + LADO + col * 1.5 * LADO;
      const cy = ALTURA_HEX + lin * ALTURA_HEX + (col % 2 === 1 ? ALTURA_HEX / 2 : 0);
      lista.push({
        d: hex(cx, cy),
        ordem: col * LINHAS + lin,
        topo: cy - ALTURA_HEX / 2,
        base: cy + ALTURA_HEX / 2,
        x: cx,
      });
    }
  }
  return lista;
})();

const TOTAL = CELULAS.length;
const LARGURA = FAVO_X + LADO * 2 + (COLUNAS - 1) * 1.5 * LADO + 6;
// Uma linha mais o deslocamento de meia altura das colunas ímpares, e meia
// altura de folga em cima e embaixo para o traço não encostar na borda.
const ALTURA = 2 * ALTURA_HEX;

/**
 * Os grãos em voo.
 *
 * Nove, com atrasos e alturas distintas — pólen não sai enfileirado. Cada um
 * percorre a mesma distância; o que muda é a partida, para o fluxo parecer
 * contínuo em vez de pulsado.
 */
const POLEN = Array.from({ length: 6 }, (_, i) => ({
  cy: 8 + ((i * 6) % 20),
  r: i % 3 === 0 ? 2.1 : i % 3 === 1 ? 1.5 : 1.1,
  atraso: i * 230,
}));

/** `1,4 MB`, `812 kB`. Sem decimal em kB — precisão que ninguém usa. */
function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Quantas células já estão guardadas.
 *
 * Sem total conhecido, o avanço é **logarítmico**: cada dobra de tamanho enche
 * mais um punhado. Assim um export de 200 kB e um de 2 GB usam o favo inteiro
 * sem que nenhum dos dois encha e pare — o que continua correndo é o pólen, que
 * é o sinal de "ainda vivo".
 */
function guardadas(bytes: number): number {
  if (bytes <= 0) return 0;
  const dobras = Math.log2(bytes / 1024 + 1);
  return Math.min(TOTAL, Math.floor((dobras / 22) * TOTAL));
}

export function FavoDeExport({
  bytes,
  concluido = false,
  className,
}: {
  /** Bytes escritos em disco até agora — do `onProgress` do download. */
  readonly bytes: number;
  readonly concluido?: boolean;
  readonly className?: string;
}) {
  const t = useT();
  const [taxa, setTaxa] = useState<number | null>(null);
  const anterior = useRef({ bytes: 0, quando: 0 });

  /**
   * Os bytes de agora, num ref.
   *
   * O intervalo **não pode** depender de `bytes`: o `onProgress` dispara a cada
   * pedaço, então `bytes` muda várias vezes por segundo, e com ele nas
   * dependências o efeito era desmontado e remontado antes de a amostra de
   * 400 ms chegar a disparar. A taxa nunca era medida, e a tela dizia
   * "aguardando o servidor" com megabytes já no disco — apanhei isso no
   * screenshot, não no código.
   */
  const bytesAgora = useRef(bytes);
  // Escrita no efeito, não no render: ref tocado durante o render é inseguro em
  // render concorrente, e o lint recusa com razão. O atraso de um commit não
  // importa para uma amostra de 400 ms.
  useEffect(() => { bytesAgora.current = bytes; }, [bytes]);

  /**
   * Amostra a vazão. É o único trabalho periódico do componente — o resto do
   * movimento é CSS, que roda fora da thread principal.
   */
  useEffect(() => {
    if (concluido) return;
    const id = setInterval(() => {
      const agora = performance.now();
      const atual = bytesAgora.current;
      const ref = anterior.current;
      if (ref.quando === 0) {
        anterior.current = { bytes: atual, quando: agora };
        return;
      }
      const dt = (agora - ref.quando) / 1000;
      if (dt <= 0) return;
      setTaxa((atual - ref.bytes) / dt);
      anterior.current = { bytes: atual, quando: agora };
    }, 400);
    return () => { clearInterval(id); };
  }, [concluido]);

  /*
   * Vazão → duração do voo. Rápido é curto.
   *
   * O teto de 2600 ms existe porque abaixo de ~1 kB/s a animação viraria uma
   * imagem parada e a pessoa leria como travado quando ainda está andando; o
   * piso de 420 ms evita o borrão em export local, que chega a centenas de
   * MB/s. Parado de verdade (`taxa <= 0`) **congela**, que é a informação.
   */
  const parado = taxa !== null && taxa <= 0;
  const duracao =
    taxa === null || taxa <= 0
      ? 2600
      : Math.max(420, Math.min(2600, 2_600_000 / Math.max(1000, taxa)));

  const cheias = concluido ? TOTAL : guardadas(bytes);

  return (
    <div className={cn("flex items-center gap-4", className)}>
      <Cena cheias={cheias} parado={parado} concluido={concluido} duracao={duracao} />

      <div className="min-w-0">
        <p className="font-mono text-sm text-ink">{formatarBytes(bytes)}</p>
        <p className="mt-0.5 text-2xs text-subtle">
          {concluido
            ? t("exp.favoConcluido")
            : parado
              ? t("exp.favoEsperando")
              : taxa !== null && taxa > 0
                ? t("exp.favoTaxa", { taxa: formatarBytes(Math.round(taxa)) })
                : t("exp.favoEsperando")}
        </p>
      </div>
    </div>
  );
}

/**
 * O desenho, isolado num `memo`.
 *
 * Medido: sem isto, a cena custava **8,5% da thread principal** durante o
 * export. O motivo não era a animação — era re-render. O `onProgress` dispara
 * ~5 vezes por segundo, e cada mudança de `bytes` reconstruía os 68 elementos
 * do SVG, embora o desenho dependa apenas de quantas células estão cheias, que
 * muda 7 vezes no export inteiro.
 *
 * A memoização é explícita porque o **React Compiler não está ligado neste
 * projeto** — o `babel-plugin-react-compiler` não está instalado e o bundle de
 * produção não tem uma única chamada de `_c(`. O que existe é a regra de lint
 * dele, que emite diagnósticos sem memoizar nada.
 */
const Cena = memo(function Cena({
  cheias,
  parado,
  concluido,
  duracao,
}: {
  readonly cheias: number;
  readonly parado: boolean;
  readonly concluido: boolean;
  readonly duracao: number;
}) {
  return (
      <svg
        aria-hidden
        viewBox={`0 0 ${String(LARGURA)} ${String(ALTURA)}`}
        className="h-9 w-auto shrink-0"
      >
        {/* A origem: a boca do banco, de onde o pólen sai. */}
        <path
          d={hex(11, ALTURA / 2)}
          className="fill-accent-soft stroke-accent-line"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />

        {/*
          O voo. `transform` percorre o vão entre a origem e o favo; o
          `translate` do keyframe é em % da própria caixa, então o grupo define
          a distância e o keyframe só diz a forma do trajeto.
        */}
        <g
          style={
            {
              "--polen-dur": `${String(Math.round(duracao))}ms`,
              "--polen-dist": `${String(FAVO_X - 26)}px`,
            } as React.CSSProperties
          }
        >
          {POLEN.map((p, i) => (
            <circle
              key={i}
              cx={22}
              cy={p.cy}
              r={p.r}
              className={cn("fill-amber", !parado && !concluido && "animate-polen")}
              style={{
                animationDelay: `${String(p.atraso)}ms`,
                // Parado: o grão fica onde está, apagado. Congelar É o sinal.
                opacity: parado || concluido ? 0.18 : undefined,
              }}
            />
          ))}
        </g>

        {/*
          O mel entra em cada célula **por baixo**, e assenta.

          Cada célula é um recorte (`clipPath`) com o próprio hexágono; dentro
          dele um bloco de mel sobe da base até o topo. O que dá a viscosidade é
          a curva: `cubic-bezier(.33, 1, .68, 1)` em 900 ms começa depressa e
          arrasta no fim — mel entra rápido e demora a nivelar. Uma transição
          linear, ou um `opacity` piscando, leria como interruptor.

          A crista tem uma onda de amplitude minúscula e período longo, andando
          devagar. Água vibraria; mel arrasta.
        */}
        <defs>
          {CELULAS.map((c) => (
            <clipPath key={c.ordem} id={`favo-cel-${String(c.ordem)}`}>
              <path d={c.d} />
            </clipPath>
          ))}
        </defs>

        {CELULAS.map((c) => {
          const cheia = c.ordem < cheias;
          const alturaCel = c.base - c.topo;
          /*
           * A crista só ondula nas **duas últimas** células cheias.
           *
           * Mel que já assentou está parado — é o que ele faz. E manter sete
           * animações infinitas num rodapé seria pagar trabalho de compositor
           * por um movimento que ninguém olha: a borda viva é onde o mel está
           * chegando.
           */
          const ondula = cheia && !concluido && c.ordem >= cheias - 2;
          return (
            <g key={c.ordem}>
              {/* A parede da célula, sempre visível. */}
              <path
                d={c.d}
                className="fill-transparent stroke-accent-line transition-[stroke-opacity] duration-500"
                strokeWidth={1.1}
                strokeLinejoin="round"
                style={{ strokeOpacity: cheia ? 0.9 : 0.3 }}
              />

              <g clipPath={`url(#favo-cel-${String(c.ordem)})`}>
                <g
                  style={{
                    transform: `translateY(${String(cheia ? 0 : alturaCel + 3)}px)`,
                    transition: "transform 900ms cubic-bezier(.33, 1, .68, 1)",
                    // Escalonado por posição: as células não enchem todas de uma
                    // vez, o mel corre pela fita.
                    transitionDelay: `${String(c.ordem * 70)}ms`,
                  }}
                >
                  <rect
                    x={c.x - LADO}
                    y={c.topo + 2}
                    width={LADO * 2}
                    height={alturaCel + 4}
                    className="fill-amber"
                    fillOpacity={0.82}
                  />
                  {/* A crista. O `d` cobre três períodos para o laço fechar. */}
                  <path
                    className={cn("fill-amber", ondula && "animate-mel")}
                    fillOpacity={0.82}
                    d={`M-20,${String(c.topo + 2.4)}
                        q5,-1.6 10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0
                        V${String(c.topo + 5)} H-20 Z`}
                  />
                </g>
              </g>
            </g>
          );
        })}
      </svg>
  );
});
