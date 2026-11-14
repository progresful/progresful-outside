import { VideoManifestSchema, type VideoManifest } from '@outside/shared';
import { OutsideVideo } from '@outside/video';
import sampleManifest from '@outside/video/sample-manifest.json';
import { Player, type PlayerRef } from '@remotion/player';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { CLOSE_MESSAGE } from '../overlay';
import { COLOR, FONT } from '../ui/tokens';
import { CloseIcon, FullscreenIcon, PauseIcon, PlayIcon, VolumeIcon } from '../ui/icons';
import { manifestFrom, playerParams } from './playerData';

interface PlayerAppProps {
  /** The server that holds the video and its media. */
  loadServerUrl: () => Promise<string>;
}

type Loaded = { manifest: VideoManifest; serverUrl: string };

const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  background: COLOR.night,
  color: COLOR.paper,
  fontFamily: FONT.body,
};

const iconButton: CSSProperties = {
  width: 44,
  height: 44,
  flex: 'none',
  padding: 0,
  border: 0,
  background: 'none',
  color: 'inherit',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const stage: CSSProperties = { width: 'min(960px, 92vw)', display: 'flex', flexDirection: 'column', gap: 12 };

/** Tells the listing page to remove the overlay, or closes the tab when opened on its own. */
function requestClose(): void {
  if (window.parent !== window) {
    // The parent is the listing page, whose origin varies; the message carries nothing secret.
    window.parent.postMessage(CLOSE_MESSAGE, '*');
  } else {
    window.close();
  }
}

async function load(loadServerUrl: () => Promise<string>): Promise<Loaded | null> {
  const params = playerParams(window.location.search);
  const serverUrl = await loadServerUrl();
  if (params.sample) {
    return { manifest: VideoManifestSchema.parse(sampleManifest), serverUrl };
  }
  if (!params.videoId) {
    return null;
  }
  const res = await fetch(`${serverUrl}/api/videos/${params.videoId}`);
  const manifest = manifestFrom(await res.json());
  return manifest ? { manifest, serverUrl } : null;
}

/** The full-view player: the video, a close button, and one row of controls. Nothing else. */
export function PlayerApp({ loadServerUrl }: PlayerAppProps) {
  const playerRef = useRef<PlayerRef>(null);
  const [loaded, setLoaded] = useState<Loaded | null | 'loading'>('loading');
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load(loadServerUrl)
      .then((result) => !cancelled && setLoaded(result))
      .catch(() => !cancelled && setLoaded(null));
    return () => {
      cancelled = true;
    };
  }, [loadServerUrl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ready = loaded !== 'loading' && loaded !== null;
  useEffect(() => {
    const player = playerRef.current;
    if (!ready || !player) {
      return;
    }
    const onFrame = (event: { detail: { frame: number } }): void => setFrame(event.detail.frame);
    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => setPlaying(false);
    player.addEventListener('ended', requestClose);
    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    return () => {
      player.removeEventListener('ended', requestClose);
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
    };
  }, [ready]);

  const closeOnBackdrop = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      requestClose();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    if (player.isMuted()) {
      player.unmute();
    } else {
      player.mute();
    }
    setMuted(player.isMuted());
  }, []);

  return (
    <div style={backdrop} onClick={closeOnBackdrop}>
      <button
        type="button"
        aria-label="Close video"
        onClick={requestClose}
        style={{ ...iconButton, position: 'absolute', top: 16, right: 16, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.12)' }}
      >
        <CloseIcon />
      </button>
      {loaded === null ? <p style={{ margin: 0, fontSize: 15 }}>Couldn&apos;t load the video</p> : null}
      {ready ? (
        <div style={stage}>
          <Player
            ref={playerRef}
            component={OutsideVideo}
            inputProps={{ manifest: loaded.manifest, mediaBase: loaded.serverUrl }}
            durationInFrames={loaded.manifest.durationInFrames}
            fps={loaded.manifest.fps}
            compositionWidth={loaded.manifest.width}
            compositionHeight={loaded.manifest.height}
            autoPlay
            style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" aria-label={playing ? 'Pause' : 'Play'} style={iconButton} onClick={() => playerRef.current?.toggle()}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <input
              type="range"
              aria-label="Seek"
              min={0}
              max={loaded.manifest.durationInFrames - 1}
              value={frame}
              onChange={(event) => playerRef.current?.seekTo(Number(event.target.value))}
              style={{ flex: 1, accentColor: COLOR.paper }}
            />
            <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} style={iconButton} onClick={toggleMute}>
              <VolumeIcon muted={muted} />
            </button>
            <button type="button" aria-label="Fullscreen" style={iconButton} onClick={() => playerRef.current?.requestFullscreen()}>
              <FullscreenIcon />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
