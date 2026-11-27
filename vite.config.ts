import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig(({ mode }) =>
  mode === 'docs'
    ? {
        root: 'docs',
        server: {
          port: 4173,
        },
      }
    : {
        plugins: [
          react(),
          tailwindcss(),
          crx({
            manifest,
            contentScripts: {
              standaloneFiles: ['src/content/youtube.ts'],
            },
          }),
        ],
        build: {
          outDir: 'dist',
          emptyOutDir: true,
        },
      },
);
