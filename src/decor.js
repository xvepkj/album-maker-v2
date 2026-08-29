/**
 * Decoration themes — the festival / wedding ornamentation layer.
 *
 * A theme turns the album geometry into a set of overlays. They are composited
 * ABOVE the photos, which is how this kind of album is designed: gold line-art
 * sits over the image at the corners and margins.
 *
 * Everything is expressed against the TRIM box, not the canvas, so a motif
 * still lands correctly when the bleed changes.
 */

export const DECORS = [
  { id: 'none',     label: 'None',              note: 'No ornamentation' },
  { id: 'corners',  label: 'Floral corners',    note: 'Vine and blossom in all four corners' },
  { id: 'garland',  label: 'Marigold garland',  note: 'Strung marigolds across the top, flourish below' },
  { id: 'jali',     label: 'Jali border',       note: 'Lattice arches along both long edges' },
  { id: 'mandala',  label: 'Mandala',           note: 'A large mandala at each outer edge' },
  { id: 'ambi',     label: 'Ambi / paisley',    note: 'Mirrored paisley at the outer corners' },
  { id: 'petals',   label: 'Petal scatter',     note: 'Loose petals drifting across the corners' },
  { id: 'royal',    label: 'Royal frame',       note: 'Gold rule frame with corner florals' },
];

const A = (name) => `assets/ornaments/${name}.png`;

export const isDecor = (id) => DECORS.some((d) => d.id === id);

/**
 * @param id  a DECORS[].id
 * @param geo a resolved template
 * @returns overlays in resolved shape: { asset, blend, opacity, rect }
 */
export function decorOverlays(id, geo) {
  if (!id || id === 'none') return [];

  const { left: L, top: T, width: W, height: H } = geo.trim;
  const R = L + W, B = T + H;
  const put = (asset, x, y, w, h, opacity = 1, blend = 'over') =>
    ({ asset: A(asset), blend, opacity, rect: {
      left: Math.round(x), top: Math.round(y),
      width: Math.round(w), height: Math.round(h) } });

  // Page boxes, so a motif can sit per page rather than per spread.
  const pageW = (geo.gutter.x0 - L);
  const rightL = geo.gutter.x1;
  const pageW2 = R - rightL;

  switch (id) {
    case 'corners': {
      const c = Math.min(W, H) * 0.30;
      return [
        put('corner-floral',    L,     T,     c, c, 0.92),
        put('corner-floral-tr', R - c, T,     c, c, 0.92),
        put('corner-floral-bl', L,     B - c, c, c, 0.92),
        put('corner-floral-br', R - c, B - c, c, c, 0.92),
      ];
    }

    case 'garland': {
      const gh = H * 0.13;
      return [
        put('garland', L, T - gh * 0.16, W, gh, 0.95),
        put('flourish', L + W * 0.36, B - H * 0.115, W * 0.28, H * 0.085, 0.9),
      ];
    }

    case 'jali': {
      const jh = H * 0.10;
      return [
        put('jali',      L, T,      W, jh, 0.9),
        put('jali-flip', L, B - jh, W, jh, 0.9),
      ];
    }

    case 'mandala': {
      const m = H * 0.95;
      return [
        put('mandala', L - m * 0.42,  T + H / 2 - m / 2, m, m, 0.40),
        put('mandala', R - m * 0.58,  T + H / 2 - m / 2, m, m, 0.40),
      ];
    }

    case 'ambi': {
      const aw = pageW * 0.24, ah = aw * (1250 / 900);
      return [
        put('ambi',      L + pageW * 0.03,           T + H * 0.05, aw, ah, 0.88),
        put('ambi-flip', R - pageW2 * 0.03 - aw,     B - H * 0.05 - ah, aw, ah, 0.88),
      ];
    }

    case 'petals': {
      const pw = W * 0.30, ph = pw * (1600 / 2400);
      return [
        put('petals', L, T, pw, ph, 0.62),
        put('petals', R - pw, B - ph, pw, ph, 0.62),
      ];
    }

    case 'royal': {
      const inset = geo.safe * 0.9;
      const t = Math.max(4, Math.round(H * 0.0055));   // rule thickness
      const x0 = L + inset, y0 = T + inset;
      const w = W - inset * 2, h = H - inset * 2;
      const c = Math.min(W, H) * 0.20;
      return [
        put('gold-rule', x0, y0,         w, t, 0.85),
        put('gold-rule', x0, y0 + h - t, w, t, 0.85),
        put('gold-rule', x0, y0,         t, h, 0.85),
        put('gold-rule', x0 + w - t, y0, t, h, 0.85),
        put('corner-floral',    x0 - c * 0.16,     y0 - c * 0.16,     c, c, 0.9),
        put('corner-floral-tr', x0 + w - c * 0.84, y0 - c * 0.16,     c, c, 0.9),
        put('corner-floral-bl', x0 - c * 0.16,     y0 + h - c * 0.84, c, c, 0.9),
        put('corner-floral-br', x0 + w - c * 0.84, y0 + h - c * 0.84, c, c, 0.9),
      ];
    }

    default:
      return [];
  }
}
