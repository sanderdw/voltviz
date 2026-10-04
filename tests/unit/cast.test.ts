import { describe, expect, it } from 'vitest';
import { parseCastMessage } from '../../src/cast/protocol';
import { containFit, drawLayerCanvases } from '../../src/visualizers/runtime/drawLayer';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height }) as DOMRect;

describe('containFit', () => {
  it('letterboxes a wider source and pillarboxes a taller one', () => {
    expect(containFit(1600, 600, 1280, 720)).toEqual({ x: 0, y: 120, w: 1280, h: 480 });
    expect(containFit(600, 600, 1280, 720)).toEqual({ x: 280, y: 0, w: 720, h: 720 });
    expect(containFit(1920, 1080, 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  it('fills the target for an empty source', () => {
    expect(containFit(0, 0, 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });
});

describe('drawLayerCanvases', () => {
  it('maps every canvas from container space into the target box and skips tiny ones', () => {
    const canvases = [
      { getBoundingClientRect: () => rect(100, 50, 800, 400) }, // fills the container
      { getBoundingClientRect: () => rect(500, 250, 400, 200) }, // bottom-right quarter
      { getBoundingClientRect: () => rect(100, 50, 1, 1) }, // hidden helper canvas
    ];
    const container = {
      getBoundingClientRect: () => rect(100, 50, 800, 400),
      querySelectorAll: () => canvases,
    } as unknown as HTMLElement;
    const calls: number[][] = [];
    const ctx = { drawImage: (_c: unknown, ...a: number[]) => { calls.push(a); } } as unknown as CanvasRenderingContext2D;
    drawLayerCanvases(ctx, container, 10, 20, 400, 200);
    expect(calls).toEqual([[10, 20, 400, 200], [210, 120, 200, 100]]);
  });
});

describe('parseCastMessage', () => {
  it('accepts objects and JSON strings, rejects anything else', () => {
    expect(parseCastMessage({ type: 'offer', sdp: 'v=0' })).toEqual({ type: 'offer', sdp: 'v=0' });
    expect(parseCastMessage('{"type":"answer","sdp":"v=0"}')).toEqual({ type: 'answer', sdp: 'v=0' });
    expect(parseCastMessage({ type: 'error', message: 'nope' })).toEqual({ type: 'error', message: 'nope' });
    expect(parseCastMessage({ type: 'offer' })).toBeNull();
    expect(parseCastMessage('not json')).toBeNull();
    expect(parseCastMessage(null)).toBeNull();
  });
});
