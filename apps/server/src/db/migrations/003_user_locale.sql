-- Idioma da UI por usuário (DBee.md — fechamento da v0.1, PT/EN).
--
-- A escolha vive no registro do usuário, não em localStorage: foi a razão de o
-- i18n entrar depois da auth. Assim a preferência acompanha a pessoa entre
-- dispositivos, do mesmo jeito que as conexões e o histórico.
--
-- Padrão `pt`: o produto nasceu em português e o público é escritório contábil
-- no Brasil. `CHECK` fecha o domínio — sem terceiro idioma entrando por engano.
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'pt' CHECK (locale IN ('pt', 'en'));
