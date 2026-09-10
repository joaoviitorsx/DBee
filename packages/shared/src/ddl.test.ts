import { describe, expect, it } from "bun:test";

import {
  DdlInvalido,
  MAX_IDENT,
  montarCreateDatabase,
  montarCreateTable,
  validarIdentificador,
  type CreateTableRequest,
  type NewColumn,
} from "./ddl";

/**
 * Os montadores de DDL são a superfície onde texto do usuário vira comando.
 * O que este arquivo trava é isso — não o formato bonito do SQL.
 */

const coluna = (extra: Partial<NewColumn> = {}): NewColumn => ({
  name: "id",
  type: "integer",
  ...extra,
});

const pedido = (extra: Partial<CreateTableRequest> = {}): CreateTableRequest => ({
  database: "app",
  schema: "public",
  name: "pedidos",
  columns: [coluna()],
  ...extra,
});

/**
 * Apaga os identificadores citados para contar o que sobrou de **comando**.
 *
 * Contar `;` no SQL inteiro mede a coisa errada: um `;` dentro de
 * `"a""; DROP ..."` é texto, não instrução — é justamente o que a citação faz
 * com ele. O que interessa é quantos `;` sobram fora das aspas.
 */
const foraDeAspas = (sql: string): string => sql.replaceAll(/"(?:[^"]|"")*"/g, "IDENT");

/** Idem para literais: apaga o que está entre aspas simples, com `''` escapado. */
const foraDeAspasSimples = (sql: string): string => sql.replaceAll(/'(?:[^']|'')*'/g, "LIT");

describe("validarIdentificador", () => {
  it("apara e devolve", () => {
    expect(validarIdentificador("  pedidos  ")).toBe("pedidos");
  });

  it("recusa vazio", () => {
    expect(() => validarIdentificador("   ")).toThrow(DdlInvalido);
  });

  /**
   * `\0` trunca em C, some do terminal e deixa o arquivo invisível para grep —
   * o §11.24 aconteceu neste próprio repo.
   */
  it("recusa caractere de controle", () => {
    for (const mau of ["a\u0000b", "a\u001Fb", "a\u007Fb", "a\nb", "a\tb"]) {
      expect(() => validarIdentificador(mau)).toThrow(DdlInvalido);
    }
  });

  /** O limite do Postgres é em BYTES; `ç` ocupa dois. */
  it("mede o limite em bytes, não em caracteres", () => {
    expect(validarIdentificador("a".repeat(MAX_IDENT))).toHaveLength(MAX_IDENT);
    expect(() => validarIdentificador("a".repeat(MAX_IDENT + 1))).toThrow(DdlInvalido);
    // 32 "ç" = 64 bytes: passa em caracteres, estoura em bytes.
    expect(() => validarIdentificador("ç".repeat(32))).toThrow(DdlInvalido);
  });
});

