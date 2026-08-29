/**
 * Client deliverables. Everything here is TRIM-CROPPED: bleed is printer's
 * margin and gets guillotined off, so showing it to a couple means showing
 * them 3mm of image that will not exist in their album.
 */
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Spread JPEGs in album order. */
export async function findSpreads(outDir) {
  const files = (await readdir(outDir))
    .filter((f) => /^spread-\d+\.jpg$/.test(f))
    .sort();
  return files.map((f) => path.join(outDir, f));
}

/** Crop a rendered canvas down to the trim box and resize for delivery. */
async function trimmed(file, geo, width) {
  let pipe = sharp(file, { limitInputPixels: 512 * 1024 * 1024 }).extract({
    left: geo.trim.left, top: geo.trim.top,
    width: geo.trim.width, height: geo.trim.height,
  });
  if (width && width < geo.trim.width) pipe = pipe.resize(width);
  return pipe.jpeg({ quality: width ? 82 : 92, chromaSubsampling: '4:4:4' }).toBuffer();
}

/**
 * Single-file HTML flipbook. Images are inlined as data URIs so the whole
 * thing is one file the couple can be emailed, or opened from a USB stick,
 * with no server, no internet and no app.
 */
export async function buildProof(geo, files, outFile, opts = {}) {
  const { studio = 'Spread Engine', title = 'Your album', width = 1400, onProgress } = opts;
  const pages = [];
  for (let i = 0; i < files.length; i++) {
    const buf = await trimmed(files[i], geo, width);
    pages.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
    onProgress?.(i + 1, files.length);
  }

  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(studio)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:#0d0b10; color:#e8e4ec; min-height:100dvh; display:flex; flex-direction:column;
         font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  header { padding:18px 22px; display:flex; justify-content:space-between; align-items:baseline;
           border-bottom:1px solid #241f2a; }
  h1 { font-size:15px; font-weight:600; letter-spacing:-.01em; }
  .studio { font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:#8b8395; }
  main { flex:1; display:flex; align-items:center; justify-content:center; padding:24px; min-height:0; }
  figure { width:100%; max-width:1500px; line-height:0; box-shadow:0 20px 60px -24px #000; border-radius:2px; overflow:hidden; }
  img { width:100%; height:auto; display:block; }
  nav { display:flex; align-items:center; justify-content:center; gap:24px; padding:16px 22px 26px; }
  button { background:#1b1720; color:#e8e4ec; border:1px solid #302a37; border-radius:999px;
           width:42px; height:42px; font-size:17px; cursor:pointer; }
  button:hover:not(:disabled) { border-color:#8b8395; }
  button:disabled { opacity:.3; cursor:default; }
  .count { font-variant-numeric:tabular-nums; letter-spacing:.1em; color:#b1a9ba; min-width:86px; text-align:center; }
  .hint { text-align:center; font-size:11px; color:#6f6879; padding-bottom:22px; }
  @media (max-width:640px){ main{padding:12px} header{padding:14px 16px} }
</style></head><body>
<header><h1>${esc(title)}</h1><span class="studio">${esc(studio)}</span></header>
<main><figure><img id="v" alt="Spread 1"></figure></main>
<nav>
  <button id="p" aria-label="Previous spread">&#8249;</button>
  <span class="count"><b id="n">1</b> / ${pages.length}</span>
  <button id="x" aria-label="Next spread">&#8250;</button>
</nav>
<p class="hint">Use the arrow keys, or swipe.</p>
<script>
const P=${JSON.stringify(pages)};let i=0;
const v=document.getElementById('v'),n=document.getElementById('n'),
      p=document.getElementById('p'),x=document.getElementById('x');
function go(k){i=Math.max(0,Math.min(P.length-1,k));v.src=P[i];v.alt='Spread '+(i+1);
  n.textContent=i+1;p.disabled=i===0;x.disabled=i===P.length-1;}
p.onclick=()=>go(i-1);x.onclick=()=>go(i+1);
addEventListener('keydown',e=>{if(e.key==='ArrowRight')go(i+1);if(e.key==='ArrowLeft')go(i-1);});
let sx=null;addEventListener('touchstart',e=>sx=e.touches[0].clientX,{passive:true});
addEventListener('touchend',e=>{if(sx===null)return;const d=e.changedTouches[0].clientX-sx;
  if(Math.abs(d)>50)go(i+(d<0?1:-1));sx=null;},{passive:true});
go(0);
</script></body></html>`;

  await writeFile(outFile, html);
  return { file: outFile, pages: pages.length };
}

/**
 * PDF, one spread per page at the album's true physical size.
 * quality 'client' downsamples for review; 'print' embeds full resolution.
 */
export async function buildPdf(geo, files, outFile, opts = {}) {
  const { quality = 'client', title = 'Album', studio = '', onProgress } = opts;
  const width = quality === 'print' ? null : 2000;

  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  if (studio) pdf.setAuthor(studio);
  pdf.setProducer('Spread Engine');

  // 72 pt per inch — the page is the real trim size of the album.
  const wPt = (geo.trim.width / geo.dpi) * 72;
  const hPt = (geo.trim.height / geo.dpi) * 72;

  for (let i = 0; i < files.length; i++) {
    const img = await pdf.embedJpg(await trimmed(files[i], geo, width));
    const page = pdf.addPage([wPt, hPt]);
    page.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
    onProgress?.(i + 1, files.length);
  }

  const bytes = await pdf.save();
  await writeFile(outFile, bytes);
  return { file: outFile, pages: files.length, bytes: bytes.length, inches: `${(wPt / 72).toFixed(0)}x${(hPt / 72).toFixed(0)}` };
}
