/**
 * Does handing libvips FILE inputs instead of in-memory raw buffers let it
 * stream the composite? This is the central memory claim in the design doc.
 */
import sharp from 'sharp';
import { loadTemplate } from '../src/template.js';
import { backgroundRef, renderSlot } from '../src/compose.js';
import { readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

sharp.cache(false);
sharp.concurrency(4);
const geo = await loadTemplate('templates/12x36.classic.3up.json');
const bg = backgroundRef(geo);

const photos = [];
for (const f of ['photo-1.jpg', 'photo-2.jpg', 'photo-4.jpg', 'photo-3.jpg']) {
  const file = path.join('samples', f);
  const sc = `${file}.focus.json`;
  photos.push({ file, focus: existsSync(sc) ? JSON.parse(await readFile(sc, 'utf8')) : { x: .5, y: .5 } });
}

const track = async (label, fn) => {
  if (global.gc) global.gc();
  const start = process.memoryUsage().rss;
  let peak = start;
  const s = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 15);
  const t = performance.now();
  const r = await fn();
  clearInterval(s);
  console.log(`${label.padEnd(30)} ${((performance.now() - t) / 1000).toFixed(2)}s   peak ${(peak / 1048576).toFixed(0).padStart(5)} MB`);
  return r;
};

// ---- A: everything in memory (current implementation) ----
await track('A. raw buffers in memory', async () => {
  const layers = [];
  for (let i = 0; i < geo.slots.length; i++) layers.push(await renderSlot(geo, geo.slots[i], photos[i]));
  await sharp({ create: { width: bg.width, height: bg.height, channels: 4, background: { r: 250, g: 248, b: 245, alpha: 1 } } })
    .composite(layers.map((l) => ({ input: l.data, raw: { width: l.width, height: l.height, channels: 4 }, left: l.left, top: l.top })))
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile('out/bench-A.jpg');
});

// ---- B: slot rasters spooled to disk, composited from files ----
await track('B. slots spooled to disk', async () => {
  const refs = [];
  for (let i = 0; i < geo.slots.length; i++) {
    const l = await renderSlot(geo, geo.slots[i], photos[i]);
    const tmp = `out/.slot-${l.slotId}.png`;
    await sharp(l.data, { raw: { width: l.width, height: l.height, channels: 4 } })
      .png({ compressionLevel: 1 }).toFile(tmp);
    refs.push({ input: tmp, left: l.left, top: l.top });
    // raster goes out of scope here — only one is ever live
  }
  await sharp({ create: { width: bg.width, height: bg.height, channels: 4, background: { r: 250, g: 248, b: 245, alpha: 1 } } })
    .composite(refs)
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile('out/bench-B.jpg');
  for (const r of refs) await unlink(r.input);
});
