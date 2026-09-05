import marca from "../assets/marca.webp";
import { cn } from "../lib/cn";

/**
 * A marca DBee — a abelha cujo corpo é um cilindro de banco de dados.
 *
 * Substitui o antigo `Mark` desenhado à mão em SVG: a identidade agora é o
 * render da logo, usado no favicon, no cabeçalho, no carregamento e no estado
 * vazio, para a marca ser uma só em todo lugar.
 *
 * `voando` faz a marca flutuar enquanto algo acontece — o mesmo papel do antigo
 * `flying`, agora como float suave (o render não tem asas separáveis para bater).
 * Decorativa por padrão; o texto ao lado carrega o significado.
 */
export function Marca({
  className,
  voando = false,
  apagada = false,
}: {
  readonly className?: string;
  readonly voando?: boolean;
  /** Versão dessaturada, para o estado vazio onde ela é só um marcador. */
  readonly apagada?: boolean;
}) {
  return (
    <img
      src={marca}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        "select-none object-contain",
        voando && "animate-float",
        apagada && "opacity-40 grayscale",
        className,
      )}
    />
  );
}
