import type { VpnEstado } from "@dbee/shared";

/**
 * Partes sem I/O do protocolo de gerenciamento do OpenVPN
 * (https://openvpn.net/community-resources/management-interface/). Separadas do
 * socket para serem testadas sem um openvpn de pé.
 */

/**
 * Argumento entre aspas do protocolo: `\` e `"` escapados com `\`. Quebra de
 * linha é recusada aqui também, e não só no schema da rota: um `\n` encerraria
 * o comando e o resto viraria um segundo comando arbitrário no openvpn.
 */
export function citar(valor: string): string {
  if (/[\r\n\0]/.test(valor)) {
    throw new Error("valor com quebra de linha não pode ir ao openvpn");
  }
  return `"${valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export interface LinhaDeEstado {
  readonly estado: VpnEstado;
  readonly ipLocal: string | null;
  readonly desde: number | null;
}

/**
 * Traduz uma linha de `state` (`1700000000,CONNECTED,SUCCESS,10.8.0.2,…`) ou
 * da notificação `>STATE:…`. Estados internos do openvpn que significam "a
 * caminho" (WAIT, AUTH, GET_CONFIG, ASSIGN_IP, ADD_ROUTES, RECONNECTING, …)
 * viram `conectando`; só CONNECTED é `conectada`.
 */
export function lerEstado(linha: string): LinhaDeEstado | null {
  const corpo = linha.startsWith(">STATE:") ? linha.slice(">STATE:".length) : linha;
  const partes = corpo.split(",");
  if (partes.length < 2) return null;
  const desde = Number(partes[0]);
  if (!Number.isInteger(desde)) return null;
  const nome = partes[1] ?? "";
  const ip = partes[3] ?? "";
  if (nome === "CONNECTED") {
    return { estado: "conectada", ipLocal: ip === "" ? null : ip, desde };
  }
  if (nome === "EXITING") return { estado: "desconectada", ipLocal: null, desde };
  return { estado: "conectando", ipLocal: null, desde };
}

/** O openvpn está pedindo usuário/senha do `auth-user-pass`. */
export const pedeCredencial = (linha: string): boolean =>
  linha.startsWith(">PASSWORD:Need 'Auth'");

/** Concentrador recusou a credencial (senha ou TOTP errados). */
export const credencialRecusada = (linha: string): boolean =>
  linha.startsWith(">PASSWORD:Verification Failed");

/** Processo parado em `--management-hold`, esperando `hold release`. */
export const emEspera = (linha: string): boolean => linha.startsWith(">HOLD:");
