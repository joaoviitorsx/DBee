-- Índices da auditoria.
--
-- O `query_log` nasceu com um índice só, `(executed_at DESC)`, que serve a
-- pergunta "as últimas N" e mais nada. As telas de auditoria fazem outras três,
-- e as três caíam em varredura completa com ordenação em B-tree temporária.
--
-- Medido contra um `query_log` de 1.000.000 de linhas, com o SQL que o
-- `queryLog.repo.ts` emite:
--
--   filtro por status ......... 394 ms  ->  0,093 ms   (4228x)
--   filtro por ator ........... 286 ms  ->  0,093 ms   (3088x)
--   paginação (keyset) ........ 178 ms  ->  0,096 ms   (1855x, com a mudança
--                                                       do WHERE para tupla)
--
-- Três índices, não quatro. `connection_id` ficou de FORA de propósito: mesmo
-- sem índice próprio a consulta por conexão fica em 0,23 ms a 1M linhas, e
-- 2,5x sobre algo já sub-milissegundo não paga o preço. E há preço: o
-- `query_log` recebe INSERT a CADA query executada. Medido, 40 mil inserções:
--
--   1 índice (hoje) ..........  7,5 us/linha
--   3 índices (este arquivo) . 12,3 us/linha
--   4 índices ................ 15,8 us/linha
--
-- O `idx_query_log_recent` é derrubado por ser prefixo estrito do novo índice
-- de keyset: o SQLite atende "ORDER BY executed_at DESC" pelos dois, e manter
-- os dois só pagaria escrita duas vezes pela mesma ordenação.

DROP INDEX IF EXISTS idx_query_log_recent;

-- Ordenação e paginação, com e sem filtro. O `id` no índice é o que permite ao
-- keyset comparar a tupla `(executed_at, id)` num seek em vez de varredura.
CREATE INDEX idx_query_log_keyset ON query_log(executed_at DESC, id DESC);

-- "O que fulano rodou". Poucos atores, muitas linhas por ator.
CREATE INDEX idx_query_log_ator ON query_log(actor, executed_at DESC, id DESC);

-- "O que falhou". Três valores só, mas o que importa é a ordem DENTRO do valor:
-- sem o `executed_at` no índice, o filtro casaria e a ordenação varreria.
CREATE INDEX idx_query_log_status ON query_log(status, executed_at DESC, id DESC);
