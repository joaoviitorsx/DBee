# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) · versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- **O fuso da sessão no MySQL/MariaDB**, com plano B para servidor sem tabelas
  de fuso.

  A conexão do DBee guarda um fuso IANA (`America/Bahia`), e o MySQL só entende
  nome se as tabelas `mysql.time_zone*` estiverem carregadas. Nas imagens
  oficiais estão (medido: 1795 nomes no MySQL 8.4, 498 no MariaDB 11), mas num
  servidor instalado à mão é comum não estarem, e aí o `SET SESSION time_zone`
  falha com **1298** nos dois.

  Falhar a conexão inteira por isso seria desproporcional; ignorar o erro seria
  pior, porque a sessão ficaria no fuso do servidor e as datas apareceriam
  **silenciosamente erradas**. O plano B é o deslocamento numérico do mesmo
  fuso, que os dois aceitam sempre.

  O limite do plano B fica dito por teste, não só por comentário: ele é o
  deslocamento de **um instante**, então uma sessão que atravesse a virada do
  horário de verão continua na antiga. Por isso o nome vem primeiro. O próprio
  teste caiu nessa armadilha uma vez — eu afirmei que `Pacific/Chatham` é
  `+12:45`, medido em setembro, quando em janeiro é `+13:45`.

- **O executor de statements do MySQL/MariaDB**, que não traz o resultado
  inteiro — e o contrato que impede o pool de passar fome.

  O Postgres embrulha o SQL num `DECLARE … CURSOR` e busca `maxRows + 1`. O
  MySQL **não tem cursor** fora de procedure, e a regra 8 proíbe reescrever o
  SQL do usuário — injetar `LIMIT` seria isso, e mudaria o resultado de quem já
  tem `LIMIT` ou `UNION`. O equivalente é streaming com parada antecipada:
  medido, 262 144 linhas custam **+75 MB** em modo buffered e **6 ms** parando
  em 101.

  **Parar cedo custa a conexão**, e isso foi medido em cadeia. Só `destroy`
  deixa a conexão bloqueada **15,2 s** drenando um `JOIN` de 67 milhões de
  linhas — num pool, um `SELECT` sem `WHERE` faria o pool passar fome.
  `KILL QUERY` mata o dreno mas deixa a conexão em `closed state`. O que resolve
  os dois é **fechar a conexão**: a thread some do `PROCESSLIST` 1,5 s depois,
  com ou sem `KILL`. Por isso o resultado carrega `descartarConexao` — no tipo,
  não num comentário, para o pool não poder esquecer.

  São três coisas distintas, e confundi-las seria repetir o erro do `FETCH n`:
  streaming limita **memória**, o `max_execution_time` limita **tempo**, e o
  `KILL QUERY` atende à **vontade do usuário**.

  Duas coisas que o executor se recusa a inventar, porque o protocolo do MySQL
  não as carrega: a **posição** do erro (destacar um lugar chutado no editor é
  pior que não destacar) e o **rótulo do comando** (`command` fica `null`).

- **Os nomes de tipo das colunas de resultado no MySQL/MariaDB**, conferidos
  contra a resposta do próprio servidor.

  O `mysql2` expõe o número do tipo do **protocolo** — `LONG`, `VAR_STRING`,
  `BLOB` — e ninguém escreve `LONG` num `CREATE TABLE`. A tela usa
  `dataTypeName` para decidir alinhamento e formatação, então precisa do nome
  do SQL: `int`, `varchar`, `text`.

  O mapa não é uma tabela escrita de memória: o teste pergunta ao MySQL e ao
  MariaDB, por `information_schema.COLUMNS.DATA_TYPE`, como cada coluna se
  chama, e exige que o mapa concorde — 216 asserções, quem tem razão é o
  servidor.

  Três coisas que a medição decidiu: `ENUM` e `SET` chegam como `STRING` e só os
  flags 256/2048 os separam de um `CHAR`; `BLOB` e `TEXT` compartilham o tipo e
  só o charset os separa; e `BINARY_FLAG` continua inútil para isso, porque vem
  ligado em `DATE`, `DATETIME`, `TIMESTAMP` e `TIME`.

  Um limite fica dito em voz alta em vez de escondido: **`TEXT` e `LONGTEXT`
  chegam idênticos no fio** — o tamanho não viaja no metadado do resultado. Os
  dois viram `text`, que é a informação que de fato existe; chutar `longtext`
  acertaria metade das vezes. Há teste travando o limite, para o dia em que o
  protocolo mudar.

- **O limite de tempo por consulta em MySQL e MariaDB**, com as três
  divergências medidas concentradas num arquivo só.

  | | variável | unidade | ao cortar |
  |---|---|---|---|
  | MySQL 8.4 | `max_execution_time` | milissegundos inteiros | `ER_QUERY_TIMEOUT`, errno 3024 |
  | MariaDB 11.8 | `max_statement_time` | segundos, float | errno 1969, **sem `code`** |

  `@@max_execution_time` não existe no MariaDB, então não dá para setar as duas
  e deixar a que valer vencer — há teste provando que cada servidor recusa a
  variável do outro.

  Duas armadilhas, uma em cada, e a segunda era um defeito meu que a medição
  pegou: a primeira versão reconhecia o corte pelo **nome** do código de erro, o
  que funciona no MySQL e falha calado no MariaDB, que não manda nome nenhum. A
  chave passou a ser o `errno`, que os dois preenchem.

  A outra é do MySQL: `SELECT SLEEP(5)` cortado por tempo volta **sem erro**, em
  1502 ms, com o valor `1`. Um executor que decida "deu certo" pela ausência de
  erro relataria sucesso numa consulta que não terminou. Fica travado por teste,
  para o dia em que o servidor mudar de comportamento.

- **O teste de conexão do MySQL/MariaDB diz o que a conexão _não_ garante.**

  No Postgres o teste abre `BEGIN READ ONLY` e com isso já exercita a proteção.
  Aqui não há proteção para exercitar: medido, dentro de
  `START TRANSACTION READ ONLY` o `TRUNCATE` esvazia a tabela e o `CREATE USER`
  cria usuário. A garantia mora na credencial — então o teste olha **os
  privilégios da credencial**, e o aviso é o produto.

  Dois avisos, independentes. `credential_can_write` quando a credencial pode
  mudar dado ou esquema: sem ele a tela diria "modo leitura" sobre uma conexão
  que apaga tabela, e a pessoa acreditaria. `privileged_role` quando ela tem
  `FILE` ou `SUPER`, que alcançam o host do banco — o análogo do aviso de
  superusuário do Postgres.

  A checagem soma as quatro tabelas de privilégio (global, database, tabela e
  **coluna**), porque basta um `UPDATE` numa única coluna para a conexão não ser
  somente leitura. Provado revertendo: sem `COLUMN_PRIVILEGES` esse caso passa
  despercebido. A comparação de `GRANTEE` é por igualdade com a forma canônica
  `'user'@'host'`, nunca `LIKE '%nome%'` — `ana` casaria as linhas de `mariana`,
  e uma checagem de segurança que erra para o lado permissivo é pior que não
  existir.

  Travado também: senha errada falha **sem devolver a senha** em lugar nenhum da
  resposta. Este projeto já devolveu a senha do banco em claro num 422, e nenhum
  teste unitário pegou.

- **A introspecção de MySQL/MariaDB** — a árvore de três níveis, contra
  `information_schema`.

  O Postgres tem conexão → database → **schema** → tabela; o MySQL tem
  conexão → database → tabela, porque `SCHEMA` e `DATABASE` são a mesma coisa
  lá. A resposta da API mantém a forma de sempre e a engine devolve **um** nó de
  schema com o nome do próprio database — mudar o formato do fio quebraria o
  Eden e todas as rotas por causa de uma engine, e quem esconde o nível é a
  tela, que já sabe disso pela capacidade.

  Medido: `information_schema` **já filtra por grant**. Um usuário com
  `GRANT SELECT ON loja.clientes` vê exatamente `clientes`, e o database que não
  lhe foi concedido não aparece — o equivalente do `has_table_privilege` que a
  introspecção do Postgres precisa pedir à mão. Há teste provando isso contra
  servidor real, em vez de o comentário afirmar e ninguém conferir.

  Quinta divergência medida entre as duas: `TABLE_TYPE = 'SEQUENCE'` só existe
  no MariaDB. Vira `table`, porque é o que ela é ali — um objeto que se lê com
  `SELECT` — e inventar um `RelationKind` que uma só engine produz seria pior.

  Os databases internos (`information_schema`, `performance_schema`, `mysql`,
  `sys`) somem da árvore, como os templates somem no Postgres. Provado
  revertendo, nos dois pontos.

- **Os três modos de TLS do MySQL/MariaDB**, com o único que não dá para
  entregar por IP recusado em voz alta em vez de fingido.

  `disable` e `require` funcionam por IP. `verify-full` só por hostname DNS: o
  `mysql2` descarta o nome do servidor quando o host é numérico, e a conferência
  de identidade passa a comparar contra `localhost` — recusaria até um
  certificado com `IP:<host>` entre os SANs. A saída que o `pg/ssl.ts` usa (um
  `checkServerIdentity` próprio) está fechada aqui, porque o driver a
  sobrescreve.

  Conectar sem conferir identidade e chamar de `verify-full` seria mentira com
  consequência: qualquer certificado da mesma CA se faria passar pelo servidor,
  e a senha do banco vai no fio **depois** do TLS subir. Então a combinação é
  recusada, com o motivo escrito — incluindo as duas saídas, e o aviso de que
  `require` criptografa sem autenticar.

  `verify-full` **não** foi tirado da engine: por hostname ele funciona de
  verdade, medido. Um teste de integração contra MySQL com TLS real trava as
  três situações, e o terceiro caso é um alarme — no dia em que o `mysql2`
  passar a validar SAN de IP, ele falha e avisa que a recusa pode cair.

