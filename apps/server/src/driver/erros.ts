/**
 * Erros que qualquer engine produz ao montar a grade de linhas.
 *
 * Mora aqui, e não em `pg/rows.ts`, porque **o conceito é um só**: "essa coluna
 * não existe" e "esse cursor não serve" acontecem igual no Postgres e no MySQL,
 * e o serviço precisa reconhecê-los sem perguntar de qual engine vieram.
 *
 * A primeira versão do planejador de MySQL definiu uma classe própria. O efeito
 * foi mudo: o serviço não a reconhecia, e um nome de coluna errado — erro do
 * usuário, com mensagem pronta — virava `upstream_error` 502, como se o
 * servidor tivesse caído.
 */
export class RowsError extends Error {
  constructor(
    readonly code: "unknown_column" | "invalid_cursor",
    message: string,
  ) {
    super(message);
    this.name = "RowsError";
  }
}
