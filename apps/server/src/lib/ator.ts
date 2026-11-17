import type { Role } from "@dbee/shared";

/**
 * Quem está agindo.
 *
 * Era só o `id`, string, porque o único uso era o `actor` do `query_log`. Com
 * permissão por conexão (migração 005) o papel passou a decidir **o que a
 * pessoa enxerga**, e um `string` não carrega isso — quem resolvesse a conexão
 * teria de consultar o usuário de novo, ou receber o papel por um segundo
 * parâmetro que alguém esqueceria de passar.
 *
 * Trocar o tipo em vez de acrescentar um parâmetro é deliberado: o `typecheck`
 * aponta **todos** os pontos que resolvem conexão, e nenhum caminho pode ficar
 * para trás em silêncio. Foi essa a garantia que motivou a mudança.
 */
export interface Ator {
  readonly id: string;
  readonly role: Role;
  /**
   * Por onde a ação chegou, quando não foi pela UI. Hoje só o MCP (ADR 015):
   * `mcp:<nome do token>`. Ausente = sessão de navegador.
   */
  readonly origem?: string;
}

/**
 * O `actor` gravado no `query_log`.
 *
 * Sem origem, o id do usuário — o formato de sempre. Com origem,
 * `<id>#<origem>`: o id continua à frente (quem fez), e a origem diz por qual
 * porta. Sem migração no `query_log`, e o filtro por prefixo do id ainda acha.
 */
export function atorDoLog(ator: Ator): string {
  return ator.origem === undefined ? ator.id : `${ator.id}#${ator.origem}`;
}
