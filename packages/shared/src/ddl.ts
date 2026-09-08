import { t, type Static } from "elysia";

import { sqlIdent, sqlValue } from "./export";

/**
 * DDL **aditivo** por formulário: criar tabela e criar database (ADR 010).
 *
 * ## A linha é aditivo × destrutivo, não DDL × não-DDL
 *
 * O ADR 006 proibia "DDL por botão", mas o teste que gerou essa regra é o 4 —
 * *a ação é reversível pelo próprio usuário, com o que ele vê na tela?* O
 * exemplo dele é `DROP TABLE`: nada na tela desfaz um DROP. Criar tabela vazia
 * ou database vazio é a metade oposta — some sem levar nada junto, e o que foi
 * criado está visível na árvore. `DROP` e `ALTER` que perde dado continuam
 * gerando SQL para o editor.
 *
 * ## Por que nada aqui aceita SQL livre
 *
 * Estas rotas montam o comando **no servidor** a partir de campos estruturados:
 * identificadores citados, tipos de uma lista fechada, defaults que são literal
 * ou uma expressão de uma lista fechada. Não existe caminho por onde texto do
 * cliente vire cláusula SQL arbitrária.
 *
 * Isso não é zelo excessivo: o `CREATE DATABASE` **não roda dentro de
 * transação** (medido: `ERROR: CREATE DATABASE cannot run inside a transaction
 * block`), então ele precisa de um caminho de execução fora do `BEGIN` do
 * ADR 001 — o único no app. Um caminho assim que aceitasse SQL livre seria uma
 * porta lateral em volta do read-only. Aceitando só um nome e algumas opções
 * fechadas, ele só sabe emitir a forma que foi escrito para emitir.
 */

/** Limite do Postgres para identificador (`NAMEDATALEN - 1`). */
export const MAX_IDENT = 63;

/**
 * Tipos oferecidos no formulário — lista **fechada**.
 *
 * Não é a lista completa do Postgres, e não deve ser: quem precisa de um tipo
 * exótico escreve o `CREATE TABLE` no editor, que é onde SQL livre pertence.
 * Aqui entra o que cobre uma tabela de trabalho.
 */
export const ColumnType = t.Union([
  t.Literal("bigserial"),
  t.Literal("serial"),
  t.Literal("bigint"),
  t.Literal("integer"),
  t.Literal("smallint"),
  t.Literal("numeric"),
  t.Literal("real"),
  t.Literal("double precision"),
  t.Literal("boolean"),
  t.Literal("text"),
  t.Literal("varchar"),
  t.Literal("char"),
  t.Literal("uuid"),
  t.Literal("date"),
  t.Literal("time"),
  t.Literal("timestamp"),
  t.Literal("timestamptz"),
  t.Literal("json"),
  t.Literal("jsonb"),
  t.Literal("bytea"),
  t.Literal("inet"),
]);
export type ColumnType = Static<typeof ColumnType>;

/** Tipos que aceitam `(n)` — o resto ignora o campo de tamanho. */
export const TIPOS_COM_TAMANHO: ReadonlySet<string> = new Set(["varchar", "char"]);

/** Tipos que aceitam `(p, s)`. */
export const TIPOS_COM_PRECISAO: ReadonlySet<string> = new Set(["numeric"]);

/** Serial já implica NOT NULL e um default próprio. */
export const TIPOS_SERIAIS: ReadonlySet<string> = new Set(["serial", "bigserial"]);

/**
 * Expressões aceitas como default, além de literal.
 *
 * Lista fechada porque default é a única parte do `CREATE TABLE` que seria uma
 * expressão SQL arbitrária. Quem precisa de outra escreve no editor.
 */
export const DefaultExpression = t.Union([
  t.Literal("now()"),
  t.Literal("current_date"),
  t.Literal("current_timestamp"),
  t.Literal("gen_random_uuid()"),
]);
export type DefaultExpression = Static<typeof DefaultExpression>;

