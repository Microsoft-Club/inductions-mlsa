/**
 * The part of Cloudflare's R2Bucket the photo API uses. The real R2 binding (env.PHOTOS on Pages)
 * satisfies it; the Vite dev server and the tests use folderBucket() instead.
 */
export interface PhotoBucket {
  put(key: string, value: Uint8Array<ArrayBuffer>, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream } | null>;
  /** Up to 1000 keys at once. */
  delete(keys: string | string[]): Promise<unknown>;
  list(options?: { limit?: number; cursor?: string }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
}
