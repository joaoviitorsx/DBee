import type { PoolClient } from "pg";

import {
  csvLine,
  EXPORT_BATCH,
  EXTENSAO_BUNDLE,
  SEPARADOR_BUNDLE,
  sqlInsertLine,
  type BundleData,
  type BundleFormat,
} from "@dbee/shared";

import { ZipWriter } from "../lib/zip";
import { TUDO_TEXTO } from "./tipos";

/**
 * Export de **várias** tabelas, em qualquer formato.
 *
 * ## Uma transação, um instante
 *
 * Todas as tabelas saem da **mesma** transação `REPEATABLE READ`. Não é
 * detalhe: em transações separadas, a tabela A seria lida às 10h00 e a B às
 * 10h02, e uma FK criada nesse intervalo apareceria só de um lado — o arquivo
 * não recarregaria.
 *
 * ## Um cursor por vez
 *
 * Cada tabela declara o seu cursor, esvazia em lotes de `EXPORT_BATCH` e fecha
 * antes de a próxima abrir. `FETCH n` materializa n linhas na memória (§6); o
 * que mantém o pico baixo é o lote, não o número de tabelas.
 *
 * ## Dois recipientes
 *
 * `sql` sai como **um arquivo** contínuo. Os demais formatos saem como **um
 * arquivo por tabela dentro de um `.zip`** — CSVs concatenados num arquivo só
 * não são lidos por ferramenta nenhuma.
 */

export interface BundleTablePlan {
  readonly schema: string;
  readonly table: string;
  /** `"public"."pedidos"` — já citado. */
  readonly qualified: string;
  /** DDL da tabela. `null` quando a estrutura não foi pedida. */
  readonly ddl: string | null;
  /** `CREATE INDEX`/`CREATE TRIGGER` que acompanham a tabela. */
  readonly extras: readonly string[];
  /** `SELECT` das linhas. `null` quando só a estrutura foi pedida. */
  readonly selectSql: string | null;
  readonly columns: readonly string[];
  readonly dropFirst: boolean;
}

export interface BundleOptions {
  readonly format: BundleFormat;
  readonly data: BundleData;
  /** `CREATE FUNCTION` do schema, emitidos uma vez antes das tabelas. */
  readonly routines: readonly string[];
}

export interface BundleOutcome {
  readonly tables: number;
  readonly rows: number;
}

const codificador = new TextEncoder();

/** Escapa um valor para dentro de um `COPY … FROM stdin` em formato texto. */
function copyField(valor: string | null): string {
  if (valor === null) return "\\N";
  return valor
    .replaceAll("\\", "\\\\")
    .replaceAll("\t", "\\t")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
}

/**
 * Cabeçalho do arquivo.
 *
 * Lista o que **de fato** entrou nesta geração, não uma lista fixa: com
 * índices e triggers virando opção, um texto estático passaria a mentir para
 * metade dos dumps.
 */
function cabecalhoSql(planos: readonly BundleTablePlan[], opcoes: BundleOptions): string {
  const incluidos = ["colunas", "defaults", "NOT NULL", "PRIMARY KEY"];
  if (planos.some((p) => p.extras.length > 0)) incluidos.push("índices/triggers");
  if (opcoes.routines.length > 0) incluidos.push("funções");

  return (
    `-- Dump gerado pelo DBee em ${new Date().toISOString()}\n` +
    `-- ${String(planos.length)} tabela(s), de um único snapshot REPEATABLE READ.\n` +
    "--\n" +
    "-- Isto NÃO é um pg_dump.\n" +
    `-- Entra: ${incluidos.join(", ")}.\n` +
    "-- Fica de fora: FKs, sequences avulsas, views, permissões e ownership.\n\n"
  );
}

/** Cabeçalho de coluna dos formatos tabulares. */
function linhaTabular(
  valores: readonly (string | null)[],
  format: BundleFormat,
): string {
  const sep = SEPARADOR_BUNDLE[format];
  if (format === "tsv") {
    return (
      valores
        .map((v) => (v ?? "").replaceAll("\t", " ").replaceAll("\n", " ").replaceAll("\r", ""))
        .join("\t") + "\r\n"
    );
  }
  return csvLine(valores, sep);
}

/**
 * Estado de escrita: ou um arquivo contínuo (SQL), ou um zip com um arquivo por
 * tabela. Separar isso do laço evita um `if (zip)` em cada emissão.
 */
interface Recipiente {
  /** Abre o arquivo da tabela. Devolve bytes a emitir, se houver. */
  readonly abrirTabela: (plano: BundleTablePlan) => Uint8Array | null;
  readonly escrever: (texto: string) => Uint8Array;
  readonly fecharTabela: () => Uint8Array | null;
  readonly finalizar: () => Uint8Array | null;
}

function recipienteSql(): Recipiente {
  return {
    abrirTabela: () => null,
    escrever: (texto) => codificador.encode(texto),
    fecharTabela: () => null,
    finalizar: () => null,
  };
}

function recipienteZip(format: BundleFormat): Recipiente {
  const zip = new ZipWriter();
  return {
    abrirTabela: (plano) =>
      zip.abrir(`${plano.schema}.${plano.table}.${EXTENSAO_BUNDLE[format]}`),
    escrever: (texto) => zip.escrever(codificador.encode(texto)),
    fecharTabela: () => zip.fechar(),
    finalizar: () => zip.finalizar(),
  };
}

