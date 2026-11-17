import { afterAll, describe, expect, test } from "bun:test";

import { ControleVpn } from "../cliente";

/**
 * Sidecar REAL contra um servidor OpenVPN REAL (ADR 014).
 *
 *   sh deploy/vpn/teste/subir.sh   # imprime o env abaixo
 *   DBEE_TEST_VPN_SIDECAR=… DBEE_TEST_VPN_PKI=… bun test sidecar.integration
 *
 * O servidor de teste empurra `redirect-gateway` (full tunnel, como a
 * VPN do cliente A) e tem um "banco" em 10.99.0.1:5432 que responde o IP de quem
 * conectou. Prova que: dois usuários sobem túneis ao mesmo tempo; cada um sai
 * pelo PRÓPRIO túnel (IP da VPN dele); credencial errada é recusada; derrubar
 * um não derruba o outro.
 */
const URL_SIDECAR = process.env["DBEE_TEST_VPN_SIDECAR"];
const PKI = process.env["DBEE_TEST_VPN_PKI"] ?? "";
const controle = new ControleVpn({
  controle: URL_SIDECAR ?? "http://127.0.0.1:1",
  host: "127.0.0.1",
  token: "token-de-teste-com-mais-de-24",
  perfis: ["teste"],
});
const BANCO = [{ host: "10.99.0.1", porta: 5432 }];

/** Abre o encaminhamento e lê o IP que o "banco" viu. */
async function ipVistoPeloBanco(porta: number): Promise<string> {
  let texto = "";
  await new Promise<void>((resolve, reject) => {
    void Bun.connect({
      hostname: "127.0.0.1",
      port: porta,
      socket: {
        data: (_s, d) => { texto += d.toString(); },
        close: () => { resolve(); },
        error: (_s, e) => { reject(e); },
      },
    }).catch(reject);
  });
  return texto.trim();
}

describe.skipIf(URL_SIDECAR === undefined)("sidecar de VPN real", () => {
  afterAll(async () => {
    await controle.desconectar("alice.teste");
    await controle.desconectar("bob.teste");
  });

  test("credencial errada é recusada e não deixa túnel", async () => {
    const ovpn = await Bun.file(`${PKI}/alice.ovpn`).text();
    const r = await controle.conectar("alice.teste", ovpn, "alice", "000000000000", BANCO);
    expect(r).toEqual({ ok: false, falha: "credencial_recusada" });
    expect((await controle.listar())?.find((t) => t.id === "alice.teste")).toBeUndefined();
  }, 90_000);

  test("dois usuários, dois túneis, cada consulta sai pelo túnel da própria pessoa", async () => {
    const [a, b] = await Promise.all([
      controle.conectar("alice.teste", await Bun.file(`${PKI}/alice.ovpn`).text(), "alice", "111111222222", BANCO),
      controle.conectar("bob.teste", await Bun.file(`${PKI}/bob.ovpn`).text(), "bob", "333333444444", BANCO),
    ]);
    if (!a.ok || !b.ok) throw new Error(`conectar falhou: ${JSON.stringify([a, b])}`);
    expect(a.tunel.estado).toBe("conectada");
    expect(b.tunel.estado).toBe("conectada");
    expect(a.tunel.ipLocal).not.toBe(b.tunel.ipLocal);

    const portaA = a.tunel.encaminhamentos[0]?.local ?? 0;
    const portaB = b.tunel.encaminhamentos[0]?.local ?? 0;
    expect(await ipVistoPeloBanco(portaA)).toBe(a.tunel.ipLocal ?? "?");
    expect(await ipVistoPeloBanco(portaB)).toBe(b.tunel.ipLocal ?? "?");
  }, 120_000);

  test("full tunnel empurrado não sequestrou o controle (route-noexec)", async () => {
    // Se o redirect-gateway tivesse sido aplicado, o sidecar perderia a rota
    // de volta e esta chamada pelo host falharia.
    expect((await controle.listar())?.length).toBe(2);
  });

  test("derrubar um túnel não afeta o outro", async () => {
    expect(await controle.desconectar("alice.teste")).toBe(true);
    const lista = (await controle.listar()) ?? [];
    expect(lista.map((t) => t.id)).toEqual(["bob.teste"]);
    const bob = lista[0];
    expect(await ipVistoPeloBanco(bob?.encaminhamentos[0]?.local ?? 0)).toBe(bob?.ipLocal ?? "?");
  }, 30_000);

  test("token errado é recusado", async () => {
    const intruso = new ControleVpn({
      controle: URL_SIDECAR ?? "", host: "127.0.0.1", token: "x".repeat(30), perfis: [],
    });
    expect(await intruso.listar()).toBeNull();
  });
});
