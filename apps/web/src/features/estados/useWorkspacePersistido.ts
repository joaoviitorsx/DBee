import { useEffect } from "react";

import {
  chaveWorkspace,
  restaurarWorkspace,
  serializarWorkspace,
  type Workspace,
} from "../../app/workspace";
import { useSession } from "../auth/useSession";

/**
 * Workspace que sobrevive a reload e a re-login (F8, ui-detalhes §3.7).
 *
 * Guardado por usuário no `localStorage` do navegador — preferência pessoal de
 * layout, não estado do time, então não vai para o servidor. Toda leitura e
 * escrita em try/catch: aba privada ou cota cheia não podem derrubar o app,
 * no pior caso o workspace só não persiste.
 *
 * Dividido em "inicial" + "guardar" para o `useState` continuar no AppShell —
 * o `setWs` do próprio React é o que os callbacks de lá já usam como estável.
 */
export function useWorkspaceInicial(): () => Workspace {
  const userId = useSession().data?.id ?? null;
  return () => {
    if (userId === null) return restaurarWorkspace(null);
    try {
      return restaurarWorkspace(localStorage.getItem(chaveWorkspace(userId)));
    } catch {
      return restaurarWorkspace(null);
    }
  };
}

export function useGuardarWorkspace(ws: Workspace): void {
  // Com a sessão vencida o id some (null): não grava, para não sobrescrever o
  // guardado de ninguém enquanto o login está por cima das abas.
  const userId = useSession().data?.id ?? null;
  useEffect(() => {
    if (userId === null) return;
    try {
      localStorage.setItem(chaveWorkspace(userId), serializarWorkspace(ws));
    } catch {
      // sem armazenamento: segue sem persistir (comentário acima)
    }
  }, [ws, userId]);
}