- **A camada de tipos do MySQL/MariaDB, medida** — primeira peça da fase 2 do
  multi-engine. Ainda não conecta banco nenhum pela interface; é a trava que a
  regra 10 (todo valor de célula trafega como string) exige antes do driver.

  O `Bun.SQL` foi medido primeiro, porque a regra 3 manda preferir a primitiva
  do Bun. **Reprovou**: converte tipos sem opção de desligar, e a conversão de
  `DATE` depende de qual API se chama — a mesma coluna guardada como
  `2026-03-01` volta meia-noite local pelo template tag e meia-noite UTC pelo
  `unsafe()`, que em `America/Bahia` **aparece como 28 de fevereiro**. E
  `unsafe()` é o caminho do editor de SQL. Entrou o `mysql2` (JS puro, sem
  módulo nativo, então `bun build --compile` segue de pé).

  A trava: o `typeCast` devolve bytes crus e a decisão texto/hexadecimal sai
  dos metadados de coluna, porque o objeto do `typeCast` não expõe charset —
  ali `TEXT` e `BLOB` são os dois `BLOB`. A regra é `charset === 63` **e** o
  tipo estar na lista dos que carregam bytes; as duas condições vieram de erro
  medido, porque o MariaDB liga o `BINARY_FLAG` no JSON e porque número e data
  também dizem charset 63 (só ele fazia o inteiro `1` virar `"0x31"`).

  Teste de integração contra MySQL 8.4 e MariaDB 11 reais, 24 tipos, conferindo
  o texto exato de cada célula. Provado revertendo: com a regra só-charset,
  `id` volta `"0x31"` e a suíte falha.

  Medido junto, e resolve uma decisão que estava em aberto no plano: **no
  MySQL, `verify-full` funciona por nome de host e é impossível por IP.** O
  `mysql2` zera o `servername` quando o host é IP, a conferência de identidade
  cai no padrão `localhost` e recusa até o certificado legítimo; sem
  `verifyIdentity` não há conferência nenhuma, e um `checkServerIdentity`
  próprio é sobrescrito. Igual sob Bun e Node. Como a produção é alcançada pelo
  IP da tailnet, a validação vai recusar a combinação `verify-full` + IP em vez
  de tirar o modo de quem usa nome — detalhe em `docs/multi-engine.md` §3c.

- **Cada motor tem a sua marca na tela.** O formulário de conexão passou a
  abrir com um seletor de motor, e a linha da conexão na árvore mostra de qual
  banco ela é.

  Os sete glifos são desenhados aqui (`components/IconeEngine.tsx`), de uma cor
  só, herdando `currentColor`. Não são as logos coloridas de propósito: a tela
  já gasta cor em **estado** — âmbar é o acento e é o que significa modo
  escrita — e trazer sete paletas de marca colocaria sete cores novas
  competindo com as que já querem dizer alguma coisa. A divisão é **a forma diz
  qual motor é, a cor diz em que estado ele está**.

  Na árvore, a marca ocupa o lugar da tomada genérica que estava ali. Um ícone
  entra e um sai, então a densidade da linha não muda — e a tomada dizia "isto é
  uma conexão", que a árvore de conexões já dizia, enquanto a marca diz qual
  banco está do outro lado, que não estava escrito em lugar nenhum.

  Os motores ainda não implementados **aparecem apagados e não selecionáveis**.
  Sete opções iguais prometeriam sete conexões que funcionam, e hoje só uma
  funciona; o `disabled` do rádio nativo também os tira da navegação por setas.
  Quando uma engine entra, ela acende sozinha — a fonte é
  `ENGINES_IMPLEMENTADAS`.

  Em edição o seletor vira um selo fixo: `engine` é imutável por causa do
  ADR 005, e um seletor que não seleciona seria a tela mentindo.

  Há teste travando que **toda** engine da união aparece no seletor. É o furo
  que o typecheck não fecha: `GLIFOS` e `NOME_ENGINE` são `Record<Engine, …>` e
  quebram sozinhos, mas a lista de ordem é um array e uma lista incompleta é um
  array válido — dava para somar uma engine à união e a tela simplesmente não a
  desenhar, sem erro em lugar nenhum.

  Bundle: 312,40 → 314,25 kB gzip. TypeBox segue ausente (0 ocorrências).

- **`POST /connections` recusa engine que o DBee ainda não fala** (400
  `engine_not_implemented`).

  Achado ao revisar o seletor: a tela esconde as engines não implementadas, e
  esconder não é impedir — a rota continua alcançável por quem chama a API
  direto. O schema também não pega, porque a união `Engine` declara o alvo do
  plano e `"redis"` tem a forma certa. Sem a recusa a conexão era guardada e só
  quebrava muito depois, quando o driver de Postgres tentasse conversar com um
  Redis, com um erro que não explica nada.

  A checagem mora no serviço, não na rota nem no formulário, que é onde ela vale
  para qualquer chamador.

- **A conexão passou a saber qual banco está do outro lado** (`engine`), ainda
  com uma engine só. É a primeira fatia do multi-engine, e ela deliberadamente
  **não** adiciona engine nenhuma: o campo, a migration, a tabela de capacidades
  e a resposta da API entram enquanto ainda é possível verificar que **nada
  mudou** — a suíte passa sem alteração de teste.

  `engine` é **imutável depois de criada**: entra em `CreateConnection` e não em
  `UpdateConnection`. Não é preferência de interface, é o ADR 005 — a senha é
  cifrada com AAD amarrado ao id, então um `PATCH` que trocasse a engine
  continuaria decifrando e passaria a mandar o segredo para outro tipo de
  servidor. Há teste travando isso.

  Migration 007 aditiva (`EXPECTED_SCHEMA` 6 → 7). Aditiva de propósito: um
  binário anterior continua abrindo um banco v7, então rollback de deploy segue
  sendo opção.

  O formulário passou a derivar **quais campos existem** das capacidades da
  engine, em vez de tê-los fixos. Com `postgres` o resultado é idêntico ao de
  hoje — mesmos nove campos, mesma ordem — e é isso que torna a mudança
  verificável: a suíte passa sem alteração de teste e os screenshots batem nos
  quatro breakpoints.

  A capacidade governa **visibilidade**, não `disabled`. Campo desabilitado
  ainda afirma "isto existe aqui, você só não pode mexer", e para `timezone`
  num SQLite isso seria falso.

### Segurança
- **O `SAVEPOINT` do executor é a trava que impede o `COMMIT` do usuário de
  furar o modo somente-leitura — e isso não estava escrito em lugar nenhum.**
  `BEGIN READ ONLY` protege a transação corrente; um `COMMIT` no meio do SQL do
  usuário encerra essa transação, e num cliente cru o comando seguinte roda numa
  transação implícita **read-write**. Medido: `SELECT 1; COMMIT; CREATE TABLE …`
  cria a tabela no `psql`, e **não** cria no DBee — o `SAVEPOINT` que o executor
  emite antes de cada statement morre com `25P01` fora de bloco de transação, e
  o DDL nunca chega a rodar.

  A linha existia como mecanismo de retry do cursor, documentada só como isso.
  Agora está documentada como carga de segurança da regra 8, com teste de
  integração que trava o comportamento — quem "otimizar" o `SAVEPOINT` embora
  quebra o teste em vez de abrir um escape em silêncio.

  Vale só para o Postgres: medido, o MySQL aceita `SAVEPOINT` fora de transação
  em silêncio, então um driver novo que copie a estrutura **não** herda a
  proteção.

## [0.3.7] — 2026-09-09

### Corrigido
- **Não dava para executar consulta em produção.** `crypto.randomUUID is not a
  function` derrubava o clique inteiro de executar. A causa não é o código do
  DBee, é onde ele roda: `crypto.randomUUID` e `navigator.clipboard` só existem
  em **contexto seguro**, e a produção é alcançada pelo IP da tailnet em
  `http://` — um IP nunca é "potencialmente confiável" como `localhost`.

  Medido num origin `http://<ip>:porta` de verdade:

  | | |
  |---|---|
  | `isSecureContext` | `false` |
  | `crypto.randomUUID` | **ausente** |
  | `crypto.getRandomValues` | presente |
  | `navigator.clipboard` | **ausente** |
  | `document.execCommand` | presente |

  O `queryId` passou a vir de um `uuidV4` próprio, apoiado em
  `getRandomValues` — que **não** exige contexto seguro. A aleatoriedade
  continua sendo a do sistema: o `queryId` identifica a consulta a cancelar, e
  trocar CSPRNG por `Math.random` faria uma colisão cancelar a consulta de
  outra pessoa.

  O tipo do `lib.dom` é parte da causa e está registrado no código: ele declara
  `crypto.randomUUID` como **sempre presente**, e foi essa promessa falsa que
  deixou a chamada passar por typecheck, lint e revisão para quebrar só em
  produção.
- **Ctrl+C na grade não copiava nada** — mesma raiz. Sem contexto seguro,
  `navigator.clipboard` é `undefined`, e o Ctrl+C estourava no console em vez
  de copiar. A cópia passou a tentar a API moderna e cair no `execCommand`
  legado quando ela não existe. O aviso "copiado" só acende quando copiou de
  verdade: dizer que copiou sem ter copiado faria a pessoa colar o conteúdo
  antigo sem desconfiar.

  Vale por igual na conexão só-leitura e na de escrita habilitada. Verificado
  no navegador, servindo o app por IP sem TLS: clicar na célula, Ctrl+C, e
  Ctrl+V num campo devolveu o conteúdo da célula.

  O mesmo conserto vale para "copiar detalhes" da fronteira de erro e para as
  cópias do menu da árvore, que tinham o mesmo defeito silencioso.

## [0.3.6] — 2026-09-09

### Corrigido
- **A animação de export nunca completava, e às vezes nem aparecia.** Três
  causas, todas confirmadas:

  1. O componente sabe se completar — tem um estado `concluido` que enche as
     sete células — mas **o chamador nunca o passava**. Ao terminar o download o
     favo era simplesmente desmontado, no meio do preenchimento.
  2. A escala estava calibrada para o export que não existe: `log2` saturando
     em **4 GB**. Medido contra o servidor real, o que o DBee exporta é outra
     ordem de grandeza — uma tabela dá 44 kB (1 de 7 células), três tabelas em
     zip dão 1,9 MB (3 de 7), o dump SQL completo dá 8 MB (4 de 7). O favo
     nunca enchia no uso real.
  3. Não havia piso por tempo. Um export de 44 kB chega em 4 pedaços e 64 ms;
     só por bytes o favo dava um salto e sumia.

  Agora: a escala satura em ~64 MB, um piso por tempo decorrido garante
  movimento visível mesmo no export pequeno, a última célula é sempre do
  `concluido` — a animação só afirma "terminou" quando terminou — e o favo
  cheio fica na tela por 1,6 s, tempo de o mel terminar de descer (900 ms) e
  ainda ser lido.

