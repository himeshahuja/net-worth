import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { netWorthApi } from './server/api.js';

// The build is the public page alone (index.html), served from GitHub Pages under /net-worth/, and
// `vite preview` serves it under the same path. The admin page and its API exist only on the dev server.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? process.env.BASE_PATH || '/net-worth/' : '/',
  plugins: [react(), netWorthApi()],
  server: { port: 5180 },
}));
