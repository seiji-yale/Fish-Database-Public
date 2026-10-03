import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` runs this dev server (5173) next to `wrangler dev` (8787); /api is proxied.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
});
