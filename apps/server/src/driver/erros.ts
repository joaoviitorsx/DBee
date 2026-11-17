import type { RowFilter } from "@dbee/shared";

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
    readonly code: "unknown_column" | "invalid_cursor" | "invalid_filter",
    message: string,
  ) {
    super(message);
    this.name = "RowsError";
  }
}

/**
 * Os valores de um filtro `in`. Lista vazia é erro do usuário, não "casa nada":
 * `IN ()` nem é SQL válido, e devolver zero linhas esconderia o engano.
 */
export function valoresDoIn(filtro: RowFilter): readonly string[] {
  const valores = filtro.values ?? [];
  if (valores.length === 0) {
    throw new RowsError("invalid_filter", `o filtro "in" em "${filtro.column}" precisa de ao menos um valor`);
  }
  return valores;
}

/**
 * Erro ao aplicar uma edição de linha numa engine de credencial (Mongo/Redis).
 *
 * Separado do `RowsError` porque a fase é outra — escrita, não leitura — e o
 * serviço de mutação o traduz para `write_forbidden`/`bad_request`, não para o
 * erro de grade. Mensagem pronta para a tela, sem eco de credencial.
 */
export class MutacaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutacaoError";
  }
}

/**
 * A edição mandou colunas que não são a chave primária completa (ou a tabela
 * não tem PK). O serviço a traduz em `not_primary_key` (ideias-comunidade I7).
 */
export class NaoEhChavePrimaria extends MutacaoError {
  constructor(readonly pkReal: readonly string[]) {
    super(
      pkReal.length === 0
        ? "esta tabela não tem chave primária: a edição de linha não tem como identificar uma linha só — use o editor de SQL"
        : `a edição de linha exige a chave primária completa (${pkReal.join(", ")}) — recarregue a grade`,
    );
    this.name = "NaoEhChavePrimaria";
  }
}
