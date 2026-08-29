/**
 * The question Phase 00 exists to answer: does a full 40-spread album render
 * in bounded memory, or does RSS climb until the app dies?
 */
import sharp from 'sharp';
import { loadTemplate } from '../src/template.js';
import { backgroundRef, renderSlot, flatten } from '../src/compose.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const N = Number(process.argv[2] ?? 40);
const geo = await loadTemplate('templates/12x36.classic.3up.json');
const bg = backgroundRef(geo);

const pool = [];
for (const f of ['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg', 'photo-4.jpg', 'photo-5.jpg']) {
  const file = path.join('samples', f);
  const sc = `${file}.focus.json`;
  pool.push({ file, focus: existsSync(sc) ? JSON.parse(await readFile(sc, 'utf8')) : { x: .5, y: .5 } });
}

let peak = 0;
const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
const t0 = performance.now();
const trace = [];

for (let i = 0; i < N; i++) {
  const layers = [];
  for (let s = 0; s < geo.slots.length; s++) {
    layers.push(await renderSlot(geo, geo.slots[s], pool[(i + s) % pool.length]));
  }
  await flatten(geo, bg, layers, `out/album/spread-${String(i + 1).padStart(2, '0')}.jpg`);
  const rss = process.memoryUsage().rss;
  trace.push(rss);
  if (i % 5 === 4 || i === 0) {
    process.stdout.write(`  spread ${String(i + 1).padStart(2)}/${N}   rss ${(rss / 1048576).toFixed(0).padStart(5)} MB   ` +
      `${((performance.now() - t0) / 1000 / (i + 1)).toFixed(2)}s/spread\n`);
  }
}
clearInterval(sampler);

const secs = (performance.now() - t0) / 1000;
const first = trace.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
const last = trace.slice(-5).reduce((a, b) => a + b, 0) / 5;
console.log(`\n  ${N} spreads in ${secs.toFixed(1)}s  (${(secs / N).toFixed(2)}s each)`);
console.log(`  peak RSS      ${(peak / 1048576).toFixed(0)} MB`);
console.log(`  first 5 avg   ${(first / 1048576).toFixed(0)} MB`);
console.log(`  last 5 avg    ${(last / 1048576).toFixed(0)} MB`);
console.log(`  drift         ${(((last - first) / 1048576)).toFixed(0)} MB over ${N} spreads  ` +
  `-> ${Math.abs(last - first) / 1048576 < 150 ? '\x1b[32mBOUNDED\x1b[0m' : '\x1b[31mLEAKING\x1b[0m'}`);
