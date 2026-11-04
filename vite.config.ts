import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression2';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // ضغط مسبق وقت البناء: ينتج .br و.gz بجانب كل أصل، ويقدّمه server.ts مباشرة (express-static-gzip) بلا ضغط وقت الطلب
      compression({ algorithms: ['brotliCompress', 'gzip'], threshold: 1024, exclude: [/\.(?:woff2?|png|jpe?g|webp|avif|gif|mp4|zip)$/i] }),
    ],
    build: { reportCompressedSize: true, cssCodeSplit: true },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'recharts'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
