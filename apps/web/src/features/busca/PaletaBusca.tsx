import type { Connection, SearchHit, SearchHitKind, SearchResponse } from "@dbee/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Columns3, Eye, FolderTree, Layers, Search, SearchCode, Table2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { TableTarget } from "../../app/workspace";
import { useT } from "../../i18n";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { mensagemDeErro } from "../../lib/erroApi";
import { useSaidaAnimada } from "../../lib/useSaidaAnimada";
import { trechos } from "../tree/destaque.puro";
import { connectionNode, databaseNode, schemaNode } from "../tree/keys";
import { schemaTreeKey, type TreeState } from "../tree/useTree";
import { agrupar, mover, rotuloDoHit } from "./agrupar.puro";

/**
 * Busca global Cmd+K / Ctrl+K (F8, roadmap-dbeaver item 9).
 *
 * Paleta no estilo Raycast: um campo, a lista agrupada por tipo, setas e
 * Enter. Consulta `GET /search`, que só olha o catálogo **já em cache** no
 * servidor — nenhuma tecla abre conexão com banco. Conexão sem catálogo
 * aparece num rodapé com "Carregar": aí sim um pedido explícito lê a árvore do
 * database padrão dela (o mesmo pedido que expandir na árvore faria).
 *
 * Montada uma vez no `AppShell`; o atalho é registrado aqui para o shell só
 * precisar de uma linha.
 */
export function PaletaBusca({
  connections,
  tree,
  onOpenRelation,
  onBuscarValor,
}: {
  readonly connections: readonly Connection[];
  readonly tree: TreeState;
  readonly onOpenRelation: (target: TableTarget) => void;
  /** "Buscar valor no banco…" (ADR 023); ausente sem conexão Postgres. */
  readonly onBuscarValor?: (() => void) | undefined;
}) {
  const [aberta, setAberta] = useState(false);

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      setAberta((a) => !a);
    };
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("keydown", tecla); };
  }, []);

  if (!aberta) return null;
  return (
    <Paleta
      connections={connections}
      tree={tree}
      onOpenRelation={onOpenRelation}
      onBuscarValor={onBuscarValor}
      onClose={() => { setAberta(false); }}
    />
  );
}

const ICONE_GRUPO: Readonly<Record<SearchHitKind, typeof Table2>> = {
  relation: Table2,
  column: Columns3,
  schema: FolderTree,
};

const TITULO_GRUPO = {
  relation: "busca.grupoRelation",
  column: "busca.grupoColumn",
  schema: "busca.grupoSchema",
} as const satisfies Record<SearchHitKind, string>;

function iconeDoHit(h: SearchHit): typeof Table2 {
  if (h.kind === "relation" && h.relationKind === "view") return Eye;
  if (h.kind === "relation" && h.relationKind === "materialized_view") return Layers;
  return ICONE_GRUPO[h.kind];
}

