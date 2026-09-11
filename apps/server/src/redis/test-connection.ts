import type { ConnectionWarning, TestConnectionResult } from "@dbee/shared";

import { ClienteRedis } from "./cliente";
import type { ResolvedConnection } from "../db/connections.repo";

/**
 * Testar uma conexão Redis — e a sonda **não pode ser `PING`**.
 *
 * Medido: uma credencial `+@read` (a mais restrita e a correta para leitura)
 * recebe `NOPERM` em `PING` e em `SELECT`. Uma sonda de `PING` falharia
 * justamente na credencial que a gente quer incentivar. A sonda é `DBSIZE`, que
 * `+@read` inclui — se ela responde, há um Redis do outro lado e a credencial
 * lê. O `INFO server` dá a versão quando permitido; quando não, a conexão ainda
 * é válida e a versão fica "desconhecida".
 *
 * A garantia de somente-leitura é a **ACL** do usuário (`+@read` contra
 * `+@all`). Não há transação. Como no MySQL, o teste avisa quando a credencial
 * pode escrever — mas ler a ACL própria (`ACL WHOAMI`/`ACL GETUSER`) também
 * pode ser negado, então o aviso é best-effort.
 */
export async function testConnectionRedis(
  connection: ResolvedConnection,
  caCert: string | undefined,
): Promise<TestConnectionResult> {
  const inicio = performance.now();
  const decorrido = (): number => Math.round(performance.now() - inicio);

  const clientes = new ClienteRedis(caCert);
  try {
    const cliente = await clientes.cliente(connection, 0);
    // A sonda: `DBSIZE` está em `+@read`. Se responde, a credencial lê.
    await cliente.send("DBSIZE", []);

    let versao = "desconhecida";
    try {
      const info = (await cliente.send("INFO", ["server"])) as string;
      const m = /redis_version:([^\r\n]+)/.exec(info);
      if (m?.[1] !== undefined) versao = m[1].trim();
    } catch {
      // `INFO` pode ser negado; a conexão continua válida.
    }

    return {
      ok: true,
      serverVersion: `Redis ${versao}`,
      durationMs: decorrido(),
      warnings: await avisos(clientes, connection),
    };
  } catch (err: unknown) {
    return {
      ok: false,
      code: codigo(err),
      message: err instanceof Error ? err.message : String(err),
      durationMs: decorrido(),
    };
  } finally {
    clientes.desligar();
  }
}

/** Avisa quando a ACL da credencial permite escrita. Best-effort. */
async function avisos(
  clientes: ClienteRedis,
  connection: ResolvedConnection,
): Promise<ConnectionWarning[]> {
  try {
    const cliente = await clientes.cliente(connection, 0);
    const eu = (await cliente.send("ACL", ["WHOAMI"])) as string;
    const regras = (await cliente.send("ACL", ["GETUSER", eu])) as unknown[];
    // `ACL GETUSER` devolve pares; procura o campo "commands", cujo texto lista
    // as categorias. `+@all` ou `+@write` (sem um `-@write` depois) = grava.
    const texto = JSON.stringify(regras);
    const grava = /\+@all|\+@write|\+@dangerous/.test(texto) && !texto.includes("-@write");
    if (!grava) return [];
    return [
      {
        code: "credential_can_write",
        message:
          "Esta credencial pode escrever no Redis (a ACL inclui categoria de " +
          "escrita). Não há transação somente-leitura no Redis; a garantia é a " +
          "ACL. Para leitura de verdade, use um usuário com apenas +@read.",
      },
    ];
  } catch {
    // `ACL WHOAMI`/`GETUSER` podem ser negados; sem aviso, então.
    return [];
  }
}

function codigo(err: unknown): string | null {
  if (typeof err === "object" && err !== null) {
    const e = err as { code?: unknown };
    if (typeof e.code === "string") return e.code;
  }
  return null;
}
