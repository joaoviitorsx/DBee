import type { BundleFormat, DialetoSql } from "@dbee/shared";

import { linhaTabular, nomeDeEntrada } from "../lib/bundle-formato";
import { ZipWriter } from "../lib/zip";
import { linhaInsert, type PaginaExport } from "./exportador";

/**
 * Dump de **várias** tabelas para as engines que não são o Postgres (MySQL,
 * MariaDB, libSQL, SQLite).
 *
 * ## Por que não reusa `pg/bundle`
 *
 * O bundle do Postgres é `DECLARE CURSOR` + `FETCH` de uma **única** transação
 * `REPEATABLE READ` (regra 7 e §5): um instante só, cursor por tabela. As
 * outras engines não têm esse cursor — o libSQL fala HTTP, o SQLite roda no
 * worker, o MySQL materializa. O que todas têm é a grade por keyset
 * (`driver.linhas`), e o serviço a embrulha num **produtor de páginas** por
 * tabela. Este módulo é o laço genérico em cima disso, irmão do
 * `exportarEmStream` (que faz o de uma tabela só).
 *
 * ## Sem snapshot transacional entre tabelas
 *
 * Cada tabela é uma sequência de leituras independentes — não há a transação
 * única que dá ao Postgres o instante compartilhado. As tabelas podem, então,
 * ser lidas em instantes ligeiramente diferentes, e uma escrita concorrente
 * entre a primeira e a última apareceria só de um lado. É aceitável e honesto:
 * o cabeçalho do `.sql` gerado registra isso, para quem recarrega não presumir
 * uma consistência que a engine, por aqui, não garante.
 *
 * ## O que fica de fora
 *
 * Índices, triggers e rotinas são `pg_get_*` do catálogo do Postgres — não
 * existem por aqui, e o serviço já os ignora para estas engines. O bundle
 * não-PG cobre o `CREATE TABLE` de referência (do dialeto da engine) e os
 * dados. Sem `COPY … FROM stdin` (é do Postgres) e sem `ON CONFLICT` (dialeto
 * divergente entre elas): os dados saem sempre como `INSERT` simples, o mesmo
 * caminho do export de uma tabela.
 *
 * ## Dois recipientes
 *
 * `sql` sai como **um arquivo** contínuo. Os demais formatos saem como **um
 * arquivo por tabela dentro de um `.zip`** — o mesmo `lib/zip.ts` e o mesmo
 * `nomeDeEntrada` do bundle do Postgres, porque o formato de saída é idêntico;
 * só a origem das linhas muda.
 */

export interface BundleTablePlanoDriver {
  readonly schema: string;
  readonly table: string;
  /** Nome citado pelo dialeto: `` `pedidos` `` (MySQL) ou `"pedidos"` (SQLite). */
  readonly qualified: string;
  /** `CREATE TABLE` de referência. `null` quando a estrutura não foi pedida. */
  readonly ddl: string | null;
  readonly columns: readonly string[];
  readonly dropFirst: boolean;
  /**
   * Produtor de páginas de dados, ou `null` quando só a estrutura foi pedida.
   *
   * O serviço o fecha sobre o driver, a conexão e o cursor de keyset. Devolve a
   * próxima página, ou `null` quando a tabela acabou. Pode estourar — o erro é
   * propagado ao consumidor e o `onDone` é chamado com a causa.
   */
  readonly proximaPagina: (() => Promise<PaginaExport | null>) | null;
}

export interface BundleOpcoesDriver {
  readonly format: BundleFormat;
  readonly dialeto: DialetoSql;
}

/*
 * Não há campo `data` aqui de propósito. Diferente do bundle do Postgres, estas
 * engines não têm `COPY` nem um `ON CONFLICT` de dialeto comum: os dados saem
 * sempre como `INSERT` simples. Ligar ou desligar os dados é decisão do serviço
 * (o produtor de páginas é `null` quando `data` foi `none`), não deste laço.
 */

export interface ResultadoBundleDriver {
  readonly tables: number;
  readonly rows: number;
}

const codificador = new TextEncoder();

/**
 * Cabeçalho do `.sql`.
 *
 * Diz o que o arquivo é e — a diferença que importa em relação ao Postgres — o
 * que ele **não** garante: as tabelas não vieram de um instante único.
 */
