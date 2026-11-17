import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { useSaidaAnimada } from "../../lib/useSaidaAnimada";
import { Button } from "./Button";

/**
 * Casca dos painéis de instalação (tokens, contas; VPN depois): mesmo
 * cabeçalho, corpo rolável, rodapé opcional e a saída animada de
 * `useSaidaAnimada`. A entrada/saída vem do seletor global
 * `[role=dialog][data-state]` (design-system.md §7).
 *
 * O cabeçalho leva o ícone da porta que abriu o painel, para a pessoa ligar o
 * que clicou ao que apareceu.
 */
export function ModalPainel({
  titulo,
  descricao,
  icone,
  rodape,
  onClose,
  children,
}: {
  readonly titulo: string;
  readonly descricao: string;
  readonly icone: ReactNode;
  readonly rodape?: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const t = useT();
  const saida = useSaidaAnimada(onClose);
  return (
    <Dialog.Root open={saida.aberto} onOpenChange={(aberto) => { if (!aberto) saida.fechar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="veu-dialogo" />
        <Dialog.Content
          onAnimationEnd={saida.onAnimationEnd}
          // O anel de foco em volta do painel inteiro não diz nada.
          onOpenAutoFocus={(e) => { e.preventDefault(); }}
          className={cn(
            "focus-visible:outline-none",
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2",
            "flex max-h-[calc(100dvh-2rem)] flex-col",
            "rounded-lg border border-line bg-surface shadow-[0_24px_64px_rgba(0,0,0,.45)]",
          )}
        >
          <header className="flex shrink-0 items-start gap-3 px-5 pb-4 pt-5">
            <span
              aria-hidden
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-line max-sm:hidden bg-raised text-muted"
            >
              {icone}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <Dialog.Title className="text-base font-semibold leading-tight text-ink">{titulo}</Dialog.Title>
              <Dialog.Description className="mt-1.5 max-w-[60ch] text-xs leading-relaxed text-subtle">
                {descricao}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" className="-mr-2 -mt-1" aria-label={t("comum.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-5 py-4">{children}</div>

          {rodape === undefined ? null : (
            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 rounded-b-lg border-t border-line bg-sunken/40 px-5 py-3">
              {rodape}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
