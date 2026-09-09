# Operar o DBee

Guia de quem sobe e mantém o container. O [README](../README.md) cobre o
caminho curto; aqui está o detalhe que só importa na hora de operar.

## Deploy no Dokploy

Serviço com provider Git apontando para este repo, branch `main`, Compose Path
`deploy/docker-compose.yml`, trigger On Push. O GitHub App do Dokploy precisa de
acesso explícito a este repo. Defina `APP_SECRET` nos secrets do serviço.
Para criar a primeira conta, leia o token de `/data/setup-token` pelo terminal do
serviço no painel do Dokploy (`cat /data/setup-token`) e informe-o na tela de
primeiro acesso.

A imagem é **amd64** (`bun build --target bun-linux-x64`) — o host do Dokploy
precisa ser amd64. Numa VM arm64 o container não sobe.

### Checklist antes de apertar o deploy

Prepare tudo isto **antes** do primeiro deploy — cada item que faltar aparece
como uma falha diferente e obscura:

**Segredos a gerar**
- [ ] `APP_SECRET` — `openssl rand -hex 32`, guardado nos secrets do serviço no
  Dokploy (não em `.env` versionado). É o que cifra as senhas das conexões;
  perdê-lo é irreversível.

**Acessos a conceder**
- [ ] GitHub App do Dokploy com acesso **explícito** a `joaoviitorsx/Dbee` (o
  acesso amplo à conta não basta — conecte o repo no serviço).
- [ ] Credencial de registry no Dokploy para puxar do GHCR: o pacote nasce
  **privado**. Ou um PAT com `read:packages` configurado como registry credential
  no Dokploy, **ou** tornar o pacote público em `github.com/users/joaoviitorsx/
  packages` depois do primeiro publish. Sem isso o pull falha com "denied" — e o
  erro não diz que é permissão de pacote.

**Valores a preencher no painel**
- [ ] `APP_SECRET` no serviço (secret).
- [ ] Domínio/rota do serviço apontando a **porta interna 3001** (ou as labels de
  Traefik do compose — não as duas).
- [ ] Volume nomeado `dbee-data` persistido (já no compose; confirmar que o
  Dokploy não recria sem ele — perder `/data` = perder as conexões).

**Rede**
- [ ] `dokploy-network` externa existe (padrão do Dokploy).
- [ ] Restrição de porta pela tailnet, se publicar porta em vez de usar o Traefik
  (ver Segurança, padrão `DOCKER-USER`).

**Primeira vez que a tag roda o CI**
- [ ] A imagem só é publicada ao empurrar uma tag `vX.Y.Z` (o workflow dispara em
  `v*`). O nome publicado é `ghcr.io/joaoviitorsx/dbee` (o
  `docker/metadata-action` normaliza `github.repository` para minúsculas) — é
  exatamente o que o compose consome.
- [ ] Depois do primeiro publish, conferir que o pacote existe em GHCR e aplicar
  a credencial/visibilidade do item acima antes de mandar o Dokploy puxar.

## Segurança

O app **não é exposto à internet**. Roda como usuário não-root (uid 10001), sem
socket do Docker montado. Duas formas de acesso, nunca uma porta pública:

**1. Via Traefik do Dokploy (preferido).** Sem porta publicada; o Traefik alcança
o container pela `dokploy-network` e o domínio é configurado na UI do serviço
apontando a porta interna `3001`. É o que o `deploy/docker-compose.yml` assume.

**2. Porta bindada no IP da tailnet + `DOCKER-USER`.** Se publicar a porta em vez
de usar o Traefik, **bind no IP `100.x` do Tailscale**, nunca em `0.0.0.0`:

```yaml
    ports:
      - "100.x.y.z:3001:3001"   # só o IP da tailnet, nunca 0.0.0.0
```

O bind por si só não basta: o Docker escreve regras de NAT que **furam o UFW**, e
uma publicação em `0.0.0.0` por engano ficaria aberta. O cinto e suspensório é o
mesmo padrão `DOCKER-USER` já aplicado na 3000 e na 15672 — só a interface da
tailnet alcança a 3001, o resto é dropado **antes** do NAT do Docker:

```bash
# Ordem importa: -I insere no topo, então o ACCEPT (inserido por último) fica
# ACIMA do DROP. Tráfego que entra pela tailscale0 é aceito; todo o resto cai.
iptables -I DOCKER-USER -p tcp --dport 3001 -j DROP
iptables -I DOCKER-USER -i tailscale0 -p tcp --dport 3001 -j ACCEPT
```

Persista as regras como já faz para as outras portas (o mesmo `iptables-restore`
/ unit que mantém as regras da 3000 e da 15672). Confirmar depois: de fora da
tailnet, a 3001 não responde; de dentro, sim.
