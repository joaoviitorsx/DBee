import type { MongoClient } from "mongodb";

import type { ConnectionWarning, TestConnectionResult } from "@dbee/shared";
import type { ResolvedConnection } from "../db/connections.repo";
import { ClienteMongo } from "./cliente";

/**
 * Testar uma conexão MongoDB — e dizer o que a credencial **pode**.
 *
 * A garantia de somente-leitura do Mongo é o **papel** do usuário (`read`
 * contra `readWrite`), não uma transação. Então o teste faz o análogo do que o
 * MySQL faz: conecta, pega a versão, e olha os papéis da credencial para avisar
 * quando ela pode escrever — o "modo leitura" da tela é convenção quando a
 * credencial grava.
 *
 * `authSource` é o que mais falha aqui: um usuário criado em `zzapp` não
 * autentica contra `admin`. O erro do servidor sobe inteiro, e ele diz
 * "Authentication failed" com o `authSource` que tentou — é o que a pessoa
 * precisa ler.
 */
export async function testConnectionMongo(
  connection: ResolvedConnection,
  caCert: string | undefined,
): Promise<TestConnectionResult> {
  const inicio = performance.now();
  const decorrido = (): number => Math.round(performance.now() - inicio);

  // Cliente efêmero, próprio do teste: não entra no cache do driver.
  const gerente = new ClienteMongo(caCert);
  try {
    const cliente = await gerente.leitura(connection);
    const info = (await cliente.db("admin").admin().serverInfo()) as { version?: unknown };
    const versao = typeof info.version === "string" ? info.version : "desconhecida";
    const warnings = await avisos(cliente, connection);
    return { ok: true, serverVersion: `MongoDB ${versao}`, durationMs: decorrido(), warnings };
  } catch (err: unknown) {
    // O erro do servidor vai inteiro para a UI. Nunca inclui a senha (ela vai
    // nas opções de `auth`, não na URI nem na mensagem).
    return {
      ok: false,
      code: codigo(err),
      message: err instanceof Error ? err.message : String(err),
      durationMs: decorrido(),
    };
  } finally {
    await gerente.desligar();
  }
}

/**
 * Avisa quando a credencial pode escrever.
 *
 * Lê `connectionStatus`, que devolve os papéis do usuário autenticado sem
 * privilégio especial. Um papel `readWrite`, `dbOwner`, `root` ou similar
 * grava; `read` não. Se a checagem falhar (papel sem acesso a `connectionStatus`
 * — raro), não avisa: melhor calar que barrar o teste.
 */
async function avisos(cliente: MongoClient, connection: ResolvedConnection): Promise<ConnectionWarning[]> {
  try {
    const status = (await cliente.db(connection.authSource ?? "admin").command({
      connectionStatus: 1,
    })) as { authInfo?: { authenticatedUserRoles?: { role?: string }[] } };
    const papeis = (status.authInfo?.authenticatedUserRoles ?? [])
      .map((r) => r.role)
      .filter((r): r is string => typeof r === "string");

    const gravam = papeis.filter((p) => PAPEIS_DE_ESCRITA.has(p) || /write|owner|admin|root/i.test(p));
    if (gravam.length === 0) return [];

    return [
      {
        code: "credential_can_write",
        message:
          "Esta credencial tem papel de escrita (" +
          [...new Set(gravam)].join(", ") +
          "). No MongoDB não existe transação somente-leitura que impeça isso; a " +
          "garantia é o papel do usuário. O modo leitura do DBee aqui é convenção " +
          "da tela. Para leitura de verdade, conecte com um usuário de papel `read`.",
      },
    ];
  } catch {
    return [];
  }
}

/** Papéis embutidos do Mongo que concedem escrita. */
const PAPEIS_DE_ESCRITA = new Set([
  "readWrite",
  "readWriteAnyDatabase",
  "dbOwner",
  "dbAdmin",
  "dbAdminAnyDatabase",
  "userAdmin",
  "userAdminAnyDatabase",
  "clusterAdmin",
  "root",
  "__system",
]);

function codigo(err: unknown): string | null {
  if (typeof err === "object" && err !== null) {
    const e = err as { codeName?: unknown; code?: unknown };
    if (typeof e.codeName === "string") return e.codeName;
    if (typeof e.code === "number") return String(e.code);
  }
  return null;
}
