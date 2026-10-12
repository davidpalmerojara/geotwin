import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { fileURLToPath } from 'node:url';
const cesium = fileURLToPath(new URL('../../node_modules/cesium/Build/Cesium/', import.meta.url));
export default defineConfig({
  envDir: '../..',
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map((name) => ({
        src: `${cesium}/${name}`,
        dest: 'cesium',
      })),
    }),
  ],
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium/') },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3001', ws: true } },
  },
  build: {
    chunkSizeWarningLimit: 1800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'cesium', test: /node_modules\/(cesium|@cesium)/ },
            { name: 'charts', test: /node_modules\/recharts/ },
          ],
        },
      },
    },
  },
});
