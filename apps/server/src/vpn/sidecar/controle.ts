/**
 * Controlador do sidecar de VPN (ADR 014). Roda DENTRO do container
 * `deploy/vpn`, não no DBee: é aqui que existem `openvpn`, `socat`, `ip` e
 * `NET_ADMIN`. O DBee só fala com este processo por HTTP numa rede interna
 * exclusiva, com token.
 *
 * Um túnel por (usuário, perfil):
 *   - openvpn com `--route-noexec`: as rotas empurradas (inclusive o full
 *     tunnel) NÃO são aplicadas, então um túnel não rouba o tráfego do outro;
 *   - tabela de roteamento própria: `ip rule from <ip-do-tun> table N` +
 *     `default dev tunN` nela;
 *   - um socat por destino com `bind=<ip-do-tun>`: o tráfego da pessoa sai
 *     pelo túnel dela, com o IP dela na VPN.
 *
 * Credencial: chega no corpo do POST, vai para o openvpn pela gerência (socket
 * unix) e não é escrita em lugar nenhum. O .ovpn vai para tmpfs com 0600 e é
 * apagado quando o túnel cai.
 */
import { timingSafeEqual } from "node:crypto";
import { chmod, mkdir, rm, stat, writeFile } from "node:fs/promises";

import { GerenciaOpenvpn, type EstadoDoTunel } from "../gerencia";
import { validarOvpn } from "../ovpn.puro";
import { idDoTunelValido, destinoValido, portaLocal, MAX_TUNEIS, MAX_DESTINOS } from "./regras.puro";

const TOKEN = process.env["CONTROL_TOKEN"] ?? "";
const PORTA = Number(process.env["CONTROL_PORT"] ?? "7600");
const DIR = process.env["RUN_DIR"] ?? "/run/dbee-vpn";
const PRAZO_SOCKET_MS = 5_000;

/**
 * IP do sidecar na rede `dbee-vpn` (interface padrão do container). Controle e
 * encaminhamentos escutam SÓ nele — nunca nos `tunN`, senão um host do lado
 * remoto de uma VPN alcançaria o banco de outro cliente pela porta de outro
 * túnel (ponte entre VPNs). O iptables de `bloquearEntradaPelosTuneis` é a
 * segunda barreira.
 */
async function ipDaRedeInterna(): Promise<string> {
  const p = Bun.spawn(["ip", "-4", "-o", "addr", "show", "dev", process.env["IFACE"] ?? "eth0"], { stdout: "pipe" });
  const saida = await new Response(p.stdout).text();
  const ip = /inet (\d+\.\d+\.\d+\.\d+)\//.exec(saida)?.[1];
  if (ip === undefined) {
    console.error("[dbee-vpn] sem IPv4 na interface da rede interna");
    process.exit(1);
  }
  return ip;
}

/** Nada entra pelos túneis além de resposta a conexão que nós abrimos. */
async function bloquearEntradaPelosTuneis(): Promise<void> {
  const regras = [
    ["iptables", "-A", "INPUT", "-i", "tun+", "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"],
    ["iptables", "-A", "INPUT", "-i", "tun+", "-j", "DROP"],
    ["iptables", "-A", "FORWARD", "-j", "DROP"],
  ];
  for (const r of regras) {
    if (!(await sh(r))) {
      console.error("[dbee-vpn] falha ao aplicar iptables — recusando subir sem a barreira");
      process.exit(1);
    }
  }
}

if (TOKEN.length < 24) {
  console.error("[dbee-vpn] CONTROL_TOKEN ausente ou curto (mínimo 24 caracteres)");
  process.exit(1);
}

interface Encaminhamento {
  readonly host: string;
  readonly porta: number;
  readonly local: number;
  readonly proc: ReturnType<typeof Bun.spawn>;
}

interface Tunel {
  readonly id: string;
  readonly indice: number;
  readonly proc: ReturnType<typeof Bun.spawn>;
  readonly gerencia: GerenciaOpenvpn;
  ip: string | null;
  readonly encaminhamentos: Map<string, Encaminhamento>;
}

const tuneis = new Map<string, Tunel>();
/**
 * Índices reservados SÍNCRONAMENTE na escolha. Sem isto, dois `conectar`
 * simultâneos (ids diferentes, filas diferentes) escolhiam o mesmo índice
 * entre um `await` e outro — mesmo `tunN`, mesma tabela, mesmas portas.
 * Pego pelo teste de integração com dois túneis reais.
 */
const reservados = new Set<number>();
/** Fila por id: conectar/desconectar/destinos do mesmo túnel nunca se cruzam. */
const filas = new Map<string, Promise<unknown>>();

