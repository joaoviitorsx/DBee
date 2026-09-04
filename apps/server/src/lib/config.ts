import { resolve } from "node:path";

export interface Config {
  readonly port: number;
  /** Diretório do SQLite e demais dados. `/data` no container (DBee.md §8). */
  readonly dataDir: string;
  /** Deriva a chave que cifra as senhas das conexões (DBee.md §7). */
  readonly appSecret: string;
  /** CA opcional para `ssl_mode = verify-full` (ADR 003). */
  readonly caCert: string | undefined;
}

/**
 * Sem `APP_SECRET` o app não sobe cifrando com uma chave qualquer: em
 * desenvolvimento usa um valor fixo e avisa alto; em produção é erro fatal.
 * Chave silenciosamente diferente = conexões ilegíveis depois (DBee.md §11.5).
 */
const DEV_SECRET = "dbee-dev-insecure-secret";

/** Variável de ambiente em branco é ausência, não valor. */
function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProduction = env.NODE_ENV === "production";
  // `.trim()` importa: `APP_SECRET="   "` passava e cifrava com um segredo em
  // branco.
  const secret = read(env, "APP_SECRET");

  if (secret === undefined) {
    if (isProduction) {
      throw new Error(
        "APP_SECRET não definido. Sem ele as senhas das conexões não podem ser cifradas. Ver DBee.md §7.",
      );
    }
    console.warn(
      "[dbee] APP_SECRET ausente — usando segredo de desenvolvimento. NUNCA use isso em produção.",
    );
  }

  // PORT inválido silenciosamente vira 0 (porta aleatória) ou NaN, e aí o
  // `dbee --healthcheck` bate numa porta que não existe: o container é marcado
  // unhealthy e reiniciado com o app de pé.
  const rawPort = read(env, "PORT");
  const port = rawPort === undefined ? 3001 : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT inválido: ${JSON.stringify(rawPort)}. Use um inteiro de 1 a 65535.`);
  }

  return {
    port,
    dataDir: resolve(read(env, "DBEE_DATA_DIR") ?? "./data"),
    appSecret: secret ?? DEV_SECRET,
    // String vazia aqui seria pior que ausência: `ca: ""` substitui o CA store
    // do sistema por uma lista vazia e faz TODO verify-full falhar. E o padrão
    // `${DBEE_CA_CERT:-}` do compose entrega exatamente string vazia.
    caCert: read(env, "DBEE_CA_CERT"),
  };
}
