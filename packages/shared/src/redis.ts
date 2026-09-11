import { t, type Static } from "elysia";

/**
 * Edição **estruturada** de uma chave de coleção do Redis (hash/list/set/zset).
 *
 * A grade edita a chave `string` inteira (`SET`), mas um `hash`/`list`/`set`/
 * `zset` não tem "um valor" para sobrescrever de uma célula — reescrevê-lo a
 * partir do JSON renderado perderia ordem, tipo e campos. Esta é a operação que
 * mexe num **membro** da coleção, pelo comando certo do tipo:
 *
 * - `hash`  → `HSET`/`HDEL` de um campo;
 * - `set`   → `SADD`/`SREM` de um membro;
 * - `zset`  → `ZADD`/`ZREM` de um membro (com score);
 * - `list`  → `LSET` de um índice, `LPUSH`/`RPUSH` de um item, `LREM` por valor.
 *
 * ## A guarda otimista
 *
 * Onde há um valor anterior a conferir (`hash-set` sobre campo existente,
 * `list-set` de um índice), o `from` traz o que a tela leu; o servidor confere
 * antes de escrever e recusa se mudou (o mesmo contrato do `WHERE` do UPDATE nas
 * engines SQL). Onde a operação é idempotente por natureza (`set-add` de um
 * membro, `hash-del`), não há o que conferir.
 *
 * `readOnly: false` é exigido como no resto da edição: campo ausente tem que
 * significar o estado seguro.
 */

/** Comprimento máximo de campo/membro/valor numa edição estruturada. */
const MAX = 100_000;

const Op = t.Union([
  // hash
  t.Object({
    kind: t.Literal("hash-set"),
    field: t.String({ minLength: 1, maxLength: MAX }),
    value: t.String({ maxLength: MAX }),
    /** Valor anterior do campo, ou `null` se o campo não existia (guarda). */
    from: t.Union([t.String(), t.Null()]),
  }),
  t.Object({ kind: t.Literal("hash-del"), field: t.String({ minLength: 1, maxLength: MAX }) }),
  // set
  t.Object({ kind: t.Literal("set-add"), member: t.String({ maxLength: MAX }) }),
  t.Object({ kind: t.Literal("set-del"), member: t.String({ maxLength: MAX }) }),
  // zset
  t.Object({
    kind: t.Literal("zset-add"),
    member: t.String({ maxLength: MAX }),
    /** Score como texto (regra 10); o servidor valida que é número. */
    score: t.String({ minLength: 1, maxLength: 64 }),
    /** Score anterior do membro, ou `null` se é membro novo (guarda otimista). */
    from: t.Union([t.String(), t.Null()]),
  }),
  t.Object({ kind: t.Literal("zset-del"), member: t.String({ maxLength: MAX }) }),
  // list
  t.Object({
    kind: t.Literal("list-set"),
    index: t.Integer({ minimum: 0, maximum: 1_000_000_000 }),
    value: t.String({ maxLength: MAX }),
    /** Valor anterior no índice (guarda otimista). */
    from: t.String({ maxLength: MAX }),
  }),
  t.Object({
    kind: t.Literal("list-push"),
    side: t.Union([t.Literal("left"), t.Literal("right")]),
    value: t.String({ maxLength: MAX }),
  }),
  /**
   * Remove o elemento **daquele índice** (não por valor): `LSET` num sentinel
   * único seguido de `LREM` do sentinel. `LREM key 1 value` removeria a primeira
   * ocorrência, que numa lista com valores repetidos é o elemento errado.
   */
  t.Object({
    kind: t.Literal("list-del"),
    index: t.Integer({ minimum: 0, maximum: 1_000_000_000 }),
    /** Valor anterior no índice (guarda otimista). */
    from: t.String({ maxLength: MAX }),
  }),
]);
export type RedisValueOp = Static<typeof Op>;

export const RedisValueEditRequest = t.Object({
  /** O db numerado do Redis, como `db0` (o "database" da árvore). */
  database: t.String({ minLength: 1, maxLength: 100 }),
  key: t.String({ minLength: 1, maxLength: MAX }),
  op: Op,
  readOnly: t.Literal(false),
});
export type RedisValueEditRequest = Static<typeof RedisValueEditRequest>;
