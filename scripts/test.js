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


// ---------- async: template library + album planning ----------
const { loadTemplate } = await import('../src/template.js');
const { planAlbum } = await import('../src/album.js');
const { readdir } = await import('node:fs/promises');

const ta = async (name, fn) => { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; };

const files = (await readdir('templates')).filter((f) => f.endsWith('.json')).sort();
const geos = [];
for (const f of files) geos.push(await loadTemplate('templates/' + f));

await ta(`all ${geos.length} templates have sane geometry`, () => {
  for (const g of geos) {
    for (const s of g.slots) {
      const r = s.rect;
      assert.ok(r.left >= 0 && r.top >= 0, `${g.id}/${s.id} negative origin`);
      assert.ok(r.left + r.width <= g.canvas.width + 1, `${g.id}/${s.id} overruns width`);
      assert.ok(r.top + r.height <= g.canvas.height + 1, `${g.id}/${s.id} overruns height`);
      assert.ok(r.width > 200 && r.height > 200, `${g.id}/${s.id} degenerate`);
    }
  }
});

await ta('only the full-bleed layout crosses the fold', () => {
  for (const g of geos) {
    for (const s of g.slots) {
      if (s.crossesGutter) assert.match(g.id, /hero\.full/, `${g.id}/${s.id} crosses the fold`);
    }
  }
});

await ta('slots within a template never overlap', () => {
  for (const g of geos) {
    for (let i = 0; i < g.slots.length; i++) {
      for (let j = i + 1; j < g.slots.length; j++) {
        const a = g.slots[i].rect, b = g.slots[j].rect;
        const hit = a.left < b.left + b.width && b.left < a.left + a.width
                 && a.top < b.top + b.height && b.top < a.top + a.height;
        assert.ok(!hit, `${g.id}: ${g.slots[i].id} overlaps ${g.slots[j].id}`);
      }
    }
  }
});

const fakePhotos = (n) => Array.from({ length: n }, (_, i) => ({
  file: `p${i}.jpg`, name: `p${i}.jpg`, width: i % 3 ? 6000 : 4000, height: i % 3 ? 4000 : 6000,
  focus: { x: 0.5, y: 0.4, w: 0.1, h: 0.15 },
}));

await ta('no photo is used twice in one album', () => {
  const set = geos.filter((g) => g.album === '12x36');
  const spreads = planAlbum(set, fakePhotos(40), { vary: true });
  const seen = new Set();
  for (const sp of spreads) for (const p of sp.picks) {
    assert.ok(!seen.has(p.photo.file), `${p.photo.file} reused`);
    seen.add(p.photo.file);
  }
  assert.ok(spreads.length > 3, 'expected several spreads');
});

await ta('varying never repeats a layout back to back', () => {
  const set = geos.filter((g) => g.album === '12x36');
  const spreads = planAlbum(set, fakePhotos(60), { vary: true });
  for (let i = 1; i < spreads.length; i++) {
    assert.notEqual(spreads[i].templateId, spreads[i - 1].templateId,
      `layout repeated at spread ${i + 1}`);
  }
});

await ta('a single template still works, and repeats', () => {
  const one = geos.find((g) => g.id === '12x36.classic.3up');
  const spreads = planAlbum([one], fakePhotos(12), { vary: false });
  assert.ok(spreads.length >= 3);
  for (const sp of spreads) assert.equal(sp.templateId, one.id);
});

await ta('every spread is completely filled', () => {
  const set = geos.filter((g) => g.album === '12x30');
  for (const sp of planAlbum(set, fakePhotos(50), { vary: true })) {
    const g = set.find((x) => x.id === sp.templateId);
    assert.equal(sp.picks.length, g.slots.length, `${sp.templateId} under-filled`);
  }
});

await ta('every look still yields 4 channels after ensureAlpha', async () => {
  // Regression: .greyscale() switches output to the 1-band 'b-w' colourspace and
  // ensureAlpha will not add alpha to it. The raw buffer then came back a
  // quarter of the declared size and libvips threw "memory area too small".
  const sharp = (await import('sharp')).default;
  const { LOOKS, applyLook } = await import('../src/filters.js');
  const base = await sharp({ create: { width: 40, height: 24, channels: 3, background: '#8a5a3a' } })
    .jpeg().toBuffer();
  for (const l of LOOKS) {
    const out = await applyLook(sharp(base), l.id).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(out.info.channels, 4, `${l.id} produced ${out.info.channels} channels`);
    assert.equal(out.data.length, 40 * 24 * 4, `${l.id} buffer size mismatch`);
  }
});

await ta('monochrome looks really are monochrome', async () => {
  const sharp = (await import('sharp')).default;
  const { applyLook } = await import('../src/filters.js');
  const base = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3a7ac8' } })
    .jpeg().toBuffer();
  for (const id of ['bw', 'noir']) {
    const { data } = await applyLook(sharp(base), id).raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 3) {
      assert.ok(Math.abs(data[i] - data[i + 1]) <= 2 && Math.abs(data[i + 1] - data[i + 2]) <= 2,
        `${id} left colour in the image`);
    }
  }
});


await ta('every decoration theme lands on the canvas', async () => {
  const { DECORS, decorOverlays } = await import('../src/decor.js');
  const { existsSync } = await import('node:fs');
  for (const g of geos) {
    for (const d of DECORS) {
      for (const ov of decorOverlays(d.id, g)) {
        assert.ok(existsSync(ov.asset), `${d.id}: missing asset ${ov.asset}`);
        assert.ok(ov.rect.width > 0 && ov.rect.height > 0, `${d.id}: degenerate rect`);
        // May hang off the edge on purpose, but must intersect the canvas.
        const r = ov.rect;
        assert.ok(r.left < g.canvas.width && r.top < g.canvas.height
               && r.left + r.width > 0 && r.top + r.height > 0,
          `${d.id} on ${g.id}: overlay entirely off-canvas`);
        assert.ok(ov.opacity > 0 && ov.opacity <= 1, `${d.id}: bad opacity`);
      }
    }
  }
});

await ta('overlays hanging off the canvas are clipped, not rejected', async () => {
  const { renderOverlay } = await import('../src/compose.js');
  const g = geos.find((x) => x.id === '12x36.classic.3up');
  const { decorOverlays } = await import('../src/decor.js');
  const bleeding = decorOverlays('mandala', g);
  assert.ok(bleeding.some((o) => o.rect.left < 0), 'expected a deliberately off-canvas overlay');
  for (const ov of bleeding) {
    const l = await renderOverlay(g, ov);
    assert.ok(l, 'overlay was dropped');
    assert.ok(l.left >= 0 && l.top >= 0, 'clipped overlay still has a negative origin');
    assert.ok(l.left + l.width <= g.canvas.width, 'clipped overlay overruns the canvas');
    assert.equal(l.data.length, l.width * l.height * 4, 'buffer does not match declared size');
  }
});

console.log(`\n  ${pass} passing\n`);
