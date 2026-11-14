import { defineConfig } from 'wxt';
import { LISTING_SITE_MATCHES, SERVER_MATCHES } from './src/sites/hosts';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Not WXT's default ".output": Chrome's "Load unpacked" file picker hides folders that start with a dot.
  outDir: 'dist',
  manifest: {
    name: 'Outside',
    description: "See what's outside every listing: a short video about the area, built from the live web.",
    permissions: ['storage'],
    host_permissions: [...LISTING_SITE_MATCHES, ...SERVER_MATCHES],
    web_accessible_resources: [{ resources: ['player.html'], matches: [...LISTING_SITE_MATCHES] }],
  },
});
