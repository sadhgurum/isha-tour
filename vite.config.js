import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    hmr: false,
    ws: false,
  },
  plugins: [
    {
      name: 'manual-refresh',
      apply: 'serve',
      // Vite still injects its browser client when HMR and WebSockets are off.
      transformIndexHtml(html) {
        return html.replace(
          /[ \t]*<script type="module" src="\/@vite\/client"><\/script>\r?\n?/,
          '',
        );
      },
    },
  ],
  build: {
    target: 'es2022',
    license: { fileName: 'third-party-licenses.md' },
    // The bundled Three.js engine is larger than Vite's default warning threshold.
    chunkSizeWarningLimit: 750,
  },
});
