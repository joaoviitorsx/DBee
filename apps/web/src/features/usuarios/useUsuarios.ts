import type { Role, UserSummary } from "@dbee/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { ErroApi } from "../auth/useSession";

/** Administração de contas (DBee.md §9, v0.2). */
const chave = ["usuarios"] as const;

/** Extrai `code` e `message` do erro do Eden, com um padrão quando faltar. */
function erroDaResposta(error: unknown, padrao: string): ErroApi {
  if (typeof error === "object" && error !== null && "value" in error) {
    const { value } = error;
    if (typeof value === "object" && value !== null) {
      const code = "code" in value && typeof value.code === "string" ? value.code : undefined;
      const message =
        "message" in value && typeof value.message === "string" ? value.message : padrao;
      return new ErroApi(code, message);
    }
  }
  return new ErroApi(undefined, padrao);
}

/**
 * A lista de contas.
 *
 * `enabled` porque a consulta responde **403 para quem não é admin**, e disparar
 * um 403 previsível a cada montagem só suja o console e o log do servidor. Quem
 * decide é o `role` da sessão — que é dica de UI, não o controle: o controle é o
 * `exigirAdmin` no servidor, e ele continua valendo se alguém chamar a rota à
 * mão.
 */
export function useUsuarios(enabled: boolean) {
  return useQuery({
    queryKey: chave,
    queryFn: async (): Promise<UserSummary[]> => {
      const { data, error } = await api.api.users.get();
      if (error !== null) throw erroDaResposta(error, "não foi possível listar as contas");
      return data;
    },
    enabled,
    staleTime: 30_000,
  });
}

function useInvalidar(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: chave });
  };
}

export function useCriarUsuario() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (dados: { username: string; temporaryPassword: string; role: Role }) => {
      const { data, error } = await api.api.users.post(dados);
      if (error !== null) throw erroDaResposta(error, "não foi possível criar a conta");
      return data;
    },
    onSuccess: invalidar,
  });
}

export function useDefinirPapel() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Role }) => {
      const { data, error } = await api.api.users({ id }).patch({ role });
      if (error !== null) throw erroDaResposta(error, "não foi possível trocar o papel");
      return data;
    },
    onSuccess: invalidar,
  });
}

export function useResetarSenha() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async ({ id, temporaryPassword }: { id: string; temporaryPassword: string }) => {
      const { data, error } = await api.api
        .users({ id })
        .password.post({ temporaryPassword });
      if (error !== null) throw erroDaResposta(error, "não foi possível resetar a senha");
      return data;
    },
    onSuccess: invalidar,
  });
}

export function useRemoverUsuario() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.api.users({ id }).delete();
      if (error !== null) throw erroDaResposta(error, "não foi possível remover a conta");
    },
    onSuccess: invalidar,
  });
}