function cabecalhoSql(planos: readonly BundleTablePlanoDriver[], dialeto: DialetoSql): string {
  return (
    `-- Dump gerado pelo DBee em ${new Date().toISOString()}\n` +
    `-- ${String(planos.length)} tabela(s), dialeto ${dialeto}.\n` +
    "--\n" +
    "-- Isto NÃO é um mysqldump/sqlite .dump.\n" +
    "-- Entra: colunas, NOT NULL, PRIMARY KEY (e DEFAULT no SQLite) + dados.\n" +
    "-- Fica de fora: FKs, índices, checks, triggers, rotinas, views e grants.\n" +
    "--\n" +
    "-- SEM snapshot único: cada tabela é lida à parte, então tabelas diferentes\n" +
    "-- podem refletir instantes ligeiramente diferentes. Estas engines não têm,\n" +
    "-- por este caminho, a transação que daria a elas um instante compartilhado.\n\n"
  );
}

/**
 * Estado de escrita: arquivo contínuo (SQL) ou zip com um arquivo por tabela.
 * O mesmo par do `pg/bundle`, para o formato de saída ser idêntico.
 */
interface Recipiente {
  readonly abrirTabela: (plano: BundleTablePlanoDriver) => Uint8Array | null;
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
  const usados = new Set<string>();
  return {
    abrirTabela: (plano) => zip.abrir(nomeDeEntrada(plano.schema, plano.table, format, usados)),
    escrever: (texto) => zip.escrever(codificador.encode(texto)),
    fecharTabela: () => zip.fechar(),
    finalizar: () => zip.finalizar(),
  };
}

/** O objeto de uma linha nos formatos JSON, na ordem das colunas. */
function objetoDaLinha(
  colunas: readonly string[],
  linha: readonly (string | null)[],
): Record<string, string | null> {
  return Object.fromEntries(colunas.map((c, i) => [c, linha[i] ?? null]));
}

/**
 * Monta o stream do dump a partir de um produtor de páginas por tabela.
 *
 * O `aoTerminar` é chamado **exatamente uma vez** em qualquer desfecho (fim,
 * erro, cancelamento) — é por ele que o serviço registra a auditoria e nada
 * fica preso. Diferente do Postgres, aqui não há transação a encerrar: o driver
 * já devolve suas conexões ao pool em cada página.
 *
 * O laço no `pull` repete o passo até **entregar bytes** ou encerrar, pela mesma
 * razão do `pg/bundle`: uma tabela com múltiplo exato do lote produz uma página
 * de zero linhas antes do `null`, e um `pull` que volta sem enfileirar e sem
 * fechar nunca é chamado de novo.
 */
