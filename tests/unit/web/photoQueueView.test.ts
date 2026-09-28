import { describe, expect, it } from 'vitest';
import { matchesPhotoSearch, photoCounts, photoLists } from '../../../src/photos/photoQueueView.ts';
import { photoEntry } from './fixtures.ts';

const entries = [
  photoEntry(13, 'Hina Malik', { checked_in_at: '2026-09-26T09:05:00Z' }),
  photoEntry(12, 'Ali Khan', { checked_in_at: '2026-09-26T09:00:00Z' }),
  photoEntry(20, 'Bilal Raza', { checked_in_at: '2026-09-26T08:50:00Z', photo_taken_at: '2026-09-26T09:10:00Z' }),
  photoEntry(21, 'Sana Ali', { checked_in_at: '2026-09-26T08:55:00Z', photo_taken_at: '2026-09-26T09:20:00.123456+00:00' }),
];

describe('photoLists', () => {
  it('puts people without a photo first-come first-served, and the latest photos first', () => {
    const { needs, done } = photoLists(entries);
    expect(needs.map((e) => e.number)).toEqual([12, 13]);
    expect(done.map((e) => e.number)).toEqual([21, 20]);
  });

  it('finds people by number (with or without #) or by part of their name', () => {
    expect(photoLists(entries, '#12').needs.map((e) => e.number)).toEqual([12]);
    expect(photoLists(entries, '2').done.map((e) => e.number)).toEqual([21, 20]);
    expect(photoLists(entries, ' ALI ').needs.map((e) => e.number)).toEqual([12]);
    expect(photoLists(entries, ' ALI ').done.map((e) => e.number)).toEqual([21]);
    expect(matchesPhotoSearch(entries[0], '')).toBe(true);
  });
});

describe('photoCounts', () => {
  it('counts everyone waiting, whatever the search', () => {
    expect(photoCounts(entries)).toEqual({ needs: 2, done: 2 });
    expect(photoCounts([])).toEqual({ needs: 0, done: 0 });
  });
});

describe('matchesPhotoSearch with a multi-word name', () => {
  const entry = photoEntry(30, 'Muhammad Ali Khan');

  it('matches when every query word is a prefix of some name word, whatever the order', () => {
    expect(matchesPhotoSearch(entry, 'muhammad ali')).toBe(true);
    expect(matchesPhotoSearch(entry, 'ali k')).toBe(true);
    expect(matchesPhotoSearch(entry, 'muhammad ali khan')).toBe(true);
    expect(matchesPhotoSearch(entry, 'ali muhammad')).toBe(true);
  });

  it('does not match a query word with no matching prefix in the name', () => {
    expect(matchesPhotoSearch(entry, 'alik')).toBe(false);
  });

  it('does not match a name that merely shares a substring', () => {
    expect(matchesPhotoSearch(photoEntry(31, 'Hina Malik'), 'ali')).toBe(false);
  });

  it('ignores leading, trailing and doubled spaces', () => {
    expect(matchesPhotoSearch(entry, '  muhammad   ali  ')).toBe(true);
  });
});
