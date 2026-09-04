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

- Base local: migrations do `bun:sqlite` aplicadas no boot, cifra AES-256-GCM das senhas
  com chave scrypt derivada uma vez no boot (salt de 32 B em `app_meta`), CRUD de conexões
  e teste de conexão via `BEGIN READ ONLY`.
- `ssl_mode` reduzido a três modos sem negociação, ADR
  [003](docs/adr/003-modos-de-ssl.md).
- Design system derivado de `assets/` — tokens, movimento e regras em
  [docs/design-system.md](docs/design-system.md), contraste travado por teste.
- Tela de conexões: lista densa com tag de risco, painel lateral de cadastro, esqueleto de
  carregamento e a marca animada como estado de espera.
- Arquitetura em camadas documentada em [docs/arquitetura.md](docs/arquitetura.md).

### Alterado
- `CLAUDE.md` movido de `docs/` para a raiz do repo, onde ferramentas de agente o carregam
  por convenção.
- ESLint passa a rodar `eslint-plugin-react-hooks` sobre `apps/web`.

### Corrigido
- `DBee.md` §6: a receita de sessão read-only usava `SET LOCAL default_transaction_read_only = on`
  dentro de um `BEGIN` já aberto, o que **não** torna a transação read-only — `UPDATE`, `DELETE`,
  `TRUNCATE` e DDL passavam. Substituída por `BEGIN READ ONLY`. Ver §11.4b.
