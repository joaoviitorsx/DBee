import type { Database, Statement } from "bun:sqlite";

import type { SavedQuery } from "@dbee/shared";

import { nanoid } from "../lib/ids";

/**
 * Queries salvas (DBee.md §5). Acesso ao SQLite só por aqui — nada de SQL de
 * `saved_queries` espalhado por rota (CLAUDE.md). Lista global: a tabela não tem
 * dono, e compartilhamento entre usuários está fora de escopo.
 */
interface Row {
  id: string;
  name: string;
  sql: string;
  connectionId: string | null;
  createdAt: string;
  updatedAt: string;
}

const SELECT = `
  SELECT id, name, sql, connection_id AS connectionId, created_at AS createdAt, updated_at AS updatedAt
    FROM saved_queries
`;

export class SavedQueriesRepository {
  readonly #inserir: Statement<unknown, [string, string, string, string | null, string, string]>;
  readonly #porId: Statement<Row, [string]>;
  readonly #renomear: Statement<unknown, [string, string, string]>;

  constructor(private readonly db: Database) {
    this.#inserir = db.query(
      `INSERT INTO saved_queries (id, name, sql, connection_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.#porId = db.query(`${SELECT} WHERE id = ?`);
    this.#renomear = db.query(
      `UPDATE saved_queries SET name = ?, updated_at = ? WHERE id = ?`,
    );
  }

  criar(name: string, sql: string, connectionId: string | null): SavedQuery {
    const id = nanoid();
    const agora = new Date().toISOString();
    this.#inserir.run(id, name, sql, connectionId, agora, agora);
    return { id, name, sql, connectionId, createdAt: agora, updatedAt: agora };
  }

  /**
   * Lista, opcionalmente filtrada por texto em **nome ou SQL** (busca por
   * conteúdo). `instr(lower(...), lower(?))` casa em qualquer posição, sem
   * distinção de caixa e sem os curingas do LIKE virarem armadilha. Mais novas
   * primeiro pela data de atualização — a que você mexeu por último está no topo.
   */
  listar(q: string | null): SavedQuery[] {
    if (q === null || q.trim() === "") {
      return this.db.query<Row, []>(`${SELECT} ORDER BY updated_at DESC`).all();
    }
    const termo = q.trim();
    return this.db
      .query<Row, [string, string]>(
        `${SELECT}
          WHERE instr(lower(name), lower(?)) > 0 OR instr(lower(sql), lower(?)) > 0
          ORDER BY updated_at DESC`,
      )
      .all(termo, termo);
  }

  renomear(id: string, name: string): SavedQuery | null {
    this.#renomear.run(name, new Date().toISOString(), id);
    return this.#porId.get(id);
  }

  excluir(id: string): boolean {
    // `changes` diz se apagou algo — a rota devolve 404 quando não.
    return this.db.query("DELETE FROM saved_queries WHERE id = ?").run(id).changes > 0;
  }
}
