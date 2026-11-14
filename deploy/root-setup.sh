#!/usr/bin/env bash
# The part that needs root: the service, the nginx site and the HTTPS certificate.
# deploy/setup.sh runs it on the server as:   sudo bash deploy/root-setup.sh outside.pgf.lv
# Safe to run again. It touches nothing else: no firewall, no SSH settings, no other site.
set -euo pipefail

DOMAIN="${1:-outside.pgf.lv}"
DEFAULT_PORT=8787
PORTS_TO_TRY=20
SERVICE="outside.service"

fail() { echo "Stopped: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run this with sudo."
case "$DOMAIN" in *[!a-zA-Z0-9.-]* | '') fail "'$DOMAIN' is not a host name." ;; esac

DIR="$(cd "$(dirname "$0")/.." && pwd)"
OWNER="$(stat -c %U "$DIR")"
[ "$OWNER" != root ] || fail "$DIR belongs to root; it should belong to the account that deploys."
[ -f "$DIR/.env" ] || fail "$DIR/.env is missing: the server cannot start without its three keys."

# The Node that account uses: one from nvm if it has one, else whatever is on its PATH.
NODE="$(sudo -u "$OWNER" -H bash -c '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; command -v node' || true)"
[ -x "$NODE" ] || fail "node was not found for $OWNER."

# ── The port. The one .env names, or 8787; the next free one if another program has it. ──
wanted="$(grep -E '^PORT=' "$DIR/.env" | tail -1 | cut -d= -f2 | tr -cd '0-9' || true)"
wanted="${wanted:-$DEFAULT_PORT}"
systemctl stop "$SERVICE" 2>/dev/null || true # so that our own server is not the one found holding it
in_use() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }
PORT="$wanted"
while in_use "$PORT"; do
  PORT=$((PORT + 1))
  [ "$PORT" -le $((wanted + PORTS_TO_TRY)) ] || fail "no free port between $wanted and $((wanted + PORTS_TO_TRY))."
done
[ "$PORT" = "$wanted" ] || echo "   Port $wanted is taken by another program; using $PORT."

# ── The service. ──
mkdir -p "$DIR/apps/server/data"
chown "$OWNER": "$DIR/apps/server/data"
sed -e "s|@USER@|$OWNER|g" -e "s|@DIR@|$DIR|g" -e "s|@NODE@|$NODE|g" -e "s|@PORT@|$PORT|g" \
  "$DIR/deploy/outside.service" >"/etc/systemd/system/$SERVICE"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"

up=""
for _ in $(seq 1 20); do
  up="$(curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
  [ -n "$up" ] && break
  sleep 1
done
if [ -z "$up" ]; then
  journalctl -u "$SERVICE" -n 30 --no-pager >&2 || true
  fail "the server did not come up on port $PORT. Its last lines are above."
fi
echo "   Service running on 127.0.0.1:$PORT"

# ── The nginx site. An existing one is kept: certbot has written the certificate lines into it. ──
if [ -d /etc/nginx/sites-available ] && [ -d /etc/nginx/sites-enabled ]; then
  SITE="/etc/nginx/sites-available/$DOMAIN"
  LINK="/etc/nginx/sites-enabled/$DOMAIN"
else
  SITE="/etc/nginx/conf.d/$DOMAIN.conf"
  LINK=""
fi
created=0
if [ -f "$SITE" ]; then
  sed -i -E "s|(proxy_pass http://127\.0\.0\.1:)[0-9]+;|\1$PORT;|" "$SITE"
else
  sed -e "s|@DOMAIN@|$DOMAIN|g" -e "s|@PORT@|$PORT|g" "$DIR/deploy/nginx-site.conf" >"$SITE"
  created=1
fi
[ -z "$LINK" ] || ln -sf "$SITE" "$LINK"
if ! nginx -t 2>&1; then
  # Leave nginx exactly as it was found rather than with a site it cannot load.
  if [ "$created" = 1 ]; then
    rm -f "$SITE"
    [ -z "$LINK" ] || rm -f "$LINK"
  fi
  fail "nginx would not accept the site, so it was taken out again. Nothing else in nginx was changed."
fi
systemctl reload nginx
echo "   nginx serves $DOMAIN"

# ── The certificate. ──
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "   A certificate for $DOMAIN is already there."
elif command -v certbot >/dev/null 2>&1; then
  certbot --nginx -d "$DOMAIN" --redirect || echo "   certbot did not finish: $DOMAIN answers over plain http for now. Run again: sudo certbot --nginx -d $DOMAIN --redirect" >&2
else
  echo "   certbot is not installed, so $DOMAIN answers over plain http only." >&2
  echo "   sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d $DOMAIN --redirect" >&2
fi
