import { t, type Static } from "elysia";

/**
 * Qual banco está do outro lado da conexão.
 *
 * ## Por que isto existe antes de existir a segunda engine
 *
 * O DBee só fala Postgres. Introduzir `engine` agora, com um valor só, é o que
 * torna barata a fase seguinte: o formulário, o repositório e a resposta da API
 * passam a carregar o campo enquanto ainda é possível verificar que **nada
 * mudou** — a suíte passa sem alteração de teste e os screenshots batem. Fazer
 * isso junto com a primeira engine nova misturaria "o campo existe" com "o
 * campo funciona", e nenhuma das duas ficaria verificável sozinha.
 *
 * ## Imutável depois de criada
 *
 * `engine` entra em `CreateConnection` e **não** entra em `UpdateConnection`.
 * Não é preferência de UI, é o ADR 005: a senha é cifrada com AAD amarrado ao
 * **id**, então um `PATCH` que trocasse a engine mantendo `password_enc`
 * continuaria decifrando e passaria a mandar o segredo para outro tipo de
 * servidor. O ADR 005 aceitou que editar host é operação normal; editar engine
 * não é.
 */
export const Engine = t.Union(
  [
    t.Literal("postgres"),
    t.Literal("mysql"),
    t.Literal("mariadb"),
    t.Literal("sqlite"),
    t.Literal("libsql"),
    t.Literal("mongodb"),
    t.Literal("redis"),
  ],
  { description: "qual banco está do outro lado da conexão" },
);
export type Engine = Static<typeof Engine>;


/**
 * `EscopoReadOnly` como schema, para quando uma rota precisar declará-lo.
 * A definição em TIPO, e a tabela de capacidades, vivem em `engine.puro.ts` —
 * elas não precisam de TypeBox, e o front as importa sem levar a Elysia junto
 * (ver `puro.ts`).
 */
export const EscopoReadOnlySchema = t.Union([
  t.Literal("transacao"),
  t.Literal("handle"),
  t.Literal("credencial"),
]);

export * from "./engine.puro";
