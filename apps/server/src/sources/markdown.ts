export interface MarkdownLink {
  text: string;
  url: string;
}

/** Index of the bracket that closes the one at `from`, honouring nesting and backslash escapes; -1 if none. */
function closingIndex(text: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let index = from; index < text.length; index += 1) {
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
export function markdownLinks(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    const start = markdown.indexOf('[', cursor);
    if (start < 0) {
      break;
    }
    const textEnd = closingIndex(markdown, start, '[', ']');
    const urlEnd = textEnd >= 0 && markdown[textEnd + 1] === '(' ? closingIndex(markdown, textEnd + 1, '(', ')') : -1;
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
