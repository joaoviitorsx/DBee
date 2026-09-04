/// <reference types="vite/client" />

/** Injetada pelo `define` do Vite a partir do package.json da raiz. */
declare const __APP_VERSION__: string;

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
