/* Bring your own line art: clean up an image that is already a black-and-white coloring page
   (an AI-made page, a scan, or a phone picture of a printed page) so it becomes the line layer.
   Steps: grayscale → adaptive threshold (local mean, so uneven paper lighting and shadows are ignored)
   → optional line boost (thicker lines) → close tiny gaps so fills don't leak → remove specks.
   Output: black lines on a transparent canvas at up to 2048 px on the long side, real aspect ratio kept.
   Everything runs on this device. */
(function () {
  var Still = window.Still = window.Still || {};
  var MAX_SIDE = 2048, MAX_PX = 3200000; // phone-safe: at most about 3.2 MP

  function sizeFor(w, h, long) {
    var L = Math.max(w, h), t = long || MAX_SIDE, k = t / L;
    if (w * k * h * k > MAX_PX) k = Math.sqrt(MAX_PX / (w * h));
    return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
  }
  // integral image of a Uint8/Float array (values 0..255 or 0/1)
  function integral(a, w, h) {
    var I = new Float64Array((w + 1) * (h + 1));
    for (var y = 0; y < h; y++) { var row = 0, o = (y + 1) * (w + 1), p = y * (w + 1);
      for (var x = 0; x < w; x++) { row += a[y * w + x]; I[o + x + 1] = I[p + x + 1] + row; } }
    return I;
  }
  function boxSum(I, w, h, x, y, r) {
    var x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1), W1 = w + 1;
    return [I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0], (x1 - x0) * (y1 - y0)];
  }
  // round-ish dilation / erosion with a (2r+1)² box via counts (O(n) for any r)
  function morph(m, w, h, r, dilate) {
    if (r <= 0) return m; var I = integral(m, w, h), o = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var s = boxSum(I, w, h, x, y, r); o[y * w + x] = dilate ? (s[0] > 0 ? 1 : 0) : (s[0] >= s[1] ? 1 : 0); }
    return o;
  }
  // remove ink components smaller than minPx (dust, paper grain, JPEG noise)
  function despeck(m, w, h, minPx) {
    var seen = new Uint8Array(w * h), st = new Int32Array(w * h), comp = new Int32Array(w * h), removed = 0;
    for (var i = 0; i < m.length; i++) if (m[i] && !seen[i]) {
      var sp = 0, cn = 0; st[sp++] = i; seen[i] = 1;
      while (sp) { var k = st[--sp]; comp[cn++] = k; var x = k % w;
        if (x > 0 && m[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; st[sp++] = k - 1; }
        if (x < w - 1 && m[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; st[sp++] = k + 1; }
        if (k >= w && m[k - w] && !seen[k - w]) { seen[k - w] = 1; st[sp++] = k - w; }
        if (k + w < m.length && m[k + w] && !seen[k + w]) { seen[k + w] = 1; st[sp++] = k + w; } }
      if (cn < minPx) { for (var j = 0; j < cn; j++) m[comp[j]] = 0; removed++; }
    }
    return removed;
  }
  // count fillable (non-ink) areas, 4-connected, at least minArea px
  function countAreas(m, w, h, minArea) {
    var seen = new Uint8Array(w * h), st = new Int32Array(w * h), areas = 0;
    for (var i = 0; i < m.length; i++) if (!m[i] && !seen[i]) {
      var sp = 0, cn = 0; st[sp++] = i; seen[i] = 1;
      while (sp) { var k = st[--sp]; cn++; var x = k % w;
        if (x > 0 && !m[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; st[sp++] = k - 1; }
        if (x < w - 1 && !m[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; st[sp++] = k + 1; }
        if (k >= w && !m[k - w] && !seen[k - w]) { seen[k - w] = 1; st[sp++] = k - w; }
        if (k + w < m.length && !m[k + w] && !seen[k + w]) { seen[k + w] = 1; st[sp++] = k + w; } }
      if (cn >= minArea) areas++;
    }
    return areas;
  }
  /* img: HTMLImageElement/canvas. opts: {boost 0..4, long (target long side, for previews)} */
  function process(img, opts) {
    opts = opts || {}; var t0 = performance.now();
    var sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height, wh = sizeFor(sw, sh, opts.long), w = wh[0], h = wh[1], n = w * h;
    var sc = Math.max(w, h) / 2048; // 1 at full size
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h; var x = cv.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h);
    var id = x.getImageData(0, 0, w, h), d = id.data, g = new Uint8Array(n);
    for (var i = 0; i < n; i++) { var p = i * 4; g[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8; }
    // adaptive threshold: a pixel is ink when clearly darker than its neighbourhood (Bradley–Roth),
    // or simply very dark (solid black areas, where the local mean is dark too)
    var I = integral(g, w, h), r = Math.max(8, Math.round(Math.max(w, h) / 48)), k = 0.16, m = new Uint8Array(n);
    for (var y = 0; y < h; y++) for (var xx = 0; xx < w; xx++) { var s = boxSum(I, w, h, xx, y, r), mean = s[0] / s[1], v = g[y * w + xx];
      m[y * w + xx] = (v < mean * (1 - k) && v < 215) || v < 60 ? 1 : 0; }
    despeck(m, w, h, Math.max(4, Math.round(10 * sc * sc)));        // dust first, so it is not thickened
    var boost = Math.max(0, Math.min(4, +opts.boost || 0));
    if (boost) m = morph(m, w, h, Math.round(boost * Math.max(1, sc * 1.5) * 0.75 + 0.25), true);
    var cr = Math.max(1, Math.round(sc * 1.5));                      // close gaps up to about 2–3 px at full size
    m = morph(morph(m, w, h, cr, true), w, h, cr, false);
    despeck(m, w, h, Math.max(6, Math.round(14 * sc * sc)));
    // black lines on a transparent layer (paper shows through); a 1 px soft edge keeps lines smooth
    var out = x.createImageData(w, h), o = out.data, ink = 0;
    for (var q = 0; q < n; q++) { var po = q * 4; o[po] = o[po + 1] = o[po + 2] = 24;
      if (m[q]) { o[po + 3] = 255; ink++; } else { var qx = q % w, nb = (qx > 0 && m[q - 1]) + (qx < w - 1 && m[q + 1]) + (q >= w && m[q - w]) + (q + w < n && m[q + w]); o[po + 3] = nb ? 70 : 0; } }
    var lc = document.createElement('canvas'); lc.width = w; lc.height = h; lc.getContext('2d').putImageData(out, 0, 0);
    var areas = countAreas(m, w, h, Math.round(n * 0.00005) + 20);
    return { canvas: lc, w: w, h: h, areas: areas, ink: ink / n, ms: Math.round(performance.now() - t0) };
  }
  Still.LineArt = { process: process, sizeFor: sizeFor, MAX_SIDE: MAX_SIDE };
})();
