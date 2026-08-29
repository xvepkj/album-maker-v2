/**
 * Synthetic test assets, so the spike runs with zero photos on hand.
 * Each frame carries a ring marking its "subject", and a matching
 * <file>.focus.json sidecar — exactly the shape the Phase 02 face detector
 * will emit, so nothing downstream changes when real detection lands.
 */
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = new URL('../samples/', import.meta.url).pathname;

const N = Number(process.argv[2] ?? 24);
const ORIENT = [[6000, 4000], [6000, 4000], [4000, 6000], [6000, 4000], [5000, 5000]];
const FRAMES = Array.from({ length: N }, (_, i) => {
  const [w, h] = ORIENT[i % ORIENT.length];
  // Spread focus points around, including some parked dead centre so the
  // fold-avoidance path gets exercised on a real album.
  const fx = [0.30, 0.50, 0.50, 0.68, 0.45, 0.22, 0.50, 0.78][i % 8];
  const fy = [0.42, 0.40, 0.35, 0.45, 0.30, 0.55, 0.48, 0.38][i % 8];
  return {
    n: i + 1, w, h, hue: (i * 47) % 360,
    focus: { x: fx, y: fy },
    label: `${w > h ? 'landscape' : w === h ? 'square' : 'portrait'} · subject ${
      fx < 0.4 ? 'left' : fx > 0.6 ? 'right' : 'centre'}`,
  };
});

const frameSvg = ({ w, h, hue, focus, n, label }) => {
  const H = typeof hue === 'function' ? hue() : hue;
  const cx = focus.x * w, cy = focus.y * h;
  const r = Math.min(w, h) * 0.085;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0"   stop-color="hsl(${H},52%,72%)"/>
        <stop offset="0.55" stop-color="hsl(${(H + 24) % 360},46%,52%)"/>
        <stop offset="1"   stop-color="hsl(${(H + 48) % 360},40%,30%)"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <g stroke="rgba(255,255,255,.16)" stroke-width="${Math.round(w / 600)}">
      ${Array.from({ length: 11 }, (_, i) =>
        `<line x1="${(i * w) / 10}" y1="0" x2="${(i * w) / 10}" y2="${h}"/>`).join('')}
    </g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
            stroke="rgba(255,255,255,.95)" stroke-width="${Math.round(r * 0.09)}"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.12}" fill="rgba(255,255,255,.95)"/>
    <text x="${cx}" y="${cy + r * 1.6}" font-family="Helvetica,Arial" font-size="${r * 0.34}"
          fill="rgba(255,255,255,.92)" text-anchor="middle">SUBJECT</text>
    <text x="${w * 0.035}" y="${h * 0.13}" font-family="Helvetica,Arial"
          font-size="${h * 0.1}" font-weight="bold" fill="rgba(255,255,255,.9)">${n}</text>
    <text x="${w * 0.035}" y="${h * 0.955}" font-family="Helvetica,Arial"
          font-size="${h * 0.028}" fill="rgba(255,255,255,.85)">${label} · ${w}x${h}</text>
  </svg>`;
};

const bgSvg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="#efe9df"/>
  <g stroke="#e2d9cb" stroke-width="3">
    ${Array.from({ length: 220 }, (_, i) =>
      `<line x1="${i * 60}" y1="0" x2="${i * 60 - h}" y2="${h}"/>`).join('')}
  </g>
  <g stroke="#e7dfd2" stroke-width="2">
    ${Array.from({ length: 90 }, (_, i) =>
      `<line x1="0" y1="${i * 46}" x2="${w}" y2="${i * 46}"/>`).join('')}
  </g>
</svg>`;

await mkdir(OUT, { recursive: true });

for (const f of FRAMES) {
  const file = `${OUT}photo-${f.n}.jpg`;
  await sharp(Buffer.from(frameSvg(f)))
    .jpeg({ quality: 88 }).toFile(file);
  const r = Math.min(f.w, f.h) * 0.085;
  await writeFile(`${file}.focus.json`, JSON.stringify({
    ...f.focus, w: +((2 * r) / f.w).toFixed(4), h: +((2 * r) / f.h).toFixed(4),
  }));
  console.log(`  photo-${f.n}.jpg  ${f.w}x${f.h}  focus ${f.focus.x},${f.focus.y}  (${f.label})`);
}

// The page background lives with the ornaments — see scripts/make-ornaments.js.
