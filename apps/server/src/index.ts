import { createApp } from "./app";
import { PoolManager } from "./pg/pool";
import { openStore } from "./db/client";
import { loadConfig } from "./lib/config";

const config = loadConfig();

/**
 * `dbee --healthcheck` — usado pelo HEALTHCHECK do container.
 *
 * O binário compilado já tem `fetch` nativo, então o runtime não precisa de
 * curl nem de shell só para o healthcheck: menos ~16 MB de imagem e menos
 * superfície de ataque. Sai 0 se a API respondeu ok, 1 em qualquer outro caso.
 */
async function healthcheck(target: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${target}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

if (Bun.argv.includes("--healthcheck")) {
  process.exit((await healthcheck(config.port)) ? 0 : 1);
}

// Abre o SQLite, aplica migrations e deriva a chave de cifra (~700 ms, uma vez).
const store = openStore(config);

// Varre pools ociosos de minuto em minuto (DBee.md §6).
const pools = new PoolManager(config.caCert);
pools.start();

createApp({ store, caCert: config.caCert, pools }).listen(config.port);

// Sem isto o `docker stop` mata as conexões Postgres por reset de TCP em vez
// de fechá-las, e o servidor fica `idle` do lado do banco até o timeout dele.
for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinal, () => {
    void pools.shutdown().finally(() => {
      process.exit(0);
    });
  });
}

console.log(
  `dbee server on :${config.port} · schema v${store.schemaVersion} · dados em ${config.dataDir}`,
);
