/** Assertions over the crop geometry — the part with real logic in it. */
import assert from 'node:assert/strict';
import { computeCrop, aspectFit } from '../src/crop.js';
import { resolve } from '../src/template.js';

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; };

const gutter = { width: 282, center: 5438, x0: 5297, x1: 5579 };
const hero = { rect: { left: 0, top: 0, width: 10876, height: 3676 }, crossesGutter: true };
const side = { rect: { left: 394, top: 398, width: 4612, height: 2880 }, crossesGutter: false };
const land = { width: 6000, height: 4000 };
const box = (x, y) => ({ x, y, w: 0.1133, h: 0.17 });

t('cover fit fills the slot exactly', () => {
  const c = computeCrop(land, side, box(0.5, 0.4), gutter);
  const a = c.extract.width / c.extract.height;
  assert.ok(Math.abs(a - side.rect.width / side.rect.height) < 0.01, 'aspect mismatch');
});

t('crop stays inside the source frame', () => {
  for (const fx of [0, 0.1, 0.5, 0.9, 1]) {
    const c = computeCrop(land, hero, box(fx, 0.4), gutter);
    assert.ok(c.extract.left >= 0 && c.extract.top >= 0, 'negative origin');
    assert.ok(c.extract.left + c.extract.width <= land.width, 'overruns width');
    assert.ok(c.extract.top + c.extract.height <= land.height, 'overruns height');
  }
});

t('non-crossing slot reports n/a and never zooms', () => {
  const c = computeCrop(land, side, box(0.5, 0.4), gutter);
  assert.equal(c.gutterStatus, 'n/a');
  assert.equal(c.zoomPct, 0);
});

t('subject already clear of the fold is left alone', () => {
  const c = computeCrop(land, hero, box(0.22, 0.4), gutter);
  assert.equal(c.gutterStatus, 'clear');
  assert.equal(c.zoomPct, 0);
});

t('subject on the fold is moved off it', () => {
  const c = computeCrop(land, hero, box(0.5, 0.4), gutter);
  assert.equal(c.gutterStatus, 'moved');
  assert.ok(c.zoomPct > 0, 'expected a punch-in');
});

t('the whole subject BOX clears the fold, not just its centre', () => {
  const c = computeCrop(land, hero, box(0.5, 0.4), gutter);
  const margin = gutter.width * 0.15;
  const l = c.focusCanvasX - c.subjectHalfWidth;
  const r = c.focusCanvasX + c.subjectHalfWidth;
  // reported coords are rounded to whole pixels, so allow 1px of slack
  assert.ok(r <= gutter.x0 - margin + 1 || l >= gutter.x1 + margin - 1,
    `box ${l}..${r} still overlaps fold ${gutter.x0}..${gutter.x1}`);
});

t('an impossible subject is reported, not silently mangled', () => {
  // A face spanning 70% of the frame cannot be walked off a centred fold.
  const c = computeCrop(land, hero, { x: 0.5, y: 0.4, w: 0.7 }, gutter);
  assert.equal(c.gutterStatus, 'unresolved');
});

t('zoom never exceeds the ceiling', () => {
  const c = computeCrop(land, hero, { x: 0.5, y: 0.4, w: 0.6 }, gutter, { maxZoom: 1.18 });
  assert.ok(c.zoomPct <= 18.01, `zoomed ${c.zoomPct}%`);
});

t('aspectFit is orientation-symmetric and bounded', () => {
  assert.equal(aspectFit({ width: 100, height: 100 }, { rect: { width: 50, height: 50 } }), 1);
  assert.ok(aspectFit(land, hero) < 1);
});

t('geometry: bleed expands the canvas and offsets the trim', () => {
  const g = resolve({
    id: 't', size: { w_in: 36, h_in: 12, dpi: 300, bleed_in: 0.125 },
    gutter: { center: 0.5, width_in: 0.94 },
    slots: [{ id: 'a', rect: [0.5, 0.25, 0.25, 0.5] }],
  });
  assert.equal(g.canvas.width, 10800 + 76);
  assert.equal(g.trim.left, 38);
  assert.equal(g.gutter.center, 38 + 5400);
  assert.equal(g.slots[0].crossesGutter, true);
});

t('edge slots bleed outward, interior slots do not', () => {
  const g = resolve({
    id: 't', size: { w_in: 36, h_in: 12, dpi: 300, bleed_in: 0.125 },
    slots: [{ id: 'full', rect: [0, 0, 1, 1] }, { id: 'mid', rect: [0.4, 0.4, 0.2, 0.2] }],
  });
  assert.equal(g.slots[0].left ?? g.slots[0].rect.left, 0);
  assert.equal(g.slots[0].rect.width, 10800 + 76);
  assert.equal(g.slots[1].rect.left, 38 + 4320);
});

t('oversized canvas is rejected before wasting a render', () => {
  assert.throws(() => resolve({
    id: 'huge', size: { w_in: 60, h_in: 20, dpi: 600 }, slots: [{ id: 'a', rect: [0, 0, 1, 1] }],
  }), /30000px PSD limit/);
});

console.log(`\n  ${pass} passing\n`);
