# 003. `ssl_mode` com três modos, sem fallback silencioso

- **Status:** aceito
- **Data:** 2026-09-04

## Contexto

O `DBee.md` §4 previa `ssl_mode` com os cinco valores do `libpq` — `disable`,
`allow`, `prefer`, `require`, `verify-full` — e default `prefer`. É a lista que
todo mundo copia porque é a que o `psql` e as strings de conexão usam.

Dois problemas apareceram ao mapear isso para o driver.

**O `pg` não implementa `prefer` nem `allow`.** Ele aceita `ssl: boolean | tls.ConnectionOptions`
e nada mais. Os dois modos ausentes são justamente os que negociam: `prefer`
tenta TLS e cai para texto claro se o servidor recusar; `allow` faz o inverso.
Implementá-los exigiria abrir a conexão, detectar a recusa e reconectar sem TLS.

**Esse fallback é o comportamento perigoso, não uma conveniência.** Uma conexão
`prefer` que caiu para texto claro é indistinguível, para o usuário, de uma que
subiu com TLS. A ferramenta mostra "prefer" na tela nos dois casos. O usuário
acredita estar protegido e não está — e é exatamente na rede onde o TLS falhou
que ele mais precisaria saber. Um atacante em posição de MITM não precisa quebrar
TLS: basta recusar o `SSLRequest` e o cliente entrega tudo em claro, sozinho.

O `pg` não ter isso nativamente é sinal, não obstáculo.

## Decisão

**Três modos. Nenhum negocia.**

| `ssl_mode` | config passada ao `pg` | o que garante |
|---|---|---|
| `disable` | `ssl: false` | nada — texto claro, e o usuário sabe disso |
| `require` | `ssl: { rejectUnauthorized: false }` | criptografa em trânsito |
| `verify-full` | `ssl: { rejectUnauthorized: true, ca }` | criptografa, valida a cadeia e o hostname |

`prefer` e `allow` **removidos**. Não serão reimplementados com retry.

**Default `disable`.** Os bancos alvo são alcançados por rede privada (tailnet) e
não têm TLS configurado. Um default `prefer` produziria, na prática, exatamente
o cenário ruim: toda conexão exibindo "prefer" e toda conexão em texto claro.
`disable` é a mesma criptografia — nenhuma — dita em voz alta.

A UI mostra o modo em vigor na conexão, sempre, sem esconder.

## Consequências

- **`require` não protege contra MITM.** Ele criptografa o tráfego e para por
  aí: com `rejectUnauthorized: false`, qualquer certificado serve, inclusive um
  autoassinado por quem está no meio. Protege contra captura passiva, não contra
  atacante ativo. Isso precisa estar na UI ao lado do modo, não só neste
  documento — "criptografado" e "seguro" não são a mesma coisa, e a diferença é
  invisível para quem só vê o cadeado.
- **`verify-full` é o único modo que autentica o servidor.** É o único em que a
  conexão prova estar falando com o host que diz ser. Quando houver TLS de
  verdade nos bancos, é o alvo.
- **Conexão pode falhar onde antes "funcionava".** Um servidor sem TLS com
  `ssl_mode = require` agora dá erro em vez de cair para texto claro. É o
  objetivo: a falha é informação. O erro do driver vai inteiro para a UI.
- **Migrar de `prefer` custa nada hoje** — não há registro em produção; a coluna
  nasce com três valores. Se algum dia houver, `prefer` mapeia para `disable`
  (é o que ele virava na prática nesses bancos), nunca para `require`, que
  quebraria a conexão silenciosamente na direção oposta.
- **A validação do valor é `CHECK` no SQLite mais schema TypeBox**, não string
  livre. Valor fora dos três não entra na tabela.

## Alternativas consideradas

**Manter os cinco e implementar `prefer`/`allow` com retry.** Recusada. Além do
custo, reproduz o comportamento que motivou a decisão. Um retry para texto claro
é uma degradação de segurança automática e silenciosa — a categoria de coisa que
um cliente de banco não deve fazer sozinho.

**Manter os cinco e mapear `prefer`/`allow` para `require`.** Recusada: o rótulo
mentiria na outra direção. O usuário pede "tente TLS", recebe "exija TLS", e a
conexão quebra num servidor sem TLS por um motivo que o nome do modo não explica.

**Só `disable` e `verify-full`, sem `require`.** Tentadora — seriam os dois modos
honestos. Recusada porque `require` é o que dá para usar hoje: os bancos que
venham a ter TLS terão certificado interno ou autoassinado, e exigir
`verify-full` desde já significaria distribuir CA junto, o que ninguém vai
fazer, e o resultado real seria todo mundo em `disable`. `require` é um degrau
intermediário legítimo, desde que rotulado pelo que é.

**Deixar o `ca` do `verify-full` por conexão, no SQLite.** Adiada, não recusada.
Hoje o `ca` vem do CA store do sistema, com override opcional por
`DBEE_CA_CERT`. Uma coluna por conexão só se justifica quando houver mais de um
CA interno em uso — antes disso é campo vazio em todo registro.
