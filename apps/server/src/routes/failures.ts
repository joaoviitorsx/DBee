import type {
  AuthFailure,
  MutationFailure,
  ServiceFailure,
  UserFailure,
} from "../services/result";
import type { VpnFailure } from "../services/vpn.service";
import type { EnsaioFailure } from "../services/ensaio.service";
import type { SavedQueryFailure } from "../services/savedQueries.service";

/** Único ponto que traduz falha de domínio em status HTTP. */
export const FAILURES: Readonly<
  Record<ServiceFailure, { status: 400 | 404 | 500 | 502; body: { code: string; message: string } }>
> = {
  not_found: {
    status: 404,
    body: { code: "connection_not_found", message: "conexão não encontrada" },
  },
  decryption_failed: {
    status: 500,
    body: {
      code: "decryption_failed",
      message:
        "não foi possível decifrar a senha desta conexão — APP_SECRET pode ter mudado (ver DBee.md §11.5)",
    },
  },
  vpn_disconnected: {
    status: 502,
    body: { code: "vpn_disconnected", message: "sua VPN deste banco não está conectada — conecte-a no escudo da barra superior" },
  },
  bad_request: {
    status: 400,
    body: { code: "bad_request", message: "entrada inválida" },
  },
  engine_not_implemented: {
    status: 400,
    body: {
      code: "engine_not_implemented",
      message: "o DBee ainda não fala esta engine",
    },
  },
  upstream_error: {
    status: 502,
    body: { code: "upstream_error", message: "o banco não respondeu" },
  },
};

/**
 * Falhas de autenticação → status. Mapa separado pela mesma razão do tipo:
 * só as rotas de auth e o guard podem produzir estes status.
 */
/**
 * `as const satisfies` em vez de anotar o tipo: anotar alarga o `status` de
 * cada entrada para a união inteira, e aí `AUTH_FAILURES.unauthenticated.status`
 * passa a ser `401 | 403 | 429`. A rota `/me`, que só pode devolver 401, teria
 * de declarar 429 no `response` — declarar uma resposta impossível.
 */
export const AUTH_FAILURES = {
  setup_done: {
    status: 409,
    // Já há conta: o modo setup fechou. O front cai para a tela de login.
    body: { code: "setup_done", message: "o setup já foi concluído — faça login" },
  },
  invalid_token: {
    status: 401,
    body: { code: "invalid_token", message: "token de setup inválido" },
  },
  unauthenticated: {
    status: 401,
    body: { code: "unauthenticated", message: "faça login para continuar" },
  },
  password_change_required: {
    status: 403,
    body: {
      code: "password_change_required",
      message: "troque a senha antes de continuar",
    },
  },
  invalid_credentials: {
    status: 401,
    // Uma mensagem só para usuário inexistente e para senha errada. Distinguir
    // as duas entrega ao atacante a lista de quem existe (DBee.md §7).
    body: { code: "invalid_credentials", message: "usuário ou senha inválidos" },
  },
  rate_limited: {
    status: 429,
    body: { code: "rate_limited", message: "tentativas demais — espere um pouco" },
  },
} as const satisfies Record<
  AuthFailure,
  { status: 401 | 403 | 409 | 429; body: { code: string; message: string } }
>;

/**
 * Falhas da edição de linha → status. Separadas de `FAILURES` pela mesma razão
 * de `AUTH_FAILURES`: `409` e `403` só nascem na rota de mutação, e só ela
 * declara esses status no `response`.
 */
export const MUTATION_FAILURES = {
  not_found: {
    status: 404,
    body: { code: "connection_not_found", message: "conexão não encontrada" },
  },
  decryption_failed: {
    status: 500,
    body: { code: "decryption_failed", message: "não foi possível decifrar a senha desta conexão" },
  },
  upstream_error: {
    status: 502,
    body: { code: "upstream_error", message: "o banco não respondeu" },
  },
  vpn_disconnected: {
    status: 502,
    body: { code: "vpn_disconnected", message: "sua VPN deste banco não está conectada — conecte-a no escudo da barra superior" },
  },
  write_forbidden: {
    status: 403,
    body: {
      code: "write_forbidden",
      message: "escrita não habilitada nesta conexão",
    },
  },
  row_changed: {
    status: 409,
    body: {
      code: "row_changed",
      message: "a linha mudou desde que você a leu — releia e tente de novo",
    },
  },
  ambiguous_row: {
    status: 409,
    body: {
      code: "ambiguous_row",
      message: "a condição casaria mais de uma linha — nada foi alterado",
    },
  },
  not_primary_key: {
    status: 409,
    body: {
      code: "not_primary_key",
      message:
        "a edição de linha exige a chave primária completa da tabela — sem PK, use o editor de SQL",
    },
  },
} as const satisfies Record<
  MutationFailure,
  { status: 403 | 404 | 409 | 500 | 502; body: { code: string; message: string } }
>;

