import '@fontsource/bricolage-grotesque/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import { createRoot } from 'react-dom/client';
import { settingsStore } from '../../src/browserSettings';
import { PlayerApp } from '../../src/player/PlayerApp';

const loadServerUrl = async (): Promise<string> => (await settingsStore.get()).serverUrl;

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<PlayerApp loadServerUrl={loadServerUrl} />);
}
