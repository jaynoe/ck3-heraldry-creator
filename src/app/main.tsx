import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { devPlatform } from './platform/dev.ts';
import { createTauriPlatform, isTauri } from './platform/tauri.ts';
import './styles.css';

const platform = isTauri() ? await createTauriPlatform() : devPlatform;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>,
);