function emFila<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const anterior = filas.get(id) ?? Promise.resolve();
  const proxima = anterior.then(fn, fn);
  filas.set(id, proxima.catch(() => undefined));
  return proxima;
}

async function sh(args: readonly string[]): Promise<boolean> {
  const p = Bun.spawn([...args], { stdout: "ignore", stderr: "ignore" });
  return (await p.exited) === 0;
}

/**
 * Próximo índice a tentar. Avança sempre (módulo MAX_TUNEIS) em vez de pegar o
 * menor livre: um índice recém-liberado não volta logo, então uma porta que o
 * DBee ainda tenha no espelho (até a próxima sincronia) não aponta para o
 * túnel de OUTRA pessoa. Achado da revisão adversarial.
 */
let cursorIndice = 0;

function reservarIndice(): number | null {
  for (let k = 1; k <= MAX_TUNEIS; k++) {
    const i = ((cursorIndice + k - 1) % MAX_TUNEIS) + 1;
    if (!reservados.has(i)) {
      reservados.add(i);
      cursorIndice = i;
      return i;
    }
  }
  return null;
}

async function derrubar(id: string): Promise<void> {
  const t = tuneis.get(id);
  if (t === undefined) return;
  tuneis.delete(id);
  for (const e of t.encaminhamentos.values()) e.proc.kill();
  t.proc.kill();
  await t.proc.exited;
  if (t.ip !== null) await sh(["ip", "rule", "del", "from", t.ip, "table", String(100 + t.indice)]);
  await sh(["ip", "route", "flush", "table", String(100 + t.indice)]);
  await rm(`${DIR}/${String(t.indice)}`, { recursive: true, force: true });
  reservados.delete(t.indice);
}

function abrirEncaminhamento(t: Tunel, host: string, porta: number): Encaminhamento | null {
  const chave = `${host}:${String(porta)}`;
  const existente = t.encaminhamentos.get(chave);
  if (existente !== undefined) return existente;
  if (t.ip === null || t.encaminhamentos.size >= MAX_DESTINOS) return null;
  const local = portaLocal(t.indice, t.encaminhamentos.size);
  // argv sem shell; host e porta já validados por `destinoValido` (sem `,` nem
  // `:` no host, que seriam opção do socat).
  const proc = Bun.spawn(
    ["socat", `TCP-LISTEN:${String(local)},fork,reuseaddr,bind=${IP_INTERNO}`, `TCP:${host}:${String(porta)},bind=${t.ip}`],
    { stdout: "ignore", stderr: "ignore" },
  );
  const e = { host, porta, local, proc };
  t.encaminhamentos.set(chave, e);
  return e;
}

async function esperarSocket(caminho: string): Promise<boolean> {
  const limite = Date.now() + PRAZO_SOCKET_MS;
  while (Date.now() < limite) {
    // `Bun.file().exists()` não reconhece socket unix; `stat` sim.
    const e = await stat(caminho).catch(() => null);
    if (e?.isSocket() === true) return true;
    await Bun.sleep(100);
  }
  return false;
}

interface Destino { host: string; porta: number }

