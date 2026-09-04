/** `import ... with { type: "text" }` das migrations — embutido pelo bun build. */
declare module "*.sql" {
  const content: string;
  export default content;
}
