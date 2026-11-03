import { defineConfig } from 'vitest/config';
export default defineConfig({ resolve: { alias: { '@xmldom/xmldom': '/home/feiteira/Trama/app/node_modules/@xmldom/xmldom' } }, test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 60_000 } });
