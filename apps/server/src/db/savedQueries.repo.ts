import type { Database, Statement } from "bun:sqlite";

import type { SavedQueryVisibility } from "@dbee/shared";

import { nanoid } from "../lib/ids";

/**
 * Queries salvas (DBee.md §5, ADR 016). Acesso ao SQLite só por aqui — nada de
 * SQL de `saved_queries` espalhado por rota (CLAUDE.md).
 *
 * O repositório aplica o **recorte de visibilidade** no `WHERE` (quem vê o
 * quê), porque filtrar depois de ler entregaria a página errada e leria SQL
 * alheio à toa. Quem pode **editar** é regra do serviço.
 */
export interface SavedQueryRow {
  readonly id: string;
  readonly name: string;
  readonly sql: string;
  readonly connectionId: string | null;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly visibility: SavedQueryVisibility;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Quem está olhando: o id, e se vê toda conexão (admin). */
export interface Leitor {
  readonly id: string;
  readonly todasAsConexoes: boolean;
}

const SELECT = `
  SELECT s.id, s.name, s.sql, s.connection_id AS connectionId, s.owner_id AS ownerId,
         u.username AS ownerName, s.visibility,
         s.created_at AS createdAt, s.updated_at AS updatedAt
    FROM saved_queries s
    LEFT JOIN users u ON u.id = s.owner_id
`;

/**
 * Visível = (do time OU minha) E (sem conexão OU conexão que enxergo).
 * Os dois `?` são o id do leitor; o segundo some para admin.
 */
function recorte(leitor: Leitor): { sql: string; params: string[] } {
  const dono = "(s.visibility = 'team' OR s.owner_id = ?)";
  if (leitor.todasAsConexoes) return { sql: dono, params: [leitor.id] };
  return {
    sql: `${dono} AND (s.connection_id IS NULL OR s.connection_id IN
           (SELECT connection_id FROM connection_access WHERE user_id = ?))`,
    params: [leitor.id, leitor.id],
  };
}

export class SavedQueriesRepository {
  readonly #inserir: Statement<
    unknown,
    [string, string, string, string | null, string | null, string, string, string]
  >;

  constructor(private readonly db: Database) {
    this.#inserir = db.query(
      `INSERT INTO saved_queries (id, name, sql, connection_id, owner_id, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  criar(
    name: string,
    sql: string,
    connectionId: string | null,
    ownerId: string,
    visibility: SavedQueryVisibility,
  ): string {
    const id = nanoid();
    const agora = new Date().toISOString();
    this.#inserir.run(id, name, sql, connectionId, ownerId, visibility, agora, agora);
    return id;
  }

  /**
   * As queries que `leitor` enxerga, opcionalmente filtradas por texto em
   * **nome ou SQL**. `instr(lower(...), lower(?))` casa em qualquer posição,
   * sem os curingas do LIKE. Mais novas primeiro.
   */
  listar(leitor: Leitor, q: string | null, limite = 500): SavedQueryRow[] {
    const r = recorte(leitor);
    const termo = q?.trim() ?? "";
    const texto = termo === "" ? "" : " AND (instr(lower(s.name), lower(?)) > 0 OR instr(lower(s.sql), lower(?)) > 0)";
    const params = termo === "" ? r.params : [...r.params, termo, termo];
    return this.db
      .query<SavedQueryRow, (string | number)[]>(
        `${SELECT} WHERE ${r.sql}${texto} ORDER BY s.updated_at DESC LIMIT ?`,
      )
      .all(...params, limite);
  }

  /** Uma query, **se** `leitor` a enxerga; senão `null` (não existe ≡ não é sua). */
  visivel(id: string, leitor: Leitor): SavedQueryRow | null {
    const r = recorte(leitor);
    return this.db
      .query<SavedQueryRow, string[]>(`${SELECT} WHERE s.id = ? AND ${r.sql}`)
      .get(id, ...r.params);
  }

  /**
   * Sem recorte. Só para reler **depois** que o serviço autorizou — admin que
   * torna privada a query de outro deixa de vê-la, e a resposta do PATCH ainda
   * precisa sair.
   */
  porId(id: string): SavedQueryRow | null {
    return this.db.query<SavedQueryRow, [string]>(`${SELECT} WHERE s.id = ?`).get(id);
  }

  atualizar(
    id: string,
    campos: { readonly name?: string; readonly sql?: string; readonly visibility?: SavedQueryVisibility },
  ): void {
    // COALESCE: campo ausente mantém o valor. Todo valor por parâmetro.
    this.db
      .query<unknown, (string | null)[]>(
        `UPDATE saved_queries
            SET name = COALESCE(?, name), sql = COALESCE(?, sql),
                visibility = COALESCE(?, visibility), updated_at = ?
          WHERE id = ?`,
      )
      .run(campos.name ?? null, campos.sql ?? null, campos.visibility ?? null, new Date().toISOString(), id);
  }

  excluir(id: string): boolean {
    return this.db.query("DELETE FROM saved_queries WHERE id = ?").run(id).changes > 0;
  }
}
