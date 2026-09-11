import mysql from "mysql2/promise";

import type { ConnectionWarning, TestConnectionResult } from "@dbee/shared";

import type { ResolvedConnection } from "../db/connections.repo";
import { ehRecusa, sslMysqlPara } from "./conexao";
import { linhasDeTexto, type CampoMysql } from "./tipos";

/**
 * Testar uma conexão MySQL/MariaDB — e dizer o que ela **não** garante.
 *
 * O equivalente do Postgres abre `BEGIN READ ONLY` para exercitar desde o dia 1
 * o caminho que protege a escrita. Aqui isso não existe: medido
 * (`docs/multi-engine.md` §1), dentro de `START TRANSACTION READ ONLY` o
 * `TRUNCATE TABLE` esvazia a tabela e o `CREATE USER` cria usuário. A garantia
 * mora na **credencial** (`docs/papeis-mysql.md`).
 *
 * Isso muda o que o teste de conexão precisa fazer. Ele não tem um modo de
 * transação para exercitar; tem que olhar **os privilégios da credencial** e
 * dizer em voz alta quando o "modo leitura" da tela não corresponde a nada do
 * lado do servidor.
 */

interface ErroMysqlish {
  readonly code?: unknown;
  readonly message?: unknown;
}

function descrever(err: unknown): { code: string | null; message: string } {
  if (typeof err !== "object" || err === null) return { code: null, message: String(err) };
  const e = err as ErroMysqlish;
  return {
    code: typeof e.code === "string" ? e.code : null,
    message: typeof e.message === "string" ? e.message : "erro desconhecido",
  };
}

/**
 * Todos os privilégios da credencial, de qualquer nível.
 *
 * As quatro tabelas porque um `GRANT` pode ser global, de database, de tabela ou
 * de coluna, e basta um `INSERT` em uma coluna para a conexão não ser somente
 * leitura. Medido: as quatro respondem ao próprio usuário sem privilégio
 * especial.
 *
 * `GRANTEE` é comparado por igualdade com a forma canônica `'user'@'host'`
 * montada a partir de `CURRENT_USER()`. Nada de `LIKE '%nome%'`: o usuário
 * `ana` casaria as linhas de `mariana`, e um teste de segurança que erra para o
 * lado permissivo é pior que não existir.
 */
const PRIVILEGIOS_SQL = `
  WITH eu AS (
    SELECT CONCAT('''', SUBSTRING_INDEX(CURRENT_USER(), '@', 1),
                  '''@''', SUBSTRING_INDEX(CURRENT_USER(), '@', -1), '''') AS g
  )
  SELECT PRIVILEGE_TYPE AS p FROM information_schema.USER_PRIVILEGES,   eu WHERE GRANTEE = eu.g
  UNION SELECT PRIVILEGE_TYPE FROM information_schema.SCHEMA_PRIVILEGES, eu WHERE GRANTEE = eu.g
  UNION SELECT PRIVILEGE_TYPE FROM information_schema.TABLE_PRIVILEGES,  eu WHERE GRANTEE = eu.g
  UNION SELECT PRIVILEGE_TYPE FROM information_schema.COLUMN_PRIVILEGES, eu WHERE GRANTEE = eu.g
`;

/**
 * Privilégios que fazem a credencial poder mudar dado ou esquema.
 *
 * `TRUNCATE` não está aqui porque não é um privilégio: ele exige `DROP`,
 * medido (`ERROR 1142 ... DROP command denied`). Foi justamente o `TRUNCATE`
 * que escapou da transação somente-leitura, e é `DROP` que o barra.
 */
const ESCRITA: ReadonlySet<string> = new Set([
  "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "INDEX", "REFERENCES",
  "CREATE VIEW", "CREATE ROUTINE", "ALTER ROUTINE", "TRIGGER", "EVENT",
  "CREATE TEMPORARY TABLES", "CREATE USER", "CREATE ROLE", "DROP ROLE",
  "CREATE TABLESPACE", "RELOAD", "SHUTDOWN", "GRANT OPTION",
]);

/** Privilégios que alcançam o sistema de arquivos ou a configuração do servidor. */
const PRIVILEGIADOS: ReadonlySet<string> = new Set(["FILE", "SUPER"]);

/**
 * Os privilégios de escrita que esta credencial tem, se tiver algum.
 *
 * Exportado porque a resposta serve a duas perguntas diferentes: o teste de
 * conexão a transforma em aviso, e a execução de SQL livre a usa para decidir
 * se a concessão do usuário significa alguma coisa naquela engine.
 */
