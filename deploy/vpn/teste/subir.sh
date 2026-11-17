#!/bin/sh
# Sobe servidor OpenVPN de teste + sidecar real e imprime o env do teste.
#   sh deploy/vpn/teste/subir.sh   (da raiz do repo)
set -eu
cd "$(dirname "$0")"
rm -rf pki && mkdir pki && cd pki
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout ca.key -out ca.crt -days 2 -subj /CN=ca-teste 2>/dev/null
emitir() {
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout "$1.key" -out "$1.csr" -subj "/CN=$1" 2>/dev/null
  printf 'keyUsage=critical,digitalSignature,keyAgreement\nextendedKeyUsage=%s\n' "$2" > ext
  openssl x509 -req -in "$1.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -out "$1.crt" -days 2 -extfile ext 2>/dev/null
}
emitir servidor serverAuth
emitir alice clientAuth
emitir bob clientAuth
cd ..
for u in alice bob; do
  { printf 'client\ndev tun\nproto udp\nremote vpn-teste 1194\nnobind\nauth-user-pass\nremote-cert-tls server\n'
    printf '<ca>\n'; cat pki/ca.crt; printf '</ca>\n<cert>\n'; cat "pki/$u.crt"; printf '</cert>\n<key>\n'; cat "pki/$u.key"; printf '</key>\n'
  } > "pki/$u.ovpn"
done
docker network create dbee-vpn-teste >/dev/null 2>&1 || true
docker rm -f vpn-teste dbee-vpn-sidecar-teste >/dev/null 2>&1 || true
docker build -q -f servidor.Dockerfile -t dbee-vpn-servidor-teste . >/dev/null
docker build -q -f ../Dockerfile -t dbee-vpn:teste ../../.. >/dev/null
docker run -d --name vpn-teste --network dbee-vpn-teste --cap-add NET_ADMIN --device /dev/net/tun dbee-vpn-servidor-teste >/dev/null
docker run -d --name dbee-vpn-sidecar-teste --network dbee-vpn-teste --cap-add NET_ADMIN --device /dev/net/tun \
  --tmpfs /run/dbee-vpn:mode=0700 -e CONTROL_TOKEN=token-de-teste-com-mais-de-24 \
  -p 127.0.0.1:17600:7600 -p 127.0.0.1:20050-20549:20050-20549 dbee-vpn:teste >/dev/null
echo "DBEE_TEST_VPN_SIDECAR=http://127.0.0.1:17600 DBEE_TEST_VPN_PKI=$(pwd)/pki"
