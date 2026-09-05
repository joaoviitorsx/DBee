import * as Dialog from "@radix-ui/react-dialog";
import type { Column } from "@dbee/shared";
import { construirInsert } from "@dbee/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info, KeyRound, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, Input } from "../../components/ui";
import { mensagemDoCodigo, useIdioma } from "../../i18n";
import { cn } from "../../lib/cn";
import { api } from "../../lib/api";

/** Controle de uma coluna no formulário: usar o default, ser NULL, ou o valor. */
interface Controle {
  readonly usar: boolean;
  readonly nulo: boolean;
  readonly valor: string;
}

function erroDaResposta(error: unknown): Error & { code?: string } {
  let message = "falhou";
  let code: string | undefined;
  if (typeof error === "object" && error !== null && "value" in error) {
    const { value } = error;
    if (typeof value === "object" && value !== null) {
      if ("code" in value && typeof value.code === "string") code = value.code;
      if ("message" in value && typeof value.message === "string") message = value.message;
    }
  }
  const e: Error & { code?: string } = new Error(message);
  if (code !== undefined) e.code = code;
  return e;
}

/**
 * Nova linha (INSERT) — problema diferente do UPDATE (v0.2).
 *
 * O usuário preenche só o que quer; coluna deixada em "default" fica de fora do
 * INSERT e o Postgres resolve (sequence, `DEFAULT`, `now()`). Por isso o padrão
 * de cada coluna nasce esperto: quem tem default ou aceita NULL já vem em
 * "default"; NOT NULL sem default vem pedindo valor. Mesma confirmação por diff
 * do resto da edição — o preview mostra o SQL literal.
 */
export function InsertModal({
  connectionId,
  database,
  schema,
  table,
  columns,
  onClose,
}: {
  readonly connectionId: string;
  readonly database: string;
  readonly schema: string;
  readonly table: string;
  readonly columns: readonly Column[];
  readonly onClose: () => void;
}) {
  const { t } = useIdioma();
  const qc = useQueryClient();

  const [controles, setControles] = useState<Record<string, Controle>>(() => {
    const inicial: Record<string, Controle> = {};
    for (const c of columns) {
      // Tem default ou aceita NULL → o Postgres cuida; senão, pede valor.
      inicial[c.name] = { usar: c.defaultValue !== null || c.nullable, nulo: false, valor: "" };
    }
    return inicial;
  });

  const ajustar = (nome: string, patch: Partial<Controle>): void => {
    setControles((atual) => {
      const anterior = atual[nome] ?? { usar: true, nulo: false, valor: "" };
      return { ...atual, [nome]: { ...anterior, ...patch } };
    });
  };

  const values = useMemo(
    () =>
      columns
        .filter((c) => !(controles[c.name]?.usar ?? true))
        .map((c) => {
          const ctrl = controles[c.name];
          return { column: c.name, value: ctrl?.nulo ? null : (ctrl?.valor ?? "") };
        }),
    [columns, controles],
  );

  const literal =
    values.length === 0
      ? null
      : construirInsert({ database, schema, table, readOnly: false, values }).literal;

  const inserir = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.api
        .connections({ id: connectionId })
        .rows.insert.post({ database, schema, table, readOnly: false, values });
      if (error !== null) throw erroDaResposta(error);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rows"] });
      onClose();
    },
  });

  const erro = inserir.error;

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-surface",
            "animate-settle border-l-[3px] border-l-accent shadow-[0_24px_64px_rgba(0,0,0,.5)]",
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-ink">
              {t("edit.tituloInsert")} · <span className="font-mono text-sm text-muted">{schema}.{table}</span>
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label={t("comum.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
            {columns.map((c) => {
              const ctrl = controles[c.name] ?? { usar: true, nulo: false, valor: "" };
              const obrigatoria = c.defaultValue === null && !c.nullable;
              return (
                <div key={c.name} className="grid grid-cols-[10rem_1fr] items-center gap-3">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {c.isPrimaryKey ? (
                      <KeyRound aria-hidden className="h-3 w-3 shrink-0 text-accent" />
                    ) : null}
                    <span className="truncate font-mono text-xs text-ink" title={c.dataType}>
                      {c.name}
                    </span>
                    {obrigatoria ? (
                      <span className="shrink-0 text-2xs text-danger">{t("edit.obrigatoria")}</span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <Input
                      value={ctrl.valor}
                      mono
                      disabled={ctrl.usar || ctrl.nulo}
                      onChange={(e) => { ajustar(c.name, { valor: e.target.value }); }}
                      aria-label={t("edit.valorColuna", { col: c.name })}
                      className="h-8 flex-1 text-xs"
                    />
                    {/* default: fora do INSERT. Só aparece quando a coluna pode
                        se virar sem valor (tem default ou aceita NULL). */}
                    {!obrigatoria ? (
                      <label className="flex shrink-0 cursor-pointer items-center gap-1 text-2xs text-muted">
                        <input
                          type="checkbox"
                          checked={ctrl.usar}
                          onChange={(e) => { ajustar(c.name, { usar: e.target.checked }); }}
                          className="cursor-pointer accent-[var(--color-accent)]"
                        />
                        {t("edit.usarDefault")}
                      </label>
                    ) : null}
                    {c.nullable ? (
                      <label className="flex shrink-0 cursor-pointer items-center gap-1 text-2xs text-muted">
                        <input
                          type="checkbox"
                          checked={ctrl.nulo}
                          disabled={ctrl.usar}
                          onChange={(e) => { ajustar(c.name, { nulo: e.target.checked }); }}
                          className="cursor-pointer accent-[var(--color-accent)]"
                        />
                        NULL
                      </label>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-2 border-t border-line px-5 py-3">
            <p className="text-2xs font-medium text-subtle">{t("edit.preview")}</p>
            <pre className="max-h-40 overflow-auto rounded-[4px] border border-line bg-sunken p-3 font-mono text-xs leading-relaxed text-ink">
              {literal ?? t("edit.nenhumaColuna")}
            </pre>
            <p className="flex gap-1.5 text-2xs leading-relaxed text-subtle">
              <Info aria-hidden className="mt-px h-3 w-3 shrink-0" />
              <span>{t("edit.notaParams")}</span>
            </p>
            {erro !== null ? (
              <p role="alert" className="rounded-[4px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {mensagemDoCodigo(t, (erro as { code?: string }).code, erro.message)}
              </p>
            ) : null}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost">{t("comum.cancelar")}</Button>
            </Dialog.Close>
            <Button
              type="button"
              variant="primary"
              disabled={values.length === 0}
              loading={inserir.isPending}
              loadingLabel={t("edit.inserindo")}
              onClick={() => { inserir.mutate(); }}
            >
              {t("edit.inserir")}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
