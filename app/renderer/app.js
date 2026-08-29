const $ = (id) => document.getElementById(id);
const state = { template: null, spreads: [], selected: -1, outDir: '', expected: 0, busy: false };

const setStatus = (text, cls = '') => { $('status').textContent = text; $('status').className = 'status ' + cls; };
const fileUrl = (p) => 'file://' + p.split('/').map(encodeURIComponent).join('/');
const mb = (b) => (b / 1048576).toFixed(0) + ' MB';

// ---------- boot ----------
(async () => {
  const d = await window.api.defaults();
  state.outDir = d.outDir;
  $('photoDir').textContent = d.photosDir;
  $('photoCount').textContent = d.photoCount + ' photos';
  $('outDir').textContent = d.outDir;
  $('template').innerHTML = d.templates
    .map((t) => `<option value="${t.file}">${t.name}</option>`).join('');
  state.photosDir = d.photosDir;
})();

// ---------- controls ----------
$('pick').onclick = async () => {
  const r = await window.api.pickFolder();
  if (!r) return;
  state.photosDir = r.dir;
  $('photoDir').textContent = r.dir;
  $('photoCount').textContent = r.count + ' photos';
};

$('maxSpreads').oninput = (e) => {
  $('spreadCountLabel').textContent = e.target.value === '0' ? 'all' : e.target.value;
};

$('design').onclick = () => {
  if (state.busy) return;
  state.busy = true;
  state.spreads = []; state.selected = -1; state.expected = 0;
  $('list').innerHTML = ''; $('listCount').textContent = '';
  $('canvasWrap').hidden = true; $('empty').hidden = false;
  $('slotRows').innerHTML = '<tr class="none"><td colspan="6">No spread selected.</td></tr>';
  $('psdBox').innerHTML = '<p class="none">Export a PSD to inspect its structure.</p>';
  $('exportPsd').disabled = true; $('reveal').disabled = true;
  $('bar').style.width = '0'; $('design').disabled = true;
  setStatus('planning…', 'busy');
  window.api.design({
    template: $('template').value,
    photosDir: state.photosDir,
    outDir: state.outDir,
    maxSpreads: Number($('maxSpreads').value),
  });
};

$('exportPsd').onclick = () => {
  const s = state.spreads[state.selected];
  if (!s) return;
  setStatus('writing PSD…', 'busy');
  $('exportPsd').disabled = true;
  window.api.exportPsd({ outDir: state.outDir, index: s.index });
};

function deliverables(kind) {
  if (!state.spreads.length) return;
  $('mkProof').disabled = $('mkPdf').disabled = true;
  setStatus(kind === 'pdf' ? 'building PDF…' : 'building client proof…', 'busy');
  window.api.deliver({
    outDir: state.outDir, kind,
    quality: 'client',
    title: 'Your album',
    studio: 'Spread Engine',
  });
}
$('mkProof').onclick = () => deliverables('proof');
$('mkPdf').onclick = () => deliverables('pdf');

$('reveal').onclick = () => {
  const s = state.spreads[state.selected];
  if (s) window.api.reveal(s.psd || s.jpg);
};

for (const id of ['gTrim', 'gFold', 'gSlots']) $(id).onchange = drawOverlay;

