/**
 * Template loading + geometry resolution.
 *
 * A template stores everything in NORMALISED coordinates relative to the trim
 * box, so one file renders correctly at any album size or DPI. This module is
 * the only place that knows about inches, pixels, and bleed offsets.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const req = (obj, key, where) => {
  if (obj?.[key] === undefined) throw new Error(`template ${where}: missing "${key}"`);
  return obj[key];
};

export async function loadTemplate(file) {
  const raw = JSON.parse(await readFile(file, 'utf8'));
  raw.__dir = path.dirname(path.resolve(file));
  raw.__file = path.resolve(file);
  return resolve(raw);
}

/** Turn a normalised template into absolute pixel geometry. */
export function resolve(t) {
  const size = req(t, 'size', t.id);
  const dpi = req(size, 'dpi', t.id);
  const inPx = (inches) => Math.round(inches * dpi);

  const trimW = inPx(req(size, 'w_in', t.id));
  const trimH = inPx(req(size, 'h_in', t.id));
  const bleed = inPx(size.bleed_in ?? 0);
  const safe = inPx(size.safe_in ?? 0.25);

  // The canvas we actually render is trim + bleed on every side.
  const canvasW = trimW + bleed * 2;
  const canvasH = trimH + bleed * 2;

  if (canvasW > 30000 || canvasH > 30000) {
    throw new Error(
      `canvas ${canvasW}x${canvasH} exceeds the 30000px PSD limit — needs PSB output`
    );
  }

  // Gutter band, in canvas coordinates.
  const g = t.gutter ?? { center: 0.5, width_in: 0 };
  const gutterW = inPx(g.width_in ?? 0);
  const gutterCx = bleed + Math.round((g.center ?? 0.5) * trimW);
  const gutter = {
    width: gutterW,
    center: gutterCx,
    x0: gutterCx - Math.round(gutterW / 2),
    x1: gutterCx + Math.round(gutterW / 2),
  };

  const slots = req(t, 'slots', t.id).map((s, i) => {
    const [nx, ny, nw, nh] = req(s, 'rect', `${t.id} slot[${i}]`);
    const rect = {
      left: bleed + Math.round(nx * trimW),
      top: bleed + Math.round(ny * trimH),
      width: Math.round(nw * trimW),
      height: Math.round(nh * trimH),
    };
    // A slot that runs to the edge of the trim box should run into the bleed.
    if (nx <= 0.0005) { rect.left = 0; rect.width += bleed; }
    if (ny <= 0.0005) { rect.top = 0; rect.height += bleed; }
    if (nx + nw >= 0.9995) rect.width += bleed;
    if (ny + nh >= 0.9995) rect.height += bleed;

    return {
      id: s.id ?? `slot${i}`,
      weight: s.weight ?? 'support',
      prefer: s.prefer ?? 'any',
      blend: s.blend ?? 'over',
      rect,
      crossesGutter: rect.left < gutter.x1 && rect.left + rect.width > gutter.x0,
    };
  });

  return {
    id: t.id ?? 'untitled',
    label: t.label ?? t.id ?? 'untitled',
    album: t.album ?? `${t.size.h_in}x${t.size.w_in}`,
    file: t.__file ?? null,
    dir: t.__dir ?? process.cwd(),
    dpi, bleed, safe,
    trim: { left: bleed, top: bleed, width: trimW, height: trimH },
    canvas: { width: canvasW, height: canvasH },
    gutter,
    slots,
    background: t.background ?? null,
    overlays: (t.overlays ?? []).map((o) => ({
      asset: req(o, 'asset', `${t.id} overlay`),
      blend: o.blend ?? 'over',
      opacity: o.opacity ?? 1,
      rect: {
        left: bleed + Math.round(o.rect[0] * trimW),
        top: bleed + Math.round(o.rect[1] * trimH),
        width: Math.round(o.rect[2] * trimW),
        height: Math.round(o.rect[3] * trimH),
      },
    })),
  };
}

export const describe = (g) =>
  `${g.id}  ${g.canvas.width}x${g.canvas.height}px ` +
  `(trim ${g.trim.width}x${g.trim.height} @ ${g.dpi}dpi, bleed ${g.bleed}px)  ` +
  `${g.slots.length} slots, gutter ${g.gutter.width}px`;
