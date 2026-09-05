import type { Connection, TestConnectionResult } from "@dbee/shared";
import { useState } from "react";

import { AppShell } from "./app/AppShell";
import type { ConnectionHealth } from "./features/tree/ConnectionTree";
import { ConnectionForm } from "./routes/connections/ConnectionForm";
import { ConnectionMenu } from "./routes/connections/ConnectionMenu";
import { useConnections } from "./routes/connections/useConnections";

type Painel =
  | { readonly open: false }
  | { readonly open: true; readonly editing: Connection | null };

type Menu = { readonly connection: Connection; readonly anchor: DOMRect } | null;

const healthOf = (r: TestConnectionResult | undefined): ConnectionHealth =>
  r === undefined ? "untested" : r.ok ? "ok" : "error";

export function App() {
  const { query, save, remove, test, results } = useConnections();
  const [painel, setPainel] = useState<Painel>({ open: false });
  const [menu, setMenu] = useState<Menu>(null);

  const connections = query.data ?? [];
  const health = Object.fromEntries(
    connections.map((c) => [c.id, healthOf(results[c.id])]),
  ) as Record<string, ConnectionHealth>;

  return (
    <>
      <AppShell
        connections={connections}
        health={health}
        onNewConnection={() => { setPainel({ open: true, editing: null }); }}
        onConnectionMenu={(connection, anchor) => { setMenu({ connection, anchor }); }}
      />

      {menu !== null ? (
        <ConnectionMenu
          connection={menu.connection}
          anchor={menu.anchor}
          testing={test.isPending && test.variables === menu.connection.id}
          result={results[menu.connection.id]}
          onClose={() => { setMenu(null); }}
          onEdit={() => {
            setPainel({ open: true, editing: menu.connection });
            setMenu(null);
          }}
          onTest={() => { test.mutate(menu.connection.id); }}
          onDelete={() => {
            remove.mutate(menu.connection.id);
            setMenu(null);
          }}
        />
      ) : null}

      <ConnectionForm
        key={painel.open ? (painel.editing?.id ?? "nova") : "fechado"}
        open={painel.open}
        editing={painel.open ? painel.editing : null}
        saving={save.isPending}
        error={save.error?.message ?? null}
        onOpenChange={(open) => { if (!open) setPainel({ open: false }); }}
        onSubmit={(draft) => {
          save.mutate(
            { draft, editing: painel.open ? painel.editing : null },
            { onSuccess: () => { setPainel({ open: false }); } },
          );
        }}
      />
    </>
  );
}