export function streamBundle(
  client: PoolClient,
  planos: readonly BundleTablePlan[],
  opcoes: BundleOptions,
  aoTerminar: (resultado: BundleOutcome, erro: string | null) => void,
): ReadableStream<Uint8Array> {
  const ehSql = opcoes.format === "sql";
  const recipiente = ehSql ? recipienteSql() : recipienteZip(opcoes.format);

  let indice = 0;
  let cursorAberto: string | null = null;
  let primeiraLinhaDaTabela = true;
  let linhas = 0;
  let tabelas = 0;
  let encerrado = false;

  const encerrar = (erro: string | null): void => {
    if (encerrado) return;
    encerrado = true;
    aoTerminar({ tables: tabelas, rows: linhas }, erro);
  };

  const emitir = (
    c: ReadableStreamDefaultController<Uint8Array>,
    bytes: Uint8Array | null,
  ): void => {
    if (bytes !== null && bytes.length > 0) c.enqueue(bytes);
  };

  const texto = (
    c: ReadableStreamDefaultController<Uint8Array>,
    valor: string,
  ): void => {
    if (valor !== "") emitir(c, recipiente.escrever(valor));
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (ehSql) {
        emitir(controller, codificador.encode(cabecalhoSql(planos, opcoes)));
        for (const rotina of opcoes.routines) {
          emitir(controller, codificador.encode(`${rotina};\n\n`));
        }
      }
    },

    async pull(controller) {
      try {
        if (indice >= planos.length) {
          emitir(controller, recipiente.finalizar());
          encerrar(null);
          controller.close();
          return;
        }

        const plano = planos[indice];
        if (plano === undefined) {
          emitir(controller, recipiente.finalizar());
          encerrar(null);
          controller.close();
          return;
        }

        // Primeira visita a esta tabela: abre o arquivo/seção e emite estrutura.
        if (cursorAberto === null && primeiraLinhaDaTabela) {
          emitir(controller, recipiente.abrirTabela(plano));

          if (ehSql) {
            let bloco = "\n-- ----------------------------------------------------------\n";
            bloco += `-- ${plano.schema}.${plano.table}\n`;
            bloco += "-- ----------------------------------------------------------\n";
            if (plano.dropFirst) bloco += `DROP TABLE IF EXISTS ${plano.qualified} CASCADE;\n`;
            if (plano.ddl !== null) bloco += plano.ddl;
            for (const extra of plano.extras) bloco += `${extra};\n`;
            texto(controller, bloco);
          }

          if (plano.selectSql === null) {
            emitir(controller, recipiente.fecharTabela());
            tabelas += 1;
            indice += 1;
            return;
          }

          // Cabeçalho de coluna dos formatos tabulares; abertura do array JSON.
          if (opcoes.format === "csv" || opcoes.format === "csv-comma" || opcoes.format === "tsv") {
            texto(controller, linhaTabular(plano.columns, opcoes.format));
          } else if (opcoes.format === "json") {
            texto(controller, "[\n");
          } else if (ehSql && opcoes.data === "copy") {
            const cols = plano.columns.map((c) => `"${c.replaceAll('"', '""')}"`).join(", ");
            texto(controller, `COPY ${plano.qualified} (${cols}) FROM stdin;\n`);
          } else if (ehSql) {
            texto(controller, "\n");
          }

          const cursor = `dbee_bundle_${String(indice)}`;
          await client.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR ${plano.selectSql}`);
          cursorAberto = cursor;
          primeiraLinhaDaTabela = true;
        }

        if (cursorAberto === null) return;

        const lote = await client.query<(string | null)[]>({
          text: `FETCH ${String(EXPORT_BATCH)} FROM ${cursorAberto}`,
          rowMode: "array",
          types: TUDO_TEXTO,
        });

        if (lote.rows.length > 0) {
          // Um `enqueue` por lote, não por linha: emitir linha a linha custa uma
          // travessia de stream por linha e domina o tempo do export.
          let pedaco = "";
          for (const linha of lote.rows) {
            if (ehSql) {
              pedaco +=
                opcoes.data === "copy"
                  ? `${linha.map(copyField).join("\t")}\n`
                  : sqlInsertLine(
                      plano.qualified,
                      plano.columns,
                      linha,
                      opcoes.data === "insert-conflict" ? "ON CONFLICT DO NOTHING" : "",
                    );
            } else if (opcoes.format === "json") {
              const objeto = Object.fromEntries(plano.columns.map((c, i) => [c, linha[i] ?? null]));
              pedaco += `${primeiraLinhaDaTabela ? "  " : ",\n  "}${JSON.stringify(objeto)}`;
              primeiraLinhaDaTabela = false;
            } else if (opcoes.format === "ndjson") {
              const objeto = Object.fromEntries(plano.columns.map((c, i) => [c, linha[i] ?? null]));
              pedaco += `${JSON.stringify(objeto)}\n`;
            } else {
              pedaco += linhaTabular(linha, opcoes.format);
            }
          }
          linhas += lote.rows.length;
          texto(controller, pedaco);
        }

        // Lote menor que o pedido = acabou a tabela.
        if (lote.rows.length < EXPORT_BATCH) {
          await client.query(`CLOSE ${cursorAberto}`);
          cursorAberto = null;

          if (opcoes.format === "json") texto(controller, "\n]\n");
          // O `\.` fecha o COPY; sem ele o arquivo não recarrega.
          else if (ehSql && opcoes.data === "copy") texto(controller, "\\.\n");

          emitir(controller, recipiente.fecharTabela());
          primeiraLinhaDaTabela = true;
          tabelas += 1;
          indice += 1;
        }
      } catch (erro: unknown) {
        const mensagem = erro instanceof Error ? erro.message : "erro desconhecido";
        encerrar(mensagem);
        controller.error(erro);
      }
    },

    cancel() {
      // Navegador fechou a aba, ou o download foi abortado. A transação precisa
      // ser devolvida do mesmo jeito — senão o cliente fica preso ao pool.
      encerrar("cancelado pelo cliente");
    },
  });
}
