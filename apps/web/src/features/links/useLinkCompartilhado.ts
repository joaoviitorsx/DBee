import type { Connection, RowFilter } from "@dbee/shared";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import type { TableTarget } from "../../app/workspace";
import type { Tradutor } from "../../i18n";
import { api } from "../../lib/api";
import { copiarTexto } from "../../lib/navegador";
import { lerLink } from "./links.puro";

interface Acoes {
  readonly connections: readonly Connection[];
  /** A lista de conexões já veio do servidor — antes disso todo link pareceria "não encontrado". */
  readonly prontas: boolean;
  readonly abrirTabela: (
    alvo: TableTarget,
    filtros: readonly RowFilter[],
    ordem: { column: string; direction: "asc" | "desc" } | null,
  ) => void;
  readonly abrirSalva: (q: { connectionId: string | null; sql: string }) => void;
  readonly t: Tradutor;
}

/**
 * Abre o link do hash (ADR 020) na carga e a cada `hashchange`.
 *
 * **Abrir não executa nada**: a tabela vira uma aba como um clique na árvore
 * (mesma leitura READ ONLY), e a query salva só preenche o editor. Depois de
 * consumido, o hash sai da barra (`replaceState`) para um reload não reabrir a
 * mesma aba por cima da persistida.
 *
 * Conexão que a pessoa não enxerga cai no mesmo "não encontrado" de uma que
 * não existe — a UI não confirma existência (ADR 020 §4).
 */
export function useLinkCompartilhado(a: Acoes): void {
  // Ref atualizada em efeito (não no render): o ouvinte de `hashchange` vive
  // enquanto as conexões mudam e precisa sempre da lista atual.
  const ref = useRef(a);
  useEffect(() => { ref.current = a; });

  useEffect(() => {
    if (!a.prontas) return;
    const consumir = (): void => {
      const link = lerLink(window.location.hash);
      if (link === null) return;
      history.replaceState(null, "", window.location.pathname + window.location.search);
      const { connections, abrirTabela, abrirSalva, t } = ref.current;

      if (link.tipo === "tabela") {
        const conn = connections.find((c) => c.id === link.connectionId);
        if (conn === undefined) {
          toast.error(t("links.naoEncontrado"));
          return;
        }
        abrirTabela(
          {
            connectionId: conn.id,
            database: link.database ?? conn.database,
            schema: link.schema,
            relation: link.tabela,
            // O link não diz se é view; a aba só usa `kind` para o ícone e
            // as sub-abas de estrutura recarregam do catálogo.
            kind: "table",
          },
          link.filtros,
          link.ordem,
        );
        return;
      }

      void api.api["saved-queries"]({ id: link.id }).get().then(({ data, error }) => {
        if (error !== null) {
          toast.error(t("links.naoEncontrado"));
          return;
        }
        abrirSalva({ connectionId: data.connectionId, sql: data.sql });
      });
    };
    consumir();
    window.addEventListener("hashchange", consumir);
    return () => { window.removeEventListener("hashchange", consumir); };
  }, [a.prontas]);
}

/** Copia a URL absoluta do link. Confirmação em toast: o retorno acontece fora do menu que fechou. */
export function copiarLink(hash: string, t: Tradutor): void {
  const url = `${window.location.origin}${window.location.pathname}${hash}`;
  void copiarTexto(url).then((ok) => {
    if (ok) toast.success(t("links.copiado"));
  });
}