export async function privilegiosDeEscrita(conexao: mysql.Connection): Promise<string[]> {
  const [linhas, campos] = await conexao.query<mysql.RowDataPacket[]>(PRIVILEGIOS_SQL);
  const texto = linhasDeTexto(linhas as unknown as (Buffer | null)[][], campos as unknown as CampoMysql[]);
  const tem = new Set(
    texto.map((l) => l["p"]).filter((p): p is string => p !== null && p !== undefined),
  );
  return [...tem].filter((p) => ESCRITA.has(p)).sort();
}

async function detectarPrivilegio(conexao: mysql.Connection): Promise<ConnectionWarning[]> {
  try {
    const [linhas, campos] = await conexao.query<mysql.RowDataPacket[]>(PRIVILEGIOS_SQL);
    const texto = linhasDeTexto(linhas as unknown as (Buffer | null)[][], campos as unknown as CampoMysql[]);
    const tem = new Set(
      texto.map((l) => l["p"]).filter((p): p is string => p !== null && p !== undefined),
    );

    const avisos: ConnectionWarning[] = [];

    const escrita = [...tem].filter((p) => ESCRITA.has(p)).sort();
    if (escrita.length > 0) {
      avisos.push({
        code: "credential_can_write",
        message:
          "Esta credencial pode escrever no banco (" +
          escrita.join(", ") +
          "). No MySQL e no MariaDB não existe transação somente-leitura que " +
          "resista — medido: dentro de START TRANSACTION READ ONLY o TRUNCATE " +
          "esvazia a tabela e o CREATE USER cria usuário. A garantia é a " +
          "credencial, então o modo leitura do DBee aqui é uma convenção da " +
          "tela, e não uma barreira do servidor. Para leitura de verdade, " +
          "conecte com um usuário que tenha apenas GRANT SELECT (ver " +
          "docs/papeis-mysql.md).",
      });
    }

    const privilegiados = [...tem].filter((p) => PRIVILEGIADOS.has(p)).sort();
    if (privilegiados.length > 0) {
      avisos.push({
        code: "privileged_role",
        message:
          "Esta credencial tem " +
          privilegiados.join(" e ") +
          ". Com FILE ela lê e escreve arquivos no host do banco " +
          "(SELECT … INTO OUTFILE, LOAD_FILE); com SUPER ela altera a " +
          "configuração do servidor. Nenhum modo do DBee contém isso.",
      });
    }

    return avisos;
  } catch {
    // Defensiva: um servidor que não exponha essas tabelas não deve fazer o
    // teste de conexão falhar por causa da checagem.
    return [];
  }
}

export async function testConnectionMysql(
  connection: ResolvedConnection,
  caCert: string | undefined,
): Promise<TestConnectionResult> {
  const inicio = performance.now();
  const decorrido = (): number => Math.round(performance.now() - inicio);

  const ssl = sslMysqlPara(connection.sslMode, caCert, connection.host);
  if (ehRecusa(ssl)) {
    // Recusa de configuração, não do servidor: nem chega a discar.
    return { ok: false, code: "ssl_mode_unsupported", message: ssl.motivo, durationMs: decorrido() };
  }

  let conexao: mysql.Connection | undefined;
  try {
    conexao = await mysql.createConnection({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: connection.password,
      ...(ssl.ssl === false ? {} : { ssl: ssl.ssl }),
      connectTimeout: 10_000,
      // O mesmo contrato do resto do driver: linha em array, célula em bytes.
      rowsAsArray: true,
      typeCast: (campo) => campo.buffer(),
    });

    const [versao, campos] = await conexao.query<mysql.RowDataPacket[]>("SELECT VERSION() AS v");
    const v =
      linhasDeTexto(versao as unknown as (Buffer | null)[][], campos as unknown as CampoMysql[])[0]?.["v"] ??
      "desconhecida";
    const warnings = await detectarPrivilegio(conexao);

    return { ok: true, serverVersion: v, durationMs: decorrido(), warnings };
  } catch (err: unknown) {
    // O erro do servidor vai inteiro para a UI. Nunca incluir a senha.
    return { ok: false, ...descrever(err), durationMs: decorrido() };
  } finally {
    if (conexao !== undefined) await conexao.end().catch(() => undefined);
  }
}
