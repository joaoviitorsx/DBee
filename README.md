# DBee

Cliente PostgreSQL web, self-hosted, para uso diário em produção.

Especificação completa em [`docs/DBee.md`](docs/DBee.md). Instruções para agentes
em [`docs/CLAUDE.md`](docs/CLAUDE.md).

> **Status:** v0.1 em construção. O que existe hoje é o esqueleto — server com
> `GET /api/health`, front com uma tela. Sem autenticação, sem conexões, sem editor.

## Desenvolvimento

```bash
bun install
bun run dev          # server :3001 + web :5173
bun run typecheck
bun run lint
bun test
bun run build        # web (Vite) + binário do server (bun build --compile)
```

## Container

```bash
docker build -t dbee .
docker run --rm -p 3001:3001 dbee
curl http://127.0.0.1:3001/api/health
```

Deploy no Dokploy: Compose Path `deploy/docker-compose.yml`, provider Git,
branch `main`, trigger On Push. Ver `DBee.md` §8.

## Variáveis de ambiente

| Variável | Obrigatória | Para quê |
|---|---|---|
| `APP_SECRET` | sim (a partir do CRUD de conexões) | Deriva a chave AES-256-GCM que cifra as senhas das conexões |
| `ADMIN_PASSWORD` | não | Senha de acesso. Sem ela, o app gera uma no primeiro boot e imprime no log uma única vez |
| `DOKPLOY_DEPLOY_WEBHOOK` | não | Habilita o botão "Atualizar" |
| `PORT` | não | Default `3001` |

> ### ⚠️ `APP_SECRET` perdido = conexões perdidas
>
> As senhas das conexões são cifradas com uma chave derivada de `APP_SECRET`.
> **Se `APP_SECRET` mudar ou se perder, todas as conexões salvas ficam ilegíveis
> em definitivo** — não há recuperação, só recadastrar tudo à mão.
>
> Guarde no gerenciamento de segredos do Dokploy, não apenas num `.env` local.
> Ver `DBee.md` §7 e §11.5.

## Segurança

O app **não é exposto à internet**. Sem porta publicada no compose: o acesso é
via Traefik do Dokploy com a regra da tailnet, ou porta bindada no IP `100.x` do
Tailscale. Ver `DBee.md` §7.

## Processo

- Fricção do uso real vai para [`ATRITO.md`](ATRITO.md), na hora que doeu.
- Decisão de arquitetura vira ADR em [`docs/adr/`](docs/adr/README.md).
- Mudança de comportamento visível entra no [`CHANGELOG.md`](CHANGELOG.md).
- Conventional Commits, `main` protegida, trabalho em `feat/*` e `fix/*`.
