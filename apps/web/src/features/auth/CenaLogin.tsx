import { useEffect, useRef } from "react";

import { AbelhaPlana } from "../mascote";

/**
 * A cena da tela de entrada: "Consulta em favo" (docs/arte-login.md).
 *
 * Um diagrama de caderno de engenharia que se desenha sozinho: uma consulta
 * real é digitada, o rastro dela desce, o favo é traçado e as células acendem
 * linha a linha, como o resultado chegando. A abelha leva a consulta pelo
 * rastro e pousa na última linha. Termina na saída do psql, `(4 rows)`.
 *
 * Três planos (fundo: cotas; meio: favo; frente: consulta, rastro, abelha),
 * com paralaxe leve só em ponteiro fino. Âmbar só na abelha (marca); o rastro
 * é `info`, a "fumaça" (identidade.md).
 *
 * CSS em `index.css`, bloco "Cena do login". O estado SEM animação é o quadro
 * final composto, que é o que reduced-motion vê. A animação para quando a aba
 * não está visível (`data-pausada`).
 */

const R = 30; // raio do hexágono (vértice em cima)
const W = R * Math.sqrt(3);
const COLS = 4;
const LINHAS = 5; // 1 cabeçalho + 4 linhas de resultado
const X0 = 150;
const Y0 = 200;
const CABECALHO = ["id", "nome", "mel", "kg"];

const DADOS = [
  ["1", "jataí", "sim", "4.2"],
  ["2", "uruçu", "sim", "7.9"],
  ["3", "iraí", "não", "0.0"],
  ["4", "mirim", "sim", "1.6"],
];

function hexagono(cx: number, cy: number, r = R): string {
  const p: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    p.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${p.join("L")}Z`;
}

const celulas = Array.from({ length: LINHAS * COLS }, (_, k) => {
  const l = Math.floor(k / COLS);
  const c = k % COLS;
  return { l, c, cx: X0 + c * W + (l % 2) * (W / 2), cy: Y0 + l * R * 1.5 };
});

/** Rastro: do cursor da consulta, contornando o favo, até a última célula. */
const RASTRO = "M262,78 C352,74 432,128 426,214 C420,300 392,350 366,392";

export function CenaLogin({ compacta = false }: { readonly compacta?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (svg === null) return;
    const vis = () => {
      svg.dataset["pausada"] = document.hidden ? "1" : "0";
    };
    vis();
    document.addEventListener("visibilitychange", vis);

    // Paralaxe: só ponteiro fino e sem reduced-motion. Um rAF por movimento.
    const pode =
      !compacta &&
      matchMedia("(pointer: fine)").matches &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
    let quadro = 0;
    let px = 0;
    let py = 0;
    const mover = (e: PointerEvent) => {
      px = (e.clientX / innerWidth) * 2 - 1;
      py = (e.clientY / innerHeight) * 2 - 1;
      if (quadro !== 0) return;
      quadro = requestAnimationFrame(() => {
        quadro = 0;
        svg.style.setProperty("--px", px.toFixed(3));
        svg.style.setProperty("--py", py.toFixed(3));
      });
    };
    if (pode) addEventListener("pointermove", mover, { passive: true });
    return () => {
      document.removeEventListener("visibilitychange", vis);
      removeEventListener("pointermove", mover);
      cancelAnimationFrame(quadro);
    };
  }, [compacta]);

  return (
    <svg
      ref={ref}
      viewBox={compacta ? "24 46 440 190" : "16 36 448 456"}
      aria-hidden
      focusable="false"
      className="cena-login h-full w-full"
      preserveAspectRatio={compacta ? "xMidYMid meet" : "xMidYMid meet"}
    >
      {/* Plano de fundo: cotas de desenho técnico. */}
      <g className="cena-plano cena-plano-fundo" fill="none" strokeWidth="1">
        <path d="M40,124 H452" pathLength={1} className="cena-traco stroke-line" style={{ animationDelay: "0s" }} />
        <path d="M104,140 V430" pathLength={1} className="cena-traco stroke-line" style={{ animationDelay: "0.1s" }} />
        {/* Cota da altura do resultado. */}
        <g className="cena-surge stroke-line-strong" style={{ animationDelay: "0.4s" }}>
          <path d="M96,245 H112 M96,416 H112 M104,250 V411" />
        </g>
        <text x="92" y="334" className="cena-surge fill-subtle font-mono" fontSize="10" textAnchor="end" style={{ animationDelay: "0.5s" }}>
          4
        </text>
      </g>

      {/* Plano do meio: o favo-tabela. */}
      <g className="cena-plano cena-plano-meio">
        {celulas.map(({ l, c, cx, cy }) => {
          const d = hexagono(cx, cy);
          const atraso = 1.15 + (l * COLS + c) * 0.035;
          return (
            <g key={`${String(l)}-${String(c)}`}>
              <path
                d={d}
                pathLength={1}
                className={l === 0 ? "cena-hex fill-raised stroke-line-strong" : "cena-hex fill-surface stroke-line-strong"}
                strokeWidth="1.25"
                style={{ animationDelay: `${atraso.toFixed(2)}s` }}
              />
              {l === 0 ? (
                <text
                  x={cx}
                  y={cy + 4}
                  textAnchor="middle"
                  className="cena-surge fill-muted font-mono"
                  fontSize="11"
                  style={{ animationDelay: `${(1.5 + c * 0.05).toFixed(2)}s` }}
                >
                  {CABECALHO[c]}
                </text>
              ) : (
                <>
                  <path
                    d={hexagono(cx, cy, R - 5)}
                    className="cena-mel fill-ink"
                    style={{
                      animationDelay: `${(1.75 + (l - 1) * 0.16 + c * 0.04).toFixed(2)}s, ${(2.6 + ((l + c * 3) % 9) * 1.1).toFixed(2)}s`,
                    }}
                  />
                  <text
                    x={cx}
                    y={cy + 4}
                    textAnchor="middle"
                    className="cena-surge fill-ink font-mono"
                    fontSize="11"
                    style={{ animationDelay: `${(1.8 + (l - 1) * 0.16 + c * 0.04).toFixed(2)}s` }}
                  >
                    {DADOS[l - 1]?.[c]}
                  </text>
                </>
              )}
            </g>
          );
        })}
        <text x={X0 - R} y="470" className="cena-surge fill-subtle font-mono" fontSize="12" style={{ animationDelay: "2.3s" }}>
          (4 rows)
        </text>
      </g>

      {/* Plano da frente: a consulta, o rastro e a abelha. */}
      <g className="cena-plano cena-plano-frente">
        <clipPath id="cena-digitando">
          <rect x="40" y="60" width="228" height="28" className="cena-digita" />
        </clipPath>
        <text x="40" y="82" className="fill-ink font-mono" fontSize="17" clipPath="url(#cena-digitando)">
          <tspan className="fill-info">select</tspan> * <tspan className="fill-info">from</tspan> favo;
        </text>
        <rect x="254" y="66" width="2" height="20" className="cena-cursor fill-ink" />

        <path d={RASTRO} pathLength={1} fill="none" className="cena-rastro-base stroke-line" strokeWidth="1" />
        <path
          d={RASTRO}
          fill="none"
          className="cena-rastro stroke-info"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeDasharray="1 7"
        />

        <g className="cena-abelha" style={{ offsetPath: `path("${RASTRO}")` }}>
          <g className="cena-abelha-paira">
            <g transform="translate(-30 -40)">
              <AbelhaPlana pose="voando" animada tamanho={60} className="overflow-visible" />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
