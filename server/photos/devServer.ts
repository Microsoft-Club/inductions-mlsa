// Runs one Node request through the photo handler: `npm run dev` serves /api/photos with this, so the
// code Cloudflare runs is the code you develop against.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handlePhotoRequest, type PhotoEnv } from './handler.ts';

export async function servePhotoRequest(req: IncomingMessage, res: ServerResponse, env: PhotoEnv): Promise<void> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk as Uint8Array);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(new URL(req.url ?? '/', 'http://localhost'), {
    method: req.method,
    headers,
    body: hasBody ? new Uint8Array(Buffer.concat(chunks)) : undefined,
  });
  const response = await handlePhotoRequest(request, env);
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(new Uint8Array(await response.arrayBuffer()));
}
