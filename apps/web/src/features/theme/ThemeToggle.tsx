import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../../components/ui";
import { alternar, aplicar, guardarTema, lerTema, type Tema } from "../../lib/theme";

/**
 * Alterna claro e escuro.
 *
 * Dois estados, um clique. O ícone mostra **para onde o clique leva**, não onde
 * se está: num botão binário, mostrar o estado atual faz a pessoa clicar no
 * ícone que já representa o que ela vê e se surpreender com o resultado.
 */
export function ThemeToggle() {
  const [tema, setTema] = useState<Tema>(() => lerTema());

  useEffect(() => {
    aplicar(tema);
  }, [tema]);

  const proximo = alternar(tema);
  const Icone = proximo === "light" ? Sun : Moon;
  const legenda = proximo === "light" ? "Mudar para o tema claro" : "Mudar para o tema escuro";

  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-7 w-7"
      title={legenda}
      aria-label={legenda}
      onClick={() => {
        setTema(proximo);
        guardarTema(proximo);
      }}
    >
      <Icone aria-hidden className="h-3.5 w-3.5" />
    </Button>
  );
}
