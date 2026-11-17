import { t, type Static } from "elysia";

/**
 * VPN por pessoa (ADR 014).
 *
 * Cada usuário do DBee tem o próprio túnel por perfil (ex.: "cliente-a"), aberto
 * com o PRÓPRIO .ovpn (certificado emitido em nome dele) e a própria senha +
 * TOTP. As conexões marcadas com o perfil saem pelo túnel de quem consulta.
 *
 * O túnel não roda no DBee: roda no sidecar `deploy/vpn`. O .ovpn fica cifrado
 * no SQLite; usuário e senha atravessam a API uma vez e não são guardados.
 */
export const VpnEstado = t.Union([
  t.Literal("conectada"),
  t.Literal("conectando"),
  t.Literal("desconectada"),
  t.Literal("inacessivel"),
]);
export type VpnEstado = Static<typeof VpnEstado>;

/** Nome de perfil: o mesmo formato aceito em `DBEE_VPN_PERFIS`. */
export const PERFIL_VPN_PADRAO = "^[a-z0-9][a-z0-9_-]{0,31}$";
export const PerfilVpn = t.String({ pattern: PERFIL_VPN_PADRAO, maxLength: 32 });

/** Estado de um perfil para o usuário logado. Nunca traz o .ovpn. */
export const VpnStatus = t.Object({
  perfil: t.String(),
  /** O usuário já enviou o .ovpn deste perfil. */
  temArquivo: t.Boolean(),
  estado: VpnEstado,
  /** IP do túnel quando conectada. */
  ipLocal: t.Union([t.String(), t.Null()]),
  /**
   * Usuário da VPN lembrado (opt-in). Com ele, conectar pede só o código do
   * autenticador. A senha lembrada NUNCA viaja — só o fato de existir.
   */
  usuarioLembrado: t.Union([t.String(), t.Null()]),
});
export type VpnStatus = Static<typeof VpnStatus>;

export const VpnList = t.Array(VpnStatus);
export type VpnList = Static<typeof VpnList>;

/**
 * Sem quebra de linha nem NUL: o protocolo de gerência do openvpn é por linha,
 * e um `\n` na senha viraria um segundo comando.
 */
const semQuebra = "^[^\\r\\n\\u0000]*$";

/**
 * Conectar. A senha que o concentrador recebe é `senha + codigo`:
 *
 * - `codigo`: os dígitos do autenticador (TOTP). Sempre obrigatório — é o
 *   segundo fator, e nunca é guardado.
 * - `usuario` e `senha` (a parte fixa, o PIN; pode ser vazia em VPN só com
 *   TOTP): ausentes = usar os lembrados. Presentes = usar estes e, se
 *   `lembrar`, guardá-los cifrados depois que a VPN aceitar o login.
 */
export const VpnConectarRequest = t.Object({
  codigo: t.String({ pattern: "^[0-9]{6,8}$" }),
  usuario: t.Optional(t.String({ minLength: 1, maxLength: 128, pattern: semQuebra })),
  senha: t.Optional(t.String({ maxLength: 248, pattern: semQuebra })),
  lembrar: t.Optional(t.Boolean()),
});
export type VpnConectarRequest = Static<typeof VpnConectarRequest>;

export const VpnArquivoRequest = t.Object({
  /** Conteúdo do .ovpn. Validado por lista de diretivas permitidas no server. */
  ovpn: t.String({ minLength: 1, maxLength: 65_536 }),
});
export type VpnArquivoRequest = Static<typeof VpnArquivoRequest>;

/** Visão de admin: quem está com túnel aberto agora. Sem IP de destino. */
export const VpnTunelAtivo = t.Object({
  usuario: t.String(),
  perfil: t.String(),
  estado: VpnEstado,
});
export const VpnTuneisAtivos = t.Array(VpnTunelAtivo);
export type VpnTuneisAtivos = Static<typeof VpnTuneisAtivos>;
