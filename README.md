# Spread Engine — Phase 00 render spike

Answers one question before any UI exists:

> Can a JavaScript stack write a correct **print-resolution album spread** as both
> JPEG and **layered PSD**, without Photoshop, inside a sane memory budget?

**Yes.** 40 spreads at 10876×3676px render in ~40s with memory bounded around 1 GB.

## Run it

```bash
npm install
npm run samples       # generate 24 synthetic test photos (first run only)
npm start             # <- the app
```

Press **Design album**. Point it at your own photos with the folder button.

Headless / CI verification, which needs no Screen Recording permission because
Electron captures its own window:

```bash
SPREAD_SELFTEST=1 npx electron .    # renders, exports a PSD, writes /tmp/spread-ui*.png
```

Command line, no UI:

```bash
npm run demo          # render one spread
npm test              # 12 geometry assertions
npm run bench:album   # 40-spread memory trace
```

## The app

| | |
|---|---|
| Folder picker | any folder of JPEG/PNG/TIFF |
| Template picker | anything in `templates/` |
| Spread list | live thumbnails as each one finishes, flagged when a crop was moved off the fold |
| Guide overlay | trim, bleed, fold and slot rectangles drawn over the preview |
| Crop decisions | per slot: aspect fit, % discarded, punch-in, fold status |
| PSD inspector | layer bounds, colour mode, DPI and guides, **read back from the written file** |

### Client deliverables

| output | what it is |
|---|---|
| `client-proof.html` | **one self-contained file.** Every spread inlined as a data URI — email it, AirDrop it, put it on a USB stick. Opens on any phone or browser with no server and no internet. Arrow keys or swipe. |
| `album-<quality>.pdf` | one spread per page at the album's true physical size (36×12 in), trim-cropped |
| `spread-NN.psd` | layered, for a designer to finish by hand |
| `spread-NN.jpg` | full-resolution flattened spread, bleed included, for the lab |

Client-facing outputs are **trim-cropped**: bleed is printer's margin that gets
guillotined off, so showing it to a couple means showing them 3 mm of image that
will not exist in their album.

The PSD inspector exists because you should not need Photoshop to check the
writer is correct. It parses the actual bytes on disk and shows what is in them.

Architecture note: image work runs in a **separate `node` process**, not inside
Electron. sharp's native binding is built for Node's ABI, so running it in
Electron would need a rebuild on every version bump — and the split gives the
heavy work its own address space, which is what the design called for anyway.

Outputs land in `out/`:

| file | what |
|---|---|
| `spread.classic.3up.jpg` | print-ready, 300 dpi, bleed included |
| `spread.classic.3up.psd` | 5 layers, tight bounds, guides on trim + fold |
| `spread.classic.3up.proof.jpg` | 1600px client proof |

## Flags

```
--template <file>     default templates/spread.classic.3up.json
--photos   <dir>      default samples
--out      <dir>      default out
--format   jpg|tiff|png
--mozjpeg             ~18% smaller files, ~8x slower encode
--no-psd  --no-proof  --no-psd-composite
```

## What's real vs. stubbed

| | status |
|---|---|
| Template geometry (bleed, trim, gutter, safe area) | real |
| Cover-fit cropping with subject-box + fold avoidance | real |
| Print-res compositing, JPEG/TIFF/PNG | real |
| Layered PSD writing, guides, 300 dpi metadata | real |
| Client proof | real |
| Album planning (chunk, fill, no photo reused) | real |
| Desktop UI: browse, preview, guides, export | real |
| **Photo → slot scoring** | **stub** — aspect + orientation only; Phase 03 replaces it |
| **Subject detection** | **stub** — reads `<photo>.focus.json`; Phase 02 writes it |

The `<photo>.focus.json` sidecar is `{x, y, w, h}`, normalised to the source
image — exactly the shape a face detector emits. Nothing downstream changes
when real detection lands.

## Measured on an M-series Mac, 16 GB, Node 18

| | |
|---|---|
| one spread, JPEG only | 1.0 s |
| one spread, JPEG + PSD + proof | 2.2 s |
| 40 spreads, JPEG | 40 s, peak 1037 MB, **bounded** |
| 24 photos → 6 spreads, in the app | 6.6 s, 1.10 s/spread, peak 944 MB |
| PSD file size | 75 MB for 5 layers |

### Findings that changed the design

1. **libvips does not stream `composite()`.** Spooling slot rasters to disk and
   compositing from files peaked at 700 MB vs 693 MB in memory — no difference.
   The full canvas is always materialised. Budget ~700 MB per spread, not the
   ~90 MB originally assumed, and render spreads **sequentially**.
2. **mozjpeg costs 8× encode time for 18% file size.** Off by default; use
   `--mozjpeg` for final delivery only.
3. **Threads above 4 add memory, not speed** — `composite()` is allocation-bound.
4. **A subject is a box, not a point.** Clearing a face's *centre* from the fold
   still leaves the fold cutting through the face. Avoidance slides the crop
   window, then punches in up to 18% to make slack, and reports `unresolved`
   when the photo genuinely cannot work in that slot.
5. **PSD layers need tight bounds.** Full-canvas layers cost 160 MB each; a
   5-layer spread would be unwritable.

## Layout

```
src/template.js   normalised template -> pixel geometry (bleed, trim, gutter)
src/crop.js       cover fit + subject-box fold avoidance     <- the real logic
src/compose.js    slot rasters, flatten, proof
src/psd.js        layered PSD via ag-psd
src/cli.js        orchestration + instrumentation
```

## Known limits

- **No RAW.** sharp cannot decode camera RAW; needs a libraw/dcraw sidecar.
- **sRGB only.** No CMYK/ICC. Most labs accept sRGB — revisit when one doesn't.
- Node 18 pins sharp to the 0.33 line. sharp ≥0.35 needs Node 20.9+.
