/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// One version for the whole app: app/package.json (architecture §18.6 lists the other places).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  // Tauri's devUrl. `fs.allow: ['..']`: npm workspaces hoist node_modules (fonts) to the repository
  // root, and core/sync/checkWords.ts imports docs/spec/check-words-v1.txt.
  server: { port: 1420, strictPort: true, fs: { allow: ['..'] } },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 60_000,
    // Several agents share one machine: VITEST_MAX_WORKERS=2 keeps each run small (architecture §17).
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || undefined,
  },
});
