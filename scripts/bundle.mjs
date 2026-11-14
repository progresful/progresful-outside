/**
 * Makes the release: builds the extension for the hosted server and packs it as the zip the
 * landing page offers for download.
 *
 *   pnpm bundle                                   for https://outside.pgf.lv
 *   OUTSIDE_SERVER_URL=https://example.org pnpm bundle
 *
 * The release build goes to apps/extension/dist-release, so the development build that Chrome
 * has loaded from apps/extension/dist keeps talking to the server on this machine.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const DEFAULT_SERVER_URL = 'https://outside.pgf.lv';
/** The folder people get when they unzip, and then point Chrome's "Load unpacked" at. */
const FOLDER_IN_ZIP = 'outside-extension';
const ZIP_NAME = 'outside-extension.zip';
const RELEASE_OUT_DIR = 'dist-release';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'apps', 'extension');
const builtDir = join(extensionDir, RELEASE_OUT_DIR, 'chrome-mv3');
const downloadDir = join(root, 'apps', 'site', 'public', 'download');

/** The zip is handed to the public, so it may only ever point at a real https server. */
function serverUrl() {
  const raw = (process.env.OUTSIDE_SERVER_URL ?? DEFAULT_SERVER_URL).trim().replace(/\/+$/, '');
  const url = new URL(raw);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' || local) {
    throw new Error(`OUTSIDE_SERVER_URL must be the https address of the hosted server, got ${raw}. For a build that talks to this machine use pnpm build:extension.`);
  }
  return raw;
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function build(server) {
  rmSync(join(extensionDir, RELEASE_OUT_DIR), { recursive: true, force: true });
  execFileSync('pnpm', ['--filter', '@outside/extension', 'build'], {
    cwd: root,
    stdio: 'inherit',
    // On Windows pnpm is a .cmd file, which only a shell can run. The arguments are fixed, never input.
    shell: process.platform === 'win32',
    env: { ...process.env, WXT_SERVER_URL: server, WXT_OUT_DIR: RELEASE_OUT_DIR },
  });
}

/** A release that still points at this machine would install fine and then never find its server. */
function checkBuiltFor(server) {
  const manifest = JSON.parse(readFileSync(join(builtDir, 'manifest.json'), 'utf8'));
  const allowed = `${new URL(server).protocol}//${new URL(server).hostname}/*`;
  if (!manifest.host_permissions?.includes(allowed)) {
    throw new Error(`The built manifest does not allow ${allowed}`);
  }
  const names = filesUnder(builtDir).filter((path) => path.endsWith('.js'));
  if (!names.some((path) => readFileSync(path, 'utf8').includes(server))) {
    throw new Error(`No built script mentions ${server}: the server address did not reach the build`);
  }
  return manifest.version;
}

function pack() {
  const entries = Object.fromEntries(
    filesUnder(builtDir).map((path) => [`${FOLDER_IN_ZIP}/${relative(builtDir, path).split(sep).join('/')}`, readFileSync(path)]),
  );
  return Buffer.from(zipSync(entries, { level: 9 }));
}

const server = serverUrl();
build(server);
const version = checkBuiltFor(server);
const zip = pack();

/** Written beside its place and then moved there, so a visitor never downloads half a file. */
function writeWhole(path, data) {
  writeFileSync(`${path}.part`, data);
  renameSync(`${path}.part`, path);
}

mkdirSync(downloadDir, { recursive: true });
writeWhole(join(downloadDir, ZIP_NAME), zip);
const release = {
  version,
  bytes: zip.length,
  sha256: createHash('sha256').update(zip).digest('hex'),
  serverUrl: server,
  builtAt: new Date().toISOString(),
};
writeWhole(join(downloadDir, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);

process.stdout.write(`\n${ZIP_NAME}: version ${version}, ${Math.round(zip.length / 1024)} KB, for ${server}\n${join(downloadDir, ZIP_NAME)}\n`);
