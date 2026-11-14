/**
 * The example video in the hero: the scenes, captions and timings of a real video the extension
 * built, played by one clock. Without sound the clock is the page's own and the video loops;
 * with sound the voice track is the clock, and the video stops where the voice does.
 */

import { advance, captionAt, sceneIndexAt } from './timeline.js';

const END_SLACK_SEC = 0.05;

/** @returns {{ t: number, text: string }[]} */
function parseCues(raw) {
  try {
    const cues = JSON.parse(raw ?? '[]');
    return Array.isArray(cues) ? cues.filter((cue) => typeof cue?.t === 'number' && typeof cue?.text === 'string') : [];
  } catch {
    // A scene whose captions cannot be read simply has none.
    return [];
  }
}

function readScenes(stage) {
  return [...stage.querySelectorAll('.scene')].map((element) => ({
    element,
    start: Number(element.dataset.start),
    end: Number(element.dataset.end),
    cues: parseCues(element.dataset.cues),
  }));
}

/** Only the opening photo is needed to paint the page; the rest follow once it has loaded. */
function loadPhotosLater(stage) {
  const load = () => {
    for (const image of stage.querySelectorAll('img[data-src]')) {
      image.src = image.dataset.src;
      image.removeAttribute('data-src');
    }
  };
  if (document.readyState === 'complete') {
    load();
  } else {
    window.addEventListener('load', load, { once: true });
  }
}

/** Puts on the page what the video shows at `time`. Touches only what has changed since it last ran. */
function createScreen({ scenes, caption, scrub, duration }) {
  const shown = { scene: -1, caption: null, second: -1 };
  return (time) => {
    const index = sceneIndexAt(scenes, time);
    if (index !== shown.scene) {
      scenes.forEach((scene, position) => {
        scene.element.classList.toggle('is-active', position === index);
        scene.element.setAttribute('aria-hidden', String(position !== index));
      });
      shown.scene = index;
    }
    const text = captionAt(scenes[index], time);
    if (text !== shown.caption) {
      caption.textContent = text;
      shown.caption = text;
    }
    const second = Math.floor(time);
    if (second !== shown.second) {
      scrub.setAttribute('aria-valuetext', `${second} of ${Math.round(duration)} seconds`);
      shown.second = second;
    }
    scrub.value = String(time);
    scrub.style.setProperty('--played', `${((time / duration) * 100).toFixed(2)}%`);
  };
}

function startDemo(player) {
  const stage = player.querySelector('[data-demo-stage]');
  const caption = player.querySelector('[data-demo-caption]');
  const audio = player.querySelector('[data-demo-audio]');
  const scrub = player.querySelector('[data-demo-scrub]');
  const toggle = player.querySelector('[data-demo-toggle]');
  const mute = player.querySelector('[data-demo-mute]');
  const scenes = stage ? readScenes(stage) : [];
  const last = scenes.at(-1);
  if (!stage || !caption || !audio || !scrub || !toggle || !mute || !last) {
    return;
  }
  const duration = last.end;
  const show = createScreen({ scenes, caption, scrub, duration });

  let state = { time: 0, playing: false, sound: false };
  let visible = false;
  let frame = 0;
  let before = 0;
  // Where the voice was a frame ago, and for how long it has not moved from there.
  let voiceAt = 0;
  let voiceStuckFor = 0;

  for (const scene of scenes) {
    scene.element.style.setProperty('--length', `${(scene.end - scene.start).toFixed(2)}s`);
  }
  loadPhotosLater(stage);

  const running = () => state.playing && visible && !document.hidden;

  /** Brings the page in line with what the visitor asked for and what they can currently see. */
  const sync = () => {
    player.classList.toggle('is-paused', !state.playing);
    player.classList.toggle('is-idle', !running());
    player.classList.toggle('has-sound', state.sound);
    toggle.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    mute.setAttribute('aria-pressed', String(state.sound));
    mute.setAttribute('aria-label', state.sound ? 'Turn sound off' : 'Turn sound on');
    if (state.sound && running() && !audio.ended) {
      audio.play().catch((error) => {
        // A pause that arrives before the voice has started cancels the start. That is not a failure.
        if (error?.name !== 'AbortError') {
          dropVoice();
        }
      });
    } else {
      audio.pause();
    }
    // The clock only ticks while there is something to move.
    if (running() && frame === 0) {
      before = performance.now();
      frame = requestAnimationFrame(tick);
    }
  };

  /** The voice cannot be played (blocked, unreachable, broken off): the video carries on silently. */
  const dropVoice = () => {
    if (state.sound) {
      state = { ...state, sound: false };
      voiceStuckFor = 0;
      sync();
    }
  };

  const tick = (now) => {
    frame = 0;
    if (!running()) {
      return;
    }
    const elapsed = (now - before) / 1000;
    before = now;
    const moved = audio.currentTime !== voiceAt;
    voiceStuckFor = state.sound && !audio.ended && !moved ? voiceStuckFor + elapsed : 0;
    voiceAt = audio.currentTime;
    const voice = { leading: !audio.paused && !audio.ended, time: audio.currentTime, ended: audio.ended, stuckFor: voiceStuckFor };
    const next = advance(state, elapsed, voice, duration);
    const turned = next.playing !== state.playing || next.sound !== state.sound;
    state = next;
    show(state.time);
    if (turned) {
      voiceStuckFor = 0;
      sync();
    }
    if (running() && frame === 0) {
      frame = requestAnimationFrame(tick);
    }
  };

  const seek = (time) => {
    state = { ...state, time: Math.min(Math.max(time, 0), duration) };
    voiceStuckFor = 0;
    if (state.sound) {
      audio.currentTime = Math.min(state.time, Number.isFinite(audio.duration) ? audio.duration : state.time);
    }
    show(state.time);
    // After the voice has run out, moving back needs it started again.
    if (state.sound && state.playing) {
      sync();
    }
  };

  toggle.addEventListener('click', () => {
    if (!state.playing && state.time >= duration - END_SLACK_SEC) {
      seek(0);
    }
    state = { ...state, playing: !state.playing };
    sync();
  });

  mute.addEventListener('click', () => {
    state = { ...state, sound: !state.sound };
    voiceStuckFor = 0;
    if (state.sound) {
      audio.currentTime = state.time;
    }
    sync();
  });

  // The badge and the hint do what the badge does on a listing: play it, with its voice, from the top.
  for (const button of player.querySelectorAll('[data-demo-sound]')) {
    button.addEventListener('click', () => {
      state = { time: 0, playing: true, sound: true };
      voiceStuckFor = 0;
      audio.currentTime = 0;
      show(state.time);
      sync();
    });
  }

  scrub.addEventListener('input', () => seek(Number(scrub.value)));
  audio.addEventListener('error', dropVoice);

  // It runs while any of the player can be seen, and rests once it has been scrolled away.
  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    sync();
  }).observe(player);
  document.addEventListener('visibilitychange', sync);

  // It plays by itself, silently, unless the visitor has asked their system for less motion.
  state = { ...state, playing: !window.matchMedia('(prefers-reduced-motion: reduce)').matches };
  show(state.time);
  sync();
}

const player = document.querySelector('[data-demo]');
if (player) {
  startDemo(player);
}