export const NewColumn = t.Object({
  name: t.String({ minLength: 1, maxLength: MAX_IDENT }),
  type: ColumnType,
  /** `varchar(n)` / `char(n)` / `numeric(p, …)`. Ignorado nos demais tipos. */
  length: t.Optional(t.Integer({ minimum: 1, maximum: 10_000 })),
  /** Casas decimais de `numeric(p, s)`. */
  scale: t.Optional(t.Integer({ minimum: 0, maximum: 1000 })),
  notNull: t.Optional(t.Boolean()),
  primaryKey: t.Optional(t.Boolean()),
  unique: t.Optional(t.Boolean()),
  /** Literal — sai entre aspas simples, escapado. */
  defaultValue: t.Optional(t.String({ maxLength: 500 })),
  /** Expressão de lista fechada. Vence o `defaultValue` se os dois vierem. */
  defaultExpression: t.Optional(DefaultExpression),
});
export type NewColumn = Static<typeof NewColumn>;

export const CreateTableRequest = t.Object({
  database: t.String({ minLength: 1, maxLength: 100 }),
  schema: t.String({ minLength: 1, maxLength: MAX_IDENT }),
  name: t.String({ minLength: 1, maxLength: MAX_IDENT }),
  columns: t.Array(NewColumn, { minItems: 1, maxItems: 200 }),
  ifNotExists: t.Optional(t.Boolean()),
  comment: t.Optional(t.String({ maxLength: 1000 })),
});
export type CreateTableRequest = Static<typeof CreateTableRequest>;

/** Codificações oferecidas. `UTF8` é o único que este app recomenda. */
export const DatabaseEncoding = t.Union([
  t.Literal("UTF8"),
  t.Literal("LATIN1"),
  t.Literal("SQL_ASCII"),
]);
export type DatabaseEncoding = Static<typeof DatabaseEncoding>;

export const CreateDatabaseRequest = t.Object({
  name: t.String({ minLength: 1, maxLength: MAX_IDENT }),
  owner: t.Optional(t.String({ maxLength: MAX_IDENT })),
  encoding: t.Optional(DatabaseEncoding),
  /**
   * `template0` é o certo quando a codificação difere da do cluster; o Postgres
   * recusa `template1` nesse caso. Lista fechada.
   */
  template: t.Optional(t.Union([t.Literal("template0"), t.Literal("template1")])),
  lcCollate: t.Optional(t.String({ maxLength: 64 })),
  lcCtype: t.Optional(t.String({ maxLength: 64 })),
});
export type CreateDatabaseRequest = Static<typeof CreateDatabaseRequest>;

export const DdlResult = t.Object({
  ok: t.Literal(true),
  /** O comando exato que rodou — a UI mostra, e ele é o mesmo do `query_log`. */
  sql: t.String(),
});
export type DdlResult = Static<typeof DdlResult>;

export class DdlInvalido extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "DdlInvalido";
  }
}

/**
 * Byte de controle e DEL. Escrito com escapes de propósito: um literal desses
 * no fonte é invisível no editor e some do `grep` (§11.24), e `check:bytes`
 * barraria o arquivo.
 */
// eslint-disable-next-line no-control-regex -- é exatamente o que se procura aqui
const CONTROLE = /[\u0000-\u001F\u007F]/;

/**
 * Recusa um identificador que o Postgres aceitaria mas que ninguém quis digitar.
 *
 * `sqlIdent` já dobra aspas, então injeção por `"` está fechada antes daqui.
 * Isto pega o resto: vazio depois de aparar, byte de controle (o `\0` trunca em
 * C e some do log), e o limite de 63 **bytes** — não caracteres, que é o erro
 * clássico com acento: `ç` ocupa dois.
 */
export function validarIdentificador(bruto: string): string {
  const nome = bruto.trim();
  if (nome === "") throw new DdlInvalido("o nome não pode ficar vazio");
  if (CONTROLE.test(nome)) throw new DdlInvalido("o nome tem caractere de controle");
  if (new TextEncoder().encode(nome).length > MAX_IDENT) {
    throw new DdlInvalido(`o nome passa de ${String(MAX_IDENT)} bytes`);
  }
  return nome;
}

/** `varchar(120)`, `numeric(12, 2)`, `text`. Nunca texto do cliente. */
function tipoSql(coluna: NewColumn): string {
  const base = coluna.type;
  if (TIPOS_COM_TAMANHO.has(base) && coluna.length !== undefined) {
    return `${base}(${String(coluna.length)})`;
  }
  if (TIPOS_COM_PRECISAO.has(base) && coluna.length !== undefined) {
    return coluna.scale === undefined
      ? `${base}(${String(coluna.length)})`
      : `${base}(${String(coluna.length)}, ${String(coluna.scale)})`;
  }
  return base;
}

