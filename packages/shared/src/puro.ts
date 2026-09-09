/**
 * O que o **navegador** importa do `shared`: lógica, sem TypeBox.
 *
 * ## Por que existe um segundo ponto de entrada
 *
 * O barril (`index.ts`) reexporta os 16 módulos, e 13 deles declaram schemas
 * com `t` da Elysia. `t` é runtime: quem toca o barril leva o TypeBox inteiro
 * para dentro do bundle, mesmo importando uma função de três linhas.
 *
 * Medido com `bun build --minify` a partir do próprio `apps/web`:
 *
 *   os 13 valores que o front usa, pelo barril .... 292.156 B  ·  79,8 kB gzip
 *   os mesmos, por módulos sem Elysia ................ 1.102 B  ·  0,48 kB gzip
 *
 * A diferença é TypeBox, e o front não valida nada — validação é do servidor
 * (as rotas declaram os schemas, e é lá que eles têm de estar). Trocar a origem
 * do import é o conserto inteiro; nenhuma função muda.
 *
 * **Tipo continua vindo do barril.** `import type` some na compilação, então
 * não custa byte nenhum, e obrigar o front a importar tipo de outro lugar seria
 * churn sem ganho.
 */

export * from "./ddl.puro";
export * from "./engine.puro";
export * from "./eden";
export * from "./export.puro";
export * from "./mutation.puro";
export * from "./split";
