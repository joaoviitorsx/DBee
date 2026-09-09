import type { Database, Statement } from "bun:sqlite";

import type { Connection, CreateConnection, Engine, SslMode, UpdateConnection } from "@dbee/shared";

import type { Ator } from "../lib/ator";
import { decrypt, encrypt, type EncryptionKey } from "../lib/crypto";
import { nanoid } from "../lib/ids";

/**
 * Colunas devolvidas pela API. `password_enc` está fora da lista de propósito:
 * a segunda barreira, depois do tipo `Connection`, é o SELECT não pedir a
 * coluna (DBee.md §5, §7 — nunca retornar credencial).
 */
const PUBLIC_COLUMNS = `
  id, name, color, engine, host, port, database, username,
  ssl_mode AS sslMode, write_enabled AS writeEnabled,
  statement_timeout_ms AS statementTimeoutMs, timezone,
  created_at AS createdAt, updated_at AS updatedAt
`;

/**
 * As mesmas colunas qualificadas por `c`, para o `JOIN` com `connection_access`.
 *
 * Lista separada em vez de prefixo genérico: `created_at` e `updated_at`
 * existem nas duas tabelas em espírito, e sem prefixo o SQLite resolveria a
 * ambiguidade pela ordem do `FROM`, não pela intenção de quem escreveu.
 */
const PUBLIC_COLUMNS_C = `
  c.id, c.name, c.color, c.engine, c.host, c.port, c.database, c.username,
  c.ssl_mode AS sslMode, c.write_enabled AS writeEnabled,
  c.statement_timeout_ms AS statementTimeoutMs, c.timezone,
  c.created_at AS createdAt, c.updated_at AS updatedAt
`;

/** Linha crua: SQLite não tem boolean, `write_enabled` volta 0 ou 1. */
interface ConnectionRow {
  id: string;
  name: string;
  color: string | null;
  engine: Engine;
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode: SslMode;
  writeEnabled: number;
  statementTimeoutMs: number;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

function toConnection(row: ConnectionRow): Connection {
  return { ...row, writeEnabled: row.writeEnabled === 1 };
}

/** Conexão com a senha já decifrada — só circula dentro do servidor. */
export interface ResolvedConnection extends Connection {
  readonly password: string;
}

export class ConnectionsRepository {
  readonly #db: Database;
  readonly #key: EncryptionKey;

  // Statements preparados uma vez (CLAUDE.md, "Ao escrever código").
  readonly #list: Statement<ConnectionRow, []>;
  readonly #listParaUsuario: Statement<ConnectionRow & { canWrite: number }, [string]>;
  readonly #byId: Statement<ConnectionRow, [string]>;
  readonly #byIdParaUsuario: Statement<ConnectionRow & { canWrite: number }, [string, string]>;
  readonly #secretById: Statement<{ password_enc: string }, [string]>;
  readonly #delete: Statement<unknown, [string]>;