/**
 * Falhas da administração de contas → status.
 *
 * `admin_required` é 403 e **não** 404: quem tem sessão válida sabe que a rota
 * existe (o front dela é servido pelo mesmo binário), então esconder o status
 * não esconderia nada e só tornaria o erro mais difícil de diagnosticar.
 */
export const USER_FAILURES = {
  admin_required: {
    status: 403,
    body: { code: "admin_required", message: "só um administrador pode fazer isso" },
  },
  user_not_found: {
    status: 404,
    body: { code: "user_not_found", message: "usuário não encontrado" },
  },
  username_taken: {
    status: 409,
    body: { code: "username_taken", message: "já existe uma conta com esse nome" },
  },
  last_admin: {
    status: 409,
    body: {
      code: "last_admin",
      message: "esta é a última conta de administrador — promova outra antes",
    },
  },
  self_target: {
    status: 409,
    body: { code: "self_target", message: "não dá para fazer isso com a própria conta" },
  },
} as const satisfies Record<
  UserFailure,
  { status: 403 | 404 | 409; body: { code: string; message: string } }
>;

/**
 * VPN por pessoa (ADR 014). Nenhuma mensagem cita host, porta, usuário da VPN
 * ou conteúdo do .ovpn.
 */
export const VPN_FAILURES = {
  admin_required: {
    status: 403,
    body: { code: "admin_required", message: "só um administrador pode ver os túneis de todos" },
  },
  vpn_desligada: {
    status: 404,
    body: { code: "vpn_disabled", message: "VPN não configurada neste servidor" },
  },
  perfil_desconhecido: {
    status: 404,
    body: { code: "vpn_profile_not_found", message: "perfil de VPN não configurado" },
  },
  sem_arquivo: {
    status: 409,
    body: { code: "vpn_no_file", message: "envie o seu arquivo .ovpn deste perfil antes de conectar" },
  },
  sem_credencial: {
    status: 409,
    body: { code: "vpn_no_credential", message: "informe usuário e senha da VPN — nada está lembrado para este perfil" },
  },
  arquivo_ilegivel: {
    status: 500,
    body: { code: "vpn_file_unreadable", message: "não foi possível decifrar o .ovpn — envie de novo" },
  },
  ovpn_invalido: {
    status: 422,
    body: { code: "vpn_file_invalid", message: "o arquivo .ovpn tem diretiva não permitida" },
  },
  credencial_recusada: {
    status: 422,
    body: { code: "vpn_auth_failed", message: "a VPN recusou usuário ou senha/código" },
  },
  inacessivel: {
    status: 502,
    body: { code: "vpn_unreachable", message: "o serviço de VPN não respondeu" },
  },
  tempo_esgotado: {
    status: 504,
    body: { code: "vpn_timeout", message: "a VPN não conectou dentro do prazo" },
  },
} as const satisfies Record<
  "admin_required" | VpnFailure,
  { status: 403 | 404 | 409 | 422 | 500 | 502 | 504; body: { code: string; message: string } }
>;

/**
 * Queries salvas (ADR 016). `not_found` cobre "não existe" e "não é visível
 * para você" — mesma indistinção do `resolve` de conexão. `forbidden` só
 * aparece para quem **vê** a query (do time) mas não é dono nem admin: aí a
 * existência já é conhecida, e 403 diz a verdade.
 */
export const SAVED_QUERY_FAILURES = {
  not_found: {
    status: 404,
    body: { code: "saved_query_not_found", message: "query salva não encontrada" },
  },
  connection_not_found: {
    status: 404,
    body: { code: "connection_not_found", message: "conexão não encontrada" },
  },
  forbidden: {
    status: 403,
    body: { code: "saved_query_forbidden", message: "só o dono da query ou um administrador pode alterá-la" },
  },
} as const satisfies Record<
  SavedQueryFailure,
  { status: 403 | 404; body: { code: string; message: string } }
>;

/**
 * Falhas do ensaio de escrita (ADR 021) → status. Mapa próprio pela mesma razão
 * dos outros: 403/409 daqui só nascem nas rotas de ensaio e aplicação.
 */
export const ENSAIO_FAILURES = {
  ...FAILURES,
  write_forbidden: {
    status: 403,
    body: {
      code: "write_forbidden",
      message: "esta conexão não permite escrita para você — o ensaio só existe onde a escrita existe",
    },
  },
  dry_run_mismatch: {
    status: 409,
    body: {
      code: "dry_run_mismatch",
      message: "nada foi gravado — o número de linhas afetadas mudou desde o ensaio",
    },
  },
  confirmation_required: {
    status: 400,
    body: {
      code: "confirmation_required",
      message: "conexão de produção: digite o nome da conexão para confirmar a aplicação",
    },
  },
} as const satisfies Record<
  EnsaioFailure,
  { status: 400 | 403 | 404 | 409 | 500 | 502; body: { code: string; message: string } }
>;
