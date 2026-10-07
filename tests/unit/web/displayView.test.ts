import { describe, expect, it } from 'vitest';
import { displayColumns, displayRows, newlySentIn, selectPanels } from '../../../src/display/displayView.ts';
import type { DisplayPanel } from '../../../src/lib/types.ts';

const tile = (id: string, current: DisplayPanel['current'] = null): DisplayPanel => ({ id, name: id, current, lined_up: [] });
const sara = { number: 7, name: 'Sara', started_at: '2026-09-26T09:50:00Z' };
const ali = { number: 12, name: 'Ali', started_at: '2026-09-26T10:05:00Z' };

describe('displayColumns', () => {
  it('fits 1–4 panels on a 16:9 screen', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 9].map(displayColumns)).toEqual([1, 1, 2, 3, 2, 3, 3, 4, 4]);
  });
});

describe('displayRows', () => {
  it('is one row up to 3 panels, then two, then more', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(displayRows)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 3]);
  });
});

describe('newlySentIn', () => {
  it('flags a panel when someone new is sent in, or the same person comes back after a reopen', () => {
    expect(newlySentIn([tile('p1', sara), tile('p2')], [tile('p1', sara), tile('p2', ali)])).toEqual(['p2']);
    expect(newlySentIn([tile('p1', sara)], [tile('p1', ali)])).toEqual(['p1']);
    expect(newlySentIn([tile('p1')], [tile('p1', sara)])).toEqual(['p1']);
    expect(newlySentIn([], [tile('p9', ali)])).toEqual(['p9']);
  });

  it('flags nothing on the first load, on a reload with no change, or when an interview ends', () => {
    expect(newlySentIn(undefined, [tile('p1', sara)])).toEqual([]);
    expect(newlySentIn([tile('p1', sara)], [tile('p1', { ...sara })])).toEqual([]);
    expect(newlySentIn([tile('p1', sara)], [tile('p1')])).toEqual([]);
  });
});

describe('selectPanels', () => {
  it('shows one panel when asked, and every panel for an unknown id', () => {
    const panels = [tile('p1'), tile('p2')];
    expect(selectPanels(panels, 'p2').map((p) => p.id)).toEqual(['p2']);
    expect(selectPanels(panels, 'gone').map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(selectPanels(panels, null).map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});
