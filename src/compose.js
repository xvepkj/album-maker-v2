/**
 * Compositing. Produces one raster per slot, then flattens.
 *
 * The slot rasters are built ONCE and handed to both the flatten step and the
 * PSD writer, because decoding a 24MP source twice is the easiest way to make
 * this slow. Everything here is slot-sized; nothing allocates a full-canvas
 * buffer except the final flatten.
 */
import sharp from 'sharp';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { computeCrop, aspectFit } from './crop.js';
import { applyLook } from './filters.js';

sharp.cache(false);              // predictable memory for measurement
// Measured: threads beyond 4 add ~40 MB of tile buffers for no speed gain on a
// 40 MP canvas, because composite() is allocation-bound, not CPU-bound.
sharp.concurrency(4);

/** Render one slot to an RGBA raw buffer at final print resolution. */
export async function renderSlot(geo, slot, photo, { look = 'none' } = {}) {
  const img = sharp(photo.file, { limitInputPixels: 512 * 1024 * 1024 });
  const meta = await img.metadata();
  const src = { width: meta.width, height: meta.height };

  const crop = computeCrop(src, slot, photo.focus, geo.gutter);

  const data = await applyLook(
    img.extract(crop.extract)
       .resize(slot.rect.width, slot.rect.height, { fit: 'fill', kernel: 'lanczos3' }),
    look,
  ).ensureAlpha().raw().toBuffer();

  return {
    name: `${slot.id} · ${path.basename(photo.file)}`,
    slotId: slot.id,
    left: slot.rect.left,
    top: slot.rect.top,
    width: slot.rect.width,
    height: slot.rect.height,
    blend: slot.blend,
    data,
    crop,
    fit: aspectFit(src, slot),
    source: { file: photo.file, ...src },
  };
}

/**
 * Background descriptor. Deliberately LAZY: the flatten pass streams the file
 * straight through libvips, and only the PSD writer ever materialises the
 * full-canvas RGBA buffer (160 MB at 12x36in/300dpi). Building it eagerly for
 * both passes was costing ~500 MB of peak RSS for nothing.
 */
export function backgroundRef(geo) {
  const { width, height } = geo.canvas;
  const file = geo.background ? path.resolve(geo.dir, '..', geo.background) : null;
  return (file && existsSync(file))
    ? { kind: 'file', file, width, height }
    : { kind: 'flat', colour: { r: 250, g: 248, b: 245, alpha: 1 }, width, height };
}

/** Materialise the background as a real raw layer. Only the PSD path needs this. */
export async function renderBackground(geo, ref = backgroundRef(geo), { look = 'none' } = {}) {
  const { width, height } = ref;
  const data = ref.kind === 'file'
    ? await applyLook(sharp(ref.file, { limitInputPixels: 512 * 1024 * 1024 })
        .resize(width, height, { fit: 'cover', position: 'centre' }), look)
        .ensureAlpha().raw().toBuffer()
    : await sharp({ create: { width, height, channels: 4, background: ref.colour } })
        .raw().toBuffer();
  return { name: 'background', left: 0, top: 0, width, height, data, blend: 'over' };
}

export async function renderOverlay(geo, ov) {
  const file = path.resolve(geo.dir, '..', ov.asset);
  if (!existsSync(file)) return null;
  const data = await sharp(file)
    .resize(ov.rect.width, ov.rect.height, { fit: 'fill' })
    .ensureAlpha().raw().toBuffer();
  return {
    name: `overlay · ${path.basename(ov.asset)}`,
    left: ov.rect.left, top: ov.rect.top,
    width: ov.rect.width, height: ov.rect.height,
    data, blend: ov.blend,
  };
}

const asComposite = (l) => ({
  input: l.data,
  raw: { width: l.width, height: l.height, channels: 4 },
  left: l.left, top: l.top,
  blend: l.blend === 'over' ? 'over' : l.blend,
});

/** Open the background as a sharp pipeline sized to the canvas. */
const bgPipeline = (ref, look = 'none') =>
  ref.kind === 'file'
    ? applyLook(sharp(ref.file, { limitInputPixels: 512 * 1024 * 1024 })
        .resize(ref.width, ref.height, { fit: 'cover', position: 'centre' }), look)
    : sharp({ create: { width: ref.width, height: ref.height, channels: 4, background: ref.colour } });

/** Flatten the stack onto the streamed background and write a print-ready file. */
export async function flatten(geo, bgRef, layers, outFile, { quality = 92, mozjpeg = false, look = 'none' } = {}) {
  const pipe = bgPipeline(bgRef, look)
    .composite(layers.map(asComposite))
    .withMetadata({ density: geo.dpi });

  const ext = path.extname(outFile).toLowerCase();
  if (ext === '.tif' || ext === '.tiff') {
    await pipe.tiff({ compression: 'lzw', predictor: 'horizontal' }).toFile(outFile);
  } else if (ext === '.png') {
    await pipe.png({ compressionLevel: 6 }).toFile(outFile);
  } else {
    await pipe.flatten({ background: '#ffffff' })
      .jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg }).toFile(outFile);
  }
  return outFile;
}

/**
 * Low-res proof image. Downscales the already-flattened file rather than
 * compositing a second time — sharp applies resize BEFORE composite in a single
 * pipeline, so full-size layers cannot be dropped onto a resized base.
 */
export async function proof(flatFile, outFile, width = 1600) {
  await sharp(flatFile, { limitInputPixels: 512 * 1024 * 1024 })
    .resize(width)
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toFile(outFile);
  return outFile;
}
