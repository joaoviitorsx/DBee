import type { VersionStatus } from "@dbee/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";

/** Estado da atualização (DBee.md §8). */
const chave = ["update-version"] as const;

/**
 * Código de falha que o servidor devolve, para a UI escolher a frase.
 *
 * O `message` do servidor já vem em português e serve de reserva, mas a UI é
 * bilíngue: quem escolhe o texto é o dicionário, a partir do código.
 */
export type CodigoDeFalha =
  | "update_not_configured"
  | "update_too_soon"
  | "update_failed"
  | "desconhecido";

export class FalhaDeUpdate extends Error {
  constructor(readonly codigo: CodigoDeFalha) {
    super(codigo);
    this.name = "FalhaDeUpdate";
  }
}

/** O corpo de erro do Eden é `unknown`; só o `code` interessa. */
function codigoDe(valor: unknown): CodigoDeFalha {
  if (typeof valor !== "object" || valor === null) return "desconhecido";
  const code = (valor as { code?: unknown }).code;
  return code === "update_not_configured" ||
    code === "update_too_soon" ||
    code === "update_failed"
    ? code
    : "desconhecido";
}

/**
 * A verificação acontece no servidor, com cache de um dia em SQLite — este
 * `staleTime` é só para a aba não repetir a chamada a cada montagem.
 */
export function useVersao() {
  return useQuery({
    queryKey: chave,
    queryFn: async (): Promise<VersionStatus> => {
      const { data, error } = await api.api.meta.version.get();
      if (error !== null) throw new Error("não foi possível ler a versão");
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

function useInvalidar(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: chave });
  };
}

/** "Verificar agora" — o servidor ignora o cache de um dia. */
export function useVerificarAgora() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<VersionStatus> => {
      const { data, error } = await api.api.meta.version.check.post();
      if (error !== null) throw new Error("não foi possível verificar");
      return data;
    },
    onSuccess: (estado) => { qc.setQueryData(chave, estado); },
  });
}

export function useSalvarAjustes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ajustes: {
      autoCheck?: boolean;
      webhookUrl?: string | null;
    }): Promise<VersionStatus> => {
      const { data, error } = await api.api.meta["update-settings"].patch(ajustes);
      if (error !== null) throw new FalhaDeUpdate(codigoDe(error.value));
      return data;
    },
    onSuccess: (estado) => { qc.setQueryData(chave, estado); },
  });
}

/**
 * Dispara o redeploy.
 *
 * **A resposta chega antes de o servidor morrer** — o Dokploy só confirma que
 * recebeu o pedido. Quem espera ele voltar é `esperarServidorVoltar`.
 */
export function useDispararUpdate() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const { error } = await api.api.meta.update.post();
      if (error !== null) throw new FalhaDeUpdate(codigoDe(error.value));
    },
    onSuccess: invalidar,
  });
}

const espera = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Tempo antes da primeira pergunta — ver o comentário em `esperarServidorVoltar`. */
const CARENCIA_MS = 6_000;
const INTERVALO_MS = 2_000;

/**
 * Espera o container voltar depois do redeploy.
 *
 * A carência inicial não é enfeite: durante os primeiros segundos **o servidor
 * velho ainda está de pé**, porque o Dokploy leva um tempo para puxar a imagem
 * e recriar o container. Perguntar imediatamente pega esse servidor, conclui
 * "já voltou" e recarrega a página na versão antiga — a atualização pareceria
 * não ter acontecido.
 *
 * Usa `fetch` cru, e não o Eden: o que se quer aqui é justamente a requisição
 * que **falha** enquanto o container sobe, sem cache e sem o tratamento de erro
 * global do cliente tipado.
 */
export async function esperarServidorVoltar(limiteMs: number): Promise<boolean> {
  const limite = Date.now() + limiteMs;
  await espera(CARENCIA_MS);

  while (Date.now() < limite) {
    try {
      const res = await fetch("/api/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return true;
    } catch {
      // Conexão recusada é o esperado enquanto o container não subiu.
    }
    await espera(INTERVALO_MS);
  }
  return false;
}
