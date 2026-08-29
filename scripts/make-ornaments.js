/**
 * Procedural wedding / festival ornaments.
 *
 * Drawn as SVG and rasterised to PNG with alpha, so they are ours to ship, cost
 * nothing to license, and can be regenerated at any resolution. Motifs are
 * drawn from Indian wedding vernacular: marigold garlands, mandalas, ambi
 * (paisley), and jali lattice.
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = new URL('../assets/ornaments/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const GOLD = '#c8a02e', GOLD_L = '#e9d08a', GOLD_D = '#9a7618';
const rad = (d) => (d * Math.PI) / 180;

/**
 * One petal pointing up from the origin. The upper control points sit WIDE of
 * the tip, not converging on it — converging gives a spike, which reads as a
 * sunburst rather than a flower.
 */
const petal = (len, wide) =>
  `M0,0 C${wide},${-len * 0.22} ${wide * 1.02},${-len * 0.80} 0,${-len} ` +
  `C${-wide * 1.02},${-len * 0.80} ${-wide},${-len * 0.22} 0,0 Z`;

/** n petals in a ring. */
const ring = (n, len, wide, fill, opacity = 1) =>
  Array.from({ length: n }, (_, i) =>
    `<path d="${petal(len, wide)}" fill="${fill}" opacity="${opacity}" ` +
    `transform="rotate(${(360 / n) * i})"/>`).join('');

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const write = async (name, w, h, body) => {
  await sharp(Buffer.from(svg(w, h, body))).png({ compressionLevel: 9 }).toFile(`${OUT}${name}.png`);
  return name;
};

const made = [];

// ---- mandala: concentric petal rings -------------------------------------
made.push(await write('mandala', 1600, 1600, `
  <g transform="translate(800,800)">
    <g transform="rotate(11.25)">${ring(16, 730, 150, GOLD_D, 0.42)}</g>
    <circle r="600" fill="none" stroke="${GOLD}" stroke-width="6" opacity=".55"/>
    ${ring(16, 560, 118, GOLD, 0.78)}
    <circle r="452" fill="none" stroke="${GOLD_D}" stroke-width="4" opacity=".55"/>
    <g transform="rotate(15)">${ring(12, 400, 116, GOLD_L, 0.9)}</g>
    <circle r="286" fill="none" stroke="${GOLD}" stroke-width="5" opacity=".7"/>
    ${ring(8, 240, 104, GOLD, 0.95)}
    <circle r="104" fill="none" stroke="${GOLD_L}" stroke-width="10"/>
    <circle r="58" fill="${GOLD}"/>
    <circle r="26" fill="${GOLD_D}"/>
    ${Array.from({ length: 48 }, (_, i) =>
      `<circle cx="${Math.cos(rad(i * 7.5)) * 672}" cy="${Math.sin(rad(i * 7.5)) * 672}" r="7" fill="${GOLD_L}" opacity=".75"/>`).join('')}
  </g>`));

// ---- corner floral: vine sweeping out of the corner ------------------------
const vinePetals = Array.from({ length: 7 }, (_, i) => {
  const t = i / 6;
  const x = 120 + t * 980, y = 1120 - Math.pow(t, 1.7) * 980;
  const s = 1 - t * 0.55;
  return `<g transform="translate(${x},${y}) rotate(${-32 + t * 78}) scale(${s})">
            ${ring(6, 150, 44, i % 2 ? GOLD_L : GOLD, 0.95)}
            <circle r="19" fill="${GOLD_D}"/>
          </g>`;
}).join('');
made.push(await write('corner-floral', 1200, 1200, `
  <path d="M60,1180 C300,1140 620,960 830,640 C960,440 1030,240 1080,60"
        fill="none" stroke="${GOLD}" stroke-width="13" stroke-linecap="round" opacity=".85"/>
  <path d="M60,1180 C340,1090 660,880 880,520"
        fill="none" stroke="${GOLD_D}" stroke-width="7" stroke-linecap="round" opacity=".6"/>
  ${vinePetals}
  ${Array.from({ length: 9 }, (_, i) => {
    const t = i / 8, x = 150 + t * 700, y = 1140 - Math.pow(t, 2) * 560;
    return `<circle cx="${x}" cy="${y}" r="${11 - t * 5}" fill="${GOLD_L}" opacity=".8"/>`;
  }).join('')}`));

// ---- ambi / paisley --------------------------------------------------------
made.push(await write('ambi', 900, 1250, `
  <path d="M470,70 C720,270 815,590 720,850 C635,1080 380,1195 250,1090
           C135,998 175,830 305,795 C425,763 487,858 462,940"
        fill="none" stroke="${GOLD}" stroke-width="24" stroke-linecap="round"/>
  <path d="M470,215 C665,375 745,610 668,822 C600,1010 405,1105 305,1030
           C230,973 258,872 345,852 C420,835 462,890 452,942"
        fill="none" stroke="${GOLD_D}" stroke-width="11" opacity=".75" stroke-linecap="round"/>
  <g transform="translate(492,540) scale(1.05)">${ring(8, 175, 62, GOLD_L, 0.92)}<circle r="28" fill="${GOLD}"/></g>
  <g transform="translate(392,846) scale(.6)">${ring(6, 165, 60, GOLD, 0.88)}<circle r="26" fill="${GOLD_D}"/></g>
  <g transform="translate(596,760) scale(.42)">${ring(6, 160, 58, GOLD_L, 0.8)}</g>`));

