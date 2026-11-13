import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { tokensCss } from '../../packages/design-system/src/css';

const here = dirname(fileURLToPath(import.meta.url));

/** Generate src/styles/tokens.css from the shared design tokens. */
function designTokens(): Plugin {
  const out = resolve(here, 'src/styles/tokens.css');
  const write = () => {
    const css = tokensCss();
    mkdirSync(dirname(out), { recursive: true });
    if (!existsSync(out) || readFileSync(out, 'utf8') !== css) writeFileSync(out, css);
  };
  return { name: 'clarity-design-tokens', buildStart: write, configureServer: write };
}

/**
 * Strict Content Security Policy for production builds (dev needs inline HMR scripts).
 * 'wasm-unsafe-eval' is required by hash-wasm (Argon2id). frame-ancestors etc. are in public/_headers.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'clarity-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  plugins: [
    designTokens(),
    react(),
    csp(),
    VitePWA({
      // New versions take over as soon as they are downloaded, so fixes reach people without closing every tab.
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Clarity — private budgeting',
        short_name: 'Clarity',
        description: 'Private, local-first budgeting. Your financial data stays on this device.',
        theme_color: '#0F5F73',
        background_color: '#F4F4F6',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        navigateFallback: '/index.html',
        // Never cache anything that is not a same-origin app asset.
        runtimeCaching: [],
      },
    }),
  ],
  build: { target: 'es2022', sourcemap: false },
  worker: { format: 'es' },
  server: { port: 5173 },
});
