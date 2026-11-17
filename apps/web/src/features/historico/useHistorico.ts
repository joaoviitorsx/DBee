import type { HistoryScope, QueryLogEntry } from "@dbee/shared";
import { useInfiniteQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";

/** Página da rota; acabou quando vier menos que isto (contrato de `HistoryQuery`). */
export const PAGINA_HISTORICO = 50;

/**
 * Histórico da conexão (roadmap-dbeaver item 2): `GET /connections/:id/history`
 * com `scope` e cursor keyset `executedAt|id` da última linha recebida.
 */
export function useHistorico(connectionId: string, scope: HistoryScope, q: string, ativo: boolean) {
  return useInfiniteQuery({
    queryKey: ["historico", connectionId, scope, q],
    enabled: ativo,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<QueryLogEntry[]> => {
      const busca = q.trim();
      const { data, error } = await api.api.connections({ id: connectionId }).history.get({
        query: {
          scope,
          limit: PAGINA_HISTORICO,
          ...(busca === "" ? {} : { q: busca }),
          ...(pageParam === null ? {} : { cursor: pageParam }),
        },
      });
      if (error !== null) throw new Error("não foi possível carregar o histórico");
      return data;
    },
    getNextPageParam: (ultima) => {
      const fim = ultima.at(-1);
      return ultima.length < PAGINA_HISTORICO || fim === undefined ? null : `${fim.executedAt}|${fim.id}`;
    },
    staleTime: 5_000,
  });
}
