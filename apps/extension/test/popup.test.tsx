import type { InterestId } from '@outside/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageSnapshot } from '../src/badge/pageController';
import { handleContentMessage } from '../src/contentMessages';
import { InterestGrid } from '../src/popup/InterestGrid';
import { Popup, type PopupEnv } from '../src/popup/Popup';
import { statusCardFor } from '../src/popup/cardModel';
import { createSettingsStore, type KeyValueArea } from '../src/storage';

function memoryArea(initial: Record<string, unknown> = {}): KeyValueArea {
  let data = { ...initial };
  return {
    get: async (keys) => Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]])),
    set: async (items) => {
      data = { ...data, ...items };
    },
  };
}

function env(overrides: Partial<PopupEnv> & { stored?: Record<string, unknown> } = {}): PopupEnv {
  const { stored, ...rest } = overrides;
  return {
    store: createSettingsStore(memoryArea(stored ?? { interests: ['food'] })),
    getSnapshot: async () => null,
    isServerUp: async () => true,
    play: vi.fn(),
    retryBuild: vi.fn(),
    ...rest,
  };
}

const onListing = (badge: PageSnapshot['badge']): PageSnapshot => ({ onListing: true, badge, locationText: 'Lisbon, Portugal' });

afterEach(cleanup);

describe('statusCardFor', () => {
  it.each([
    [{ firstRun: false, onListing: true, serverUp: false }, "Can't reach the server", 'Check that it’s running.'.replace('’', "'"), 'retry'],
    [{ firstRun: true, onListing: true, serverUp: true }, "See what's outside every listing", 'Pick up to 5 interests to shape the video.', undefined],
    [{ firstRun: false, onListing: false, serverUp: true }, 'No listing in this tab', 'Open one on Airbnb or Booking.com.', undefined],
    [{ firstRun: false, onListing: true, serverUp: true, badge: { kind: 'generating', stage: 'Checking live prices' } }, 'Building your video', 'Checking live prices', undefined],
    [{ firstRun: false, onListing: true, serverUp: true, badge: { kind: 'refreshing', videoId: 'a' } }, 'Building your video', 'Updating', undefined],
    [{ firstRun: false, onListing: true, serverUp: true, badge: { kind: 'ready', videoId: 'a' }, locationText: 'Lisbon, Portugal' }, 'Video ready', 'Lisbon, Portugal', 'play'],
    [{ firstRun: false, onListing: true, serverUp: true, badge: { kind: 'error' } }, "Couldn't build video", 'Try again.', 'retry'],
  ] as const)('%j', (input, title, subtitle, action) => {
    const card = statusCardFor(input);
    expect([card.title, card.subtitle, card.action]).toEqual([title, subtitle, action]);
  });

  it('shows a progress bar only while building', () => {
    const base = { firstRun: false, onListing: true, serverUp: true };
    expect(statusCardFor({ ...base, badge: { kind: 'generating', stage: 'x' } }).progress).toBe(true);
    expect(statusCardFor({ ...base, badge: { kind: 'ready', videoId: 'a' } }).progress).toBeFalsy();
  });

  it('puts an unreachable server ahead of everything else', () => {
    expect(statusCardFor({ firstRun: true, onListing: false, serverUp: false }).title).toBe("Can't reach the server");
  });

  it('treats a listing page whose badge is hidden as no listing', () => {
    expect(statusCardFor({ firstRun: false, onListing: true, serverUp: true, badge: { kind: 'hidden' } }).title).toBe('No listing in this tab');
  });
});

