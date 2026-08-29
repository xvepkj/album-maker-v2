/**
 * Template library generator.
 *
 * Layouts are declared once in normalised page space and emitted for every
 * album size, because a template is just fractions — the same 3-up works at
 * 12x36 and 12x18. Hand-authoring one JSON per (layout x size) would be 30
 * files to keep in sync.
 */
import { writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../templates/', import.meta.url));

/** Album sizes, in inches. gutter_in is the binding's dead zone. */
const SIZES = [
  { id: '12x36', w: 36, h: 12, gutter: 0.94 },
  { id: '12x30', w: 30, h: 12, gutter: 0.86 },
  { id: '12x18', w: 18, h: 12, gutter: 0.62 },
];

/**
 * Build a layout's slots from a page-relative spec. Each page is treated as a
 * 0..1 box, so a layout never has to know where the fold is.
 * @param spec { left: rows[], right: rows[] } where a row is an array of weights
 */
function pages(spec, opts = {}) {
  const pad = opts.pad ?? 0.055;      // inset from page edge
  const gap = opts.gap ?? 0.035;      // gap between slots, page-relative

  return (halfGutter) => {
    const slots = [];
    let n = 0;
    const sides = [
      { rows: spec.left,  x0: pad, x1: 0.5 - halfGutter - pad * 0.6 },
      { rows: spec.right, x0: 0.5 + halfGutter + pad * 0.6, x1: 1 - pad },
    ];
    for (const side of sides) {
      if (!side.rows?.length) continue;
      const W = side.x1 - side.x0;
      const rowH = (1 - pad * 2 - gap * (side.rows.length - 1)) / side.rows.length;
      side.rows.forEach((row, ri) => {
        const y = pad + ri * (rowH + gap);
        const total = row.reduce((a, b) => a + b, 0);
        const usable = W - gap * (row.length - 1);
        let x = side.x0;
        for (const wgt of row) {
          const w = (wgt / total) * usable;
          slots.push({
            id: String.fromCharCode(97 + n++),
            rect: [+x.toFixed(4), +y.toFixed(4), +w.toFixed(4), +rowH.toFixed(4)],
            weight: 'support',
          });
          x += w + gap;
        }
      });
    }
    return slots;
  };
}

/** Full-bleed: one slot covering everything, deliberately crossing the fold. */
const fullBleed = () => () => ([{ id: 'a', rect: [0, 0, 1, 1], weight: 'hero' }]);

const LAYOUTS = [
  { name: 'hero.full',    label: 'Full bleed — one photo across the spread', build: fullBleed() },
  { name: 'duo',          label: 'Two up — one per page',        build: pages({ left: [[1]], right: [[1]] }) },
  { name: 'classic.3up',  label: 'Hero left, two right',         build: pages({ left: [[1]], right: [[1], [1]] }) },
  { name: 'hero.trio',    label: 'Hero left, three right',       build: pages({ left: [[1]], right: [[1], [1], [1]] }) },
  { name: 'quad',         label: 'Four up — two per page',       build: pages({ left: [[1], [1]], right: [[1], [1]] }) },
  { name: 'triptych',     label: 'Three verticals per page',     build: pages({ left: [[1, 1, 1]], right: [[1, 1, 1]] }) },
  { name: 'mosaic.5',     label: 'Five — big left, mosaic right', build: pages({ left: [[1]], right: [[1, 1], [1, 1]] }) },
  { name: 'grid.6',       label: 'Six up — three per page',      build: pages({ left: [[1, 1], [1]], right: [[1], [1, 1]] }) },
  { name: 'wide.strip',   label: 'Wide strip over two small',    build: pages({ left: [[1], [1, 1]], right: [[1], [1, 1]] }) },
  { name: 'accent.left',  label: 'Wide top, accent pair below',  build: pages({ left: [[2, 1]], right: [[1, 2]] }) },
  { name: 'window',       label: 'Single framed photo per page', build: pages({ left: [[1]], right: [[1]] }, { pad: 0.135 }) },
  { name: 'gallery.8',    label: 'Eight up — dense gallery',     build: pages({ left: [[1, 1], [1, 1]], right: [[1, 1], [1, 1]] }) },
];

await mkdir(OUT, { recursive: true });
for (const f of await readdir(OUT)) if (f.endsWith('.json')) await unlink(`${OUT}${f}`);

let count = 0;
for (const size of SIZES) {
  const halfGutter = size.gutter / size.w / 2;
  for (const layout of LAYOUTS) {
    const slots = layout.build(halfGutter);
    // Mark the largest slot as the hero so the planner gives it a strong photo.
    if (slots.length > 1) {
      let big = slots[0];
      for (const s of slots) if (s.rect[2] * s.rect[3] > big.rect[2] * big.rect[3]) big = s;
      big.weight = 'hero';
      // A tall narrow slot wants a portrait.
      for (const s of slots) {
        const ar = (s.rect[2] * size.w) / (s.rect[3] * size.h);
        if (ar < 0.85) s.prefer = 'portrait';
        else if (ar > 1.5) s.prefer = 'landscape';
      }
    }
    const id = `${size.id}.${layout.name}`;
    await writeFile(`${OUT}${id}.json`, JSON.stringify({
      id,
      label: layout.label,
      album: size.id,
      slotCount: slots.length,
      size: { w_in: size.w, h_in: size.h, dpi: 300, bleed_in: 0.125, safe_in: 0.25 },
      gutter: { center: 0.5, width_in: size.gutter },
      slots,
      background: 'assets/bg-linen.jpg',
      overlays: [],
    }, null, 2) + '\n');
    count++;
  }
}
console.log(`  ${count} templates across ${SIZES.length} album sizes`);