## [0.3.5] — 2026-09-09

### Adicionado
- **Fronteira de erro.** Exceção em render, no React, desmonta a árvore inteira
  — não é degradação, é tela branca. Foi assim que a aba Diagrama derrubou a
  sessão de quem estava trabalhando: o defeito era de um diagrama, o dano foram
  as abas abertas, o SQL não salvo e a posição na tabela.

  Três fronteiras, uma por região independente: o **conteúdo da aba** (a que
  mais importa — a aba quebrada mostra o painel de recuperação e a barra de
  abas, a árvore e o cabeçalho seguem vivos), a **árvore** (que lê catálogo de
  bancos de terceiros, a superfície mais exposta a schema inesperado) e a
  **raiz**, como última rede.

  A tela mostra a mensagem real do erro, não "algo deu errado": o DBee é usado
  por um time de desenvolvimento, e é a mesma decisão que o projeto já toma
  sobre erro do Postgres. Tem "Copiar detalhes" com a pilha, e o
  `componentDidCatch` sempre escreve no console — a fronteira não engole nada.

  Trocar de aba **rearma** a fronteira (`resetKey` é o id da aba): sem isso, a
  aba seguinte, sadia, nasceria mostrando o painel de falha da anterior.

  Verificado no navegador com falha injetada: painel isolado com árvore e abas
  vivas, rearme estável em quatro alternâncias, e a variante de raiz cobrindo a
  janela nos dois temas.

### Adicionado
- **O estado da conexão passou a mostrar "conectando".** Faltava esse estado, e
  a falta aparecia no pior momento: ao expandir uma conexão, enquanto os
  databases carregam, o indicador não tinha evidência nova e caía de volta no
  resultado do último "Testar" — quem tinha um teste falho antigo via
  **vermelho justamente ao abrir a conexão que estava funcionando**. Foi esse o
  relato de quem usa.

  Também deixou de comunicar só por cor: verde e vermelho num ponto de 6 px são
  a mesma coisa para quem não distingue os dois matizes. Cada estado ganhou
  forma própria — anel vazado para "não testada", ícone girando para
  "conectando", ponto sólido para "conectada" e glifo de alerta para "não
  conectou". A forma muda só onde precisa: o estado de repouso continua um
  ponto calmo, e um "check" verde em toda linha seria ruído permanente.

  Verificado no navegador, com latência de rede emulada para a espera existir:
  "não testada" → "conectando…" → "conectada", e "não conectou" com o glifo de
  alerta numa conexão que falha de verdade.

### Desempenho
- **O CRC-32 do `.zip` iterava byte a byte pelo protocolo de iterador.**
  `for (const b of bytes)` sobre um `Uint8Array` cria um objeto
  `{ value, done }` **por byte** — num export de 200 MB, duzentos milhões de
  objetos de vida curta. É o único laço do projeto que roda uma vez por byte
  exportado, então é o único onde a forma do laço aparece no relógio de quem
  espera o download. Medido em 64 MB, com o JIT aquecido: **60 MB/s → 341 MB/s
  (5,6×)**, mesmo CRC — inclusive encadeado em pedaços, que é como o
  `ZipWriter` o usa.
- **A introspecção chamava `col_description()` uma vez por coluna.** A função
  faz a própria busca em `pg_description`; um `LEFT JOIN` resolve tudo em bloco.
  Medido num schema de 10.055 colunas: a consulta de colunas caiu de 83,1 ms
  para 35,0 ms (2,37×), e a introspecção inteira — 409 relações — de 105,8 ms
  para 71,2 ms (**1,49×**), com resultado idêntico linha a linha.
  `obj_description()` das relações mudou junto, para as duas ficarem na mesma
  forma.

  A troca tem dois modos de falha que não quebram nada visível: condição errada
  no `objsubid` faz o comentário da coluna aparecer como o da tabela, e condição
  incompleta faz o `LEFT JOIN` duplicar a coluna. Os dois agora têm teste de
  integração contra Postgres real.
### Desempenho
- **O navegador baixava o TypeBox inteiro sem usar nada dele.** O barril do
  `@dbee/shared` reexporta 16 módulos, e 13 declaram schemas com o `t` da
  Elysia. `t` é **runtime**: tocar o barril trazia o TypeBox para o bundle,
  mesmo importando uma função de três linhas.

  Medido com `bun build --minify` a partir do próprio `apps/web`, com os 13
  valores que o front de fato usa:

  | | bruto | gzip |
  |---|---|---|
  | pelo barril | 292.156 B | 79,8 kB |
  | por módulos livres de Elysia | 1.102 B | 0,48 kB |

  A lógica pura (montar SQL de `UPDATE`/`INSERT`/`DELETE`, DDL, CSV/TSV, split
  de statements) saiu para módulos `*.puro.ts`, sem `t`, e o pacote ganhou um
  segundo ponto de entrada, `@dbee/shared/puro`, que o front passou a usar para
  **valor**. Tipo continua vindo do barril: `import type` some na compilação e
  não custa byte.

  O bundle do web caiu de **371,90 kB para 311,62 kB gzip (−60,28 kB, −16,2%)**,
  e o chunk que carregava o TypeBox desapareceu — `grep` por `TypeBox`, `Kind`,
  `TypeCompiler` e `sinclair` no bundle novo devolve zero.

  Nenhuma função mudou: só a origem do import. Validação continua sendo do
  servidor, que é onde os schemas têm de estar.
### Desempenho
- **O plano do export abria uma transação por tabela.** A busca de índices e
  triggers era feita tabela a tabela, e cada chamada abria a própria transação:
  `BEGIN` + 2 consultas + `COMMIT`, vezes o número de tabelas, cada uma pegando
  e devolvendo um lease do pool. Para 60 tabelas eram **240 idas ao banco**.

  Passou a ser uma transação e duas consultas, agrupando por `(schema, tabela)`
  com `unnest` de dois arrays paralelos — quatro idas, independentemente do
  número de tabelas. Medido contra Postgres real com 60 tabelas: 86,6 ms →
  5,9 ms (**14,4×**), com as mesmas 180 definições. O ganho medido é em
  loopback; numa conexão remota o que domina é o número de idas, não o
  trabalho.

  O par entra por `unnest` e não por `IN` de strings montadas: o `IN` casa o
  **par**, não o produto cartesiano de schemas com tabelas, que traria a tabela
  homônima do schema errado.
### Desempenho
- **Auditoria: os filtros varriam a tabela inteira.** O `query_log` nasceu com um
  índice só, `(executed_at DESC)`, que serve "as últimas N" e mais nada. As
  outras três perguntas das telas de auditoria caíam em varredura completa com
  ordenação em B-tree temporária — a tela respondia, só demorava, que é como
  isso passou despercebido.

  Medido com o SQL que o repositório emite, num `query_log` de 1.000.000 de
  linhas:

  | consulta | antes | depois | |
  |---|---|---|---|
  | filtro por status | 394 ms | 0,093 ms | **4228×** |
  | filtro por ator | 286 ms | 0,093 ms | **3088×** |
  | paginação (página 2) | 178 ms | 0,096 ms | **1855×** |

  A migration 006 cria três índices e **derruba** o antigo, que virou prefixo
  estrito do novo — manter os dois pagaria escrita duas vezes pela mesma
  ordenação.

  **Três, não quatro.** `connection_id` ficou de fora de propósito: sem índice
  próprio a consulta por conexão já fica em 0,23 ms a 1M linhas, e 2,5× sobre
  algo sub-milissegundo não paga o preço. E há preço — o `query_log` recebe
  `INSERT` a cada query executada: 7,5 µs/linha com um índice, 12,3 com três,
  15,8 com quatro.

  **O índice sozinho não resolvia a paginação.** Com o `WHERE` na forma canônica
  em `OR`, o SQLite escolhe `MULTI-INDEX OR` e varre o índice — 46 ms mesmo com
  ele criado. A comparação de tupla `(executed_at, id) < (?, ?)` vira `SEARCH` e
  salta direto para a posição. A montagem do SQL saiu para uma função exportada
  para o teste poder conferir o **plano** do statement real, não o de uma cópia:
  filtro que vire `SCAN query_log` quebra o teste.

  A busca por substring no SQL continua varrendo, e há teste dizendo isso em voz
  alta — não é regressão, é o que `instr()` custa.

### Corrigido
- **Linha com `char(n)`, `boolean` ou `inet` não podia ser excluída nem
  editada — e a tela culpava um terceiro que não existia.** A guarda otimista
  comparava `col::text = $n`, e `col::text` **não é o que o driver entregou**:

  | tipo | o grid recebeu | `col::text` dá |
  |---|---|---|
  | `character(14)` | `"1234567890    "` (preenchido) | `"1234567890"` |
  | `boolean` | `"t"` | `"true"` |
  | `inet` | `"10.0.0.1"` | `"10.0.0.1/32"` |

  Nos três a guarda casava **zero** linhas, sempre. Zero não vira erro técnico:
  vira `row_changed`, que diz "a linha mudou desde que você a leu — recarregue e
  refaça". Mentira, e sem saída — recarregar traz o mesmo valor e falha de novo.
  Como a guarda do DELETE cobre **todas** as colunas não-PK, um único CNPJ em
  `char(14)` ou um `boolean` tornava a tabela inteira impossível de excluir.
  Schema contábil legado é feito disso.

  A guarda passou a `to_json(col)#>>'{}' = to_json($n::<tipo>)#>>'{}'`: os dois
  lados atravessam a mesma conversão, e `to_json` usa a função de saída do
  tipo — que é exatamente o que o driver entregou. Medido nos **dois** sentidos
  em 25 tipos contra Postgres real: valor inalterado casa 1 (senão a linha fica
  indelével) e valor mexido por terceiro casa 0 (senão a guarda não protege
  nada). Passa nos 25, inclusive `json`, `xml` e `point`, que não têm operador
  `=` e por isso derrubariam a alternativa óbvia (`col = $n::<tipo>`).

  O tipo é lido do catálogo **no servidor**, dentro da transação: vindo do
  cliente entraria no SQL e seria injeção. E é o tipo **base**, não o
  declarado — castar por um domínio faria o `CHECK` dele rodar, e em carga
  legada a constraint costuma entrar com `NOT VALID` justamente porque parte
  das linhas antigas não passa: a linha suja deixaria de poder ser corrigida ou
  excluída, que é o mesmo defeito por outra porta. Tipo em schema sem `USAGE`
  para o papel da conexão sai do mapa pelo mesmo motivo, e cai na forma antiga.

  Três desses caminhos vieram de uma revisão adversarial da própria correção, e
  todos têm teste que falha se o conserto for revertido — inclusive o que
  garante que a guarda **continua recusando** alteração de terceiro, porque
  afrouxar a proteção seria pior que o defeito original.