export function streamBundleDriver(
  planos: readonly BundleTablePlanoDriver[],
  opcoes: BundleOpcoesDriver,
  aoTerminar: (resultado: ResultadoBundleDriver, erro: string | null) => void,
): ReadableStream<Uint8Array> {
  const ehSql = opcoes.format === "sql";
  const tabular =
    opcoes.format === "csv" || opcoes.format === "csv-comma" || opcoes.format === "tsv";
  const recipiente = ehSql ? recipienteSql() : recipienteZip(opcoes.format);

  let indice = 0;
  let tabelaAberta = false;
  let produtorAtual: (() => Promise<PaginaExport | null>) | null = null;
  let cabecalhoTabelaEnviado = false;
  let primeiraLinhaJson = true;
  let nomesAtual: readonly string[] = [];
  let linhas = 0;
  let tabelas = 0;
  let encerrado = false;

  const encerrar = (erro: string | null): void => {
    if (encerrado) return;
    encerrado = true;
    aoTerminar({ tables: tabelas, rows: linhas }, erro);
  };

  let enfileirou = false;

  const emitir = (
    c: ReadableStreamDefaultController<Uint8Array>,
    bytes: Uint8Array | null,
  ): void => {
    if (bytes !== null && bytes.length > 0) {
      c.enqueue(bytes);
      enfileirou = true;
    }
  };

  const texto = (c: ReadableStreamDefaultController<Uint8Array>, valor: string): void => {
    if (valor !== "") emitir(c, recipiente.escrever(valor));
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (ehSql) emitir(controller, codificador.encode(cabecalhoSql(planos, opcoes.dialeto)));
    },

    async pull(controller) {
      for (;;) {
        const entregou = await umPasso(controller);
        if (entregou || encerrado) return;
      }
    },

    cancel() {
      // Navegador fechou a aba, ou o download foi abortado. Não há transação a
      // devolver aqui, mas a auditoria precisa fechar mesmo assim.
      encerrar("cancelado pelo cliente");
    },
  });

  /**
   * Um avanço: abre uma tabela, busca a próxima página, ou fecha o arquivo.
   * Devolve `true` se entregou bytes ao consumidor.
   */
  async function umPasso(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): Promise<boolean> {
    enfileirou = false;
    try {
      const plano = planos[indice];
      if (plano === undefined) {
        emitir(controller, recipiente.finalizar());
        encerrar(null);
        controller.close();
        return enfileirou;
      }

      // Primeira visita a esta tabela: abre o arquivo/seção e emite a estrutura.
      if (!tabelaAberta) {
        tabelaAberta = true;
        cabecalhoTabelaEnviado = false;
        primeiraLinhaJson = true;
        nomesAtual = plano.columns;
        emitir(controller, recipiente.abrirTabela(plano));

        if (ehSql) {
          let bloco = "\n-- ----------------------------------------------------------\n";
          bloco += `-- ${plano.schema}.${plano.table}\n`;
          bloco += "-- ----------------------------------------------------------\n";
          // Sem CASCADE: o SQLite não o aceita em DROP TABLE, e no MySQL ele é
          // ruído. `IF EXISTS` já cobre o recarregamento repetido.
          if (plano.dropFirst) bloco += `DROP TABLE IF EXISTS ${plano.qualified};\n`;
          if (plano.ddl !== null) bloco += plano.ddl;
          texto(controller, bloco);
        }

        // Sem dados: fecha a tabela e avança.
        if (plano.proximaPagina === null) {
          emitir(controller, recipiente.fecharTabela());
          tabelas += 1;
          indice += 1;
          tabelaAberta = false;
          return enfileirou;
        }
        produtorAtual = plano.proximaPagina;
        return enfileirou;
      }

      if (produtorAtual === null) return enfileirou;
      const pagina = await produtorAtual();

      // Cabeçalho da tabela, na primeira página (mesmo vazia): CSV/TSV ganham a
      // linha de colunas; o JSON abre o array. Emitido da primeira página para
      // as colunas serem as que o SELECT de fato devolveu.
      if (!cabecalhoTabelaEnviado && pagina !== null) {
        cabecalhoTabelaEnviado = true;
        if (pagina.columns.length > 0) nomesAtual = pagina.columns;
        if (tabular) texto(controller, linhaTabular(nomesAtual, opcoes.format));
        else if (opcoes.format === "json") texto(controller, "[\n");
      }

      if (pagina === null) {
        // Fim da tabela: fecha o array JSON, então a entrada do recipiente. O
        // `[` só saiu se o cabeçalho chegou a ser enviado; sem ele, o array
        // inteiro é `[]`.
        if (opcoes.format === "json") {
          if (!cabecalhoTabelaEnviado) texto(controller, "[]\n");
          else texto(controller, primeiraLinhaJson ? "]\n" : "\n]\n");
        }
        emitir(controller, recipiente.fecharTabela());
        tabelas += 1;
        indice += 1;
        tabelaAberta = false;
        produtorAtual = null;
        return enfileirou;
      }

      if (pagina.rows.length > 0) {
        // Um `enqueue` por página, não por linha: emitir linha a linha custa uma
        // travessia de stream por linha e domina o tempo do export.
        let pedaco = "";
        for (const linha of pagina.rows) {
          if (ehSql) {
            pedaco += linhaInsert(plano.qualified, nomesAtual, linha, opcoes.dialeto);
          } else if (opcoes.format === "json") {
            pedaco += `${primeiraLinhaJson ? "  " : ",\n  "}${JSON.stringify(objetoDaLinha(nomesAtual, linha))}`;
            primeiraLinhaJson = false;
          } else if (opcoes.format === "ndjson") {
            pedaco += `${JSON.stringify(objetoDaLinha(nomesAtual, linha))}\n`;
          } else {
            pedaco += linhaTabular(linha, opcoes.format);
          }
        }
        linhas += pagina.rows.length;
        texto(controller, pedaco);
      }
      return enfileirou;
    } catch (erro: unknown) {
      const mensagem = erro instanceof Error ? erro.message : "erro desconhecido";
      encerrar(mensagem);
      controller.error(erro);
      return enfileirou;
    }
  }
}
