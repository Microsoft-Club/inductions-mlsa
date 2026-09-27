import { describe, expect, it } from 'vitest';
import { targetSize } from '../../../src/photos/shrinkPhoto.ts';

describe('targetSize', () => {
  it('fits the long side to 800 px, landscape or portrait', () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 800, height: 600 });
    expect(targetSize(3000, 4000)).toEqual({ width: 600, height: 800 });
  });
  it('never enlarges a small photo', () => {
    expect(targetSize(640, 480)).toEqual({ width: 640, height: 480 });
  });
  it('keeps at least one pixel on the short side', () => {
    expect(targetSize(8000, 2)).toEqual({ width: 800, height: 1 });
  });
});
