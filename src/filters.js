/**
 * Album looks. Applied identically to every photo AND the background, so a
 * spread reads as one treatment rather than a colour photo sitting on a
 * warm-tinted page.
 *
 * These are colour operations only — no grain, no vignette, nothing that
 * depends on output size, so a 1400px preview and a 10876px print agree.
 */

export const LOOKS = [
  { id: 'none',   label: 'Original',      note: 'No colour treatment' },
  { id: 'soft',   label: 'Soft',          note: 'Gently lifted contrast — the safe wedding default' },
  { id: 'warm',   label: 'Warm',          note: 'Golden-hour bias, skin-flattering' },
  { id: 'cool',   label: 'Cool',          note: 'Blue bias for evening and monsoon shoots' },
  { id: 'vivid',  label: 'Vivid',         note: 'Punchy saturation for haldi and mehndi' },
  { id: 'faded',  label: 'Faded matte',   note: 'Lifted blacks, muted — editorial' },
  { id: 'sepia',  label: 'Sepia',         note: 'Warm monochrome, heritage feel' },
  { id: 'bw',     label: 'Black & white', note: 'Neutral monochrome' },
  { id: 'noir',   label: 'Noir',          note: 'High-contrast monochrome' },
];

const SEPIA = [
  [0.393, 0.769, 0.189],
  [0.349, 0.686, 0.168],
  [0.272, 0.534, 0.131],
];
const WARM = [
  [1.06, 0.02, 0.00],
  [0.01, 1.00, 0.00],
  [0.00, 0.01, 0.92],
];
const COOL = [
  [0.94, 0.00, 0.02],
  [0.00, 1.00, 0.01],
  [0.00, 0.02, 1.07],
];

/**
 * @param pipe a sharp pipeline
 * @param look one of LOOKS[].id
 * @returns the pipeline with the look applied
 */
export function applyLook(pipe, look) {
  switch (look) {
    case 'bw':    return pipe.greyscale();
    case 'noir':  return pipe.greyscale().linear(1.18, -18);
    case 'sepia': return pipe.recomb(SEPIA);
    case 'warm':  return pipe.recomb(WARM).modulate({ saturation: 1.04 });
    case 'cool':  return pipe.recomb(COOL);
    case 'vivid': return pipe.modulate({ saturation: 1.32 }).linear(1.06, -9);
    case 'faded': return pipe.linear(0.86, 22).modulate({ saturation: 0.86 });
    case 'soft':  return pipe.linear(0.94, 10).modulate({ saturation: 0.96 });
    case 'none':
    default:      return pipe;
  }
}

export const isLook = (id) => LOOKS.some((l) => l.id === id);
