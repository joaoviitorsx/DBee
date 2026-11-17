# Servidor OpenVPN DESCARTÁVEL para o teste de integração do sidecar (ADR 014).
# Simula o pfSense: certificado de cliente + usuário/senha, full tunnel
# (redirect-gateway), e um "banco" em 10.99.0.1:5432 que responde o IP de quem
# conectou — é isso que prova por qual túnel a consulta saiu.
FROM alpine:3.20
RUN apk add --no-cache openvpn socat
COPY pki/ /pki/
COPY servidor.sh /servidor.sh
RUN chmod 755 /servidor.sh
CMD ["/servidor.sh"]
