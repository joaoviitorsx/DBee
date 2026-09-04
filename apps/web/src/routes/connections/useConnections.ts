import type { Connection, TestConnectionResult } from "@dbee/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../../lib/api";
import { connectionsKey } from "../../lib/query";
import type { ConnectionDraft } from "./ConnectionForm";

/**
 * Acesso a dados do domínio de conexões.
 *
 * A tela fica só com apresentação e estado de interface; tudo que fala com a
 * API mora aqui. Mesmo motivo do serviço no server: a regra não deve estar
 * espalhada no componente.
 */
export function useConnections() {
  const queryClient = useQueryClient();
  const [results, setResults] = useState<Record<string, TestConnectionResult>>({});

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: connectionsKey });
  };

  const query = useQuery({
    queryKey: connectionsKey,
    queryFn: async (): Promise<Connection[]> => {
      const { data, error } = await api.api.connections.get();
      if (error !== null) throw new Error("não foi possível carregar as conexões");
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async ({
      draft,
      editing,
    }: {
      draft: ConnectionDraft;
      editing: Connection | null;
    }): Promise<void> => {
      if (editing === null) {
        const { error } = await api.api.connections.post(draft);
        if (error !== null) throw new Error("não foi possível cadastrar a conexão");
        return;
      }

      // Senha em branco na edição significa "não mexe na senha".
      const { password, ...rest } = draft;
      const { error } = await api.api
        .connections({ id: editing.id })
        .patch(password === "" ? rest : draft);
      if (error !== null) throw new Error("não foi possível salvar as alterações");
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await api.api.connections({ id }).delete();
      if (error !== null) throw new Error("não foi possível apagar a conexão");
    },
    onSuccess: invalidate,
  });

  const test = useMutation({
    mutationFn: async (id: string): Promise<{ id: string; result: TestConnectionResult }> => {
      const { data, error } = await api.api.connections({ id }).test.post();
      if (error !== null) {
        return {
          id,
          result: { ok: false, code: null, message: "o servidor não respondeu", durationMs: 0 },
        };
      }
      return { id, result: data };
    },
    onSuccess: ({ id, result }) => {
      setResults((current) => ({ ...current, [id]: result }));
    },
  });

  return { query, save, remove, test, results };
}
