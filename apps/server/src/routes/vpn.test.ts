import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { SESSION_COOKIE, type Connection, type VpnList } from "@dbee/shared";

import { createApp } from "../app";
import { openTestStore, type Store } from "../db/client";
import { UsersRepository } from "../db/users.repo";
import { lerVpn, type ConfigVpn } from "../lib/config";
import { autenticar } from "../test/sessao";

/**
 * VPN por pessoa (ADR 014), do lado do DBee, contra um sidecar FALSO que fala
 * a mesma API HTTP do controle. O sidecar real (openvpn) é provado em
 * `vpn/sidecar/sidecar.integration.test.ts`.
 */
const TOKEN = "t".repeat(32);
const PIN = "PIN999";
const CODIGO = "111222";
/** O que o concentrador recebe: parte fixa + código do autenticador. */
const SEGREDO = `${PIN}${CODIGO}`;
const OVPN = "client\ndev tun\nremote 192.0.2.1 1194 udp\nauth-user-pass\n<key>\nCHAVE-PRIVADA-SECRETA\n</key>\n";

interface Recebido {
  readonly metodo: string;
  readonly caminho: string;
  readonly corpo: Record<string, unknown> | null;
}

let store: Store;
let app: ReturnType<typeof createApp>;
let admin = "";
let adminId = "";
let sidecar: ReturnType<typeof Bun.serve>;
let recebidos: Recebido[] = [];
let respostaConectar: { status: number; corpo: unknown } = { status: 200, corpo: null };
const tuneis = new Map<string, { id: string; estado: string; ipLocal: string; encaminhamentos: unknown[] }>();

const chamar = (metodo: string, caminho: string, cookie: string, corpo?: unknown) =>
  app.handle(
    new Request(`http://localhost/api${caminho}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    }),
  );

beforeEach(async () => {
  recebidos = [];
  tuneis.clear();
  respostaConectar = { status: 200, corpo: null };
  sidecar = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return new Response(null, { status: 401 });
      const url = new URL(req.url);
      const corpo = req.method === "GET" || req.method === "DELETE" ? null : ((await req.json()) as Record<string, unknown>);
      recebidos.push({ metodo: req.method, caminho: url.pathname, corpo });
      if (req.method === "GET" && url.pathname === "/tuneis") return Response.json([...tuneis.values()]);
      const id = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      if (req.method === "DELETE") {
        tuneis.delete(id);
        return new Response(null, { status: 204 });
      }
      if (req.method === "POST" && url.pathname.endsWith("/destinos")) {
        const t = tuneis.get(id);
        if (t === undefined) return Response.json({}, { status: 409 });
        const destinos = (corpo?.["destinos"] ?? []) as { host: string; porta: number }[];
        t.encaminhamentos = destinos.map((d, i) => ({ ...d, local: 20_050 + i }));
        return Response.json(t);
      }
      if (respostaConectar.status !== 200) {
        return Response.json(respostaConectar.corpo, { status: respostaConectar.status });
      }
      const destinos = (corpo?.["destinos"] ?? []) as { host: string; porta: number }[];
      const t = { id, estado: "conectada", ipLocal: "10.8.0.6", encaminhamentos: destinos.map((d, i) => ({ ...d, local: 20_050 + i })) };
      tuneis.set(id, t);
      return Response.json(t);
    },
  });
  const config: ConfigVpn = {
    controle: `http://127.0.0.1:${String(sidecar.port)}`,
    host: "127.0.0.1",
    token: TOKEN,
    perfis: ["cliente-a"],
  };
  store = openTestStore();
  app = createApp({ store, caCert: undefined, vpn: config });
  ({ cookie: admin, userId: adminId } = await autenticar(store));
});

afterEach(() => {
  void sidecar.stop(true);
});

async function membro(nome = "membro"): Promise<{ cookie: string; id: string }> {
  const users = new UsersRepository(store.db);
  const u = users.criar(nome, await Bun.password.hash("senha-real-12345"), false, "member");
  return { cookie: `${SESSION_COOKIE}=${users.abrirSessao(u.id).token}`, id: u.id };
}

