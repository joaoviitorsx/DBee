/**
 * Mensagem de um erro do Eden, sem engolir o que o servidor disse (CLAUDE.md:
 * o erro do banco é informação útil). Sem corpo estruturado, cai no fallback.
 */
export function mensagemDeErro(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "value" in error) {
    const { value } = error;
    if (typeof value === "object" && value !== null && "message" in value && typeof value.message === "string") {
      return value.message;
    }
  }
  return fallback;
}
