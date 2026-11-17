import type {
  SaveQueryRequest,
  SavedQuery,
  UpdateSavedQueryRequest,
} from "@dbee/shared";

import type { ConnectionsRepository } from "../db/connections.repo";
import type { Leitor, SavedQueriesRepository, SavedQueryRow } from "../db/savedQueries.repo";
import type { Ator } from "../lib/ator";

/** Falhas das queries salvas. Traduzidas em `SAVED_QUERY_FAILURES`. */
export type SavedQueryFailure = "not_found" | "connection_not_found" | "forbidden";

export type SavedQueryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: SavedQueryFailure };

const ok = <T>(value: T): SavedQueryResult<T> => ({ ok: true, value });
const fail = <T>(failure: SavedQueryFailure): SavedQueryResult<T> => ({ ok: false, failure });

/**
 * Queries salvas com dono e visibilidade (ADR 016).
 *
 * Regras, todas aqui e em nenhum outro lugar (a rota e o MCP chamam este
 * serviço, e a UI recebe `canEdit` pronto):
 *
 * 1. **Ver**: query do time, ou minha; e a conexão de origem, se houver,
 *    precisa ser uma que eu enxergo (o SQL é dado daquele banco).
 * 2. **Alterar/excluir**: o dono, ou admin — e só o que já é visível (admin
 *    não apaga rascunho privado alheio que nem vê).
 * 3. **Criar** atrelada a conexão: a conexão precisa ser minha (`find` pelo
 *    ator); senão um id vazado viraria rótulo de query do time.
 */
export class SavedQueriesService {
  readonly #repo: SavedQueriesRepository;
  readonly #conexoes: ConnectionsRepository;

  constructor({ repo, conexoes }: { repo: SavedQueriesRepository; conexoes: ConnectionsRepository }) {
    this.#repo = repo;
    this.#conexoes = conexoes;
  }

  listar(ator: Ator, q: string | null): SavedQuery[] {
    return this.#repo.listar(leitorDe(ator), q).map((r) => paraResposta(r, ator));
  }

  obter(id: string, ator: Ator): SavedQueryResult<SavedQuery> {
    const r = this.#repo.visivel(id, leitorDe(ator));
    return r === null ? fail("not_found") : ok(paraResposta(r, ator));
  }

  criar(body: SaveQueryRequest, ator: Ator): SavedQueryResult<SavedQuery> {
    const connectionId = body.connectionId ?? null;
    if (connectionId !== null && this.#conexoes.find(connectionId, ator) === null) {
      return fail("connection_not_found");
    }
    const id = this.#repo.criar(body.name, body.sql, connectionId, ator.id, body.visibility ?? "private");
    return this.obter(id, ator);
  }

  atualizar(id: string, body: UpdateSavedQueryRequest, ator: Ator): SavedQueryResult<SavedQuery> {
    const atual = this.#repo.visivel(id, leitorDe(ator));
    if (atual === null) return fail("not_found");
    if (!podeEditar(atual, ator)) return fail("forbidden");
    this.#repo.atualizar(id, body);
    const depois = this.#repo.porId(id);
    return depois === null ? fail("not_found") : ok(paraResposta(depois, ator));
  }

  excluir(id: string, ator: Ator): SavedQueryResult<true> {
    const atual = this.#repo.visivel(id, leitorDe(ator));
    if (atual === null) return fail("not_found");
    if (!podeEditar(atual, ator)) return fail("forbidden");
    return this.#repo.excluir(id) ? ok(true) : fail("not_found");
  }
}

function leitorDe(ator: Ator): Leitor {
  return { id: ator.id, todasAsConexoes: ator.role === "admin" };
}

function podeEditar(r: SavedQueryRow, ator: Ator): boolean {
  return ator.role === "admin" || (r.ownerId !== null && r.ownerId === ator.id);
}

function paraResposta(r: SavedQueryRow, ator: Ator): SavedQuery {
  return { ...r, canEdit: podeEditar(r, ator) };
}
