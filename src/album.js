/**
 * Album planning: photos -> spreads.
 *
 * Phase 03 replaces the scoring here with the real weighted scorer plus a
 * Hungarian assignment and a rhythm pass. This version is deliberately simple
 * but not stupid: it chunks photos into spreads, then fills each spread's slots
 * by best aspect/orientation fit, and never repeats a photo.
 */
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { aspectFit } from './crop.js';

const IMG = /\.(jpe?g|png|tiff?|webp)$/i;

export async function readPhotos(dir, files) {
  const out = [];
  for (const name of files.filter((f) => IMG.test(f)).sort()) {
    const file = path.join(dir, name);
    let focus = { x: 0.5, y: 0.5, w: 0.05, h: 0.05 };
    const sidecar = `${file}.focus.json`;
    if (existsSync(sidecar)) {
      try { focus = { ...focus, ...JSON.parse(await readFile(sidecar, 'utf8')) }; } catch { /* centre */ }
    }
    let meta;
    try { meta = await sharp(file).metadata(); } catch { continue; }
    if (!meta.width || !meta.height) continue;
    out.push({ file, name, focus, width: meta.width, height: meta.height });
  }
  return out;
}

/** Score one photo against one slot. The seam where Phase 03 grows. */
function score(photo, slot) {
  let s = 2.4 * aspectFit(photo, slot);
  const portrait = photo.height > photo.width;
  if (slot.prefer === 'portrait') s += portrait ? 0.9 : -0.9;
  if (slot.prefer === 'landscape') s += portrait ? -0.9 : 0.9;
  // A hero slot wants a photo with room to breathe around the subject.
  if (slot.weight === 'hero') s += 0.6 * (1 - Math.min(1, (photo.focus.w ?? 0.05) * 4));
  return s;
}

/**
 * A photo is used at most once across the whole album, and a spread is only
 * emitted if every slot can be filled with a distinct photo.
 *
 * @returns spreads: [{ index, picks: [{ slotId, photo }] }]
 */
export function planAlbum(geo, photos, { maxSpreads = 0, allowReuse = false } = {}) {
  const k = geo.slots.length;
  // Never emit a spread we cannot fill with distinct photos.
  let total = Math.floor(photos.length / k);
  if (total === 0) total = photos.length ? 1 : 0;
  if (maxSpreads > 0) total = Math.min(maxSpreads, total);

  const usedAlbum = new Set();          // a photo appears once per album
  const spreads = [];

  for (let i = 0; i < total; i++) {
    // Candidate window: this spread's chunk, widened so there is real choice.
    const pool = photos.slice(i * k, i * k + k * 2)
      .filter((p) => allowReuse || !usedAlbum.has(p.file));
    if (pool.length < k && !allowReuse) {
      // Top up from anything still unused, keeping album order roughly intact.
      for (const p of photos) {
        if (pool.length >= k) break;
        if (!usedAlbum.has(p.file) && !pool.includes(p)) pool.push(p);
      }
    }
    if (!pool.length) break;

    const used = new Set();
    const picks = [];
    let short = false;
    for (const slot of geo.slots) {
      let best = null, bestScore = -Infinity;
      for (const p of pool) {
        if (used.has(p.file)) continue;
        const sc = score(p, slot);
        if (sc > bestScore) { bestScore = sc; best = p; }
      }
      if (!best) { short = true; break; }   // ran out of distinct photos
      used.add(best.file);
      picks.push({ slotId: slot.id, photo: best });
    }
    if (short) break;

    for (const f of used) usedAlbum.add(f);
    spreads.push({ index: spreads.length, picks });
  }
  return spreads;
}
