import { defineConfig } from 'wxt';
import { LISTING_SITE_MATCHES, serverMatches } from './src/sites/hosts';

/**
 * A release build is made for a hosted server: `WXT_SERVER_URL=https://… WXT_OUT_DIR=dist-release`.
 * It goes to a folder of its own, so the development build Chrome has loaded from `dist` keeps
 * talking to this machine.
 */
const builtFor = process.env.WXT_SERVER_URL;

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Not WXT's default ".output": Chrome's "Load unpacked" file picker hides folders that start with a dot.
  outDir: process.env.WXT_OUT_DIR ?? 'dist',
  manifest: {
    name: 'Outside',
    description: "See what's outside every listing: a short video about the area, built from the live web.",
    permissions: ['storage'],
    host_permissions: [...LISTING_SITE_MATCHES, ...serverMatches(builtFor)],
    web_accessible_resources: [{ resources: ['player.html'], matches: [...LISTING_SITE_MATCHES] }],
  },
});