  constructor(db: Database, key: EncryptionKey) {
    this.#db = db;
    this.#key = key;
    this.#list = db.query<ConnectionRow, []>(
      `SELECT ${PUBLIC_COLUMNS} FROM connections ORDER BY name`,
    );
    this.#listParaUsuario = db.query<ConnectionRow & { canWrite: number }, [string]>(
      `SELECT ${PUBLIC_COLUMNS_C}, a.can_write AS canWrite
         FROM connections c
         JOIN connection_access a ON a.connection_id = c.id AND a.user_id = ?
        ORDER BY c.name`,
    );
    this.#byId = db.query<ConnectionRow, [string]>(
      `SELECT ${PUBLIC_COLUMNS} FROM connections WHERE id = ?`,
    );
    this.#byIdParaUsuario = db.query<ConnectionRow & { canWrite: number }, [string, string]>(
      `SELECT ${PUBLIC_COLUMNS_C}, a.can_write AS canWrite
         FROM connections c
         JOIN connection_access a ON a.connection_id = c.id AND a.user_id = ?
        WHERE c.id = ?`,
    );
    this.#secretById = db.query<{ password_enc: string }, [string]>(
      "SELECT password_enc FROM connections WHERE id = ?",
    );
    this.#delete = db.query<unknown, [string]>("DELETE FROM connections WHERE id = ?");
  }

  /**
   * As conexões que **este** ator enxerga (migração 005).
   *
   * `admin` vê tudo, porque é quem administra as conexões. `member` vê só o que
   * tem concessão. Filtrar aqui é metade do controle — a outra metade, e a que
   * de fato importa, é o `resolve` abaixo: filtrar a listagem sem provar acesso
   * por id deixaria qualquer um usar um id que conhecesse.
   */
  list(ator: Ator): Connection[] {
    if (ator.role === "admin") return this.#list.all().map(toConnection);
    // O `writeEnabled` da lista é o **efetivo**, igual ao do `find`. Devolver o
    // da conexão faria a UI desenhar a tarja de escrita para quem o servidor
    // recusaria — a tela afirmando o contrário do que o sistema faz.
    return this.#listParaUsuario.all(ator.id).map((row) => {
      const conexao = toConnection(row);
      return { ...conexao, writeEnabled: conexao.writeEnabled && row.canWrite === 1 };
    });
  }

  /**
   * A conexão como **este** ator a enxerga, ou `null`.
   *
   * `null` cobre os dois casos de propósito: não existe, e existe mas não é
   * dele. Todo chamador já tratava `null` como 404, e não distinguir os dois
   * evita responder "esta conexão existe, mas não é sua" — que confirmaria a
   * existência de um id a quem não deveria saber.
   *
   * O `writeEnabled` devolvido é o **efetivo**: `write_enabled` da conexão E
   * `can_write` da concessão. Quem consome não precisa saber que a regra mudou
   * — `connection.writeEnabled` continua significando exatamente "esta
   * requisição pode gravar?", e as três portas de escrita seguem lendo esse
   * mesmo campo.
   */
  /**
   * A linha sem filtro de acesso. **Privada de propósito.**
   *
   * Serve a `create` e `update`, que são operações administrativas: a rota já
   * exigiu admin antes de chegar aqui, e devolver "não encontrada" para o
   * próprio admin que acabou de criar a conexão seria absurdo. Toda leitura que
   * atende usuário passa pelo `find` público, que exige ator.
   */
  #linhaCrua(id: string): Connection | null {
    const row = this.#byId.get(id);
    return row === null ? null : toConnection(row);
  }

  find(id: string, ator: Ator): Connection | null {
    if (ator.role === "admin") {
      const row = this.#byId.get(id);
      return row === null ? null : toConnection(row);
    }
    const row = this.#byIdParaUsuario.get(ator.id, id);
    if (row === null) return null;
    const conexao = toConnection(row);
    return { ...conexao, writeEnabled: conexao.writeEnabled && row.canWrite === 1 };
  }

  /**
   * Conexão com a senha decifrada. Só para abrir conexão no Postgres — nunca
   * serializar o retorno disto numa resposta HTTP.
   *
   * O `ator` é **obrigatório**, e é o que garante que nenhum caminho escape:
   * são doze chamadores espalhados por sete serviços, e o `typecheck` aponta
   * todos. Um parâmetro opcional deixaria um deles para trás em silêncio, que
   * é exatamente a falha que esta migração existe para impedir.
   */
  resolve(id: string, ator: Ator): ResolvedConnection | null {
    const connection = this.find(id, ator);
    if (connection === null) return null;

    const row = this.#secretById.get(id);
    if (row === null) return null;

    // O id entra como AAD: um password_enc movido para outra conexão não
    // decifra (ADR 005).
    return { ...connection, password: decrypt(this.#key, id, row.password_enc) };
  }

  // --- concessões -----------------------------------------------------------

  /** Quem tem acesso a esta conexão. Só a tela de administração consome. */
  acessos(connectionId: string): { userId: string; canWrite: boolean }[] {
    return this.#db
      .query<{ userId: string; canWrite: number }, [string]>(
        `SELECT user_id AS userId, can_write AS canWrite
           FROM connection_access WHERE connection_id = ? ORDER BY user_id`,
      )
      .all(connectionId)
      .map((r) => ({ userId: r.userId, canWrite: r.canWrite === 1 }));
  }

  /** Concede ou atualiza. `INSERT … ON CONFLICT` porque a PK é o par. */
  conceder(connectionId: string, userId: string, canWrite: boolean, por: string): void {
    this.#db
      .query<unknown, [string, string, number, string, string, number]>(
        `INSERT INTO connection_access (connection_id, user_id, can_write, granted_at, granted_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (connection_id, user_id) DO UPDATE SET can_write = ?`,
      )
      .run(connectionId, userId, canWrite ? 1 : 0, new Date().toISOString(), por, canWrite ? 1 : 0);
  }

  /** Revoga. Ausência de linha É a negação — não existe `granted = 0`. */
  revogar(connectionId: string, userId: string): void {
    this.#db
      .query<unknown, [string, string]>(
        "DELETE FROM connection_access WHERE connection_id = ? AND user_id = ?",
      )
      .run(connectionId, userId);
  }

  create(input: CreateConnection): Connection {
    const now = new Date().toISOString();
    const id = nanoid();

    this.#db
      .query<unknown, (string | number | null)[]>(
        `INSERT INTO connections (
           id, name, color, engine, host, port, database, username, password_enc,
           ssl_mode, write_enabled, statement_timeout_ms, timezone,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.color ?? null,
        // Ausente significa Postgres: é o que um cliente que não conhece o
        // campo quis dizer, e é a única engine que o DBee fala. O resolvido
        // fica aqui e não como `default` no schema — ADR 004.
        input.engine ?? "postgres",
        input.host,
        input.port ?? 5432,
        input.database,
        input.username,
        encrypt(this.#key, id, input.password),
        input.sslMode ?? "disable",
        input.writeEnabled === true ? 1 : 0,
        input.statementTimeoutMs ?? 30000,
        input.timezone ?? "UTC",
        now,
        now,
      );

    const created = this.#linhaCrua(id);
    if (created === null) throw new Error("conexão sumiu logo após ser criada");
    return created;
  }

  /** `password` ausente no patch significa "não mexe na senha". */
  update(id: string, patch: UpdateConnection): Connection | null {
    if (this.#linhaCrua(id) === null) return null;

    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    const put = (column: string, value: string | number | null): void => {
      sets.push(`${column} = ?`);
      values.push(value);
    };

    if (patch.name !== undefined) put("name", patch.name);
    if (patch.color !== undefined) put("color", patch.color);
    if (patch.host !== undefined) put("host", patch.host);
    if (patch.port !== undefined) put("port", patch.port);
    if (patch.database !== undefined) put("database", patch.database);
    if (patch.username !== undefined) put("username", patch.username);
    if (patch.password !== undefined) put("password_enc", encrypt(this.#key, id, patch.password));
    if (patch.sslMode !== undefined) put("ssl_mode", patch.sslMode);
    if (patch.writeEnabled !== undefined) put("write_enabled", patch.writeEnabled ? 1 : 0);
    if (patch.statementTimeoutMs !== undefined) {
      put("statement_timeout_ms", patch.statementTimeoutMs);
    }
    if (patch.timezone !== undefined) put("timezone", patch.timezone);

    if (sets.length > 0) {
      put("updated_at", new Date().toISOString());
      this.#db
        .query<unknown, (string | number | null)[]>(
          `UPDATE connections SET ${sets.join(", ")} WHERE id = ?`,
        )
        .run(...values, id);
    }

    return this.#linhaCrua(id);
  }

  delete(id: string): boolean {
    return this.#delete.run(id).changes > 0;
  }
}
