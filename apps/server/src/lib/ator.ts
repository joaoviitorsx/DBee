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
}
