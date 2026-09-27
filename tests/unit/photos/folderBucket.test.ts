import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { folderBucket } from '../../../server/photos/folderBucket.ts';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('folderBucket', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'photos-test-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('saves and reads files in nested folders', async () => {
    const bucket = folderBucket(root);
    await bucket.put('ind-1/c1.jpg', bytes(0xff, 0xd8, 0xff));
    const object = await bucket.get('ind-1/c1.jpg');
    expect(new Uint8Array(await new Response(object!.body).arrayBuffer())).toEqual(bytes(0xff, 0xd8, 0xff));
    expect(await bucket.get('ind-1/missing.jpg')).toBeNull();
  });

  it('lists in pages whose cursor survives deleting what was listed', async () => {
    const bucket = folderBucket(root);
    for (const name of ['a', 'b', 'c', 'd', 'e']) await bucket.put(`ind-1/${name}.jpg`, bytes(1));

    const first = await bucket.list({ limit: 2 });
    expect(first).toEqual({ objects: [{ key: 'ind-1/a.jpg' }, { key: 'ind-1/b.jpg' }], truncated: true, cursor: 'ind-1/b.jpg' });
    await bucket.delete(first.objects.map((o) => o.key));

    const second = await bucket.list({ limit: 2, cursor: first.cursor });
    expect(second.objects.map((o) => o.key)).toEqual(['ind-1/c.jpg', 'ind-1/d.jpg']);
    await bucket.delete('ind-1/c.jpg');
    const third = await bucket.list({ limit: 2, cursor: second.cursor });
    expect(third).toEqual({ objects: [{ key: 'ind-1/e.jpg' }], truncated: false });
  });

  it('lists nothing in a folder that does not exist yet', async () => {
    expect(await folderBucket(join(root, 'not-yet')).list()).toEqual({ objects: [], truncated: false });
  });

  it('refuses keys that point outside its folder', async () => {
    await expect(folderBucket(root).put('../escape.jpg', bytes(1))).rejects.toThrow('Bad key');
  });
});
