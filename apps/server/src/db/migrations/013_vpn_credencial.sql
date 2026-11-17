-- Credencial de VPN lembrada (ADR 014, revisão de 2026-11-17).
--
-- Opt-in por pessoa e por perfil: usuário da VPN e a parte FIXA da senha (o
-- PIN). O código do autenticador nunca é guardado — é digitado a cada conexão,
-- então o segundo fator continua sendo o celular da pessoa. A senha vai
-- cifrada com AAD "vpn:<user_id>:<perfil>#senha", distinto do AAD do .ovpn.
-- Nulo = nada guardado. Aditiva.
ALTER TABLE vpn_profiles ADD COLUMN usuario TEXT;
ALTER TABLE vpn_profiles ADD COLUMN senha_enc TEXT;
