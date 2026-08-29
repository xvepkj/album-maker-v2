/**
 * Layered PSD output via ag-psd, with no Photoshop anywhere in the process.
 *
 * Each slot becomes a raster layer with TIGHT BOUNDS — that is the whole trick.
 * A naive writer gives every layer full-canvas dimensions, which at
 * 10876x3676 costs 160 MB per layer and makes a five-layer spread unwritable.
 */
import { writePsdBuffer } from 'ag-psd';
import { writeFile } from 'node:fs/promises';

const toImageData = (l) => ({
  width: l.width,
  height: l.height,
  data: new Uint8ClampedArray(l.data.buffer, l.data.byteOffset, l.data.length),
});

const BLEND = { over: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay' };

export async function writePsd(geo, layers, outFile, { composite = null } = {}) {
  const psd = {
    width: geo.canvas.width,
    height: geo.canvas.height,
    channels: 3,
    bitsPerChannel: 8,
    colorMode: 3,                        // RGB
    imageResources: {
      resolutionInfo: {
        horizontalResolution: geo.dpi, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches',
        verticalResolution: geo.dpi,   verticalResolutionUnit: 'PPI', heightUnit: 'Inches',
      },
      // Guides on the trim edges and the fold, so a designer opening the file
      // immediately sees where it is unsafe to place anything.
      gridAndGuidesInformation: {
        guides: [
          { location: geo.bleed, direction: 'vertical' },
          { location: geo.bleed + geo.trim.width, direction: 'vertical' },
          { location: geo.gutter.x0, direction: 'vertical' },
          { location: geo.gutter.x1, direction: 'vertical' },
          { location: geo.bleed, direction: 'horizontal' },
          { location: geo.bleed + geo.trim.height, direction: 'horizontal' },
        ],
      },
    },
    children: layers.map((l) => ({
      name: l.name,
      left: l.left, top: l.top,
      right: l.left + l.width, bottom: l.top + l.height,
      blendMode: BLEND[l.blend] ?? 'normal',
      opacity: 255,
      imageData: toImageData(l),
    })),
  };

  if (composite) psd.imageData = toImageData(composite);

  const buf = writePsdBuffer(psd, { generateThumbnail: false, noBackground: !composite });
  await writeFile(outFile, buf);
  return { file: outFile, bytes: buf.length };
}
