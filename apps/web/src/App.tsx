import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { Database } from "lucide-react";

import { Mark } from "./components/Mark";
import { ConnectionsPage } from "./routes/connections/ConnectionsPage";

export function App() {
  // A marca voa enquanto o app está de fato ocupado — buscando ou testando.
  // Parada, ela fica parada: movimento contínuo sem causa vira ruído.
  //
  // Hooks globais do TanStack Query, não outra instância de useConnections:
  // estado de useMutation é por instância e não seria compartilhado.
  const busy = useIsFetching() + useIsMutating() > 0;

  return (
    <div className="flex h-dvh">
      <nav className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <Mark flying={busy} className="h-6 w-6 text-amber" />
          <span className="text-base font-semibold tracking-[-0.025em] text-ink">DBee</span>
        </div>

        <div className="flex-1 px-3">
          <a
            href="#conexoes"
            aria-current="page"
            className="flex items-center gap-2.5 rounded-[6px] bg-raised px-3 py-2 text-sm font-medium text-ink"
          >
            <Database aria-hidden className="h-4 w-4 text-amber" />
            Conexões
          </a>
        </div>

        <footer className="px-5 py-4 text-2xs text-subtle">v{__APP_VERSION__}</footer>
      </nav>

      <main id="conexoes" className="flex min-w-0 flex-1 flex-col">
        <ConnectionsPage />
      </main>
    </div>
  );
}
