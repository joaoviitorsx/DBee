import type { VpnList } from "@dbee/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { erroDaResposta } from "../auth/useSession";

/** VPN por pessoa (ADR 014): tudo aqui é sobre o túnel de quem está logado. */
const chave = ["vpn"] as const;

/**
 * Estado dos perfis. Atualiza a cada 15 s: a VPN pode cair por fora
 * (renegociação, concentrador reiniciado, túnel ocioso fechado).
 */
export function useVpns() {
  return useQuery({
    queryKey: chave,
    queryFn: async (): Promise<VpnList> => {
      const { data, error } = await api.api.vpn.get();
      if (error !== null) throw erroDaResposta(error, "não foi possível ler o estado da VPN");
      return data;
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

/** Toda ação devolve a lista nova; grava no cache em vez de refazer o GET. */
function useAcao<A>(fn: (args: A) => Promise<VpnList>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (lista) => { qc.setQueryData(chave, lista); },
    // Túnel novo destrava árvore e consultas que falharam com vpn_disconnected.
    onSettled: () => qc.invalidateQueries(),
  });
}

export const useEnviarOvpn = () =>
  useAcao(async ({ perfil, ovpn }: { perfil: string; ovpn: string }) => {
    const { data, error } = await api.api.vpn({ perfil }).arquivo.put({ ovpn });
    if (error !== null) throw erroDaResposta(error, "não foi possível salvar o arquivo");
    return data;
  });

export const useRemoverOvpn = () =>
  useAcao(async (perfil: string) => {
    const { data, error } = await api.api.vpn({ perfil }).arquivo.delete();
    if (error !== null) throw erroDaResposta(error, "não foi possível remover o arquivo");
    return data;
  });

/** Conectar: `codigo` sempre; `usuario`/`senha` só quando não há credencial lembrada. */
export interface PedidoConectar {
  readonly perfil: string;
  readonly codigo: string;
  readonly usuario?: string;
  readonly senha?: string;
  readonly lembrar?: boolean;
}

export const useConectarVpn = () =>
  useAcao(async ({ perfil, ...corpo }: PedidoConectar) => {
    const { data, error } = await api.api.vpn({ perfil }).conectar.post(corpo);
    if (error !== null) throw erroDaResposta(error, "não foi possível conectar a VPN");
    return data;
  });

export const useEsquecerCredencial = () =>
  useAcao(async (perfil: string) => {
    const { data, error } = await api.api.vpn({ perfil }).credencial.delete();
    if (error !== null) throw erroDaResposta(error, "não foi possível esquecer a senha");
    return data;
  });

export const useDesconectarVpn = () =>
  useAcao(async (perfil: string) => {
    const { data, error } = await api.api.vpn({ perfil }).desconectar.post();
    if (error !== null) throw erroDaResposta(error, "não foi possível desconectar a VPN");
    return data;
  });