document.addEventListener('keydown', (e) => {
  if (!state.spreads.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') select(Math.min(state.selected + 1, state.spreads.length - 1));
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') select(Math.max(state.selected - 1, 0));
});

// ---------- events from the render service ----------
window.api.onEvent((e) => {
  if (e.type === 'plan') {
    state.template = e.template;
    state.expected = e.spreads;
    $('listCount').textContent = `0 / ${e.spreads}`;
    setStatus(`${e.photos} photos → ${e.spreads} spreads`, 'busy');
  }

  if (e.type === 'spread') {
    state.spreads.push(e);
    addCard(e);
    $('listCount').textContent = `${state.spreads.length} / ${state.expected}`;
    $('bar').style.width = (state.spreads.length / state.expected * 100) + '%';
    setStatus(`rendering ${state.spreads.length}/${state.expected}…`, 'busy');
    if (state.spreads.length === 1) select(0);
  }

  if (e.type === 'done') {
    state.busy = false; $('design').disabled = false;
    $('mkProof').disabled = $('mkPdf').disabled = state.spreads.length === 0;
    const n = state.spreads.length || 1;
    setStatus('ready');
    $('stat1').textContent = `${n} spreads · ${(e.totalMs / 1000).toFixed(1)}s`;
    $('stat2').textContent = `${(e.totalMs / n / 1000).toFixed(2)}s per spread`;
    $('stat3').textContent = `peak ${mb(e.peakRss)}`;
  }

  if (e.type === 'exported') {
    const s = state.spreads.find((x) => x.index === e.index);
    if (s) s.psd = e.psd;
    $('exportPsd').disabled = false; $('reveal').disabled = false;
    setStatus('PSD written');
    window.api.inspectPsd({ file: e.psd });
  }

  if (e.type === 'psd') renderPsd(e);

  if (e.type === 'deliver-progress') {
    setStatus(`${e.kind === 'pdf' ? 'PDF' : 'proof'} ${e.done}/${e.total}…`, 'busy');
  }

  if (e.type === 'delivered') {
    $('mkProof').disabled = $('mkPdf').disabled = false;
    setStatus('ready');
    renderDeliverables(e);
  }

  if (e.type === 'error') {
    state.busy = false; $('design').disabled = false;
    setStatus(e.message, 'err');
  }
});

// ---------- spread list ----------
function addCard(s) {
  const li = document.createElement('li');
  li.dataset.i = state.spreads.length - 1;
  const flagged = s.slots.filter((x) => x.gutterStatus === 'moved').length;
  const bad = s.slots.some((x) => x.gutterStatus === 'unresolved');
  li.innerHTML = `<img src="${fileUrl(s.proof)}" alt="">
    <div class="cap"><span>${String(s.index + 1).padStart(2, '0')}</span>
    <span class="flag">${bad ? '⚠ unresolved' : flagged ? `${flagged} moved` : ''}</span></div>`;
  li.onclick = () => select(Number(li.dataset.i));
  $('list').appendChild(li);
}

function select(i) {
  const s = state.spreads[i];
  if (!s) return;
  state.selected = i;
  [...$('list').children].forEach((li, n) => li.classList.toggle('sel', n === i));
  $('list').children[i]?.scrollIntoView({ block: 'nearest' });

  $('empty').hidden = true; $('canvasWrap').hidden = false;
  $('preview').src = fileUrl(s.proof);
  $('exportPsd').disabled = false;
  $('reveal').disabled = false;
  drawOverlay();

  $('slotRows').innerHTML = s.slots.map((x) => {
    const cls = x.gutterStatus === 'n/a' ? 'na' : x.gutterStatus;
    return `<tr><td class="n">${x.id}</td><td>${x.photo}</td>
      <td class="n">${x.fit}</td><td class="n">${x.discardedPct}%</td>
      <td class="n">${x.zoomPct}%</td>
      <td><span class="tag ${cls}">${x.gutterStatus}</span></td></tr>`;
  }).join('');

  $('stat1').textContent = `spread ${s.index + 1} · ${(s.ms / 1000).toFixed(2)}s`;
}

// ---------- guide overlay ----------
function drawOverlay() {
  const t = state.template;
  const s = state.spreads[state.selected];
  if (!t || !s) return;
  const W = t.canvas.width, H = t.canvas.height;
  const pc = (v, tot) => (v / tot * 100) + '%';
  const parts = [];

  if ($('gTrim').checked) {
    parts.push(`<div class="bleed" style="left:0;top:0;width:100%;height:100%"></div>`);
    parts.push(`<div class="trim" style="left:${pc(t.trim.left, W)};top:${pc(t.trim.top, H)};
      width:${pc(t.trim.width, W)};height:${pc(t.trim.height, H)}"></div>`);
  }
  if ($('gSlots').checked) {
    for (const sl of t.slots) {
      parts.push(`<div class="slot" style="left:${pc(sl.rect.left, W)};top:${pc(sl.rect.top, H)};
        width:${pc(sl.rect.width, W)};height:${pc(sl.rect.height, H)}"></div>`);
    }
  }
  if ($('gFold').checked && t.gutter.width) {
    parts.push(`<div class="fold" style="left:${pc(t.gutter.x0, W)};width:${pc(t.gutter.width, W)}"></div>`);
    parts.push(`<div class="lbl" style="left:${pc(t.gutter.x0, W)};top:0">fold</div>`);
  }
  $('overlay').innerHTML = parts.join('');
}

// ---------- deliverables ----------
state.delivered = [];

function renderDeliverables(e) {
  for (const o of e.outputs) {
    state.delivered = state.delivered.filter((d) => d.kind !== o.kind);
    state.delivered.push(o);
  }
  const label = {
    proof: ['Client proof', 'single HTML file · opens on any phone'],
    pdf:   ['Album PDF', 'one spread per page, true album size'],
  };
  $('delivHint').textContent = `${e.spreads} spreads`;
  $('psdBox').innerHTML = `<div class="deliv">` + state.delivered.map((d) => {
    const [name, note] = label[d.kind] ?? [d.kind, ''];
    const size = d.bytes ? ' · ' + mb(d.bytes) : '';
    const dims = d.inches ? ' · ' + d.inches + ' in' : '';
    return `<div class="item"><b>${name}</b><span style="color:var(--ink3)">${note}${dims}${size}</span>
      <span class="meta">${d.file.split('/').pop()}</span>
      <button data-open="${d.file}">Open</button>
      <button data-reveal="${d.file}">Reveal</button></div>`;
  }).join('') + `</div>`;

  $('psdBox').querySelectorAll('[data-open]').forEach((b) =>
    b.onclick = () => window.api.openFile(b.dataset.open));
  $('psdBox').querySelectorAll('[data-reveal]').forEach((b) =>
    b.onclick = () => window.api.reveal(b.dataset.reveal));
}

// ---------- psd inspector ----------
function renderPsd(p) {
  state.delivered = state.delivered.filter((d) => d.kind !== 'psd');
  state.delivered.push({ kind: 'psd', file: p.file, bytes: p.bytes });
  const v = [];
  const ok = (c, label) => c ? `<span class="ok">✓ ${label}</span>` : `<span style="color:var(--bad)">✗ ${label}</span>`;
  v.push(`<dl>
    <dt>file</dt><dd>${p.file.split('/').pop()} · ${mb(p.bytes)}</dd>
    <dt>canvas</dt><dd>${p.width} × ${p.height} px</dd>
    <dt>mode</dt><dd>${ok(p.colorMode === 3, 'RGB')} · ${p.bitsPerChannel} bit/ch</dd>
    <dt>resolution</dt><dd>${ok(/300/.test(p.resolution || ''), p.resolution || 'missing')}</dd>
    <dt>guides</dt><dd>${ok(p.guides.length >= 4, p.guides.length + ' guides')}
      <span style="color:var(--ink3)">${p.guides.map((g) => g.direction[0] + g.location).join(' ')}</span></dd>
  </dl>`);
  v.push(`<table><thead><tr><th>Layer</th><th>Size</th><th>Offset</th><th>Blend</th></tr></thead><tbody>`
    + p.layers.map((l) => `<tr><td>${l.name}</td><td class="n">${l.width}×${l.height}</td>
        <td class="n">${l.left},${l.top}</td><td>${l.blendMode}</td></tr>`).join('')
    + `</tbody></table>`);
  $('psdBox').innerHTML = v.join('');
  $('delivHint').textContent = 'PSD structure';
}
