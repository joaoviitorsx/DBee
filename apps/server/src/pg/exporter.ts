import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

import {
  CONTENT_TYPE,
  EXPORT_BATCH,
  csvLine,
  csvOptions,
  sqlInsertLine,
  type CsvOptions,
  type ExportFormat,
} from "@dbee/shared";

import { resolveColumns } from "./columns";

/**
 * Export em stream (DBee.md §5, §6).
 *
 * **O laço de `FETCH` em lotes é a razão de existir desta rota.** Um export com
 * `maxRows` alto seria uma query comum: as linhas inteiras na memória do
 * processo antes de sair a primeira. Medido no spike: ~2 KB de RSS por linha —
 * 500 mil linhas seriam ~1 GB (§11.11).
 *
 * A contrapressão vem do `pull` do `ReadableStream`: cada chamada busca **um**
 * lote e o entrega. Enquanto o consumidor não pede, nada é buscado, e só um
 * lote existe na memória de cada vez. Empurrar tudo no `start` seria voltar ao
 * problema com uma API diferente.
 */

type Cell = string | null;

interface TextTypesConfig {
  getTypeParser: () => (value: string) => string;
}
const TUDO_TEXTO: TextTypesConfig = { getTypeParser: () => (v) => v };

export interface ExportPlan {
  /** SQL do usuário, ou o montado a partir da relação. */
  readonly sql: string;
  readonly format: ExportFormat;
  readonly csv: CsvOptions | undefined;
  readonly maxRows: number | undefined;
  /** Parâmetros ligados, quando a origem é uma relação com filtros. */
  readonly values: readonly (string | null)[];
  /**
   * Só no formato `sql`. `tabela` é o nome qualificado e citado do destino do
   * `INSERT` (`"public"."pedidos"`); `prelude` é o `CREATE TABLE` gerado da
   * introspecção, emitido uma vez antes das linhas. Ausentes nos outros
   * formatos, e `export.service` garante que só a origem tabela chega aqui com
   * `format: "sql"`.
   */
  readonly sqlTable?: string;
  readonly sqlPrelude?: string;
}

export interface ExportOutcome {
  readonly rows: number;
  readonly bytes: number;
}

/**
 * Chamado **exatamente uma vez**, em qualquer desfecho: fim normal, erro no
 * meio, ou desistência do consumidor. É por aqui que a transação é encerrada e
 * o cliente volta ao pool — se algum caminho não passasse por aqui, o cliente
 * ficaria emprestado para sempre e cinco exports abandonados esgotariam o pool.
 */
export type OnExportDone = (outcome: ExportOutcome, erro: string | null) => void;

/**
 * Abre o cursor e devolve um stream que busca um lote por vez.
 *
 * Quem chama é responsável por manter a transação aberta enquanto o stream
 * vive — o cursor só existe dentro dela — e por encerrá-la no `onDone`.
 */
