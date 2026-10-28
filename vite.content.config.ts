import { defineConfig } from 'vite';

// Content script must be a single self-contained classic script.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: 'src/content/sensor.ts',
      formats: ['iife'],
      name: 'TabResumeSensor',
      fileName: () => 'content.js',
    },
  },
});