- **O export levava tabela que ninguém marcou, e o `.zip` perdia uma.** A
  identidade de uma tabela na tela era `${schema}.${tabela}`, e identificador do
  Postgres aceita ponto quando citado: `zz_a` + `"b.c"` e `"zz_a.b"` + `c`
  colapsavam na mesma chave. Marcar uma caixa marcava as duas, e o `key=` do
  React reconciliava as duas linhas como uma. É a colisão que o `nodeId` do
  diagrama já documentava ter corrigido; o export tinha ficado de fora.

  No servidor, o nome da entrada do `.zip` tinha o mesmo problema mais um: nome
  com barra virava **diretório** dentro do arquivo. Agora separador e byte de
  controle viram `_`, e o desempate é sufixo numérico — a segunda tabela sai
  como `nome (2).csv` em vez de sumir na extração.

## [0.3.1] — 2026-09-08

### Adicionado
- **Arrastar a grade para navegar.** Puxar o conteúdo com o botão esquerdo rola
  nos dois eixos, em vez de mirar numa barra de 8 px no rodapé. Numa tabela de
  30 colunas o conteúdo mede 6200 px numa janela de 1016 px — a barra é o
  caminho pior.
  - **Não conflita com a seleção** porque ela é `onClick`/`Shift+onClick`, não
    mousedown+move. Um limiar de 4 px separa as intenções, e o `click` que o
    navegador dispara ao soltar o arrasto é engolido na fase de captura —
    senão soltar mudaria a célula selecionada.
  - Só mouse: no toque o navegador já rola com inércia, e sequestrar isso
    trocaria um gesto bom por um pior.
  - O deslocamento escreve `scrollLeft`/`scrollTop` direto no nó. Um `setState`
    por `pointermove` re-renderizaria a grade a cada quadro, no caminho mais
    caro do app.
- **Dica que ensina o gesto**, no canto inferior esquerdo da grade. Arrastar não
  tem affordance nenhuma — sem alça, sem cursor diferente antes de começar — e
  gesto que ninguém descobre é gesto que não existe. Aparece **só quando a
  tabela transborda de verdade** (medido por `ResizeObserver` no scroller e no
  conteúdo) e some para sempre no primeiro deslocamento horizontal, por arrasto
  ou por qualquer outro meio: quem já sabe navegar não precisa ser ensinado.

### Corrigido
- **A aba Diagrama derrubava o app inteiro.** `Uncaught Error: Not possible to
  find intersection inside of the rectangle`, lançado pelo `dagre` dentro do
  `useMemo` do layout. Sem fronteira de erro no front, a exceção não estragava
  o diagrama — estragava a sessão de quem estava trabalhando.

  O gatilho não é o tamanho do schema, é a **forma**: duas FKs da mesma tabela
  para a mesma tabela (`empresa_origem_id` e `empresa_destino_id` apontando
  para `empresas`) viram arestas paralelas; somadas a uma FK na direção
  contrária, o dagre falha ao calcular a interseção da aresta com a caixa.
  Esquema contábil legado tem essa forma o tempo todo.

  O grafo de posicionamento passou a ser **dígrafo simples**, o que torna a
  aresta paralela estruturalmente impossível — e não perde nada, porque o dagre
  só é consultado para posto, e as FKs desenhadas continuam sendo todas. Fuzz:
  121 falhas em 6.000 grafos aleatórios com multigrafo, 0 com uma aresta por
  par. Além disso, o layout agora **degrada para a grade** se o dagre falhar
  por qualquer outro motivo: diagrama pior é melhor que sessão perdida.

## [0.3.0] — 2026-09-08

### Segurança
- **`GET /connections/:id/history` não provava acesso.** Devolvia o `query_log`
  de qualquer conexão a qualquer conta, e o id nem precisava ser adivinhado:
  `GET /saved-queries` é lista global por desenho e entrega o `connectionId` de
  conexões invisíveis. A invariante da fase 2 estava formulada como
  "`resolve(id, ator)`, por onde passa todo caminho que **fala com o
  Postgres**" — e essa formulação deixou de fora justamente a rota que lê dado
  sensível sem abrir conexão, porque ela lê o SQLite.
- **As rotas `/meta` não exigiam admin.** Um `member` sobrescrevia a URL de
  deploy do administrador — e como a resposta só devolve o booleano
  `webhookConfigured`, nada na tela dele denunciava —, disparava redeploy do
  container de produção, e ganhava um scanner HTTP da rede interna: com faixas
  privadas liberadas de propósito, o status do erro distingue "porta fechada"
  de "HTTP 403". A nota de risco do `update.service.ts` justificava o SSRF
  dizendo que "quem está autenticado já consegue apontar uma conexão para
  qualquer host:porta" — isso **deixou de valer** quando criar conexão virou de
  admin, e a nota não acompanhou.
- **O intervalo mínimo entre disparos só contava sucesso**, então não limitava
  a varredura, que rodava a ~1 ms por alvo. Agora conta a tentativa.
- **`POST /connections/:id/query/cancel` não provava acesso.** Não era
  explorável (o `queryId` é um UUIDv4 gerado no cliente), mas é rota com id de
  recurso sem prova no servidor.
- **10 senhas erradas trancavam o time inteiro por 15 minutos.** O balde por
  origem colapsa atrás do Traefik, onde todos compartilham um IP — e como a
  consulta acontece antes da verificação, acertar a senha não limpava nada. A
  chave passou a ser `origem|username`.
- **O teste que deveria ter pego tudo isso tinha um falso positivo dentro:**
  `POST /connections/:id/rows` não existe, e o 404 que a asserção comemorava
  vinha do roteador, não da negação de acesso. A lista escrita à mão virou
  **varredura de `app.routes`** — foi assim que o `/history` apareceu, e é assim
  que a próxima aparece sozinha.
- `users.repo.remover()` apaga as concessões na mesma transação, em vez de
  depender do `ON DELETE CASCADE` — o comentário do próprio arquivo diz que
  garantia de segurança não se apoia em `PRAGMA` que pode mudar longe dali.
- Caminho estático malformado (`/%`, `/arquivo%00.png`) devolve 404 em vez de
  500.

> **O DBee deixa de ser de uma pessoa só.** Contas individuais com papéis, e
> permissão por conexão: `admin` administra contas e conexões, `member` alcança
> só o que lhe foi concedido, e escrever exige as duas pontas — `write_enabled`
> na conexão **e** `can_write` na concessão. Duas migrations (004 e 005).
>
> Traz também um bug de disponibilidade que matava conexão em produção: o export
> `.sql` de tabela com múltiplo exato de 1000 linhas travava e prendia o lease
> do pool, deixando uma transação pendurada no banco do cliente.

### Corrigido
- **Responsividade: seis defeitos graves, todos com a mesma causa.** O app tinha
  **um** breakpoint, e ele decidia apenas coluna-vs-sobreposição; abaixo disso
  não havia adaptação nenhuma nos componentes de conteúdo. Um `flex`/`grid`
  desenhado para ~900 px, sem `min-w-0`, numa caixa de 300 px.
  - **A página rolava na horizontal na aba Dados**, em todo telefone: o
    `<select>` de filtro dimensiona pela opção mais larga — o nome de coluna
    mais comprido da tabela, 299 px — e o grupo não podia encolher. A 320 px
    sobravam 157 px fora da tela, levando junto a barra superior que no modo
    escrita **é** o alerta âmbar.
  - **O interruptor "Permitir escrita nesta execução" ficava fora da tela** a
    375 (+32 px) e 320 (+87 px). É o controle que faz a transação nascer
    `BEGIN READ WRITE`, e o aviso vermelho que ele liga aparecia abaixo, sem
    que se visse o controle.
  - **O inspetor cobria a barra superior inteira** abaixo de 1024 px — 304 de
    375 px — e não tinha *scrim*, ao contrário da árvore. O `design-system.md`
    §5.3 já registrava o sintoma desde setembro; o que fora corrigido na época
    foi a afirmação do doc, não o layout.
  - **O X de fechar dos modais de escrita era clipado** a 375 px, e os campos
    do "Nova linha" ficavam decepados na borda do painel.
  - **O campo Porta ficava 84 px fora do painel** a 320 px.
  - **Os botões de contas e de sair eram inalcançáveis** a 320 px: o lockup da
    marca era `shrink-0` e empurrava os dois para fora de um cabeçalho
    `overflow-hidden`. Agora o lockup cede e o wordmark volta a partir de `sm`
    — o ícone identifica a marca sozinho.
  - `overflow-x-hidden` no shell como rede de segurança: o mesmo erro passa a
    cortar o filho em vez de deslizar a página inteira.
  - Alvo de toque ≥44 px no toque (`max-lg:` no `Button` e na linha da árvore),
    sem mexer na densidade do desktop.
  - `scripts/check-responsivo.ts`: varre oito larguras × três cenas com dado
    real e **falha por elemento fora do alcance**, não só por a página rolar —
    a rede de segurança mascara o sintoma. Nenhuma das 466 asserções da suíte
    tinha como pegar esta classe.