function Paleta({
  connections,
  tree,
  onOpenRelation,
  onBuscarValor,
  onClose,
}: {
  readonly connections: readonly Connection[];
  readonly tree: TreeState;
  readonly onOpenRelation: (target: TableTarget) => void;
  readonly onBuscarValor?: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const t = useT();
  const saida = useSaidaAnimada(onClose);
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const [termo, setTermo] = useState("");
  const [atual, setAtual] = useState(0);
  const [carregando, setCarregando] = useState<string | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  // 120 ms de espera (`--motion-fast`): digitar "clientes" é uma busca, não oito.
  useEffect(() => {
    const id = window.setTimeout(() => { setTermo(texto.trim()); setAtual(0); }, 120);
    return () => { window.clearTimeout(id); };
  }, [texto]);

  const busca = useQuery({
    queryKey: ["busca-global", termo],
    enabled: termo !== "",
    staleTime: 10_000,
    queryFn: async (): Promise<SearchResponse> => {
      const { data, error } = await api.api.search.get({ query: { q: termo, limit: 50 } });
      if (error !== null) throw new Error(mensagemDeErro(error, t("busca.erro")));
      return data;
    },
  });

  const { grupos, planos } = agrupar(busca.data?.hits ?? []);
  const semCatalogo = busca.data?.semCatalogo ?? [];

  // O item corrente sempre visível ao andar com as setas.
  useEffect(() => {
    listaRef.current?.querySelector(`[data-indice="${String(atual)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [atual]);

  const escolher = (h: SearchHit): void => {
    // Revela o caminho na árvore; relação/coluna também abre a aba da tabela.
    tree.expand(connectionNode(h.connectionId));
    tree.expand(databaseNode(h.connectionId, h.database));
    tree.expand(schemaNode(h.connectionId, h.database, h.schema));
    if (h.relation !== null && h.relationKind !== null) {
      onOpenRelation({
        connectionId: h.connectionId,
        database: h.database,
        schema: h.schema,
        relation: h.relation,
        kind: h.relationKind,
      });
    }
    saida.fechar();
  };

  const carregar = async (id: string): Promise<void> => {
    const conn = connections.find((c) => c.id === id);
    if (conn === undefined) return;
    setCarregando(id);
    try {
      // Mesma chave da árvore: o que se lê aqui já serve à árvore e vice-versa.
      await queryClient.query({
        queryKey: schemaTreeKey(conn.id, conn.database),
        queryFn: async () => {
          const { data, error } = await api.api
            .connections({ id: conn.id })
            .schema.tree.get({ query: { database: conn.database } });
          if (error !== null) throw new Error(mensagemDeErro(error, t("busca.erro")));
          return data;
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["busca-global"] });
    } catch {
      // O erro do banco aparece onde a conexão é usada (árvore); aqui só para
      // de carregar e deixa o botão disponível para tentar de novo.
    } finally {
      setCarregando(null);
    }
  };

  const aoTeclar = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAtual((i) => mover(i, planos.length, e.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (e.key === "Enter") {
      const h = planos[atual];
      if (h === undefined) return;
      e.preventDefault();
      escolher(h);
    }
  };

  const idOpcao = (i: number): string => `busca-opcao-${String(i)}`;

  return (
    <Dialog.Root open={saida.aberto} onOpenChange={(a) => { if (!a) saida.fechar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="veu-dialogo" />
        <Dialog.Content
          onAnimationEnd={saida.onAnimationEnd}
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 focus-visible:outline-none",
            "flex max-h-[70dvh] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[0_24px_64px_rgba(0,0,0,.45)]",
          )}
        >
          <Dialog.Title className="sr-only">{t("busca.titulo")}</Dialog.Title>
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3">
            <Search aria-hidden className="h-4 w-4 shrink-0 text-subtle" />
            <input
              autoFocus
              value={texto}
              onChange={(e) => { setTexto(e.target.value); }}
              onKeyDown={aoTeclar}
              placeholder={t("busca.placeholder")}
              aria-label={t("busca.titulo")}
              role="combobox"
              aria-expanded={planos.length > 0}
              aria-controls="busca-lista"
              aria-activedescendant={planos.length > 0 ? idOpcao(atual) : undefined}
              maxLength={100}
              className="h-12 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-subtle focus:outline-none"
            />
          </div>

          <div ref={listaRef} id="busca-lista" role="listbox" aria-label={t("busca.titulo")} className="min-h-0 flex-1 overflow-y-auto py-1">
            {termo === "" ? (
              <>
                <p className="px-4 py-6 text-center text-xs text-subtle">{t("busca.dica")}</p>
                {onBuscarValor === undefined ? null : (
                  <button
                    type="button"
                    onClick={() => { saida.fechar(); onBuscarValor(); }}
                    className="mx-1 flex w-[calc(100%-0.5rem)] cursor-pointer items-center gap-2.5 rounded-[4px] px-3 py-2 text-left text-xs text-muted hover:bg-raised hover:text-ink"
                  >
                    <SearchCode aria-hidden className="h-3.5 w-3.5 shrink-0" />
                    {t("menu.buscarValor")}
                  </button>
                )}
              </>
            ) : busca.isError ? (
              <p className="px-4 py-3 text-xs text-danger">{busca.error.message}</p>
            ) : busca.isSuccess && planos.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-subtle">{t("busca.nada", { q: termo })}</p>
            ) : (
              grupos.map((g) => (
                <div key={g.kind} role="group" aria-label={t(TITULO_GRUPO[g.kind])}>
                  <p className="px-4 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-subtle">
                    {t(TITULO_GRUPO[g.kind])}
                  </p>
                  {g.hits.map((h, k) => {
                    const i = g.inicio + k;
                    const Icone = iconeDoHit(h);
                    const nome = h.kind === "column" ? (h.column ?? "") : h.kind === "relation" ? (h.relation ?? "") : h.schema;
                    return (
                      <div
                        key={`${h.connectionId}:${h.database}:${rotuloDoHit(h)}`}
                        id={idOpcao(i)}
                        role="option"
                        aria-selected={i === atual}
                        data-indice={i}
                        onMouseMove={() => { if (i !== atual) setAtual(i); }}
                        onClick={() => { escolher(h); }}
                        className={cn(
                          "mx-1 flex cursor-pointer items-center gap-2.5 rounded-[4px] px-3 py-2",
                          i === atual && "bg-raised",
                        )}
                      >
                        <Icone aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate text-xs text-muted">
                          {trechos(nome, termo).map((p, j) =>
                            p.casou ? <span key={j} className="font-semibold text-ink">{p.texto}</span> : <span key={j}>{p.texto}</span>,
                          )}
                          {h.kind === "schema" ? null : (
                            <span className="ml-2 font-mono text-2xs text-subtle">
                              {h.kind === "column" ? `${h.schema}.${h.relation ?? ""}` : h.schema}
                            </span>
                          )}
                        </span>
                        <span className="max-w-[40%] shrink-0 truncate text-2xs text-subtle">
                          {h.connectionName} · {h.database}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
            {busca.data?.truncated === true ? (
              <p className="px-4 py-2 text-2xs text-subtle">{t("busca.truncado", { n: String(planos.length) })}</p>
            ) : null}
          </div>

          {semCatalogo.length > 0 ? (
            <div className="shrink-0 border-t border-line px-4 py-2">
              <p className="pb-1 text-2xs text-subtle">{t("busca.semCatalogo")}</p>
              <ul className="flex flex-wrap gap-1.5">
                {semCatalogo.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={carregando !== null}
                      onClick={() => { void carregar(c.id); }}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] border border-line px-2 py-1 text-2xs text-muted hover:border-line-strong hover:text-ink disabled:cursor-wait disabled:opacity-60"
                    >
                      {t("busca.carregar")} <span className="font-medium text-ink">{c.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <footer className="flex shrink-0 items-center gap-4 border-t border-line bg-sunken/40 px-4 py-1.5 text-2xs text-subtle max-sm:hidden">
            <span><Tecla><ArrowUp aria-hidden className="inline h-2.5 w-2.5" /></Tecla> <Tecla><ArrowDown aria-hidden className="inline h-2.5 w-2.5" /></Tecla> {t("busca.navegar")}</span>
            <span><Tecla>Enter</Tecla> {t("busca.abrir")}</span>
            <span><Tecla>Esc</Tecla> {t("busca.fechar")}</span>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Tecla({ children }: { readonly children: React.ReactNode }) {
  return <kbd className="rounded-[3px] border border-line px-1 font-sans text-2xs text-muted">{children}</kbd>;
}
