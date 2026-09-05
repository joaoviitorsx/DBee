import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
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
        <App />
      </IdiomaProvider>
    </QueryClientProvider>
  </StrictMode>,
);
