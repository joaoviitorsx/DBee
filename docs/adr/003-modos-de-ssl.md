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

**Empurrar quem usa IP para `require`, documentando a limitação.** Recusada, e
esta foi a alternativa mais perigosa das consideradas — ver o adendo abaixo.

**Deixar o `ca` do `verify-full` por conexão, no SQLite.** Adiada, não recusada.
Hoje o `ca` vem do CA store do sistema, com override opcional por
`DBEE_CA_CERT`. Uma coluna por conexão só se justifica quando houver mais de um
CA interno em uso — antes disso é campo vazio em todo registro.


---

## Adendo (2026-09-04): `verify-full` com host IP

### O que quebrou

O `pg` só define `servername` quando o host é nome DNS (`net.isIP(host) === 0`)
e passa a `tls.connect` apenas `{ socket, ...ssl }` — **sem `host`**. Com um
host IP não sobra nada para o `checkServerIdentity` do `node:tls` comparar, e
ele cai para `localhost`. Medido:

```
Hostname/IP does not match certificate's altnames:
Host: localhost. is not in the cert's altnames: ... IP Address:1.1.1.1 ...
```

Ou seja: `verify-full` falhava contra um certificado **correto**, e falhava
exatamente na topologia que o `DBee.md` descreve — `10.x` nos bancos da empresa
e `100.x` na tailnet. O modo que este ADR chama de "o único que autentica o
servidor" era o único que não funcionava.

### A alternativa que foi recusada

Registrar a limitação na documentação e orientar o uso de `require` nesses
casos. **Recusada:** o resultado prático seria todo mundo em `require`, que
criptografa e não autentica ninguém. Uma limitação documentada num modo de
segurança é uma limitação que empurra o usuário para o modo inseguro — e a §7
diz que a autenticação existe como camada, não como enfeite.

### Decisão

`verify-full` com host IP usa `checkServerIdentity` próprio
(`apps/server/src/pg/ssl.ts`), que valida o IP contra os SANs do tipo
`iPAddress` do certificado. Host DNS continua com a verificação do `node:tls`.

Quatro regras, todas deliberadas:

1. **Só SAN `iPAddress`.** DNS não cobre um host numérico.
2. **Sem fallback para CN.** CN é obsoleto para identidade (RFC 6125) e um
   certificado só-CN é trivial de emitir — aceitá-lo reabriria o que o SAN
   fechou.
3. **Sem casamento por substring.** `10.0.0.4` não casa `110.0.0.42`.
4. **Falha fechada** quando não há SAN de IP nenhum, e a mensagem diz **o que
   fazer**: `emita o certificado com "IP:10.0.0.4" entre os SANs, ou use um
   hostname DNS nesta conexão`. Não "erro de TLS".

### Verificação

`ssl.tls.test.ts` faz handshake TLS de verdade, com certificado emitido na hora
por `openssl`, nos quatro casos:

| certificado | host | resultado |
|---|---|---|
| `IP:10.0.0.4` | `10.0.0.4` | conecta |
| `IP:10.0.0.4` | `10.0.0.9` | recusa, dizendo qual IP falta |
| só `DNS:db.interno` | `10.0.0.4` | recusa, falha fechada |
| só `CN=10.0.0.4`, sem SAN | `10.0.0.4` | recusa — sem fallback para CN |

O teste é pulado se `openssl` não estiver no PATH, em vez de falhar por motivo
alheio ao código.

### Consequência

Um certificado emitido só com CN, ou só com SAN de DNS, deixa de funcionar em
`verify-full` por IP. É o comportamento correto: antes ele também não
funcionava, só que com uma mensagem que não explicava nada.
