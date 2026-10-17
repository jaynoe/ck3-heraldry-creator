import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devApi } from './dev/api-plugin.ts';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), devApi()],
  // Prefilled in test reports; package.json is bumped together with the Tauri version for a release.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: 'localhost', port: 5173, strictPort: true },
  // Tauri expects a fixed port and does not need the browser opened.
  clearScreen: false,
});
