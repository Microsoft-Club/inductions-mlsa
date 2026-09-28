// A PhotoBucket in a local folder: the Vite dev server's and the tests' stand-in for R2. Node only;
// the handler never imports it, so the Pages Function bundle stays free of node:fs.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { PhotoBucket } from './bucket.ts';

export function folderBucket(root: string): PhotoBucket {
  const base = resolve(root);

  function pathOf(key: string): string {
    const path = resolve(base, key);
    if (path !== base && !path.startsWith(base + sep)) throw new Error(`Bad key: ${key}`);
    return path;
  }

  async function allKeys(dir = base): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const keys: string[] = [];
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) keys.push(...(await allKeys(path)));
      else keys.push(relative(base, path).split(sep).join('/'));
    }
    return keys;
  }

  return {
    async put(key, value) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, value);
    },
    async get(key) {
      try {
        const data = await readFile(pathOf(key));
        return { body: new Blob([new Uint8Array(data)]).stream() };
      } catch {
        return null;
      }
    },
    async delete(keys) {
      for (const key of [keys].flat()) await rm(pathOf(key), { force: true });
    },
    // Like R2, the cursor is a position in key order (the last key returned), so deleting what a page
    // listed never makes the next page skip anything.
    async list({ limit = 1000, cursor } = {}) {
      const keys = (await allKeys()).sort().filter((key) => !cursor || key > cursor);
      const page = keys.slice(0, limit);
      const objects = page.map((key) => ({ key }));
      return keys.length > page.length ? { objects, truncated: true, cursor: page[page.length - 1] } : { objects, truncated: false };
    },
  };
}
