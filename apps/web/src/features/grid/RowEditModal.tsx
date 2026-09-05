import * as Dialog from "@radix-ui/react-dialog";
import {
  construirDelete,
  construirUpdate,
  type RowDeleteRequest,
  type RowUpdateRequest,
} from "@dbee/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../../components/ui";
import { mensagemDoCodigo, useIdioma } from "../../i18n";
import { cn } from "../../lib/cn";
import { api } from "../../lib/api";

/** Coluna da PK que identifica a linha (nome + valor lido). */
export interface PkValor {
  readonly column: string;
  readonly value: string;
}

/** O que o usuário pediu para editar, antes de confirmar o diff. */
export type Pendente =
  | {
      readonly kind: "update";
      readonly database: string;
      readonly schema: string;
      readonly table: string;
      readonly pk: readonly PkValor[];
      readonly column: string;
      readonly from: string | null;
      readonly to: string;
    }
  | {
      readonly kind: "delete";
      readonly database: string;
      readonly schema: string;
      readonly table: string;
      readonly pk: readonly PkValor[];
      /** Valores originais das colunas não-PK — a guarda otimista do DELETE. */
      readonly guard: readonly { readonly column: string; readonly value: string | null }[];
    };

/** Erro da API que preserva o `code` — o que `mensagemDoCodigo` traduz. */
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
 * Preview + confirmação da edição de uma linha (v0.2).
 *
 * O corolário da fronteira (ADR 006): o DBee mostra o SQL e o usuário confirma
 * antes de aplicar. O preview traz os **valores literais** ('2026-03-01', não
 * `$1`) — a execução liga por parâmetro, e o texto abaixo diz isso. Nada é
 * enviado até "Aplicar".
 */
export function RowEditModal({
  connectionId,
  pendente,
  onClose,
}: {
  readonly connectionId: string;
  readonly pendente: Pendente;
  readonly onClose: () => void;
}) {
  const { t } = useIdioma();
  const qc = useQueryClient();
  // Só no UPDATE: trocar o novo valor por NULL. O input da grade dá string; o
  // NULL precisa de um controle próprio, senão não haveria como distinguir
  // string vazia de NULL.
  const [comoNull, setComoNull] = useState(false);

  const corpo = useMemo(():
    | { kind: "update"; body: RowUpdateRequest }
    | { kind: "delete"; body: RowDeleteRequest } => {
    const alvo = { database: pendente.database, schema: pendente.schema, table: pendente.table };
    const pk = pendente.pk.map((p) => ({ column: p.column, value: p.value }));
    if (pendente.kind === "update") {
      return {
        kind: "update",
        body: {
          ...alvo,
          readOnly: false,
          pk,
          changes: [{ column: pendente.column, from: pendente.from, to: comoNull ? null : pendente.to }],
        },
      };
    }
    return {
      kind: "delete",
      body: { ...alvo, readOnly: false, pk, guard: pendente.guard.map((g) => ({ ...g })) },
    };
  }, [pendente, comoNull]);

  const literal =
    corpo.kind === "update" ? construirUpdate(corpo.body).literal : construirDelete(corpo.body).literal;

  const aplicar = useMutation({
    mutationFn: async () => {
      const conexao = api.api.connections({ id: connectionId });
      const { data, error } =
        corpo.kind === "update"
          ? await conexao.rows.update.post(corpo.body)
          : await conexao.rows.delete.post(corpo.body);
      if (error !== null) throw erroDaResposta(error);
      return data;
    },
    onSuccess: () => {
      // A grade recarrega: o dado na tela tem que ser o dado no banco.
      void qc.invalidateQueries({ queryKey: ["rows"] });
      onClose();
    },
  });

  const erro = aplicar.error;
  const titulo =
    pendente.kind === "update" ? t("edit.tituloUpdate", { col: pendente.column }) : t("edit.tituloDelete");

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100%-2rem)] max-w-xl",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border bg-surface",
            "animate-settle shadow-[0_24px_64px_rgba(0,0,0,.5)]",
            pendente.kind === "delete" ? "border-danger-line border-l-[3px] border-l-danger" : "border-line border-l-[3px] border-l-accent",
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-ink">
              {pendente.kind === "delete" ? (
                <TriangleAlert aria-hidden className="h-4 w-4 shrink-0 text-danger" />
              ) : null}
              {titulo}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label={t("comum.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="space-y-3 overflow-y-auto px-5 py-4">
            {pendente.kind === "update" ? (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={comoNull}
                  onChange={(e) => { setComoNull(e.target.checked); }}
                  className="cursor-pointer accent-[var(--color-accent)]"
                />
                {t("edit.definirNull")}
              </label>
            ) : (
              <p className="text-xs leading-relaxed text-muted">{t("edit.confirmarDelete")}</p>
            )}

            <div>
              <p className="mb-1 text-2xs font-medium text-subtle">{t("edit.preview")}</p>
              <pre className="overflow-x-auto rounded-[4px] border border-line bg-sunken p-3 font-mono text-xs leading-relaxed text-ink">
                {literal}
              </pre>
            </div>

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
              <Button type="button" variant="ghost">
                {t("comum.cancelar")}
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              variant={pendente.kind === "delete" ? "danger" : "primary"}
              loading={aplicar.isPending}
              loadingLabel={t("edit.aplicando")}
              onClick={() => { aplicar.mutate(); }}
            >
              {pendente.kind === "delete" ? t("edit.excluirLinha") : t("edit.aplicar")}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
