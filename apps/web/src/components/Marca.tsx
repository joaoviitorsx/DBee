import { useEffect, useState } from "react";

import marca from "../assets/marca.webp";
import { cn } from "../lib/cn";
import { EVENTO_ZUMBIDO } from "../lib/zumbido";

/**
 * A marca DBee — a abelha cujo corpo é um cilindro de banco de dados.
 *
 * O render da logo, usado no cabeçalho, para a marca ser uma só em todo lugar.
 *
 * `voando` faz a marca flutuar enquanto algo acontece. `zumbe` liga a escuta
 * de escrita confirmada (`lib/zumbido`): a marca treme ±1 px uma vez. Só a do
 * cabeçalho liga isso. Decorativa por padrão; o texto ao lado carrega o
 * significado.
 */
export function Marca({
  className,
  voando = false,
  apagada = false,
  zumbe = false,
}: {
  readonly className?: string;
  readonly voando?: boolean;
  /** Versão dessaturada, para o estado vazio onde ela é só um marcador. */
  readonly apagada?: boolean;
  readonly zumbe?: boolean;
}) {
  // Contador e não booleano: duas escritas seguidas reiniciam a animação
  // (a `key` muda), em vez de a segunda cair no meio da primeira e sumir.
  const [zumbido, setZumbido] = useState(0);

  useEffect(() => {
    if (!zumbe) return;
    const ouvir = (): void => { setZumbido((n) => n + 1); };
    window.addEventListener(EVENTO_ZUMBIDO, ouvir);
    return () => { window.removeEventListener(EVENTO_ZUMBIDO, ouvir); };
  }, [zumbe]);

  return (
    <img
      key={zumbido}
      src={marca}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        "select-none object-contain",
        voando && "animate-float",
        zumbido > 0 && "animate-zumbido",
        apagada && "opacity-40 grayscale",
        className,
      )}
    />
  );
}