- **Export `.sql` travava para sempre e matava a conexão** quando a tabela tinha
  múltiplo exato de 1000 linhas. Não era lentidão: o `FETCH` final volta com
  zero linhas, e nesse passo o caminho `sql`+`insert` não emitia nada **nem
  fechava o stream** — um `pull` que volta sem enfileirar e sem fechar nunca é
  chamado de novo. Com isso `aoTerminar` nunca rodava, o lease do pool ficava
  preso (o `sweep()` pula pools com lease, por desenho) e sobrava uma transação
  `REPEATABLE READ` pendurada no banco do cliente, segurando o horizonte do
  VACUUM. **Três exports e aquele par conexão+database ficava morto até o
  processo reiniciar.** Os outros formatos escapavam por acidente, cada um
  emitindo algo nesse mesmo passo. As fixtures tinham 2 e 3 linhas, então
  nenhum teste chegava a um `FETCH` de zero — agora há uma com exatamente 1000,
  e sem a correção ela estoura em 30 s.
- **O web estático não comprimia nem deixava cachear.** A resposta saía só com
  `content-type`: sem validador, o navegador rebaixava **1,38 MB a cada
  abertura**, inclusive na segunda do mesmo dia. Com gzip e `immutable` nos
  nomes com hash: 538 kB na primeira visita, **2,9 kB** nas seguintes, e o FCP
  medido caiu de 812 ms para 236 ms. O `index.html` fica `no-cache` de
  propósito — se ele cachear, depois de um deploy o app velho aponta para
  assets que já não existem.
- **Escrita habilitada aparecia em duas cores na mesma tela**: barra superior
  âmbar, aba vermelha, a 20 px uma da outra — e o `danger-surface` tinha três
  donos na mesma vista (a aba, a faixa de "sem chave primária" logo abaixo, e o
  erro de conexão na árvore). Vermelho volta a ser só do ato destrutivo.
- **`NULL` e `vazio` no grid mediam 2,11:1** — abaixo do piso que o próprio
  design-system afirma. Era `opacity-70` empilhado sobre um token já fraco. Num
  grid fiscal, distinguir NULL de zero é a leitura que importa.
- **Foco invisível no cabeçalho do grid**: o `:focus-visible` tinha o mesmo
  fundo do hover e o outline removido — 1,09:1 contra o vizinho, quando o
  mínimo para elemento de UI é 3:1.
- **Português vazando na interface em inglês**: nome da aba, menu de abas, menu
  da árvore, seleção do grid, `NULL`/`vazio`, e dois `aria-label`. Algumas
  chaves já existiam sem uso.
- `obrigatória` no formulário de nova linha usava **o mesmo vermelho do erro
  real**, e o modal abria parecendo ter quatro erros.

### Desempenho
- `staleTime` do schema alinhado ao TTL do servidor (30 s → 5 min): uma
  remontagem de aba rebaixava **2,87 MB** de catálogo para pedir de volta o que
  o servidor já tinha em cache.
- Página do grid de 200 para 500 linhas: rolar 2.000 linhas custava **nove**
  requisições, 3,2 s com RTT de 20 ms.

### Adicionado
- **A versão no cabeçalho pulsa quando há atualização.** Um anel âmbar que
  expande e some, e a versão passa de `text-subtle` para `text-accent`.
  **Anel, e não ponto**: verde é conexão viva neste app, e um ponto colorido no
  cabeçalho ficaria a poucos pixels dos pontos de saúde da árvore, dizendo
  outra coisa na mesma forma — a mesma colisão que o §10 já resolveu mudando a
  forma em vez do matiz. A cor acompanha o movimento porque animação sozinha
  não chega a quem tem `prefers-reduced-motion` ligado, que é exatamente quem o
  bloco global do `index.css` zera.
- **Permissão por conexão (fase 2 do multi-usuário).** A fase 1 entregou contas
  individuais e, com elas, o pior arranjo: auditoria correta e **todo mundo
  enxergando todas as conexões**. Agora `admin` vê tudo (ele as administra) e
  `member` vê só o que lhe foi concedido.
  - **Escrita exige as duas pontas**: `write_enabled` na conexão E `can_write`
    na concessão. Produção segue gravável para quem precisa sem virar gravável
    para quem recebeu leitura.
  - O controle mora num ponto só: `resolve(id, ator)`, por onde passa **todo**
    caminho que fala com o Postgres. Ele devolve `null` para quem não alcança —
    indistinguível de "não existe", porque responder "existe, mas não é sua"
    confirmaria o id — e o `writeEnabled` já rebaixado. As três portas de
    escrita não mudaram uma linha.
  - **Criar, editar e apagar conexão viraram de administrador.** Estavam
    abertos a qualquer autenticado, o que com o time dentro seria um `member`
    reapontando o host de uma conexão que ele nem enxerga.
  - **A auditoria segue a visibilidade**: sem isso um `member` lia no `/audit` o
    SQL de conexões que não aparecem na árvore dele.
  - Painel "Quem alcança esta conexão" no formulário de edição, só para admin.
    Aplica no clique, não no Salvar — revogar acesso é ação de segurança.
- **Contas para o time (fase 1 do multi-usuário).** Até aqui o DBee era travado
  em **uma** conta: `POST /auth/setup` recusa quando já existe usuário, e
  nenhuma outra rota criava conta. Distribuir só era possível compartilhando o
  login, o que quebra o `actor` do `query_log`.
  - Migração 004 acrescenta `users.role` (`admin`/`member`) e promove quem já
    existe — quando ela roda há no máximo uma conta, a do setup.
  - Rotas `/users` (listar, criar, trocar papel, resetar senha, remover), todas
    verificadas por `exigirAdmin` **no servidor**. O botão da tela só aparece
    para admin, mas isso é conveniência: quem recusa é a API, e há teste
    varrendo as cinco rotas com uma conta `member`.
  - A senha provisória é **digitada pelo admin**, não gerada — §7 é explícito
    sobre não produzir senha que precise ser exibida ou transportada. Ela nasce
    com `must_change_password`, que o guard já aplicava desde a v0.1 e que
    estava no schema sem uso.
  - Resetar senha e remover conta derrubam as sessões da pessoa. O `query_log`
    **não** é tocado: `actor` guarda o id, não uma FK, para a auditoria
    sobreviver à saída de quem executou.
- **Teste de paridade dos dicionários pt/en.** Chave nova entra à mão nos dois
  arquivos, e esquecer um não quebra build, typecheck nem lint — o `t()` devolve
  a própria chave e a tela mostra o identificador, só para quem usa aquele
  idioma. Cobre chaves faltando, valor vazio e parâmetros de interpolação
  divergentes entre os lados.

### Corrigido
- **A tela de troca de senha dizia que a senha tinha vindo do log do
  container.** Isso deixou de ser verdade quando a §7 removeu a senha gerada e
  impressa; desde a administração de contas, a provisória é escolhida por quem
  criou a conta e entregue por fora. O texto ficou para trás e passou a
  desinformar sobre a origem da própria credencial, nos dois idiomas.
- **`scripts/headless-shot.ts` escolhia qualquer usuário** (`LIMIT 1` sem
  ordem). Com contas novas no banco isso passou a cair numa que o guard prende
  na tela de trocar senha, e **todo screenshot virava aquela tela** sem aviso.
  Agora prefere uma conta sem troca pendente.
- **Diagrama virava tela vazia em schema grande.** Duas causas, ambas medidas
  contra Postgres real com 124 tabelas:
  - `enquadrar()` calculava a escala com `min(w/largura, h/altura, 1)` **sem
    piso**, enquanto o zoom pela roda já clampava em `0,15`. Num schema de 80
    tabelas ligadas à mesma dimensão (formato estrela, comum em contábil) isso
    dá escala `0,075`: a caixa de 220 px vira 16 px, sem texto nem borda
    legível. O piso passou a ser compartilhado pelos dois caminhos, e quando o
    desenho não cabe a vista ancora no canto em vez de centralizar — centralizar
    deixava a origem (onde ficam as tabelas raiz) fora da tela.
  - Dagre põe **todo nó sem aresta no mesmo posto**, e um posto é uma linha
    única: 150 tabelas sem FK viravam uma coluna de 13.240 px. Schema legado
    frequentemente não declara FK nenhuma. As tabelas soltas passaram a assentar
    numa grade quadrada abaixo do grafo ligado — 150 delas saíram de uma caixa
    renderizada de 12 px para 70 px.
  - O teste que deveria ter pego isso usava **cinco** tabelas e um teto de
    4000 px; passava com o layout quebrado. Agora trava a proporção e a escala
    de enquadramento com 150 tabelas.
- **O ponto de status da conexão só refletia o botão "Testar".** Quem testou uma
  vez com a senha errada, corrigiu e passou a usar a conexão continuava vendo
  vermelho para sempre — abrir a conexão, listar databases e rodar query nunca
  atualizavam nada. Carregar os databases **é** conectar, então essa evidência
  agora vence o resultado do teste, que é mais antigo por definição.
- **Os rótulos de status da árvore eram texto fixo em português** num app
  bilíngue: "conectada", "erro na última tentativa", "não testada" apareciam
  assim também em inglês. Passaram por `t()`, e o ponto ganhou `title` — antes o
  rótulo existia só para leitor de tela.


## [0.2.3] — 2026-09-08

> A tag `v0.2.2` existe mas **não gerou release**: o CI falhou no `verify`
> por causa do vazamento de pool corrigido abaixo, antes de qualquer push de
> imagem. Nada foi publicado sob ela.

### Corrigido
- **Dois testes de integração derrubavam o Postgres com o pool ainda aberto.**
  `bundle` e `ddl` removiam o container no `afterAll` sem chamar
  `pools.shutdown()` antes — os outros dez arquivos de integração já faziam. As
  conexões ociosas recebiam `FATAL 57P01 terminating connection due to
  unexpected postmaster exit` **depois** de os testes terem passado, e como
  ninguém esperava por elas o `bun test` contava `1 error` e saía com código 1
  com `0 fail`. Suíte verde, release vermelha.
- **A URL de deploy podia ser trocada ou removida — mas não pela interface.**
  O `PATCH /api/meta/update-settings` sempre aceitou outra URL (substitui) e
  `null` (apaga); o diálogo é que nunca ligou o caminho de volta:
  `editandoUrl` nascia `false` quando já havia URL e **nenhuma linha do código
  chamava `setEditandoUrl(true)`**. Quem colava a URL errada ficava com o botão
  "Atualizar servidor" disparando para o endereço errado, para sempre. Entram
  os botões **Trocar** e **Remover**, mais o **Cancelar** ao trocar — sem ele o
  beco só mudava de lugar. A chave de i18n `update.trocarUrl` já existia,
  órfã, desde a implementação original.
  - Remover pede confirmação: a URL é gravada cifrada e **nunca é devolvida**
    pela API (é credencial), então apagar por engano obriga a buscá-la no
    Dokploy de novo.


