import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "../lib/cn";
import { ComSaida } from "./ComSaida";

/**
 * Popover ancorado num retângulo (célula, cabeçalho). Abre abaixo; se não
 * couber, acima; a origem do pop fica no lado da âncora. Clique fora fecha.
 * Entrada e saída simétricas por `ComSaida` + `motion-popover`.
 */
export function PopoverAncorado({
  aberto,
  ancora,
  onFora,
  rotulo,
  children,
  className,
}: {
  readonly aberto: boolean;
  readonly ancora: DOMRect;
  readonly onFora: () => void;
  readonly rotulo: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; acima: boolean }>({ x: ancora.left, y: ancora.bottom + 4, acima: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const { width, height } = el.getBoundingClientRect();
    const acima = ancora.bottom + 4 + height > window.innerHeight - 8 && ancora.top - 4 - height > 8;
    setPos({
      x: Math.max(8, Math.min(ancora.left, window.innerWidth - width - 8)),
      y: acima ? ancora.top - 4 - height : Math.min(ancora.bottom + 4, window.innerHeight - height - 8),
      acima,
    });
  }, [ancora]);
  useEffect(() => {
    const fora = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onFora();
    };
    document.addEventListener("mousedown", fora);
    return () => { document.removeEventListener("mousedown", fora); };
  }, [onFora]);
  return (
    <ComSaida
      aberto={aberto}
      role="dialog"
      aria-label={rotulo}
      // A origem do pop fica no lado da célula: cresce a partir dela.
      style={{ top: pos.y, left: pos.x, transformOrigin: pos.acima ? "left bottom" : "left top" }}
      className={cn("motion-popover fixed z-50 flex max-h-[360px] w-[min(30rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-[6px] border border-line bg-overlay shadow-[0_8px_24px_-12px_rgb(0_0_0/.5)]", className)}
    >
      <div ref={ref} className="flex min-h-0 flex-1 flex-col">{children}</div>
    </ComSaida>
  );
}

