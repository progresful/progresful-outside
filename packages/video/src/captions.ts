import type { CaptionWord } from '@outside/shared';

export const CAPTION_GROUP_SIZE = 6;

/**
 * The caption on screen at `timeSec`: the fixed group of words that contains the word being
 * spoken. Groups do not slide, so the text holds still while it is read.
 */
export function activeCaption(
  words: readonly CaptionWord[],
  timeSec: number,
  groupSize: number = CAPTION_GROUP_SIZE,
): string {
  const spoken = words.reduce((latest, word, index) => (word.startSec <= timeSec ? index : latest), -1);
  if (spoken < 0) {
    return '';
  }
  const groupStart = Math.floor(spoken / groupSize) * groupSize;
  return words
    .slice(groupStart, groupStart + groupSize)
    .map((word) => word.text)
    .join(' ');
}
