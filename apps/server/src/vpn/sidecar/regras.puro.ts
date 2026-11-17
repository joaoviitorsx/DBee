/** Regras sem I/O do sidecar de VPN (ADR 014), testáveis fora do container. */

export const MAX_TUNEIS = 200;
export const MAX_DESTINOS = 50;
const BASE_PORTA = 20_000;

/** `<userId>.<perfil>` — o DBee monta; o sidecar só confere o formato. */
export function idDoTunelValido(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}\.[a-z0-9][a-z0-9_-]{0,31}$/.test(id);
}

/**
 * Host sem `,` `:` nem espaço: no socat, `,` abre opção e `:` separa campos —
 * aceitar isso deixaria quem cadastra a conexão injetar opção do socat.
 */
export function destinoValido(host: string, porta: number): boolean {
  return /^[A-Za-z0-9.-]{1,253}$/.test(host) && Number.isInteger(porta) && porta >= 1 && porta <= 65_535;
}

/** Porta local determinística por túnel: 50 por túnel a partir de 20000. */
export function portaLocal(indice: number, ordem: number): number {
  return BASE_PORTA + indice * MAX_DESTINOS + ordem;
}
