# 008. Guarda otimista compara `col::text`, e o falso positivo residual é aceito

- **Status:** aceito
- **Data:** 2026-09-05

## Contexto

O UPDATE/DELETE de linha (v0.2) usa concorrência otimista: o `WHERE` repete, além
da PK, os valores **originais** das colunas em jogo. Se outra pessoa alterou a
linha entre a leitura e o apply, o `WHERE` casa 0 linhas e a operação aborta com
`row_changed` — nada é sobrescrito nem apagado.

A comparação é feita sobre `col::text = $n`, não `col = $n`, por dois motivos:

1. O valor lido já chega como **texto** (política de serialização da §6: todos os
   tipos vêm como string, sem parser do driver).
2. `json` e `xml` **não têm operador `=`** — `col = $n` estoura com `42883`. O cast
   para `text` casa a mudança sem depender de o tipo ter igualdade, e vale para
   todos os tipos.

O risco da comparação textual: a representação em texto de alguns tipos depende de
um GUC de sessão. Se a repr da **leitura** divergir do `col::text` do **apply**, a
guarda casa 0 sem ninguém ter mudado a linha — um falso positivo.

## Medição

Contra Postgres real (`mutation.integration.test.ts`, describe "fidelidade textual
por tipo"):

- **Sob o mesmo TimeZone**, `numeric` (com escala), `float8`, `jsonb` (que
  normaliza chaves) e `timestamptz` **não** dão falso positivo. A repr da leitura
  e o `col::text` do apply saem ambos do Postgres, sob os mesmos GUCs — logo
  idênticos. `numeric` preserva a escala igual dos dois lados; `jsonb` normaliza
  igual; `float8` usa o mesmo `extra_float_digits` (o DBee não o altera).
- **Cross-TimeZone**, só `timestamptz`/`timetz` falha: ler sob UTC
  (`…12:00:00+00`) e aplicar sob `Asia/Tokyo` (`…21:00:00+09`) casa 0 e aborta com
  `row_changed`. A repr textual desses tipos depende do `TimeZone`.

**Mitigação já ativa:** `withTransaction` fixa `set_config('TimeZone',
connection.timezone)` na leitura **e** no apply. Numa mesma conexão o TZ nunca
diverge; o falso positivo só aparece se o `timezone` da conexão mudar entre ler e
aplicar, ou se ler numa conexão e editar noutra (mesmo banco, TZ diferente).

## Decisão

**Saída A: aceitar o falso positivo residual.** Sem correção no construtor de SQL.

O falso positivo exige TimeZone divergente entre leitura e apply, é raro, e falha
para o **lado seguro** — nada é escrito, e a mensagem manda recarregar a linha.

## Alternativas descartadas

- **(B) Guarda ciente de tipo comparando o instante:** `col = $n::timestamptz`
  para os tipos que têm `=`, `::text` só para `json`/`xml`. Igualdade de instante é
  TZ-independente. Custo: o construtor passa a bifurcar por família de tipo, e
  reaparece a armadilha do `=` com `NULL` (vira `IS NULL`) e com `float`.
- **(C) Normalizar timestamptz aos dois lados:** `col AT TIME ZONE 'UTC' =
  $n::timestamptz AT TIME ZONE 'UTC'`. TZ-independente sem depender do `=` de cada
  tipo, mas ainda exige saber que a coluna é `timestamptz`.

Ambas tornam o construtor de SQL — o código que **apaga linha de cliente** —
ciente de tipo, trocando um falso positivo raro e seguro por uma superfície de erro
nova. Não compensa. Se um dia o construtor precisar do tipo da coluna por outro
motivo (vem da introspecção), reabrir B ou C fica barato; até lá, não.

## Consequências

- A guarda continua textual e cega a tipo — simples, e provada segura pela medição.
- Registro operacional na §11.41 (uma linha + este link).
- O caso do usuário que troca o TimeZone da conexão e depois edita uma linha lida
  antes: vê `row_changed` sem ter mudado nada. Recarrega e refaz. Documentado na
  mensagem de erro.
