import type { VpnList, VpnTuneisAtivos } from "@dbee/shared";

import type { ConnectionsRepository } from "../db/connections.repo";
import type { UsersRepository } from "../db/users.repo";
import type { CredencialLembrada, VpnProfilesRepository } from "../db/vpnProfiles.repo";
import type { Ator } from "../lib/ator";
import type { ConfigVpn } from "../lib/config";
import type { ControleVpn, Destino, FalhaControle, TunelRemoto } from "../vpn/cliente";
import { validarOvpn } from "../vpn/ovpn.puro";

export type VpnFailure =
  | "vpn_desligada"
  | "perfil_desconhecido"
  | "sem_arquivo"
  | "arquivo_ilegivel"
  /** Conectar sem usuário/senha e sem nada lembrado. */
  | "sem_credencial"
  | FalhaControle;

export type VpnResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: VpnFailure; readonly detail?: string };

/** O que chega da rota para conectar (ver `VpnConectarRequest`). */
export interface PedidoConexao {
  readonly codigo: string;
  readonly usuario?: string | undefined;
  readonly senha?: string | undefined;
  readonly lembrar?: boolean | undefined;
}

const ok = <T>(value: T): VpnResult<T> => ({ ok: true, value });
const falha = <T>(failure: VpnFailure, detail?: string): VpnResult<T> =>
  detail === undefined ? { ok: false, failure } : { ok: false, failure, detail };

/** Engines que trafegam por TCP simples e cabem num encaminhamento. */
const ENGINES_COM_VPN: ReadonlySet<string> = new Set(["postgres", "mysql", "mariadb"]);

const SINCRONIA_MS = 30_000;
/** Túnel sem uso por 8 h fecha sozinho: credencial de pessoa não fica aberta à toa. */
const OCIOSO_MS = 8 * 60 * 60 * 1000;

interface TunelLocal {
  readonly userId: string;
  readonly perfil: string;
  estado: TunelRemoto["estado"];
  ipLocal: string | null;
  encaminhamentos: Map<string, number>;
  ultimoUso: number;
}

const idDe = (userId: string, perfil: string): string => `${userId}.${perfil}`;
const chaveDestino = (host: string, porta: number): string => `${host}:${String(porta)}`;

/**
 * Túnel de VPN por pessoa (ADR 014).
 *
 * A verdade sobre o túnel é o sidecar. Aqui fica um espelho em memória, porque
 * `ConnectionsRepository.resolve` é síncrono e chamado em toda consulta: ele
 * pergunta `rota()` e recebe a porta local do encaminhamento DAQUELE usuário.
 * O espelho é ressincronizado a cada 30 s (pega queda da VPN e reinício do
 * DBee com túneis ainda abertos no sidecar).
 *
 * Credencial (usuário, senha+TOTP) passa por `conectar` e segue para o sidecar
 * sem ser guardada nem logada.
 */
