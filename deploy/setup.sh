#!/usr/bin/env bash
# Puts Outside on the server, start to finish. Run it yourself, from the checkout:
#
#   deploy/setup.sh
#
# It asks you for two passwords and holds neither: the server's login password, once, to let your
# SSH key in; and sudo's, once, for the service, the nginx site and the certificate.
# Run it again whenever there is a new version to ship: it skips what is already done.
#
#   deploy/setup.sh --env            send .env again (otherwise only when the server has none)
#   deploy/setup.sh --yes            do not ask before starting
#
#   OUTSIDE_HOST=emils@pgf.lv        who and where
#   OUTSIDE_DIR=outside              the folder in that account's home
#   OUTSIDE_DOMAIN=outside.pgf.lv    the address people will use
#   OUTSIDE_KEY=~/.ssh/id_ed25519.pub   the public key to let in
set -euo pipefail

HOST="${OUTSIDE_HOST:-emils@pgf.lv}"
DIR="${OUTSIDE_DIR:-outside}"
DOMAIN="${OUTSIDE_DOMAIN:-outside.pgf.lv}"
KEY="${OUTSIDE_KEY:-$HOME/.ssh/id_ed25519.pub}"
SEND_ENV=0
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --env) SEND_ENV=1 ;;
    --yes | -y) ASSUME_YES=1 ;;
    -h | --help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
say() { printf '   %s\n' "$*"; }
fail() { printf '\n\033[31mStopped:\033[0m %s\n' "$*" >&2; exit 1; }
# Asks a yes/no question at the keyboard. Anything but y is a no.
confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  local answer
  printf '   %s [y/N] ' "$1"
  read -r answer </dev/tty || return 1
  [ "$answer" = y ] || [ "$answer" = Y ]
}
# Runs a command on the server with your key. Never asks for a password: if the key is not accepted, it fails.
remote() { ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "$@"; }

for tool in ssh scp rsync pnpm curl; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is needed on this machine and was not found."
done
[ -f .env ] || fail "There is no .env here. It holds the three API keys the server needs."
[ -f "$KEY" ] || fail "The public key $KEY does not exist. Set OUTSIDE_KEY to one that does."

step "Outside → $HOST:~/$DIR, served at https://$DOMAIN"
say "1  let your SSH key in (asks for the server's login password, once)"
say "2  send .env, if the server has none"
say "3  build the extension zip and send the code"
say "4  install Node packages there (and Node itself, if you agree)"
say "5  as root: the service, the nginx site, the certificate (asks for sudo's password, once)"
say "6  check that https://$DOMAIN answers"
confirm "Go ahead?" || fail "Nothing was changed."

step "1/6  SSH key"
if remote true 2>/dev/null; then
  say "Your key is already accepted."
else
  say "Letting $KEY in. The server asks for the login password now."
  ssh-copy-id -i "$KEY" "$HOST"
  remote true || fail "The key was not accepted after all. Check that $KEY is the key ssh uses for $HOST."
fi

step "2/6  API keys"
remote "mkdir -p '$DIR' && chmod 700 '$DIR'"
if [ "$SEND_ENV" = 1 ] || ! remote "test -s '$DIR/.env'"; then
  scp -q -o BatchMode=yes .env "$HOST:$DIR/.env"
  remote "chmod 600 '$DIR/.env'"
  say ".env sent; only this account can read it there."
else
  say "The server already has a .env; left as it is (--env replaces it)."
fi

step "3/6  Code"
# The zip the landing page hands out is built here, so the server needs only the server's own packages.
pnpm bundle
# What is left out is neither sent nor removed over there: the keys, the cache and the installed packages stay.
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude .env --exclude apps/server/data \
  --exclude dist --exclude dist-release --exclude .wxt --exclude coverage \
  --exclude .superpowers --exclude e2e/out --exclude .DS_Store \
  ./ "$HOST:$DIR/"
say "Sent."

step "4/6  Node and packages on the server"
if ! remote "bash '$DIR/deploy/remote-install.sh' --check"; then
  say "Node 22.9 or newer is not installed for this account on the server."
  if confirm "Install Node 22 for this account only, with nvm from github.com/nvm-sh/nvm (no root)?"; then
    remote "INSTALL_NODE=1 bash '$DIR/deploy/remote-install.sh'"
  else
    fail "Install Node 22.9 or newer on the server, then run this again."
  fi
else
  remote "bash '$DIR/deploy/remote-install.sh'"
fi

step "5/6  Service, nginx site and certificate (sudo asks for its password now)"
# -t gives sudo and certbot a terminal to ask you on.
ssh -t "$HOST" "sudo bash '$DIR/deploy/root-setup.sh' '$DOMAIN'" || fail "The root step did not finish. Its messages are above."

step "6/6  Check"
answer=""
for _ in 1 2 3 4 5 6; do
  answer="$(curl -fsS -m 10 "https://$DOMAIN/api/health" 2>/dev/null || true)"
  [ -n "$answer" ] && break
  sleep 2
done
if [ -n "$answer" ]; then
  say "https://$DOMAIN/api/health → $answer"
  say "Page: $(curl -s -m 10 -o /dev/null -w '%{http_code}' "https://$DOMAIN/")   Download: $(curl -s -m 20 -o /dev/null -w '%{http_code} %{size_download} bytes' "https://$DOMAIN/download/outside-extension.zip")"
  printf '\n\033[32mDone.\033[0m  https://%s\n' "$DOMAIN"
  say "Full check in a real browser:  SITE_URL=https://$DOMAIN pnpm check:site"
  say "The login password was shared in a chat: change it now (ssh $HOST, then passwd)."
else
  plain="$(curl -fsS -m 10 "http://$DOMAIN/api/health" 2>/dev/null || true)"
  [ -n "$plain" ] && fail "It answers over http only: the certificate step did not complete. On the server: sudo certbot --nginx -d $DOMAIN --redirect"
  fail "https://$DOMAIN does not answer. On the server: sudo journalctl -u outside.service -n 40 --no-pager"
fi
