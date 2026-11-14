/**
 * "Live data as of 14 Nov, 02:14" — the real fetch time of the video's oldest fact, shown in the
 * viewer's timezone unless one is given. Empty when the time cannot be read.
 */
export function asOfLabel(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
  return `Live data as of ${part('day')} ${part('month')}, ${part('hour')}:${part('minute')}`;
}

/** Media paths in a manifest are relative to the server ("/media/abc.mp3"); absolute URLs pass through. */
export function resolveMedia(mediaBase: string, url: string): string {
  return url.startsWith('/') ? `${mediaBase.replace(/\/+$/, '')}${url}` : url;
}
