import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { FronteiraDeErro } from "./components/FronteiraDeErro";
import { IdiomaProvider } from "./i18n";
import { aplicarIdiomaGuardado } from "./lib/idioma";
import { queryClient } from "./lib/query";
import { aplicarTemaGuardado } from "./lib/theme";
import "./index.css";

const root = document.getElementById("root");
if (root === null) throw new Error("#root não encontrado no index.html");

/*
 * Aplica o tema **antes** de o React montar. Depois seria tarde: a primeira
 * pintura sairia escura e piscaria branco para quem escolheu claro.
 */
aplicarTemaGuardado();
aplicarIdiomaGuardado();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <IdiomaProvider>
        {/*
          A fronteira fica DENTRO do `IdiomaProvider`, não fora.

          A tela de recuperação usa `useT` para falar o idioma da pessoa, e uma
          fronteira acima do provedor renderizaria um fallback que quebra ao
          montar — erro dentro do fallback sobe para a fronteira de cima, que
          aqui não existe: tela branca de novo, agora por causa da rede de
          segurança. O que sobra descoberto é o próprio provedor, e para ele
          não há rede possível sem duplicar as strings fora do dicionário.
        */}
        <FronteiraDeErro variante="tela">
          <App />
        </FronteiraDeErro>
      </IdiomaProvider>
    </QueryClientProvider>
  </StrictMode>,
);
