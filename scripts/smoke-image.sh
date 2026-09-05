#!/usr/bin/env bash
#
# Smoke test do ARTEFATO — a imagem, não o código (DBee.md §11.42).
#
# Prova o que a suíte não prova, porque em dev o Vite serve o front e o binário
# compilado nunca serve a UI: sobe o container e confere que
#   - GET /            → 200 e Content-Type text/html   (o app carrega)
#   - o bundle JS      → 200 e Content-Type de JavaScript (módulo não é recusado)
#   - GET /api sem sessão → 401                          (a API segue guardada)
#
# "Os testes passam" e "a imagem funciona" divergiram sem aviso uma vez; este
# script é o que os mantém juntos. Roda no CI depois do build, e à mão:
#   scripts/smoke-image.sh ghcr.io/joaoviitorsx/dbee:latest
set -euo pipefail

IMG="${1:?uso: smoke-image.sh <imagem> [porta]}"
PORT="${2:-3001}"
NAME="dbee-smoke-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() { echo "SMOKE FALHOU: $1"; echo "--- logs ---"; docker logs "$NAME" 2>&1 | tail -30; exit 1; }

# NODE_ENV=production está no ENV da imagem, então APP_SECRET é obrigatório; sem
# ele o boot aborta (§7). Um segredo efêmero serve — a imagem não guarda nada.
docker run -d --name "$NAME" -e APP_SECRET="smoke-$(date +%s)-$$" -p "$PORT:3001" "$IMG" >/dev/null

# Espera o healthcheck do próprio binário responder (o mesmo que o container usa).
pronto=""
for _ in $(seq 1 40); do
  if docker exec "$NAME" /app/dbee --healthcheck >/dev/null 2>&1; then pronto=1; break; fi
  sleep 1
done
[ -n "$pronto" ] || fail "healthcheck não respondeu em 40s"

base="http://localhost:$PORT"

# 1. GET / → 200 text/html
code=$(curl -s -o /dev/null -w '%{http_code}' "$base/")
ctype=$(curl -s -o /dev/null -w '%{content_type}' "$base/")
[ "$code" = 200 ] || fail "GET / deu $code, esperava 200"
case "$ctype" in text/html*) ;; *) fail "GET / Content-Type '$ctype', esperava text/html" ;; esac

# 2. Bundle JS referenciado no index.html → 200 e MIME de JavaScript. Um módulo
#    servido sem MIME de JS é recusado pelo navegador e o app carrega em branco.
js=$(curl -s "$base/" | grep -oE '/assets/[^"]+\.js' | head -1)
[ -n "$js" ] || fail "não achei o bundle JS no index.html"
jcode=$(curl -s -o /dev/null -w '%{http_code}' "$base$js")
jctype=$(curl -s -o /dev/null -w '%{content_type}' "$base$js")
[ "$jcode" = 200 ] || fail "bundle JS ($js) deu $jcode, esperava 200"
case "$jctype" in *javascript*) ;; *) fail "bundle JS Content-Type '$jctype', sem 'javascript'" ;; esac

# 3. Rota /api sem sessão → 401 (a API não vazou junto do estático).
acode=$(curl -s -o /dev/null -w '%{http_code}' "$base/api/connections")
[ "$acode" = 401 ] || fail "/api/connections sem sessão deu $acode, esperava 401"

echo "SMOKE OK — GET / $code $ctype · JS $jcode $jctype · /api $acode"
