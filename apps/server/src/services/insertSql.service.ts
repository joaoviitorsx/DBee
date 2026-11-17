import type { InsertSqlRequest, InsertSqlResponse } from "@dbee/shared";
import { dialetoDe, montarInserts } from "@dbee/shared/puro";

import type { ConnectionsRepository } from "../db/connections.repo";
import type { Ator } from "../lib/ator";
import { type ServiceResult, fail, ok } from "./result";
import type { SchemaService } from "./schema.service";

/**
 * "Copiar como INSERT". Só monta texto: nenhuma transação de dado, nenhum
 * `query_log` (nada executa). Permissão pelo ator; colunas conferidas no
 * catálogo (cacheado) para o identificador não vir da requisição sem prova.
 */
export class InsertSqlService {
  constructor(private readonly deps: { conexoes: ConnectionsRepository; schema: SchemaService }) {}

  async gerar(
    connectionId: string,
    schemaName: string,
    tabela: string,
    req: InsertSqlRequest,
    ator: Ator,
  ): Promise<ServiceResult<InsertSqlResponse>> {
    const conexao = this.deps.conexoes.find(connectionId, ator);
    if (conexao === null) return fail("not_found");
    const dialeto = dialetoDe(conexao.engine);
    if (!["postgres", "mysql", "mariadb", "sqlite", "libsql"].includes(conexao.engine)) {
      return fail("bad_request", `engine_not_supported: INSERT não se aplica a ${conexao.engine}`);
    }
    const cat = await this.deps.schema.get(connectionId, req.database, false, ator);
    if (!cat.ok) return cat;
    const rel = cat.value.schemas.find((s) => s.name === schemaName)?.relations.find((r) => r.name === tabela);
    if (rel === undefined) return fail("not_found", `${schemaName}.${tabela} não existe neste database`);
    const tipos = new Map(rel.columns.map((c) => [c.name, c.dataType]));
    const desconhecida = req.columns.find((c) => !tipos.has(c));
    if (desconhecida !== undefined) return fail("bad_request", `a coluna "${desconhecida}" não existe em ${tabela}`);
    try {
      const sql = montarInserts(
        { schema: schemaName, table: tabela, dialeto },
        req.columns,
        req.rows,
        dialeto === "postgres" ? tipos : undefined,
      );
      return ok({ sql });
    } catch (e: unknown) {
      return fail("bad_request", e instanceof Error ? e.message : "entrada inválida");
    }
  }
}
