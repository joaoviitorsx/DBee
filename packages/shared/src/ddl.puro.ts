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
import type { DialetoSql } from "./split";

import type {
  CreateDatabaseRequest,
  CreateTableRequest,
  DefaultExpression,
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

/** Cita identificador conforme o dialeto: crase no MySQL, aspas duplas no resto. */
function citarIdentDialeto(nome: string, dialeto: DialetoSql): string {
  if (dialeto === "mysql") return `\`${nome.replaceAll("`", "``")}\``;
  return sqlIdent(nome);
}

/**
 * O tipo de cada coluna por dialeto.
 *
 * O Postgres é a fonte dos nomes que o formulário oferece; MySQL e SQLite
 * recebem o **equivalente que existe lá** — `serial` vira `INT AUTO_INCREMENT`
 * no MySQL e `INTEGER` no SQLite (que auto-incrementa via `INTEGER PRIMARY
 * KEY`), `jsonb`/`uuid`/`bytea`/`inet` viram o tipo mais próximo. Sem isso, um
 * `CREATE TABLE serial` no MySQL falharia — `serial` não é tipo de lá.
 */
const TIPO_MYSQL: Readonly<Record<string, string>> = {
  bigserial: "BIGINT", serial: "INT", bigint: "BIGINT", integer: "INT", smallint: "SMALLINT",
  numeric: "DECIMAL", real: "FLOAT", "double precision": "DOUBLE", boolean: "TINYINT(1)",
  text: "TEXT", varchar: "VARCHAR", char: "CHAR", uuid: "CHAR(36)", date: "DATE", time: "TIME",
  timestamp: "DATETIME", timestamptz: "TIMESTAMP", json: "JSON", jsonb: "JSON", bytea: "BLOB",
  inet: "VARCHAR(45)",
};
const TIPO_SQLITE: Readonly<Record<string, string>> = {
  bigserial: "INTEGER", serial: "INTEGER", bigint: "INTEGER", integer: "INTEGER", smallint: "INTEGER",
  numeric: "NUMERIC", real: "REAL", "double precision": "REAL", boolean: "INTEGER",
  text: "TEXT", varchar: "TEXT", char: "TEXT", uuid: "TEXT", date: "TEXT", time: "TEXT",
  timestamp: "TEXT", timestamptz: "TEXT", json: "TEXT", jsonb: "TEXT", bytea: "BLOB", inet: "TEXT",
};

/** `varchar(120)`, `numeric(12, 2)`, `text` — o tipo pronto para o dialeto. */
function tipoSql(coluna: NewColumn, dialeto: DialetoSql): string {
  if (dialeto === "sqlite") return TIPO_SQLITE[coluna.type] ?? "TEXT";

  const base = dialeto === "mysql" ? (TIPO_MYSQL[coluna.type] ?? coluna.type) : coluna.type;

  if (TIPOS_COM_TAMANHO.has(coluna.type)) {
    // MySQL exige tamanho no VARCHAR; sem ele, 255 é o padrão de trabalho.
    const n = coluna.length ?? (dialeto === "mysql" ? 255 : undefined);
    if (n !== undefined) return `${base}(${String(n)})`;
    return base;
  }
  if (TIPOS_COM_PRECISAO.has(coluna.type) && coluna.length !== undefined) {
    return coluna.scale === undefined
      ? `${base}(${String(coluna.length)})`
      : `${base}(${String(coluna.length)}, ${String(coluna.scale)})`;
  }
  return base;
}

/** A expressão de default por dialeto — ou estoura se ela não existe lá. */
function expressaoDefault(expr: DefaultExpression, dialeto: DialetoSql): string {
  if (dialeto === "postgres") return expr;
  // MySQL e SQLite: só o "agora" tem equivalente direto e portável como default.
  if (expr === "now()" || expr === "current_timestamp") return "CURRENT_TIMESTAMP";
  if (expr === "current_date" && dialeto === "sqlite") return "CURRENT_DATE";
  throw new DdlInvalido(
    `o default ${expr} não é suportado em ${dialeto} pelo DBee — use um valor literal ou escreva o CREATE TABLE no editor.`,
  );
}

function defaultSql(coluna: NewColumn, dialeto: DialetoSql): string | null {
  if (coluna.defaultExpression !== undefined) {
    return expressaoDefault(coluna.defaultExpression, dialeto);
  }
  if (coluna.defaultValue === undefined || coluna.defaultValue === "") return null;
  // Literal entre aspas simples, escapado. O banco coage para o tipo da coluna,
  // mesma razão do `sqlValue` no export.
  return sqlValue(coluna.defaultValue);
}

/**
 * Monta o `CREATE TABLE`, no dialeto da engine.
 *
 * Devolve o texto para a UI mostrar **antes** de mandar executar — o formulário
 * exibe o comando enquanto é preenchido, então o que roda é o que se leu.
 *
 * O `serial` diverge por natureza: no Postgres é `serial` (sequence própria); no
 * MySQL é `AUTO_INCREMENT` (exige ser chave, então só sai quando a coluna é PK);
 * no SQLite é `INTEGER PRIMARY KEY AUTOINCREMENT`, que é coluna-nível e dispensa
 * a constraint de tabela — por isso o caso da PK única serial é tratado à parte.
 */
export function montarCreateTable(
  pedido: CreateTableRequest,
  dialeto: DialetoSql = "postgres",
): string {
  const schema = validarIdentificador(pedido.schema);
  const tabela = validarIdentificador(pedido.name);
  const cit = (n: string): string => citarIdentDialeto(n, dialeto);

  const vistos = new Set<string>();
  /** Colunas da PK, citadas, com marca de serial (para o MySQL ordenar). */
  const pks: { readonly cit: string; readonly serial: boolean }[] = [];
  const linhas: string[] = [];
  const nomesPk = pedido.columns.filter((c) => c.primaryKey === true);
  const pkUnica = nomesPk.length === 1;

  for (const coluna of pedido.columns) {
    const nome = validarIdentificador(coluna.name);
    const chave = nome.toLowerCase();
    if (vistos.has(chave)) throw new DdlInvalido(`coluna repetida: ${nome}`);
    vistos.add(chave);

    const serial = TIPOS_SERIAIS.has(coluna.type);
    const ehPk = coluna.primaryKey === true;

    // SQLite: um serial que é a PK única vira a coluna-nível INTEGER PRIMARY KEY
    // AUTOINCREMENT — e NÃO entra na constraint de tabela (seria PK dupla).
    if (dialeto === "sqlite" && serial && ehPk && pkUnica) {
      linhas.push(`  ${cit(nome)} INTEGER PRIMARY KEY AUTOINCREMENT`);
      continue;
    }

    const partes = [cit(nome), tipoSql(coluna, dialeto)];

    // MySQL: `AUTO_INCREMENT` só numa coluna que é chave — a PK de tabela dá o
    // índice. Serial sem ser PK sai como inteiro simples (sem auto-incremento).
    if (dialeto === "mysql" && serial && ehPk) partes.push("AUTO_INCREMENT");

    if (!serial) {
      const padrao = defaultSql(coluna, dialeto);
      if (padrao !== null) partes.push(`DEFAULT ${padrao}`);
      // PK já implica NOT NULL; declarar de novo polui o DDL.
      if (coluna.notNull === true && !ehPk) partes.push("NOT NULL");
    }
    if (coluna.unique === true && !ehPk) partes.push("UNIQUE");

    if (ehPk) pks.push({ cit: cit(nome), serial });
    linhas.push(`  ${partes.join(" ")}`);
  }

  if (pks.length > 0) {
    /*
     * No MySQL a coluna `AUTO_INCREMENT` tem que ser a **primeira** de alguma
     * chave (InnoDB, medido: ERROR 1075). Numa PK composta com o serial no meio,
     * o CREATE falha — então ele vai para a frente da lista. Nos outros dialetos
     * a ordem da PK é do usuário (composta é semântica), e é preservada.
     */
    const ordenadas =
      dialeto === "mysql"
        ? [...pks].sort((a, b) => Number(b.serial) - Number(a.serial))
        : pks;
    linhas.push(`  PRIMARY KEY (${ordenadas.map((p) => p.cit).join(", ")})`);
  }

  const seNaoExiste = pedido.ifNotExists === true ? "IF NOT EXISTS " : "";
  // No MySQL/SQLite a tabela é qualificada pela conexão (database/arquivo), não
  // por schema: o alvo é só o nome citado. No Postgres, `schema.tabela`.
  const alvo = dialeto === "postgres" ? `${sqlIdent(schema)}.${sqlIdent(tabela)}` : cit(tabela);
  const create = `CREATE TABLE ${seNaoExiste}${alvo} (\n${linhas.join(",\n")}\n);`;

  const comentario = pedido.comment?.trim();
  // `COMMENT ON TABLE` é do Postgres; nas outras o comentário fica de fora (o
  // formulário o trata como opcional).
  if (comentario === undefined || comentario === "" || dialeto !== "postgres") return create;
  return `${create}\nCOMMENT ON TABLE ${alvo} IS ${sqlValue(comentario)};`;
}

/**
 * Monta o `CREATE DATABASE`.
 *
 * Uma cláusula por linha porque o comando fica longo e a UI mostra ele inteiro.
 *
 * No **MySQL** o comando é só `CREATE DATABASE \`nome\`` — as cláusulas do
 * Postgres (`OWNER`, `ENCODING`, `TEMPLATE`, `LC_*`) não existem lá e são
 * ignoradas. SQLite e libSQL não têm `CREATE DATABASE` (um é arquivo, o outro é
 * um banco só); o serviço os recusa antes de chegar aqui.
 */
export function montarCreateDatabase(
  pedido: CreateDatabaseRequest,
  dialeto: DialetoSql = "postgres",
): string {
  const nome = validarIdentificador(pedido.name);
  if (dialeto === "mysql") return `CREATE DATABASE ${citarIdentDialeto(nome, dialeto)};`;
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
