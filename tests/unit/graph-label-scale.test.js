import { describe, it, expect } from 'vitest';
import { labelScale } from '../../app/userland/app-stdlib/js/graph/view.js';

// A title's size on screen is labelScale(k) * k times its size at zoom 1.
const onScreen = (k) => labelScale(k) * k;

describe('canvas title size as you zoom', () => {
  it('is unchanged at zoom 1', () => {
    expect(labelScale(1)).toBe(1);
  });

  it('grows when zooming in, slower than the canvas', () => {
    expect(onScreen(4)).toBeCloseTo(2);
    expect(onScreen(8)).toBeGreaterThan(onScreen(4));
    expect(onScreen(8)).toBeLessThan(8 / 2);
  });

  it('keeps a floor when zoomed out, so a hub or hovered title stays readable', () => {
    expect(onScreen(0.15)).toBeCloseTo(0.85);
    expect(onScreen(0.5)).toBeCloseTo(0.85);
    expect(onScreen(0.81)).toBeCloseTo(0.9);
  });
});
