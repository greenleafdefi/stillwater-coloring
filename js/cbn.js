/* Color by Number mode. Works on any page:
   - pages with `cmap` (original CBN pages): target colors come from the hidden color map
   - pages with a `cmap` reference image: region average colors, grouped with k-means
   - any other page: a soft seeded auto palette
   Progress is read back from the paint layer, so autosave, undo and resume just work. */
(function () {
  var S = 1200, T = 1200, MIN = 140; // S = page width (and row stride), T = page height; // areas smaller than MIN px are not numbered (they are filled at the end)
  var C = { on: false };
  var $ = function (s) { return document.querySelector(s); };
  function hex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join(''); }
  function rgb(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function lum(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
  function d2(a, b) { var r = a[0] - b[0], g = a[1] - b[1], bl = a[2] - b[2]; return 2 * r * r + 4 * g * g + 3 * bl * bl; }

  /* 1. label every closed area (no grow), 4-connected scanline */
  function label(bar) {
    var lab = new Int32Array(S * T).fill(-1), regs = [], st = [];
    for (var p0 = 0; p0 < S * T; p0++) {
      if (bar[p0] || lab[p0] >= 0) continue;
      var id = regs.length, cnt = 0, sx = 0, sy = 0, touch = false; st.length = 0; st.push(p0); lab[p0] = id;
      while (st.length) { var p = st.pop(), x = p % S, y = (p - x) / S; cnt++; sx += x; sy += y;
        if (x === 0 || y === 0 || x === S - 1 || y === T - 1) touch = true;
        if (x > 0 && !bar[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; st.push(p - 1); }
        if (x < S - 1 && !bar[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; st.push(p + 1); }
        if (y > 0 && !bar[p - S] && lab[p - S] < 0) { lab[p - S] = id; st.push(p - S); }
        if (y < T - 1 && !bar[p + S] && lab[p + S] < 0) { lab[p + S] = id; st.push(p + S); } }
      regs.push({ id: id, n: cnt, cx: sx / cnt, cy: sy / cnt, edge: touch, sum: [0, 0, 0], a: 0, k: 0 });
    }
    return { lab: lab, regs: regs };
  }
  /* 2. distance to the nearest line / other area (chamfer 3-4), keep the deepest point per area for its number */
  function placeNumbers(lab, regs) {
    var D = new Uint16Array(S * T), i, x, y, INF = 65000;
    for (i = 0; i < S * T; i++) D[i] = lab[i] < 0 ? 0 : INF;
    for (y = 0; y < T; y++) for (x = 0; x < S; x++) { i = y * S + x; if (!D[i]) continue; var v = D[i];
      if (x > 0) v = Math.min(v, D[i - 1] + 3); if (y > 0) { v = Math.min(v, D[i - S] + 3); if (x > 0) v = Math.min(v, D[i - S - 1] + 4); if (x < S - 1) v = Math.min(v, D[i - S + 1] + 4); }
      if (x === 0 || y === 0) v = Math.min(v, 3); D[i] = v; }
    for (y = T - 1; y >= 0; y--) for (x = S - 1; x >= 0; x--) { i = y * S + x; if (!D[i]) continue; var w = D[i];
      if (x < S - 1) w = Math.min(w, D[i + 1] + 3); if (y < T - 1) { w = Math.min(w, D[i + S] + 3); if (x < S - 1) w = Math.min(w, D[i + S + 1] + 4); if (x > 0) w = Math.min(w, D[i + S - 1] + 4); }
      if (x === S - 1 || y === T - 1) w = Math.min(w, 3); D[i] = w; }
    regs.forEach(function (r) { r.best = -1; });
    for (i = 0; i < S * T; i++) { var l = lab[i]; if (l >= 0 && D[i] > regs[l].best) { regs[l].best = D[i]; regs[l].bx = i % S; regs[l].by = (i / S) | 0; } }
    regs.forEach(function (r) { r.rad = r.best / 3; });
  }
  /* 3. target colors */
  function sampleCmap(cm, lab, regs) {
    var d = cm.getContext('2d').getImageData(0, 0, S, T).data;
    for (var i = 0; i < S * T; i += 1) { var l = lab[i]; if (l < 0) continue; var r = regs[l], o = i * 4;
      if (d[o + 3] > 200) { r.sum[0] += d[o]; r.sum[1] += d[o + 1]; r.sum[2] += d[o + 2]; r.a++; } }
  }
  function kmeans(pts, wts, k) { // weighted, deterministic seeding (farthest point)
    var cs = [pts[0]], i, j;
    while (cs.length < k) { var bi = 0, bd = -1; for (i = 0; i < pts.length; i++) { var m = Infinity; for (j = 0; j < cs.length; j++) m = Math.min(m, d2(pts[i], cs[j])); m *= Math.sqrt(wts[i]); if (m > bd) { bd = m; bi = i; } } if (bd <= 0) break; cs.push(pts[bi]); }
    var as = new Array(pts.length);
    for (var it = 0; it < 12; it++) {
      for (i = 0; i < pts.length; i++) { var best = 0, bdd = Infinity; for (j = 0; j < cs.length; j++) { var dd = d2(pts[i], cs[j]); if (dd < bdd) { bdd = dd; best = j; } } as[i] = best; }
      var acc = cs.map(function () { return [0, 0, 0, 0]; });
      for (i = 0; i < pts.length; i++) { var a = acc[as[i]]; a[0] += pts[i][0] * wts[i]; a[1] += pts[i][1] * wts[i]; a[2] += pts[i][2] * wts[i]; a[3] += wts[i]; }
      cs = acc.map(function (a, j) { return a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : cs[j]; });
    }
    return { centers: cs, assign: as };
  }
  var AUTO = ['#f6c0d0', '#f7d26b', '#9fcf9a', '#9ec3e6', '#c7b6e2', '#f2a07b', '#7fae8f', '#e58f8f', '#bfe0ee', '#f6dcb4'];
  function buildPalette(page, regs, easy) {
    var use = regs.filter(function (r) { return r.n >= MIN && (!r.cm || r.a > r.n * 0.3); });
    var maxK = easy ? 6 : (page.cpal ? 24 : 12);
    if (page.cmap) {
      use.forEach(function (r) { r.col = r.a ? [r.sum[0] / r.a, r.sum[1] / r.a, r.sum[2] / r.a] : [255, 255, 255]; });
      var pal;
      if (page.cpal && page.cpal.length <= maxK) { // exact original colors: snap each area to the nearest one
        pal = page.cpal.map(rgb); use.forEach(function (r) { var b = 0, bd = Infinity; pal.forEach(function (c, j) { var dd = d2(r.col, c); if (dd < bd) { bd = dd; b = j; } }); r.k = b; });
      } else { var km = kmeans(use.map(function (r) { return r.col; }), use.map(function (r) { return r.n; }), Math.min(maxK, use.length)); pal = km.centers; use.forEach(function (r, i) { r.k = km.assign[i]; }); }
      return finish(pal, use);
    }
    // auto: neighbours by position bands, seeded so it is always the same
    var k = Math.min(easy ? 5 : 8, AUTO.length), pal2 = AUTO.slice(0, k).map(rgb);
    use.forEach(function (r) { var h = Math.abs(Math.sin(r.cx * 12.9898 + r.cy * 78.233) * 43758.5453) % 1; r.k = Math.floor(h * k); });
    return finish(pal2, use);
  }
  function finish(pal, use) { // drop unused colors, number them light -> dark
    var used = pal.map(function (c, j) { return { c: c, j: j, n: use.filter(function (r) { return r.k === j; }).length }; }).filter(function (o) { return o.n; });
    used.sort(function (a, b) { return lum(b.c) - lum(a.c); });
    var map = {}; used.forEach(function (o, i) { map[o.j] = i; });
    use.forEach(function (r) { r.num = map[r.k] + 1; r.hex = hex(used[map[r.k]].c); r.rgb = used[map[r.k]].c.map(Math.round); });
    return { colors: used.map(function (o) { return hex(o.c); }), areas: use };
  }

  /* ---------- runtime ---------- */
  function ensureLayers() {
    if ($('#cbn-num')) return;
    ['cbn-hl', 'cbn-num'].forEach(function (id) { var c = document.createElement('canvas'); c.id = id; c.width = S; c.height = T; c.className = 'cbn-layer'; c.setAttribute('aria-hidden', 'true'); $('#stack').appendChild(c); });
    var bar = document.createElement('div'); bar.id = 'cbn-bar'; bar.hidden = true; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Color by number colors');
    bar.innerHTML = '<div class="cbn-prog"><span id="cbn-count" aria-live="polite"></span><div class="bar"><i id="cbn-fill"></i></div><button id="cbn-next" title="Show me an empty area">Find next</button></div><div id="cbn-sw" class="cbn-sw"></div>';
    $('#studio').appendChild(bar);
    var done = document.createElement('div'); done.id = 'cbn-done'; done.hidden = true; done.setAttribute('role', 'dialog'); done.setAttribute('aria-label', 'Page finished');
    done.innerHTML = '<div class="card-done"><h2>Beautiful.</h2><p>Every area is colored. Take a slow breath and enjoy it.</p><button class="primary" id="cbn-gallery">Back to gallery</button> <button id="cbn-again">Color it again</button></div>';
    $('#studio').appendChild(done);
    $('#cbn-next').onclick = findNext;
    $('#cbn-gallery').onclick = function () { $('#cbn-done').hidden = true; $('#back').click(); };
    $('#cbn-again').onclick = function () { $('#cbn-done').hidden = true; C.app.engine.clear(); refresh(); };
  }
  function cmapCanvas(page, cb) {
    var c = document.createElement('canvas'); c.width = S; c.height = T; var im = new Image();
    im.onload = function () { var x = c.getContext('2d'); if (page.cmapFit) { x.drawImage(im, page.cmapFit[0], page.cmapFit[1], page.cmapFit[2], page.cmapFit[3]); } else x.drawImage(im, 0, 0, S, T); cb(c); };
    im.onerror = function () { cb(null); };
    im.src = page.cmap.indexOf('data:') === 0 ? page.cmap : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(page.cmap);
  }
  C.start = function (app, page, cb) {
    C.app = app; S = app.engine.W; T = app.engine.H; ensureLayers();
    ['cbn-hl', 'cbn-num'].forEach(function (id) { var c = $('#' + id); if (c.width !== S || c.height !== T) { c.width = S; c.height = T; } });
    var E = app.engine, easy = document.body.classList.contains('easy');
    var t0 = performance.now(), L = label(E.barrier);
    var go = function (cm) {
      if (cm) { L.regs.forEach(function (r) { r.cm = true; }); sampleCmap(cm, L.lab, L.regs); }
      placeNumbers(L.lab, L.regs);
      var P = buildPalette(cm ? page : { cpal: null }, L.regs, easy);
      C.on = true; C.page = page; C.lab = L.lab; C.regs = L.regs; C.areas = P.areas; C.colors = P.colors; C.sel = 1; C.easy = easy;
      C.ms = Math.round(performance.now() - t0);
      document.body.classList.add('cbn'); $('#cbn-bar').hidden = false; $('#cbn-num').style.opacity = 1;
      renderBar(); select(1); refresh(); app.setTool('fill');
      // fit the page above the number bar
      var v = app.view, vr = $('#viewport').getBoundingClientRect(), br = $('#cbn-bar').getBoundingClientRect(), bh = Math.max(0, vr.bottom - br.top + 8), sc = Math.min(vr.width / S, (vr.height - bh) / T) * 0.94;
      if (sc > 0.1) { v.scale = sc; v.x = (vr.width - S * sc) / 2; v.y = Math.max(8, (vr.height - bh - T * sc) / 2); v.panBy(0, 0); }
      cb && cb();
    };
    if (page.cmap) cmapCanvas(page, go); else go(null);
  };
  C.stop = function () { if (!C.on) return; C.on = false; document.body.classList.remove('cbn', 'cbn-reveal'); $('#cbn-bar').hidden = true; $('#cbn-done').hidden = true;
    ['cbn-hl', 'cbn-num'].forEach(function (id) { var c = $('#' + id); c.getContext('2d').clearRect(0, 0, S, T); }); };
  function renderBar() {
    var el = $('#cbn-sw'); el.innerHTML = '';
    C.colors.forEach(function (c, i) { var n = i + 1, b = document.createElement('button'); b.className = 'cbn-c'; b.dataset.n = n; b.style.background = c;
      b.style.color = lum(rgb(c)) > 150 ? '#222' : '#fff'; b.innerHTML = '<span>' + n + '</span>'; b.onclick = function () { select(n); }; el.appendChild(b); });
  }
  function select(n) { C.sel = n; C.app.setColor(C.colors[n - 1]); document.querySelectorAll('.cbn-c').forEach(function (b) { b.classList.toggle('on', +b.dataset.n === n); b.setAttribute('aria-pressed', +b.dataset.n === n); }); drawHighlight(); }
  C.select = select;
  /* an area counts as done when its number point holds its target color in the paint layer */
  function isDone(r, d) { var o = (r.by * S + r.bx) * 4; return d[o + 3] > 200 && Math.abs(d[o] - r.rgb[0]) + Math.abs(d[o + 1] - r.rgb[1]) + Math.abs(d[o + 2] - r.rgb[2]) < 24; }
  function refresh() {
    if (!C.on) return; var d = C.app.engine.pctx.getImageData(0, 0, S, T).data, done = 0, left = {};
    C.areas.forEach(function (r) { r.done = isDone(r, d); if (r.done) done++; else left[r.num] = (left[r.num] || 0) + 1; });
    C.done = done;
    $('#cbn-count').textContent = done + ' / ' + C.areas.length + ' areas';
    $('#cbn-fill').style.width = (100 * done / C.areas.length) + '%';
    document.querySelectorAll('.cbn-c').forEach(function (b) { var n = +b.dataset.n, l = left[n] || 0; b.classList.toggle('done', !l);
      b.setAttribute('aria-label', 'Number ' + n + ', ' + (l ? l + ' left' : 'all done')); b.title = l ? l + ' left' : 'All done'; });
    drawNumbers(); drawHighlight();
    if (done === C.areas.length && C.areas.length && !C.revealing) reveal();
  }
  C.refresh = refresh;
  function drawNumbers() {
    var x = $('#cbn-num').getContext('2d'); x.clearRect(0, 0, S, T); x.textAlign = 'center'; x.textBaseline = 'middle';
    var big = C.easy ? 1.35 : 1, bt = document.body.classList.contains('bigtext') ? 1.2 : 1;
    C.areas.forEach(function (r) { if (r.done) return;
      var fs = Math.max(11, Math.min(46 * big * bt, r.rad * 1.1 * big * bt));
      if (r.rad < 6) { x.fillStyle = '#6a6a6a'; x.beginPath(); x.arc(r.bx, r.by, 2.5, 0, 7); x.fill(); return; }
      x.font = '600 ' + Math.round(fs) + 'px system-ui, sans-serif'; x.lineWidth = Math.max(3, fs / 5); x.strokeStyle = 'rgba(255,255,255,.95)'; x.fillStyle = r.num === C.sel ? '#1d4f91' : '#4a4a4a';
      x.strokeText(r.num, r.bx, r.by); x.fillText(r.num, r.bx, r.by); });
  }
  function drawHighlight() {
    var cv = $('#cbn-hl'), x = cv.getContext('2d'), img = x.createImageData(S, T), d = img.data, lab = C.lab, want = {};
    C.areas.forEach(function (r) { if (r.num === C.sel && !r.done) want[r.id] = 1; });
    for (var i = 0; i < S * T; i++) { var l = lab[i]; if (l >= 0 && want[l]) { var o = i * 4, s = ((i % S) + ((i / S) | 0)) % 14 < 7; d[o] = 70; d[o + 1] = 130; d[o + 2] = 220; d[o + 3] = s ? 95 : 45; } }
    x.putImageData(img, 0, 0);
  }
  function nearestMatching(x, y, R) { // Easy mode: the closest area with the chosen number
    for (var r = 0; r <= R; r += 2) for (var a = 0; a < 16; a++) { var xx = Math.round(x + Math.cos(a * Math.PI / 8) * r), yy = Math.round(y + Math.sin(a * Math.PI / 8) * r);
      if (xx < 0 || yy < 0 || xx >= S || yy >= T) continue; var l = C.lab[yy * S + xx]; if (l >= 0 && C.regs[l].num === C.sel && !C.regs[l].done) return [xx, yy]; }
    return null;
  }
  /* called instead of engine.fill while the mode is on */
  C.tap = function (x, y, origFill) {
    var E = C.app.engine; x = x | 0; y = y | 0; var l = C.lab[y * S + x];
    if (l < 0 || l === undefined) { var n0 = E.nearestOpen(x, y, E.forgive || 6); if (n0) { x = n0[0]; y = n0[1]; l = C.lab[y * S + x]; } }
    var r = l >= 0 ? C.regs[l] : null;
    if ((!r || r.num !== C.sel) && C.easy) { var m = nearestMatching(x, y, 70); if (m) { x = m[0]; y = m[1]; r = C.regs[C.lab[y * S + x]]; } }
    if (!r) return false;
    if (!r.num) { C.app.toast('This tiny spot fills in by itself at the end.'); return true; }
    if (r.num !== C.sel) { wiggle(r); C.app.toast('This area is number ' + r.num + '. Tap ' + r.num + ' below to choose it.'); C.wrong = (C.wrong || 0) + 1; return true; }
    var ok = origFill(x, y, { color: r.hex, mode: 'solid' });
    return ok;
  };
  function wiggle(r) { var cv = $('#cbn-num'); cv.classList.remove('wiggle'); void cv.offsetWidth; cv.classList.add('wiggle');
    var x = $('#cbn-hl').getContext('2d'); x.save(); x.strokeStyle = 'rgba(230,120,60,.9)'; x.lineWidth = 6; x.beginPath(); x.arc(r.bx, r.by, Math.max(18, r.rad), 0, 7); x.stroke(); x.restore();
    setTimeout(drawHighlight, 700); }
  function findNext() {
    var r = C.areas.filter(function (a) { return !a.done && a.num === C.sel; })[0] || C.areas.filter(function (a) { return !a.done; })[0]; if (!r) return;
    if (r.num !== C.sel) select(r.num);
    var v = C.app.view; v.scale = Math.max(v.scale, 1); var vp = $('#viewport').getBoundingClientRect();
    v.x = vp.width / 2 - r.bx * v.scale; v.y = vp.height / 2 - r.by * v.scale; v.panBy(0, 0);
    C.lastNext = r;
  }
  /* gentle reveal: tiny leftovers get their color, numbers fade, the picture softly blooms */
  function reveal() {
    C.revealing = true; var E = C.app.engine, img = E.pctx.getImageData(0, 0, S, T), d = img.data, lab = C.lab;
    var tiny = {}; C.regs.forEach(function (r) { if (r.num) return; // tiny or uncolored areas: borrow the nearest numbered neighbour's color
      var best = null, bd = Infinity; C.areas.forEach(function (a) { var dd = (a.cx - r.cx) * (a.cx - r.cx) + (a.cy - r.cy) * (a.cy - r.cy); if (dd < bd) { bd = dd; best = a; } }); if (best && r.n < 4000) tiny[r.id] = best.rgb; });
    for (var i = 0; i < S * T; i++) { var t = tiny[lab[i]]; if (t && d[i * 4 + 3] < 10) { d[i * 4] = t[0]; d[i * 4 + 1] = t[1]; d[i * 4 + 2] = t[2]; d[i * 4 + 3] = 255; } }
    E.pctx.putImageData(img, 0, 0);
    document.body.classList.add('cbn-reveal');
    var ids = window.Still.store.get('cbn-done', []); if (ids.indexOf(C.page.id) < 0) { ids.push(C.page.id); window.Still.store.set('cbn-done', ids); }
    setTimeout(function () { $('#cbn-done').hidden = false; $('#cbn-gallery').focus(); C.revealing = false; }, 3200);
  }
  C.isDoneId = function (id) { return window.Still.store.get('cbn-done', []).indexOf(id) >= 0; };
  window.Still = window.Still || {}; window.Still.CBN = C;
})();
