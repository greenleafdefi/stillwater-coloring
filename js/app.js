/* Stillwater app: gallery, studio UI, input handling, autosave, time-lapse. */
(function () {
  var SIZE = 1200;
  var $ = function (s) { return document.querySelector(s); };
  var NEW_IDS = ['koi-pond', 'deco-fans', 'succulent-bowl'];
  var pages = window.STILL_PAGES.concat(window.STILL_LIBRARY || [], Still.store.get('custom-pages', []));
  var state = { brush: Still.store.get('brush', 'watercolor'), inside: true, tool: 'fill', color: '#7fa279', color2: '#f3e3d3', size: 18, opacity: 0.85, smooth: 0.5,
                page: null, palette: Still.store.get('palette', 'Sage Garden'), recent: Still.store.get('recent', []), tab: 'all', cat: 'All', q: '', favs: Still.store.get('favorites', []) };

  var canvases = ['paint', 'live', 'lines'].map(function (id) { var c = $('#' + id); c.width = c.height = SIZE; c.style.width = c.style.height = SIZE + 'px'; return c; });
  $('#stack').style.width = $('#stack').style.height = SIZE + 'px';
  var engine = new Still.Engine(canvases[0], canvases[1], canvases[2], SIZE);
  var view = new Still.View($('#viewport'), $('#stack'), SIZE);
  var calm = new Still.Calm($('#calm'));
  view.onChange = function () { $('#zoom-v').textContent = 'Zoom ' + Math.round(view.scale * 100) + '%'; };

  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 2200); }
  function svgUrl(p) { if (p.png) return p.png; return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(p.svg); }
  function dayIndex() { var d = new Date(); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5); }

  /* ---------- Gallery ---------- */
  function renderGallery() {
    var daily = pages[dayIndex() % pages.length], ds = Still.store.loadPage(daily.id);
    $('#daily').innerHTML = '<img alt="" src="' + (ds && ds.thumb || svgUrl(daily)) + '"><div><h2>Today\'s page · ' + daily.title + '</h2>' +
      '<p>A new page is picked for you each day. Ten quiet minutes is enough.</p><button class="primary" data-open="' + daily.id + '">' + (ds ? 'Continue' : 'Start coloring') + '</button></div>';
    var grid = $('#grid'); grid.innerHTML = ''; var shown = 0, q = state.q.trim().toLowerCase();
    if (lazy) lazy.disconnect();
    pages.forEach(function (p) {
      var s = Still.store.loadPage(p.id), pr = s ? s.progress : 0, isNew = p.lib || NEW_IDS.indexOf(p.id) >= 0, fav = state.favs.indexOf(p.id) >= 0;
      if (state.tab === 'works' && !s) return;
      if (state.tab === 'photos' && p.theme !== 'My photo') return;
      if (state.tab === 'new' && !isNew) return;
      if (state.tab === 'relax' && !p.relax) return;
      if (state.tab === 'easy' && !p.easy) return;
      if (state.tab === 'cbn' && !p.cbn) return;
      if (state.tab === 'favs' && !fav) return;
      if (state.cat !== 'All' && catOf(p) !== state.cat) return;
      if (q && (p.title + ' ' + p.theme).toLowerCase().indexOf(q) < 0) return;
      shown++;
      var b = document.createElement('div'); b.className = 'card'; b.dataset.open = p.id; b.tabIndex = 0; b.setAttribute('role', 'button');
      b.innerHTML = '<img alt="' + p.title + '" loading="lazy" decoding="async"><div class="meta"><span>' + p.title +
        '</span><span class="theme">' + p.theme + '</span></div><div class="prog" title="' + Math.round(pr * 100) + '% colored"><i style="width:' +
        Math.round(pr * 100) + '%"></i></div>' + (s ? '<div class="theme">' + Math.round(pr * 100) + '% · ' + new Date(s.updated).toLocaleDateString() + '</div>' : '') +
        (isNew ? '<span class="new">New</span>' : '') + (p.cbn ? '<span class="cbn-tag" title="Color by Number">123</span>' : '') + (Still.CBN && Still.CBN.isDoneId(p.id) ? '<span class="cbn-donetag">✓ Done</span>' : '') + '<span class="fav' + (fav ? ' on' : '') + '" data-fav="' + p.id + '" title="Favorite" role="button">♥</span>';
      b._src = function () { return s && s.thumb || svgUrl(p); };
      grid.appendChild(b); lazy ? lazy.observe(b) : (b.querySelector('img').src = b._src());
    });
    $('#count').textContent = shown + ' pages';
    $('#works-empty').hidden = shown !== 0;
    $('#works-empty').textContent = state.tab === 'photos' ? 'No photo pages yet. Use “Choose a photo” above.' : state.tab === 'favs' ? 'Tap the ♥ on any page to keep it here.' : state.tab === 'works' ? 'Nothing here yet. Open any page and start coloring — it saves by itself.' : 'No pages match. Try another word or category.';
  }
  // thumbnails only load when the card scrolls near the screen (keeps 120+ pages fast)
  var lazy = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { var im = e.target.querySelector('img'); if (!im.src) im.src = e.target._src(); lazy.unobserve(e.target); } });
  }, { rootMargin: '400px' }) : null;
  function catOf(p) { return p.lib ? p.theme : p.theme === 'My photo' ? 'My photo' : 'Classics'; }
  var CATS = ['All', 'Color by Number', 'Easy', 'Relax', 'Classics', 'Mandalas', 'Flowers', 'Animals', 'Ocean', 'Forest & Nature', 'Geometric & Patterns', 'Seasons', 'Zen & Abstract'];
  CATS.forEach(function (c) { var b = document.createElement('button'); b.textContent = c; b.className = c === 'All' ? 'on' : '';
    b.onclick = function () { state.cat = c; document.querySelectorAll('#cats button').forEach(function (x) { x.classList.toggle('on', x === b); }); renderGallery(); }; $('#cats').appendChild(b); });
  var sT; $('#search').oninput = function () { var v = this.value; clearTimeout(sT); sT = setTimeout(function () { state.q = v; renderGallery(); }, 150); };
  document.addEventListener('click', function (e) { var fv = e.target.closest('[data-fav]'); if (!fv) return; e.stopPropagation();
    var id = fv.dataset.fav, i = state.favs.indexOf(id); if (i >= 0) state.favs.splice(i, 1); else state.favs.push(id);
    Still.store.set('favorites', state.favs); fv.classList.toggle('on', i < 0); if (state.tab === 'favs') renderGallery(); }, true);
  document.addEventListener('click', function (e) { var o = e.target.closest('[data-open]'); if (o) openPage(o.dataset.open); });
  document.querySelectorAll('.tab').forEach(function (t) {
    t.onclick = function () { document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === t); }); state.tab = t.dataset.tab; renderGallery(); };
  });
  // mood palette suggestion
  Still.moods.forEach(function (m) {
    var b = document.createElement('button'); b.textContent = m.emoji + ' ' + m.label;
    b.onclick = function () {
      document.querySelectorAll('#moods button').forEach(function (x) { x.classList.toggle('on', x === b); });
      setPalette(m.palette); $('#mood-note').textContent = m.note + ' Palette set to “' + m.palette + '”.';
    };
    $('#moods').appendChild(b);
  });


  /* ---------- Quiet background preloading (no progress bars) ----------
     While someone colors, idle time is used to decode the next page in the same category
     and today's page (line art + thumbnail), so they open instantly. */
  var idle = window.requestIdleCallback || function (fn) { return setTimeout(function () { fn({ timeRemaining: function () { return 8; } }); }, 400); };
  var preQueue = [], thumbCache = {};
  function srcOf(p) { var a = p.png || p.svg; return a.indexOf('data:') === 0 ? a : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(a); }
  function preloadNext(cur) {
    var same = pages.filter(function (x) { return catOf(x) === catOf(cur); }), i = same.indexOf(cur);
    var list = [same[(i + 1) % same.length], same[(i + 2) % same.length], pages[dayIndex() % pages.length]];
    list.forEach(function (p) { if (p && p !== cur && preQueue.indexOf(p) < 0) preQueue.push(p); });
    idle(work);
  }
  function work(dl) {
    while (preQueue.length && dl.timeRemaining() > 4) {
      var p = preQueue.shift(), src = srcOf(p);
      if (!engine.preloaded[src]) { var im = new Image(); im.decoding = 'async'; im.src = src; if (im.decode) im.decode().catch(function () {}); engine.preloaded[src] = im; }
      if (!thumbCache[p.id]) { var t = new Image(); var s = Still.store.loadPage(p.id); t.src = s && s.thumb || svgUrl(p); thumbCache[p.id] = t; }
      var keys = Object.keys(engine.preloaded); if (keys.length > 12) delete engine.preloaded[keys[0]]; // keep memory small
    }
    if (preQueue.length) idle(work);
  }

  /* ---------- Studio ---------- */
  function openPage(id) {
    var p = pages.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    document.body.classList.toggle('relax', !!p.relax);
    $('#affirm').hidden = !p.affirmation; $('#affirm').textContent = p.affirmation || '';
    if (p.easy && !prefs.easy) { state.autoEasy = true; setPref('easy', true); } else if (!p.easy && state.autoEasy) { state.autoEasy = false; setPref('easy', false); }
    if (p.easy) setPalette('Petal Soft');
    if (p.relax) { setPalette('Relax Pastel'); if (!calm.active()) { calm.toggle(); $('#calm-btn').classList.add('primary'); } }
    if (Still.CBN) Still.CBN.stop(); document.body.dataset.ready = '0';
    state.page = p; $('#gallery').hidden = true; $('#studio').hidden = false; $('#page-title').textContent = p.title.indexOf(p.theme) === 0 ? p.title : p.title + ' · ' + p.theme;
    engine.pctx.clearRect(0, 0, SIZE, SIZE); engine.resetHistory(); engine.ops = [];
    engine.loadLineArt(p.png || p.svg, function () {
      var s = Still.store.loadPage(id);
      var ready = function () { view.fit(); updateButtons(); preloadNext(p);
        var wantCbn = p.cbn || Still.store.get('cbn-on:' + p.id, false);
        $('#cbn-btn').setAttribute('aria-pressed', wantCbn); $('#cbn-btn').classList.toggle('primary', wantCbn);
        if (wantCbn && Still.CBN) Still.CBN.start(StillApp, p, function () { document.body.dataset.ready = '1'; });
        else document.body.dataset.ready = '1'; };
      if (s && s.paint) {
        var im = new Image(); im.onload = function () { engine.pctx.drawImage(im, 0, 0); ready(); }; im.onerror = ready; im.src = s.paint;
        engine.ops = s.ops || [];
      } else ready();
    });
  }
  $('#back').onclick = function () { saveNow(); if (Still.CBN) Still.CBN.stop(); $('#studio').hidden = true; $('#gallery').hidden = false; if (calm.active()) { calm.stop(); $('#calm-btn').classList.remove('primary'); } document.body.classList.remove('relax'); if (state.autoEasy) { state.autoEasy = false; setPref('easy', false); } renderGallery(); };

  var saveTimer = null;
  engine.onChange = function () { updateButtons(); if (Still.CBN && Still.CBN.on) Still.CBN.refresh(); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700); };
  function saveNow() {
    if (!state.page) return;
    clearTimeout(saveTimer);
    var paint = engine.paint.toDataURL('image/webp', 0.92);
    if (paint.indexOf('image/webp') < 0) paint = engine.paint.toDataURL('image/png');
    var ops = engine.ops; if (JSON.stringify(ops).length > 600000) ops = []; // keep storage small
    var ok = Still.store.savePage(state.page.id, { paint: paint, thumb: engine.composite(260).toDataURL('image/jpeg', 0.85),
      progress: engine.progress(), ops: ops, updated: Date.now() });
    if (!ok) toast('Browser storage is full — use Save PNG to keep your picture.');
  }
  function updateButtons() { $('#undo').disabled = !engine.undoStack.length; $('#redo').disabled = !engine.redoStack.length; }

  /* tools */
  function setTool(t) {
    state.tool = t;
    document.querySelectorAll('.tool').forEach(function (b) { b.classList.toggle('active', b.dataset.tool === t); });
    document.querySelectorAll('[data-for]').forEach(function (l) { l.style.display = l.dataset.for.split(' ').indexOf(t) >= 0 ? '' : 'none'; });
    $('#viewport').classList.toggle('tool-pan', t === 'pan');
  }
  document.querySelectorAll('.tool').forEach(function (b) { b.onclick = function () { setTool(b.dataset.tool); }; });
  function bindRange(id, out, fn) { var i = $('#' + id); i.oninput = function () { $('#' + out).textContent = fn(+i.value); }; i.oninput(); }
  bindRange('size', 'size-v', function (v) { state.size = v; return v; });
  bindRange('opacity', 'op-v', function (v) { state.opacity = v / 100; return v + '%'; });
  bindRange('smooth', 'sm-v', function (v) { state.smooth = v / 100; return v + '%'; });
  bindRange('tol', 'tol-v', function (v) { engine.setTolerance(v); return v; });

  /* colors */
  function setColor(c, second) {
    c = c.toLowerCase();
    if (second) state.color2 = c; else { state.color = c; $('#picker').value = c; }
    $('#cur1').style.background = state.color; $('#cur2').style.background = state.color2;
    document.querySelectorAll('.sw').forEach(function (s) { s.classList.toggle('on', s.dataset.c === state.color); });
  }
  function addRecent(c) {
    state.recent = [c].concat(state.recent.filter(function (x) { return x !== c; })).slice(0, 12);
    Still.store.set('recent', state.recent); renderSwatches($('#recent'), state.recent);
  }
  function renderSwatches(el, list) {
    el.innerHTML = '';
    list.forEach(function (c) {
      var b = document.createElement('button'); b.className = 'sw'; b.style.background = c; b.dataset.c = c; b.setAttribute('aria-label', 'Color ' + c); b.title = c + ' (right-click: second color)';
      b.onclick = function () { setColor(c); };
      b.oncontextmenu = function (e) { e.preventDefault(); setColor(c, true); toast('Second color set for Glow fill'); };
      el.appendChild(b);
    });
    setColor(state.color, false);
  }
  function setPalette(name) {
    var p = Still.palettes.filter(function (x) { return x.name === name; })[0] || Still.palettes[0];
    state.palette = p.name; Still.store.set('palette', p.name); $('#palette-select').value = p.name;
    renderSwatches($('#palette'), p.colors); setColor(p.colors[3]); setColor(p.colors[0], true);
  }
  Still.palettes.forEach(function (p) { var o = document.createElement('option'); o.textContent = p.name; $('#palette-select').appendChild(o); });
  $('#palette-select').onchange = function () { setPalette(this.value); };
  $('#picker').oninput = function () { setColor(this.value); };
  $('#picker').onchange = function () { addRecent(this.value); };
  $('#swap').onclick = function () { var a = state.color; setColor(state.color2); setColor(a, true); };

  function pres(e) { return e.pointerType === 'pen' ? e.pressure : null; }
  /* ---------- Pointer input: fill, brush, pan, pinch ---------- */
  var vp = $('#viewport'), pointers = {}, spaceDown = false, gesture = null, down = null;
  function pcount() { return Object.keys(pointers).length; }
  vp.addEventListener('pointerdown', function (e) {
    if (e.target.closest('#replay-layer')) return; // replay window has its own buttons
    try { vp.setPointerCapture(e.pointerId); } catch (err) {} pointers[e.pointerId] = [e.clientX, e.clientY];
    if (pcount() === 2) { // pinch begins: drop any stroke in progress
      engine.cancelStroke(); down = null;
      var k = Object.keys(pointers), a = pointers[k[0]], b = pointers[k[1]];
      gesture = { type: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
      return;
    }
    if (e.button === 1 || spaceDown || state.tool === 'pan') { e.preventDefault(); gesture = { type: 'pan', x: e.clientX, y: e.clientY }; vp.classList.add('panning'); return; }
    if (e.button !== 0) return;
    var p = view.toCanvas(e.clientX, e.clientY);
    down = { x: e.clientX, y: e.clientY, cx: p[0], cy: p[1] };
    if (state.tool === 'brush' || state.tool === 'eraser') {
      engine.stayInside = state.inside;
      engine.beginStroke(p[0], p[1], { tool: state.tool, brush: state.brush, color: state.color, size: state.size, opacity: state.opacity, smoothing: state.smooth }, pres(e));
      if (state.inside && !engine.isMaskedStroke()) toast('Started on a line — this stroke is not limited to a shape.');
    }
  });
  vp.addEventListener('pointermove', function (e) {
    if (!pointers[e.pointerId]) return;
    pointers[e.pointerId] = [e.clientX, e.clientY];
    if (gesture && gesture.type === 'pinch' && pcount() >= 2) {
      var k = Object.keys(pointers), a = pointers[k[0]], b = pointers[k[1]], r = vp.getBoundingClientRect();
      var d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      view.panBy(mx - gesture.mx, my - gesture.my); view.zoomAt(d / gesture.d, mx - r.left, my - r.top);
      gesture.d = d; gesture.mx = mx; gesture.my = my; return;
    }
    if (gesture && gesture.type === 'pan') { view.panBy(e.clientX - gesture.x, e.clientY - gesture.y); gesture.x = e.clientX; gesture.y = e.clientY; return; }
    if (engine.isStroking()) {
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; if (!evs.length) evs = [e];
      evs.forEach(function (ev) { var p = view.toCanvas(ev.clientX, ev.clientY); engine.moveStroke(p[0], p[1], pres(ev)); });
    }
  });
  function up(e) {
    if (!pointers[e.pointerId]) return;
    delete pointers[e.pointerId];
    if (gesture) { if (pcount() === 0) { gesture = null; vp.classList.remove('panning'); } return; }
    if (engine.isStroking()) { engine.endStroke(); if (state.tool === 'brush') addRecent(state.color); return; }
    if (down && (state.tool === 'fill' || state.tool === 'gradient') && Math.hypot(e.clientX - down.x, e.clientY - down.y) < (prefs.easy ? 28 : 8)) {
      var ok = engine.fill(down.cx, down.cy, { color: state.color, color2: state.color2, mode: state.tool === 'gradient' ? 'gradient' : 'solid' });
      if (ok) addRecent(state.color); else toast('That spot is a line — tap inside a shape.');
    }
    down = null;
  }
  vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', up);
  vp.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ---------- Buttons + keyboard ---------- */
  $('#undo').onclick = function () { engine.undo(); };
  $('#redo').onclick = function () { engine.redo(); };
  $('#zoom-in').onclick = function () { view.zoomCenter(1.25); };
  $('#zoom-out').onclick = function () { view.zoomCenter(0.8); };
  $('#zoom-reset').onclick = function () { view.fit(); };
  $('#clear').onclick = function () { if (confirm('Start this page over? (You can still Undo.)')) engine.clear(); };
  $('#calm-btn').onclick = function () { var on = calm.toggle(); this.classList.toggle('primary', on); toast(on ? 'Calm Mode on — follow the circle as you color' : 'Calm Mode off'); };
  $('#export').onclick = exportPng;
  function exportPng() {
    var c = engine.composite(); var name = 'stillwater-' + state.page.id + '-' + new Date().toISOString().slice(0, 10) + '.png';
    c.toBlob(function (b) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); toast('Saved ' + name + ' to your Downloads');
    }, 'image/png');
  }
  document.addEventListener('keydown', function (e) {
    if ($('#studio').hidden || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    var k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? engine.redo() : engine.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); engine.redo(); return; }
    if (mod && k === 's') { e.preventDefault(); exportPng(); return; }
    if (mod) return;
    if (k === ' ') { e.preventDefault(); spaceDown = true; vp.classList.add('panning'); return; }
    var map = { f: 'fill', g: 'gradient', b: 'brush', e: 'eraser', h: 'pan' };
    if (map[k]) setTool(map[k]);
    else if (k === 'x') $('#swap').click();
    else if (k === 'c') $('#calm-btn').click();
    else if (k === '+' || k === '=') view.zoomCenter(1.25);
    else if (k === '-') view.zoomCenter(0.8);
    else if (k === '0') view.fit();
    else if (k === '[' || k === ']') { var s = $('#size'); s.value = +s.value + (k === ']' ? 4 : -4); s.oninput(); }
  });
  document.addEventListener('keyup', function (e) { if (e.key === ' ') { spaceDown = false; if (!gesture) vp.classList.remove('panning'); } });
  window.addEventListener('beforeunload', saveNow);

  /* ---------- Time-lapse replay ---------- */
  var replayRaf = null;
  $('#replay').onclick = function () {
    var ops = engine.ops.slice();
    if (!ops.length) { toast('Nothing recorded yet — color a little first.'); return; }
    var off = [0, 1, 2].map(function () { var c = document.createElement('canvas'); c.width = c.height = SIZE; return c; });
    var re = new Still.Engine(off[0], off[1], off[2], SIZE); re.barrier = engine.barrier; re.texCanvases = engine.texCanvases;
    var out = $('#replay-canvas'); out.width = out.height = 900; var octx = out.getContext('2d');
    $('#replay-layer').hidden = false;
    var i = 0, per = Math.max(1, Math.ceil(ops.length / 300));
    function frame() {
      for (var n = 0; n < per && i < ops.length; n++, i++) {
        var op = ops[i];
        if (op.t === 'fill') re.fill(op.x, op.y, { color: op.c, color2: op.c2, mode: op.m }, false);
        else if (op.t === 'stroke') re.drawRecordedStroke(op, re.pctx);
        else if (op.t === 'clear') re.pctx.clearRect(0, 0, SIZE, SIZE);
      }
      octx.fillStyle = '#fbfaf7'; octx.fillRect(0, 0, 900, 900); octx.drawImage(off[0], 0, 0, 900, 900); octx.drawImage(engine.lines, 0, 0, 900, 900);
      $('#replay-step').textContent = 'Step ' + i + ' of ' + ops.length;
      if (i < ops.length) replayRaf = setTimeout(frame, 40); else $('#replay-step').textContent = 'Finished · ' + ops.length + ' steps';
    }
    frame();
  };
  $('#replay-close').onclick = function () { clearTimeout(replayRaf); $('#replay-layer').hidden = true; };

  /* ---------- Start ---------- */
  /* brush picker */
  Object.keys(engine.BRUSHES).forEach(function (k) {
    var b = document.createElement('button'); b.textContent = engine.BRUSHES[k].label; b.dataset.brush = k;
    b.onclick = function () { state.brush = k; Still.store.set('brush', k); markBrush(); if (state.tool !== 'brush') setTool('brush'); };
    $('#brushes').appendChild(b);
  });
  function markBrush() { document.querySelectorAll('#brushes button').forEach(function (b) { b.classList.toggle('on', b.dataset.brush === state.brush); }); }
  markBrush();
  $('#inside').onchange = function () { state.inside = this.checked; toast(this.checked ? 'Stay inside on: strokes stay in their shape' : 'Stay inside off: paint freely'); };
  engine.loadTextures(Still.textures);

  /* ---------- Photo to coloring page ---------- */
  var ph = { img: null, style: 'portrait', timer: null, seq: 0 };
  var phFinalWork = window.matchMedia && window.matchMedia('(max-width:820px)').matches ? 960 : 1120; // phones: a bit smaller so it stays near 3 s
  function phOpts(work) { return { style: ph.style, detail: +$('#ph-detail').value, thickness: +$('#ph-thick').value, simplify: +$('#ph-simp').value, regions: $('#ph-regions').checked, work: work }; }
  function phBusy(on) { $('#ph-working').hidden = !on; $('#ph-after').classList.toggle('busy', on); }
  function phRender() {
    if (!ph.img) return; $('#ph-stats').textContent = 'working…'; phBusy(true);
    clearTimeout(ph.timer);
    ph.timer = setTimeout(function () {
      var my = ++ph.seq, t0 = performance.now();
      Still.Photo.convertAsync(ph.img, phOpts(560)).then(function (r) {
        if (my !== ph.seq) return; // a newer preview is on its way
        var out = $('#ph-after'); out.width = out.height = 600; out.getContext('2d').drawImage(r.canvas, 0, 0, 600, 600);
        $('#ph-stats').textContent = 'about ' + r.regions + ' fillable areas (preview) · ' + Math.round(performance.now() - t0) + ' ms'; phBusy(false);
      });
    }, 150);
  }
  function nextPhotoName() { var n = pages.filter(function (p) { return p.theme === 'My photo'; }).length + 1; return 'My photo ' + n; }
  function phLoad(file) {
    if (!file || !/^image\//.test(file.type)) { toast('Please choose an image file.'); return; }
    var rd = new FileReader();
    rd.onload = function () { var im = new Image(); im.onload = function () {
      ph.img = im; $('#photo-work').hidden = false; $('#ph-name').value = ''; $('#ph-name').placeholder = nextPhotoName();
      var b = $('#ph-before'); b.width = b.height = 600; var bx = b.getContext('2d'); bx.fillStyle = '#fbfaf7'; bx.fillRect(0, 0, 600, 600);
      var s = Math.min(520 / im.width, 520 / im.height); bx.drawImage(im, (600 - im.width * s) / 2, (600 - im.height * s) / 2, im.width * s, im.height * s);
      phRender(); }; im.onerror = function () { toast('This image could not be opened.'); }; im.src = rd.result; };
    rd.readAsDataURL(file);
  }
  $('#photo-open').onclick = function () { $('#photo').hidden = false; };
  $('#photo-close').onclick = function () { $('#photo').hidden = true; };
  $('#photo-file').onchange = function () { phLoad(this.files[0]); this.value = ''; };
  var drop = $('#drop');
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { phLoad(e.dataTransfer.files[0]); });
  document.querySelectorAll('#ph-style button').forEach(function (b) { b.onclick = function () {
    ph.style = b.dataset.style; document.querySelectorAll('#ph-style button').forEach(function (x) { x.classList.toggle('on', x === b); }); phRender(); }; });
  [['ph-detail', 'ph-detail-v'], ['ph-thick', 'ph-thick-v'], ['ph-simp', 'ph-simp-v']].forEach(function (p) { $('#' + p[0]).oninput = function () { $('#' + p[1]).textContent = this.value; phRender(); }; });
  $('#ph-regions').onchange = phRender;
  $('#ph-cbn').onchange = function () { if (this.checked && ph.style !== 'mosaic' && ph.style !== 'portrait') document.querySelector('#ph-style [data-style=portrait]').click(); };
  $('#ph-start').onclick = function () {
    if (!ph.img || ph.making) return; ph.making = true; $('#ph-start').textContent = 'Making your page…'; $('#ph-start').disabled = true; phBusy(true);
    Still.Photo.convertAsync(ph.img, phOpts(phFinalWork)).then(function (r) {
      ph.making = false; $('#ph-start').disabled = false; phBusy(false); var id = 'photo-' + Date.now();
      var page = { id: id, title: ($('#ph-name').value.trim() || nextPhotoName()).slice(0, 28), theme: 'My photo', png: r.canvas.toDataURL('image/png') };
      if ($('#ph-cbn').checked) { var sc = Math.min(1, 480 / Math.max(ph.img.width, ph.img.height)), cc = document.createElement('canvas'); cc.width = Math.round(ph.img.width * sc); cc.height = Math.round(ph.img.height * sc);
        cc.getContext('2d').drawImage(ph.img, 0, 0, cc.width, cc.height); page.cmap = cc.toDataURL('image/jpeg', 0.85); page.cmapFit = r.fit; page.cbn = true; }
      var list = Still.store.get('custom-pages', []); list.push(page);
      $('#ph-start').textContent = 'Start coloring →';
      if (!Still.store.set('custom-pages', list)) { toast('Storage full — delete a photo page first.'); return; }
      pages.push(page); $('#photo').hidden = true; renderGallery(); openPage(id); toast('Your photo page is ready. Tap inside shapes to fill.');
    });
  };

  /* ---------- optional Pi Browser sign-in (no payments) ---------- */
  if (Still.Pi) {
    Still.Pi.onChange(function (st) { var b = $('#pi-signin'); b.hidden = !(st.ready && st.enabled); if (st.user) { b.textContent = 'π ' + st.user.username; b.disabled = true; } });
    $('#pi-signin').onclick = function () { Still.Pi.signIn().then(function (u) { toast('Signed in as ' + u.username); }, function (e) { toast(e.message || 'Pi sign-in was cancelled.'); }); };
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('card')) openPage(e.target.dataset.open); });

  /* ---------- accessibility preferences (Easy mode, High contrast, Larger text) ---------- */
  var prefs = Still.store.get('prefs', { easy: false, contrast: false, bigtext: false });
  function setPref(k, v, save) {
    prefs[k] = v; document.body.classList.toggle(k, v);
    document.querySelectorAll('.a11y-btn[data-pref=' + k + ']').forEach(function (b) { b.setAttribute('aria-pressed', v ? 'true' : 'false'); });
    if (k === 'easy') {
      engine.forgive = v ? 40 : 6;
      if (v) { state.brush = 'round'; state.size = 60; $('#size').value = 60; $('#size-v').textContent = 60; if (state.tool !== 'fill' && state.tool !== 'brush') setTool('fill'); }
    }
    if (save !== false && !(k === 'easy' && state.autoEasy)) Still.store.set('prefs', prefs);
  }
  document.querySelectorAll('.a11y-btn').forEach(function (b) { b.onclick = function () { var k = b.dataset.pref; if (k === 'easy') state.autoEasy = false; setPref(k, !prefs[k]); }; });
  ['easy', 'contrast', 'bigtext'].forEach(function (k) { setPref(k, !!prefs[k], false); });
  /* keyboard / switch control on the page: arrows move a target, Enter or Space fills there */
  var kc = { x: 600, y: 600 }, kEl = $('#kbd-cursor');
  function placeK() { var r = vp.getBoundingClientRect(), s = view.scale; kEl.style.left = (view.x + kc.x * s) + 'px'; kEl.style.top = (view.y + kc.y * s) + 'px'; }
  vp.addEventListener('focus', function () { kEl.hidden = false; placeK(); });
  vp.addEventListener('blur', function () { kEl.hidden = true; });
  vp.addEventListener('keydown', function (e) {
    var st = e.shiftKey ? 10 : 40, m = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (m) { e.preventDefault(); e.stopPropagation(); kc.x = Math.max(0, Math.min(SIZE - 1, kc.x + m[0])); kc.y = Math.max(0, Math.min(SIZE - 1, kc.y + m[1])); placeK(); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation();
      var ok = engine.fill(kc.x, kc.y, { color: state.color, color2: state.color2, mode: state.tool === 'gradient' ? 'gradient' : 'solid' });
      if (ok) addRecent(state.color); else toast('Move the target inside a shape.'); }
  });

  setPalette(state.palette); renderSwatches($('#recent'), state.recent); setTool('fill'); renderGallery();
  var _fill = engine.fill; engine.fill = function (x, y, o, rec) { if (Still.CBN && Still.CBN.on && rec !== false) return Still.CBN.tap(x, y, function (a, b, c) { return _fill(a, b, c, rec); }); return _fill(x, y, o, rec); };
  $('#cbn-btn').onclick = function () { var p = state.page; if (!p) return; var on = !(Still.CBN && Still.CBN.on);
    if (!p.cbn) Still.store.set('cbn-on:' + p.id, on); this.setAttribute('aria-pressed', on); this.classList.toggle('primary', on);
    if (on) Still.CBN.start(StillApp, p); else Still.CBN.stop(); };
  window.StillApp = { preQueue: preQueue, thumbCache: thumbCache, setColor: setColor, toast: toast, pages: pages, engine: engine, view: view, state: state, openPage: openPage, saveNow: saveNow, setTool: setTool };
})();

/* Turns any image into clean black line art (transparent elsewhere), fitted on a square page
   with a frame so the outside is closed too. Soft 40-level ramp keeps edges smooth. */
Still.thresholdLineArt = function (im, size, thr) {
  var c = document.createElement('canvas'); c.width = c.height = size; var x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, size, size);
  var m = 40, s = Math.min((size - 2 * m) / im.width, (size - 2 * m) / im.height), w = im.width * s, h = im.height * s;
  x.drawImage(im, (size - w) / 2, (size - h) / 2, w, h);
  var d = x.getImageData(0, 0, size, size), p = d.data;
  for (var i = 0; i < p.length; i += 4) {
    var l = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2], a = Math.max(0, Math.min(1, (thr + 20 - l) / 40));
    p[i] = 43; p[i + 1] = 43; p[i + 2] = 51; p[i + 3] = Math.round(a * 255);
  }
  x.putImageData(d, 0, 0);
  x.strokeStyle = '#2b2b33'; x.lineWidth = 4; x.strokeRect(16, 16, size - 32, size - 32);
  return c.toDataURL('image/png');
};
