import { cn } from "../../lib/cn";
import { MASCOTE, type Humor } from "./mascote";

/**
 * O mascote DBee, animado.
 *
 * `float` faz o bicho flutuar suave — vivo, não colado. É opt-in: numa lista ou
 * num canto pequeno o mascote fica parado; nas telas onde ele é o assunto
 * (login, sucesso, servidor mudo) ele flutua. `pop` é a entrada de comemoração,
 * usada uma vez quando o humor é de sucesso.
 *
 * Decorativo por padrão (`aria-hidden`): quem carrega o significado é o texto
 * ao lado. Passe `alt` só quando o mascote **for** a informação e não houver
 * texto que a diga.
 */
export function Mascote({
  humor,
  className,
  float = false,
  pop = false,
  alt,
}: {
  readonly humor: Humor;
  readonly className?: string;
  readonly float?: boolean;
  readonly pop?: boolean;
  readonly alt?: string;
}) {
  return (
    <img
      src={MASCOTE[humor]}
      alt={alt ?? ""}
      aria-hidden={alt === undefined}
      draggable={false}
      className={cn(
        "select-none object-contain",
        // O bloco global de reduced-motion no CSS já zera as duas.
        float && "animate-float",
        pop && "animate-pop",
        className,
      )}
    />
  );
}
