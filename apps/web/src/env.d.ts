/// <reference types="vite/client" />

/**
 * O Eden Treaty importa o TIPO da app do server, o que faz o tsc do web
 * atravessar o fonte de apps/server — inclusive as migrations importadas como
 * texto. Sem esta declaração o typecheck do web quebra num arquivo que não é
 * dele.
 */
declare module "*.sql" {
  const content: string;
  export default content;
}
