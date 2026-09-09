/**
 * A parte PURA do DDL: validar identificador e montar o comando.
 *
 * Separado de `ddl.ts` pelo mesmo motivo de `mutation.puro.ts`: o módulo de
 * schema importa `t` da Elysia, que é runtime, e quem o importa leva o TypeBox
 * inteiro. O front usa estas funções para o preview do DDL (ADR 010) e não
 * precisa de schema nenhum.
 */
// `sqlValue` vem do módulo PURO do export, não do de schema — importar do de
// schema traria o TypeBox de volta e desfaria a separação.
import { sqlIdent, sqlValue } from "./export.puro";

import type {
  CreateDatabaseRequest,
  CreateTableRequest,
  NewColumn,
} from "./ddl";

/** Comprimento máximo de identificador no Postgres. */
export const MAX_IDENT = 63;

/** Tipos que aceitam `(n)`. */
export const TIPOS_COM_TAMANHO: ReadonlySet<string> = new Set(["varchar", "char"]);
/** Tipos que aceitam `(p, s)`. */
export const TIPOS_COM_PRECISAO: ReadonlySet<string> = new Set(["numeric"]);
/** Tipos que já implicam sequence — não aceitam DEFAULT nem NOT NULL explícito. */
export const TIPOS_SERIAIS: ReadonlySet<string> = new Set(["serial", "bigserial"]);

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