export async function streamExport(
  client: PoolClient,
  plan: ExportPlan,
  onDone: OnExportDone,
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string }> {
  const cursor = `dbee_exp_${randomBytes(8).toString("hex")}`;
  const opcoes = csvOptions(plan.csv);
  const encoder = new TextEncoder();

  // Sem LIMIT injetado no SQL do usuário (§6). O teto, quando existe, é
  // aplicado contando as linhas entregues.
  await client.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR ${plan.sql}`, [...plan.values]);

  let nomes: string[] = [];
  let entregues = 0;
  let bytes = 0;
  let cabecalhoEnviado = false;
  let acabou = false;

  /** Único ponto de saída: fecha o stream se ainda estiver aberto e avisa. */
  const encerrar = (
    controller: ReadableStreamDefaultController<Uint8Array> | null,
    erro: string | null,
  ): void => {
    if (acabou) return;
    acabou = true;
    if (controller !== null && erro === null) {
      if (plan.format === "json") emitir(controller, "]");
      controller.close();
    }
    onDone({ rows: entregues, bytes }, erro);
  };

  function emitir(
    controller: ReadableStreamDefaultController<Uint8Array>,
    texto: string,
  ): void {
    const chunk = encoder.encode(texto);
    bytes += chunk.byteLength;
    controller.enqueue(chunk);
  }

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (acabou) return;

      try {
        const restante =
          plan.maxRows === undefined
            ? EXPORT_BATCH
            : Math.min(EXPORT_BATCH, plan.maxRows - entregues);

        if (restante <= 0) {
          encerrar(controller, null);
          return;
        }

        const lote = await client.query<Cell[]>({
          text: `FETCH ${String(restante)} FROM ${cursor}`,
          rowMode: "array",
          types: TUDO_TEXTO,
        });

        if (!cabecalhoEnviado) {
          nomes = (await resolveColumns(client, lote.fields)).map((c) => c.name);
          cabecalhoEnviado = true;

          if (plan.format === "csv") {
            // BOM primeiro, senão o Excel lê a codificação errada.
            if (opcoes.bom) emitir(controller, "﻿");
            if (opcoes.header) emitir(controller, csvLine(nomes, opcoes.delimiter));
          }
          if (plan.format === "json") emitir(controller, "[");
          // CREATE TABLE de referência antes de qualquer INSERT. Só existe na
          // origem tabela — `export.service` monta o prelude e o passa aqui.
          if (plan.format === "sql" && plan.sqlPrelude !== undefined) {
            emitir(controller, plan.sqlPrelude);
          }
        }

        if (lote.rows.length === 0) {
          encerrar(controller, null);
          return;
        }

        // Um `enqueue` por lote, não por linha. Emitir linha a linha custava
        // 150 mil encodes e 150 mil pedaços de fila para 150 mil linhas; o
        // texto que vive de cada vez continua sendo um lote só, então o teto
        // de memória não muda.
        const pedaco: string[] = [];
        for (const linha of lote.rows) {
          pedaco.push(
            formatar(linha, plan.format, nomes, opcoes.delimiter, entregues === 0, plan.sqlTable),
          );
          entregues++;
        }
        emitir(controller, pedaco.join(""));

        // Lote menor que o pedido significa que o cursor acabou.
        if (lote.rows.length < restante) encerrar(controller, null);
      } catch (err: unknown) {
        // O erro no meio do corpo não vira status HTTP: os headers já saíram.
        // O que ele precisa garantir é que a transação feche — o consumidor vê
        // um download truncado, e o log registra a causa.
        const mensagem = err instanceof Error ? err.message : "erro desconhecido no export";
        encerrar(controller, mensagem);
        controller.error(err);
      }
    },

    cancel(reason: unknown) {
      // Consumidor desistiu (fechou a aba, cancelou o download). Sem isto o
      // cliente do pool ficaria emprestado até o processo morrer.
      encerrar(null, reason instanceof Error ? reason.message : "cancelado pelo consumidor");
    },
  });

  return { stream, contentType: CONTENT_TYPE[plan.format] };
}

function formatar(
  linha: readonly Cell[],
  format: ExportFormat,
  nomes: readonly string[],
  delimiter: string,
  primeira: boolean,
  sqlTable: string | undefined,
): string {
  if (format === "csv") return csvLine(linha, delimiter);

  if (format === "sql") {
    // `sqlTable` sempre presente aqui: `export.service` só produz `format:
    // "sql"` para origem tabela, e nela o nome qualificado é montado junto.
    return sqlInsertLine(sqlTable ?? "", nomes, linha);
  }

  const objeto = Object.fromEntries(nomes.map((nome, i) => [nome, linha[i] ?? null]));
  const json = JSON.stringify(objeto);

  // NDJSON: um objeto por linha, sem vírgula e sem colchete — é o formato que
  // se lê em stream do outro lado.
  if (format === "ndjson") return `${json}\n`;

  return primeira ? json : `,${json}`;
}
