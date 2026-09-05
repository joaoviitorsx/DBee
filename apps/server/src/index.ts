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

/**
 * Aborta se a porta já responde.
 *
 * `Bun.serve` aceita SO_REUSEPORT, então vários processos escutam a mesma porta
 * e as requisições fazem round-robin entre eles. O sintoma é o pior possível: o
 * mesmo endpoint responde 200 e 404 alternadamente conforme qual processo
 * atendeu, e testar duas vezes dá resultados diferentes (DBee.md §11.25).
 */
async function portaOcupada(porta: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${porta}/api/health`, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

if (await portaOcupada(config.port)) {
  console.error(
    `[dbee] a porta ${config.port} já está sendo servida por outro processo. ` +
      `Sob Bun os dois escutariam ao mesmo tempo e as respostas alternariam ` +
      `entre eles (ver DBee.md §11.25). Encerre o outro antes.`,
  );
  process.exit(1);
}

createApp({ store, caCert: config.caCert, pools }).listen({
  port: config.port,
  // Cinto e suspensório: mesmo com a checagem acima, uma corrida entre dois
  // boots simultâneos ainda passaria. Sem reusePort, o segundo falha alto.
  reusePort: false,
});

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
