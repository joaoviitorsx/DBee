# DBee

Cliente PostgreSQL web, self-hosted, para uso diário em produção. Bun + Elysia +
React, um único container.

Especificação completa em [`docs/DBee.md`](docs/DBee.md). Instruções para agentes
em [`CLAUDE.md`](CLAUDE.md).

O que faz hoje: autenticação com sessão, CRUD de conexões com senha cifrada,
árvore de schema navegável, editor SQL com autocomplete e execução read-only,
grid virtualizado com paginação por keyset, export CSV/JSON/NDJSON em stream,
diagrama ERD, histórico de queries. Read-only por padrão — escrita é opt-in por
execução.

## Instalar e rodar

O DBee sobe como um container. O caminho abaixo é para um servidor próprio com
Docker; para o Dokploy, veja a seção seguinte.

### 1. Gere o `APP_SECRET`

Ele deriva a chave que cifra as senhas das conexões. **Gere uma vez e guarde
num gerenciador de segredos** — perdê-lo torna as conexões ilegíveis (ver o
aviso abaixo).

```bash
openssl rand -hex 32
```

### 2. Puxe a imagem

A imagem é publicada no GHCR a cada tag, e o **pacote é privado**: é preciso
autenticar antes do pull, com um Personal Access Token do GitHub com escopo
`read:packages`.

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u joaoviitorsx --password-stdin
docker pull ghcr.io/joaoviitorsx/dbee:latest
```

### 3. Suba

```bash
docker run -d --name dbee \
  -e APP_SECRET="<o hex de 32 bytes do passo 1>" \
  -v dbee-data:/data \
  ghcr.io/joaoviitorsx/dbee:latest
```

Sem `-p`: o DBee **não deve** ter porta publicada na internet (ver Segurança). O
acesso é pela tailnet ou por um proxy interno.

### 4. Pegue a senha do primeiro acesso

No primeiro boot o DBee cria o usuário `admin` e imprime a senha **uma vez** no
log. Pegue-a:

```bash
docker logs dbee | grep -A6 "PRIMEIRO ACESSO"
```

### 5. Acesse e troque a senha

Abra o DBee pelo IP da tailnet (`http://100.x.y.z:3001`) ou pelo proxy. Entre com
`admin` e a senha do log — a troca é **obrigatória** no primeiro acesso, porque a
senha esteve no log do container.

## Deploy no Dokploy

Serviço com provider Git apontando para este repo, branch `main`, Compose Path
`deploy/docker-compose.yml`, trigger On Push. O GitHub App do Dokploy precisa de
acesso explícito ao repo (é privado). Defina `APP_SECRET` nos secrets do serviço.
A senha do primeiro acesso aparece no log do serviço, no painel do Dokploy. Ver
`DBee.md` §8.

## Variáveis de ambiente

| Variável | Obrigatória | Para quê |
|---|---|---|
| `APP_SECRET` | **sim, em produção** | Deriva a chave AES-256-GCM que cifra as senhas das conexões. O boot **aborta** se faltar com `NODE_ENV=production`. Em dev usa um segredo fixo e avisa alto. |
| `DBEE_DATA_DIR` | não | Onde ficam o SQLite e o salt de cifra. Default `/data` no container. **Precisa de volume persistente** (ver aviso). |
| `PORT` | não | Porta do servidor. Default `3001`. Valor inválido aborta o boot. |
| `DBEE_CA_CERT` | não | CA em PEM para `sslmode=verify-full` contra um CA privado. Vazio é tratado como ausente (não zera o CA store do sistema). |

> **Não existem `ADMIN_PASSWORD` nem `DOKPLOY_DEPLOY_WEBHOOK`.** Versões antigas
> deste README as citavam; o código não as lê. A senha do admin é **sempre**
> gerada no primeiro boot e vai ao log (passo 4). A atualização por webhook e o
> badge de versão são planejados (`DBee.md` §8), ainda não implementados — hoje
> se atualiza publicando uma tag e re-deployando.

> ### ⚠️ Perder o `APP_SECRET` **ou** o volume `/data` = conexões perdidas
>
> As senhas das conexões são cifradas com uma chave derivada do `APP_SECRET` e
> de um salt que vive **dentro do SQLite** (em `DBEE_DATA_DIR`, o volume
> `/data`). São **dois** pontos únicos de falha:
>
> - **`APP_SECRET` mudou ou se perdeu** → as conexões ficam ilegíveis em
>   definitivo.
> - **o volume `/data` se perdeu** (recriar o container sem volume nomeado, por
>   exemplo) → perde o salt e o banco: mesmo efeito, mesmo com o `APP_SECRET`
>   certo.
>
> Guarde o `APP_SECRET` no gerenciamento de segredos e **declare o volume**.
> Não há recuperação — só recadastrar tudo. Ver `DBee.md` §7 e §11.5.

## Desenvolvimento

```bash
bun install
bun run dev          # server :3001 + web :5173
bun run typecheck
bun run lint
bun test
bun run build        # web (Vite) + binário do server (bun build --compile)
```

## Container, local

```bash
docker build -t dbee .
docker run --rm -e APP_SECRET="$(openssl rand -hex 32)" -v dbee-data:/data dbee
docker logs <container> | grep -A6 "PRIMEIRO ACESSO"   # senha do admin
```

## Segurança

O app **não é exposto à internet**. Sem porta publicada no compose: o acesso é
via Traefik do Dokploy com a regra da tailnet, ou porta bindada no IP `100.x` do
Tailscale. Roda como usuário não-root, sem socket do Docker montado. Ver
`DBee.md` §7.

## Processo

- Fricção do uso real vai para [`ATRITO.md`](ATRITO.md), na hora que doeu.
- Decisão de arquitetura vira ADR em [`docs/adr/`](docs/adr/README.md).
