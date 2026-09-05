import { QueryCache, QueryClient } from "@tanstack/react-query";

/** A chave da sessão mora aqui para o cache global poder se excluir dela. */
export const sessionKey = ["session"] as const;

export const queryClient = new QueryClient({
  /*
   * Sessão que expirou com a aba aberta.
   *
   * O DBee fica aberto o dia inteiro e a sessão dura 12 horas — então ela vence
   * **durante** o uso, não entre usos. Sem isto, a primeira requisição depois
   * da expiração viraria "erro ao carregar" numa tela qualquer, e a pessoa
   * ficaria clicando em "tentar de novo" numa sessão que já não existe.
   *
   * Qualquer falha revalida a sessão: se ela caiu, o portão troca para o login
   * sozinho; se estava boa, o custo é um `/auth/me`. A chave da própria sessão
   * fica de fora, senão o erro dela se realimentaria.
   */
  queryCache: new QueryCache({
    onError: (_erro, query) => {
      if (query.queryKey[0] === sessionKey[0]) return;
      void queryClient.invalidateQueries({ queryKey: sessionKey });
    },
  }),
  defaultOptions: {
    queries: {
      // Metadado de conexão muda pouco e só por ação nossa.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const connectionsKey = ["connections"] as const;
