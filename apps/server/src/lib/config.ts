import { resolve } from "node:path";

export interface Config {
  readonly port: number;
  /** Diretório do SQLite e demais dados. `/data` no container (DBee.md §8). */
  readonly dataDir: string;
  /** Deriva a chave que cifra as senhas das conexões (DBee.md §7). */
  readonly appSecret: string;
  /** CA opcional para `ssl_mode = verify-full` (ADR 003). */
  readonly caCert: string | undefined;
  /** Sidecar de VPN por pessoa (ADR 014). `null` = recurso desligado. */
  readonly vpn: ConfigVpn | null;
}

export interface ConfigVpn {
  /** URL do controle do sidecar, ex.: `http://dbee-vpn:7600`. */
  readonly controle: string;
  /** Host do sidecar para as portas encaminhadas (o host da URL). */
  readonly host: string;
  /** Token do controle. Nunca logado nem devolvido. */
  readonly token: string;
  /** Perfis que o admin habilitou, ex.: `["cliente-a", "cliente-b"]`. */
  readonly perfis: readonly string[];
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

/**
 * `DBEE_VPN_CONTROLE`, `DBEE_VPN_TOKEN`, `DBEE_VPN_PERFIS`. Configuração
 * parcial derruba a subida: VPN meio configurada vira "o banco sumiu" sem pista.
 */
export function lerVpn(env: NodeJS.ProcessEnv): ConfigVpn | null {
  const controle = read(env, "DBEE_VPN_CONTROLE");
  const token = read(env, "DBEE_VPN_TOKEN");
  const perfisRaw = read(env, "DBEE_VPN_PERFIS");
  if (controle === undefined && token === undefined && perfisRaw === undefined) return null;
  if (controle === undefined || token === undefined || perfisRaw === undefined) {
    throw new Error("VPN: defina DBEE_VPN_CONTROLE, DBEE_VPN_TOKEN e DBEE_VPN_PERFIS juntos. Ver ADR 014.");
  }
  if (token.length < 24) throw new Error("DBEE_VPN_TOKEN curto: use pelo menos 24 caracteres.");
  let url: URL;
  try {
    url = new URL(controle);
  } catch {
    throw new Error("DBEE_VPN_CONTROLE não é uma URL válida.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("DBEE_VPN_CONTROLE precisa ser http(s).");
  }
  const perfis = perfisRaw.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (perfis.length === 0 || perfis.some((p) => !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(p))) {
    throw new Error(`DBEE_VPN_PERFIS inválido: ${JSON.stringify(perfisRaw)}. Ex.: cliente-a,cliente-b`);
  }
  if (new Set(perfis).size !== perfis.length) throw new Error("DBEE_VPN_PERFIS repete perfil.");
  return { controle: url.origin, host: url.hostname, token, perfis };
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
    vpn: lerVpn(env),
  };
}
