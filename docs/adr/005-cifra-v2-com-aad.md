# 005. Cifra v2: o id da conexão como AAD

- **Status:** aceito
- **Data:** 2026-09-04

## Contexto

O formato v1 era `v1.<iv>.<tag>.<ct>`, AES-256-GCM sem dado associado.

GCM autentica o ciphertext. Sem AAD, ele **não** autentica nada sobre o
contexto do registro: nem o formato, nem a que conexão a senha pertence. O tag
prova "este texto foi cifrado com esta chave", e só.

Quem tiver escrita no `dbee.sqlite` — acesso ao volume, não à API — pode então
**trocar o `password_enc` entre duas linhas**:

```sql
UPDATE connections SET password_enc = (
  SELECT password_enc FROM connections WHERE name = 'Produção'
) WHERE name = 'Homologação';
```

A decifragem funciona perfeitamente. O DBee abre a conexão de homologação —
host, porta, database de homologação — enviando **a senha de produção**. Nada
falha, nada é registrado, e a credencial de produção acaba de ser entregue a
um servidor diferente. Se esse servidor for controlado por quem fez a troca, é
exfiltração completa da senha.

O caminho inverso é mais discreto: a senha de homologação numa conexão rotulada
"Produção" simplesmente não autentica, e vira um erro confuso.

Isto exige o mesmo nível de acesso que já expõe o `APP_SECRET` do ambiente — mas
não é o mesmo ataque. Ler o `APP_SECRET` exige o processo ou as variáveis de
ambiente; escrever uma linha do SQLite exige só o volume. São superfícies
diferentes, e a segunda é a que um backup mal guardado expõe.

## Decisão

**Formato v2, com o id da conexão como AAD.**

```
v2.<iv>.<tag>.<ct>      AAD = "v2:" + connectionId
```

O AAD entra no cálculo do tag sem entrar no ciphertext. Um registro movido para
outra conexão passa a falhar na autenticação GCM, com a mesma mensagem de
"não foi possível decifrar" — indistinguível de chave errada, o que é
desejável: um oráculo a menos.

O prefixo `v2:` dentro do AAD amarra também a versão, fechando *downgrade*: um
payload v2 não pode ser reapresentado como v1 e vice-versa.

### Migração

- **Toda escrita grava v2.** `encrypt` não tem modo v1.
- **v1 é lido uma única vez**, por `recipherToV2`, no boot, depois das
  migrations de schema e da derivação da chave. Registra no log quantos foram
  convertidos.
- **A conversão é uma transação só.** Ou todos migram, ou nenhum: um estado
  parcial deixaria conexões ilegíveis se o processo morresse no meio, e o
  usuário não teria como saber quais.
- **Depois disso, `decrypt` recusa v1.** O caminho legado vive em
  `decryptLegacyV1`, que só o migrador chama.

## Consequências

- **O caminho legado não fica aberto para sempre**, que é o ponto. Se `decrypt`
  continuasse aceitando v1, a troca de registro entre conexões continuaria
  possível — bastaria gravar no formato antigo. Uma migração que não fecha a
  porta antiga não migrou nada.
- **Encontrar um v1 depois da migração é sinal de escrita externa no banco.** A
  mensagem de erro diz isso explicitamente, em vez de tratar como formato
  desconhecido: é a única forma de aquele registro ter aparecido.
- **`encrypt` e `decrypt` passam a exigir o id da conexão.** Isso é o que
  garante que ninguém esqueça do AAD por omissão — não há assinatura sem ele. O
  repositório é o único chamador, e ele já tem o id em mãos nos três caminhos
  (criar, atualizar senha, resolver).
- **Migrar de novo custa o mesmo.** Se um dia houver v3, o mesmo desenho serve:
  ler o anterior no boot, gravar o novo, fechar o anterior. O que não pode é
  acumular formatos aceitos no caminho de requisição.
- **Feito agora, com cinco conexões de teste e nenhum dado real.** Com trinta
  conexões de produção a mesma migração seria a mesma linha de código e uma
  decisão bem mais desconfortável.

## Alternativas consideradas

**Deixar como está, argumentando que exige acesso ao volume.** Recusada. É
verdade que exige, mas o custo da correção é um `setAAD` e uma migração de boot,
enquanto o custo de não corrigir é a senha de produção sair para um host
arbitrário sem nenhum sinal. A assimetria decide.

**Usar a linha inteira como AAD** (id + host + porta + database). Tentadora:
fecharia também "mudei o host desta conexão e a senha continuou valendo".
Recusada porque tornaria o registro ilegível a cada edição de host — e editar o
host de uma conexão é operação normal, não ataque. O id é o que identifica o
registro de forma estável.

**Manter v1 legível indefinidamente, só parando de escrever nele.** Recusada:
não fecha o ataque. Quem pode escrever no banco pode gravar no formato antigo, e
aí o AAD deixa de ser verificado. Aceitar o formato antigo é aceitar o ataque.

**Cifrar com uma chave derivada por conexão** (`HKDF(key, connectionId)`) em vez
de AAD. Equivalente em efeito e mais caro: uma derivação por operação, ou um
cache de chaves por conexão a invalidar. AAD resolve o mesmo com uma chamada.
