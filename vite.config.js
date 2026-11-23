import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev`: run `npm start` in another window first; /api goes there.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    build: { chunkSizeWarningLimit: 1600 },   // the PDF maker loads only when a Word file is converted
    server: { proxy: { '/api': { target: env.API_URL || 'http://localhost:3000', changeOrigin: true } } }
  };
});
