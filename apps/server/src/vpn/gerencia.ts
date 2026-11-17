import type { Socket } from "bun";

import type { VpnEstado } from "@dbee/shared";


import {
  citar,
  credencialRecusada,
  emEspera,
  lerEstado,
  pedeCredencial,
} from "./protocolo.puro";


export interface EstadoDoTunel {
  readonly estado: VpnEstado;
  readonly ipLocal: string | null;
}

export type ResultadoConectar =
  | { readonly ok: true }
  | { readonly ok: false; readonly motivo: "credencial_recusada" | "inacessivel" | "tempo_esgotado" };

/**
 * Onde a interface de gerenciamento de um openvpn escuta. No sidecar é um
 * socket unix por túnel (ADR 014): fora da rede, ninguém além do controlador
 * fala com ele.
 */
export interface AlvoDeGerencia {
  readonly nome: string;
  readonly unix: string;
  /** Senha do `--management … pw-file`. Nunca logada nem devolvida. */
  readonly senha: string;
}

const PRAZO_CONEXAO_MS = 3_000;
const PRAZO_TUNEL_MS = 45_000;
/** Janela para o openvpn reenviar notificações pendentes (>HOLD, >PASSWORD). */
const JANELA_NOTIFICACAO_MS = 300;

class Inacessivel extends Error {}

/**
 * Uma conversa curta com a interface de gerenciamento: abre, autentica, faz o
 * que precisa e fecha. Sem conexão persistente — o openvpn aceita um cliente
 * por vez, e segurar o socket bloquearia diagnóstico manual pelo `nc`.
 */
class Conversa {
  private buffer = "";
  private readonly linhas: string[] = [];
  private espera: (() => void) | null = null;
  private fechado = false;

  private constructor(private socket: Socket | null) {}

  static async abrir(alvo: AlvoDeGerencia): Promise<Conversa> {
    const conversa = new Conversa(null);
    const prazo = setTimeout(() => { conversa.fechar(); }, PRAZO_CONEXAO_MS);
    try {
      conversa.socket = await Bun.connect({
        unix: alvo.unix,
        socket: {
          data: (_s, dados) => { conversa.receber(dados.toString("utf8")); },
          close: () => { conversa.marcarFechado(); },
          error: () => { conversa.marcarFechado(); },
        },
      });
      // O openvpn pede a senha sem quebra de linha ("ENTER PASSWORD:").
      await conversa.esperarTexto((b) => b.includes("ENTER PASSWORD:"), PRAZO_CONEXAO_MS);
      conversa.buffer = "";
      conversa.enviar(alvo.senha);
      const ok = await conversa.esperar((l) => l.startsWith("SUCCESS: password"), PRAZO_CONEXAO_MS);
      if (ok === null) throw new Inacessivel();
      return conversa;
    } catch {
      conversa.fechar();
      // Mensagem genérica: o erro do socket pode citar host/porta, e senha
      // errada da gerência é configuração, não algo para a UI ver.
      throw new Inacessivel();
    } finally {
      clearTimeout(prazo);
    }
  }

  private receber(texto: string): void {
    this.buffer += texto;
    let i = this.buffer.indexOf("\n");
    while (i >= 0) {
      this.linhas.push(this.buffer.slice(0, i).replace(/\r$/, ""));
      this.buffer = this.buffer.slice(i + 1);
      i = this.buffer.indexOf("\n");
    }
    this.espera?.();
  }

  private marcarFechado(): void {
    this.fechado = true;
    this.espera?.();
  }

  enviar(comando: string): void {
    if (this.socket === null || this.fechado) throw new Inacessivel();
    this.socket.write(`${comando}\n`);
  }

  private aguardarDados(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.espera = null;
        resolve(false);
      }, ms);
      this.espera = () => {
        clearTimeout(t);
        this.espera = null;
        resolve(true);
      };
    });
  }

  private async esperarTexto(pred: (b: string) => boolean, ms: number): Promise<void> {
    const limite = Date.now() + ms;
    while (!pred(this.buffer)) {
      if (this.fechado) throw new Inacessivel();
      const resta = limite - Date.now();
      if (resta <= 0 || !(await this.aguardarDados(resta))) throw new Inacessivel();
    }
  }

  /** Consome linhas até uma casar; devolve a que casou, ou null no prazo. */
  async esperar(pred: (l: string) => boolean, ms: number, vistas?: string[]): Promise<string | null> {
    const limite = Date.now() + ms;
    for (;;) {
      for (let linha = this.linhas.shift(); linha !== undefined; linha = this.linhas.shift()) {
        vistas?.push(linha);
        if (pred(linha)) return linha;
      }
      if (this.fechado) return null;
      const resta = limite - Date.now();
      if (resta <= 0 || !(await this.aguardarDados(resta))) return null;
    }
  }

  /** O openvpn fechou a conversa (processo caiu ou reiniciou). */
  get caiu(): boolean {
    return this.fechado;
  }

  fechar(): void {
    this.fechado = true;
    this.socket?.end();
  }
}

