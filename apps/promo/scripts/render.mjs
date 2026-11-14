/**
 * Renders the film and brings its sound to the loudness online video is played at.
 *
 *   pnpm --filter @outside/promo render [-- --browser-executable <path>]
 *
 * Remotion writes out/outside-promo.raw.mp4; ffmpeg then measures the sound and sets it to
 * -16 LUFS (speech as rendered sits near -21, which sounds faint next to anything else) and
 * writes out/outside-promo.mp4. The picture is copied, not encoded again. Without ffmpeg the
 * film is kept as rendered.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET = { loudness: -16, truePeak: -1.5, range: 11 };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = join(root, 'out', 'outside-promo.raw.mp4');
const final = join(root, 'out', 'outside-promo.mp4');
const say = (text) => process.stdout.write(`${text}\n`);
// On Windows the package runner is a .cmd file, which only a shell can run. The arguments are fixed or the caller's own.
const shell = process.platform === 'win32';

mkdirSync(join(root, 'out'), { recursive: true });
execFileSync('pnpm', ['exec', 'remotion', 'render', 'src/index.ts', 'Promo', raw, '--log=error', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', shell });

/** What ffmpeg's loudness filter measured, read from the JSON it prints at the end of a first pass. */
function measure() {
  const settings = `loudnorm=I=${TARGET.loudness}:TP=${TARGET.truePeak}:LRA=${TARGET.range}:print_format=json`;
  const pass = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', raw, '-vn', '-af', settings, '-f', 'null', '-'], { encoding: 'utf8' });
  if (pass.error || pass.status !== 0) {
    return null;
  }
  const report = pass.stderr.slice(pass.stderr.lastIndexOf('{'), pass.stderr.lastIndexOf('}') + 1);
  try {
    const found = JSON.parse(report);
    const numbers = [found.input_i, found.input_tp, found.input_lra, found.input_thresh, found.target_offset].map(Number);
    return numbers.every(Number.isFinite) ? found : null;
  } catch {
    // No report to read: the sound is left as rendered.
    return null;
  }
}

const measured = measure();
if (!measured) {
  copyFileSync(raw, final);
  say(`ffmpeg could not measure the sound, so the film is as rendered: ${final}`);
} else {
  const settings = [
    `loudnorm=I=${TARGET.loudness}:TP=${TARGET.truePeak}:LRA=${TARGET.range}`,
    `measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}:linear=true`,
  ].join(':');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-c:v', 'copy', '-af', settings, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', final], { stdio: 'inherit' });
  say(`Sound brought from ${measured.input_i} to ${TARGET.loudness} LUFS: ${final}`);
}
