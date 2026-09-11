# O papel restrito no MySQL e no MariaDB

No Postgres a proteção contra escrita é o modo da transação (`CLAUDE.md`,
regra 8). No MySQL e no MariaDB **essa garantia não existe** — medido em
`docs/multi-engine.md` §1: dentro de `START TRANSACTION READ ONLY` o
`TRUNCATE TABLE` esvaziou a tabela e o `CREATE USER` criou usuário.

Então aqui a garantia é **a credencial**. Este documento é a garantia: não há
código do DBee que substitua um `GRANT` correto. Se a conexão for configurada
com um usuário que pode escrever, o DBee vai deixar escrever, e nenhuma opção
de tela muda isso.

## O papel

```sql
CREATE USER 'dbee_leitor'@'%' IDENTIFIED BY '<senha forte>';
GRANT SELECT ON nome_do_banco.* TO 'dbee_leitor'@'%';
```

Só isso. Sem `GRANT ALL`, sem `WITH GRANT OPTION`, sem `PROCESS`, sem `FILE`,
sem `SUPER`, e um banco por vez em vez de `*.*`.

## O que esse papel barra — medido, não lido na documentação

MySQL 8.4.11 e MariaDB 11.8.9, container limpo, usuário exatamente como acima.
Cada comando rodou isolado e o efeito foi conferido nos dados depois, não
presumido pelo código de erro.

| comando | MySQL 8.4 | MariaDB 11.8 |
|---|---|---|
| `SELECT` | passa | passa |
| `INSERT` / `UPDATE` / `DELETE` | **1142** | **1142** |
| `TRUNCATE TABLE` | **1142** (`DROP command denied`) | **1142** |
| `DROP TABLE` / `CREATE TABLE` | **1142** | **1142** |
| `CREATE USER` | **1227** | **1227** |
| `SELECT … INTO OUTFILE` | **1227** (precisa de `FILE`) | **1227** |
| `LOAD_FILE('/etc/hostname')` | devolve `NULL` | devolve `NULL` |
| `SELECT` em outro banco | **1142** | **1142** |
| `CALL` de procedure com `DEFINER` | **1370** (sem `EXECUTE`) | **1370** |
| `CREATE TEMPORARY TABLE` | **1044** | **1044** |
| `LOCK TABLES` | **1044** | **1044** |
| `FLUSH TABLES` | **1227** | **1227** |
| `SET GLOBAL` | **1227** | **1227** |
| `performance_schema` | **1142** | **1142** |

Depois da bateria inteira: `loja.pedidos` com as mesmas 3 linhas, usuário
`invasor` inexistente. **A credencial segurou exatamente onde a transação
falhou** — o `TRUNCATE` e o `CREATE USER`, os dois casos que escapavam.

## As três coisas que passam, e o que fazer com cada uma

### 1. `SELECT … FOR UPDATE` — e aqui MariaDB **diverge** do MySQL

| | resultado |
|---|---|
| MySQL 8.4 | **1142** — `SELECT with locking clause command denied` |
| MariaDB 11.8 | **passa** |

Medido no MariaDB: o leitor abriu transação, tomou o lock da linha 1
(`innodb_trx.trx_rows_locked = 1`) e um `UPDATE` do **root** na mesma linha
morreu com `ERROR 1205 Lock wait timeout exceeded` depois de 3 s.

Ou seja: no MariaDB uma credencial de **somente leitura** trava escritores
legítimos. Não é perda de dado, é indisponibilidade — e é feita pela conexão
que a tela chama de segura.

**Mitigação:** o driver fecha a transação de leitura ao fim de cada execução,
e o timeout de statement (abaixo) limita a janela. Não é conserto: é redução
de janela. Quem quiser cortar de vez tira o `SELECT` direto e dá acesso só a
views — fora do escopo do DBee.

Esta é a terceira vez que "MariaDB é MySQL com outro nome" se provou falso
neste projeto. As duas anteriores estão no registro de correções de
`docs/multi-engine-progresso.md`.

### 2. `GET_LOCK` — lock consultivo disponível ao leitor

Passa nos dois. Consequência é a mesma da anterior, em menor grau. Fica
registrado; não muda o desenho.

### 3. `SET SESSION transaction_read_only = OFF` — passa nos dois

Esperado, e é justamente por isso que a garantia **não pode** ser essa
variável. É a mesma classe do `SET LOCAL default_transaction_read_only` que a
regra 8 chama de regressão de segurança. Com a credencial certa, desligar essa
variável não dá poder nenhum: os `1142` acima continuam vindo.

## A armadilha de confidencialidade: view com `DEFINER`

`GRANT SELECT ON loja.*` **não** é uma fronteira em volta dos dados de `loja`.

Medido nos dois: uma view criada pelo root **dentro de `loja`**, com
`SQL SECURITY DEFINER`, selecionando de `outra.segredo` — um banco em que o
leitor não tem grant nenhum — foi lida sem erro pelo leitor:

```
SELECT * FROM outra.segredo   -> ERROR 1142  (negado)
SELECT * FROM v_vazamento     -> 1  nao-deveria-ver   (passou)
```

Isso é do MySQL, não do DBee, e vale para qualquer cliente. Entra aqui porque
quem cria a credencial precisa saber: **conferir as views do banco concedido**
faz parte de conceder o banco.

## O que o papel restrito ainda permite, e que o DBee precisa

Duas capacidades sobrevivem ao `GRANT SELECT`, e ainda bem, porque o produto
depende delas:

- **`KILL QUERY`** numa conexão do **mesmo usuário**, sem privilégio `PROCESS`.
  Medido nos dois: o cancelamento de consulta funciona com a credencial
  restrita. No MySQL a vítima devolve `1`; no MariaDB, `ERROR 1317`.
- **Timeout de statement**, sem privilégio nenhum:

  | | variável | unidade | corta em |
  |---|---|---|---|
  | MySQL 8.4 | `max_execution_time` | ms inteiros | 1511 ms para 1500 |
  | MariaDB 11.8 | `max_statement_time` | s float | 1541 ms para 1.5 |

  **Cuidado que já custou uma medição errada:** no MySQL, `SELECT SLEEP(5)`
  cortado pelo timeout **não levanta erro** — devolve `1` e volta em 1511 ms.
  O erro `3024` só aparece em consulta de verdade. Driver que decida "deu
  certo" pela ausência de erro vai relatar sucesso numa consulta interrompida.

## O que o papel restrito tira, e que a tela precisa refletir

- **`SHOW PROCESSLIST` mostra só as conexões do próprio usuário.** A vista de
  atividade — que no Postgres lê `pg_stat_activity` inteiro — vai mostrar
  apenas o que o DBee mesmo abriu. Sem `PROCESS`, é isso que existe, e a tela
  precisa dizer isso em vez de fingir uma lista completa.
- **`information_schema` já vem filtrado pelos grants.** Bom para a árvore: ela
  lista naturalmente só o que é legível. `SHOW DATABASES` devolveu
  `information_schema` e `loja` — `outra` não aparece.

## Reproduzir

```bash
docker run -d --name dbee-mysql   -e MYSQL_ROOT_PASSWORD=raiz   -p 33061:3306 mysql:8.4
docker run -d --name dbee-mariadb -e MARIADB_ROOT_PASSWORD=raiz -p 33062:3306 mariadb:11
```

Depois o `GRANT` do topo e a bateria da tabela. O critério é o estado dos dados
ao fim, não o código de erro de cada comando.
