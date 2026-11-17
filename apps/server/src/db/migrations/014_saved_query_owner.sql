-- Queries salvas com dono e visibilidade (roadmap-dbeaver item 7, ADR 016).
--
-- `owner_id` anulável: as queries que já existiam não têm dono conhecido, e a
-- conta pode ser apagada depois (SET NULL — a query de time não some com quem
-- a escreveu; sem dono, só admin edita).
--
-- As existentes viram 'team': antes desta migration a lista era global, e
-- torná-las privadas de ninguém as faria sumir para todo mundo.
ALTER TABLE saved_queries ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE saved_queries ADD COLUMN visibility TEXT NOT NULL DEFAULT 'team'
  CHECK (visibility IN ('private', 'team'));
CREATE INDEX idx_saved_queries_owner ON saved_queries(owner_id);
