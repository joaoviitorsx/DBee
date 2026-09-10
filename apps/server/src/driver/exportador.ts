import {
  CONTENT_TYPE,
  csvLine,
  csvOptions,
  sqlValue,
  type CsvOptions,
  type DialetoSql,
  type ExportFormat,
} from "@dbee/shared";

/**
 * Exportação em stream para as engines que **não** são o Postgres.
 *
 * ## Por que não reusa `pg/exporter`
 *
 * O exportador do Postgres é um `DECLARE CURSOR` + `FETCH` em lotes (regra 7):
 * o cursor mantém o ponto de leitura no servidor e nunca materializa tudo. As
 * outras engines não têm esse cursor — o libSQL responde por HTTP, o SQLite
 * roda no worker, o MySQL materializa por padrão. O que todas têm é a **grade
 * por keyset**: `driver.linhas(...)` devolve uma página e o cursor da próxima.
 *
 * Este módulo é o laço genérico em cima disso: recebe um **produtor de
 * páginas** (`proximaPagina`) que o serviço fecha sobre o driver e o cursor, e
 * formata cada página no formato pedido, com a mesma contrapressão do `pull` do
 * `ReadableStream` — uma página por vez na memória. Para a origem tabela o
 * produtor pagina por keyset (memória limitada ao tamanho do lote); para a
 * origem consulta ele entrega o único resultado do `executar` (limitado por
 * `maxRows`, como qualquer consulta nessas engines).
 *
 * O formato `.sql` cita o identificador conforme o **dialeto**: crase no MySQL,
 * aspas duplas no SQLite/libSQL. O valor continua saindo por `sqlValue` (aspas
 * simples, regra 10) — com o reforço de escapar a contrabarra no MySQL, onde
 * ela é caractere de escape por padrão e `sqlValue` sozinho recarregaria o dado
 * errado.
 */

/** Uma página já em texto, na ordem das colunas. `null` encerra o stream. */
export interface PaginaExport {
  readonly columns: readonly string[];
  readonly rows: readonly (string | null)[][];
}

export interface ResultadoExport {
  readonly rows: number;
  readonly bytes: number;
}

export type AoFinalizarExport = (resultado: ResultadoExport, erro: string | null) => void;

export interface PlanoExportDriver {
  readonly format: ExportFormat;
  readonly csv: CsvOptions | undefined;
  readonly dialeto: DialetoSql;
  /** Nome qualificado e citado do destino do `INSERT` (só no formato `sql`). */
  readonly sqlTabela?: string;
  /** `CREATE TABLE` de referência, emitido uma vez antes das linhas (só `sql`). */
  readonly sqlPrelude?: string;
  /**
   * Entrega a próxima página, ou `null` quando não há mais.
   *
   * É a única forma de o laço tocar o driver: o serviço o fecha sobre o driver,
   * a conexão e o cursor. Pode estourar — o erro é propagado ao consumidor e o
   * `onDone` é chamado com a causa.
   */
  readonly proximaPagina: () => Promise<PaginaExport | null>;
}

/** Cita identificador conforme o dialeto, para o `.sql`. */
export function citarIdent(nome: string, dialeto: DialetoSql): string {
  if (dialeto === "mysql") return `\`${nome.replaceAll("`", "``")}\``;
  return `"${nome.replaceAll('"', '""')}"`;
}

