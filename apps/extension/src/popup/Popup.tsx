import type { InterestId } from '@outside/shared';
import { useCallback, useEffect, useState, type CSSProperties, type MouseEvent } from 'react';
import type { PageSnapshot } from '../badge/pageController';
import type { Settings, SettingsStore } from '../storage';
import { BackIcon, OutsideMark, SettingsIcon } from '../ui/icons';
import { COLOR, CONTROL_HEIGHT, FONT } from '../ui/tokens';
import { InterestGrid } from './InterestGrid';
import { SettingsView } from './SettingsView';
import { StatusCard } from './StatusCard';
import { statusCardFor } from './cardModel';

/** Everything the popup needs from the browser, injected so it can be tested without one. */
export interface PopupEnv {
  store: SettingsStore;
  /** The listing tab's state, or null when the active tab is not one of ours. */
  getSnapshot(): Promise<PageSnapshot | null>;
  isServerUp(): Promise<boolean>;
  /** Opens the video on the listing page. */
  play(): void;
  /** Asks the listing page to build the video again. */
  retryBuild(): void;
}

const REFRESH_MS = 1000;
const POPUP_WIDTH = 360;

const shell: CSSProperties = { width: POPUP_WIDTH, background: COLOR.paper, color: COLOR.ink, fontFamily: FONT.body };
const iconLink: CSSProperties = { width: CONTROL_HEIGHT, height: CONTROL_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLOR.ink };
const wordmark: CSSProperties = { margin: 0, fontFamily: FONT.title, fontWeight: 700, fontSize: 19, letterSpacing: '-0.01em' };

const PROGRESS_CSS = `
@keyframes outside-slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
.outside-progress { animation: outside-slide 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .outside-progress { animation: none; } }
`;

export function Popup({ env }: { env: PopupEnv }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  const [serverUp, setServerUp] = useState(true);
  const [view, setView] = useState<'main' | 'settings'>('main');

  const checkServer = useCallback(() => {
    env.isServerUp().then(setServerUp).catch(() => setServerUp(false));
  }, [env]);

  useEffect(() => {
    let alive = true;
    const refresh = (): void => {
      env.getSnapshot().then((next) => alive && setSnapshot(next)).catch(() => alive && setSnapshot(null));
    };
    env.store.get().then((loaded) => alive && setSettings(loaded)).catch(() => undefined);
    checkServer();
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [env, checkServer]);

  const save = useCallback(
    (patch: Partial<Settings>) => {
      env.store.save(patch).then(setSettings).catch(() => undefined);
    },
    [env],
  );

  const onAction = (action: 'play' | 'retry'): void => {
    if (action === 'play') {
      env.play();
    } else if (serverUp) {
      env.retryBuild();
    } else {
      checkServer();
    }
  };

  const go = (next: 'main' | 'settings') => (event: MouseEvent) => {
    event.preventDefault();
    setView(next);
  };

  if (!settings) {
    return <div style={{ ...shell, minHeight: 120 }} />;
  }

  if (view === 'settings') {
    return (
      <div style={shell}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 16px 8px 4px' }}>
          <a href="#main" aria-label="Back" onClick={go('main')} style={iconLink}>
            <BackIcon />
          </a>
          <h1 style={wordmark}>Settings</h1>
        </header>
        <SettingsView settings={settings} onSave={save} />
      </div>
    );
  }

  const model = statusCardFor({
    firstRun: settings.interests.length === 0,
    onListing: snapshot?.onListing ?? false,
    serverUp,
    badge: snapshot?.badge,
    locationText: snapshot?.locationText,
  });

  return (
    <div style={shell}>
      <style>{PROGRESS_CSS}</style>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 8px 8px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <OutsideMark accent={COLOR.accent} ink={COLOR.ink} />
          <h1 style={wordmark}>Outside</h1>
        </div>
        <a href="#settings" aria-label="Settings" onClick={go('settings')} style={iconLink}>
          <SettingsIcon />
        </a>
      </header>
      <StatusCard model={model} onAction={onAction} />
      <InterestGrid picked={settings.interests} onChange={(interests: InterestId[]) => save({ interests })} />
    </div>
  );
}
