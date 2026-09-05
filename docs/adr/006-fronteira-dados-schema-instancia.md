# 006. A fronteira: dados e schema, não instância

- **Status:** aceito
- **Data:** 2026-09-05

## Contexto

O `DBee.md` §1 dizia que o DBee "não é substituto do pgAdmin para administração
de servidor (backup, replicação, gestão de extensões)". A frase está certa e
nunca foi contestada — mas ela é uma **lista de exemplos**, e lista de exemplos
não decide caso novo.

O problema apareceu quando o pedido foi "quero que atenda eu e meu time para
administração do banco, semelhante ao que o DBeaver tem hoje". À primeira vista
isso colide com o §1. Não colide, e a razão importa:

**"Administração" são duas coisas diferentes.**

- **Dados e schema** — ler, filtrar, exportar, corrigir uma linha, ver DDL, criar
  índice, entender por que a query está lenta. É o que se faz toda semana.
- **Instância** — backup, restore, replicação, extensões, `ALTER SYSTEM`, roles,
  matar sessão alheia, agendar vacuum. É o que se faz em incidente.

**O DBeaver também não faz administração de instância.** Ele não gerencia
replicação nem extensões; tem um visualizador de sessões somente-leitura e um
botão de kill que quase ninguém usa. Ou seja: atender "o que o DBeaver tem" não
exige violar o §1 — exige **definir o §1 de forma operacional**, para que ele
decida sozinho os casos que ninguém previu.

## Decisão

> **DBee age sobre dados e schema, dentro de uma transação, com a permissão do
> papel Postgres da conexão. DBee não age sobre a instância.**

Quatro testes. **Qualquer resposta "não" descarta a feature ou a converte em
geração de SQL.**

| # | Pergunta | Se a resposta for ruim |
|---|---|---|
| 1 | É um comando SQL que roda dentro da transação do §6 e cai inteiro no `query_log`? | Se **não**, está fora. |
| 2 | Exige capacidade fora do SQL — processo, arquivo no disco do servidor, binário externo como `pg_dump`, configuração do servidor? | Se **sim**, está fora. |
| 3 | Afeta outras sessões ou a disponibilidade do servidor, mesmo sendo SQL? (`pg_terminate_backend`, `VACUUM FULL`, `ALTER SYSTEM`, `CREATE EXTENSION`) | Se **sim**, está fora. |
| 4 | A ação é **reversível pelo próprio usuário, com o que ele vê na tela**? | Se **não**, ela **gera SQL** em vez de executar. |

O teste 4 é o que separa "perigoso" de "proibido". `DROP TABLE` passa nos três
primeiros — é SQL, roda na transação, não afeta outras sessões. Ele falha no
quarto: nada na tela desfaz um `DROP`. Então ele não vira botão; vira texto no
editor.

### Corolário

> **O DBee gera SQL para o usuário ler e rodar. Não executa DDL por botão.**

- "Gerar `ALTER TABLE … ADD COLUMN` no editor" — **sim**.
- Item de menu "Excluir tabela" que executa — **não**.

Isto é divergência **deliberada** do DBeaver, que tem esse botão. A diferença é
que o DBeaver roda no desktop de uma pessoa, contra o banco que ela escolheu
abrir. O DBee roda numa URL da tailnet, compartilhada, contra bancos de cliente,
e um item de menu a uma tecla de distância de `DROP TABLE` é uma classe de
acidente que o desktop não tem.

O SQL gerado passa pelo caminho inteiro: a pessoa lê, o modo escrita precisa
estar ligado, a tarja de perigo aparece, e o `query_log` registra. Um botão pula
os quatro.

## Consequências

- **A §1 do `DBee.md` passa a ter uma regra, não uma lista.** Feature nova é
  decidida pelos quatro testes, por quem estiver escrevendo, sem precisar
  perguntar.
- **DDL continua executando pelo executor**, e isso é correto: em modo escrita,
  `CREATE INDEX` digitado pelo usuário roda hoje pelo `executeDirect`. O que a
  decisão proíbe é a **afordância de UI**, não o comando.
- **Algumas features boas ficam de fora**, e é o objetivo: import de CSV direto
  para tabela (falha no 4 — 50 mil linhas com encoding errado não se desfaz
  olhando a tela), terminal `psql` embutido (falha no 1 e no 2 — não passaria
  pelo `query_log` nem pelo `BEGIN READ ONLY`), backup (falha no 2).
- **Painel de diagnóstico somente-leitura fica dentro**, desde que seja
  leitura: `pg_stat_activity`, `pg_locks` e tamanho de tabela são `SELECT` em
  catálogo, passam nos quatro. Um botão de kill ao lado deles falha no 3.
- **Cancelar a própria query fica dentro**, com uma restrição que precisa estar
  no código e não só aqui: só cancela PID que o próprio DBee registrou, para uma
  query do próprio usuário. PID vindo do cliente, nunca.
- **`EXPLAIN ANALYZE` é escrita.** Ele executa o comando de verdade — um
  `EXPLAIN ANALYZE UPDATE` aplica o UPDATE. Pelo teste 4 ele é tão irreversível
  quanto o UPDATE, e é tratado como tal: com `readOnly` omitido falha com
  `25006`, exatamente como o comando cru. Coberto por teste de integração.

## Alternativas consideradas

**Manter a lista de exemplos do §1.** Recusada: ela não decide caso novo, e o
caso novo é justamente onde o escopo escapa. Todo pedido futuro viraria uma
discussão.

**Recusar o pedido, mantendo o DBee como visualizador.** Recusada: o pedido é
legítimo e cabe dentro do §1 corretamente interpretado. Recusar teria custado a
utilidade sem ganhar segurança nenhuma.

**Aceitar o pedido ampliando o §1 para incluir administração de instância.**
Recusada, e é a alternativa perigosa. Backup e restore em SQL puro é
reimplementar mal uma ferramenta que já existe; `ALTER SYSTEM` e gestão de roles
transformam a ferramenta de consulta diária em ferramenta de incidente, com
outra postura de risco. E a restrição técnica aponta na mesma direção: sem
socket do Docker (§11.7), não há como executar `pg_dump`.

**Permitir DDL por botão com confirmação.** Recusada. Confirmação é o que se
adiciona quando não se quer decidir: ela vira reflexo em duas semanas. O SQL no
editor obriga a ler o que vai rodar, que é uma barreira de natureza diferente —
e mais barata de implementar.