/** Literal de valor para o `.sql`, com o reforço da contrabarra no MySQL. */
function valorSql(valor: string | null, dialeto: DialetoSql): string {
  if (valor === null) return "NULL";
  if (dialeto === "mysql") {
    // No MySQL a contrabarra é escape dentro da string por padrão
    // (`NO_BACKSLASH_ESCAPES` desligado): `'a\\nb'` vira `a`, newline, `b` no
    // recarregamento. Dobrar a contrabarra antes da aspa mantém o texto literal.
    return `'${valor.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
  }
  return sqlValue(valor);
}

function linhaInsert(
  tabela: string,
  colunas: readonly string[],
  valores: readonly (string | null)[],
  dialeto: DialetoSql,
): string {
  const cols = colunas.map((c) => citarIdent(c, dialeto)).join(", ");
  const vals = valores.map((v) => valorSql(v, dialeto)).join(", ");
  return `INSERT INTO ${tabela} (${cols}) VALUES (${vals});\n`;
}

/**
 * Formata uma linha no formato pedido. `primeira` distingue o primeiro elemento
 * do array JSON (sem vírgula à frente).
 */
function formatar(
  linha: readonly (string | null)[],
  plano: PlanoExportDriver,
  nomes: readonly string[],
  delimiter: string,
  primeira: boolean,
): string {
  if (plano.format === "csv") return csvLine(linha, delimiter);
  if (plano.format === "sql") {
    return linhaInsert(plano.sqlTabela ?? "", nomes, linha, plano.dialeto);
  }
  const objeto = Object.fromEntries(nomes.map((nome, i) => [nome, linha[i] ?? null]));
  const json = JSON.stringify(objeto);
  if (plano.format === "ndjson") return `${json}\n`;
  return primeira ? json : `,${json}`;
}

/**
 * Monta o stream de exportação a partir de um produtor de páginas.
 *
 * O `onDone` é chamado **exatamente uma vez** em qualquer desfecho (fim, erro,
 * cancelamento) — é por ele que o serviço registra a auditoria. Diferente do
 * Postgres, aqui não há transação a encerrar: o driver já devolveu/devolve suas
 * conexões ao pool em cada chamada de página.
 */
export function exportarEmStream(
  plano: PlanoExportDriver,
  onDone: AoFinalizarExport,
): { stream: ReadableStream<Uint8Array>; contentType: string } {
  const opcoes = csvOptions(plano.csv);
  const encoder = new TextEncoder();

  let nomes: readonly string[] = [];
  let entregues = 0;
  let bytes = 0;
  let cabecalhoEnviado = false;
  let acabou = false;

  function emitir(
    controller: ReadableStreamDefaultController<Uint8Array>,
    texto: string,
  ): void {
    const chunk = encoder.encode(texto);
    bytes += chunk.byteLength;
    controller.enqueue(chunk);
  }

  const encerrar = (
    controller: ReadableStreamDefaultController<Uint8Array> | null,
    erro: string | null,
  ): void => {
    if (acabou) return;
    acabou = true;
    if (controller !== null && erro === null) {
      // O array JSON só fecha se o cabeçalho (o `[`) chegou a sair.
      if (plano.format === "json" && cabecalhoEnviado) emitir(controller, "]");
      else if (plano.format === "json") {
        emitir(controller, "[]");
      }
      controller.close();
    }
    onDone({ rows: entregues, bytes }, erro);
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (acabou) return;
      try {
        const pagina = await plano.proximaPagina();

        if (!cabecalhoEnviado && pagina !== null) {
          nomes = pagina.columns;
          cabecalhoEnviado = true;
          if (plano.format === "csv") {
            if (opcoes.bom) emitir(controller, "﻿");
            if (opcoes.header) emitir(controller, csvLine(nomes, opcoes.delimiter));
          }
          if (plano.format === "json") emitir(controller, "[");
          if (plano.format === "sql" && plano.sqlPrelude !== undefined) {
            emitir(controller, plano.sqlPrelude);
          }
        }

        if (pagina === null || pagina.rows.length === 0) {
          encerrar(controller, null);
          return;
        }

        // Um `enqueue` por página, não por linha: o texto que vive de cada vez
        // continua sendo uma página só.
        const pedaco: string[] = [];
        for (const linha of pagina.rows) {
          pedaco.push(formatar(linha, plano, nomes, opcoes.delimiter, entregues === 0));
          entregues++;
        }
        emitir(controller, pedaco.join(""));
      } catch (err: unknown) {
        const mensagem = err instanceof Error ? err.message : "erro desconhecido no export";
        encerrar(controller, mensagem);
        controller.error(err);
      }
    },
    cancel(reason: unknown) {
      encerrar(null, reason instanceof Error ? reason.message : "cancelado pelo consumidor");
    },
  });

  return { stream, contentType: CONTENT_TYPE[plano.format] };
}
