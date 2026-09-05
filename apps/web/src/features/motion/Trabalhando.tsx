import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { Mascote } from "../mascote";

/**
 * O estado "está acontecendo" do app inteiro.
 *
 * A cena é o **mascote carregando**, flutuando (`float`) — o mesmo personagem
 * do resto do sistema, vivo. WebP de ~30 KB, baixado só quando aparece.
 *
 * ## O contador não é enfeite
 *
 * Consulta contra banco de cliente pode levar dezenas de segundos, e o
 * `statement_timeout` padrão é 30 s. Quem conhece a tabela sabe se 8 s são
 * normais; sem o número, "está rodando" e "travou" têm a mesma aparência.
 */

/**
 * Tempo desde a montagem, em passos de 100 ms.
 *
 * O relógio é lido **dentro do efeito**, nunca no corpo do render:
 * `performance.now()` é impuro, e chamá-lo durante a renderização daria um
 * valor diferente a cada passada do StrictMode. E não há `setMs(0)` inicial —
 * o componente só existe enquanto a espera dura, então montar já é o começo.
 */
function useDecorrido(ativo: boolean): number {
  const inicio = useRef<number | null>(null);
  const [ms, setMs] = useState(0);

  useEffect(() => {
    if (!ativo) return;
    inicio.current = performance.now();
    const id = setInterval(() => {
      setMs(performance.now() - (inicio.current ?? performance.now()));
    }, 100);
    return () => { clearInterval(id); };
  }, [ativo]);

  return ms;
}

const formatar = (ms: number): string =>
  ms < 1000
    ? `${String(Math.round(ms / 100) * 100)} ms`
    : `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;

export interface TrabalhandoProps {
  /** O que está acontecendo, em voz ativa: "Executando a consulta". */
  readonly rotulo: string;
  /** Mostra o tempo decorrido. Ligue onde a espera pode ser longa. */
  readonly cronometro?: boolean;
  readonly className?: string;
}

export function Trabalhando({ rotulo, cronometro = false, className }: TrabalhandoProps) {
  const ms = useDecorrido(cronometro);

  return (
    <div
      className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center", className)}
      // `polite` e não `assertive`: o aviso não interrompe quem está lendo
      // outra coisa. `busy` diz ao leitor de tela que a região vai mudar.
      role="status"
      aria-busy
    >
      <Mascote humor="carregando" float className="h-24 w-24" />

      <p className="text-xs text-muted">
        {rotulo}
        {cronometro ? (
          <>
            {" · "}
            <span className="font-mono tabular-nums text-subtle">{formatar(ms)}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Versão de uma linha, para caber numa barra de ferramentas ou num rodapé —
 * onde um bloco centralizado empurraria o layout.
 */
export function TrabalhandoInline({ rotulo }: { readonly rotulo: string }) {
  return (
    <span className="flex items-center gap-2 text-2xs text-muted" role="status" aria-busy>
      <Mascote humor="carregando" float className="h-5 w-5" />
      {rotulo}
    </span>
  );
}
