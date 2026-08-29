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
 * @param geos  one resolved template, or several to vary between
 * @returns spreads: [{ index, templateId, picks: [{ slotId, photo }] }]
 */
export function planAlbum(geos, photos, { maxSpreads = 0, vary = false } = {}) {
  const list = Array.isArray(geos) ? geos : [geos];
  const usedAlbum = new Set();
  const spreads = [];
  let cursor = 0;
  let lastId = null;

  const remaining = () => photos.length - cursor;

  /**
   * Pick the layout for the next spread. When varying, avoid repeating the
   * previous layout — three identical spreads in a row is the single clearest
   * tell that an album was machine-made.
   */
  function pick() {
    const fits = list.filter((g) => g.slots.length <= remaining());
    if (!fits.length) return null;
    if (!vary || fits.length === 1) return fits[0];
    const fresh = fits.filter((g) => g.id !== lastId);
    const pool = fresh.length ? fresh : fits;
    return pool[spreads.length % pool.length];
  }

  while (remaining() > 0) {
    if (maxSpreads > 0 && spreads.length >= maxSpreads) break;
    const geo = pick();
    if (!geo) break;
    const k = geo.slots.length;

    // Candidate window, widened so the scorer has real choice.
    const pool = photos.slice(cursor, cursor + k * 2).filter((p) => !usedAlbum.has(p.file));
    for (const p of photos) {
      if (pool.length >= k) break;
      if (!usedAlbum.has(p.file) && !pool.includes(p)) pool.push(p);
    }
    if (pool.length < k) break;

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
      if (!best) { short = true; break; }
      used.add(best.file);
      picks.push({ slotId: slot.id, photo: best });
    }
    if (short) break;

    for (const f of used) usedAlbum.add(f);
    spreads.push({ index: spreads.length, templateId: geo.id, picks });
    lastId = geo.id;
    cursor += k;
  }
  return spreads;
}
