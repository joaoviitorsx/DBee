# Sidecar de VPN do DBee (ADR 014). Build a partir da RAIZ do repo:
#   docker build -f deploy/vpn/Dockerfile -t dbee-vpn .
# Um openvpn por (usuário, perfil), cada um com tabela de roteamento própria.
# O full tunnel de cada VPN fica preso aqui: não toca o host, o Tailscale nem o
# container do DBee.
FROM oven/bun:1.3-alpine
RUN apk add --no-cache openvpn socat iproute2 iptables tini \
 # Sem plugins: `--script-security` não bloqueia `plugin`, e um .ovpn que
 # escapasse da validação poderia carregar um .so como root.
 && rm -rf /usr/lib/openvpn/plugins
WORKDIR /app
COPY apps/server/src/vpn/ ./vpn/
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "vpn/sidecar/controle.ts"]
