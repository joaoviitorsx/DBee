import type { Connection, TestConnectionResult } from "@dbee/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AppShell } from "./app/AppShell";
import type { ConnectionHealth } from "./features/tree/ConnectionTree";
import { schemaKey } from "./features/tree/useTree";
import { ConnectionForm } from "./routes/connections/ConnectionForm";
import { useConnections } from "./routes/connections/useConnections";

type Painel =
  | { readonly open: false }
  | { readonly open: true; readonly editing: Connection | null };

const healthOf = (r: TestConnectionResult | undefined): ConnectionHealth =>
  r === undefined ? "untested" : r.ok ? "ok" : "error";

export function App() {
  const queryClient = useQueryClient();
  const { query, save, remove, test, results } = useConnections();
  const [painel, setPainel] = useState<Painel>({ open: false });

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
        onRefreshSchema={(connectionId, database) => {
          void queryClient.invalidateQueries({ queryKey: schemaKey(connectionId, database) });
        }}
        connectionActions={(connection) => ({
          testing: test.isPending && test.variables === connection.id,
          onTestConnection: () => { test.mutate(connection.id); },
          onEditConnection: () => { setPainel({ open: true, editing: connection }); },
          onDeleteConnection: () => { remove.mutate(connection.id); },
        })}
      />

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
