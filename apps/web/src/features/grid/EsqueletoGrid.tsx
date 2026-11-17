import { useEffect, useState } from "react";

import { Skeleton } from "../../components/ui/Skeleton";
import { type FaseCarregamento, faseDe, LIMIAR_ESQUELETO_MS, LIMIAR_TRABALHANDO_MS } from "./carregamento.puro";

/**
 * Fase de carregamento de algo pendente (ui-detalhes §3.7). Dois timers, não
 * um intervalo: a fase só muda duas vezes, e re-render por tique seria custo
 * sem mudança visível.
 */
export function useFaseCarregamento(pendente: boolean): FaseCarregamento {
  const [fase, setFase] = useState<FaseCarregamento>("nada");
  const [anterior, setAnterior] = useState(pendente);
  if (pendente !== anterior) {
    setAnterior(pendente);
    setFase("nada");
  }
  useEffect(() => {
    if (!pendente) return;
    const t0 = performance.now();
    const marcar = (): void => { setFase(faseDe(performance.now() - t0)); };
    const a = setTimeout(marcar, LIMIAR_ESQUELETO_MS);
    const b = setTimeout(marcar, LIMIAR_TRABALHANDO_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [pendente]);
  return fase;
}

/** Larguras fixas por coluna: variar a forma lê como dado, igual não lê. */
const LARGURAS = [72, 160, 200, 120, 180, 140];
const LINHAS = 14;

/**
 * Esqueleto com a forma do grid (§3.7): cabeçalho de duas linhas e linhas de
 * 26 px, as mesmas medidas do `ResultGrid`, para a troca não pular (CLS).
 * Número fixo de linhas — não é dado de resultado (regra 11 não se aplica).
 */
export function EsqueletoGrid() {
  return (
    <div aria-hidden className="motion-fade flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 border-b border-line bg-surface">
        {LARGURAS.map((w, i) => (
          <div key={i} className="shrink-0 space-y-1 border-r border-line px-3 py-1.5" style={{ width: w + 24 }}>
            <Skeleton className="h-3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        ))}
      </div>
      {Array.from({ length: LINHAS }, (_, l) => (
        <div key={l} className="flex h-[26px] shrink-0 items-center border-b border-line/40">
          {LARGURAS.map((w, i) => (
            <div key={i} className="shrink-0 px-3" style={{ width: w + 24 }}>
              <Skeleton className="h-2.5" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