## [0.2.1] — 2026-09-08

> **Aviso de versão nova e botão de atualizar, dentro do app.** O cabeçalho
> passa a mostrar um selo quando há release mais nova; o diálogo traz o link
> das notas e o botão que pede o redeploy ao Dokploy. **Quem troca o container
> continua sendo o orquestrador** — o DBee avisa e pede (ADR 009).

### Adicionado
- **Criar tabela e criar database por formulário** (ADR 010), no menu de botão
  direito do database e do schema. **Só aparecem com a escrita ligada** na
  conexão — e o servidor recusa igual se a requisição vier direto na API, porque
  esconder o item de menu não é controle.
- **O comando fica à vista enquanto o formulário é preenchido**, montado pelo
  mesmo código do servidor: o que se lê é literalmente o que vai rodar.
- **Export de várias tabelas em aba própria**, no estilo do Adminer: filtro,
  contagem de linhas por tabela e marcação separada de estrutura e dados.
- **Painel de opções completo no export**: saída (baixar / comprimido / ver na
  tela), formato (SQL, CSV `;`, CSV `,`, TSV, JSON, NDJSON), estrutura
  (`none`/`CREATE`/`DROP+CREATE`), dados (`INSERT`, `INSERT + ON CONFLICT`,
  `COPY`) e inclusão de índices, triggers e funções.
  - Formato tabular de **várias** tabelas sai como **um arquivo por tabela num
    `.zip`**, escrito à mão (`apps/server/src/lib/zip.ts`) — validado contra o
    `unzip` do sistema e o `zipfile` do Python.
  - `COPY … FROM stdin` recarrega muito mais rápido que `INSERT` em tabela
    grande; é o que o `pg_dump` usa por padrão.
  - As opções `USE` e "Incremento Automático" do Adminer **não** existem aqui:
    são MySQL. Copiá-las seria cargo cult.
- **Criar database mudou de lugar**: sai do menu do database e vai para o da
  **conexão**. Um database nasce no cluster, não dentro de outro database.
- **Selo "Atualizar" no cabeçalho**, só quando há versão maior publicada. Vira
  ícone abaixo de `md`; sem ponto colorido, porque verde já significa "conexão
  viva" na árvore e a mesma forma diria outra coisa.
- **Diálogo de atualização** com versão atual, versão nova, link das notas,
  interruptor de verificação automática e o botão "Atualizar servidor". Enquanto
  o container é recriado, a tela avisa e recarrega sozinha quando o servidor
  volta.
- **`GET /meta/version`**, **`POST /meta/version/check`**,
  **`PATCH /meta/update-settings`** e **`POST /meta/update`** (DBee.md §5).
  Todas exigem sessão.
- **Versão gravada no binário** em tempo de compilação
  (`--define process.env.DBEE_VERSION`), passada pelo `release.yml` a partir da
  tag. Fora do container o valor é `dev`, que nunca compara com tag.
- **`release.yml` cria a Release no GitHub** a cada tag, depois do push da
  imagem. Sem isso, `releases/latest` devolve 404 mesmo com a tag publicada e o
  selo nunca acenderia (§11.27c).

### Alterado
- **Tela de login redesenhada**: ilustração à esquerda, formulário à direita,
  num cartão único. A vitrine antiga empilhava selo, mascote com halo, duas
  auroras animadas, favo de fundo, slogan e três provas — sete elementos
  disputando a mesma coluna. Agora a ilustração **é** a vitrine, e tudo em
  volta fica quieto.
  - O mascote saiu da tela: a cena já tem a abelha, e repeti-la ao lado é a
    redundância que o `design-system.md` §1.4 lista.
  - **Não entram "criar conta", "esqueci minha senha" nem "lembrar de mim".**
    Nenhum dos três existe no servidor: não há rota de recuperação, e a sessão
    tem expiração absoluta de 12 h, sem modo prolongado. Controle que não faz
    nada é pior que a ausência dele.
  - Dez chaves de i18n ficaram órfãs com a vitrine antiga e foram removidas.
  - **Dois rótulos sobre a ilustração** — uma frase no canto superior esquerdo e
    uma linha versalete no inferior direito, cada uma com um traço âmbar. Sobre
    a arte crua o branco media **1,01:1** (nuvem e pedra claras): o véu diagonal
    que os acompanha leva o pior caso a **5,06:1** e **5,90:1**, medido em seis
    larguras entre 1024 e 2560, porque o recorte muda com a janela. Só a partir
    de `lg` — abaixo disso a ilustração é uma faixa de 160 px, e frase ali é
    entulho.
  - **O favo do lado do formulário virou dois acentos de canto**, sem a
    tesselação que cobria a coluna inteira: ela virava textura sob os campos e,
    no tema claro, competia com eles.
  - **Ilustração trocada e recomprimida**: 1800x2249, 233 KB. A arte entregue
    tinha 5,2 MB, e essa tela carrega **antes** de qualquer sessão — é o
    primeiro byte que o usuário espera. `width`/`height` do `<img>` seguem a
    arte (reservam a caixa e evitam o pulo de layout), então trocar a
    ilustração sem atualizá-los reintroduz o salto.
- **Estado vazio enxugado.** Eram 45 palavras em três blocos — título,
  parágrafo e uma terceira linha que repetia o título — para dizer "abra uma
  conexão". Agora são o título e uma frase, e o mascote encolheu de 96 para
  64 px e perdeu o halo difuso: ele aparece toda vez que uma aba fecha, e o
  que é bonito no login vira insistente repetido o dia inteiro. O texto que
  explicava o carregamento sob demanda da árvore saiu: era nota de
  implementação, não instrução.

### Corrigido
- **O `.sql` exportado não recarregava quando a tabela tinha coluna `serial`.**
  Ela saía como `integer DEFAULT nextval('t_id_seq')` — o que ela é —, e o
  `psql` parava em `relation "t_id_seq" does not exist` num banco vazio, porque
  a sequência não era criada. Agora sai `serial`/`bigserial`. Valia para o
  export de **uma** tabela também, que já existia. Travado pelo teste que
  recarrega o dump e confere os valores.

### Alterado
- **`deploy/docker-compose.yml` ganhou `pull_policy: always`.** Sem ele, um
  redeploy reusa a `:latest` já em cache no host e não traz nada — o botão diria
  sucesso sem atualizar (§11.27b).
- **`docs/DBee.md`:** §5 e §8 reescritas; o repo é **público**, não privado como
  o doc afirmava — é o que dispensa token na consulta de versão.

### Segurança
- **Nenhuma rota de DDL aceita SQL.** O comando é montado no servidor a partir de
  campos estruturados: identificador citado, tipo de lista fechada, default que é
  literal escapado ou expressão de lista fechada. Testes cobrem o vetor de fechar
  a aspa e emendar `DROP`, contra Postgres real — a tabela alvo continua de pé.
- **`CREATE DATABASE` roda fora de transação** (não há alternativa: o Postgres o
  recusa dentro de uma). O caminho é estreito e tem um único chamador, e o motivo
  está travado por teste, não só por comentário.
- A **URL de deploy é credencial** e não sai da API: `GET /meta/version` devolve
  `webhookConfigured: boolean`, nunca a URL. Nem a resposta de erro, nem o corpo
  devolvido pelo Dokploy (que pode conter a própria URL) atravessam para o
  cliente. Travado por teste de integração.
- Guardada **cifrada** no SQLite com a mesma AES-256-GCM das senhas de conexão,
  com AAD próprio (`app:update_webhook`) — um `password_enc` copiado para essa
  chave falha na decifragem em vez de passar.
- **Mitigação de SSRF** na URL configurável: só `http`/`https`, endereços de
  metadado de nuvem barrados, redirecionamento não seguido e resposta cega.
  Faixas privadas seguem liberadas de propósito (o Dokploy vive numa).
- **Intervalo mínimo entre disparos**, para cliques repetidos não virarem
  deploys enfileirados. Quem disparou fica no log do servidor.

## [0.1.3] — 2026-09-05

> **Corrige um bug bloqueante de login em produção sem TLS.** A **0.1.2** (e
> anteriores) emitia o cookie de sessão com `Secure` incondicional. O navegador
> **descarta** um cookie `Secure` recebido sobre `http://`, então no acesso por
> IP da tailnet (`http://100.x.x.x:3001`, o caminho documentado sem domínio) o
> login autenticava, o cookie era jogado fora, e a tela voltava para o login —
> **sessão impossível**. Quem acessa por `http` deve atualizar.

### Corrigido
- **Cookie de sessão `Secure` agora é condicional** (§11.44): segue o protocolo
  da requisição (`https` ⇒ `Secure`, `http` ⇒ sem), com override explícito por
  `DBEE_COOKIE_SECURE` (`true`/`false`) para o caso de **TLS que termina no
  proxy** (Traefik/Dokploy com domínio — defina `DBEE_COOKIE_SECURE=true`).
  `HttpOnly` e `SameSite=Strict` seguem inegociáveis — só o `Secure` mudou.
  Coberto dos dois lados em `auth.test.ts` ("cookie Secure segue o protocolo"):
  login sobre `http` emite cookie sem `Secure` **e** a sessão seguinte é aceita;
  sobre `https` vem `Secure`; a env explícita vence o protocolo nos dois sentidos.

### Adicionado
- **`DBEE_COOKIE_SECURE`** — nova variável de ambiente (ver README). Opcional;
  o default (seguir o protocolo) atende tanto o acesso `http` por IP da tailnet
  quanto o `https` direto.

## [0.1.2] — 2026-09-05

