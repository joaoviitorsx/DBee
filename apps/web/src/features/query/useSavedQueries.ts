import type { SavedQuery } from "@dbee/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";

/** Chave do cache — o `q` entra nela para cada busca ter sua própria entrada. */
const chave = (q: string): readonly unknown[] => ["saved-queries", q];

/** Lista as queries salvas, filtradas por `q` (nome ou conteúdo do SQL). */
export function useSavedQueries(q: string) {
  return useQuery({
    queryKey: chave(q),
    queryFn: async (): Promise<SavedQuery[]> => {
      const { data, error } = await api.api["saved-queries"].get({
        query: q.trim() === "" ? {} : { q: q.trim() },
      });
      if (error !== null) throw new Error("não foi possível listar as queries salvas");
      return data;
    },
    staleTime: 10_000,
  });
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["saved-queries"] });
}

export function useSalvarQuery() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (dados: { name: string; sql: string; connectionId: string | null }) => {
      const { data, error } = await api.api["saved-queries"].post(dados);
      if (error !== null) throw new Error("não foi possível salvar a query");
      return data;
    },
    onSuccess: () => { void invalidar(); },
  });
}

export function useRenomearQuery() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await api.api["saved-queries"]({ id }).patch({ name });
      if (error !== null) throw new Error("não foi possível renomear");
    },
    onSuccess: () => { void invalidar(); },
  });
}

export function useExcluirQuery() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.api["saved-queries"]({ id }).delete();
      if (error !== null) throw new Error("não foi possível excluir");
    },
    onSuccess: () => { void invalidar(); },
  });
}
