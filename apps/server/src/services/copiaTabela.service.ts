import type { CopyTableRequest, CopyTableResponse, RowsResponse } from "@dbee/shared";
import { COPIA_TABELA_ROWS_PADRAO } from "@dbee/shared";
import { dialetoDe, montarScriptCopia } from "@dbee/shared/puro";

import type { ConnectionsRepository } from "../db/connections.repo";
import type { Ator } from "../lib/ator";
import { type ServiceResult, fail, ok } from "./result";
import type { RowsService } from "./rows.service";
import type { SchemaService } from "./schema.service";

const PAGINA = 1000;
const ENGINES_SQL = new Set(["postgres", "mysql", "mariadb", "sqlite", "libsql"]);

/**
 * "Copiar tabela para…" (ideia I10; mesmo princípio do ADR 018). **Não executa
 * nada no destino** — devolve texto para o editor.
 *
 * - Origem: permissão pelo ator e linhas pelo `RowsService` (o caminho da aba
 *   Dados: relação conferida no catálogo, `READ ONLY` ou credencial de leitura,
 *   cada página no `query_log`), com teto de linhas.
 * - Destino: só prova de acesso (`find` pelo ator) e o dialeto. Nenhuma conexão
 *   é aberta nele.
 */
export class CopiaTabelaService {
  constructor(
    private readonly deps: { conexoes: ConnectionsRepository; schema: SchemaService; rows: RowsService },
  ) {}

  async gerar(
    connectionId: string,
    schemaName: string,
    tabela: string,
    req: CopyTableRequest,
    ator: Ator,
  ): Promise<ServiceResult<CopyTableResponse>> {
    const origem = this.deps.conexoes.find(connectionId, ator);
    const destino = this.deps.conexoes.find(req.targetConnectionId, ator);
    if (origem === null || destino === null) return fail("not_found");
    for (const c of [origem, destino]) {
      if (!ENGINES_SQL.has(c.engine)) {
        return fail("bad_request", `engine_not_supported: copiar tabela só entre engines SQL (${c.engine})`);
      }
    }

    const cat = await this.deps.schema.get(connectionId, req.database, false, ator);
    if (!cat.ok) return cat;
    const relacao = cat.value.schemas.find((s) => s.name === schemaName)?.relations.find((r) => r.name === tabela);
    if (relacao === undefined) return fail("not_found", `${schemaName}.${tabela} não existe neste database`);

    const maxRows = req.maxRows ?? COPIA_TABELA_ROWS_PADRAO;
    const lidas = await this.#ler(connectionId, schemaName, tabela, req.database, maxRows, ator);
    if (!lidas.ok) return lidas;

    const dialeto = dialetoDe(destino.engine);
    const schemaDestino =
      req.targetSchema ?? (dialeto === "sqlite" ? "main" : dialeto === "mysql" ? destino.database : schemaName);
    try {
      const { sql, warnings } = montarScriptCopia({
        relacao,
        origem: dialetoDe(origem.engine),
        destino: dialeto,
        schemaDestino,
        tabelaDestino: req.targetTable ?? tabela,
        colunas: lidas.value.colunas.length > 0 ? lidas.value.colunas : relacao.columns.map((c) => c.name),
        linhas: lidas.value.linhas,
        truncado: lidas.value.truncado,
        descricaoOrigem: `${origem.name} · ${schemaName}.${tabela}`,
      });
      const avisos = lidas.value.semPk
        ? [...warnings, "tabela sem chave primária: leitura por OFFSET, ordem não garantida"]
        : warnings;
      return ok({ sql, targetDialect: dialeto, rowCount: lidas.value.linhas.length, truncated: lidas.value.truncado, warnings: avisos });
    } catch (e: unknown) {
      return fail("bad_request", e instanceof Error ? e.message : "entrada inválida");
    }
  }

  /** Páginas de keyset (ou OFFSET, sem PK) até `maxRows`. */
  async #ler(
    connectionId: string,
    schema: string,
    tabela: string,
    database: string | undefined,
    maxRows: number,
    ator: Ator,
  ): Promise<ServiceResult<{ colunas: string[]; linhas: (string | null)[][]; truncado: boolean; semPk: boolean }>> {
    const linhas: (string | null)[][] = [];
    let colunas: string[] = [];
    let after: RowsResponse["nextCursor"] = null;
    if (maxRows === 0) return ok({ colunas, linhas, truncado: false, semPk: false });
    for (;;) {
      // Pede uma linha a mais na última página para saber se truncou.
      const falta = maxRows - linhas.length;
      const r = await this.deps.rows.read(
        connectionId,
        schema,
        tabela,
        {
          limit: Math.min(PAGINA, falta + 1),
          ...(database === undefined ? {} : { database }),
          ...(after === null ? {} : { after }),
          ...(after === null && linhas.length > 0 ? { offset: linhas.length } : {}),
        },
        ator,
      );
      if (!r.ok) return r;
      colunas = r.value.columns.map((c) => c.name);
      const semPk = !r.value.keyset;
      linhas.push(...r.value.rows);
      if (linhas.length > maxRows) return ok({ colunas, linhas: linhas.slice(0, maxRows), truncado: true, semPk });
      if (!r.value.hasMore) return ok({ colunas, linhas, truncado: false, semPk });
      if (linhas.length === maxRows) return ok({ colunas, linhas, truncado: true, semPk });
      after = semPk ? null : r.value.nextCursor;
      if (!semPk && after === null) return ok({ colunas, linhas, truncado: false, semPk });
    }
  }
}