### Adicionado
- **Export de tabela como `.sql`** (novo formato no menu Exportar, na aba Dados):
  `CREATE TABLE` de referência montado da introspecção (colunas com tipo, nulidade
  e default, mais a PRIMARY KEY) seguido de um `INSERT` por linha, tudo em stream
  pelo mesmo cursor dos outros formatos. Só na origem tabela — numa consulta
  arbitrária não há tabela de destino para o `INSERT`, e o backend recusa com 400.
  Todo valor sai como literal de texto com aspas simples dobradas (`NULL` para
  nulo), e o Postgres coage o literal para o tipo da coluna no destino — coerente
  com a regra 10. Dentro da fronteira (ADR 006): dados por `SELECT`, DDL **gerado**,
  sem `pg_dump`. FKs, índices não-PK, checks e grants ficam de fora, e o cabeçalho
  do arquivo diz isso. Coberto por teste de integração que roda o `.sql` gerado num
  database vazio e confere a recriação.

### Corrigido
- **Tab completa a sugestão do autocomplete** no editor SQL, em vez de pular para o
  botão Consultar. `acceptCompletion` entra antes do `completionKeymap`: com o popup
  aberto, Tab aceita; fechado, Tab segue o comportamento normal.
- **Popover de Exportar** agora dispõe os formatos em grade 2×2 em vez de uma fila
  única — com o quarto formato (SQL), a fila apertava e cortava o rótulo. Largura
  do popover limitada à viewport (`min(20rem, 100vw − 1.5rem)`) para não vazar a
  borda em 375 px.
- **Responsividade do cabeçalho** em telas estreitas: o lockup da marca deixou de
  ser cortado (`shrink-0`), o breadcrumb da conexão some abaixo de `md` (a barra de
  abas já nomeia a tabela), e o selo "Escrita habilitada" encolhe para só o cadeado
  abaixo de `sm` (rótulo por `aria-label`), em vez de empurrar a marca para fora.

## [0.1.1] — 2026-09-05

> **Corrige um defeito grave da 0.1.0.** A **0.1.0** — publicada no GHCR como
> `:latest` — tem um bug que **quebra o grid em qualquer coluna `date`/
> `timestamptz`** (`Objects are not valid as a React child: [object Date]`) e,
> pior, **corrompe em silêncio** qualquer célula de texto cujo valor pareça uma
> data ISO. Causa: o cliente Eden convertia, por padrão, strings ISO em `Date`,
> violando a regra 10 (§11.43). A **0.1.1** corrige com `parseDate: false`,
> travado por teste de fronteira. **Quem estiver na 0.1.0 deve atualizar.**

### Adicionado
- **Navegação por FK** e **queries salvas** — ver as entradas abaixo (fatia de
  2026-09-05, junto do fix do Eden).
- **Autocomplete abre sozinho ao digitar** (VSCode-like): `activateOnTyping` ligado
  com 120 ms de respiro; Esc fecha, Ctrl+Espaço força. O popup foi repaginado —
  entrada encenada (`dbee-settle`), material de overlay com sombra, opção
  selecionada no leito âmbar com régua da marca, trecho que casa em âmbar e ícone
  colorido por tipo (tabela/coluna/palavra-chave). Alimentado pelo schema completo.
- **Split do `/schema`** (Fase 2, dívida de perf): a árvore de navegação passou a
  usar um endpoint leve `GET /schema/tree` (só schema → relação: nome, tipo,
  estimativa) em vez do schema completo. Num catálogo de 800 relações o payload
  cai de ~2,66 MB para dezenas de KB; colunas/índices/FKs vêm do `/schema`
  completo só quando uma tabela é aberta. "Copiar lista de colunas" no menu da
  árvore passou a buscar o schema completo sob demanda.
- **Nova linha (INSERT)** (v0.2), fechando a escrita: `POST /rows/insert` informa só
  as colunas escolhidas — as omitidas ficam com default/sequence do Postgres. O
  formulário nasce esperto (coluna com default ou nullable já vem em "default";
  NOT NULL sem default pede valor), com o mesmo preview do diff literal e checkbox
  de NULL. Construtor `construirInsert` unit-testado; integração real cobrindo
  serial+default preenchidos sozinhos e NOT NULL sem valor virando erro sem inserir.
- **Cancelamento de query** (v0.2): o cliente manda um `queryId` na execução; um
  botão "Cancelar" (visível enquanto roda) chama `POST /query/cancel`, que dispara
  `pg_cancel_backend(pid)` numa conexão **fora do pool** (cancela-se justamente
  quando o pool está ocupado). A query volta com o código 57014 e o `query_log`
  marca `cancelled`, não `error`. Só o próprio backend é sinalizado — nunca
  `pg_terminate_backend` (ADR 006). Integração contra Postgres real.
- Timezone no cadastro de conexão virou **select** (lista IANA nativa do runtime),
  fechando a porta ao erro de digitação que só aparecia ao conectar.
- **Edição de linha** (v0.2), a metade de UI da fatia de escrita: duplo clique numa
  célula edita inline; Enter abre o **preview do diff** (o SQL com valores
  literais, '2026-03-01' e não `$1`) para confirmar antes de aplicar; selecionar
  uma linha mostra "Excluir linha", também com preview. Só aparece quando a
  conexão tem escrita habilitada e a tabela tem PK. A execução liga parâmetros; o
  literal é só para leitura. Modal em `RowEditModal`, grade editável em
  `ResultGrid` (`editavel`/`onEditCell`). Ao aplicar, a grade recarrega.
- **Auditoria** (v0.2): tela de `query_log` pesquisável — filtro por texto do SQL
  (substring case-insensitive), estado, conexão e autor, combinando com AND;
  paginação por keyset ("Carregar mais"). Rota `GET /audit`, só-leitura. Aberta
  pelo menu da conexão ("Ver auditoria"), cross-conexão. Títulos de aba passaram
  a ser traduzidos (`tabTitle(tab, t)`).
- Scaffold do monorepo com Bun workspaces: `apps/server` (Elysia), `apps/web` (React + Vite), `packages/shared`.
- `GET /api/health` respondendo 200.
- TypeScript strict em todo o workspace, ESLint com regras type-aware, `bun test`.
- Dockerfile multi-stage sobre `oven/bun` com `bun build --compile`, runtime `debian-slim`.
- `deploy/docker-compose.yml` para o Dokploy.
- GitHub Actions publicando no GHCR a cada tag `v*`.
- Spike de validação do `pg` + `DECLARE CURSOR` sob Bun em `scratch/spike-cursor.ts`.
- `dbee --healthcheck`: o binário compilado faz o próprio healthcheck com `fetch` nativo,
  o que tirou o `curl` da imagem final (260 MB).
- ADR [001](docs/adr/001-modo-read-only-por-transacao.md) (modo read-only por transação) e
  [002](docs/adr/002-typescript-pinado-em-5-9.md) (TypeScript pinado em 5.9.3).

- Base local: migrations do `bun:sqlite` aplicadas no boot, cifra AES-256-GCM das senhas
  com chave scrypt derivada uma vez no boot (salt de 32 B em `app_meta`), CRUD de conexões
  e teste de conexão via `BEGIN READ ONLY`.
- `ssl_mode` reduzido a três modos sem negociação, ADR
  [003](docs/adr/003-modos-de-ssl.md).
- Design system derivado de `assets/` — tokens, movimento e regras em
  [docs/design-system.md](docs/design-system.md), contraste travado por teste.
- Tela de conexões: lista densa com tag de risco, painel lateral de cadastro, esqueleto de
  carregamento e a marca animada como estado de espera.
- Arquitetura em camadas documentada em [docs/arquitetura.md](docs/arquitetura.md).

- Introspecção de schema: `GET /connections/:id/schema` com árvore schemas → relações →
  colunas, tipos, PK/FK e índices, cache em memória de 5 min e `?refresh=1`. Tudo em
  `BEGIN READ ONLY`.
- Gerência de pools por (conexão, database), `max: 5`, com varredura dos ociosos.
- Sora bundlada (`@fontsource-variable/sora`, só o subset latin, 33,6 KB).

- **Shell de três zonas.** A conexão deixa de ser página e vira a raiz da navegação:
  árvore `conexão → database → schema → relação` com expansão lazy, abas de tabela com
  sub-abas Estrutura e Índices, e inspetor de coluna à direita. `Dados` é placeholder até
  o executor de query.
- `GET /connections/:id/databases` — primeiro nível da árvore.
- Busca na árvore, trazida da v0.3 para a v0.1 (§9), sem diferenciar acento nem caixa.
- Estado de perigo para conexão com escrita: nó inteiro, tarja em toda aba e barra
  superior, com o banco ativo sempre visível.
- Menu de contexto por botão direito em todo nó da árvore e em toda aba, com ações
  próprias de cada nível.
- Abaixo de 1024px, árvore e inspetor viram sobreposição — como colunas fixas, em 375px
  o centro da tela desaparecia.

- **Executor de query** (`POST /connections/:id/query`), conforme §6: `BEGIN READ ONLY`
  ou `READ WRITE`, `set_config` para `TimeZone` e `statement_timeout`, `DECLARE` /
  `FETCH maxRows+1` / `CLOSE`, truncamento marcado, valores como string com o tipo real,
  múltiplos statements em sequência e `position` corrigida pelo prefixo calculado.
- `query_log` gravando toda execução, inclusive as que falharam, e
  `GET /connections/:id/history`.
- Aba de query com textarea e tabela HTML — andaime deliberado até o CodeMirror e o
  TanStack Table.

- **Editor SQL** com CodeMirror e `lang-sql`, realce nos tokens da marca, `Cmd+Enter`
  rodando o statement sob o cursor e `Cmd+Shift+Enter` o script inteiro.
- **Grid virtualizado**, com `NULL`, string vazia e a string `"NULL"` distinguíveis, e
  alinhamento pelo tipo real da coluna.
- **Sub-aba Dados funcional** por `POST /connections/:id/tables/:schema/:table/rows`, com
  paginação keyset, filtro e ordenação. Sem chave primária a UI avisa em vez de fingir.
- Quatro portas de entrada de consulta: `+` na barra de abas, `Cmd+T`, "Nova consulta
  aqui" no menu do database, e "Consultar" na aba Dados abrindo já preenchida.
- `splitStatements` movido para `packages/shared`: o editor e o servidor separam
  statements com a **mesma** função.

### Adicionado
- **Navegação por FK.** Na aba Estrutura, a coluna com FK abre a tabela
  referenciada; no grid (Dados), a célula de uma coluna com FK ganha um salto que
  abre a tabela referenciada **já filtrada pela linha** (FK composta usa todas as
  colunas na ordem). Se o papel não pode ler a tabela referenciada, o salto não
  aparece (a introspecção filtra por `has_table_privilege` da referenciada).
