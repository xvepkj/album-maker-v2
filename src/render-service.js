#!/usr/bin/env node
/**
 * Render service. Runs as a SEPARATE Node process, not inside Electron:
 * sharp's native binding is built for Node's ABI, and this also gives the
 * heavy work its own address space, exactly as the architecture intends.
 *
 * Protocol: one JSON job per line on stdin, NDJSON events on stdout.
 */
import { readdir, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { loadTemplate } from './template.js';
import { readPhotos, planAlbum } from './album.js';
import { backgroundRef, renderSlot, renderBackground, flatten, proof } from './compose.js';
import { writePsd } from './psd.js';
import { findSpreads, buildProof, buildPdf } from './deliver.js';

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');

let peakRss = 0;
setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 40).unref();

async function renderOne(geo, bgRef, spread, outDir, { psd = false } = {}) {
  const t = performance.now();
  const layers = [];
  const slotInfo = [];

  for (const pick of spread.picks) {
    const slot = geo.slots.find((s) => s.id === pick.slotId);
    const layer = await renderSlot(geo, slot, pick.photo);
    layers.push(layer);
    slotInfo.push({
      id: slot.id,
      photo: pick.photo.name,
      fit: layer.fit,
      discardedPct: layer.crop.discardedPct,
      zoomPct: layer.crop.zoomPct,
      gutterStatus: layer.crop.gutterStatus,
    });
  }

  const n = String(spread.index + 1).padStart(2, '0');
  const jpg = path.join(outDir, `spread-${n}.jpg`);
  await flatten(geo, bgRef, layers, jpg);
  const proofFile = path.join(outDir, `spread-${n}.proof.jpg`);
  await proof(jpg, proofFile, 1400);

  let psdFile = null;
  if (psd) {
    const bgLayer = await renderBackground(geo, bgRef);
    psdFile = path.join(outDir, `spread-${n}.psd`);
    await writePsd(geo, [bgLayer, ...layers], psdFile);
  }

  return {
    index: spread.index, jpg, proof: proofFile, psd: psdFile,
    slots: slotInfo, ms: Math.round(performance.now() - t),
    rss: process.memoryUsage().rss,
  };
}

async function design(job) {
  const geo = await loadTemplate(job.template);
  const bgRef = backgroundRef(geo);
  await mkdir(job.outDir, { recursive: true });

  const names = await readdir(job.photosDir);
  const photos = await readPhotos(job.photosDir, names);
  if (!photos.length) throw new Error(`No readable images in ${job.photosDir}`);

  const spreads = planAlbum(geo, photos, { maxSpreads: job.maxSpreads ?? 0 });
  send({
    type: 'plan',
    photos: photos.length,
    spreads: spreads.length,
    template: {
      id: geo.id, canvas: geo.canvas, trim: geo.trim,
      bleed: geo.bleed, dpi: geo.dpi, gutter: geo.gutter,
      slots: geo.slots.map((s) => ({ id: s.id, rect: s.rect, crossesGutter: s.crossesGutter })),
    },
  });

  // Persist the plan so an export can re-render one spread without replanning.
  await writeFile(path.join(job.outDir, 'plan.json'),
    JSON.stringify({ template: job.template, spreads: spreads.map((s) => ({
      index: s.index, picks: s.picks.map((p) => ({ slotId: p.slotId, photo: p.photo })),
    })) }));

  const t0 = performance.now();
  for (const spread of spreads) {
    send({ type: 'spread', ...(await renderOne(geo, bgRef, spread, job.outDir)) });
  }
  send({ type: 'done', totalMs: Math.round(performance.now() - t0), peakRss });
}

async function exportSpread(job) {
  const plan = JSON.parse(await readFile(path.join(job.outDir, 'plan.json'), 'utf8'));
  const geo = await loadTemplate(plan.template);
  const bgRef = backgroundRef(geo);
  const spread = plan.spreads.find((s) => s.index === job.index);
  if (!spread) throw new Error(`no spread ${job.index} in plan`);
  const r = await renderOne(geo, bgRef, spread, job.outDir, { psd: true });
  send({ type: 'exported', ...r });
}

async function inspectPsd(job) {
  const { readPsd } = await import('ag-psd');
  const buf = await readFile(job.file);
  const psd = readPsd(buf, {
    skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true,
  });
  const res = psd.imageResources?.resolutionInfo;
  send({
    type: 'psd',
    file: job.file,
    bytes: buf.length,
    width: psd.width,
    height: psd.height,
    colorMode: psd.colorMode,
    bitsPerChannel: psd.bitsPerChannel,
    resolution: res ? `${res.horizontalResolution} ${res.horizontalResolutionUnit}` : null,
    guides: (psd.imageResources?.gridAndGuidesInformation?.guides ?? [])
      .map((g) => ({ direction: g.direction, location: g.location })),
    layers: psd.children.map((c) => ({
      name: c.name, left: c.left, top: c.top,
      width: c.right - c.left, height: c.bottom - c.top,
      blendMode: c.blendMode, opacity: c.opacity,
    })),
  });
}

async function deliver(job) {
  const plan = JSON.parse(await readFile(path.join(job.outDir, 'plan.json'), 'utf8'));
  const geo = await loadTemplate(plan.template);
  const files = await findSpreads(job.outDir);
  if (!files.length) throw new Error('No rendered spreads found — design the album first.');

  const onProgress = (done, total) => send({ type: 'deliver-progress', kind: job.kind, done, total });
  const opts = { studio: job.studio, title: job.title, onProgress };
  const out = [];

  if (job.kind === 'proof' || job.kind === 'both') {
    out.push({ kind: 'proof', ...await buildProof(geo, files,
      path.join(job.outDir, 'client-proof.html'), opts) });
  }
  if (job.kind === 'pdf' || job.kind === 'both') {
    out.push({ kind: 'pdf', ...await buildPdf(geo, files,
      path.join(job.outDir, `album-${job.quality ?? 'client'}.pdf`),
      { ...opts, quality: job.quality ?? 'client' }) });
  }
  send({ type: 'delivered', spreads: files.length, outputs: out });
}

// Jobs run strictly one at a time: they share sharp's memory budget, and a
// deliver that starts mid-render would read a half-written plan.
let queue = Promise.resolve();

async function run(job) {
  if (job.cmd === 'design') return design(job);
  if (job.cmd === 'export') return exportSpread(job);
  if (job.cmd === 'inspect') return inspectPsd(job);
  if (job.cmd === 'deliver') return deliver(job);
  send({ type: 'error', message: `unknown cmd ${job.cmd}` });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let job;
  try { job = JSON.parse(line); } catch { return; }
  queue = queue
    .then(() => run(job))
    .catch((err) => send({ type: 'error', message: err?.message ?? String(err) }));
});