async function conexaoComVpn(): Promise<Connection> {
  const res = await chamar("POST", "/connections", admin, {
    name: "cliente", host: "10.20.0.5", port: 5432, database: "app", username: "u", password: "p", vpn: "cliente-a",
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Connection;
}

describe("arquivo .ovpn", () => {
  it("salva cifrado, lista só o fato de existir e nunca devolve o conteúdo", async () => {
    const res = await chamar("PUT", "/vpn/cliente-a/arquivo", admin, { ovpn: OVPN });
    expect(res.status).toBe(200);
    const texto = await res.text();
    expect(texto).not.toContain("CHAVE-PRIVADA-SECRETA");
    expect((JSON.parse(texto) as VpnList)[0]?.temArquivo).toBe(true);

    const cru = store.db.query<{ ovpn_enc: string }, []>("SELECT ovpn_enc FROM vpn_profiles").get();
    expect(cru?.ovpn_enc).not.toContain("CHAVE-PRIVADA-SECRETA");
  });

  it("diretiva perigosa é 422 e cita a linha, não o conteúdo", async () => {
    const res = await chamar("PUT", "/vpn/cliente-a/arquivo", admin, { ovpn: `${OVPN}up /tmp/x.sh\n` });
    expect(res.status).toBe(422);
    const corpo = (await res.json()) as { code: string; message: string };
    expect(corpo.code).toBe("vpn_file_invalid");
    expect(corpo.message).toContain("up");
    expect(corpo.message).not.toContain("CHAVE-PRIVADA-SECRETA");
  });

  it("perfil fora de DBEE_VPN_PERFIS é 404", async () => {
    expect((await chamar("PUT", "/vpn/outro/arquivo", admin, { ovpn: OVPN })).status).toBe(404);
  });
});

describe("conectar", () => {
  it("sem .ovpn é 409", async () => {
    const res = await chamar("POST", "/vpn/cliente-a/conectar", admin, { usuario: "u", senha: PIN, codigo: CODIGO });
    expect(res.status).toBe(409);
  });

  it("manda o .ovpn da PRÓPRIA pessoa, a credencial e os destinos; não ecoa a senha", async () => {
    await conexaoComVpn();
    await chamar("PUT", "/vpn/cliente-a/arquivo", admin, { ovpn: OVPN });
    const res = await chamar("POST", "/vpn/cliente-a/conectar", admin, { usuario: "fulano", senha: PIN, codigo: CODIGO });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(SEGREDO);

    const pedido = recebidos.find((r) => r.metodo === "POST");
    expect(pedido?.caminho).toBe(`/tuneis/${adminId}.cliente-a`);
    expect(pedido?.corpo).toEqual({
      ovpn: OVPN, usuario: "fulano", senha: SEGREDO, destinos: [{ host: "10.20.0.5", porta: 5432 }],
    });
  });

  it("credencial recusada pela VPN vira 422 vpn_auth_failed", async () => {
    await chamar("PUT", "/vpn/cliente-a/arquivo", admin, { ovpn: OVPN });
    respostaConectar = { status: 401, corpo: { code: "credencial_recusada" } };
    const res = await chamar("POST", "/vpn/cliente-a/conectar", admin, { usuario: "u", senha: PIN, codigo: CODIGO });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe("vpn_auth_failed");
  });

  it("sidecar fora do ar é 502", async () => {
    await chamar("PUT", "/vpn/cliente-a/arquivo", admin, { ovpn: OVPN });
    await sidecar.stop(true);
    const res = await chamar("POST", "/vpn/cliente-a/conectar", admin, { usuario: "u", senha: PIN, codigo: CODIGO });
    expect(res.status).toBe(502);
  });

  it("senha com quebra de linha ou NUL é recusada sem ecoar", async () => {
    for (const senha of [`${PIN}\nsignal SIGTERM`, `${PIN}\u0000x`]) {
      const res = await chamar("POST", "/vpn/cliente-a/conectar", admin, { usuario: "u", senha, codigo: CODIGO });
      expect(res.status).toBe(422);
      expect(await res.text()).not.toContain(SEGREDO);
    }
  });
});

describe("credencial lembrada", () => {
  it("lembrar guarda usuário + PIN cifrados SÓ após login aceito; depois basta o código", async () => {
    await chamar("PUT", "/vpn/cliente-a/arquivo", admin, { ovpn: OVPN });
    const r1 = await chamar("POST", "/vpn/cliente-a/conectar", admin, { usuario: "fulano", senha: PIN, codigo: CODIGO, lembrar: true });
    expect(r1.status).toBe(200);
    const lista = (await r1.json()) as VpnList;
    expect(lista[0]?.usuarioLembrado).toBe("fulano");
    expect(JSON.stringify(lista)).not.toContain(PIN);

    const cru = store.db.query<{ senha_enc: string }, []>("SELECT senha_enc FROM vpn_profiles").get();
    expect(cru?.senha_enc).not.toContain(PIN);

    await chamar("POST", "/vpn/cliente-a/desconectar", admin);
    recebidos = [];
    const r2 = await chamar("POST", "/vpn/cliente-a/conectar", admin, { codigo: "333444" });
    expect(r2.status).toBe(200);
    const pedido = recebidos.find((r) => r.metodo === "POST");
    expect(pedido?.corpo?.["usuario"]).toBe("fulano");
    expect(pedido?.corpo?.["senha"]).toBe(`${PIN}333444`);
  });

  it("login recusado não guarda nada", async () => {
    await chamar("PUT", "/vpn/cliente-a/arquivo", admin, { ovpn: OVPN });
    respostaConectar = { status: 401, corpo: { code: "credencial_recusada" } };
    await chamar("POST", "/vpn/cliente-a/conectar", admin, { usuario: "fulano", senha: "PINERRADO", codigo: CODIGO, lembrar: true });
    const lista = (await (await chamar("GET", "/vpn", admin)).json()) as VpnList;
    expect(lista[0]?.usuarioLembrado).toBeNull();
  });

  it("só código sem nada lembrado é 409; código fora do formato é 422", async () => {
    await chamar("PUT", "/vpn/cliente-a/arquivo", admin, { ovpn: OVPN });
    expect((await chamar("POST", "/vpn/cliente-a/conectar", admin, { codigo: CODIGO })).status).toBe(409);
    expect((await chamar("POST", "/vpn/cliente-a/conectar", admin, { codigo: "12ab56" })).status).toBe(422);
  });

  it("esquecer apaga usuário e senha e mantém o .ovpn", async () => {
    await chamar("PUT", "/vpn/cliente-a/arquivo", admin, { ovpn: OVPN });
    await chamar("POST", "/vpn/cliente-a/conectar", admin, { usuario: "fulano", senha: PIN, codigo: CODIGO, lembrar: true });
    const res = await chamar("DELETE", "/vpn/cliente-a/credencial", admin);
    const lista = (await res.json()) as VpnList;
    expect(lista[0]?.usuarioLembrado).toBeNull();
    expect(lista[0]?.temArquivo).toBe(true);
    const cru = store.db.query<{ senha_enc: string | null }, []>("SELECT senha_enc FROM vpn_profiles").get();
    expect(cru?.senha_enc).toBeNull();
  });

  it("a credencial lembrada de um não serve ao outro", async () => {
    await chamar("PUT", "/vpn/cliente-a/arquivo", admin, { ovpn: OVPN });
    await chamar("POST", "/vpn/cliente-a/conectar", admin, { usuario: "fulano", senha: PIN, codigo: CODIGO, lembrar: true });
    const m = await membro();
    await chamar("PUT", "/vpn/cliente-a/arquivo", m.cookie, { ovpn: OVPN });
    expect((await chamar("POST", "/vpn/cliente-a/conectar", m.cookie, { codigo: CODIGO })).status).toBe(409);
  });
});

describe("isolamento entre pessoas", () => {
  it("o túnel e o .ovpn de um não aparecem nem servem para o outro", async () => {
    await chamar("PUT", "/vpn/cliente-a/arquivo", admin, { ovpn: OVPN });
    await chamar("POST", "/vpn/cliente-a/conectar", admin, { usuario: "u", senha: PIN, codigo: CODIGO });
    const m = await membro();

    const lista = (await (await chamar("GET", "/vpn", m.cookie)).json()) as VpnList;
    expect(lista).toEqual([{ perfil: "cliente-a", temArquivo: false, estado: "desconectada", ipLocal: null, usuarioLembrado: null }]);
    // Sem .ovpn próprio, o membro não conecta — o do admin não é reaproveitado.
    expect((await chamar("POST", "/vpn/cliente-a/conectar", m.cookie, { usuario: "u", senha: PIN, codigo: CODIGO })).status).toBe(409);
    // Desconectar do membro mira o id DELE, nunca o túnel do admin.
    await chamar("POST", "/vpn/cliente-a/desconectar", m.cookie);
    expect(tuneis.has(`${adminId}.cliente-a`)).toBe(true);
  });

  it("só admin vê quem está conectado", async () => {
    const m = await membro();
    expect((await chamar("GET", "/vpn/ativos", m.cookie)).status).toBe(403);
    expect((await chamar("GET", "/vpn/ativos", admin)).status).toBe(200);
  });

  it("logout derruba os túneis da pessoa", async () => {
    await chamar("PUT", "/vpn/cliente-a/arquivo", admin, { ovpn: OVPN });
    await chamar("POST", "/vpn/cliente-a/conectar", admin, { usuario: "u", senha: PIN, codigo: CODIGO });
    await chamar("POST", "/auth/logout", admin);
    await Bun.sleep(50);
    expect(tuneis.size).toBe(0);
  });
});

describe("conexão com VPN", () => {
  it("sem o túnel de quem consulta, a consulta é recusada com vpn_disconnected", async () => {
    const c = await conexaoComVpn();
    const res = await chamar("POST", `/connections/${c.id}/query`, admin, { sql: "select 1" });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe("vpn_disconnected");
  });

  it("perfil desconhecido ou engine sem TCP simples é recusado no cadastro", async () => {
    const base = { name: "x", host: "h", port: 5432, database: "d", username: "u", password: "p" };
    expect((await chamar("POST", "/connections", admin, { ...base, vpn: "outro" })).status).toBe(400);
    expect((await chamar("POST", "/connections", admin, { ...base, engine: "redis", vpn: "cliente-a" })).status).toBe(400);
  });

  it("conexão nova com VPN abre encaminhamento para quem já está conectado", async () => {
    await chamar("PUT", "/vpn/cliente-a/arquivo", admin, { ovpn: OVPN });
    await chamar("POST", "/vpn/cliente-a/conectar", admin, { usuario: "u", senha: PIN, codigo: CODIGO });
    await conexaoComVpn();
    await Bun.sleep(50);
    const pedido = recebidos.find((r) => r.caminho.endsWith("/destinos"));
    expect(pedido?.corpo).toEqual({ destinos: [{ host: "10.20.0.5", porta: 5432 }] });
  });
});

describe("lerVpn", () => {
  const env = { DBEE_VPN_CONTROLE: "http://dbee-vpn:7600", DBEE_VPN_TOKEN: TOKEN, DBEE_VPN_PERFIS: "cliente-a, cliente-b" };
  it("desligada sem nenhuma variável", () => {
    expect(lerVpn({})).toBeNull();
  });
  it("lê completa", () => {
    expect(lerVpn(env)).toEqual({ controle: "http://dbee-vpn:7600", host: "dbee-vpn", token: TOKEN, perfis: ["cliente-a", "cliente-b"] });
  });
  it("parcial, token curto, perfil inválido ou repetido derrubam a subida", () => {
    expect(() => lerVpn({ DBEE_VPN_CONTROLE: "http://x:1" })).toThrow();
    expect(() => lerVpn({ ...env, DBEE_VPN_TOKEN: "curto" })).toThrow();
    expect(() => lerVpn({ ...env, DBEE_VPN_PERFIS: "cliente A" })).toThrow();
    expect(() => lerVpn({ ...env, DBEE_VPN_PERFIS: "a,a" })).toThrow();
    expect(() => lerVpn({ ...env, DBEE_VPN_CONTROLE: "ftp://x" })).toThrow();
  });
});
