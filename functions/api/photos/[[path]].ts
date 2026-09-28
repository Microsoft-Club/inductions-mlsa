// Cloudflare Pages runs this for /api/photos and /api/photos/<candidate id>. PHOTOS is the R2 bucket
// binding; VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are the project's environment variables.
// The logic lives in server/photos so the dev server and the tests run exactly the same code.
import { handlePhotoRequest, type PhotoEnv } from '../../../server/photos/handler.ts';

export const onRequest = ({ request, env }: { request: Request; env: PhotoEnv }): Promise<Response> =>
  handlePhotoRequest(request, env);
