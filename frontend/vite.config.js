import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * NULLSCAPE — configuração do Vite.
 *
 * - base: './' permite publicar em GitHub Pages (subdiretório do repositório).
 * - shared/ é importado por caminho relativo; Vite resolve para fora do root.
 * - proxy de desenvolvimento: /socket.io e /api -> servidor local (porta 3000).
 */
export default defineConfig(({ mode }) => ({
  base: './',
  root: __dirname,
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    proxy: {
      '/socket.io': {
        target: process.env.VITE_DEV_SERVER || 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: process.env.VITE_DEV_SERVER || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.VITE_DEV_SERVER || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: mode !== 'production',
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
          net: ['socket.io-client'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
}));
