import type { Connection, TestConnectionResult } from "@dbee/shared";
import { Pencil, Plug, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "../../lib/cn";

/**
 * Menu de contexto do nó de conexão.
 *
 * Editar, testar e excluir saíram da linha de lista e vieram para cá: numa
 * árvore, botão por linha compete com o alvo de clique que importa, que é
 * expandir o nó.
 */
export function ConnectionMenu({
  connection,
  anchor,
  testing,
  result,
  onClose,
  onEdit,
  onTest,
  onDelete,
}: {
  readonly connection: Connection;
  readonly anchor: DOMRect;
  readonly testing: boolean;
  readonly result: TestConnectionResult | undefined;
  readonly onClose: () => void;
  readonly onEdit: () => void;
  readonly onTest: () => void;
  readonly onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fora = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };

    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const item = "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition-colors duration-150";

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Ações de ${connection.name}`}
      style={{ top: anchor.bottom + 4, left: Math.max(8, anchor.left - 150) }}
      className="fixed z-50 w-52 overflow-hidden rounded-[6px] border border-line bg-overlay py-1 shadow-[0_8px_24px_rgba(0,0,0,.5)]"
    >
      <p className="truncate px-3 pb-1 pt-0.5 text-2xs text-subtle">{connection.name}</p>

      <button type="button" role="menuitem" onClick={onTest} className={cn(item, "text-ink hover:bg-raised")}>
        <Plug aria-hidden className="h-3.5 w-3.5 text-muted" />
        {testing ? "Testando…" : "Testar conexão"}
      </button>

      <button type="button" role="menuitem" onClick={onEdit} className={cn(item, "text-ink hover:bg-raised")}>
        <Pencil aria-hidden className="h-3.5 w-3.5 text-muted" />
        Editar
      </button>

      <button type="button" role="menuitem" onClick={onDelete} className={cn(item, "text-danger hover:bg-danger/10")}>
        <Trash2 aria-hidden className="h-3.5 w-3.5" />
        Excluir
      </button>

      {result !== undefined && !testing ? (
        <p
          className={cn(
            "mt-1 border-t border-line px-3 pb-0.5 pt-1.5 text-2xs",
            result.ok ? "text-ok" : "text-danger",
          )}
        >
          {result.ok ? `Conectou em ${result.durationMs} ms` : result.message}
        </p>
      ) : null}
    </div>
  );
}
