// Entry: the desktop app inside Tauri, otherwise the browser demo (architecture §11.6).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, type AppProps } from './App';
import { createTauriPlatform, isTauri } from './platform/tauri';
import type { AppServicesImpl } from './services/index';
import { createWorkerExtractHost, createWorkerHost, createWorkerImagePrep, createWorkerPdfRender } from './workers/hosts';
import './ui/fonts.css';
import './ui/tokens.css';
import './ui/app.css';
import './shell/shell.css';

async function start() {
  const root = createRoot(document.getElementById('root')!);
  let props: AppProps;
  if (isTauri()) {
    // Worker-backed hosts (architecture §11.7).
    const indexHost = createWorkerHost(new Worker(new URL('./workers/search.worker.ts', import.meta.url), { type: 'module' }));
    const extractHost = createWorkerExtractHost(new Worker(new URL('./workers/extract.worker.ts', import.meta.url), { type: 'module' }));
    const imageWorker = new Worker(new URL('./workers/image.worker.ts', import.meta.url), { type: 'module' });
    const platform = createTauriPlatform();
    props = {
      platform,
      options: {
        context: { indexHost, extractHost, imagePrep: createWorkerImagePrep(imageWorker), pdfRender: createWorkerPdfRender(imageWorker) },
        // End-to-end runs only (TRAMADO_E2E=1, AppInfo.e2e): the scripts of tools/desktop-smoke.mjs reach the services.
        onReady: (services: AppServicesImpl) => {
          if (services.ctx.info.e2e) (window as { __tramadoE2E?: AppServicesImpl }).__tramadoE2E = services;
        },
      },
    };
  } else {
    // In a plain browser Tramado runs the demo: a fictional class library held in memory only.
    const { bootDemo } = await import('./demo/boot');
    props = await bootDemo();
  }
  // No StrictMode (D49): its doubled effects would create the services twice.
  root.render(<App {...props} />);
}

void start();