describe('InterestGrid', () => {
  it('shows the twelve presets by their short labels and the counter', () => {
    render(<InterestGrid picked={['food', 'nature']} onChange={() => {}} />);

    expect(screen.getAllByRole('button')).toHaveLength(12);
    expect(screen.getByText('2 of 5')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Museums' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Food' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('adds and removes a pick', () => {
    const onChange = vi.fn<(picked: InterestId[]) => void>();
    render(<InterestGrid picked={['food']} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Beaches' }));
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));

    expect(onChange.mock.calls).toEqual([[['food', 'water']], [[]]]);
  });

  it('disables unpicked chips at five', () => {
    const onChange = vi.fn();
    render(<InterestGrid picked={['food', 'water', 'gems', 'events', 'family']} onChange={onChange} />);

    const nature = screen.getByRole('button', { name: 'Nature' }) as HTMLButtonElement;
    fireEvent.click(nature);

    expect(nature.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Food' }) as HTMLButtonElement).disabled).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('5 of 5')).toBeTruthy();
  });
});

describe('Popup', () => {
  it('shows the first-run card until an interest is picked, and saves the pick', async () => {
    const popupEnv = env({ stored: {} });
    render(<Popup env={popupEnv} />);

    expect(await screen.findByText("See what's outside every listing")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));

    await waitFor(async () => expect((await popupEnv.store.get()).interests).toEqual(['food']));
    expect(await screen.findByText('No listing in this tab')).toBeTruthy();
    expect(screen.getByText('1 of 5')).toBeTruthy();
  });

  it('plays the ready video', async () => {
    const popupEnv = env({ getSnapshot: async () => onListing({ kind: 'ready', videoId: 'v1' }) });
    render(<Popup env={popupEnv} />);

    expect(await screen.findByText('Video ready')).toBeTruthy();
    expect(screen.getByText('Lisbon, Portugal')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    expect(popupEnv.play).toHaveBeenCalledTimes(1);
  });

  it('shows the live stage while building', async () => {
    render(<Popup env={env({ getSnapshot: async () => onListing({ kind: 'generating', stage: 'Writing the script' }) })} />);

    expect(await screen.findByText('Building your video')).toBeTruthy();
    expect(screen.getByText('Writing the script')).toBeTruthy();
  });

  it('retries when the server was unreachable', async () => {
    const isServerUp = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<Popup env={env({ isServerUp })} />);

    expect(await screen.findByText("Can't reach the server")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No listing in this tab')).toBeTruthy();
  });

  it('asks the page to rebuild after a failed video', async () => {
    const popupEnv = env({ getSnapshot: async () => onListing({ kind: 'error' }) });
    render(<Popup env={popupEnv} />);

    expect(await screen.findByText("Couldn't build video")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(popupEnv.retryBuild).toHaveBeenCalledTimes(1);
  });

  it('opens settings, saves a site switch and the server url, and comes back', async () => {
    const popupEnv = env();
    render(<Popup env={popupEnv} />);
    await screen.findByText('No listing in this tab');

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('switch', { name: 'Airbnb' }));
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'http://localhost:9000' } });
    fireEvent.blur(screen.getByLabelText('Server URL'));

    await waitFor(async () =>
      expect(await popupEnv.store.get()).toMatchObject({
        sites: { airbnb: false, booking: true },
        serverUrl: 'http://localhost:9000',
      }),
    );
    expect(screen.getByRole('switch', { name: 'Airbnb' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(await screen.findByText('Your interests')).toBeTruthy();
  });
});

describe('handleContentMessage', () => {
  const snapshot: PageSnapshot = { onListing: true, badge: { kind: 'ready', videoId: 'v1' }, locationText: 'Lisbon, Portugal' };

  it('answers the popup and leaves other messages alone', () => {
    const controller = { snapshot: () => snapshot, playCurrent: vi.fn(), retry: vi.fn() };

    expect(handleContentMessage(controller, { type: 'badge:get' })).toEqual(snapshot);
    expect(handleContentMessage(controller, { type: 'player:open' })).toEqual({ ok: true });
    expect(handleContentMessage(controller, { type: 'badge:retry' })).toEqual({ ok: true });
    expect(controller.playCurrent).toHaveBeenCalledTimes(1);
    expect(controller.retry).toHaveBeenCalledTimes(1);
    expect(handleContentMessage(controller, { type: 'video:status' })).toBeUndefined();
    expect(handleContentMessage(controller, 'nope')).toBeUndefined();
  });
});
