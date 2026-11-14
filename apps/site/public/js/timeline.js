/** Where the example video is at a given second. Kept apart from the page so it can be tested without one. */

/**
 * The scene on screen at `time`: the last one that has started.
 * @param {{ start: number }[]} scenes
 * @param {number} time seconds from the start of the video
 * @returns {number} the scene's position in `scenes`
 */
export function sceneIndexAt(scenes, time) {
  return scenes.reduce((found, scene, index) => (scene.start <= time ? index : found), 0);
}

/**
 * The caption at `time`: the last group of words whose first word has been spoken, or none yet.
 * @param {{ cues: { t: number, text: string }[] }} scene
 * @param {number} time seconds from the start of the video
 * @returns {string}
 */
export function captionAt(scene, time) {
  return scene.cues.reduce((text, cue) => (cue.t <= time ? cue.text : text), '');
}

/** A voice that has not moved for this long is taken to be stuck: still loading, or cut off. */
export const VOICE_STALL_SEC = 6;

/**
 * Where the video is one moment later.
 *
 * Without sound it follows the page's own clock and starts over at the end. With sound it goes
 * where the voice is; while the voice has yet to start it waits, and after the voice has
 * finished it runs on to the end and stops there. A voice that is stuck is let go of, and the
 * video carries on silently.
 *
 * @param {{ time: number, playing: boolean, sound: boolean }} state
 * @param {number} elapsed seconds since the last moment
 * @param {{ leading: boolean, time: number, ended: boolean, stuckFor: number }} voice
 *   `leading`: the voice is playing; `time`: where it is; `stuckFor`: seconds it has not moved
 * @param {number} duration the video's length in seconds
 * @returns {{ time: number, playing: boolean, sound: boolean }} a new state; the one given is left as it was
 */
export function advance(state, elapsed, voice, duration) {
  if (state.sound && voice.stuckFor >= VOICE_STALL_SEC) {
    return advance({ ...state, sound: false }, elapsed, voice, duration);
  }
  const onItsOwn = !state.sound || voice.ended;
  const time = onItsOwn ? state.time + elapsed : voice.leading ? voice.time : state.time;
  if (time < duration) {
    return { ...state, time };
  }
  return state.sound ? { ...state, time: duration, playing: false } : { ...state, time: 0 };
}
