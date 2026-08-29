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
 *
 * `animation: 'fold'` adds a real page turn. A spread is two facing pages, so
 * turning forward rotates the CURRENT spread's right half about the fold and
 * reveals the NEXT spread's left half on its back face — which is what an
 * album actually does. 'none' cross-fades instead.
 */
export async function buildProof(geo, files, outFile, opts = {}) {
  const {
    studio = 'Spread Engine', title = 'Your album',
    width = 1400, animation = 'fold', onProgress,
  } = opts;

  const pages = [];
  for (let i = 0; i < files.length; i++) {
    const buf = await trimmed(files[i], geo, width);
    pages.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
    onProgress?.(i + 1, files.length);
  }

  const esc = (s) => String(s).replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const ratio = `${geo.trim.width} / ${geo.trim.height}`;
  const fold = animation === 'fold';

  const stage = fold
    ? `<div class="book" id="book">
         <div class="half left"  id="hl"></div>
         <div class="half right" id="hr"></div>
         <div class="turn" id="turn" hidden>
           <div class="face front" id="tf"><i class="shade"></i></div>
           <div class="face back"  id="tb"><i class="shade"></i></div>
         </div>
       </div>`
    : `<figure class="plain"><img id="v" alt="Spread 1"></figure>`;

  const foldCss = `
  .book { position:relative; width:100%; aspect-ratio:${ratio}; perspective:2600px;
          box-shadow:0 22px 64px -26px #000; background:#15121a; }
  .half { position:absolute; top:0; width:50%; height:100%;
          background-size:200% 100%; background-repeat:no-repeat; }
  .half.left  { left:0;  background-position:left center; }
  .half.right { right:0; background-position:right center; }
  .turn { position:absolute; top:0; left:50%; width:50%; height:100%;
          transform-style:preserve-3d; transform-origin:left center; z-index:3;
          transition:transform .86s cubic-bezier(.22,.61,.28,1); }
  .turn.rev { left:0; transform-origin:right center; }
  .face { position:absolute; inset:0; backface-visibility:hidden;
          background-size:200% 100%; background-repeat:no-repeat; }
  .front { background-position:right center; }
  .back  { background-position:left center; transform:rotateY(180deg); }
  .turn.rev .front { background-position:left center; }
  .turn.rev .back  { background-position:right center; transform:rotateY(-180deg); }
  /* the crease darkens as the leaf lifts, which is most of the realism */
  .shade { position:absolute; inset:0; display:block; opacity:0;
           transition:opacity .86s ease; pointer-events:none; }
  .front .shade { background:linear-gradient(90deg, rgba(0,0,0,.42), transparent 55%); }
  .back  .shade { background:linear-gradient(270deg, rgba(0,0,0,.42), transparent 55%); }
  .turning .shade { opacity:1; }
  @media (prefers-reduced-motion: reduce) {
    .turn, .shade { transition:none !important; }
  }`;

  const plainCss = `
  .plain { width:100%; line-height:0; box-shadow:0 22px 64px -26px #000; }
  .plain img { width:100%; height:auto; display:block; transition:opacity .28s ease; }
  .plain img.fading { opacity:0; }
  @media (prefers-reduced-motion: reduce) { .plain img { transition:none; } }`;

  const foldJs = `
const hl=document.getElementById('hl'),hr=document.getElementById('hr'),
      tn=document.getElementById('turn'),tf=document.getElementById('tf'),
      tb=document.getElementById('tb');
const url=k=>'url("'+P[k]+'")';
let busy=false;
function settle(k){ i=k; hl.style.backgroundImage=url(k); hr.style.backgroundImage=url(k);
  tn.hidden=true; tn.classList.remove('turning'); busy=false; sync(); }
function go(k){
  if(busy||k<0||k>=P.length||k===i) return;
  const from=i, fwd=k>from;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){ settle(k); return; }
  busy=true;
  n.textContent=k+1;            // update immediately; waiting for the turn feels laggy
  p.disabled=x.disabled=true;
  // Underneath: the half that is NOT moving on each side.
  hl.style.backgroundImage=url(fwd?from:k);
  hr.style.backgroundImage=url(fwd?k:from);
  tn.className='turn'+(fwd?'':' rev');
  tf.style.backgroundImage=url(from);
  tb.style.backgroundImage=url(k);
  tn.hidden=false;
  tn.style.transition='none';
  tn.style.transform='rotateY(0deg)';
  tn.getBoundingClientRect();               // force the reset to land
  requestAnimationFrame(()=>{
    tn.style.transition='';
    tn.classList.add('turning');
    tn.style.transform='rotateY('+(fwd?-180:180)+'deg)';
  });
  const done=()=>{ tn.removeEventListener('transitionend',done); settle(k); };
  tn.addEventListener('transitionend',done);
  setTimeout(()=>{ if(busy) done(); },1200);   // safety, if the event is missed
}
settle(0);`;

  const plainJs = `
const v=document.getElementById('v');
function go(k){ if(k<0||k>=P.length) return; i=k;
  v.classList.add('fading');
  setTimeout(()=>{ v.src=P[i]; v.alt='Spread '+(i+1); v.classList.remove('fading'); sync(); },140); }
v.src=P[0]; sync();`;

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
  .frame { width:100%; max-width:1500px; }
  nav { display:flex; align-items:center; justify-content:center; gap:24px; padding:16px 22px 26px; }
  button { background:#1b1720; color:#e8e4ec; border:1px solid #302a37; border-radius:999px;
           width:42px; height:42px; font-size:17px; cursor:pointer; }
  button:hover:not(:disabled) { border-color:#8b8395; }
  button:disabled { opacity:.3; cursor:default; }
  .count { font-variant-numeric:tabular-nums; letter-spacing:.1em; color:#b1a9ba;
           min-width:86px; text-align:center; }
  .hint { text-align:center; font-size:11px; color:#6f6879; padding-bottom:22px; }
  @media (max-width:640px){ main{padding:12px} header{padding:14px 16px} }
${fold ? foldCss : plainCss}
</style></head><body>
<header><h1>${esc(title)}</h1><span class="studio">${esc(studio)}</span></header>
<main><div class="frame">${stage}</div></main>
<nav>
  <button id="p" aria-label="Previous spread">&#8249;</button>
  <span class="count"><b id="n">1</b> / ${pages.length}</span>
  <button id="x" aria-label="Next spread">&#8250;</button>
</nav>
<p class="hint">Use the arrow keys, or swipe.</p>
<script>
const P=${JSON.stringify(pages)};
let i=0;
const n=document.getElementById('n'),p=document.getElementById('p'),x=document.getElementById('x');
function sync(){ n.textContent=i+1; p.disabled=i===0; x.disabled=i===P.length-1; }
${fold ? foldJs : plainJs}
p.onclick=()=>go(i-1); x.onclick=()=>go(i+1);
addEventListener('keydown',e=>{if(e.key==='ArrowRight')go(i+1);if(e.key==='ArrowLeft')go(i-1);});
let sx=null;
addEventListener('touchstart',e=>sx=e.touches[0].clientX,{passive:true});
addEventListener('touchend',e=>{if(sx===null)return;const d=e.changedTouches[0].clientX-sx;
  if(Math.abs(d)>50)go(i+(d<0?1:-1));sx=null;},{passive:true});
</script></body></html>`;

  await writeFile(outFile, html);
  return { file: outFile, pages: pages.length, animation };
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
