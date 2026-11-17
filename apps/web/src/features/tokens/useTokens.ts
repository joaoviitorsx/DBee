import type { ApiTokenSummary } from "@dbee/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { ErroApi } from "../auth/useSession";

/** Tokens pessoais do MCP (ADR 015). Cada um gerencia os seus. */
const chave = ["tokens"] as const;

export function useTokens() {
  return useQuery({
    queryKey: chave,
    queryFn: async (): Promise<ApiTokenSummary[]> => {
      const { data, error } = await api.api.tokens.get();
      if (error !== null) throw new ErroApi(undefined, "não foi possível listar os tokens");
      return data;
    },
    staleTime: 30_000,
  });
}

export function useCriarToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.api.tokens.post({ name });
      if (error !== null) throw new ErroApi(undefined, "não foi possível criar o token");
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chave });
    },
  });
}

export function useRevogarToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.api.tokens({ id }).delete();
      if (error !== null) throw new ErroApi(undefined, "não foi possível revogar o token");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chave });
    },
  });
}
