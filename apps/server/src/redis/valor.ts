import type { RedisClient } from "bun";

import type { RedisValueEditRequest, RowMutationResult } from "@dbee/shared";

import { MutacaoError } from "../driver/erros";

/**
 * Edição estruturada de uma coleção do Redis — o comando certo por tipo.
 *
 * Cada op vira o comando nativo do seu tipo (`HSET`, `SADD`, `ZADD`, `LSET`…),
 * não a reescrita do valor inteiro. A guarda otimista, onde há valor anterior a
 * conferir (`hash-set` sobre campo existente, `list-set` de um índice), devolve
 * `rowCount: 0` se o valor mudou desde a leitura — o `#viaDriver` traduz isso em
 * conflito (`row_changed`), como a prova de cardinalidade das engines SQL. As
 * ops sem valor anterior a conferir devolvem `rowCount: 1` quando o comando roda
 * (o estado final é o pedido), e o `sql` carrega o comando literal para a
 * auditoria.
 *
 * O valor trafega como texto (regra 10); o `score` do `zset` é validado como
 * número antes de ir ao `ZADD`.
 */

/** `rowCount: 0` + o motivo no `sql` — o `#viaDriver` reporta como `row_changed`. */
function conflito(motivo: string): RowMutationResult {
  return { rowCount: 0, sql: `-- ${motivo}` };
}

export async function editarValor(
  cliente: RedisClient,
  req: RedisValueEditRequest,
): Promise<RowMutationResult> {
  const { key, op } = req;

  switch (op.kind) {
    case "hash-set": {
      // Guarda: o campo tem que estar como a tela leu (null = não existia).
      const atual = (await cliente.send("HGET", [key, op.field])) as string | null;
      if (atual !== op.from) return conflito(`o campo ${op.field} de ${key} mudou desde a leitura`);
      await cliente.send("HSET", [key, op.field, op.value]);
      return { rowCount: 1, sql: `HSET ${key} ${op.field} ${JSON.stringify(op.value)}` };
    }
    case "hash-del": {
      await cliente.send("HDEL", [key, op.field]);
      return { rowCount: 1, sql: `HDEL ${key} ${op.field}` };
    }
    case "set-add": {
      await cliente.send("SADD", [key, op.member]);
      return { rowCount: 1, sql: `SADD ${key} ${JSON.stringify(op.member)}` };
    }
    case "set-del": {
      await cliente.send("SREM", [key, op.member]);
      return { rowCount: 1, sql: `SREM ${key} ${JSON.stringify(op.member)}` };
    }
    case "zset-add": {
      const score = Number(op.score);
      if (!Number.isFinite(score)) {
        throw new MutacaoError(`score inválido: '${op.score}' não é um número`);
      }
      await cliente.send("ZADD", [key, op.score, op.member]);
      return { rowCount: 1, sql: `ZADD ${key} ${op.score} ${JSON.stringify(op.member)}` };
    }
    case "zset-del": {
      await cliente.send("ZREM", [key, op.member]);
      return { rowCount: 1, sql: `ZREM ${key} ${JSON.stringify(op.member)}` };
    }
    case "list-set": {
      // Guarda: o índice tem que estar como a tela leu. `LINDEX` fora de faixa
      // devolve null, que não bate com o `from` de um índice real.
      const atual = (await cliente.send("LINDEX", [key, String(op.index)])) as string | null;
      if (atual !== op.from) {
        return conflito(`o índice ${String(op.index)} de ${key} mudou desde a leitura`);
      }
      // `LSET` fora de faixa estoura ("index out of range"); o erro sobe à tela.
      await cliente.send("LSET", [key, String(op.index), op.value]);
      return { rowCount: 1, sql: `LSET ${key} ${String(op.index)} ${JSON.stringify(op.value)}` };
    }
    case "list-push": {
      const comando = op.side === "left" ? "LPUSH" : "RPUSH";
      await cliente.send(comando, [key, op.value]);
      return { rowCount: 1, sql: `${comando} ${key} ${JSON.stringify(op.value)}` };
    }
    case "list-del": {
      // Remove a primeira ocorrência do valor (`LREM key 1 value`).
      await cliente.send("LREM", [key, "1", op.value]);
      return { rowCount: 1, sql: `LREM ${key} 1 ${JSON.stringify(op.value)}` };
    }
  }
}
