import { useState, type CSSProperties } from 'react';
import type { Settings } from '../storage';
import { COLOR, CONTROL_HEIGHT, RADIUS } from '../ui/tokens';

interface SettingsViewProps {
  settings: Settings;
  onSave(patch: Partial<Settings>): void;
}

const SITES: ReadonlyArray<{ id: keyof Settings['sites']; label: string }> = [
  { id: 'airbnb', label: 'Airbnb' },
  { id: 'booking', label: 'Booking.com' },
];

const heading: CSSProperties = { margin: 0, fontSize: 14, fontWeight: 600, lineHeight: '20px' };

function Switch({ label, on, onToggle }: { label: string; on: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      style={{ width: 48, height: CONTROL_HEIGHT, padding: 0, border: 0, background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
    >
      <span
        style={{ width: 40, height: 24, padding: '0 3px', borderRadius: 12, background: on ? COLOR.accent : '#B4BDB7', display: 'flex', alignItems: 'center', justifyContent: on ? 'flex-end' : 'flex-start' }}
      >
        <span style={{ width: 18, height: 18, borderRadius: '50%', background: COLOR.paper }} />
      </span>
    </button>
  );
}

/** Per-site switches and the server address. Nothing else. */
export function SettingsView({ settings, onSave }: SettingsViewProps) {
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);

  return (
    <div style={{ padding: '4px 16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={heading}>Active on</h2>
        <div style={{ padding: '4px 4px 4px 16px', borderRadius: RADIUS.card, background: COLOR.card }}>
          {SITES.map((site, index) => (
            <div
              key={site.id}
              style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: index === 0 ? 0 : '1px solid #E1E5E2' }}
            >
              <span style={{ fontSize: 14 }}>{site.label}</span>
              <Switch
                label={site.label}
                on={settings.sites[site.id]}
                onToggle={() => onSave({ sites: { ...settings.sites, [site.id]: !settings.sites[site.id] } })}
              />
            </div>
          ))}
        </div>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor="server-url" style={heading}>
          Server URL
        </label>
        <input
          id="server-url"
          type="url"
          value={serverUrl}
          onChange={(event) => setServerUrl(event.target.value)}
          onBlur={() => onSave({ serverUrl })}
          style={{ height: CONTROL_HEIGHT, padding: '0 12px', border: `1px solid ${COLOR.line}`, borderRadius: RADIUS.control, background: COLOR.paper, color: COLOR.ink, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
        />
      </section>
    </div>
  );
}
