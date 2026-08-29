/**
 * Electron main process. Owns the window and the job queue; does no image work.
 *
 * The renderer of images is a SEPARATE Node process, not Electron's bundled
 * Node: sharp ships a native binding built for Node's ABI, so running it inside
 * Electron would need a rebuild on every version bump. Spawning plain `node`
 * sidesteps that and gives the heavy work its own address space.
 */
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import readline from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** The system node binary — npm sets this when launched via `npm start`. */
const NODE_BIN = process.env.npm_node_execpath || process.env.SPREAD_NODE || 'node';

let win = null;
let service = null;
const selfTestHooks = [];

function startService() {
  if (service && !service.killed) return service;
  service = spawn(NODE_BIN, [path.join(ROOT, 'src', 'render-service.js')], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  readline.createInterface({ input: service.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    let payload;
    try { payload = JSON.parse(line); } catch { return; }
    win?.webContents.send('service-event', payload);
    for (const h of selfTestHooks) h(payload);
  });
  service.stderr.on('data', (d) => {
    win?.webContents.send('service-event', { type: 'stderr', message: String(d) });
  });
  service.on('exit', (code) => {
    win?.webContents.send('service-event', { type: 'service-exit', code });
    service = null;
  });
  return service;
}

const sendJob = (job) => { startService().stdin.write(JSON.stringify(job) + '\n'); };

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1080, minHeight: 700,
    backgroundColor: '#131016',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  if (process.env.SPREAD_SELFTEST) runSelfTest();
});

/**
 * Headless verification. Electron captures its own window internally, which
 * needs no macOS Screen Recording permission — so CI (and a blind agent) can
 * confirm the UI actually renders, not just that the process started.
 */
async function runSelfTest() {
  const { writeFile } = await import('node:fs/promises');
  const shot = process.env.SPREAD_SELFTEST_OUT || '/tmp/spread-ui.png';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await wait(900);

  // The walkthrough auto-opens on a first run — capture it, then dismiss.
  const helpOpen = await win.webContents.executeJavaScript(
    "!document.getElementById('helpOverlay').hidden");
  if (helpOpen) {
    await writeFile(shot.replace(/\.png$/, '-help.png'),
      (await win.webContents.capturePage()).toPNG());
  }
  // Dismiss unconditionally — it may open after the probe above.
  await win.webContents.executeJavaScript(
    "document.getElementById('helpOverlay').hidden = true");
  await wait(300);

  const done = new Promise((resolve) => {
    const onLine = (payload) => { if (payload.type === 'done' || payload.type === 'error') resolve(payload); };
    selfTestHooks.push(onLine);
  });

  // Drive the real UI rather than injecting a job, so the selftest exercises
  // the same path a user does — template choice, look and vary toggle included.
  await win.webContents.executeJavaScript(`(() => {
    const m = document.getElementById('maxSpreads');
    m.value = '6'; m.dispatchEvent(new Event('input'));
    document.getElementById('design').click();
  })()`);

  const result = await done;
  if (result.type === 'error') { console.log('SELFTEST-ERROR ' + result.message); app.quit(); return; }
  await win.webContents.executeJavaScript(
    "document.getElementById('helpOverlay').hidden = true");
  await wait(2200);                        // let the previews decode and paint
  await writeFile(shot, (await win.webContents.capturePage()).toPNG());

  // Phase 2: drive the PSD export and confirm the inspector populates.
  const inspected = new Promise((resolve) => {
    selfTestHooks.push((p) => { if (p.type === 'psd' || p.type === 'error') resolve(p); });
  });
  await win.webContents.executeJavaScript("document.getElementById('exportPsd').click()");
  const psd = await inspected;
  await wait(1200);
  const shot2 = shot.replace(/\.png$/, '-psd.png');
  await writeFile(shot2, (await win.webContents.capturePage()).toPNG());

  // Phase 3: build the client deliverables and confirm the panel lists them.
  const deliveredP = new Promise((resolve) => {
    selfTestHooks.push((p) => { if (p.type === 'delivered' || p.type === 'error') resolve(p); });
  });
  await win.webContents.executeJavaScript("document.getElementById('mkProof').click()");
  const delivered = await deliveredP;
  await wait(400);
  const deliveredPdf = new Promise((resolve) => {
    selfTestHooks.push((p) => { if (p.type === 'delivered' || p.type === 'error') resolve(p); });
  });
  await win.webContents.executeJavaScript("document.getElementById('mkPdf').click()");
  await deliveredPdf;
  await wait(1000);
  const shot3 = shot.replace(/\.png$/, '-deliver.png');
  await writeFile(shot3, (await win.webContents.capturePage()).toPNG());

  console.log('SELFTEST ' + JSON.stringify({
    shot, shot2, shot3, delivered: delivered.outputs ?? delivered, result,
    psd: psd.type === 'psd'
      ? { layers: psd.layers?.length, guides: psd.guides?.length, res: psd.resolution,
          size: psd.width + 'x' + psd.height, bytes: psd.bytes }
      : psd,
  }));
  app.quit();
}
app.on('window-all-closed', () => { service?.kill(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => service?.kill());

// ---------- IPC ----------
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'], title: 'Choose a folder of photos',
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png|tiff?|webp)$/i.test(f));
  return { dir, count: files.length };
});

ipcMain.handle('defaults', async () => {
  // Prefer real photos when they are present; fall back to generated samples.
  const real = path.join(ROOT, 'photos');
  const samples = existsSync(real) ? real : path.join(ROOT, 'samples');
  const files = existsSync(samples)
    ? (await readdir(samples)).filter((f) => /\.(jpe?g|png)$/i.test(f)) : [];
  const tdir = path.join(ROOT, 'templates');
  const { readFile } = await import('node:fs/promises');
  const templates = [];
  for (const f of (await readdir(tdir)).filter((x) => x.endsWith('.json'))) {
    try {
      const t = JSON.parse(await readFile(path.join(tdir, f), 'utf8'));
      templates.push({
        file: path.join(tdir, f),
        id: t.id ?? f.replace(/\.json$/, ''),
        label: t.label ?? t.id,
        album: t.album ?? 'other',
        slots: t.slotCount ?? t.slots?.length ?? 0,
      });
    } catch { /* skip malformed */ }
  }
  templates.sort((a, b) => a.album.localeCompare(b.album) || a.slots - b.slots);

  const { LOOKS } = await import(pathToFileURL(path.join(ROOT, 'src', 'filters.js')).href);
  return {
    photosDir: samples, photoCount: files.length,
    outDir: path.join(ROOT, 'out', 'app'), templates, looks: LOOKS,
  };
});

ipcMain.handle('design', (_e, job) => { sendJob({ cmd: 'design', ...job }); });
ipcMain.handle('export', (_e, job) => { sendJob({ cmd: 'export', ...job }); });
ipcMain.handle('inspect', (_e, job) => { sendJob({ cmd: 'inspect', ...job }); });
ipcMain.handle('deliver', (_e, job) => { sendJob({ cmd: 'deliver', ...job }); });
ipcMain.handle('reveal', (_e, p) => { shell.showItemInFolder(p); });
ipcMain.handle('open-file', (_e, p) => shell.openPath(p));
