import * as Dialog from "@radix-ui/react-dialog";
import type { SavedQuery } from "@dbee/shared";
import { Check, Pencil, Play, Search, Trash2, X } from "lucide-react";
import { useState } from "react";

import { Button, Input } from "../../components/ui";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import {
  useExcluirQuery,
  useRenomearQuery,
  useSalvarQuery,
  useSavedQueries,
} from "./useSavedQueries";

/**
 * Salvar a query da aba com um nome. Diálogo mínimo: um campo e um botão.
 */
export function SaveQueryDialog({
  sql,
  connectionId,
  onClose,
}: {
  readonly sql: string;
  readonly connectionId: string | null;
  readonly onClose: () => void;
}) {
  const t = useT();
  const [nome, setNome] = useState("");
  const salvar = useSalvarQuery();

  const confirmar = (): void => {
    const n = nome.trim();
    if (n === "" || sql.trim() === "") return;
    salvar.mutate({ name: n, sql, connectionId }, { onSuccess: onClose });
  };

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line bg-surface animate-settle shadow-[0_24px_64px_rgba(0,0,0,.5)]",
          )}
        >
          <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-ink">
              {t("salvas.salvarTitulo")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label={t("comum.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>
          <div className="px-5 py-4">
            <Input
              autoFocus
              value={nome}
              onChange={(e) => { setNome(e.target.value); }}
              onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }}
              placeholder={t("salvas.nomeDaQuery")}
              aria-label={t("salvas.nomeDaQuery")}
              className="h-9 text-sm"
            />
          </div>
          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost">{t("comum.cancelar")}</Button>
            </Dialog.Close>
            <Button
              type="button"
              variant="primary"
              disabled={nome.trim() === ""}
              loading={salvar.isPending}
              onClick={confirmar}
            >
              {t("salvas.salvar")}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Queries salvas — lista simples (DBee.md §5).
 *
 * Abrir, renomear e excluir; busca por nome e por conteúdo do SQL (o filtro vai
 * ao servidor). Sem pastas nem versionamento: uma lista resolve.
 */
export function SavedQueriesModal({
  onClose,
  onOpen,
  nomeConexao,
}: {
  readonly onClose: () => void;
  /** Abrir a query salva numa aba nova, atrelada à conexão de origem. */
  readonly onOpen: (query: SavedQuery) => void;
  /** Resolve o id da conexão para um nome legível (ou null se sumiu). */
  readonly nomeConexao: (connectionId: string | null) => string | null;
}) {
  const t = useT();
  const [busca, setBusca] = useState("");
  const lista = useSavedQueries(busca);

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[82vh] w-[calc(100%-2rem)] max-w-2xl",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-surface",
            "animate-settle shadow-[0_24px_64px_rgba(0,0,0,.5)]",
          )}
        >
          <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-ink">
              {t("salvas.titulo")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label={t("comum.fechar")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="border-b border-line px-5 py-3">
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
              <Input
                autoFocus
                value={busca}
                onChange={(e) => { setBusca(e.target.value); }}
                placeholder={t("salvas.buscar")}
                aria-label={t("salvas.buscar")}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {lista.isPending ? (
              <p className="px-5 py-8 text-center text-xs text-subtle">{t("comum.carregando")}…</p>
            ) : lista.data === undefined || lista.data.length === 0 ? (
              <p className="px-5 py-10 text-center text-xs text-subtle">
                {busca.trim() === "" ? t("salvas.vazio") : t("salvas.semResultado")}
              </p>
            ) : (
              <ul className="divide-y divide-line/60">
                {lista.data.map((q) => (
                  <ItemSalvo
                    key={q.id}
                    query={q}
                    conexao={nomeConexao(q.connectionId)}
                    onAbrir={() => { onOpen(q); onClose(); }}
                  />
                ))}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ItemSalvo({
  query,
  conexao,
  onAbrir,
}: {
  readonly query: SavedQuery;
  readonly conexao: string | null;
  readonly onAbrir: () => void;
}) {
  const t = useT();
  const renomear = useRenomearQuery();
  const excluir = useExcluirQuery();
  const [editandoNome, setEditandoNome] = useState<string | null>(null);
  // Excluir em dois cliques: o primeiro arma, o segundo confirma. Sem modal
  // aninhado, e sem apagar por engano no clique errado.
  const [confirmar, setConfirmar] = useState(false);

  const salvarNome = (): void => {
    const nome = (editandoNome ?? "").trim();
    if (nome !== "" && nome !== query.name) renomear.mutate({ id: query.id, name: nome });
    setEditandoNome(null);
  };

  return (
    <li className="group flex items-start gap-3 px-5 py-3 hover:bg-raised">
      <div className="min-w-0 flex-1">
        {editandoNome !== null ? (
          <Input
            autoFocus
            value={editandoNome}
            onChange={(e) => { setEditandoNome(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvarNome();
              if (e.key === "Escape") setEditandoNome(null);
            }}
            onBlur={salvarNome}
            aria-label={t("salvas.renomear")}
            className="h-7 text-xs"
          />
        ) : (
          <button
            type="button"
            onClick={onAbrir}
            className="block max-w-full truncate text-left text-sm font-medium text-ink hover:text-accent"
            title={t("salvas.abrir")}
          >
            {query.name}
          </button>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-2xs text-subtle">
          {conexao !== null ? (
            <span className="truncate">{conexao}</span>
          ) : (
            <span className="italic">{t("salvas.semConexao")}</span>
          )}
        </div>
        <pre className="mt-1.5 max-h-16 overflow-hidden truncate whitespace-pre-wrap break-all font-mono text-2xs leading-relaxed text-muted">
          {query.sql.length > 200 ? `${query.sql.slice(0, 200)}…` : query.sql}
        </pre>
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t("salvas.abrir")} title={t("salvas.abrir")} onClick={onAbrir}>
          <Play aria-hidden className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label={t("salvas.renomear")}
          title={t("salvas.renomear")}
          onClick={() => { setEditandoNome(query.name); }}
        >
          <Pencil aria-hidden className="h-3.5 w-3.5" />
        </Button>
        {confirmar ? (
          <Button
            size="icon"
            variant="danger"
            className="h-7 w-7"
            aria-label={t("salvas.confirmarExcluir")}
            title={t("salvas.confirmarExcluir")}
            onClick={() => { excluir.mutate(query.id); }}
          >
            <Check aria-hidden className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-danger"
            aria-label={t("salvas.excluir")}
            title={t("salvas.excluir")}
            onClick={() => { setConfirmar(true); }}
            onBlur={() => { setConfirmar(false); }}
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}
