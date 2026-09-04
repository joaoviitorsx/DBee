import { Elysia } from "elysia";

/**
 * Tratamento de erro do app inteiro.
 *
 * **Existe por causa de um vazamento real:** o formato de erro padrão do Elysia
 * inclui um campo `found` com o corpo submetido inteiro. Num `POST
 * /connections` com qualquer campo inválido — uma porta fora de faixa, um nome
 * longo demais — a resposta 422 devolvia a senha do banco em claro:
 *
 *     "found": { "username": "u", "password": "SenhaDeProducao123", "port": 99999 }
 *
 * Isso vai para o devtools, para o HAR, para qualquer log de corpo de resposta
 * e para o proxy no caminho. Viola a regra 5 do CLAUDE.md e o §7 do DBee.md.
 *
 * A resposta agora diz **qual** propriedade falhou e **por quê**, e nunca o
 * valor. O caminho de erro não é lugar de eco de entrada.
 */
export const errorHandler = new Elysia({ name: "error-handler" }).onError(
  // `as: "global"` é obrigatório: hook de plugin é local por padrão, e sem
  // isto as rotas do app pai continuam com o formato de erro do Elysia — que
  // é exatamente o que ecoa a senha.
  { as: "global" },
  ({ code, error, status }) => {
    if (code === "VALIDATION") {
      // `error.all` traz um item por violação; só o caminho e a regra saem.
      const problemas = Array.isArray(error.all)
        ? error.all
            .map((v) => ("path" in v && typeof v.path === "string" ? v.path : "corpo"))
            .filter((p, i, todos) => todos.indexOf(p) === i)
        : [];

      return status(422, {
        code: "validation_failed",
        message:
          problemas.length > 0
            ? `entrada inválida em: ${problemas.join(", ")}`
            : "entrada inválida",
      });
    }

    if (code === "NOT_FOUND") {
      return status(404, { code: "not_found", message: "rota não encontrada" });
    }

    if (code === "PARSE") {
      return status(400, { code: "malformed_body", message: "corpo não é JSON válido" });
    }

    // Qualquer outra coisa: nada do erro original atravessa. O que for
    // acionável já virou falha tipada na camada de serviço.
    return status(500, { code: "internal_error", message: "erro interno" });
  },
);
