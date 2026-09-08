import type { PoolClient } from "pg";

import { EXPORT_BATCH, sqlInsertLine } from "@dbee/shared";

import { TUDO_TEXTO } from "./tipos";

/**
 * Dump `.sql` de **várias** tabelas num arquivo só.
 *
 * ## Uma transação, um instante
 *
 * Todas as tabelas saem da **mesma** transação `REPEATABLE READ`. Não é
 * detalhe: em transações separadas, a tabela A seria lida às 10h00 e a B às
 * 10h02, e uma FK criada nesse intervalo apareceria só de um lado — o arquivo
 * não recarregaria. Um snapshot só é o que torna o dump recarregável.
 *
 * ## Um cursor por vez
 *
 * Cada tabela declara o seu cursor, esvazia em lotes de `EXPORT_BATCH` e fecha
 * antes de a próxima abrir. `FETCH n` materializa n linhas na memória (§6), e o
 * que mantém o pico baixo é o lote, não o número de tabelas: 300 tabelas de 1
 * milhão de linhas gastam a mesma memória que uma.
 */

export interface BundleTablePlan {
  readonly schema: string;
  readonly table: string;
  /** `"public"."pedidos"` — já citado. */
  readonly qualified: string;
  /** `CREATE TABLE` de referência. `null` quando só os dados foram pedidos. */
  readonly ddl: string | null;
  /** `SELECT` das linhas. `null` quando só a estrutura foi pedida. */
  readonly selectSql: string | null;
  readonly columns: readonly string[];
  readonly dropFirst: boolean;
}

export interface BundleOutcome {
  readonly tables: number;
  readonly rows: number;
}

const codificador = new TextEncoder();

function nomeCursor(indice: number): string {
  return `dbee_bundle_${String(indice)}`;
}

/**
 * Cabeçalho do arquivo. Diz o que ele é **e o que não é** — quem receber um
 * `.sql` do DBee não pode achar que recebeu um `pg_dump`.
 */
function cabecalho(planos: readonly BundleTablePlan[]): string {
  return (
    `-- Dump gerado pelo DBee em ${new Date().toISOString()}\n` +
    `-- ${String(planos.length)} tabela(s), de um único snapshot REPEATABLE READ.\n` +
    "--\n" +
    "-- Isto NÃO é um pg_dump. Saem colunas, defaults, NOT NULL e PRIMARY KEY.\n" +
    "-- Ficam de fora: FKs, índices não-PK, checks, sequences, triggers, views,\n" +
    "-- permissões e ownership.\n\n"
  );
}

/**
 * Monta o stream.
 *
 * `aoTerminar` roda uma vez, no fim ou no cancelamento, e é quem devolve o
 * cliente ao pool — a transação vive enquanto o stream viver.
 */
export function streamBundle(
  client: PoolClient,
  planos: readonly BundleTablePlan[],
  aoTerminar: (resultado: BundleOutcome, erro: string | null) => void,
): ReadableStream<Uint8Array> {
  let indice = 0;
  /** `null` = o cursor da tabela corrente ainda não foi aberto. */
  let cursorAberto: string | null = null;
  let linhas = 0;
  let tabelas = 0;
  let encerrado = false;

  const encerrar = (erro: string | null): void => {
    if (encerrado) return;
    encerrado = true;
    aoTerminar({ tables: tabelas, rows: linhas }, erro);
  };

  const emitir = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    texto: string,
  ): void => {
    controller.enqueue(codificador.encode(texto));
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      emitir(controller, cabecalho(planos));
    },

    async pull(controller) {
      try {
        if (indice >= planos.length) {
          encerrar(null);
          controller.close();
          return;
        }

        const plano = planos[indice];
        if (plano === undefined) {
          encerrar(null);
          controller.close();
          return;
        }

        // Primeira visita a esta tabela: cabeçalho, DROP e DDL.
        if (cursorAberto === null) {
          let bloco = `\n-- ----------------------------------------------------------\n`;
          bloco += `-- ${plano.schema}.${plano.table}\n`;
          bloco += `-- ----------------------------------------------------------\n`;
          if (plano.dropFirst) bloco += `DROP TABLE IF EXISTS ${plano.qualified} CASCADE;\n`;
          if (plano.ddl !== null) bloco += plano.ddl;
          emitir(controller, bloco);

          if (plano.selectSql === null) {
            // Só estrutura: nada a paginar, passa para a próxima.
            tabelas += 1;
            indice += 1;
            return;
          }

          const cursor = nomeCursor(indice);
          await client.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR ${plano.selectSql}`);
          cursorAberto = cursor;
          emitir(controller, "\n");
        }

        const lote = await client.query<(string | null)[]>({
          text: `FETCH ${String(EXPORT_BATCH)} FROM ${cursorAberto}`,
          rowMode: "array",
          types: TUDO_TEXTO,
        });

        if (lote.rows.length > 0) {
          // Um `enqueue` por lote, não por linha: emitir linha a linha custa
          // uma travessia de stream por linha e domina o tempo do export.
          let pedaco = "";
          for (const linha of lote.rows) {
            pedaco += sqlInsertLine(plano.qualified, plano.columns, linha);
          }
          linhas += lote.rows.length;
          emitir(controller, pedaco);
        }

        // Lote menor que o pedido = acabou a tabela.
        if (lote.rows.length < EXPORT_BATCH) {
          await client.query(`CLOSE ${cursorAberto}`);
          cursorAberto = null;
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
