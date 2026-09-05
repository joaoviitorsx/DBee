# ADR 007 — Sessão por cookie, com o guard em `onRequest`

**Data:** 2026-09-05
**Estado:** aceita

## Contexto

A v0.1 fecha com autenticação de identidade real (`DBee.md` §7). A razão não é
proteger a porta — o DBee roda atrás da tailnet — e sim o `actor` do
`query_log`: um log de auditoria cujo `actor` é a mesma string para todo mundo
dá aparência de controle sem controle, e em contexto contábil isso é pior que
não ter log (§2.4).

Três decisões dentro disso mereciam registro.

## Decisão 1 — Cookie `httpOnly` + `SameSite=Strict` + `Secure`, não token no `localStorage`

Token em `localStorage` é legível por qualquer JavaScript da página: um XSS
rouba a sessão inteira. `httpOnly` tira o token do alcance do script.
`SameSite=Strict` faz o cookie não viajar em requisição vinda de outro site, o
que **dispensa token de CSRF** nas rotas com efeito — uma peça a menos para
errar.

`Secure` fica ligado sempre, inclusive em desenvolvimento: os navegadores
tratam `http://localhost` como origem confiável e aceitam cookie `Secure` ali.
**Conferido no Chrome headless**, não presumido — o cookie é setado, some do
`document.cookie` (é `httpOnly`) e volta nas requisições seguintes.

### Consequência

Não há como um cliente que não seja o navegador guardar a sessão sem lidar com
cookies. Para uma CLI futura, isso vai exigir outro mecanismo — token de API
com escopo próprio, não a mesma sessão.

## Decisão 2 — O guard roda em `onRequest`, antes de o corpo ser lido

A ordem dos hooks do Elysia 1.4.30, **medida**:

    onRequest → onParse → onTransform → derive → validação → onBeforeHandle

Com o guard em `onBeforeHandle` — o lugar óbvio — uma requisição **sem sessão**
e com corpo inválido recebia 422 em vez de 401. O status é o menor problema: o
corpo do atacante foi lido, parseado e validado por TypeBox **antes de qualquer
autenticação**. O `sql` do export aceita 1 MB, então isso era `JSON.parse` mais
validação de 1 MB abertos a quem alcançasse a porta.

Em `onRequest` a requisição sem sessão morre antes do parse. O preço é ler o
cookie do cabeçalho cru, porque nesse estágio o Elysia ainda não parseou
cookies — vinte linhas, e elas estão testadas.

### Consequência

O guard não conhece parâmetros de rota. Ele decide por `método + pathname`, e a
lista de rotas abertas (`ROTAS_ABERTAS`) é literal. Uma rota aberta com
parâmetro exigiria mudar essa forma — e essa mudança deve ser barrada na
revisão, porque casar padrão numa lista de exceção de autenticação é como se
constrói um bypass sem querer.

## Decisão 3 — A tabela guarda o SHA-256 do token, não o token

Se o arquivo SQLite vazar — backup, volume montado errado, cópia para depurar —
o conteúdo de `sessions` não pode servir como cookie. Guardar o hash resolve.

**SHA-256 basta**, e argon2id seria errado aqui: o token tem 256 bits de
aleatoriedade, então não existe ataque de dicionário contra ele, e argon2id
custaria ~180 ms **por requisição autenticada** para proteger contra um ataque
que não existe. argon2id é para senha de gente, que tem entropia baixa.

### Consequência

Não há como listar sessões e mostrar o token a quem está logado — o servidor não
o tem mais. Se um dia houver uma tela de "dispositivos conectados", ela vai
mostrar metadados (criada em, expira em), nunca o token.

## Alternativas descartadas

- **JWT sem estado.** Logout de verdade exigiria uma lista de revogação, que é
  estado — só que espalhado e com o pior desfecho possível: o token continua
  válido até expirar se a lista falhar. O `DBee.md` §7 exige que o logout
  invalide no servidor, e uma tabela de sessões faz isso sem cerimônia.
- **`ADMIN_PASSWORD` como senha do primeiro usuário.** Estava previsto no §7 e
  não foi implementado: senha em variável de ambiente fica no compose, no
  histórico do shell e na tela de configuração do Dokploy. A senha aleatória
  impressa uma vez com troca obrigatória cobre o mesmo caso sem nenhum desses
  lugares.
- **Guard por rota, em vez de global.** Depende de alguém lembrar de aplicá-lo
  na próxima rota. A de export é a prova: devolve `Response` cru com stream, não
  passa pela serialização normal, e é a mais fácil de esquecer justamente por
  ser diferente. O `guard.test.ts` varre `app.routes` e falha sozinho quando uma
  rota nova aparece sem cobertura.
