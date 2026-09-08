import { AUDIT_PAGE_SIZE, type AuditPage, type AuditQuery } from "@dbee/shared";

import type { QueryLogRepository } from "../db/queryLog.repo";
import type { Ator } from "../lib/ator";

/**
 * Auditoria — o `query_log` pesquisável (v0.2).
 *
 * Só-leitura sobre o SQLite local, sem tocar no Postgres: o log é a fonte, e a
 * pergunta que a tela responde ("quem rodou o quê, quando") já está gravada. A
 * normalização mora aqui — a query string vira filtros tipados, e o `limit` é
 * preso ao teto para uma requisição não varrer o log inteiro.
 */
export class AuditService {
  readonly #log: QueryLogRepository;

  constructor(log: QueryLogRepository) {
    this.#log = log;
  }

  /**
   * O ator não é decoração: sem ele a auditoria devolveria o log inteiro para
   * qualquer conta, incluindo o SQL de conexões que a pessoa não enxerga.
   */
  search(query: AuditQuery, ator: Ator): AuditPage {
    const pedido = Number.parseInt(query.limit ?? "", 10);
    const limit =
      Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, AUDIT_PAGE_SIZE) : AUDIT_PAGE_SIZE;

    return this.#log.search({
      q: query.q,
      status: query.status,
      connectionId: query.connectionId,
      actor: query.actor,
      // Admin audita tudo; membro só o que enxerga.
      visivelPara: ator.role === "admin" ? undefined : ator.id,
      limit,
      cursor: query.cursor,
    });
  }
}
