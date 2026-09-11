import type { ConnectionWarning, TestConnectionResult } from "@dbee/shared";

import type { ResolvedConnection } from "../db/connections.repo";
import { ErroLibsql, executarSql, type AlvoLibsql } from "./cliente";
import { paraTexto } from "./protocolo";

/**
 * Testar uma conexão libSQL — e dizer o que o token **permite**.
 *
 * ## Por que a permissão é lida do token, e não sondada no servidor
 *
 * A garantia de somente-leitura do libSQL é o claim `"a":"ro"` do JWT, aplicado
 * **pelo servidor**. Medido (`docs/multi-engine.md` §3e): com um token `ro`,
 * `INSERT`, `UPDATE`, `DELETE`, `DROP TABLE`, `CREATE TABLE`,
 * `PRAGMA query_only = OFF` e `ATTACH DATABASE` são todos bloqueados, e os
 * dados ficaram intactos depois da bateria.
 *
 * Descobrir isso por sondagem exigiria **tentar escrever**, e um teste de
 * conexão que escreve no banco de alguém está fora de questão. O claim está no
 * próprio token, que já está aqui: basta lê-lo.
 *
 * Ler não é validar. A assinatura não é conferida (não temos a chave, e não é
 * nossa função) — se o token for falso ou expirado, o servidor recusa e o teste
 * falha com a mensagem dele. O claim serve para **avisar**, e avisar a mais é
 * barato: um token que não diz `ro` pode gravar, e é isso que a pessoa precisa
 * saber antes de confiar no "modo leitura" da tela.
 */

/** O corpo de um JWT, sem conferir assinatura. `null` se não for um. */
function claimsDe(token: string): Record<string, unknown> | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const corpo = partes[1] ?? "";
    // base64url → base64, com o preenchimento que o JWT omite.
    const base64 = corpo.replaceAll("-", "+").replaceAll("_", "/");
    const texto = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const json: unknown = JSON.parse(texto);
    return typeof json === "object" && json !== null ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * O token concede escrita?
 *
 * `"a": "ro"` é o único valor que restringe. Ausência do claim significa acesso
 * total — é o padrão do `sqld` —, e um token que não é JWT (ou que não parseia)
 * também cai aqui: na dúvida, **avisa**. Um aviso a mais custa uma linha na
 * tela; um a menos custa a confiança num modo leitura que não existe.
 */
export function tokenGrava(token: string | null): boolean {
  if (token === null || token.trim() === "") return true;
  const claims = claimsDe(token);
  return claims?.["a"] !== "ro";
}

function avisosDe(token: string | null): ConnectionWarning[] {
  if (!tokenGrava(token)) return [];

  return [
    {
      code: "credential_can_write",
      message:
        token === null || token.trim() === ""
          ? "Este servidor libSQL está sem token. Sem SQLD_AUTH_JWT_KEY do outro " +
            "lado, qualquer um que alcance a URL escreve no banco, e o modo " +
            "leitura do DBee aqui é uma convenção da tela — não uma barreira do " +
            "servidor."
          : "Este token permite escrita. No libSQL a garantia de somente-leitura " +
            "é o claim \"a\":\"ro\" do JWT, aplicado pelo servidor — e ele é " +
            "forte: medido, cobre INSERT, UPDATE, DELETE, DROP TABLE, " +
            "CREATE TABLE e até PRAGMA query_only = OFF. Para leitura de " +
            "verdade, gere um token com esse claim.",
    },
  ];
}

export async function testConnectionLibsql(
  connection: ResolvedConnection,
  alvo: AlvoLibsql,
): Promise<TestConnectionResult> {
  const inicio = performance.now();
  const decorrido = (): number => Math.round(performance.now() - inicio);

  try {
    /*
     * `sqlite_version()` e não `SELECT 1`: ela prova que há um SQLite do outro
     * lado, e a versão é o que a tela mostra. Um endpoint HTTP qualquer que
     * responda 200 falharia aqui, que é o desejado.
     */
    const [saida] = await executarSql(alvo, [{ sql: "SELECT sqlite_version() AS v" }]);
    const celula = saida?.rows[0]?.[0];
    const versao = celula === undefined ? "desconhecida" : (paraTexto(celula) ?? "desconhecida");

    return {
      ok: true,
      serverVersion: `SQLite ${versao} (libSQL)`,
      durationMs: decorrido(),
      warnings: avisosDe(connection.password === "" ? null : connection.password),
    };
  } catch (err: unknown) {
    // O erro do servidor vai inteiro para a UI — ele diz "Expected
    // authorization header but none given" ou "Current session doesn't have
    // Write permission", e as duas são exatamente o que a pessoa precisa ler.
    // Nunca incluir o token.
    return {
      ok: false,
      code: err instanceof ErroLibsql ? err.code : null,
      message: err instanceof Error ? err.message : String(err),
      durationMs: decorrido(),
    };
  }
}
