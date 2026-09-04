import type { Connection } from "@dbee/shared";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui";
import { ConnectionForm } from "./ConnectionForm";
import { ConnectionRow } from "./ConnectionRow";
import { ConnectionsEmpty } from "./ConnectionsEmpty";
import { ConnectionsSkeleton } from "./ConnectionsSkeleton";
import { useConnections } from "./useConnections";

type Panel = { readonly open: false } | { readonly open: true; readonly editing: Connection | null };

/** Apresentação e estado de interface. Os dados vêm do useConnections. */
export function ConnectionsPage() {
  const { query, save, remove, test, results } = useConnections();
  const [panel, setPanel] = useState<Panel>({ open: false });

  const items = query.data ?? [];
  const openNew = (): void => { setPanel({ open: true, editing: null }); };

  return (
    <>
      <header className="flex items-end justify-between border-b border-line px-8 py-6">
        <div>
          <h1 className="text-xl text-ink">Conexões</h1>
          <p className="mt-1 text-xs text-muted">
            {items.length === 0
              ? "Nenhuma conexão cadastrada"
              : `${items.length} ${items.length === 1 ? "conexão" : "conexões"}`}
          </p>
        </div>
        <Button variant="primary" onClick={openNew}>
          <Plus aria-hidden className="h-4 w-4" />
          Nova conexão
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {query.isPending ? (
          <ConnectionsSkeleton />
        ) : query.isError ? (
          <div className="px-4 py-8">
            <p className="text-sm text-danger">Não foi possível carregar as conexões.</p>
            <Button className="mt-3" size="sm" onClick={() => void query.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : items.length === 0 ? (
          <ConnectionsEmpty onCreate={openNew} />
        ) : (
          // Divisórias como os cortes da marca: o fundo passa através da linha.
          <ul className="divide-y divide-line">
            {items.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                result={results[connection.id]}
                testing={test.isPending && test.variables === connection.id}
                onTest={() => { test.mutate(connection.id); }}
                onEdit={() => { setPanel({ open: true, editing: connection }); }}
                onDelete={() => { remove.mutate(connection.id); }}
              />
            ))}
          </ul>
        )}
      </div>

      <ConnectionForm
        key={panel.open ? (panel.editing?.id ?? "nova") : "fechado"}
        open={panel.open}
        editing={panel.open ? panel.editing : null}
        saving={save.isPending}
        error={save.error?.message ?? null}
        onOpenChange={(open) => { if (!open) setPanel({ open: false }); }}
        onSubmit={(draft) => {
          save.mutate(
            { draft, editing: panel.open ? panel.editing : null },
            { onSuccess: () => { setPanel({ open: false }); } },
          );
        }}
      />
    </>
  );
}
