# CLAUDE.md — DBee

Instruções para agentes trabalhando neste repo. Leia `docs/DBee.md` antes de qualquer tarefa: ele é a fonte da verdade sobre escopo, arquitetura e decisões.

## O que é

Cliente PostgreSQL web self-hosted, usado em produção pelo autor no trabalho diário. **Isso não é um projeto de brinquedo** — bug aqui vira trabalho parado. Prefira correto e chato a esperto e frágil.

Stack: **Bun + Elysia + React**. Não é Node, não é Express, não é Fastify. Não sugira equivalentes de Node quando existir primitiva nativa do Bun.

## Comandos

```bash
bun install
bun run dev              # server :3001 + web :5173
bun test
bun run typecheck        # tsc --noEmit no workspace
bun run lint
bun run build            # web (Vite) + server (bun build --compile)
docker build -t dbee .
```

## Regras não negociáveis

1. **TypeScript strict.** Nada de `any`. Se o tipo está difícil, o desenho está errado.
2. **Validação com TypeBox (`t` do Elysia)** nas rotas, com os schemas em `packages/shared`. Não introduzir Zod — quebraria Eden e OpenAPI.
3. **Primitivas do Bun antes de dependência externa:** `bun:sqlite`, `Bun.password`, `Bun.file`, `bun test`. Só instale pacote se o Bun não resolver.
4. **Nada de módulo nativo no backend.** Quebra `bun build --compile`.
5. **Nunca logar nem retornar credencial.** Nem em erro, nem em debug, nem em exceção.
6. **Nunca conectar no PgBouncer (6432).** Sempre 5432 direto.
7. **Streaming é `DECLARE CURSOR` em SQL, com `FETCH` em lotes.** Não trazer `pg-cursor` nem `pg-query-stream`. `FETCH n` materializa n linhas na memória — export sempre em laço. Ver §6.
8. **Nunca validar SQL do usuário com regex ou parser.** A proteção de escrita é o modo da transação: `BEGIN READ ONLY` (ou `BEGIN READ WRITE` no modo escrita), declarado no próprio `BEGIN`. **`SET LOCAL default_transaction_read_only` não protege a transação corrente** — se aparecer no código, é regressão de segurança. Ver §6 e §11.4b.
9. **Nunca montar o socket do Docker** no container do app.
10. **Todo valor de célula trafega como string.** Não confie na conversão automática de tipos do driver.
11. **Grid sempre virtualizado.** Nenhum `.map()` direto sobre linhas de resultado.

## Ao escrever código

- Rotas Elysia: um plugin por domínio em `apps/server/src/routes/`, compostos na instância principal. Use `.derive()` para contexto (sessão, conexão resolvida) em vez de repetir lookup em cada handler.
- O front consome a API por **Eden Treaty**, tipado a partir do tipo exportado do server. Não escreva client HTTP manual nem duplique tipos de resposta.
- Acesso ao SQLite só via repositórios em `apps/server/src/db/` — nada de SQL espalhado por rota. Use statements preparados do `bun:sqlite`.
- Erro de banco vira resposta com `code`, `message` e, quando existir, `position`, para a UI destacar no editor. Não engolir o erro do Postgres: ele é informação útil pro usuário.
- Componente novo no front: shadcn/ui primeiro, componente próprio só se não existir.
- Nada de CDN em runtime. Tudo bundlado.

## Ao terminar uma tarefa

1. `bun run typecheck && bun run lint && bun test` — tem que passar.
2. Atualizar `CHANGELOG.md` se mudou comportamento visível.
3. Se a mudança contradiz algo em `docs/DBee.md`, atualizar o doc na mesma alteração. Doc desatualizado é pior que doc ausente.
4. Decisão de arquitetura que alguém questionaria depois → `docs/adr/NNN-titulo.md`.

## O que não fazer sem perguntar

- Adicionar dependência nova de peso (ORM, framework alternativo, biblioteca de UI concorrente).
- Trocar TypeBox por outro validador.
- Mudar o modelo de dados do SQLite sem migration.
- Introduzir serviço adicional no compose — o princípio "um container" é deliberado.
- Ampliar escopo além do roadmap da fase atual. Ideia boa fora de escopo vai para `ATRITO.md`, não para o código.
