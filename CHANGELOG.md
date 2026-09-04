# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) · versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- Scaffold do monorepo com Bun workspaces: `apps/server` (Elysia), `apps/web` (React + Vite), `packages/shared`.
- `GET /api/health` respondendo 200.
- TypeScript strict em todo o workspace, ESLint com regras type-aware, `bun test`.
- Dockerfile multi-stage sobre `oven/bun` com `bun build --compile`, runtime `debian-slim`.
- `deploy/docker-compose.yml` para o Dokploy.
- GitHub Actions publicando no GHCR a cada tag `v*`.
- Spike de validação do `pg` + `DECLARE CURSOR` sob Bun em `scratch/spike-cursor.ts`.
- `dbee --healthcheck`: o binário compilado faz o próprio healthcheck com `fetch` nativo,
  o que tirou o `curl` da imagem final (260 MB).
- ADR [001](docs/adr/001-modo-read-only-por-transacao.md) (modo read-only por transação) e
  [002](docs/adr/002-typescript-pinado-em-5-9.md) (TypeScript pinado em 5.9.3).

### Alterado
- `CLAUDE.md` movido de `docs/` para a raiz do repo, onde ferramentas de agente o carregam
  por convenção.
- ESLint passa a rodar `eslint-plugin-react-hooks` sobre `apps/web`.

### Corrigido
- `DBee.md` §6: a receita de sessão read-only usava `SET LOCAL default_transaction_read_only = on`
  dentro de um `BEGIN` já aberto, o que **não** torna a transação read-only — `UPDATE`, `DELETE`,
  `TRUNCATE` e DDL passavam. Substituída por `BEGIN READ ONLY`. Ver §11.4b.
