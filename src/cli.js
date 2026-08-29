#!/usr/bin/env node
/**
 * Phase 00 render spike.
 *
 *   node src/cli.js --template templates/12x36.classic.3up.json \
 *                   --photos samples --out out
 *
 * Answers one question: can a JavaScript stack write a correct print-resolution
 * spread as both JPEG and layered PSD inside a sane memory budget? Everything
 * is instrumented so the answer is a number, not an opinion.
 */
import { readdir, stat, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadTemplate, describe } from './template.js';
import { aspectFit } from './crop.js';
import { renderSlot, renderBackground, backgroundRef, renderOverlay, flatten, proof } from './compose.js';
import { writePsd } from './psd.js';

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (n) => argv.includes(`--${n}`);

const opts = {
  template: flag('template', 'templates/12x36.classic.3up.json'),
  photos:   flag('photos', 'samples'),
  out:      flag('out', 'out'),
  format:   flag('format', 'jpg'),
  psd:      !has('no-psd'),
  psdComposite: !has('no-psd-composite'),
  proof:    !has('no-proof'),
  mozjpeg:  has('mozjpeg'),   // ~18% smaller files, ~8x slower encode
};

// ---------- instrumentation ----------
const MB = (b) => (b / 1048576 < 10 ? (b / 1048576).toFixed(1) : (b / 1048576).toFixed(0)).padStart(5) + ' MB';
let peakRss = 0;
const sampler = setInterval(() => {
  const r = process.memoryUsage().rss;
  if (r > peakRss) peakRss = r;
}, 25);
sampler.unref();

const marks = [];
let t0 = performance.now();
const mark = (label) => {
  const now = performance.now();
  marks.push({ label, ms: now - t0, rss: process.memoryUsage().rss });
  t0 = now;
};

// ---------- photo discovery ----------
const IMG = /\.(jpe?g|png|tiff?|webp)$/i;

async function loadPhotos(dir) {
  const names = (await readdir(dir)).filter((f) => IMG.test(f) && !f.startsWith('bg-')).sort();
  const out = [];
  for (const n of names) {
    const file = path.join(dir, n);
    if (!(await stat(file)).isFile()) continue;
    let focus = { x: 0.5, y: 0.5 };
    const sidecar = `${file}.focus.json`;
    if (existsSync(sidecar)) {
      try { focus = JSON.parse(await readFile(sidecar, 'utf8')); } catch { /* keep centre */ }
    }
    out.push({ file, focus });
  }
  return out;
}

/**
 * Placeholder for the Phase 03 scorer: pick the unused photo whose aspect ratio
 * fits each slot best. Deliberately naive — it exists so the spike produces a
 * sane-looking spread, not because it is the real assignment algorithm.
 */
async function assign(geo, photos) {
  const sharp = (await import('sharp')).default;
  const metas = await Promise.all(
    photos.map(async (p) => {
      const m = await sharp(p.file).metadata();
      return { ...p, width: m.width, height: m.height };
    })
  );
  const used = new Set();
  return geo.slots.map((slot) => {
    let best = null, bestScore = -Infinity;
    for (const m of metas) {
      if (used.has(m.file)) continue;
      let s = aspectFit(m, slot);
      const isPortrait = m.height > m.width;
      if (slot.prefer === 'portrait') s += isPortrait ? 0.35 : -0.35;
      if (slot.prefer === 'landscape') s += isPortrait ? -0.35 : 0.35;
      if (s > bestScore) { bestScore = s; best = m; }
    }
    if (!best) best = metas[0];
    used.add(best.file);
    return { slot, photo: best };
  });
}

// ---------- run ----------
const geo = await loadTemplate(opts.template);
await mkdir(opts.out, { recursive: true });

console.log('\n\x1b[1mSpread Engine — Phase 00 render spike\x1b[0m');
console.log('  ' + describe(geo) + '\n');

const photos = await loadPhotos(opts.photos);
if (!photos.length) { console.error(`no images found in ${opts.photos}`); process.exit(1); }
mark('discover photos');

const pairs = await assign(geo, photos);
mark('assign photos to slots');

const bgRef = backgroundRef(geo);
const layers = [];
mark('background (lazy)');

console.log('  \x1b[2mslot   photo          fit    discarded   zoom    fold\x1b[0m');
for (const { slot, photo } of pairs) {
  const l = await renderSlot(geo, slot, photo);
  layers.push(l);
  const c = l.crop;
  const foldColour = c.gutterStatus === 'moved' ? '\x1b[35m'
    : c.gutterStatus === 'unresolved' ? '\x1b[31m' : '\x1b[2m';
  console.log(
    `  ${slot.id.padEnd(6)} ${path.basename(photo.file).padEnd(14)} ` +
    `${String(l.fit).padEnd(6)} ${String(c.discardedPct + '%').padStart(7)}   ` +
    `${String(c.zoomPct + '%').padStart(5)}   ${foldColour}${c.gutterStatus}\x1b[0m`
  );
}
mark('render slots');

for (const ov of geo.overlays) {
  const l = await renderOverlay(geo, ov);
  if (l) layers.push(l);
}
if (geo.overlays.length) mark('overlays');

const base = path.join(opts.out, geo.id);
const flatFile = await flatten(geo, bgRef, layers, `${base}.${opts.format}`, { mozjpeg: opts.mozjpeg });
mark(`flatten -> ${opts.format}`);

let proofFile = null;
if (opts.proof) { proofFile = await proof(flatFile, `${base}.proof.jpg`); mark('proof 1600px'); }

let psdInfo = null;
if (opts.psd) {
  // Only now does the full-canvas background become a real buffer.
  const bgLayer = await renderBackground(geo, bgRef);
  mark('psd background layer');

  let composite = null;
  if (opts.psdComposite) {
    // Decode the file we already wrote, rather than compositing a second time.
    const sharpMod = (await import('sharp')).default;
    const data = await sharpMod(flatFile, { limitInputPixels: 512 * 1024 * 1024 })
      .ensureAlpha().raw().toBuffer();
    composite = { width: geo.canvas.width, height: geo.canvas.height, data };
    mark('psd composite preview');
  }
  psdInfo = await writePsd(geo, [bgLayer, ...layers], `${base}.psd`, { composite });
  mark('write psd');
}

// ---------- report ----------
const fs = await import('node:fs/promises');
const size = async (f) => (f && existsSync(f)) ? (await fs.stat(f)).size : 0;

console.log('\n  \x1b[2mstage                      time        rss after\x1b[0m');
let total = 0;
for (const m of marks) {
  total += m.ms;
  console.log(`  ${m.label.padEnd(24)} ${(m.ms / 1000).toFixed(2).padStart(6)}s   ${MB(m.rss)}`);
}
console.log(`  ${'─'.repeat(48)}`);
console.log(`  ${'total'.padEnd(24)} ${(total / 1000).toFixed(2).padStart(6)}s`);

console.log('\n  \x1b[1moutputs\x1b[0m');
console.log(`  ${path.basename(flatFile).padEnd(34)} ${MB(await size(flatFile))}`);
if (proofFile) console.log(`  ${path.basename(proofFile).padEnd(34)} ${MB(await size(proofFile))}`);
if (psdInfo)   console.log(`  ${path.basename(psdInfo.file).padEnd(34)} ${MB(psdInfo.bytes)}   ${layers.length + 1} layers`);

console.log(`\n  \x1b[1mpeak RSS  ${MB(peakRss)}\x1b[0m   (16 GB machine, ${layers.length} slot rasters held)\n`);
