import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Side panel + background worker. The content script is built separately
// (vite.content.config.ts) because content scripts can't load ES module chunks.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: 'sidepanel.html',
        background: 'src/background/index.ts',
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
