// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetSatIn, loadSatIn, rememberSatIn } from '../../../src/panel/satIn.ts';

describe('the interviews a panelist sat in, on this device', () => {
  beforeEach(() => localStorage.clear());

  it('remembers each interview once, per person', () => {
    rememberSatIn('u-a', 'i1');
    rememberSatIn('u-a', 'i2');
    rememberSatIn('u-a', 'i1');
    rememberSatIn('u-b', 'i9');
    expect(loadSatIn('u-a')).toEqual(['i1', 'i2']);
    expect(loadSatIn('u-b')).toEqual(['i9']);
  });

  it('forgets the ones it is told to, and clears the key when none are left', () => {
    rememberSatIn('u-a', 'i1');
    rememberSatIn('u-a', 'i2');
    forgetSatIn('u-a', ['i1', 'i7']);
    expect(loadSatIn('u-a')).toEqual(['i2']);
    forgetSatIn('u-a', new Set(['i2']));
    expect(localStorage.length).toBe(0);
  });

  it('keeps only the newest hundred', () => {
    for (let n = 1; n <= 105; n++) rememberSatIn('u-a', `i${n}`);
    const ids = loadSatIn('u-a');
    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe('i6');
  });

  it('treats damaged storage as nothing remembered', () => {
    localStorage.setItem('induction:sat-in:u-a', '{not json');
    expect(loadSatIn('u-a')).toEqual([]);
    localStorage.setItem('induction:sat-in:u-a', JSON.stringify(['i1', 3, null]));
    expect(loadSatIn('u-a')).toEqual(['i1']);
  });
});