describe("montarCreateTable", () => {
  it("monta o básico", () => {
    const sql = montarCreateTable(
      pedido({
        columns: [
          coluna({ name: "id", type: "bigserial", primaryKey: true }),
          coluna({ name: "cliente", type: "text", notNull: true }),
        ],
      }),
    );
    expect(sql).toBe(
      'CREATE TABLE "public"."pedidos" (\n' +
        '  "id" bigserial,\n' +
        '  "cliente" text NOT NULL,\n' +
        '  PRIMARY KEY ("id")\n' +
        ");",
    );
  });

  /**
   * O vetor óbvio: fechar as aspas do identificador e emendar outro comando.
   * `sqlIdent` dobra a aspa, então o nome inteiro continua sendo UM
   * identificador — feio, mas inerte.
   */
  it("aspas no nome não quebram o identificador", () => {
    const sql = montarCreateTable(
      pedido({ name: 'x"; DROP TABLE clientes; --' }),
    );
    expect(sql).toContain('"x""; DROP TABLE clientes; --"');
    // Uma instrução só: os `;` do ataque viraram texto dentro do identificador.
    expect(foraDeAspas(sql).split(";").length - 1).toBe(1);
    expect(foraDeAspas(sql)).not.toContain("DROP");
  });

  it("literal de default é escapado, não concatenado", () => {
    const sql = montarCreateTable(
      pedido({ columns: [coluna({ name: "nota", type: "text", defaultValue: "o'brien" })] }),
    );
    expect(sql).toContain("DEFAULT 'o''brien'");
  });

  /**
   * O bypass clássico: `\'` escaparia a aspa em MySQL. No Postgres com
   * `standard_conforming_strings = on` (padrão desde a 9.1, conferido no
   * container de teste) a barra é literal, e a única fuga seria a aspa
   * dobrada — que é exatamente o que `sqlValue` faz. Travado aqui porque um
   * dia alguém pode "melhorar" o escape.
   */
  it("barra invertida não escapa a aspa do literal", () => {
    const sql = montarCreateTable(
      pedido({
        columns: [coluna({ name: "nota", type: "text", defaultValue: "x\\' OR 1=1 --" })],
      }),
    );
    expect(sql).toContain("DEFAULT 'x\\'' OR 1=1 --'");
    // A aspa do atacante saiu dobrada: o literal não fechou.
    expect(foraDeAspasSimples(sql)).not.toContain("OR 1=1");
  });

  /** Expressão vem de lista fechada; o literal nunca vira expressão. */
  it("expressão de default sai sem aspas; literal sai com", () => {
    const comExpr = montarCreateTable(
      pedido({
        columns: [coluna({ name: "criado", type: "timestamptz", defaultExpression: "now()" })],
      }),
    );
    expect(comExpr).toContain("DEFAULT now()");

    const comLiteral = montarCreateTable(
      pedido({ columns: [coluna({ name: "criado", type: "text", defaultValue: "now()" })] }),
    );
    expect(comLiteral).toContain("DEFAULT 'now()'");
  });

  it("expressão vence o literal quando os dois vêm", () => {
    const sql = montarCreateTable(
      pedido({
        columns: [
          coluna({
            name: "criado",
            type: "timestamptz",
            defaultValue: "ignorado",
            defaultExpression: "now()",
          }),
        ],
      }),
    );
    expect(sql).toContain("DEFAULT now()");
    expect(sql).not.toContain("ignorado");
  });

  /** `serial` já traz NOT NULL e a sequência; um DEFAULT junto a atropelaria. */
  it("serial não recebe DEFAULT nem NOT NULL", () => {
    const sql = montarCreateTable(
      pedido({
        columns: [coluna({ name: "id", type: "serial", notNull: true, defaultValue: "7" })],
      }),
    );
    expect(sql).toContain('"id" serial');
    expect(sql).not.toContain("DEFAULT");
    expect(sql).not.toContain("NOT NULL");
  });

  it("PK não repete NOT NULL — a chave já implica", () => {
    const sql = montarCreateTable(
      pedido({ columns: [coluna({ name: "id", type: "integer", primaryKey: true, notNull: true })] }),
    );
    expect(sql).not.toContain("NOT NULL");
    expect(sql).toContain('PRIMARY KEY ("id")');
  });

  /** Duas colunas com PRIMARY KEY inline seriam duas chaves — o PG recusa. */
  it("PK composta vira uma constraint só", () => {
    const sql = montarCreateTable(
      pedido({
        columns: [
          coluna({ name: "empresa_id", type: "integer", primaryKey: true }),
          coluna({ name: "periodo", type: "date", primaryKey: true }),
        ],
      }),
    );
    expect(sql).toContain('PRIMARY KEY ("empresa_id", "periodo")');
    expect(sql.match(/PRIMARY KEY/g)).toHaveLength(1);
  });

  it("recusa coluna repetida, sem distinção de caixa", () => {
    expect(() =>
      montarCreateTable(
        pedido({ columns: [coluna({ name: "id" }), coluna({ name: "ID" })] }),
      ),
    ).toThrow(DdlInvalido);
  });

  it("tamanho e precisão só nos tipos que aceitam", () => {
    expect(
      montarCreateTable(pedido({ columns: [coluna({ name: "s", type: "varchar", length: 120 })] })),
    ).toContain('"s" varchar(120)');
    expect(
      montarCreateTable(
        pedido({ columns: [coluna({ name: "v", type: "numeric", length: 12, scale: 2 })] }),
      ),
    ).toContain('"v" numeric(12, 2)');
    // `integer(10)` não existe: o tamanho é ignorado em vez de virar sintaxe inválida.
    expect(
      montarCreateTable(pedido({ columns: [coluna({ name: "n", type: "integer", length: 10 })] })),
    ).toContain('"n" integer');
  });

  it("comentário sai como COMMENT ON, escapado", () => {
    const sql = montarCreateTable(pedido({ comment: "tabela d'exemplo" }));
    expect(sql).toContain("COMMENT ON TABLE \"public\".\"pedidos\" IS 'tabela d''exemplo';");
  });

  it("IF NOT EXISTS quando pedido", () => {
    expect(montarCreateTable(pedido({ ifNotExists: true }))).toContain(
      "CREATE TABLE IF NOT EXISTS",
    );
  });
});

