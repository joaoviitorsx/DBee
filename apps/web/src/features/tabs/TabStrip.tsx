import type { Connection } from "@dbee/shared";
import { Code2, Eye, Layers, Plus, Table2, X } from "lucide-react";

import { cn } from "../../lib/cn";
import { isDangerous, tabTitle, type Tab } from "../../app/workspace";

const ICON = {
  table: Table2,
  partitioned_table: Table2,
  foreign_table: Table2,
  view: Eye,
  materialized_view: Layers,
} as const;

/**
 * Barra de abas — tabela e query convivem na mesma faixa.
 *
 * A aba de query ainda não é criada por nenhum caminho; o tipo já é tratado
 * aqui para o executor entrar sem redesenhar a barra.
 *
 * Aba sobre conexão gravável herda a tarja de perigo: o alerta é da conexão,
 * não da árvore, então ele acompanha o usuário para onde ele for.
 */
export function TabStrip({
  tabs,
  activeTabId,
  connections,
  onFocus,
  onClose,
  onContextMenu,
  onNew,
}: {
  readonly tabs: readonly Tab[];
  readonly activeTabId: string | null;
  readonly connections: readonly Connection[];
  readonly onFocus: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onContextMenu: (id: string, anchor: { x: number; y: number }) => void;
  /** `undefined` quando não há alvo — sem conexão ativa não há onde consultar. */
  readonly onNew?: (() => void) | undefined;
}) {
  if (tabs.length === 0) return null;

  return (
    <div role="tablist" className="flex shrink-0 items-stretch overflow-x-auto border-b border-line bg-sunken">
      {tabs.map((tab) => {
        const ativa = tab.id === activeTabId;
        const perigo = isDangerous(tab, connections);
        const Icon = tab.kind === "table" ? ICON[tab.target.kind] : Code2;

        return (
          <div
            key={tab.id}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(tab.id, { x: e.clientX, y: e.clientY }); }}
            className={cn(
              "group/tab flex shrink-0 items-center gap-1.5 border-r border-line pl-3 pr-1.5 transition-colors duration-150",
              ativa ? "bg-surface" : "hover:bg-surface/60",
              // Tarja herdada: fina no topo, para não competir com o conteúdo.
              perigo && "border-t-2 border-t-danger",
              perigo && ativa && "bg-danger-surface",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => { onFocus(tab.id); }}
              className="flex cursor-pointer items-center gap-1.5 py-2"
            >
              <Icon
                aria-hidden
                className={cn("h-3.5 w-3.5", perigo ? "text-danger-ink" : "text-subtle")}
              />
              <span
                className={cn(
                  "max-w-[16rem] truncate font-mono text-xs",
                  ativa ? "text-ink" : "text-muted",
                )}
              >
                {tabTitle(tab)}
              </span>
            </button>
            <button
              type="button"
              aria-label={`Fechar ${tabTitle(tab)}`}
              onClick={() => { onClose(tab.id); }}
              className={cn(
                "cursor-pointer rounded p-0.5 text-subtle transition-opacity duration-150 hover:text-ink",
                ativa ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100",
              )}
            >
              <X aria-hidden className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      {onNew === undefined ? null : (
        <button
          type="button"
          onClick={onNew}
          aria-label="Nova consulta"
          title="Nova consulta (Cmd+T)"
          className="flex shrink-0 cursor-pointer items-center px-3 text-subtle transition-colors duration-150 hover:text-ink"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Sub-abas da aba de tabela. */
export function SubTabs({
  value,
  onChange,
  counts,
}: {
  readonly value: "data" | "structure" | "indexes";
  readonly onChange: (view: "data" | "structure" | "indexes") => void;
  readonly counts: { readonly columns: number; readonly indexes: number };
}) {
  const itens = [
    { id: "data", label: "Dados", badge: null },
    { id: "structure", label: "Estrutura", badge: counts.columns },
    { id: "indexes", label: "Índices", badge: counts.indexes },
  ] as const;

  return (
    <div role="tablist" className="flex shrink-0 items-center gap-1 border-b border-line px-3">
      {itens.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          onClick={() => { onChange(item.id); }}
          className={cn(
            "-mb-px cursor-pointer border-b-2 px-2 py-1.5 text-xs transition-colors duration-150",
            value === item.id
              ? "border-amber text-ink"
              : "border-transparent text-muted hover:text-ink",
          )}
        >
          {item.label}
          {item.badge !== null ? (
            <span className="ml-1.5 text-2xs text-subtle">{item.badge}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
