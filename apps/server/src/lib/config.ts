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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProduction = env.NODE_ENV === "production";
  const secret = env["APP_SECRET"];

  if (secret === undefined || secret === "") {
    if (isProduction) {
      throw new Error(
        "APP_SECRET não definido. Sem ele as senhas das conexões não podem ser cifradas. Ver DBee.md §7.",
      );
    }
    console.warn(
      "[dbee] APP_SECRET ausente — usando segredo de desenvolvimento. NUNCA use isso em produção.",
    );
  }

  return {
    port: Number(env["PORT"] ?? 3001),
    dataDir: resolve(env["DBEE_DATA_DIR"] ?? "./data"),
    appSecret: secret !== undefined && secret !== "" ? secret : DEV_SECRET,
    caCert: env["DBEE_CA_CERT"],
  };
}
