import type { Connection, ConnectionWarning, TestConnectionResult } from "@dbee/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AppShell } from "./app/AppShell";
import { AuthGate } from "./features/auth/AuthGate";
import type { ConnectionHealth } from "./features/tree/ConnectionTree";
import { schemaKey } from "./features/tree/useTree";
import { ConnectionForm } from "./routes/connections/ConnectionForm";
import { useConnections } from "./routes/connections/useConnections";

type Painel =
  | { readonly open: false }
  | { readonly open: true; readonly editing: Connection | null };

const healthOf = (r: TestConnectionResult | undefined): ConnectionHealth =>
  r === undefined ? "untested" : r.ok ? "ok" : "error";

/**
 * O portão, e **nada mais**.
 *
 * Todo hook de dados vive em `Area`, dentro dele. Fora, eles montavam antes de
 * existir sessão: `useConnections` disparava no primeiro render, tomava 401,
 * cacheava o erro — e como o login não invalida a consulta de conexões, a
 * árvore ficava vazia depois de entrar, com a API respondendo certo. Levou dois
 * screenshots para eu parar de tratar isso como corrida do roteiro de captura.
 */
export function App() {
  return (
    <AuthGate>
      <Area />
    </AuthGate>
  );
}

function Area() {
  const queryClient = useQueryClient();
  const { query, save, remove, test, results } = useConnections();
  const [painel, setPainel] = useState<Painel>({ open: false });

  const connections = query.data ?? [];
  const health = Object.fromEntries(
    connections.map((c) => [c.id, healthOf(results[c.id])]),
  ) as Record<string, ConnectionHealth>;

  // Avisos do último teste, por conexão. Hoje só o de papel privilegiado
  // (COPY … TO PROGRAM fura o read-only): é aviso de segurança, tem de ser
  // visível na árvore, não só num toast que some.
  const warnings = Object.fromEntries(
    connections.map((c) => {
      const r = results[c.id];
      return [c.id, r?.ok === true ? r.warnings : []];
    }),
  ) as Record<string, readonly ConnectionWarning[]>;

  return (
    <>
      <AppShell
        connections={connections}
        health={health}
        warnings={warnings}
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
