# Hosting Outside

`deploy/setup.sh` puts it on a server from start to finish and can be run again to ship a new version.
You run it yourself: it asks for the server's login password once, to let your SSH key in, and for sudo's
once. It sends `.env` (only when the server has none), builds the zip, syncs the code, installs the
server's packages (and Node 22 with nvm, if you agree), then as root installs a systemd service, an nginx
site for the domain and a certificate with certbot. It touches no firewall rule, no SSH setting and no
other site; if nginx will not accept the new site, the site is taken out again. `deploy/setup.sh --help`
lists the settings (host, folder, domain, key).

By hand, the same server runs behind any reverse proxy (Caddy, nginx) that does HTTPS:

```bash
pnpm install && pnpm bundle
HOST=127.0.0.1 PORT=8787 TRUST_PROXY=1 pnpm start      # with the three keys in .env
```

- `TRUST_PROXY` is the number of reverse proxies in front: `1` for a single Caddy or nginx. The visitor's
  address is then the one that proxy saw (the last entry of `X-Forwarded-For`), so every visitor has an
  allowance of their own and cannot get a fresh one by writing an address into the header. At `0`, the
  default, the header is ignored. Never set it higher than the number of proxies you run.
- `HOST` stays `127.0.0.1` when the proxy runs on the same machine; use `0.0.0.0` only inside a container,
  and do not publish that port past the proxy.
- The server holds paid keys, and anyone who installs the extension can ask it for videos. So new videos
  are limited: `VIDEO_BUILDS_PER_VISITOR_PER_HOUR` (default 120), `VIDEO_BUILDS_AT_ONCE` (4) and
  `VIDEO_BUILDS_PER_DAY` (1500, everyone together). A video that is already made is never counted. Over
  the at-once limit the badge waits and asks again; over the hour or the day it says the video could not
  be built, with Retry. People behind one shared address (an office, a venue) share one hourly allowance.
- Have the proxy add `Strict-Transport-Security`. The server itself sends `X-Content-Type-Options` on
  everything and a Content-Security-Policy with the page.
- Copy the site folder as real files; the server follows symbolic links inside it.
