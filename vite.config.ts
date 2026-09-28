import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { servePhotoRequest } from './server/photos/devServer.ts';
import { folderBucket } from './server/photos/folderBucket.ts';

/** `npm run dev` serves /api/photos with the same handler as Cloudflare, keeping photos in .local-photos/. */
function localPhotoApi(): Plugin {
  return {
    name: 'local-photo-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), 'VITE_');
      const photoEnv = {
        PHOTOS: folderBucket('.local-photos'),
        VITE_SUPABASE_URL: env.VITE_SUPABASE_URL ?? '',
        VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY ?? '',
      };
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/photos')) return next();
        servePhotoRequest(req, res, photoEnv).catch(next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localPhotoApi()],
  build: {
    // One small app for ~25 staff screens and a projector: ~170 KB gzipped, mostly React and supabase-js.
    chunkSizeWarningLimit: 800,
  },
});
