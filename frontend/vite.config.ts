import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // `npm run dev:backend` serves the API on :3000; the dev server proxies to it.
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  build: {
    chunkSizeWarningLimit: 1500, // pdf.js is big, but it's lazy-loaded only when a PDF is opened
  },
});