// ---- marigold garland (horizontal strip) -----------------------------------
const heads = Array.from({ length: 26 }, (_, i) => {
  const x = 60 + i * 192, dip = Math.sin((i / 25) * Math.PI) * 46;
  const s = 0.82 + (i % 3) * 0.09;
  return `<g transform="translate(${x},${150 + dip}) scale(${s})">
            ${ring(14, 108, 30, i % 2 ? '#e0952a' : GOLD, 0.95)}
            ${ring(9, 66, 26, GOLD_L, 0.95)}
            <circle r="20" fill="${GOLD_D}"/>
          </g>`;
}).join('');
made.push(await write('garland', 5000, 320, `
  <path d="M0,150 Q1250,215 2500,196 T5000,150" fill="none" stroke="${GOLD_D}" stroke-width="9" opacity=".75"/>
  ${heads}`));

// ---- jali lattice border ---------------------------------------------------
const arches = Array.from({ length: 20 }, (_, i) => {
  const x = i * 250, w = 250;
  return `<path d="M${x},300 L${x},170 Q${x + w / 2},-16 ${x + w},170 L${x + w},300"
            fill="none" stroke="${GOLD}" stroke-width="16" opacity=".92"/>
          <path d="M${x + 34},300 L${x + 34},186 Q${x + w / 2},52 ${x + w - 34},186 L${x + w - 34},300"
            fill="none" stroke="${GOLD_D}" stroke-width="7" opacity=".6"/>
          <circle cx="${x + w / 2}" cy="140" r="20" fill="${GOLD_L}" opacity=".9"/>
          <circle cx="${x}" cy="300" r="13" fill="${GOLD}"/>`;
}).join('');
made.push(await write('jali', 5000, 340, `
  ${arches}
  <rect x="0" y="304" width="5000" height="12" fill="${GOLD}"/>
  <rect x="0" y="326" width="5000" height="5" fill="${GOLD_D}" opacity=".7"/>`));

// ---- flourish divider ------------------------------------------------------
const arm = (dir) => `
  <g transform="scale(${dir},1)">
    <path d="M-950,0 C-660,-86 -340,-92 -150,-14" fill="none" stroke="${GOLD}" stroke-width="13"
          stroke-linecap="round"/>
    <path d="M-950,0 C-660,86 -340,92 -150,14" fill="none" stroke="${GOLD}" stroke-width="13"
          stroke-linecap="round"/>
    <path d="M-950,0 C-1020,-52 -1080,-16 -1046,26 C-1020,58 -968,42 -968,4" fill="none"
          stroke="${GOLD_D}" stroke-width="10" stroke-linecap="round"/>
    <g transform="translate(-560,-58) scale(.46)">${ring(6, 160, 58, GOLD_L, 0.92)}</g>
    <g transform="translate(-330,44) scale(.34)">${ring(6, 160, 58, GOLD, 0.85)}</g>
    <circle cx="-742" cy="34" r="11" fill="${GOLD_L}" opacity=".85"/>
  </g>`;
made.push(await write('flourish', 2200, 420, `
  <g transform="translate(1100,210)">
    ${arm(1)}${arm(-1)}
    ${ring(10, 138, 50, GOLD_L, 0.95)}
    <circle r="46" fill="${GOLD}"/><circle r="20" fill="${GOLD_D}"/>
  </g>`));

// ---- petal scatter ---------------------------------------------------------
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
made.push(await write('petals', 2400, 1600, Array.from({ length: 46 }, () => {
  const x = rnd() * 2400, y = rnd() * 1600, s = 0.35 + rnd() * 0.75, r = rnd() * 360;
  return `<g transform="translate(${x},${y}) rotate(${r}) scale(${s})">
            <path d="${petal(150, 52)}" fill="${rnd() > 0.5 ? GOLD : GOLD_L}" opacity="${0.4 + rnd() * 0.45}"/>
          </g>`;
}).join('')));

// ---- solid swatch, stretched into frame rules ------------------------------
made.push(await write('gold-rule', 24, 24, `<rect width="24" height="24" fill="${GOLD}"/>`));

// rotations of the corner motif, so all four corners are available
for (const [name, angle] of [['corner-floral-tr', 90], ['corner-floral-br', 180], ['corner-floral-bl', 270]]) {
  await sharp(`${OUT}corner-floral.png`).rotate(angle).png().toFile(`${OUT}${name}.png`);
  made.push(name);
}
// vertical flips, so a border motif can sit along the bottom edge too
for (const base of ['jali', 'garland']) {
  await sharp(`${OUT}${base}.png`).flip().png().toFile(`${OUT}${base}-flip.png`);
  made.push(`${base}-flip`);
}
// mirrored ambi, for symmetric placement
await sharp(`${OUT}ambi.png`).flop().png().toFile(`${OUT}ambi-flip.png`);
made.push('ambi-flip');

console.log('  ' + made.length + ' ornaments -> assets/ornaments/');
for (const m of made) console.log('    ' + m + '.png');
