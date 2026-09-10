import type { RedisClient } from "bun";

import type {
  RowDeleteRequest,
  RowInsertRequest,
  RowMutationResult,
  RowUpdateRequest,
} from "@dbee/shared";

import { MutacaoError } from "../driver/erros";

/**
 * Edição de chave no Redis, pela credencial de escrita.
 *
 * A grade do Redis é uma linha por chave, com colunas `key`, `type`, `ttl`,
 * `value`. A edição segue o que essa forma permite **com segurança no v1**:
 *
 * - **excluir** uma chave → `DEL key`. Direto e sem ambiguidade.
 * - **editar** a coluna `value` de uma chave `string` → `SET key novo`. Só
 *   `string`: um `hash`/`list`/`set`/`zset` não tem "um valor" para sobrescrever
 *   de uma célula — reescrevê-lo a partir do JSON renderado seria adivinhação
 *   perigosa (perde ordem, tipos, campos). Esses tipos recusam aqui com mensagem
 *   clara e são editados membro a membro pelo **editor estruturado**
 *   (`redis/valor.ts`, rota `POST /redis/value`).
 * - **editar `ttl`** → `EXPIRE`/`PERSIST`. `-1` remove a expiração, um número
 *   positivo a define, `-2` não faz sentido (chave inexistente) e é recusado.
 * - **inserir** → `SET key value`, sempre como `string` (o tipo mais comum, e o
 *   único que a grade sabe montar).
 *
 * A guarda otimista: o `from`/`guard` traz o valor lido; antes de escrever,
 * confere que o valor atual bate. Se mudou, recusa (matchedCount 0 → conflito).
 */

/** A chave alvo, do `_id` (a coluna `key` é a PK do Redis). */
function chaveDe(pk: readonly { column: string; value: string }[]): string {
  const k = pk.find((p) => p.column === "key");
  if (k === undefined) throw new MutacaoError("a edição no Redis exige a chave (key)");
  return k.value;
}

export async function atualizar(
  cliente: RedisClient,
  req: RowUpdateRequest,
): Promise<RowMutationResult> {
  const key = chaveDe(req.pk);
  const tipo = (await cliente.send("TYPE", [key])) as string;
  let afetadas = 0;
  const partes: string[] = [];

  for (const c of req.changes) {
    if (c.column === "value") {
      if (tipo !== "string") {
        throw new MutacaoError(
          `só o valor de uma chave 'string' é editável pela grade; esta é '${tipo}'. ` +
            "Um hash/list/set/zset se edita membro a membro no editor estruturado " +
            "(duplo clique na coluna 'value').",
        );
      }
      // Guarda otimista: o valor atual tem que bater com o que a grade leu.
      const atual = (await cliente.send("GET", [key])) as string | null;
      if (atual !== c.from) return { rowCount: 0, sql: `-- valor de ${key} mudou desde a leitura` };
      await cliente.send("SET", [key, c.to ?? ""]);
      partes.push(`SET ${key} ${JSON.stringify(c.to)}`);
      afetadas = 1;
    } else if (c.column === "ttl") {
      const ttl = Number.parseInt(c.to ?? "", 10);
      if (c.to === "-1") {
        await cliente.send("PERSIST", [key]);
        partes.push(`PERSIST ${key}`);
      } else if (Number.isFinite(ttl) && ttl > 0) {
        await cliente.send("EXPIRE", [key, String(ttl)]);
        partes.push(`EXPIRE ${key} ${String(ttl)}`);
      } else {
        throw new MutacaoError("ttl inválido: use -1 (sem expiração) ou um número de segundos");
      }
      afetadas = 1;
    } else {
      // `key` e `type` não são editáveis — renomear/retipar é outra operação.
      throw new MutacaoError(`a coluna '${c.column}' não é editável no Redis`);
    }
  }

  return { rowCount: afetadas, sql: partes.join("; ") };
}

export async function excluir(
  cliente: RedisClient,
  req: RowDeleteRequest,
): Promise<RowMutationResult> {
  const key = chaveDe(req.pk);
  // Guarda: se a grade leu o valor de uma string, confere antes de apagar.
  const guardaValor = req.guard.find((g) => g.column === "value");
  if (guardaValor !== undefined) {
    const tipo = (await cliente.send("TYPE", [key])) as string;
    if (tipo === "string") {
      const atual = (await cliente.send("GET", [key])) as string | null;
      if (atual !== guardaValor.value) {
        return { rowCount: 0, sql: `-- ${key} mudou desde a leitura` };
      }
    }
  }
  const n = (await cliente.send("DEL", [key])) as number;
  return { rowCount: n, sql: `DEL ${key}` };
}

export async function inserir(
  cliente: RedisClient,
  req: RowInsertRequest,
): Promise<RowMutationResult> {
  const key = req.values.find((v) => v.column === "key")?.value;
  const value = req.values.find((v) => v.column === "value")?.value ?? "";
  if (key === undefined || key === null || key === "") {
    throw new MutacaoError("a nova chave precisa de um nome (key)");
  }
  // Sempre string no v1 — o tipo que a grade sabe montar.
  await cliente.send("SET", [key, value]);

  const ttlBruto = req.values.find((v) => v.column === "ttl")?.value;
  const ttl = Number.parseInt(ttlBruto ?? "", 10);
  if (Number.isFinite(ttl) && ttl > 0) await cliente.send("EXPIRE", [key, String(ttl)]);

  return { rowCount: 1, sql: `SET ${key} ${JSON.stringify(value)}` };
}
