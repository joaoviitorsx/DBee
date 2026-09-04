# 004. Defaults nunca no schema de entrada

- **Status:** aceito
- **Data:** 2026-09-04

## Contexto

Os schemas de entrada da API são TypeBox (`t` do Elysia), em `packages/shared`.
TypeBox aceita `default` na declaração do campo:

```ts
const port = t.Integer({ minimum: 1, maximum: 65535, default: 5432 });
```

Parecia a coisa certa: o default fica junto da restrição, aparece no OpenAPI, o
Eden herda, e o repositório não precisa repetir `?? 5432`. Uma fonte só.

**O Elysia não trata `default` como documentação. Ele materializa o valor
durante a validação**, antes do handler receber o corpo. Num `POST` isso é
exatamente o desejado. Num `PATCH` é corrupção de dado.

O problema é conceitual, não de implementação: **num `PATCH`, "campo ausente" e
"campo igual ao default" são estados diferentes, e o schema não tem como
distinguir.** Um schema de validação enxerga o corpo que chegou; ele não sabe
que a semântica da rota é "mexa só no que eu mandei". Ao preencher a lacuna com
o default, ele responde uma pergunta que não lhe foi feita, e responde errado.

## Evidência

Achado verificando a introspecção de schema contra Postgres real, não por teste
— nenhum teste existente cobria a combinação.

Conexão criada apontando para um Postgres em container:

```
port = 55434
```

Requisição que só renomeia:

```
PATCH /api/connections/:id   {"timezone":"UTC"}
```

Estado depois:

```
port = 5432
```

O `default: 5432` do schema foi materializado num campo que o cliente nunca
enviou, e o repositório gravou. A conexão passou a apontar para
`127.0.0.1:5432` — que, na máquina em questão, é **outro servidor Postgres**, com
outro conteúdo. A falha só apareceu porque a autenticação nesse outro servidor
falhou; se a senha coincidisse, a ferramenta estaria lendo o banco errado
silenciosamente, com o nome certo na tela.

Numa ferramenta cujo princípio nº 1 é "deixar óbvio em qual banco você está",
esse é o pior modo de falha possível.

Os mesmos defaults afetavam `statementTimeoutMs` (voltava para 30000) e
`timezone` (voltava para `UTC`, mudando como todo `timestamptz` é exibido).

## Decisão

**Nenhum schema de entrada declara `default`. Em rota nenhuma, nem em `POST`.**

Valor default mora no repositório, aplicado só na criação:

```ts
input.port ?? 5432
```

Regras que decorrem disso:

1. **Schema de criação e schema de atualização são tipos separados**, escritos
   de forma independente. `UpdateConnection` **não** deriva de `CreateConnection`
   por `Partial`/`Omit`: derivação copia os metadados do campo, e `default` vem
   junto. Um `Partial<T>` de um schema com default continua materializando o
   default.
2. **O schema de update usa `t.Partial` sobre um objeto de campos sem default**,
   nunca sobre o schema de criação.
3. **Um teste genérico percorre todo schema de update exportado por
   `packages/shared` e falha se qualquer campo declarar `default`.** Genérico de
   propósito: protege o schema que ainda não existe, não os quatro campos de
   hoje. Teste específico por campo teria passado antes deste bug, porque o
   campo culpado (`port`) nem estava sendo testado em `PATCH`.

### Por que `POST` também

A tentação é permitir default em `POST`, onde ele funciona. Recusado por dois
motivos:

- **Schemas migram.** Um campo declarado hoje só na criação acaba reaproveitado
  na atualização, e o default viaja junto sem ninguém reparar. A regra só
  protege se não tiver exceção a memorizar.
- **O default fica em dois lugares.** Com o repositório aplicando `?? 5432` e o
  schema também declarando `5432`, os dois podem divergir numa alteração
  futura, e qual vence depende de qual caminho a requisição tomou. Um lugar só.

O custo é real e aceito: o OpenAPI deixa de anunciar o default do campo. Isso é
documentação, e documentação errada é pior que documentação ausente — o campo
está descrito na §4 do `DBee.md`, junto do DDL onde o default de verdade mora.

## Consequências

- **Qualquer schema de entrada com `default` é bug em potencial**, mesmo numa
  rota que hoje só faz `POST`. Revisão que vir `default:` num schema de
  `packages/shared` deve barrar, e o teste genérico já barra sozinho.
- **O repositório passa a ser a única fonte do valor inicial.** `create()`
  aplica; `update()` nunca aplica. Isso deixa `update()` com a semântica correta
  de PATCH sem precisar de cuidado especial em cada campo novo.
- **Campo novo não exige lembrar da regra**: adicionar ao objeto de campos
  compartilhado (sem default) e ao `t.Partial` do update é o caminho natural, e
  o teste genérico cobre o resto.
- **A mesma armadilha vale para qualquer validador com coerção.** Se um dia
  entrar transformação de entrada (`t.Transform`, coerção de tipo), ela precisa
  passar pelo mesmo escrutínio: tudo que **preenche** ou **altera** valor
  durante a validação apaga a diferença entre "ausente" e "informado".
- Registrado como armadilha em `DBee.md` §11.15, que aponta para este ADR.

## Alternativas consideradas

**Manter os defaults e usar `additionalProperties`/`Partial` só no update.**
Recusada: é exatamente o que estava lá. `t.Optional(port)` já tornava o campo
opcional, e o default foi aplicado assim mesmo — opcionalidade e default são
independentes no TypeBox.

**Manter os defaults e limpar no handler**, comparando o corpo cru com o
validado. Recusada: exige que todo handler de PATCH lembre de fazer isso, e o
corpo cru nem sempre está disponível depois da validação. Proteção que depende
de disciplina em cada rota não é proteção.

**Detectar campos ausentes com um sentinela** (`undefined` explícito, JSON
Merge Patch). Recusada por ora: resolveria, mas troca um problema simples por um
protocolo mais complicado, e a §5 não pede semântica de merge patch. Se algum
dia for preciso distinguir "apague este campo" de "não mexa neste campo", volta
à mesa — hoje nenhum campo de conexão é apagável.

**Ter defaults só no SQL da migration e nenhum no TypeScript.** Tentadora: o DDL
já declara `DEFAULT 5432`. Recusada porque o repositório monta `INSERT` com
todas as colunas explícitas, então o default do DDL nunca é acionado. Alinhar as
duas coisas exigiria omitir colunas do `INSERT` conforme o que veio, o que
complica o repositório para economizar um `??`.
