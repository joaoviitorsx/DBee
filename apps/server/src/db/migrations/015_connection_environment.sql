-- Selo de ambiente por conexão (ideias-comunidade I2, ADR 022).
--
-- Anulável: as conexões que já existiam não têm ambiente declarado, e inventar
-- um ("development" por padrão) faria a tela afirmar o que ninguém disse. Só o
-- admin define (a rota de PATCH/POST de conexão já é de admin).
ALTER TABLE connections ADD COLUMN environment TEXT
  CHECK (environment IS NULL OR environment IN ('production', 'staging', 'development'));
