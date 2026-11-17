/**
 * Validação do .ovpn enviado pelo usuário (ADR 014).
 *
 * O arquivo vira argumento de um openvpn que roda com `NET_ADMIN` no sidecar.
 * Diretivas como `up`, `plugin`, `script-security` ou `management` dariam a
 * quem sobe o arquivo execução de comando ou controle do processo. Por isso a
 * lista é de PERMITIDAS, não de proibidas: diretiva desconhecida é recusada.
 * O sidecar reaplica esta validação (defesa em profundidade) e ainda força
 * `--script-security 1` na linha de comando.
 */

const PERMITIDAS = new Set([
  "client", "dev", "dev-type", "proto", "remote", "remote-random", "resolv-retry",
  "nobind", "persist-key", "persist-tun", "persist-remote-ip", "persist-local-ip",
  "data-ciphers", "data-ciphers-fallback", "cipher", "ncp-ciphers", "auth",
  "tls-client", "tls-version-min", "tls-version-max", "tls-cipher", "tls-ciphersuites",
  "tls-groups", "verify-x509-name", "remote-cert-tls", "ns-cert-type", "remote-cert-ku",
  "remote-cert-eku", "auth-user-pass", "auth-nocache", "explicit-exit-notify",
  "key-direction", "comp-lzo", "compress", "allow-compression", "reneg-sec",
  "reneg-bytes", "reneg-pkts", "verb", "mute", "mute-replay-warnings", "float",
  "ping", "ping-restart", "ping-exit", "keepalive", "connect-retry",
  "connect-retry-max", "connect-timeout", "server-poll-timeout", "pull", "tun-mtu",
  "mssfix", "fragment", "sndbuf", "rcvbuf", "push-peer-info", "static-challenge",
  "hand-window", "tran-window", "auth-retry", "pull-filter", "route-nopull",
  "redirect-gateway", "block-outside-dns", "register-dns",
  "tls-timeout", "replay-window", "fast-io",
]);

/** Blocos inline aceitos: só material criptográfico. */
const BLOCOS = new Set(["ca", "cert", "key", "tls-auth", "tls-crypt", "tls-crypt-v2", "extra-certs"]);

export type ErroOvpn =
  | { readonly tipo: "vazio" }
  | { readonly tipo: "caractere"; readonly linha: number }
  | { readonly tipo: "grande" }
  | { readonly tipo: "diretiva"; readonly linha: number; readonly diretiva: string }
  | { readonly tipo: "bloco"; readonly linha: number; readonly bloco: string }
  | { readonly tipo: "sem_remote" };

export const TAMANHO_MAXIMO_OVPN = 64 * 1024;

export function validarOvpn(texto: string): ErroOvpn | null {
  if (texto.trim() === "") return { tipo: "vazio" };
  if (texto.length > TAMANHO_MAXIMO_OVPN) return { tipo: "grande" };

  let dentroDe: string | null = null;
  let temRemote = false;
  const linhas = texto.split("\n");
  for (let i = 0; i < linhas.length; i++) {
    const crua = (linhas[i] ?? "").replace(/\r$/, "");
    const n = i + 1;
    /*
     * Só ASCII imprimível + TAB, e no máximo 255 bytes por linha (o openvpn
     * lê 256). Sem isto, um NBSP que o `.trim()` do JS remove e o openvpn não
     * faz o validador e o openvpn enxergarem linhas DIFERENTES — foi o
     * contorno achado na revisão adversarial (fechar um bloco num ponto para
     * o openvpn e noutro para nós, contrabandeando `plugin` no meio).
     */
    if (!/^[\t\x20-\x7e]*$/.test(crua) || crua.length > 255) return { tipo: "caractere", linha: n };
    // Mesma regra do openvpn: pula só espaço/TAB ASCII do início.
    const linha = crua.replace(/^[ \t]+/, "");
    if (dentroDe !== null) {
      if (linha.startsWith("</")) {
        // O openvpn fecha o bloco por PREFIXO e descarta o resto da linha.
        // Exigimos a tag exata e nada depois; qualquer outra coisa é recusa.
        if (linha.replace(/[ \t]+$/, "") !== `</${dentroDe}>`) return { tipo: "bloco", linha: n, bloco: dentroDe };
        dentroDe = null;
      }
      continue;
    }
    if (linha === "" || linha.startsWith("#") || linha.startsWith(";")) continue;
    if (linha.startsWith("<")) {
      const bloco = /^<([a-z0-9-]+)>[ \t]*$/.exec(linha);
      const nome = bloco?.[1] ?? linha;
      if (bloco === null || !BLOCOS.has(nome)) return { tipo: "bloco", linha: n, bloco: nome };
      dentroDe = nome;
      continue;
    }
    const partes = linha.split(/[ \t]+/);
    const diretiva = (partes[0] ?? "").replace(/^--/, "");
    if (!PERMITIDAS.has(diretiva)) return { tipo: "diretiva", linha: n, diretiva };
    // `auth-user-pass <arquivo>` leria um arquivo do sidecar: só sem argumento.
    if (diretiva === "auth-user-pass" && partes.filter((p) => p !== "").length > 1) {
      return { tipo: "diretiva", linha: n, diretiva: "auth-user-pass <arquivo>" };
    }
    if (diretiva === "remote") temRemote = true;
  }
  if (dentroDe !== null) return { tipo: "bloco", linha: linhas.length, bloco: dentroDe };
  if (!temRemote) return { tipo: "sem_remote" };
  return null;
}
