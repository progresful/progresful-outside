#!/usr/bin/env bash
# Runs on the server, as the account that owns the checkout: makes sure Node and pnpm are there
# and installs the server's packages. Needs no root. deploy/setup.sh calls it.
#
#   remote-install.sh --check        only say whether a usable Node is there (exit 0 yes, 3 no)
#   INSTALL_NODE=1 remote-install.sh  install Node 22 for this account with nvm first, if it is missing
set -euo pipefail
cd "$(dirname "$0")/.."

# The release of nvm that is fetched when Node has to be installed. It installs into ~/.nvm only.
NVM_VERSION="v0.40.3"
NODE_MAJOR="22"

# Finds a Node installed for this account (nvm) or one this script put in ~/.local.
find_node() {
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
  fi
  export PATH="$HOME/.local/bin:$PATH"
}

# The server's start command uses --env-file-if-exists, which Node has from 22.9.
node_is_new_enough() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 9) ? 0 : 1)'
}

find_node

if [ "${1:-}" = "--check" ]; then
  node_is_new_enough && exit 0
  exit 3
fi

if ! node_is_new_enough; then
  if [ "${INSTALL_NODE:-0}" != "1" ]; then
    echo "Node 22.9 or newer is not installed for this account." >&2
    exit 3
  fi
  command -v curl >/dev/null 2>&1 || { echo "curl is needed to fetch nvm and is not installed." >&2; exit 1; }
  echo "   Installing nvm $NVM_VERSION and Node $NODE_MAJOR into ~/.nvm"
  curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash >/dev/null
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm install "$NODE_MAJOR" >/dev/null
  nvm alias default "$NODE_MAJOR" >/dev/null
  node_is_new_enough || { echo "Node was installed but is still not usable." >&2; exit 1; }
fi
echo "   node $(node --version) at $(command -v node)"

# pnpm in the version the project names, kept in ~/.local so no root is needed whichever Node this is.
wanted_pnpm="$(node -p "require('./package.json').packageManager.split('@')[1]")"
if [ "$(pnpm --version 2>/dev/null || true)" != "$wanted_pnpm" ]; then
  npm install --global --prefix "$HOME/.local" "pnpm@$wanted_pnpm" >/dev/null
fi
echo "   pnpm $(pnpm --version)"

# Only the server and the shared package it imports: no browser, no extension toolchain.
# Without install scripts: the one native module, the SQLite binding, ships ready-built for Linux,
# and building it again would want a C++ toolchain the server may not have.
pnpm install --frozen-lockfile --ignore-scripts --filter '@outside/server...'

# Proof that what the server needs really loads here: the SQLite binding, and the TypeScript runner.
if ! (cd apps/server && node --import tsx -e "require('better-sqlite3')(':memory:').close()"); then
  echo "The packages installed, but the server's database module does not load on this machine ($(uname -sm))." >&2
  exit 1
fi
echo "   Packages installed and loading."
