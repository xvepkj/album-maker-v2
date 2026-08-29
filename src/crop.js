/**
 * Cover-fit cropping with a subject focus point and gutter avoidance.
 *
 * This is the seam Phase 02 plugs into: today `focus` comes from a sidecar
 * file (or defaults to centre), later it comes from the face detector. The
 * geometry below does not change when that happens.
 *
 * Gutter avoidance works in two moves, in the order a human designer uses:
 *   1. slide the crop window along the source to walk the subject off the fold
 *   2. if the window has no slack left, punch in (up to `maxZoom`) to make some
 * The slot always stays completely filled; we never letterbox to solve this.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function computeCrop(src, slot, focus, gutter, opts = {}) {
  const maxZoom = opts.maxZoom ?? 1.18;      // never punch in more than 18%
  const { width: sw, height: sh } = src;
  const { width: dw, height: dh } = slot.rect;

  const fx = clamp(focus?.x ?? 0.5, 0, 1);
  const fy = clamp(focus?.y ?? 0.5, 0, 1);
  const fw = clamp(focus?.w ?? 0.04, 0, 1);   // subject width, source-normalised

  // --- 1. cover fit: largest window of the destination aspect ---
  const dstAspect = dw / dh;
  let cw = sw, ch = Math.round(sw / dstAspect);
  if (ch > sh) { ch = sh; cw = Math.round(sh * dstAspect); }
  cw = Math.min(cw, sw);
  ch = Math.min(ch, sh);

  const place = (w, h) => ({
    cx: clamp(Math.round(fx * sw - w / 2), 0, sw - w),
    cy: clamp(Math.round(fy * sh - h / 2), 0, sh - h),
  });

  const cw0 = cw, ch0 = ch;
  let { cx, cy } = place(cw, ch);
  let zoom = 1;

  // 'n/a'        slot does not touch the fold
  // 'clear'      subject already lands off the fold, nothing done
  // 'moved'      subject was over the fold and we walked it out
  // 'unresolved' could not clear it within maxZoom -> caller should swap photo
  let gutterStatus = slot.crossesGutter && gutter.width > 0 ? 'clear' : 'n/a';

  // --- 2. gutter avoidance ---
  if (gutterStatus === 'clear') {
    const margin = gutter.width * 0.15;
    const bandL = gutter.x0 - margin;
    const bandR = gutter.x1 + margin;

    // Subject centre, and its half-width, both in canvas pixels.
    const centreAt = (w, x) => slot.rect.left + (fx * sw - x) * (dw / w);
    const halfAt = (w) => (fw * sw * (dw / w)) / 2;
    // The BOX overlaps the fold, not merely the centre.
    const overlaps = (w, x) => centreAt(w, x) + halfAt(w) > bandL
                            && centreAt(w, x) - halfAt(w) < bandR;

    if (overlaps(cw, cx)) {
      gutterStatus = 'unresolved';
      for (let i = 0; i < 12; i++) {
        // Target centre puts the whole box on the near side of the fold.
        const half = halfAt(cw);
        const c = centreAt(cw, cx);
        const target = c < gutter.center ? bandL - half : bandR + half;
        const deltaSrc = Math.round((c - target) / (dw / cw));
        cx = clamp(cx + deltaSrc, 0, sw - cw);
        if (!overlaps(cw, cx)) { gutterStatus = 'moved'; break; }

        const next = zoom * 1.04;
        if (next > maxZoom) break;
        zoom = next;
        cw = Math.round(cw0 / zoom);
        ch = Math.round(ch0 / zoom);
        ({ cx, cy } = place(cw, ch));
      }
    }
  }

  const scale = dw / cw;
  return {
    extract: { left: cx, top: cy, width: cw, height: ch },
    scale,
    gutterStatus,
    zoomPct: +(((zoom - 1) * 100).toFixed(1)),
    focusCanvasX: Math.round(slot.rect.left + (fx * sw - cx) * scale),
    subjectHalfWidth: Math.round((fw * sw * scale) / 2),
    discardedPct: +((1 - (cw * ch) / (sw * sh)) * 100).toFixed(1),
  };
}

/** Cheap aspect-fit score, the first term of the Phase 03 slot scorer. */
export function aspectFit(src, slot) {
  const a = src.width / src.height;
  const b = slot.rect.width / slot.rect.height;
  return +(a > b ? b / a : a / b).toFixed(3);
}