/**
 * Cliente da interface de gerenciamento de um sidecar OpenVPN.
 *
 * O DBee não executa openvpn nem mexe em rota (ADR 006, teste 2): o processo
 * e o namespace de rede são do sidecar. Aqui só trafega texto por TCP.
 */
export class GerenciaOpenvpn {
  constructor(private readonly alvo: AlvoDeGerencia) {}

  get nome(): string {
    return this.alvo.nome;
  }

  async status(): Promise<EstadoDoTunel> {
    let conversa: Conversa;
    try {
      conversa = await Conversa.abrir(this.alvo);
    } catch {
      return { estado: "inacessivel", ipLocal: null };
    }
    try {
      const vistas: string[] = [];
      conversa.enviar("state");
      await conversa.esperar((l) => l === "END", PRAZO_CONEXAO_MS, vistas);
      await conversa.esperar(() => false, JANELA_NOTIFICACAO_MS, vistas);
      const estado = vistas
        .filter((l) => !l.startsWith(">"))
        .map(lerEstado)
        .find((e) => e !== null);
      if (estado?.estado === "conectada") return { estado: "conectada", ipLocal: estado.ipLocal };
      // Parado pedindo credencial (renegociação com --auth-nocache) é túnel
      // caído para quem usa: o caminho é conectar de novo com código novo.
      const parado = vistas.some((l) => pedeCredencial(l) || emEspera(l));
      return { estado: parado ? "desconectada" : (estado?.estado ?? "desconectada"), ipLocal: null };
    } catch {
      return { estado: "inacessivel", ipLocal: null };
    } finally {
      conversa.fechar();
    }
  }

  /**
   * Solta o `hold`, responde o pedido de credencial e espera o túnel subir.
   * `usuario` e `senha` vão direto para o socket e não são guardados.
   */
  async conectar(usuario: string, senha: string): Promise<ResultadoConectar> {
    let conversa: Conversa;
    try {
      conversa = await Conversa.abrir(this.alvo);
    } catch {
      return { ok: false, motivo: "inacessivel" };
    }
    try {
      // Estado atual primeiro: já conectada não espera nada, e um pedido de
      // credencial pendente é reenviado pelo openvpn logo na conexão.
      const vistas: string[] = [];
      conversa.enviar("state");
      await conversa.esperar((l) => l === "END", PRAZO_CONEXAO_MS, vistas);
      if (vistas.some((l) => !l.startsWith(">") && lerEstado(l)?.estado === "conectada")) {
        return { ok: true };
      }
      if (!vistas.some(pedeCredencial)) {
        conversa.enviar("state on");
        conversa.enviar("hold release");
        const pedido = await conversa.esperar(
          (l) => pedeCredencial(l) || (l.startsWith(">STATE:") && lerEstado(l)?.estado === "conectada"),
          PRAZO_TUNEL_MS,
        );
        if (pedido === null) return { ok: false, motivo: conversa.caiu ? "inacessivel" : "tempo_esgotado" };
        if (!pedeCredencial(pedido)) return { ok: true };
      } else {
        conversa.enviar("state on");
      }

      // Os dois `citar` antes do primeiro envio: se a senha for recusada aqui,
      // o openvpn não fica com um usuário sem senha.
      const u = citar(usuario);
      const p = citar(senha);
      conversa.enviar(`username "Auth" ${u}`);
      conversa.enviar(`password "Auth" ${p}`);
      const fim = await conversa.esperar(
        (l) => credencialRecusada(l) || (l.startsWith(">STATE:") && lerEstado(l)?.estado === "conectada"),
        PRAZO_TUNEL_MS,
      );
      if (fim === null) return { ok: false, motivo: conversa.caiu ? "inacessivel" : "tempo_esgotado" };
      return credencialRecusada(fim) ? { ok: false, motivo: "credencial_recusada" } : { ok: true };
    } catch {
      return { ok: false, motivo: "inacessivel" };
    } finally {
      conversa.fechar();
    }
  }

  /**
   * Derruba o túnel e deixa o openvpn parado em `hold`, esperando o próximo
   * `conectar`. Não encerra o processo: o sidecar continua de pé.
   */
  async desconectar(): Promise<boolean> {
    let conversa: Conversa;
    try {
      conversa = await Conversa.abrir(this.alvo);
    } catch {
      return false;
    }
    try {
      conversa.enviar("hold on");
      conversa.enviar("signal SIGUSR1");
      return (await conversa.esperar((l) => l.startsWith("SUCCESS: signal"), PRAZO_CONEXAO_MS)) !== null;
    } catch {
      return false;
    } finally {
      conversa.fechar();
    }
  }
}
