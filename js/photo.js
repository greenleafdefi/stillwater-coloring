/* Photo → coloring page converter (v4, "precise"). Runs fully in the browser; nothing is uploaded.
   Heavy work runs in a Web Worker (made from this same code), with a same-thread fallback.
   Pipeline: LAB → CLAHE (local contrast on lightness) → Kuwahara edge-preserving smoothing →
   region styles: k-means in LAB (12–24 colors) → mode filter → merge small regions into the closest color
   (Portrait: skin-aware, shading on faces merges, eyes/brows/lips are kept) → region borders;
   line styles: Canny with hysteresis (Clean outline) or XDoG (Sketch) + coarse tone borders →
   clean-up: remove specks, close gaps, absorb tiny holes, thin to 1 px (Zhang-Suen), link line ends,
   then draw every line at one even width. */
window.Still = window.Still || {};
function stillPhotoCore() {
  function lab(d, n) { // sRGB → CIELAB (D65)
    var L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), lut = new Float32Array(256), i;
    for (i = 0; i < 256; i++) { var c = i / 255; lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
    for (i = 0; i < n; i++) { var r = lut[d[i * 4]], g = lut[d[i * 4 + 1]], b = lut[d[i * 4 + 2]];
      var x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      L[i] = 116 * y - 16; A[i] = 500 * (x - y); B[i] = 200 * (y - z); }
    return [L, A, B];
  }
  function clahe(L, w, h, tiles, clip) { // contrast-limited adaptive histogram equalization on L (0..100)
    var tw = w / tiles, th = h / tiles, maps = [], tx, ty, i, x, y;
    for (ty = 0; ty < tiles; ty++) for (tx = 0; tx < tiles; tx++) {
      var hist = new Float32Array(256), x0 = Math.floor(tx * tw), x1 = Math.floor((tx + 1) * tw), y0 = Math.floor(ty * th), y1 = Math.floor((ty + 1) * th), cnt = 0;
      for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) { hist[Math.min(255, Math.max(0, L[y * w + x] * 2.55 | 0))]++; cnt++; }
      var lim = Math.max(1, clip * cnt / 256), ex = 0; for (i = 0; i < 256; i++) if (hist[i] > lim) { ex += hist[i] - lim; hist[i] = lim; }
      var add = ex / 256, m = new Float32Array(256), acc = 0; for (i = 0; i < 256; i++) { acc += hist[i] + add; m[i] = acc / Math.max(1, cnt) * 100; }
      maps.push(m); }
    var o = new Float32Array(L.length);
    for (y = 0; y < h; y++) { var fy = y / th - 0.5, ya = Math.max(0, Math.floor(fy)), yb = Math.min(tiles - 1, ya + 1), wy = Math.min(1, Math.max(0, fy - ya));
      for (x = 0; x < w; x++) { var fx = x / tw - 0.5, xa = Math.max(0, Math.floor(fx)), xb = Math.min(tiles - 1, xa + 1), wx = Math.min(1, Math.max(0, fx - xa));
        var p = y * w + x, v = Math.min(255, Math.max(0, L[p] * 2.55 | 0));
        var t = (maps[ya * tiles + xa][v] * (1 - wx) + maps[ya * tiles + xb][v] * wx) * (1 - wy) + (maps[yb * tiles + xa][v] * (1 - wx) + maps[yb * tiles + xb][v] * wx) * wy;
        o[p] = L[p] * 0.35 + t * 0.65; } }
    return o;
  }
  function integral(a, w, h, sq) { var W = w + 1, I = new Float64Array(W * (h + 1));
    for (var y = 0; y < h; y++) { var row = 0; for (var x = 0; x < w; x++) { var v = a[y * w + x]; row += sq ? v * v : v; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; } } return I; }
  function kuwahara(ch, w, h, r) { // ch = [L,A,B]; picks the calmest quadrant (by L variance) → edges stay sharp
    var W = w + 1, IL = integral(ch[0], w, h), IQ = integral(ch[0], w, h, true), IA = integral(ch[1], w, h), IB = integral(ch[2], w, h);
    var o = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
    function box(I, x0, y0, x1, y1) { return I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]; }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var best = 1e18, bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
      for (var q = 0; q < 4; q++) { var x0 = q & 1 ? x : Math.max(0, x - r), x1 = q & 1 ? Math.min(w, x + r + 1) : x + 1, y0 = q & 2 ? y : Math.max(0, y - r), y1 = q & 2 ? Math.min(h, y + r + 1) : y + 1;
        var n = (x1 - x0) * (y1 - y0), s = box(IL, x0, y0, x1, y1), v = box(IQ, x0, y0, x1, y1) / n - (s / n) * (s / n);
        if (v < best) { best = v; bx0 = x0; by0 = y0; bx1 = x1; by1 = y1; } }
      var nn = (bx1 - bx0) * (by1 - by0), p = y * w + x;
      o[0][p] = box(IL, bx0, by0, bx1, by1) / nn; o[1][p] = box(IA, bx0, by0, bx1, by1) / nn; o[2][p] = box(IB, bx0, by0, bx1, by1) / nn; }
    return o;
  }
  function blur(a, w, h, sigma) { var r = Math.max(1, Math.ceil(sigma * 2.5)), k = new Float32Array(2 * r + 1), s = 0, i, x, y, j;
    for (i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; } for (i = 0; i < k.length; i++) k[i] /= s;
    var t = new Float32Array(a.length), o = new Float32Array(a.length);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var acc = 0; for (j = -r; j <= r; j++) { var xx = x + j; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx; acc += a[y * w + xx] * k[j + r]; } t[y * w + x] = acc; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var ac = 0; for (j = -r; j <= r; j++) { var yy = y + j; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy; ac += t[yy * w + x] * k[j + r]; } o[y * w + x] = ac; }
    return o; }
  function xdog(L, w, h, sigma, thrPct) { // extended difference of Gaussians, dark lines only
    var a = blur(L, w, h, sigma), b = blur(L, w, h, sigma * 1.6), d = new Float32Array(L.length), vals = [], i;
    for (i = 0; i < L.length; i++) { d[i] = b[i] - 0.98 * a[i] - 0.02 * b[i]; if (i % 7 === 0) vals.push(d[i]); }
    vals.sort(function (p, q) { return p - q; }); var thr = Math.max(0.6, vals[Math.floor(vals.length * thrPct)]), ink = new Uint8Array(L.length);
    for (i = 0; i < L.length; i++) if (d[i] > thr) ink[i] = 1; return ink; }
  function canny(L, w, h, sigma, hiPct) {
    var b = blur(L, w, h, sigma), mag = new Float32Array(w * h), dir = new Uint8Array(w * h), x, y, i;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) { i = y * w + x;
      var gx = -b[i - w - 1] - 2 * b[i - 1] - b[i + w - 1] + b[i - w + 1] + 2 * b[i + 1] + b[i + w + 1], gy = -b[i - w - 1] - 2 * b[i - w] - b[i - w + 1] + b[i + w - 1] + 2 * b[i + w] + b[i + w + 1];
      mag[i] = Math.sqrt(gx * gx + gy * gy); var an = Math.atan2(gy, gx) * 57.2958; if (an < 0) an += 180;
      dir[i] = an < 22.5 || an >= 157.5 ? 0 : an < 67.5 ? 1 : an < 112.5 ? 2 : 3; }
    var nms = new Float32Array(w * h), off = [[1, 0], [1, 1], [0, 1], [-1, 1]], vals = [];
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) { i = y * w + x; var o = off[dir[i]], m = mag[i];
      if (m >= mag[i + o[1] * w + o[0]] && m >= mag[i - o[1] * w - o[0]]) { nms[i] = m; if (m > 0 && i % 3 === 0) vals.push(m); } }
    vals.sort(function (p, q) { return p - q; }); var hi = vals[Math.floor(vals.length * hiPct)] || 1, lo = hi * 0.4, ink = new Uint8Array(w * h), st = [];
    for (i = 0; i < nms.length; i++) if (nms[i] >= hi && !ink[i]) { ink[i] = 1; st.push(i);
      while (st.length) { var p = st.pop(), px = p % w, py = (p / w) | 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var q = (py + dy) * w + px + dx;
          if (px + dx > 0 && px + dx < w - 1 && py + dy > 0 && py + dy < h - 1 && !ink[q] && nms[q] >= lo) { ink[q] = 1; st.push(q); } } } }
    return ink; }
  function kmeans(ch, n, K, seed) { // LAB k-means on ~15k samples, deterministic
    var S = Math.min(n, 15000), sm = new Float32Array(S * 3), r = seed || 12345, i, k, it;
    function rnd() { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; }
    for (i = 0; i < S; i++) { var p = Math.floor(rnd() * n); sm[i * 3] = ch[0][p]; sm[i * 3 + 1] = ch[1][p]; sm[i * 3 + 2] = ch[2][p]; }
    var C = new Float32Array(K * 3), dmin = new Float32Array(S).fill(1e9); C.set(sm.subarray(0, 3));
    for (k = 1; k < K; k++) { var far = 0, fi = 0; for (i = 0; i < S; i++) { var e = (sm[i * 3] - C[k * 3 - 3]) ** 2 + (sm[i * 3 + 1] - C[k * 3 - 2]) ** 2 + (sm[i * 3 + 2] - C[k * 3 - 1]) ** 2; if (e < dmin[i]) dmin[i] = e; if (dmin[i] > far) { far = dmin[i]; fi = i; } }
      C[k * 3] = sm[fi * 3]; C[k * 3 + 1] = sm[fi * 3 + 1]; C[k * 3 + 2] = sm[fi * 3 + 2]; }
    var as = new Uint8Array(S);
    for (it = 0; it < 12; it++) { var acc = new Float64Array(K * 4);
      for (i = 0; i < S; i++) { var bd = 1e18, bk = 0; for (k = 0; k < K; k++) { var d = (sm[i * 3] - C[k * 3]) ** 2 + (sm[i * 3 + 1] - C[k * 3 + 1]) ** 2 + (sm[i * 3 + 2] - C[k * 3 + 2]) ** 2; if (d < bd) { bd = d; bk = k; } }
        as[i] = bk; acc[bk * 4] += sm[i * 3]; acc[bk * 4 + 1] += sm[i * 3 + 1]; acc[bk * 4 + 2] += sm[i * 3 + 2]; acc[bk * 4 + 3]++; }
      for (k = 0; k < K; k++) if (acc[k * 4 + 3]) { C[k * 3] = acc[k * 4] / acc[k * 4 + 3]; C[k * 3 + 1] = acc[k * 4 + 1] / acc[k * 4 + 3]; C[k * 3 + 2] = acc[k * 4 + 2] / acc[k * 4 + 3]; } }
    var lbl = new Uint8Array(n);
    for (i = 0; i < n; i++) { var b0 = 1e18, b1 = 0, l = ch[0][i], a = ch[1][i], bb = ch[2][i]; for (k = 0; k < K; k++) { var dd = (l - C[k * 3]) ** 2 + (a - C[k * 3 + 1]) ** 2 + (bb - C[k * 3 + 2]) ** 2; if (dd < b0) { b0 = dd; b1 = k; } } lbl[i] = b1; }
    return lbl;
  }
  function modeFilter(l, w, h, K) { var o = new Uint8Array(l.length), cnt = new Uint8Array(K);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var c = l[y * w + x], best = c, bc = 0, dy, dx;
      for (dy = -1; dy <= 1; dy++) { var yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy; for (dx = -1; dx <= 1; dx++) { var xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx, v = l[yy * w + xx]; cnt[v]++; } }
      for (dy = -1; dy <= 1; dy++) { yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy; for (dx = -1; dx <= 1; dx++) { xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx; v = l[yy * w + xx]; if (cnt[v] > bc || cnt[v] === bc && v === c) { bc = cnt[v]; best = v; } cnt[v] = 0; } }
      o[y * w + x] = best; } return o; }
  function label(arr, w, h) { // 4-connected components of equal values → id map
    var id = new Int32Array(arr.length).fill(-1), st = new Int32Array(arr.length), n = 0;
    for (var s = 0; s < arr.length; s++) { if (id[s] >= 0) continue; var v = arr[s], top = 0; id[s] = n; st[top++] = s;
      while (top) { var p = st[--top], x = p % w;
        if (x > 0 && id[p - 1] < 0 && arr[p - 1] === v) { id[p - 1] = n; st[top++] = p - 1; } if (x < w - 1 && id[p + 1] < 0 && arr[p + 1] === v) { id[p + 1] = n; st[top++] = p + 1; }
        if (p >= w && id[p - w] < 0 && arr[p - w] === v) { id[p - w] = n; st[top++] = p - w; } if (p + w < arr.length && id[p + w] < 0 && arr[p + w] === v) { id[p + w] = n; st[top++] = p + w; } }
      n++; } return { id: id, n: n }; }
  function regionsFromLabels(lbl, ch, skin, w, h, o) { // merge small/similar regions (union-find), return border ink
    var R = label(lbl, w, h), id = R.id, n = R.n, N = w * h, i, k;
    var area = new Float64Array(n), sL = new Float64Array(n), sA = new Float64Array(n), sB = new Float64Array(n), sk = new Float64Array(n), par = new Int32Array(n);
    for (i = 0; i < n; i++) par[i] = i;
    for (i = 0; i < N; i++) { k = id[i]; area[k]++; sL[k] += ch[0][i]; sA[k] += ch[1][i]; sB[k] += ch[2][i]; if (skin && skin[i]) sk[k]++; }
    var adj = []; for (i = 0; i < n; i++) adj.push([]);
    for (i = 0; i < N; i++) { var a = id[i]; if (i % w < w - 1 && id[i + 1] !== a) { adj[a].push(id[i + 1]); adj[id[i + 1]].push(a); } if (i + w < N && id[i + w] !== a) { adj[a].push(id[i + w]); adj[id[i + w]].push(a); } }
    function find(x) { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }
    function dE(a, b) { return Math.sqrt((sL[a] / area[a] - sL[b] / area[b]) ** 2 + (sA[a] / area[a] - sA[b] / area[b]) ** 2 + (sB[a] / area[a] - sB[b] / area[b]) ** 2); }
    function union(a, b) { // b into a
      par[b] = a; area[a] += area[b]; sL[a] += sL[b]; sA[a] += sA[b]; sB[a] += sB[b]; sk[a] += sk[b]; adj[a] = adj[a].concat(adj[b]); adj[b] = null; }
    function neighbours(r) { var s = {}, out = [], l = adj[r]; for (var j = 0; j < l.length; j++) { var q = find(l[j]); if (q !== r && !s[q]) { s[q] = 1; out.push(q); } } adj[r] = out; return out; }
    var minA = o.minArea, order = [];
    for (var pass = 0; pass < 6; pass++) { var changed = 0; order.length = 0;
      for (i = 0; i < n; i++) if (par[i] === i) order.push(i); order.sort(function (p, q) { return area[p] - area[q]; });
      for (var oi = 0; oi < order.length; oi++) { var r = order[oi]; if (par[r] !== r) continue;
        var isSkin = sk[r] / area[r] > 0.5, nb = neighbours(r), best = -1, bd = 1e9;
        for (var j = 0; j < nb.length; j++) { var d = dE(r, nb[j]); if (d < bd) { bd = d; best = nb[j]; } }
        if (best < 0) continue;
        var lim = minA; if (o.portrait && isSkin) lim = bd > 22 ? minA * 0.35 : minA * 2.6; // keep eyes/brows/lips, merge face shading
        var simLim = o.portrait && isSkin ? 11 : o.similar;
        if (area[r] < lim || bd < simLim && area[r] < minA * 8) { if (area[best] >= area[r]) union(best, r); else union(r, best); changed++; } }
      if (!changed) break; }
    var ink = new Uint8Array(N), fin = new Int32Array(N);
    for (i = 0; i < N; i++) fin[i] = find(id[i]);
    for (i = 0; i < N; i++) { if (i % w < w - 1 && fin[i] !== fin[i + 1]) ink[i] = 1; if (i + w < N && fin[i] !== fin[i + w]) ink[i] = 1; }
    return ink; }
  function skinMask(d, n) { var m = new Uint8Array(n);
    for (var i = 0; i < n; i++) { var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], y = 0.299 * r + 0.587 * g + 0.114 * b, cr = (r - y) * 0.713 + 128, cb = (b - y) * 0.564 + 128;
      if (y > 50 && cr > 136 && cr < 178 && cb > 80 && cb < 130 && r > g && r > b) m[i] = 1; } return m; }
  function dilate(ink, w, h, r) { if (r <= 0) return ink; var o = new Uint8Array(ink.length), offs = [];
    for (var dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (var dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) if (dx * dx + dy * dy <= r * r + 0.5) offs.push(dx, dy);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { if (!ink[y * w + x]) continue;
      for (var k = 0; k < offs.length; k += 2) { var xx = x + offs[k], yy = y + offs[k + 1]; if (xx >= 0 && yy >= 0 && xx < w && yy < h) o[yy * w + xx] = 1; } } return o; }
  function erode(ink, w, h, r) { var inv = new Uint8Array(ink.length), i; for (i = 0; i < ink.length; i++) inv[i] = ink[i] ? 0 : 1; inv = dilate(inv, w, h, r); for (i = 0; i < ink.length; i++) inv[i] = inv[i] ? 0 : 1; return inv; }
  function frame(ink, w, h) { for (var x = 0; x < w; x++) { ink[x] = ink[(h - 1) * w + x] = 1; } for (var y = 0; y < h; y++) { ink[y * w] = ink[y * w + w - 1] = 1; } }
  function comps(arr, w, h, val, fn) { var seen = new Uint8Array(arr.length), st = new Int32Array(arr.length), list = [];
    for (var s = 0; s < arr.length; s++) { if (seen[s] || arr[s] !== val) continue; var top = 0; list = [s]; seen[s] = 1; st[top++] = s;
      while (top) { var p = st[--top], x = p % w, q;
        q = p - 1; if (x > 0 && !seen[q] && arr[q] === val) { seen[q] = 1; st[top++] = q; list.push(q); } q = p + 1; if (x < w - 1 && !seen[q] && arr[q] === val) { seen[q] = 1; st[top++] = q; list.push(q); }
        q = p - w; if (q >= 0 && !seen[q] && arr[q] === val) { seen[q] = 1; st[top++] = q; list.push(q); } q = p + w; if (q < arr.length && !seen[q] && arr[q] === val) { seen[q] = 1; st[top++] = q; list.push(q); } }
      fn(list); } }
  function thin(ink, w, h) { // Zhang-Suen; keeps 8-connectivity, then link4 restores leak-proof 4-connectivity
    var del = [], it = 0, changed = true;
    while (changed && it++ < 40) { changed = false;
      for (var step = 0; step < 2; step++) { del.length = 0;
        for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) { var p = y * w + x; if (!ink[p]) continue;
          var p2 = ink[p - w], p3 = ink[p - w + 1], p4 = ink[p + 1], p5 = ink[p + w + 1], p6 = ink[p + w], p7 = ink[p + w - 1], p8 = ink[p - 1], p9 = ink[p - w - 1];
          var B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9; if (B < 2 || B > 6) continue;
          var A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2); if (A !== 1) continue;
          if (step === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue; del.push(p); }
        for (var k = 0; k < del.length; k++) ink[del[k]] = 0; if (del.length) changed = true; } }
    return ink; }
  function link4(ink, w, h) { for (var y = 0; y < h - 1; y++) for (var x = 0; x < w; x++) { var p = y * w + x; if (!ink[p]) continue;
      if (x < w - 1 && ink[p + w + 1] && !ink[p + 1] && !ink[p + w]) ink[p + 1] = 1; if (x > 0 && ink[p + w - 1] && !ink[p - 1] && !ink[p + w]) ink[p - 1] = 1; } return ink; }
  function linkEnds(ink, w, h, maxGap) { // extend loose line ends forward until they meet another line (closes gaps)
    var ends = [], y, x, p;
    for (y = 2; y < h - 2; y++) for (x = 2; x < w - 2; x++) { p = y * w + x; if (!ink[p]) continue; var c = 0, nx = 0, ny = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) if ((dx || dy) && ink[p + dy * w + dx]) { c++; nx = dx; ny = dy; }
      if (c === 1) ends.push(x, y, -nx, -ny); }
    var linked = 0;
    for (var e = 0; e < ends.length; e += 4) { var ex = ends[e], ey = ends[e + 1], bx = ends[e + 2], by = ends[e + 3], hit = -1, ba = 0;
      // look along the line direction (±35°), skipping its own first pixels
      for (var a = -0.6; a <= 0.61 && hit < 0; a += 0.3) { var ca = Math.cos(a), sa = Math.sin(a), vx = bx * ca - by * sa, vy = bx * sa + by * ca, L = Math.hypot(vx, vy); vx /= L; vy /= L;
        for (var s = 3; s <= maxGap; s++) { var qx = Math.round(ex + vx * s), qy = Math.round(ey + vy * s); if (qx < 0 || qy < 0 || qx >= w || qy >= h) break; if (ink[qy * w + qx]) { hit = s; ba = a; break; } } }
      if (hit > 0) { var cA = Math.cos(ba), sA = Math.sin(ba), ux = bx * cA - by * sA, uy = bx * sA + by * cA, LL = Math.hypot(ux, uy);
        for (var t = 1; t < hit; t++) ink[Math.round(ey + uy / LL * t) * w + Math.round(ex + ux / LL * t)] = 1; linked++; } }
    return linked; }
  /* rgba: Uint8ClampedArray w*h*4. opts: style outline|sketch|mosaic|portrait, detail 1-10, thickness 1-5, simplify 0-10, regions bool */
  function run(rgba, w, h, opts) {
    var t0 = Date.now(), n = w * h, det = opts.detail, simp = opts.simplify, sc = Math.max(w, h) / 1000, i, st = opts.style;
    var ch = lab(rgba, n); ch[0] = clahe(ch[0], w, h, 8, st === 'portrait' ? 2.0 : 2.6);
    var rk = Math.max(1, Math.round((1.2 + simp * 0.35 - det * 0.08) * sc + 0.4)), sm = kuwahara(ch, w, h, rk);
    if (simp >= 6) sm = kuwahara(sm, w, h, rk);
    var ink, skin = st === 'portrait' ? skinMask(rgba, n) : null, minArea = n * (0.0021 - det * 0.00016) * (1 + simp * 0.12);
    if (st === 'mosaic' || st === 'portrait') {
      var K = Math.round(10 + det * 1.4); var lbl = kmeans(sm, n, K, 777);
      for (i = 0; i < 2 + Math.round(simp / 3); i++) lbl = modeFilter(lbl, w, h, K);
      ink = regionsFromLabels(lbl, sm, skin, w, h, { minArea: minArea, similar: 4 + simp * 0.6, portrait: st === 'portrait' });
      if (st === 'portrait') { // fine facial feature lines (eyes, nose, mouth) from XDoG, only long strokes
        var xd = xdog(sm[0], w, h, 1.0 * sc + 0.4, 0.955 - det * 0.002);
        comps(xd, w, h, 1, function (l) { if (l.length < 40 * sc) for (var j = 0; j < l.length; j++) xd[l[j]] = 0; });
        for (i = 0; i < n; i++) ink[i] |= xd[i]; }
    } else {
      ink = st === 'sketch' ? xdog(sm[0], w, h, (1.6 - det * 0.08) * sc + 0.4, 0.93 - det * 0.012) : canny(sm[0], w, h, (1.6 - det * 0.09) * sc + 0.5, 0.92 - det * 0.022);
      var cl = kmeans(sm, n, opts.regions ? Math.max(6, det + 2) : 5, 99); for (i = 0; i < 4; i++) cl = modeFilter(cl, w, h, 24);
      var cb = regionsFromLabels(cl, sm, null, w, h, { minArea: n * 0.006, similar: 6 }); for (i = 0; i < n; i++) ink[i] |= cb[i];
    }
    link4(ink, w, h); var minSpeck = (8 + simp * 6) * sc; comps(ink, w, h, 1, function (l) { if (l.length < minSpeck) for (var j = 0; j < l.length; j++) ink[l[j]] = 0; });
    frame(ink, w, h);
    var g = Math.max(1, Math.round((st === 'sketch' ? 2 : 1) * sc)); ink = erode(dilate(ink, w, h, g), w, h, g); frame(ink, w, h);
    var minHole = n * 0.00012 * (1 + simp * 0.3); comps(ink, w, h, 0, function (l) { if (l.length < minHole) for (var j = 0; j < l.length; j++) ink[l[j]] = 1; });
    ink = thin(ink, w, h); frame(ink, w, h);
    var linked = linkEnds(ink, w, h, Math.round(10 * sc + 4)); link4(ink, w, h);
    comps(ink, w, h, 1, function (l) { if (l.length < 12 * sc) for (var j = 0; j < l.length; j++) ink[l[j]] = 0; }); frame(ink, w, h);
    link4(ink, w, h);
    var regions = 0, minR = n * 0.00012; comps(ink, w, h, 0, function (l) { if (l.length >= minR) regions++; else for (var j = 0; j < l.length; j++) ink[l[j]] = 1; });
    ink = thin(ink, w, h); link4(ink, w, h); frame(ink, w, h);
    var rad = (0.6 + opts.thickness * 0.75) * sc * 1.12; ink = dilate(ink, w, h, rad);
    return { ink: ink, w: w, h: h, regions: regions, linked: linked, ms: Date.now() - t0 };
  }
  return { run: run };
}
Still.PhotoCore = stillPhotoCore(); Still.PhotoCore.__src = stillPhotoCore.toString();
Still.Photo = (function () {
  function toWork(img, W) { var s = Math.min(1, W / Math.max(img.width, img.height)), w = Math.max(8, Math.round(img.width * s)), h = Math.max(8, Math.round(img.height * s));
    var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h); return { w: w, h: h, data: x.getImageData(0, 0, w, h).data }; }
  function render(r) { // ink → antialiased 1200×1200 line page with frame
    var w = r.w, h = r.h, c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d'), id = x.createImageData(w, h), ink = r.ink;
    for (var i = 0; i < ink.length; i++) if (ink[i]) { id.data[i * 4] = 43; id.data[i * 4 + 1] = 43; id.data[i * 4 + 2] = 51; id.data[i * 4 + 3] = 255; }
    x.putImageData(id, 0, 0);
    var S = 1200, m2 = 40, out = document.createElement('canvas'); out.width = out.height = S; var ox = out.getContext('2d');
    var sc = Math.min((S - 2 * m2) / w, (S - 2 * m2) / h), dw = w * sc, dh = h * sc;
    ox.imageSmoothingEnabled = true; ox.imageSmoothingQuality = 'high'; ox.drawImage(c, (S - dw) / 2, (S - dh) / 2, dw, dh);
    ox.strokeStyle = '#2b2b33'; ox.lineWidth = 4; ox.strokeRect(16, 16, S - 32, S - 32);
    return { canvas: out, regions: r.regions, fit: [(S - dw) / 2, (S - dh) / 2, dw, dh], ms: r.ms, size: [w, h] };
  }
  function convert(img, opts) { var W = opts.work || 1120, s = toWork(img, W); return render(Still.PhotoCore.run(s.data, s.w, s.h, opts)); }
  var worker = null, seq = 0, waiting = {};
  function getWorker() {
    if (worker !== null) return worker;
    try { var src = 'var Still={};Still.PhotoCore=(' + Still.PhotoCore.__src + ')();self.onmessage=function(e){var m=e.data,r=Still.PhotoCore.run(m.data,m.w,m.h,m.opts);self.postMessage({id:m.id,ink:r.ink,w:r.w,h:r.h,regions:r.regions,linked:r.linked,ms:r.ms},[r.ink.buffer]);};';
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = function (e) { var cb = waiting[e.data.id]; delete waiting[e.data.id]; if (cb) cb.ok(e.data); };
      worker.onerror = function (e) { e.preventDefault && e.preventDefault(); var ws = waiting; waiting = {}; worker = false; for (var k in ws) ws[k].fail(); };
    } catch (err) { worker = false; }
    return worker;
  }
  /* Promise version: runs in a Web Worker so the page stays smooth; falls back to same-thread. */
  function convertAsync(img, opts) {
    var W = opts.work || 1120, s = toWork(img, W), o = {}; for (var k in opts) o[k] = opts[k];
    return new Promise(function (resolve) {
      var wk = getWorker(), sync = function () { setTimeout(function () { var r = render(Still.PhotoCore.run(s.data, s.w, s.h, o)); r.worker = false; resolve(r); }, 30); };
      if (!wk) return sync();
      var id = ++seq; waiting[id] = { ok: function (d) { var r = render(d); r.worker = true; resolve(r); }, fail: sync };
      wk.postMessage({ id: id, data: s.data, w: s.w, h: s.h, opts: o }, [s.data.buffer]);
    });
  }
  return { convert: convert, convertAsync: convertAsync, _core: Still.PhotoCore };
})();