async function conectar(
  id: string,
  ovpn: string,
  usuario: string,
  senha: string,
  destinos: readonly Destino[],
): Promise<Response> {
  if (validarOvpn(ovpn) !== null) return Response.json({ code: "ovpn_invalido" }, { status: 422 });
  await derrubar(id);
  const indice = reservarIndice();
  if (indice === null) return Response.json({ code: "limite" }, { status: 503 });

  const dir = `${DIR}/${String(indice)}`;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const cfg = `${dir}/cliente.ovpn`;
  const pw = `${dir}/gerencia.pw`;
  const sock = `${dir}/gerencia.sock`;
  const senhaGerencia = crypto.randomUUID();
  await writeFile(cfg, ovpn, { mode: 0o600 });
  await writeFile(pw, `${senhaGerencia}\n`, { mode: 0o600 });
  await chmod(dir, 0o700);

  // `--config` primeiro: opção da linha de comando depois dele prevalece sobre
  // o arquivo. `--script-security 1` impede qualquer script externo mesmo que
  // a validação tivesse deixado passar algo.
  const proc = Bun.spawn(
    [
      "openvpn", "--config", cfg,
      "--dev", `tun${String(indice)}`, "--dev-type", "tun",
      "--route-noexec", "--script-security", "1",
      "--management", sock, "unix", pw,
      "--management-hold", "--management-query-passwords",
      "--auth-retry", "interact", "--auth-nocache",
      "--persist-tun", "--persist-key",
      "--user", "nobody", "--group", "nobody",
      "--verb", "3",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const gerencia = new GerenciaOpenvpn({ nome: id, unix: sock, senha: senhaGerencia });
  const t: Tunel = { id, indice, proc, gerencia, ip: null, encaminhamentos: new Map() };
  tuneis.set(id, t);

  if (!(await esperarSocket(sock))) {
    await derrubar(id);
    return Response.json({ code: "inacessivel" }, { status: 502 });
  }
  const r = await gerencia.conectar(usuario, senha);
  if (!r.ok) {
    await derrubar(id);
    const status = r.motivo === "credencial_recusada" ? 401 : r.motivo === "tempo_esgotado" ? 504 : 502;
    return Response.json({ code: r.motivo }, { status });
  }
  const estado = await gerencia.status();
  if (estado.ipLocal === null) {
    await derrubar(id);
    return Response.json({ code: "inacessivel" }, { status: 502 });
  }
  t.ip = estado.ipLocal;
  const tabela = String(100 + indice);
  await sh(["ip", "route", "replace", "default", "dev", `tun${String(indice)}`, "table", tabela]);
  await sh(["ip", "rule", "add", "from", t.ip, "table", tabela]);
  for (const d of destinos) abrirEncaminhamento(t, d.host, d.porta);
  return Response.json(await descrever(t));
}

async function descrever(t: Tunel): Promise<{ id: string } & EstadoDoTunel & { encaminhamentos: { host: string; porta: number; local: number }[] }> {
  const estado: EstadoDoTunel = t.proc.exitCode !== null ? { estado: "desconectada", ipLocal: null } : await t.gerencia.status();
  return {
    id: t.id,
    ...estado,
    encaminhamentos: [...t.encaminhamentos.values()].map(({ host, porta, local }) => ({ host, porta, local })),
  };
}

function autorizado(req: Request): boolean {
  const h = req.headers.get("authorization") ?? "";
  const esperado = Buffer.from(`Bearer ${TOKEN}`);
  const recebido = Buffer.from(h);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

function lerDestinos(v: unknown): Destino[] | null {
  if (!Array.isArray(v)) return null;
  const out: Destino[] = [];
  for (const d of v) {
    if (typeof d !== "object" || d === null) return null;
    const { host, porta } = d as { host?: unknown; porta?: unknown };
    if (typeof host !== "string" || typeof porta !== "number" || !destinoValido(host, porta)) return null;
    out.push({ host, porta });
  }
  return out;
}

await bloquearEntradaPelosTuneis();
const IP_INTERNO = await ipDaRedeInterna();

Bun.serve({
  hostname: IP_INTERNO,
  port: PORTA,
  async fetch(req) {
    if (!autorizado(req)) return Response.json({ code: "nao_autorizado" }, { status: 401 });
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/tuneis") {
      return Response.json(await Promise.all([...tuneis.values()].map(descrever)));
    }
    const m = /^\/tuneis\/([^/]+)(\/destinos)?$/.exec(url.pathname);
    const id = m?.[1] ?? "";
    if (m === null || !idDoTunelValido(id)) return Response.json({ code: "nao_encontrado" }, { status: 404 });

    if (req.method === "DELETE" && m[2] === undefined) {
      await emFila(id, () => derrubar(id));
      return new Response(null, { status: 204 });
    }
    if (req.method === "GET" && m[2] === undefined) {
      const t = tuneis.get(id);
      return t === undefined
        ? Response.json({ id, estado: "desconectada", ipLocal: null, encaminhamentos: [] })
        : Response.json(await descrever(t));
    }
    let corpo: Record<string, unknown>;
    try {
      corpo = (await req.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ code: "corpo_invalido" }, { status: 400 });
    }
    const destinos = lerDestinos(corpo["destinos"] ?? []);
    if (destinos === null) return Response.json({ code: "destino_invalido" }, { status: 422 });

    if (req.method === "POST" && m[2] === "/destinos") {
      return emFila(id, async () => {
        const t = tuneis.get(id);
        if (t === undefined) return Response.json({ code: "desconectada" }, { status: 409 });
        for (const d of destinos) abrirEncaminhamento(t, d.host, d.porta);
        return Response.json(await descrever(t));
      });
    }
    if (req.method === "POST" && m[2] === undefined) {
      const { ovpn, usuario, senha } = corpo;
      if (typeof ovpn !== "string" || typeof usuario !== "string" || typeof senha !== "string") {
        return Response.json({ code: "corpo_invalido" }, { status: 400 });
      }
      return emFila(id, () => conectar(id, ovpn, usuario, senha, destinos));
    }
    return Response.json({ code: "nao_encontrado" }, { status: 404 });
  },
});

// Sem log de corpo, credencial ou destino: só que subiu.
console.log(`[dbee-vpn] controle em :${String(PORTA)}`);

for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinal, () => {
    void Promise.all([...tuneis.keys()].map(derrubar)).finally(() => process.exit(0));
  });
}