function defaultSql(coluna: NewColumn): string | null {
  if (coluna.defaultExpression !== undefined) return coluna.defaultExpression;
  if (coluna.defaultValue === undefined || coluna.defaultValue === "") return null;
  // Literal entre aspas simples, escapado. O Postgres coage para o tipo da
  // coluna, mesma razão do `sqlValue` no export.
  return sqlValue(coluna.defaultValue);
}

/**
 * Monta o `CREATE TABLE`.
 *
 * Devolve o texto para a UI mostrar **antes** de mandar executar — o formulário
 * exibe o comando enquanto é preenchido, então o que roda é o que se leu.
 */
export function montarCreateTable(pedido: CreateTableRequest): string {
  const schema = validarIdentificador(pedido.schema);
  const tabela = validarIdentificador(pedido.name);

  const vistos = new Set<string>();
  const pks: string[] = [];
  const linhas: string[] = [];

  for (const coluna of pedido.columns) {
    const nome = validarIdentificador(coluna.name);
    const chave = nome.toLowerCase();
    // O Postgres recusaria com "column specified more than once", mas o erro
    // chega depois de a transação abrir; recusar aqui é mais barato e a
    // mensagem diz qual coluna.
    if (vistos.has(chave)) throw new DdlInvalido(`coluna repetida: ${nome}`);
    vistos.add(chave);

    const partes = [sqlIdent(nome), tipoSql(coluna)];

    // `serial` já é NOT NULL com default próprio: repetir seria ruído, e um
    // DEFAULT junto sobrescreveria a sequência.
    const serial = TIPOS_SERIAIS.has(coluna.type);
    if (!serial) {
      const padrao = defaultSql(coluna);
      if (padrao !== null) partes.push(`DEFAULT ${padrao}`);
      // PK já implica NOT NULL; declarar de novo polui o DDL.
      if (coluna.notNull === true && coluna.primaryKey !== true) partes.push("NOT NULL");
    }
    if (coluna.unique === true && coluna.primaryKey !== true) partes.push("UNIQUE");

    if (coluna.primaryKey === true) pks.push(sqlIdent(nome));
    linhas.push(`  ${partes.join(" ")}`);
  }

  // PK composta como constraint de tabela: `PRIMARY KEY` em duas colunas
  // separadas seriam duas chaves primárias, que o Postgres recusa.
  if (pks.length > 0) linhas.push(`  PRIMARY KEY (${pks.join(", ")})`);

  const seNaoExiste = pedido.ifNotExists === true ? "IF NOT EXISTS " : "";
  const alvo = `${sqlIdent(schema)}.${sqlIdent(tabela)}`;
  const create = `CREATE TABLE ${seNaoExiste}${alvo} (\n${linhas.join(",\n")}\n);`;

  const comentario = pedido.comment?.trim();
  if (comentario === undefined || comentario === "") return create;
  return `${create}\nCOMMENT ON TABLE ${alvo} IS ${sqlValue(comentario)};`;
}

/**
 * Monta o `CREATE DATABASE`.
 *
 * Uma cláusula por linha porque o comando fica longo e a UI mostra ele inteiro.
 */
export function montarCreateDatabase(pedido: CreateDatabaseRequest): string {
  const nome = validarIdentificador(pedido.name);
  const partes: string[] = [`CREATE DATABASE ${sqlIdent(nome)}`];

  if (pedido.owner !== undefined && pedido.owner.trim() !== "") {
    partes.push(`  OWNER ${sqlIdent(validarIdentificador(pedido.owner))}`);
  }
  if (pedido.encoding !== undefined) partes.push(`  ENCODING ${sqlValue(pedido.encoding)}`);
  if (pedido.lcCollate !== undefined && pedido.lcCollate.trim() !== "") {
    partes.push(`  LC_COLLATE ${sqlValue(pedido.lcCollate.trim())}`);
  }
  if (pedido.lcCtype !== undefined && pedido.lcCtype.trim() !== "") {
    partes.push(`  LC_CTYPE ${sqlValue(pedido.lcCtype.trim())}`);
  }
  // Precisa vir por último para o `template0` valer sobre as cláusulas acima —
  // e é obrigatório quando a codificação difere da do cluster.
  if (pedido.template !== undefined) partes.push(`  TEMPLATE ${pedido.template}`);

  return `${partes.join("\n")};`;
}
