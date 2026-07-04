import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    version: {
      // Polling _app/version.json tiap 60 detik — sinyal buat banner
      // "versi baru tersedia" (src/lib/UpdateBanner.svelte).
      pollInterval: 60000
    }
  }
};

export default config;
