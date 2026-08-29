/** Sweep libvips concurrency and JPEG encoder to find the memory/speed knee. */
import sharp from 'sharp';
import { loadTemplate } from '../src/template.js';
import { backgroundRef, renderSlot } from '../src/compose.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

sharp.cache(false);
const geo = await loadTemplate('templates/12x36.classic.3up.json');
const bg = backgroundRef(geo);

const photos = [];
for (const f of ['photo-1.jpg', 'photo-2.jpg', 'photo-4.jpg', 'photo-3.jpg']) {
  const file = path.join('samples', f);
  const sc = `${file}.focus.json`;
  photos.push({ file, focus: existsSync(sc) ? JSON.parse(await readFile(sc, 'utf8')) : { x: .5, y: .5 } });
}

const layers = [];
for (let i = 0; i < geo.slots.length; i++) layers.push(await renderSlot(geo, geo.slots[i], photos[i]));
const baseline = process.memoryUsage().rss;
console.log(`slot rasters held: ${(baseline / 1048576).toFixed(0)} MB\n`);
console.log('threads  mozjpeg   time     peak RSS   delta over baseline');

for (const threads of [1, 2, 4, 8]) {
  for (const moz of [true, false]) {
    sharp.concurrency(threads);
    let peak = 0;
    const s = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 15);
    const t = performance.now();
    await sharp({ create: { width: bg.width, height: bg.height, channels: 4, background: { r: 250, g: 248, b: 245, alpha: 1 } } })
      .composite(layers.map((l) => ({ input: l.data, raw: { width: l.width, height: l.height, channels: 4 }, left: l.left, top: l.top })))
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: moz })
      .toFile(`out/bench-${threads}-${moz}.jpg`);
    const ms = performance.now() - t;
    clearInterval(s);
    console.log(
      `${String(threads).padStart(6)}  ${String(moz).padEnd(7)}  ${(ms / 1000).toFixed(2)}s  ` +
      `${(peak / 1048576).toFixed(0).padStart(7)} MB  ${((peak - baseline) / 1048576).toFixed(0).padStart(8)} MB`
    );
  }
}
