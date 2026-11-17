#!/bin/sh
set -eu
cat > /verifica.sh <<'V'
#!/bin/sh
# via-file: linha 1 usuário, linha 2 senha (PIN + TOTP simulado).
u=$(sed -n 1p "$1"); p=$(sed -n 2p "$1")
case "$u:$p" in
  alice:111111222222|bob:333333444444) exit 0;;
esac
exit 1
V
chmod 755 /verifica.sh
openvpn --dev tun --server 10.99.0.0 255.255.255.0 --topology subnet \
  --proto udp --port 1194 --ca /pki/ca.crt --cert /pki/servidor.crt --key /pki/servidor.key \
  --dh none --tls-server --push "redirect-gateway def1" \
  --script-security 2 --auth-user-pass-verify /verifica.sh via-file \
  --verify-client-cert require --keepalive 5 30 --verb 3 &
# espera o tun subir e põe o "banco" no IP do servidor dentro da VPN
while ! ip addr show tun0 2>/dev/null | grep -q 10.99.0.1; do sleep 0.2; done
exec socat TCP-LISTEN:5432,bind=10.99.0.1,fork,reuseaddr SYSTEM:'echo $SOCAT_PEERADDR'
