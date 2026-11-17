-- Ensaio de escrita (ideias-comunidade I1, ADR 021).
--
-- O ensaio roda o SQL de verdade em `BEGIN READ WRITE` e SEMPRE reverte. Ele
-- entra no `query_log` como qualquer execução, mas marcado: quem audita
-- procurando "o que foi gravado" filtra `dry_run = 0`, e um ensaio de `DELETE`
-- não pode aparecer como um `DELETE` que aconteceu. As execuções antigas são
-- todas reais, logo 0.
ALTER TABLE query_log ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 0 CHECK (dry_run IN (0, 1));
