# 001. Modo read-only declarado no `BEGIN`, não em GUC de sessão

- **Status:** aceito
- **Data:** 2026-09-04

## Contexto

O princípio nº 1 do `DBee.md` é "read-only por padrão": escrita é modo explícito
por conexão, e erro de digitação não pode derrubar dado de cliente. O §11.4
complementa que essa proteção **não** pode ser regex nem parser de SQL — falso
negativo é inevitável (CTE com `INSERT`, função com efeito colateral, `SELECT`
que chama procedure) e falso positivo irrita (`SELECT * FROM update_log`). A
proteção tem que ser do próprio Postgres.

A §6 prescrevia esta sequência:

```sql
BEGIN;
SET LOCAL statement_timeout = <ms>;
SET LOCAL default_transaction_read_only = on;   -- quando aplicável
DECLARE dbee_<queryId> NO SCROLL CURSOR FOR <sql do usuário>;
```

Parecia correto por três motivos razoáveis: `SET LOCAL` de fato limita o efeito à
transação corrente e reverte no `COMMIT`; o nome do GUC contém
`transaction_read_only`; e o `statement_timeout` na linha de cima, setado do
mesmo jeito, funciona. A analogia entre as duas linhas é o que esconde o
problema.

O que a analogia esconde: `default_transaction_read_only` é o **valor que
transações futuras herdam ao iniciar**. Ele não é o modo da transação corrente —
esse é `transaction_read_only`, e o Postgres não deixa alterá-lo depois que a
transação já executou seu primeiro comando. Setar o `default_` dentro de um
`BEGIN` já aberto não levanta erro e não faz nada.

## Evidência

Medido no spike do dia 1 (`scratch/spike-cursor.ts` e probes auxiliares), contra
PostgreSQL 16, driver `pg@8.23.0`, Bun 1.3.14.

Estado dos GUCs logo após a receita antiga:

```
transaction_read_only=off   default_transaction_read_only=on
```

Com esse estado — ou seja, rodando exatamente o que a §6 mandava:

| Comando | Resultado |
|---|---|
| `UPDATE` direto (fora do cursor) | **PASSOU** |
| `DELETE` direto | **PASSOU** |
| `CREATE TABLE` | **PASSOU** |
| `TRUNCATE` | **PASSOU** |

A tabela só sobreviveu ao teste porque o script dava `ROLLBACK` explícito. Não
havia proteção nenhuma para statements executados fora do cursor — e a própria
§6 manda executar fora do cursor todo statement que não retorna linhas, que é
justamente a categoria de `UPDATE`, `DELETE` e DDL.

O que passava era acidente de outra regra: `DECLARE CURSOR` recusa CTE com
`INSERT` por conta própria, o que dava impressão de cobertura.

Com `BEGIN READ ONLY`, mesma bateria, uma transação por comando:

| Comando | SQLSTATE | Mensagem |
|---|---|---|
| `UPDATE` | `25006` | cannot execute UPDATE in a read-only transaction |
| `DELETE` | `25006` | cannot execute DELETE in a read-only transaction |
| `INSERT` | `25006` | cannot execute INSERT in a read-only transaction |
| `CREATE TABLE` | `25006` | cannot execute CREATE TABLE in a read-only transaction |
| `DROP TABLE` | `25006` | cannot execute DROP TABLE in a read-only transaction |
| `TRUNCATE` | `25006` | cannot execute TRUNCATE TABLE in a read-only transaction |
| CTE com `INSERT` | `25006` | cannot execute SELECT in a read-only transaction |
| cursor sobre CTE com `INSERT` | `0A000` | DECLARE CURSOR must not contain data-modifying statements in WITH |
| `SELECT ... FOR UPDATE` | `25006` | cannot execute SELECT FOR UPDATE in a read-only transaction |
| cursor sobre `SELECT ... FOR UPDATE` | `25006` | cannot execute SELECT FOR UPDATE in a read-only transaction |
| `SELECT` comum | — | passa |
| cursor sobre `SELECT` | — | passa |

