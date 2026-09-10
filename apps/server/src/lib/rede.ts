/**
 * O que o servidor **não** pode alcançar quando a URL vem de fora.
 *
 * ## Por que existe um módulo só para isto
 *
 * Havia uma cópia dessa decisão dentro do `update.service.ts`, feita quando o
 * webhook de deploy era a única saída de rede por URL configurável. O libSQL
 * criou a segunda, e o achado #11 da auditoria foi exatamente essa: uma URL de
 * conexão apontando para `169.254.169.254` faria o servidor buscar o serviço de
 * metadado da nuvem. Duas cópias da mesma regra é uma que fica para trás.
 *
 * ## O que ele bloqueia, e o que deliberadamente não bloqueia
 *
 * Bloqueia **link-local e serviço de metadado de nuvem**: `169.254.0.0/16` (que
 * inclui o `169.254.169.254` de AWS, Azure, GCP e DigitalOcean), `fe80::/10`, o
 * `fd00:ec2::254` da AWS e os nomes `metadata.google.internal` / `metadata.goog`.
 * É o alvo que entrega credencial de instância a um GET sem autenticação
 * nenhuma — a diferença entre "o servidor faz uma requisição" e "o servidor
 * entrega as chaves da conta".
 *
 * **Não** bloqueia faixa privada. O DBee é self-hosted e o caso normal é
 * justamente o banco na rede privada do compose ou num `100.x` da tailnet;
 * bloquear `10/8`, `172.16/12`, `192.168/16` e `100.64/10` mataria o produto
 * para consertar um risco que o operador já tem por outros meios. Ver
 * `docs/DBee.md` §11.
 *
 * ## A diferença entre o webhook e a conexão
 *
 * No webhook a resposta é cega — o corpo nunca chega ao cliente — então o
 * alcance de um endereço mal escolhido é disparar, não ler. **Numa conexão de
 * banco o corpo é o resultado**, e é ele que a tela mostra. Por isso o caminho
 * da conexão precisa também de `redirect: "manual"`: sem isso um host legítimo
 * responde `302` para o metadado e o `fetch` refaz a requisição lá — levando o
 * cabeçalho `Authorization` junto — e devolve o corpo para a tela.
 */

const HOSTS_DE_METADADO: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "metadata.goog",
]);

/** `169.254.0.0/16`, `fe80::/10` e o `fd00:ec2::254` da AWS. */
export function ehLinkLocal(hostname: string): boolean {
  if (hostname.startsWith("169.254.")) return true;
  // Com ou sem colchetes: a URL traz IPv6 entre colchetes, o `hostname` do
  // `URL` já os remove, e quem chama com texto cru pode não ter removido.
  const semColchete = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return semColchete.startsWith("fe80:") || semColchete === "fd00:ec2::254";
}

/** O host é um serviço de metadado de nuvem (por nome ou por endereço)? */
export function ehMetadadoDeNuvem(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return HOSTS_DE_METADADO.has(host) || ehLinkLocal(host);
}