describe("montarCreateDatabase", () => {
  it("só o nome quando nada mais vem", () => {
    expect(montarCreateDatabase({ name: "faturamento" })).toBe(
      'CREATE DATABASE "faturamento";',
    );
  });

  it("monta as cláusulas com o TEMPLATE por último", () => {
    const sql = montarCreateDatabase({
      name: "faturamento_2027",
      owner: "postgres",
      encoding: "UTF8",
      lcCollate: "pt_BR.UTF-8",
      template: "template0",
    });
    expect(sql).toBe(
      'CREATE DATABASE "faturamento_2027"\n' +
        '  OWNER "postgres"\n' +
        "  ENCODING 'UTF8'\n" +
        "  LC_COLLATE 'pt_BR.UTF-8'\n" +
        "  TEMPLATE template0;",
    );
  });

  it("nome e owner com aspas continuam um identificador só", () => {
    const sql = montarCreateDatabase({ name: 'a"; DROP DATABASE prod; --', owner: 'b"c' });
    expect(sql).toContain('"a""; DROP DATABASE prod; --"');
    expect(sql).toContain('"b""c"');
    expect(foraDeAspas(sql).split(";").length - 1).toBe(1);
    expect(foraDeAspas(sql)).not.toContain("DROP");
  });

  it("collation com aspas simples é escapada", () => {
    expect(montarCreateDatabase({ name: "d", lcCollate: "x' OR '1'='1" })).toContain(
      "LC_COLLATE 'x'' OR ''1''=''1'",
    );
  });

  it("campos em branco não viram cláusula vazia", () => {
    expect(montarCreateDatabase({ name: "d", owner: "  ", lcCollate: "", lcCtype: "  " })).toBe(
      'CREATE DATABASE "d";',
    );
  });

  it("recusa nome inválido", () => {
    expect(() => montarCreateDatabase({ name: "  " })).toThrow(DdlInvalido);
    expect(() => montarCreateDatabase({ name: "a\u0000b" })).toThrow(DdlInvalido);
  });
});