`SELECT ... FOR UPDATE` sendo barrado importa mais do que parece: ele não altera
dado, mas trava linha, e uma sessão "de leitura" segurando lock em tabela de
produção é incidente. A receita antiga deixava passar.

## Decisão

**O modo da transação é declarado no próprio `BEGIN`.**

```sql
BEGIN READ ONLY;                        -- ou BEGIN READ WRITE no modo escrita
SET LOCAL statement_timeout = <ms>;
SET LOCAL TimeZone = '<tz da conexão>';
```

`BEGIN` pelado é proibido, mesmo no modo escrita: `BEGIN READ WRITE` explícito
deixa o modo visível no código e no log, e torna impossível a leitura ambígua de
"esta transação escreve por omissão ou por decisão?".

### Por que não `SET TRANSACTION READ ONLY`

Funciona — foi medido, e bloqueia igual (`transaction_read_only=on`,
`25006` em tudo). Mas perde em dois pontos:

1. **Janela gravável.** Entre o `BEGIN` e o `SET TRANSACTION READ ONLY` existe
   uma transação aberta em modo read-write. Hoje nada roda nessa janela, mas ela
   é um convite: qualquer refactor que insira um comando ali — um `SET`, um
   lookup, um retry — passa a rodar sem proteção, e o teste continua verde
   porque o comando que importa vem depois. `BEGIN READ ONLY` não tem janela.
2. **Round-trip.** É um comando a mais por query. Irrelevante isolado, não
   irrelevante numa ferramenta cujo caminho quente é "abrir transação, buscar
   1000 linhas, fechar".

Vale o mesmo para `SET LOCAL transaction_read_only = on`, que também funciona e
também tem a janela.

## Consequências

- **`25006` é o sinal esperado, não um bug.** Quando o usuário tenta escrever
  numa conexão read-only, o erro do Postgres é a resposta correta e vai inteiro
  para a UI, com `code`, `message` e `position`. Não engolir, não traduzir para
  uma mensagem genérica, não tentar antecipar com validação no cliente.
- **Se `default_transaction_read_only` reaparecer no código, é regressão de
  segurança**, não questão de estilo — e não vai quebrar teste nenhum sozinho,
  porque o comando é aceito em silêncio. Registrado em `DBee.md` §11.4b e na
  regra 8 do `CLAUDE.md`. Revisão de PR que veja essa string deve barrar.
- **Custa um teste de regressão.** Quando o executor de query existir, ele
  precisa de um teste que tente escrever numa conexão read-only e afirme `25006`.
  Sem isso, essa decisão é só um comentário.
- **O modo escrita da v0.2 já tem o desenho pronto:** trocar `READ ONLY` por
  `READ WRITE` no `BEGIN`, decidido a partir de `write_enabled` da conexão e do
  `readOnly` da requisição. Nenhum outro ponto do código muda.
- **`FOR UPDATE` deixa de funcionar em conexão read-only.** É o comportamento
  desejado, mas é uma capacidade a menos: quem precisar de lock explícito tem
  que ligar o modo escrita.

## Alternativas consideradas

**Manter `SET LOCAL default_transaction_read_only` e confiar no cursor.**
Recusada: não protege, pelas medições acima. O cursor cobre um subconjunto por
efeito colateral de outra regra, e a §6 manda executar statements sem retorno
fora do cursor — exatamente os que escrevem.

**`SET TRANSACTION READ ONLY` após o `BEGIN`.** Recusada pela janela gravável e
pelo round-trip, detalhado acima. Funciona; é só estritamente pior.

**Usuário Postgres read-only por conexão (`ALTER USER ... SET
default_transaction_read_only = on`).** Recusada: exige provisionar usuário em
cada banco de cada cliente, o que contraria o princípio de instalação sem passo
de configuração obrigatório (§2.2), e não acomoda o modo escrita por conexão da
v0.2. Continua sendo uma boa segunda camada do lado do servidor, se quem
administra o banco quiser — mas não pode ser a única, porque não está sob
controle do DBee.

**Detectar escrita por regex ou parser de SQL.** Recusada antes deste ADR, em
`DBee.md` §11.4. Repetida aqui porque é a alternativa que sempre volta.
