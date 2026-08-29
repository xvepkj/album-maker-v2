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
  // Group layouts by album size — a 12x36 and a 12x18 are different products.
  const groups = {};
  for (const t of d.templates) (groups[t.album] ??= []).push(t);
  $('template').innerHTML = Object.entries(groups).map(([album, list]) =>
    `<optgroup label="${album} in — ${list.length} layouts">` + list.map((t) =>
      `<option value="${t.file}">${t.label} · ${t.slots} ${t.slots === 1 ? 'photo' : 'photos'}</option>`
    ).join('') + `</optgroup>`).join('');
  const preferred = d.templates.find((t) => t.id === '12x36.classic.3up');
  if (preferred) $('template').value = preferred.file;

  $('look').innerHTML = d.looks
    .map((l) => `<option value="${l.id}" title="${l.note}">${l.label}</option>`).join('');
  $('look').value = 'soft';

  state.photosDir = d.photosDir;
  state.looks = Object.fromEntries(d.looks.map((l) => [l.id, l]));
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

// The arrow-key handler must not fight the help overlay or a focused slider.


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
    vary: $('vary').checked,
    look: $('look').value,
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
    state.templates = e.templates;
    state.template = Object.values(e.templates)[0];
    state.expected = e.spreads;
    $('listCount').textContent = `0 / ${e.spreads}`;
    const look = state.looks?.[e.look]?.label ?? e.look;
    setStatus(`${e.photos} photos → ${e.spreads} spreads · ${e.layouts} layout${e.layouts === 1 ? '' : 's'} · ${look}`, 'busy');
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
  const layout = (s.template ?? '').split('.').slice(1).join('.');
  li.innerHTML = `<img src="${fileUrl(s.proof)}" alt="">
    <div class="cap"><span>${String(s.index + 1).padStart(2, '0')}
      <span class="layout">${layout}</span></span>
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

  state.template = state.templates?.[s.template] ?? state.template;
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

  $('stat1').textContent = `spread ${s.index + 1} · ${s.templateLabel ?? s.template ?? ''} · ${(s.ms / 1000).toFixed(2)}s`;
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

// ---------- tooltips ----------
// Native `title` waits a second and looks like 2003. This is instant and styled.
const tipEl = $('tip');
let tipTimer = null;

function showTip(el) {
  const raw = el.dataset.tip;
  if (!raw) return;
  tipEl.innerHTML = raw;
  tipEl.hidden = false;
  const r = el.getBoundingClientRect();
  const t = tipEl.getBoundingClientRect();
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(10, Math.min(left, innerWidth - t.width - 10));
  // Prefer below; flip above when there is no room.
  let top = r.bottom + 9;
  if (top + t.height > innerHeight - 10) top = r.top - t.height - 9;
  tipEl.style.left = left + 'px';
  tipEl.style.top = Math.max(10, top) + 'px';
  requestAnimationFrame(() => tipEl.classList.add('on'));
}

function hideTip() {
  clearTimeout(tipTimer);
  tipEl.classList.remove('on');
  tipTimer = setTimeout(() => { tipEl.hidden = true; }, 120);
}

document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el) return;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => showTip(el), 260);
});
document.addEventListener('mouseout', (e) => {
  if (e.target.closest('[data-tip]')) hideTip();
});
document.addEventListener('mousedown', hideTip);

// ---------- help overlay ----------
const help = $('helpOverlay');
const toggleHelp = (on) => {
  help.hidden = on === undefined ? !help.hidden : !on;
  if (!help.hidden) hideTip();
};
$('helpBtn').onclick = () => toggleHelp();
$('helpClose').onclick = () => toggleHelp(false);
help.onclick = (e) => { if (e.target === help) toggleHelp(false); };

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !help.hidden) { toggleHelp(false); return; }
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
  if (e.key === '?' && !typing) toggleHelp();
});

// Show the walkthrough once on a first run, so the vocabulary lands before use.
try {
  if (!localStorage.getItem('seenHelp')) {
    toggleHelp(true);
    localStorage.setItem('seenHelp', '1');
  }
} catch { /* private window, no storage — skip */ }
