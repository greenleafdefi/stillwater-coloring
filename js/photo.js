/* Photo → coloring page converter. Runs fully in the browser (nothing is uploaded).
   Pipeline: resize → grayscale → edge-preserving smoothing (median + bilateral) →
   edges (Sketch = difference-of-Gaussians, Clean outline = Canny, Mosaic = posterized
   color regions) → clean-up (remove specks, close gaps, absorb tiny regions so every area
   is big enough to fill) → thicken → antialiased 1200×1200 line layer with a frame. */
window.Still = window.Still || {};
Still.Photo = (function () {
  function toWork(img, W) { // fit into W×W (keeps aspect), white padding
    var s = Math.min(W / img.width, W / img.height), w = Math.round(img.width * s), h = Math.round(img.height * s);
    var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d');
    x.drawImage(img, 0, 0, w, h); return { w: w, h: h, data: x.getImageData(0, 0, w, h).data };
  }
  function gray(src) { var n = src.w * src.h, g = new Float32Array(n), d = src.data; for (var i = 0; i < n; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return g; }
  function median3(a, w, h) {
    var o = new Float32Array(a.length), v = new Float32Array(9);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var k = 0; for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var yy = Math.min(h - 1, Math.max(0, y + dy)), xx = Math.min(w - 1, Math.max(0, x + dx)); v[k++] = a[yy * w + xx]; }
      v.sort(); o[y * w + x] = v[4];
    } return o;
  }
  function bilateral(a, w, h, r, sr) { // edge-preserving blur
    var o = new Float32Array(a.length), ss = r * r / 2 + 0.01, inv = 1 / (2 * sr * sr);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var c = a[y * w + x], sum = 0, ws = 0;
      for (var dy = -r; dy <= r; dy++) { var yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (var dx = -r; dx <= r; dx++) { var xx = x + dx; if (xx < 0 || xx >= w) continue;
          var v = a[yy * w + xx], wt = Math.exp(-(dx * dx + dy * dy) / (2 * ss) - (v - c) * (v - c) * inv); sum += v * wt; ws += wt; } }
      o[y * w + x] = sum / ws;
    } return o;
  }
  function blur(a, w, h, sigma) { // separable gaussian
    var r = Math.max(1, Math.ceil(sigma * 2.5)), k = [], s = 0, i;
    for (i = -r; i <= r; i++) { var e = Math.exp(-i * i / (2 * sigma * sigma)); k.push(e); s += e; }
    k = k.map(function (v) { return v / s; });
    var t = new Float32Array(a.length), o = new Float32Array(a.length), x, y, j;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var acc = 0; for (j = -r; j <= r; j++) acc += a[y * w + Math.min(w - 1, Math.max(0, x + j))] * k[j + r]; t[y * w + x] = acc; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var ac = 0; for (j = -r; j <= r; j++) ac += t[Math.min(h - 1, Math.max(0, y + j)) * w + x] * k[j + r]; o[y * w + x] = ac; }
    return o;
  }
  function dog(g, w, h, detail) { // Sketch: difference of Gaussians, dark side only
    var s1 = 2.2 - detail * 0.16, a = blur(g, w, h, s1), b = blur(g, w, h, s1 * 1.6), ink = new Uint8Array(w * h), thr = 5.5 - detail * 0.4;
    for (var i = 0; i < ink.length; i++) if (b[i] - a[i] > thr) ink[i] = 1;
    return ink;
  }
  function canny(g, w, h, detail) {
    var b = blur(g, w, h, 1.8 - detail * 0.1), mag = new Float32Array(w * h), dir = new Uint8Array(w * h), x, y, i, max = 0;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      var gx = -b[i - w - 1] - 2 * b[i - 1] - b[i + w - 1] + b[i - w + 1] + 2 * b[i + 1] + b[i + w + 1];
      var gy = -b[i - w - 1] - 2 * b[i - w] - b[i - w + 1] + b[i + w - 1] + 2 * b[i + w] + b[i + w + 1];
      mag[i] = Math.hypot(gx, gy); if (mag[i] > max) max = mag[i];
      var an = Math.atan2(gy, gx) * 180 / Math.PI; if (an < 0) an += 180;
      dir[i] = an < 22.5 || an >= 157.5 ? 0 : an < 67.5 ? 1 : an < 112.5 ? 2 : 3;
    }
    var nms = new Float32Array(w * h), off = [[1, 0], [1, 1], [0, 1], [-1, 1]];
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) { i = y * w + x; var o = off[dir[i]], m = mag[i];
      if (m >= mag[i + o[1] * w + o[0]] && m >= mag[i - o[1] * w - o[0]]) nms[i] = m; }
    var vals = []; for (i = 0; i < nms.length; i += 3) if (nms[i] > 0) vals.push(nms[i]); vals.sort(function (p, q) { return p - q; });
    var hi = vals[Math.floor(vals.length * (0.93 - detail * 0.045))] || max * 0.3, lo = hi * 0.45, ink = new Uint8Array(w * h), st = [];
    for (i = 0; i < nms.length; i++) if (nms[i] >= hi && !ink[i]) { ink[i] = 1; st.push(i);
      while (st.length) { var p = st.pop(), px = p % w, py = (p / w) | 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var q = (py + dy) * w + px + dx;
          if (px + dx > 0 && px + dx < w - 1 && py + dy > 0 && py + dy < h - 1 && !ink[q] && nms[q] >= lo) { ink[q] = 1; st.push(q); } } } }
    return ink;
  }
  function mosaic(src, w, h, detail, simplify) { // posterize colors into regions, outline them
    var levels = 2 + Math.round(detail * 0.55), d = src.data, lab = new Int32Array(w * h), ch = [], i, c;
    for (c = 0; c < 3; c++) { var a = new Float32Array(w * h); for (i = 0; i < a.length; i++) a[i] = d[i * 4 + c]; a = bilateral(a, w, h, 2, 30); for (var m = 0; m < 1 + simplify; m++) a = median3(a, w, h); ch.push(a); }
    for (i = 0; i < lab.length; i++) lab[i] = Math.floor(ch[0][i] / 256 * levels) * 10000 + Math.floor(ch[1][i] / 256 * levels) * 100 + Math.floor(ch[2][i] / 256 * levels);
    for (var it = 0; it < 2 + simplify; it++) lab = modeFilter(lab, w, h);
    lab = mergeSmall(lab, w, h, Math.round(w * h * (0.0025 + simplify * 0.0006) / Math.max(1, detail / 3)));
    var ink = new Uint8Array(w * h);
    for (var y = 0; y < h - 1; y++) for (var x = 0; x < w - 1; x++) { i = y * w + x; if (lab[i] !== lab[i + 1] || lab[i] !== lab[i + w]) ink[i] = 1; }
    return ink;
  }
  function mergeSmall(lab, w, h, minA) { // fold small same-color patches into their most common neighbour
    for (var pass = 0; pass < 3; pass++) {
      var seen = new Uint8Array(lab.length), st = [];
      for (var s = 0; s < lab.length; s++) { if (seen[s]) continue; var v = lab[s], list = [s]; seen[s] = 1; st.push(s); var nb = {};
        while (st.length) { var p = st.pop(), x = p % w, y = (p / w) | 0, n4 = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
          for (var k = 0; k < 4; k++) { var q = n4[k]; if (q < 0) continue; if (lab[q] === v) { if (!seen[q]) { seen[q] = 1; st.push(q); list.push(q); } } else nb[lab[q]] = (nb[lab[q]] || 0) + 1; } }
        if (list.length < minA) { var best = v, bc = 0; for (var key in nb) if (nb[key] > bc) { bc = nb[key]; best = +key; } for (var i = 0; i < list.length; i++) lab[list[i]] = best; } }
    } return lab;
  }
  function modeFilter(lab, w, h) {
    var o = new Int32Array(lab.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var best = lab[y * w + x], bc = 0, cnt = {};
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var yy = Math.min(h - 1, Math.max(0, y + dy)), xx = Math.min(w - 1, Math.max(0, x + dx)), v = lab[yy * w + xx];
        cnt[v] = (cnt[v] || 0) + 1; if (cnt[v] > bc) { bc = cnt[v]; best = v; } }
      o[y * w + x] = best;
    } return o;
  }
  function dilate(ink, w, h, r) {
    if (r <= 0) return ink; var o = new Uint8Array(ink.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { if (!ink[y * w + x]) continue;
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r + r) continue; var xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) o[yy * w + xx] = 1; } }
    return o;
  }
  function erode(ink, w, h, r) { var inv = new Uint8Array(ink.length); for (var i = 0; i < ink.length; i++) inv[i] = ink[i] ? 0 : 1; inv = dilate(inv, w, h, r); for (i = 0; i < ink.length; i++) inv[i] = inv[i] ? 0 : 1; return inv; }
  /* label connected components of pixels where arr[i]===val; calls fn(list) for each */
  function components(arr, w, h, val, fn) {
    var seen = new Uint8Array(arr.length), st = [];
    for (var s = 0; s < arr.length; s++) { if (seen[s] || arr[s] !== val) continue; var list = [s]; seen[s] = 1; st.push(s);
      while (st.length) { var p = st.pop(), x = p % w, y = (p / w) | 0, nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
        for (var k = 0; k < 4; k++) { var q = nb[k]; if (q >= 0 && !seen[q] && arr[q] === val) { seen[q] = 1; st.push(q); list.push(q); } } }
      fn(list); }
  }
  function link4(ink, w, h) { // make diagonal-only steps 4-connected, so paint can't leak through corners
    for (var y = 0; y < h - 1; y++) for (var x = 0; x < w; x++) { var p = y * w + x; if (!ink[p]) continue;
      if (x < w - 1 && ink[p + w + 1] && !ink[p + 1] && !ink[p + w]) ink[p + 1] = 1;
      if (x > 0 && ink[p + w - 1] && !ink[p - 1] && !ink[p + w]) ink[p - 1] = 1; }
    return ink;
  }
  function clean(ink, w, h, o) {
    var minSpeck = 6 + o.simplify * 8, minRegion = 10 + o.simplify * 6 + (10 - o.detail) * 3, regions = 0;
    ink = link4(ink, w, h);
    components(ink, w, h, 1, function (l) { if (l.length < minSpeck) for (var i = 0; i < l.length; i++) ink[l[i]] = 0; }); // specks
    // frame so the outside is closed, then close small gaps (dilate → erode)
    for (var x = 0; x < w; x++) { ink[x] = ink[(h - 1) * w + x] = 1; } for (var y = 0; y < h; y++) { ink[y * w] = ink[y * w + w - 1] = 1; }
    var g = 1 + Math.round(o.simplify / 5) + (o.style === 'sketch' ? 1 : 0); ink = link4(erode(dilate(ink, w, h, g), w, h, g), w, h);
    for (x = 0; x < w; x++) { ink[x] = ink[(h - 1) * w + x] = 1; } for (y = 0; y < h; y++) { ink[y * w] = ink[y * w + w - 1] = 1; }
    components(ink, w, h, 0, function (l) { if (l.length < minRegion) for (var i = 0; i < l.length; i++) ink[l[i]] = 1; else regions++; }); // absorb tiny areas
    return { ink: ink, regions: regions };
  }
  /* opts: {style:'sketch'|'outline'|'mosaic', detail 1-10, thickness 1-5, simplify 0-10, regions bool, work px} */
  function convert(img, opts) {
    var W = opts.work || 560, src = toWork(img, W), w = src.w, h = src.h, g = gray(src), i;
    for (i = 0; i < Math.ceil(opts.simplify / 3); i++) g = median3(g, w, h);
    g = bilateral(g, w, h, 2, 18 + opts.simplify * 4);
    var ink = opts.style === 'sketch' ? dog(g, w, h, opts.detail) : opts.style === 'outline' ? canny(g, w, h, opts.detail) : mosaic(src, w, h, opts.detail, opts.simplify);
    if (opts.style !== 'mosaic') {
      // Always add a few coarse tone boundaries: separates subject from background (no giant background area)
      // and gives Sketch lines closed shapes to sit in.
      var coarse = mosaic(src, w, h, 1, Math.min(10, opts.simplify + 5)); for (i = 0; i < ink.length; i++) ink[i] |= coarse[i];
      if (opts.regions) { var m = mosaic(src, w, h, Math.max(1, opts.detail - 4), opts.simplify + 1); for (i = 0; i < ink.length; i++) ink[i] |= m[i]; }
    }
    if (opts.style === 'sketch') ink = dilate(ink, w, h, 0);
    opts.style = opts.style; var r = clean(ink, w, h, opts); ink = dilate(r.ink, w, h, opts.thickness - 1);
    // draw at work size, then scale up smoothly to 1200 (soft antialiased edges)
    var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d'), id = x.createImageData(w, h);
    for (i = 0; i < ink.length; i++) if (ink[i]) { id.data[i * 4] = 43; id.data[i * 4 + 1] = 43; id.data[i * 4 + 2] = 51; id.data[i * 4 + 3] = 255; }
    x.putImageData(id, 0, 0);
    var S = 1200, m2 = 40, out = document.createElement('canvas'); out.width = out.height = S; var ox = out.getContext('2d');
    var sc = Math.min((S - 2 * m2) / w, (S - 2 * m2) / h), dw = w * sc, dh = h * sc;
    ox.imageSmoothingEnabled = true; ox.imageSmoothingQuality = 'high'; ox.drawImage(c, (S - dw) / 2, (S - dh) / 2, dw, dh);
    ox.strokeStyle = '#2b2b33'; ox.lineWidth = 4; ox.strokeRect(16, 16, S - 32, S - 32);
    return { canvas: out, regions: r.regions, fit: [(S - dw) / 2, (S - dh) / 2, dw, dh] };
  }
  return { convert: convert, _i: { toWork: toWork, mosaic: mosaic, clean: clean, components: components, link4: link4, dilate: dilate, erode: erode } };
})();
