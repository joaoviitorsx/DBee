import type { VpnEstado } from "@dbee/shared";

import type { ConfigVpn } from "../lib/config";

/**
 * Cliente HTTP do controle do sidecar (ADR 014). O DBee não executa openvpn
 * nem mexe em rota: pede ao sidecar, numa rede exclusiva, com token.
 */
export interface TunelRemoto {
  readonly id: string;
  readonly estado: VpnEstado;
  readonly ipLocal: string | null;
  readonly encaminhamentos: readonly { host: string; porta: number; local: number }[];
}

export type FalhaControle = "credencial_recusada" | "tempo_esgotado" | "inacessivel" | "ovpn_invalido";

export interface Destino {
  readonly host: string;
  readonly porta: number;
}

/** Abrir túnel espera a VPN autenticar: prazo maior que o resto. */
const PRAZO_CONECTAR_MS = 60_000;
const PRAZO_MS = 8_000;

export class ControleVpn {
  constructor(private readonly config: ConfigVpn) {}

  async #chamar(metodo: string, caminho: string, corpo: unknown, prazo: number): Promise<Response | null> {
    try {
      return await fetch(`${this.config.controle}${caminho}`, {
        method: metodo,
        headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json" },
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
        redirect: "manual",
        signal: AbortSignal.timeout(prazo),
      });
    } catch {
      // Sem detalhe: a mensagem do fetch cita a URL do controle.
      return null;
    }
  }

  async conectar(
    id: string,
    ovpn: string,
    usuario: string,
    senha: string,
    destinos: readonly Destino[],
  ): Promise<{ ok: true; tunel: TunelRemoto } | { ok: false; falha: FalhaControle }> {
    const r = await this.#chamar("POST", `/tuneis/${encodeURIComponent(id)}`, { ovpn, usuario, senha, destinos }, PRAZO_CONECTAR_MS);
    if (r === null) return { ok: false, falha: "inacessivel" };
    if (r.ok) return { ok: true, tunel: (await r.json()) as TunelRemoto };
    if (r.status === 401) {
      // 401 do sidecar pode ser token errado do DBee ou credencial da VPN; o
      // código no corpo separa os dois.
      const { code } = (await r.json().catch(() => ({}))) as { code?: string };
      return { ok: false, falha: code === "credencial_recusada" ? "credencial_recusada" : "inacessivel" };
    }
    if (r.status === 504) return { ok: false, falha: "tempo_esgotado" };
    if (r.status === 422) return { ok: false, falha: "ovpn_invalido" };
    return { ok: false, falha: "inacessivel" };
  }

  async destinos(id: string, destinos: readonly Destino[]): Promise<TunelRemoto | null> {
    const r = await this.#chamar("POST", `/tuneis/${encodeURIComponent(id)}/destinos`, { destinos }, PRAZO_MS);
    return r?.ok === true ? ((await r.json()) as TunelRemoto) : null;
  }

  async desconectar(id: string): Promise<boolean> {
    const r = await this.#chamar("DELETE", `/tuneis/${encodeURIComponent(id)}`, undefined, PRAZO_MS);
    return r?.ok === true;
  }

  /** Todos os túneis vivos no sidecar. `null` = sidecar fora do ar. */
  async listar(): Promise<TunelRemoto[] | null> {
    const r = await this.#chamar("GET", "/tuneis", undefined, PRAZO_MS);
    return r?.ok === true ? ((await r.json()) as TunelRemoto[]) : null;
  }
}
