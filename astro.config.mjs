// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  adapter: cloudflare({
    platformProxy: { configPath: 'wrangler.toml', remoteBindings: true }
  }),
  integrations: [react()],
  // We don't use Astro sessions; keep it in-memory to avoid requiring a KV binding.
  session: { driver: 'memory' },

  vite: {
    plugins: [tailwindcss()]
  }
});