- **Queries salvas.** Salvar a query da aba com nome, listar/abrir/renomear/
  excluir, busca por nome e por conteúdo do SQL. Abrir cria aba atrelada à conexão
  de origem. Liga a tabela `saved_queries`, que existia desde a migration 001.

### Corrigido
- **Grid estourava em qualquer coluna de data (`[object Date]`).** O Eden Treaty
  converte, por padrão, strings ISO em `Date`; uma célula `date`/`timestamptz` (ou
  texto que pareça data) chegava como `Date` e o grid quebrava — e, sem quebrar,
  perdia o valor textual exato do Postgres. `parseDate: false` no cliente Eden
  (`lib/api.ts`). Ver DBee.md §11.43.

### Alterado
- Lockup "DBee" ganhou tipo próprio (Space Grotesk) e mais presença no cabeçalho.

### Segurança
- **Primeiro acesso pela tela de setup — nenhuma senha em log.** Antes o boot
  gerava a senha do `admin` e a imprimia no log do container (visível no painel
  do Dokploy). Agora, sem conta, o boot grava um token em `/data/setup-token`
  (modo `0600`) e loga só o caminho; o operador lê o token do volume e cria a
  primeira conta — usuário e senha à escolha — na tela de setup. `GET/POST
  /auth/setup` são abertas; a segunda criação é barrada por `setup_done`. O token
  é apagado ao concluir. Coberto por integração.
- **O binário voltou a servir a UI em produção.** O guard 401ava `GET /` e os
  assets (serve só a API), e não havia serviço de estático montado — o container
  respondia só JSON e a tela de login/setup nunca aparecia. O guard passou a
  ignorar tudo fora de `/api`; a raiz serve o build do Vite por `Bun.file` com
  fallback SPA e `Content-Type` explícito. Pego pelo screenshot do container
  real, não pela suíte (DBee.md §11.42).
- **O DELETE de linha ganhou a mesma guarda otimista do UPDATE.** Antes o `WHERE`
  do DELETE tinha só a PK: se outra pessoa alterasse a linha entre a leitura e o
  clique, o DELETE apagava mesmo assim — e DELETE não volta. Agora a requisição
  carrega os valores originais das colunas não-PK e o `WHERE` os repete (`col::text
  = valor`, `IS NULL` para nulos); linha mudada casa 0 e aborta com `row_changed`
  ("a linha mudou desde que você a leu"), dentro da transação, sem gravar. Cobre o
  mesmo caso que o UPDATE já tratava. Integração contra Postgres real, com uma
  segunda sessão alterando a linha no meio.
- **Tentativa de escrita negada vai ao `query_log`.** Um UPDATE/DELETE/INSERT numa
  conexão sem `write_enabled` era barrado (403) mas não registrado. Agora a tentativa
  é logada com o SQL literal da intenção, o actor da sessão e `status: error` — o
  evento que uma auditoria existe justamente para registrar.
- **A senha do banco voltava em claro na resposta 422 de validação.** O formato de erro
  padrão do Elysia inclui um campo `found` com o corpo submetido inteiro, então qualquer
  erro de digitação no formulário mandava a senha para o devtools, o HAR e qualquer log de
  resposta no caminho. Agora há `onError` próprio que diz qual campo falhou e nunca o
  valor. Regra 5 do `CLAUDE.md`, §11.19.
- `POST /connections/:id/test` não declarava corpo, então aceitava `form-urlencoded` — um
  *simple request*, acionável por CSRF sem preflight.
- `host` iniciado por `/` era aceito e o `pg` o trata como socket unix em vez de TCP.
- Cifra v2 com o id da conexão como AAD (ADR 005): sem ele, quem tivesse escrita no volume
  podia trocar o `password_enc` entre conexões e a senha de produção ia para outro host.
- `verify-full` com host IP passa a validar o IP contra os SANs `iPAddress` do certificado
  (ADR 003, adendo). Antes falhava contra certificado correto e empurrava o usuário para
  `require`, que não autentica ninguém.
- `::selection` usava a mesma cor sólida do selo de escrita, fazendo texto selecionado
  parecer um selo de estado.
- `BEGIN READ WRITE` passa a exigir `readOnly: false` **explícito** na requisição, além do
  `write_enabled` na conexão. Omitir o campo significa leitura: campo ausente tem que
  significar o estado seguro.
- O boot aborta se a porta já estiver sendo servida — sob Bun os dois processos escutariam
  ao mesmo tempo e as respostas alternariam entre eles (§11.25).

### Corrigido
- **`PATCH /connections/:id` corrompia campos não enviados.** O `default` dos schemas
  TypeBox era materializado na validação, então um patch só do nome reapontava a conexão
  para a porta 5432. Os defaults saíram do schema e ficaram no repositório, onde só valem
  na criação. Registrado em `DBee.md` §11.15.
- `SET LOCAL TimeZone = $1` dava erro de sintaxe — `SET` não aceita placeholder. Trocado
  por `set_config`. Registrado em §11.16.
- Introspecção rodava quatro consultas em `Promise.all` no mesmo client, o que o `pg`
  deprecou. Agora em sequência. Registrado em §11.18.
- `evict()` de pool encerrava a conexão com transação em voo, abandonando quem estava na
  fila do `connect()` — o pedido só falhava 10 s depois e virava 502, culpando o Postgres
  por uma fila do próprio DBee. Agora sai do mapa na hora e encerra quando o último
  empréstimo volta.
- Migration fora de ordem no array regravava a versão para trás e deixava o container em
  loop de restart no boot seguinte. §11.24.
- A introspecção afirmava snapshot consistente que `BEGIN READ ONLY` não dá — o isolamento
  default é READ COMMITTED. Agora usa `REPEATABLE READ`. §11.20.
- Índice misto de coluna e expressão devolvia lista de colunas incompleta, exibida como
  índice de coluna única. §11.22.
- `oid::int` fazia wrap para negativo acima de 2^31 e divergiria do `dataTypeID` do
  resultado de query. §11.21.
- TTL do cache de schema era contado do início da introspecção: numa árvore lenta a
  entrada nascia expirada e o cache parava de funcionar.
- Requisições simultâneas na mesma árvore disparavam uma introspecção cada; agora
  compartilham a que já está em voo.
- `DBEE_CA_CERT=""` passava `ca: ""` e desligava o CA store do sistema, quebrando todo
  `verify-full`. §11.23.
- `APP_SECRET` só com espaços passava em produção; `PORT` inválido virava 0 ou NaN.
- `timezone` inválido só falhava no `set_config` e virava 502.
- Cliente com `ROLLBACK` falho voltava ao pool possivelmente em transação; agora é
  descartado.
- Desligamento limpo em `SIGTERM`/`SIGINT`.

### Adicionado
- **Idioma PT/EN** (fechamento da v0.1). Dicionário próprio em `apps/web/src/i18n/`
  (sem dependência), `t()` com interpolação e `Intl` para número/data; o `en.ts` é
  `Record<keyof pt, string>`, então tradução faltando é erro de compilação. A UI
  inteira passa por `t()`, incluindo login, troca de senha, árvore, abas, grade,
  inspetor, diagrama, export, formulário de conexão e menus. Mensagens do servidor
  traduzidas **pelo código** (`ErroApi` preserva o `code`; fallback na `message`); o
  erro do Postgres vai intacto para a tela. A escolha vive no **registro do usuário**
  (migração 003, `PATCH /auth/locale`, `user.locale` no login/`/me`), com
  `localStorage` cobrindo a tela de login antes de haver sessão. Alternador PT/EN na
  barra superior e na tela de entrada.

### Alterado
- Detalhe de favo de mel hexagonal (`HoneycombCluster`) nos dois cantos superiores
  do cabeçalho, casando com a marca "DBee", e no pé da barra lateral de conexões —
  substituindo a tesselação difusa por um cacho finito de hexágonos flat-top.
- Marca "DBee" no cabeçalho com "Bee" em âmbar (`text-accent`), igual ao login.
- Paleta clara re-rampada: elevação agora sobe para o **branco** em vez do creme
  escuro (o `raised` era mais escuro que o `surface`, invertendo a hierarquia).
  Creme vai para o fundo (`sunken`), o que se eleva embranquece — aba ativa,
  card e menu saltam contra o fundo quente.
- Âmbar mais presente nos **dois** temas: novos tokens `accent-soft` (leito
  âmbar) e `accent-line` (borda âmbar), travados em `contrast.test.ts`. Aba
  ativa ganha topo âmbar + leito `accent-soft`; sub-abas idem; hover de botão
  fantasma/secundário vira âmbar. Perigo (conexão gravável) continua vencendo o
  âmbar — vermelho é o sinal mais forte e não é diluído pela cor de marca.
- Vitrine do login reformulada como hero comercial: selo "Cliente PostgreSQL ·
  self-hosted", mascote com halo âmbar, marca "DBee" (D e Bee no mesmo corpo,
  distinção só de cor — Bee em âmbar), slogan da marca ("Organize. Query. **Build
  What's Next.**") e três provas com marcador de favo, tudo com entrada encenada
  (`animate-enter`) em sequência. Correção: o texto da vitrine passou de
  `text-ink` (que invertia para escuro no tema claro, sumindo sobre o fundo
  grafite fixo) para `text-bone`, sempre claro.
- Login: o favo de mel de fundo saiu do lado do formulário (competia com os
  campos) e virou **cacho de canto** no rodapé direito — novo componente
  `HoneycombCluster` (hexágonos flat-top finitos, parte cheios, parte contorno).
  Rótulos dos campos acendem em âmbar no foco (`group-focus-within`).
- `CLAUDE.md` movido de `docs/` para a raiz do repo, onde ferramentas de agente o carregam
  por convenção.
- ESLint passa a rodar `eslint-plugin-react-hooks` sobre `apps/web`.

### Corrigido
- `DBee.md` §6: a receita de sessão read-only usava `SET LOCAL default_transaction_read_only = on`
  dentro de um `BEGIN` já aberto, o que **não** torna a transação read-only — `UPDATE`, `DELETE`,
  `TRUNCATE` e DDL passavam. Substituída por `BEGIN READ ONLY`. Ver §11.4b.