describe("montarCreateTable — dialetos não-Postgres", () => {
  it("MySQL: crase no identificador, serial PK vira AUTO_INCREMENT, tipos mapeados", () => {
    const sql = montarCreateTable(
      pedido({
        name: "clientes",
        columns: [
          coluna({ name: "id", type: "bigserial", primaryKey: true }),
          coluna({ name: "nome", type: "varchar", length: 120, notNull: true }),
          coluna({ name: "dados", type: "jsonb" }),
          coluna({ name: "ativo", type: "boolean", defaultValue: "1" }),
        ],
      }),
      "mysql",
    );
    expect(sql).toContain("CREATE TABLE `clientes`");
    expect(sql).toContain("`id` BIGINT AUTO_INCREMENT");
    expect(sql).toContain("`nome` VARCHAR(120) NOT NULL");
    expect(sql).toContain("`dados` JSON");
    expect(sql).toContain("`ativo` TINYINT(1) DEFAULT '1'");
    expect(sql).toContain("PRIMARY KEY (`id`)");
    // Sem qualificar por schema (o database qualifica), sem COMMENT ON.
    expect(sql).not.toContain('"public"');
    expect(sql).not.toContain("COMMENT ON");
  });

  it("MySQL: VARCHAR sem tamanho recebe 255", () => {
    const sql = montarCreateTable(
      pedido({ columns: [coluna({ name: "s", type: "varchar" })] }),
      "mysql",
    );
    expect(sql).toContain("`s` VARCHAR(255)");
  });

  it("SQLite: serial PK única vira INTEGER PRIMARY KEY AUTOINCREMENT, sem constraint de tabela", () => {
    const sql = montarCreateTable(
      pedido({
        name: "itens",
        columns: [
          coluna({ name: "id", type: "serial", primaryKey: true }),
          coluna({ name: "nome", type: "text" }),
        ],
      }),
      "sqlite",
    );
    expect(sql).toContain('CREATE TABLE "itens"');
    expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(sql).toContain('"nome" TEXT');
    // Não repete a PK como constraint de tabela.
    expect(sql).not.toContain("PRIMARY KEY (");
  });

  it("SQLite: PK composta usa a constraint de tabela (sem autoincrement)", () => {
    const sql = montarCreateTable(
      pedido({
        columns: [
          coluna({ name: "a", type: "integer", primaryKey: true }),
          coluna({ name: "b", type: "integer", primaryKey: true }),
        ],
      }),
      "sqlite",
    );
    expect(sql).toContain('PRIMARY KEY ("a", "b")');
    expect(sql).not.toContain("AUTOINCREMENT");
  });

  it("default de expressão não portável é recusado fora do Postgres", () => {
    expect(() =>
      montarCreateTable(
        pedido({ columns: [coluna({ name: "u", type: "uuid", defaultExpression: "gen_random_uuid()" })] }),
        "mysql",
      ),
    ).toThrow(DdlInvalido);
    // now()/current_timestamp têm equivalente e passam.
    const sql = montarCreateTable(
      pedido({ columns: [coluna({ name: "c", type: "timestamp", defaultExpression: "now()" })] }),
      "mysql",
    );
    expect(sql).toContain("DEFAULT CURRENT_TIMESTAMP");
  });

  it("MySQL: numa PK composta o serial vai para a frente (InnoDB exige)", () => {
    const sql = montarCreateTable(
      pedido({
        columns: [
          coluna({ name: "org_id", type: "integer", primaryKey: true }),
          coluna({ name: "id", type: "bigserial", primaryKey: true }),
        ],
      }),
      "mysql",
    );
    // O serial (`id`, AUTO_INCREMENT) precede o `org_id` na constraint.
    expect(sql).toContain("PRIMARY KEY (`id`, `org_id`)");
    expect(sql).toContain("`id` BIGINT AUTO_INCREMENT");
  });

  it("Postgres/SQLite preservam a ordem da PK composta", () => {
    const sqlPg = montarCreateTable(
      pedido({
        columns: [
          coluna({ name: "org_id", type: "integer", primaryKey: true }),
          coluna({ name: "periodo", type: "date", primaryKey: true }),
        ],
      }),
    );
    expect(sqlPg).toContain('PRIMARY KEY ("org_id", "periodo")');
  });

  it("montarCreateDatabase no MySQL é só CREATE DATABASE com crase", () => {
    expect(montarCreateDatabase({ name: "loja", encoding: "UTF8", owner: "x" }, "mysql")).toBe(
      "CREATE DATABASE `loja`;",
    );
  });
});
