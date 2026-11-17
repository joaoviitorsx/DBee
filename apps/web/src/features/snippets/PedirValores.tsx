import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState } from "react";

import { Button, Input } from "../../components/ui";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { useSaidaAnimada } from "../../lib/useSaidaAnimada";

/**
 * Valores das variáveis `:nome` de um snippet (ADR 019).
 *
 * Os valores **nunca** entram no texto: voltam como mapa nome → valor e o
 * chamador monta `params` com `valoresDosParametros` (bind no protocolo
 * estendido). `NULL` é escolha explícita por caixa — campo vazio é string
 * vazia, não nulo, para não mudar o resultado em silêncio.
 */
export function PedirValores({
  nomes,
  iniciais,
  onConfirmar,
  onClose,
}: {
  readonly nomes: readonly string[];
  readonly iniciais: Readonly<Record<string, string | null>>;
  readonly onConfirmar: (valores: Record<string, string | null>) => void;
  readonly onClose: () => void;
}) {
  const t = useT();
  const [valores, setValores] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(nomes.map((n) => [n, Object.hasOwn(iniciais, n) ? (iniciais[n] ?? null) : ""])),
  );
  const saida = useSaidaAnimada(onClose);
  const confirmar = (): void => {
    onConfirmar(valores);
    saida.fechar();
  };

  return (
    <Dialog.Root open={saida.aberto} onOpenChange={(o) => { if (!o) saida.fechar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="veu-dialogo" />
        <Dialog.Content
          onAnimationEnd={saida.onAnimationEnd}
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line bg-surface animate-settle shadow-[0_24px_64px_rgba(0,0,0,.5)]",
          )}
        >
          <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-ink">{t("snippets.titulo")}</Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label={t("comum.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>
          <form
            className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-5 py-4"
            onSubmit={(e) => { e.preventDefault(); confirmar(); }}
          >
            <p className="text-2xs text-subtle">{t("snippets.explica")}</p>
            {nomes.map((nome, i) => {
              const valor = valores[nome] ?? null;
              return (
                <div key={nome} className="flex items-center gap-2">
                  <label htmlFor={`var-${nome}`} className="w-28 shrink-0 truncate font-mono text-xs text-muted" title={`:${nome}`}>
                    :{nome}
                  </label>
                  <Input
                    id={`var-${nome}`}
                    autoFocus={i === 0}
                    disabled={valor === null}
                    value={valor ?? ""}
                    placeholder={valor === null ? "NULL" : ""}
                    onChange={(e) => { setValores((v) => ({ ...v, [nome]: e.target.value })); }}
                    className="h-8 flex-1 font-mono text-xs"
                  />
                  <label className="flex shrink-0 cursor-pointer items-center gap-1 text-2xs text-subtle">
                    <input
                      type="checkbox"
                      checked={valor === null}
                      onChange={(e) => { setValores((v) => ({ ...v, [nome]: e.target.checked ? null : "" })); }}
                    />
                    NULL
                  </label>
                </div>
              );
            })}
            <button type="submit" hidden />
          </form>
          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost">{t("comum.cancelar")}</Button>
            </Dialog.Close>
            <Button type="button" variant="primary" onClick={confirmar}>{t("snippets.executar")}</Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
