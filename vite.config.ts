import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from a sub-folder (itch.io, GitHub Pages).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});
