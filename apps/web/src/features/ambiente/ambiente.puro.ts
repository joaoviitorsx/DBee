/**
 * O nome digitado confere com o da conexão? A mesma comparação que o servidor
 * faz no `apply` (ADR 022): texto exato. Maiúscula e espaço importam — afrouxar
 * aqui faria o botão armar e o servidor recusar com `confirmation_required`.
 */
export function confirmacaoConfere(digitado: string, nome: string): boolean {
  return nome !== "" && digitado === nome;
}
