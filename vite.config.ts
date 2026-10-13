import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001' },
    // The dev server serves files from the project root by default, which would expose the local
    // record store and server source over HTTP on the documented `npm run dev` workflow. Only
    // application source and the sample fixtures should ever be reachable.
    fs: {
      deny: [
        '**/.env*',
        '**/data/**',
        '**/*.sqlite',
        '**/*.sqlite-wal',
        '**/*.sqlite-shm',
        '**/server/**',
        '**/tests/**',
        '**/.superpowers/**',
        '**/.git/**',
      ],
    },
  },
  build: { sourcemap: false },
});
