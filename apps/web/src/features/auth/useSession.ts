import type { SessionUser } from "@dbee/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { sessionKey } from "../../lib/query";

/**
 * A sessão do usuário.
 *
 * `GET /auth/me` responde 401 quando não há sessão — o 401 **não é erro**, é a
 * resposta. Tratá-lo como falha faria o app mostrar "erro ao carregar" na
 * situação mais normal que existe: ninguém entrou ainda.
 *
 * A chave vem de `lib/query` porque o cache global precisa dela para se
 * excluir do próprio tratamento de erro.
 */
export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async (): Promise<SessionUser | null> => {
      const { data, error } = await api.api.auth.me.get();
      if (error !== null) {
        if (error.status === 401) return null;
        throw new Error("não foi possível verificar a sessão");
      }
      return data.user;
    },
    // Sem retry: 401 é resposta, e insistir só atrasa a tela de login.
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Erro de API que **preserva o `code`** da resposta.
 *
 * O código é o que permite traduzir a mensagem por `mensagemDoCodigo` (i18n):
 * o `message` cru do servidor é o fallback, mas quando há tradução para o
 * código ela vence. Guardar só a string perderia essa chance.
 */
export class ErroApi extends Error {
  readonly code: string | undefined;
  constructor(code: string | undefined, message: string) {
    super(message);
    this.name = "ErroApi";
    this.code = code;
  }
}

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

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (credenciais: { username: string; password: string }) => {
      const { data, error } = await api.api.auth.login.post(credenciais);
      if (error !== null) throw erroDaResposta(error, "não foi possível entrar");
      return data.user;
    },
    onSuccess: (user) => {
      qc.setQueryData(sessionKey, user);
      // Qualquer consulta que tenha rodado antes da sessão está com 401 em
      // cache. Hoje o portão impede que isso aconteça (os hooks de dados vivem
      // dentro dele), mas invalidar aqui é o que mantém verdade se alguém
      // acrescentar um hook fora — e custa uma passada no cache.
      void qc.invalidateQueries();
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.api.auth.logout.post();
    },
    onSuccess: () => {
      /*
       * A ordem é o conserto.
       *
       * Era `qc.clear()` e depois `setQueryData(sessionKey, null)` — e o
       * `clear()` **remove a própria consulta de sessão**, então o valor
       * escrito na linha seguinte entrava numa consulta recém-criada que o
       * `useSession` já tinha marcado para buscar. O portão só trocava para o
       * login quando o `/auth/me` voltava 401, ou no F5. Parecia lentidão de
       * rede; era ordem errada.
       *
       * Agora a sessão vira `null` **primeiro**, o que troca a tela no mesmo
       * quadro, e só então o resto do cache é descartado — sem tocar na chave
       * de sessão, para não desfazer o que acabou de ser escrito.
       */
      qc.setQueryData(sessionKey, null);

      // As conexões, as árvores e os resultados são dados de quem saiu:
      // deixá-los faria a próxima pessoa ver a tela da anterior por um instante.
      qc.removeQueries({
        predicate: (consulta) => consulta.queryKey[0] !== sessionKey[0],
      });
    },
  });
}

/**
 * Grava o idioma escolhido no usuário.
 *
 * Otimista não é preciso: o `IdiomaProvider` já trocou a UI localmente antes de
 * chamar isto. Aqui só persiste e reconcilia o cache da sessão com o usuário
 * devolvido — se o servidor recusar, o `/me` na próxima montagem corrige.
 */
export function useDefinirIdioma() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (locale: "pt" | "en") => {
      const { data, error } = await api.api.auth.locale.patch({ locale });
      if (error !== null) throw erroDaResposta(error, "não foi possível trocar o idioma");
      return data.user;
    },
    onSuccess: (user) => {
      qc.setQueryData(sessionKey, user);
    },
  });
}

export function useTrocarSenha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (senhas: { currentPassword: string; newPassword: string }) => {
      const { data, error } = await api.api.auth.password.post(senhas);
      if (error !== null) throw erroDaResposta(error, "não foi possível trocar a senha");
      return data.user;
    },
    onSuccess: () => {
      // A troca derruba todas as sessões no servidor, inclusive esta. Voltar
      // para o login é o estado verdadeiro, e fingir o contrário daria 401 no
      // próximo clique sem explicação. Mesma ordem do logout, pelo mesmo
      // motivo: `clear()` antes apagaria a chave que a linha seguinte escreve.
      qc.setQueryData(sessionKey, null);
      qc.removeQueries({
        predicate: (consulta) => consulta.queryKey[0] !== sessionKey[0],
      });
    },
  });
}
