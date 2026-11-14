/** What the player page posts to the listing page when the video should close. */
export const CLOSE_MESSAGE = { type: 'outside:close' } as const;

export interface Overlay {
  /** Shows the video for `videoId` in full view, replacing any video already open. */
  open(videoId: string): void;
  /** Removes the video and leaves the page exactly as it was. */
  close(): void;
  isOpen(): boolean;
}

const FRAME_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  top: '0',
  left: '0',
  width: '100vw',
  height: '100vh',
  border: '0',
  zIndex: '2147483647',
};

function isCloseMessage(data: unknown): boolean {
  return data !== null && typeof data === 'object' && (data as { type?: unknown }).type === CLOSE_MESSAGE.type;
}

/**
 * The full-view player: an iframe of the extension's own player page laid over the listing.
 * Being an extension page, it is outside the host page's CSP. It closes only on a message from
 * the extension's origin, so the host page cannot fake or block the close.
 */
export function createOverlay(
  doc: Document,
  playerUrl: (videoId: string) => string,
  extensionOrigin: string,
): Overlay {
  const view = doc.defaultView;
  let frame: HTMLIFrameElement | null = null;
  let overflowBefore = '';

  const onMessage = (event: MessageEvent): void => {
    if (event.origin === extensionOrigin && isCloseMessage(event.data)) {
      close();
    }
  };

  function close(): void {
    if (!frame) {
      return;
    }
    frame.remove();
    frame = null;
    doc.documentElement.style.overflow = overflowBefore;
    view?.removeEventListener('message', onMessage);
  }

  return {
    open(videoId: string): void {
      close();
      const created = doc.createElement('iframe');
      created.src = playerUrl(videoId);
      created.title = "What's outside";
      created.setAttribute('allow', 'autoplay; fullscreen');
      Object.assign(created.style, FRAME_STYLE);
      overflowBefore = doc.documentElement.style.overflow;
      doc.documentElement.style.overflow = 'hidden';
      doc.body.append(created);
      view?.addEventListener('message', onMessage);
      frame = created;
    },
    close,
    isOpen: () => frame !== null,
  };
}
