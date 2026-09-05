import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * Menu de contexto, acionado por botão direito ou pelo botão de ações.
 *
 * Genérico de propósito: árvore, abas e o que vier depois usam o mesmo, para o
 * vocabulário de interação ser um só. Um menu por lugar acaba divergindo em
 * espaçamento, ordem e comportamento de teclado.
 */

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  /** Ação destrutiva ganha tratamento visual próprio e fica por último. */
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface MenuSection {
  readonly items: readonly MenuItem[];
}

export interface MenuAnchor {
  readonly x: number;
  readonly y: number;
}

interface ContextMenuProps {
  readonly anchor: MenuAnchor;
  readonly title?: string;
  readonly sections: readonly MenuSection[];
  readonly footer?: ReactNode;
  readonly onClose: () => void;
}

export function ContextMenu({ anchor, title, sections, footer, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuAnchor>(anchor);
  const [focado, setFocado] = useState(0);

  const itens = sections.flatMap((s) => s.items).filter((i) => i.disabled !== true);

  /**
   * Reposiciona para caber na janela.
   *
   * Sem isto, clicar com o botão direito perto da borda direita ou de baixo
   * abre um menu cortado — e é justamente perto da borda que o usuário clica
   * quando a árvore está cheia.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(anchor.x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(anchor.y, window.innerHeight - height - 8)),
    });
  }, [anchor]);

  useEffect(() => {
    const fora = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onClose();
    };
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setFocado((i) => (i + 1) % itens.length); }
      if (e.key === "ArrowUp") { e.preventDefault(); setFocado((i) => (i - 1 + itens.length) % itens.length); }
      if (e.key === "Enter") { e.preventDefault(); itens[focado]?.onSelect(); onClose(); }
    };

    document.addEventListener("mousedown", fora);
    // `capture` para pegar antes de outro handler de contexto na página.
    document.addEventListener("contextmenu", fora, true);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("contextmenu", fora, true);
      document.removeEventListener("keydown", tecla);
    };
  }, [onClose, itens, focado]);

  let indice = -1;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={title ?? "Ações"}
      style={{ top: pos.y, left: pos.x }}
      className="fixed z-50 min-w-52 overflow-hidden rounded-[6px] border border-line bg-overlay py-1 shadow-[0_8px_24px_rgba(0,0,0,.5)]"
    >
      {title !== undefined ? (
        <p className="truncate px-3 pb-1 pt-0.5 text-2xs text-subtle">{title}</p>
      ) : null}

      {sections.map((section, s) => (
        <div key={s} className={cn(s > 0 && "mt-1 border-t border-line pt-1")}>
          {section.items.map((item) => {
            if (item.disabled !== true) indice++;
            const atual = indice;

            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onMouseEnter={() => { if (item.disabled !== true) setFocado(atual); }}
                onClick={() => { item.onSelect(); onClose(); }}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150",
                  "disabled:cursor-not-allowed disabled:opacity-45",
                  item.danger === true ? "text-danger" : "text-ink",
                  item.disabled !== true &&
                    focado === atual &&
                    (item.danger === true ? "bg-danger/10" : "bg-raised"),
                )}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>
      ))}

      {footer}
    </div>
  );
}

/** Estado de um menu aberto, com o alvo que ele descreve. */
export interface OpenMenu<T> {
  readonly anchor: MenuAnchor;
  readonly target: T;
}

/** Converte um evento de contexto na âncora do menu. */
export function anchorFromEvent(e: { clientX: number; clientY: number }): MenuAnchor {
  return { x: e.clientX, y: e.clientY };
}

/** Âncora abaixo de um elemento — para o botão de "···". */
export function anchorFromRect(rect: DOMRect): MenuAnchor {
  return { x: rect.left, y: rect.bottom + 4 };
}
