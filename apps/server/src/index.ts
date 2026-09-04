import { app } from "./app";

const port = Number(process.env["PORT"] ?? 3001);

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
  process.exit((await healthcheck(port)) ? 0 : 1);
}

app.listen(port);

console.log(`dbee server on :${port}`);
