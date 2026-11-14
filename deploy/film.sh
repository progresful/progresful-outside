#!/usr/bin/env bash
# Puts the rendered promotional film on the server, beside the landing page, and prints its address.
#
#   deploy/film.sh
#
# Uses your SSH key (deploy/setup.sh has let it in). The film is also copied into the site folder
# here, so that the next deploy/setup.sh keeps it on the server rather than clearing it away.
set -euo pipefail

HOST="${OUTSIDE_HOST:-emils@pgf.lv}"
DIR="${OUTSIDE_DIR:-outside}"
DOMAIN="${OUTSIDE_DOMAIN:-outside.pgf.lv}"
FILM="apps/promo/out/outside-promo.mp4"
PLACE="apps/site/public/promo"

cd "$(dirname "$0")/.."
[ -f "$FILM" ] || { echo "There is no film yet. Render it first: pnpm --filter @outside/promo render" >&2; exit 1; }

mkdir -p "$PLACE"
cp "$FILM" "$PLACE/outside-promo.mp4"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "mkdir -p '$DIR/$PLACE'"
rsync -az "$PLACE/" "$HOST:$DIR/$PLACE/"

address="https://$DOMAIN/promo/outside-promo.mp4"
answer="$(curl -s -m 20 -o /dev/null -I -w '%{http_code} %{content_type}' "$address")"
case "$answer" in
  "200 video/mp4"*) echo "$address" ;;
  *) echo "Sent, but $address answered: $answer" >&2; exit 1 ;;
esac
