-- VPN por pessoa (ADR 014).
--
-- Cada usuário guarda o PRÓPRIO .ovpn por perfil (ex.: "cliente-a"): o arquivo
-- embute certificado e chave privada do cliente, emitidos em nome dele. Fica
-- cifrado com AES-256-GCM e AAD "vpn:<user_id>:<perfil>" — um blob movido para
-- outro usuário ou perfil não decifra. Usuário e senha/TOTP não ficam aqui:
-- são digitados a cada conexão.
CREATE TABLE vpn_profiles (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perfil     TEXT NOT NULL,
  ovpn_enc   TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, perfil)
);

-- Conexão atrás de VPN: nome do perfil. Nulo = acesso direto (padrão). Aditiva.
ALTER TABLE connections ADD COLUMN vpn TEXT;
