import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' makes the production build openable directly from the filesystem
// (double-click dist/index.html) as well as from any static host.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 }
});
