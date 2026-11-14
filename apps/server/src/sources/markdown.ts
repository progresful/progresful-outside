export interface MarkdownLink {
  text: string;
  url: string;
}

/** No result card or event entry comes near this; a longer "link" is a malformed or hostile page. */
const MAX_LINK_CHARS = 5_000;
/** After this many brackets that never close, the page is not worth reading further. */
const MAX_UNCLOSED = 200;
/** Pages are capped before parsing, so a huge response cannot tie up the server. */
export const MAX_PAGE_CHARS = 400_000;

/**
 * Index of the bracket that closes the one at `from`, honouring nesting and backslash escapes.
 * Gives up after MAX_LINK_CHARS; -1 if none was found.
 */
function closingIndex(text: string, from: number, open: string, close: string): number {
  const end = Math.min(text.length, from + MAX_LINK_CHARS);
  let depth = 0;
  for (let index = from; index < end; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
    } else if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * Every outermost `[text](url)` link in a markdown page, in order. The text may itself hold an
 * image (`![alt](src)`), which is how listing sites render their result cards.
 */
export function markdownLinks(page: string): MarkdownLink[] {
  const markdown = page.slice(0, MAX_PAGE_CHARS);
  const links: MarkdownLink[] = [];
  let cursor = 0;
  let unclosed = 0;
  while (cursor < markdown.length && unclosed < MAX_UNCLOSED) {
    const start = markdown.indexOf('[', cursor);
    if (start < 0) {
      break;
    }
    const textEnd = closingIndex(markdown, start, '[', ']');
    if (textEnd < 0) {
      unclosed += 1;
      cursor = start + 1;
      continue;
    }
    const urlEnd = markdown[textEnd + 1] === '(' ? closingIndex(markdown, textEnd + 1, '(', ')') : -1;
    if (urlEnd < 0) {
      cursor = start + 1;
      continue;
    }
    const url = markdown.slice(textEnd + 2, urlEnd).trim().split(/\s+/)[0] ?? '';
    links.push({ text: markdown.slice(start + 1, textEnd), url });
    cursor = urlEnd + 1;
  }
  return links;
}

/** Context.dev renders the line breaks inside a card as doubled backslashes; this splits a card into its lines. */
const CARD_LINE_BREAK = /(?:\\\\\s*)+/;

export function cardLines(text: string): string[] {
  return text
    .split(CARD_LINE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/;

export interface MarkdownImage {
  alt: string;
  url: string;
}

export function firstImage(text: string): MarkdownImage | null {
  const match = IMAGE.exec(text);
  return match ? { alt: (match[1] ?? '').trim(), url: match[2] ?? '' } : null;
}
