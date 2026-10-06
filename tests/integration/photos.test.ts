// The photo API without a browser: the handler the Pages Function runs, a folder in place of R2, and
// the real local database deciding who may do what.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { folderBucket } from '../../server/photos/folderBucket.ts';
import { handlePhotoRequest } from '../../server/photos/handler.ts';
import { ApiError, createApi, NOT_ALLOWED, type Api } from '../../src/lib/api.ts';
import { env, makeAccount, service, signIn, uniqueName } from './support.ts';

const JPEG = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0xff, 0xd9])], { type: 'image/jpeg' });
const sortedKeys = (value: object | null | undefined) => Object.keys(value ?? {}).sort();

describe('candidate photos', () => {
  const accountIds: string[] = [];
  let folder: string;
  let admin: Api;
  let qm: Api;
  let panelist: Api;
  let photographer: Api;
  let inductionId: string;
  let candidateId: string;
  let number: number;
  let panelId: string | undefined;
  let interviewId: string | undefined;

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'photos-it-'));
    const photoEnv = { PHOTOS: folderBucket(folder), VITE_SUPABASE_URL: env.url, VITE_SUPABASE_ANON_KEY: env.anonKey };
    const photoFetch = (url: string, init: RequestInit) => handlePhotoRequest(new Request(new URL(url, 'http://localhost'), init), photoEnv);
    const names = { admin: uniqueName('ph_admin'), qm: uniqueName('ph_qm'), panelist: uniqueName('ph_pan'), photographer: uniqueName('ph_snap') };
    accountIds.push(
      await makeAccount(names.admin, 'admin'),
      await makeAccount(names.qm, 'queue_manager'),
      await makeAccount(names.panelist, 'panelist'),
      await makeAccount(names.photographer, 'photographer'),
    );
    [admin, qm, panelist, photographer] = await Promise.all(
      [names.admin, names.qm, names.panelist, names.photographer].map(async (name) => createApi(await signIn(name), { photoFetch })),
    );
    inductionId = (await qm.boardSnapshot()).induction.id;
    const reg = `PHOTO${Date.now()}`;
    await qm.importCandidates([{
      submitted_at: new Date().toISOString(), reg_number: reg, full_name: 'Photo Tester', email: '', account_email: '',
      phone: '', department: '', batch: '', preferences: ['', '', '', ''],
      answers: { general: [], dev: [], logikal: [], lnd: [], marketing: [] },
    }]);
    const candidate = (await qm.listCandidates(inductionId)).find((c) => c.reg_number === reg);
    if (!candidate) throw new Error('imported candidate not found');
    candidateId = candidate.id;
    number = candidate.number;
    await qm.checkIn(candidateId);
  });

  afterAll(async () => {
    if (interviewId) await qm.endInterview(interviewId).catch(() => undefined);
    if (panelId) await admin.deletePanel(panelId).catch(() => undefined);
    for (const id of accountIds) await service.auth.admin.deleteUser(id);
    await rm(folder, { recursive: true, force: true });
  });

  it('shows the photographer who is waiting, and nothing else', async () => {
    const entry = (await photographer.photoQueue()).find((e) => e.candidate_id === candidateId);
    expect(sortedKeys(entry)).toEqual(['candidate_id', 'checked_in_at', 'name', 'number', 'photo_taken_at']);
    expect(entry).toMatchObject({ number, name: 'Photo Tester', photo_taken_at: null });
    await expect(photographer.boardSnapshot()).rejects.toEqual(new ApiError(NOT_ALLOWED));
    await expect(photographer.listCandidates(inductionId)).resolves.toEqual([]); // row-level security hides the table
  });

  it('saves a photo in the bucket and marks the candidate', async () => {
    const takenAt = await photographer.uploadPhoto(candidateId, JPEG());

    expect(await readdir(join(folder, inductionId))).toEqual([`${candidateId}.jpg`]);
    expect((await photographer.photoQueue()).find((e) => e.candidate_id === candidateId)?.photo_taken_at).toBe(takenAt);
    expect((await qm.boardSnapshot()).pool.find((e) => e.candidate_id === candidateId)?.has_photo).toBe(true);
    expect((await panelist.candidate(candidateId)).photo_taken_at).toBe(takenAt);
    const blob = await panelist.photoBlob(candidateId, takenAt);
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array(await JPEG().arrayBuffer()));
  });

  it('refuses the wrong people and the wrong files', async () => {
    await expect(panelist.uploadPhoto(candidateId, JPEG())).rejects.toEqual(new ApiError(NOT_ALLOWED));
    await expect(photographer.uploadPhoto(candidateId, new Blob(['not a jpeg']))).rejects.toEqual(new ApiError('The photo must be a JPEG.'));
    await expect(photographer.deleteAllPhotos()).rejects.toEqual(new ApiError(NOT_ALLOWED));
  });

  it('stops the photographer once the candidate has gone in', async () => {
    panelId = await admin.addPanel();
    await panelist.setMyPanel(panelId); // send in lines people up for a panel nobody is sitting in
    interviewId = await qm.sendIn(candidateId, panelId);

    await expect(photographer.uploadPhoto(candidateId, JPEG())).rejects.toEqual(new ApiError(`Candidate #${number} is not waiting`));
    await expect(photographer.photoBlob(candidateId, 'any')).rejects.toEqual(new ApiError(NOT_ALLOWED));
    expect((await photographer.photoQueue()).some((e) => e.candidate_id === candidateId)).toBe(false);
    expect(await panelist.photoBlob(candidateId, 'any')).not.toBeNull();
  });

  it('lets an admin delete every photo, twice without harm', async () => {
    expect(await admin.photoCount()).toBeGreaterThanOrEqual(1);
    expect(await admin.deleteAllPhotos()).toBeGreaterThanOrEqual(1);
    expect(await admin.photoCount()).toBe(0);
    expect((await folderBucket(folder).list()).objects).toEqual([]);
    expect(await panelist.photoBlob(candidateId, 'any')).toBeNull();
    expect(await admin.deleteAllPhotos()).toBe(0);
  });
});