export class VpnService {
  readonly #config: ConfigVpn | null;
  readonly #controle: ControleVpn | null;
  readonly #perfis: VpnProfilesRepository;
  readonly #conexoes: ConnectionsRepository;
  readonly #usuarios: UsersRepository;
  readonly #tuneis = new Map<string, TunelLocal>();
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: {
    config: ConfigVpn | null;
    controle: ControleVpn | null;
    perfis: VpnProfilesRepository;
    conexoes: ConnectionsRepository;
    usuarios: UsersRepository;
  }) {
    this.#config = deps.config;
    this.#controle = deps.controle;
    this.#perfis = deps.perfis;
    this.#conexoes = deps.conexoes;
    this.#usuarios = deps.usuarios;
  }

  get habilitada(): boolean {
    return this.#config !== null;
  }

  perfilValido(perfil: string): boolean {
    return this.#config?.perfis.includes(perfil) ?? false;
  }

  /** Liga a sincronia periódica. Idempotente. */
  iniciar(): void {
    if (this.#controle === null || this.#timer !== null) return;
    void this.sincronizar();
    this.#timer = setInterval(() => void this.sincronizar(), SINCRONIA_MS);
    this.#timer.unref();
  }

  parar(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** Espelha o sidecar e fecha túnel ocioso. */
  async sincronizar(): Promise<void> {
    if (this.#controle === null) return;
    const remotos = await this.#controle.listar();
    if (remotos === null) {
      for (const t of this.#tuneis.values()) t.estado = "inacessivel";
      return;
    }
    const vistos = new Set<string>();
    for (const r of remotos) {
      const [userId, perfil] = r.id.split(".");
      if (userId === undefined || perfil === undefined) continue;
      vistos.add(r.id);
      const local = this.#tuneis.get(r.id);
      this.#tuneis.set(r.id, {
        userId,
        perfil,
        estado: r.estado,
        ipLocal: r.ipLocal,
        encaminhamentos: new Map(r.encaminhamentos.map((e) => [chaveDestino(e.host, e.porta), e.local])),
        ultimoUso: local?.ultimoUso ?? Date.now(),
      });
    }
    for (const id of [...this.#tuneis.keys()]) if (!vistos.has(id)) this.#tuneis.delete(id);

    const agora = Date.now();
    for (const [id, t] of this.#tuneis) {
      if (agora - t.ultimoUso > OCIOSO_MS) {
        await this.#controle.desconectar(id);
        this.#tuneis.delete(id);
        registrar("ocioso", t.userId, t.perfil, "fechado");
      }
    }
  }

  listar(ator: Ator): VpnList {
    if (this.#config === null) return [];
    const comArquivo = this.#perfis.perfisComArquivo(ator.id);
    const lembrados = this.#perfis.usuariosLembrados(ator.id);
    return this.#config.perfis.map((perfil) => {
      const t = this.#tuneis.get(idDe(ator.id, perfil));
      return {
        perfil,
        temArquivo: comArquivo.has(perfil),
        estado: t?.estado ?? "desconectada",
        ipLocal: t?.ipLocal ?? null,
        usuarioLembrado: lembrados.get(perfil) ?? null,
      };
    });
  }

  /** Esquece usuário e senha lembrados do perfil. O .ovpn fica. */
  esquecerCredencial(ator: Ator, perfil: string): VpnResult<VpnList> {
    if (this.#config === null) return falha("vpn_desligada");
    if (!this.perfilValido(perfil)) return falha("perfil_desconhecido");
    this.#perfis.esquecer(ator.id, perfil);
    registrar("credencial", ator.id, perfil, "esquecida");
    return ok(this.listar(ator));
  }

  ativos(): VpnTuneisAtivos {
    return [...this.#tuneis.values()].map((t) => ({
      usuario: this.#usuarios.porId(t.userId)?.username ?? t.userId,
      perfil: t.perfil,
      estado: t.estado,
    }));
  }

  salvarArquivo(ator: Ator, perfil: string, ovpn: string): VpnResult<VpnList> {
    if (this.#config === null) return falha("vpn_desligada");
    if (!this.perfilValido(perfil)) return falha("perfil_desconhecido");
    const erro = validarOvpn(ovpn);
    if (erro !== null) {
      // O detalhe cita diretiva e linha, nunca conteúdo de bloco (chave).
      const detalhe =
        erro.tipo === "diretiva" ? `diretiva não permitida na linha ${String(erro.linha)}: ${erro.diretiva}`
        : erro.tipo === "bloco" ? `bloco não permitido na linha ${String(erro.linha)}: <${erro.bloco}>`
        : erro.tipo === "sem_remote" ? "o arquivo não tem a diretiva remote"
        : erro.tipo === "grande" ? "arquivo grande demais"
        : "arquivo vazio";
      return falha("ovpn_invalido", detalhe);
    }
    this.#perfis.salvar(ator.id, perfil, ovpn);
    registrar("arquivo", ator.id, perfil, "salvo");
    return ok(this.listar(ator));
  }

  async removerArquivo(ator: Ator, perfil: string): Promise<VpnResult<VpnList>> {
    if (this.#config === null) return falha("vpn_desligada");
    if (!this.perfilValido(perfil)) return falha("perfil_desconhecido");
    await this.desconectar(ator, perfil);
    this.#perfis.remover(ator.id, perfil);
    registrar("arquivo", ator.id, perfil, "removido");
    return ok(this.listar(ator));
  }

  /** Destinos do perfil que ESTE usuário alcança — o filtro de acesso do repo vale. */
  #destinos(ator: Ator, perfil: string): Destino[] {
    const vistos = new Map<string, Destino>();
    for (const c of this.#conexoes.list(ator)) {
      if (c.vpn === perfil && ENGINES_COM_VPN.has(c.engine)) {
        vistos.set(chaveDestino(c.host, c.port), { host: c.host, porta: c.port });
      }
    }
    return [...vistos.values()];
  }

  async conectar(ator: Ator, perfil: string, pedido: PedidoConexao): Promise<VpnResult<VpnList>> {
    if (this.#config === null || this.#controle === null) return falha("vpn_desligada");
    if (!this.perfilValido(perfil)) return falha("perfil_desconhecido");
    let ovpn: string | null;
    try {
      ovpn = this.#perfis.ler(ator.id, perfil);
    } catch {
      return falha("arquivo_ilegivel");
    }
    if (ovpn === null) return falha("sem_arquivo");

    // Credencial: a digitada agora, ou a lembrada. O código entra sempre.
    let base: CredencialLembrada | null;
    if (pedido.usuario !== undefined) {
      base = { usuario: pedido.usuario, senha: pedido.senha ?? "" };
    } else {
      try {
        base = this.#perfis.credencial(ator.id, perfil);
      } catch {
        return falha("arquivo_ilegivel");
      }
    }
    if (base === null) return falha("sem_credencial");
    const usuario = base.usuario;
    const senha = `${base.senha}${pedido.codigo}`;

    const id = idDe(ator.id, perfil);
    this.#tuneis.set(id, {
      userId: ator.id, perfil, estado: "conectando", ipLocal: null, encaminhamentos: new Map(), ultimoUso: Date.now(),
    });
    const r = await this.#controle.conectar(id, ovpn, usuario, senha, this.#destinos(ator, perfil));
    if (!r.ok) {
      this.#tuneis.delete(id);
      registrar("conectar", ator.id, perfil, r.falha);
      return falha(r.falha);
    }
    this.#espelhar(ator.id, perfil, r.tunel);
    // Só guarda o que a VPN ACEITOU — nunca um PIN digitado errado.
    if (pedido.usuario !== undefined && pedido.lembrar === true) {
      this.#perfis.lembrar(ator.id, perfil, base);
      registrar("credencial", ator.id, perfil, "lembrada");
    }
    registrar("conectar", ator.id, perfil, "ok");
    return ok(this.listar(ator));
  }

  async desconectar(ator: Ator, perfil: string): Promise<VpnResult<VpnList>> {
    if (this.#config === null || this.#controle === null) return falha("vpn_desligada");
    if (!this.perfilValido(perfil)) return falha("perfil_desconhecido");
    const id = idDe(ator.id, perfil);
    if (!(await this.#controle.desconectar(id))) return falha("inacessivel");
    this.#tuneis.delete(id);
    registrar("desconectar", ator.id, perfil, "ok");
    return ok(this.listar(ator));
  }

  /** Logout derruba os túneis da pessoa: sessão encerrada, credencial também. */
  async encerrarUsuario(userId: string): Promise<void> {
    if (this.#controle === null) return;
    for (const [id, t] of [...this.#tuneis]) {
      if (t.userId !== userId) continue;
      await this.#controle.desconectar(id);
      this.#tuneis.delete(id);
      registrar("logout", userId, t.perfil, "fechado");
    }
  }

  /**
   * Conexão criada ou editada com VPN: quem já está com o túnel do perfil
   * aberto ganha o encaminhamento novo sem precisar reconectar.
   */
  async sincronizarPerfil(perfil: string): Promise<void> {
    if (this.#controle === null) return;
    for (const [id, t] of [...this.#tuneis]) {
      if (t.perfil !== perfil || t.estado !== "conectada") continue;
      const usuario = this.#usuarios.porId(t.userId);
      if (usuario === null) continue;
      const destinos = this.#destinos({ id: t.userId, role: usuario.role }, perfil);
      const remoto = await this.#controle.destinos(id, destinos);
      if (remoto !== null) this.#espelhar(t.userId, perfil, remoto);
    }
  }

  /** Todos os perfis: chamado quando uma conexão com VPN é criada ou editada. */
  async sincronizarDestinos(): Promise<void> {
    for (const perfil of this.#config?.perfis ?? []) await this.sincronizarPerfil(perfil);
  }

  /**
   * Para onde o DBee deve abrir o socket de uma conexão com VPN, para ESTE
   * usuário. `null` = túnel dele não está de pé (ou o destino ainda não foi
   * encaminhado): quem chama recusa a consulta com mensagem clara.
   */
  rota(userId: string, perfil: string, host: string, porta: number): { host: string; port: number } | null {
    if (this.#config === null) return null;
    const t = this.#tuneis.get(idDe(userId, perfil));
    if (t?.estado !== "conectada") return null;
    const local = t.encaminhamentos.get(chaveDestino(host, porta));
    if (local === undefined) return null;
    t.ultimoUso = Date.now();
    return { host: this.#config.host, port: local };
  }

  #espelhar(userId: string, perfil: string, r: TunelRemoto): void {
    this.#tuneis.set(idDe(userId, perfil), {
      userId,
      perfil,
      estado: r.estado,
      ipLocal: r.ipLocal,
      encaminhamentos: new Map(r.encaminhamentos.map((e) => [chaveDestino(e.host, e.porta), e.local])),
      ultimoUso: Date.now(),
    });
  }
}

/**
 * Trilha de quem abriu e fechou túnel. Só ids, perfil e resultado — nada de
 * usuário da VPN, senha, IP de destino ou conteúdo do .ovpn.
 */
function registrar(acao: string, userId: string, perfil: string, resultado: string): void {
  console.info(`[dbee] vpn ${acao} user=${userId} perfil=${perfil} resultado=${resultado}`);
}
