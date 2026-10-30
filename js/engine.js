/* Painting engine: flood fill, gradient fill, brush, eraser, undo/redo.
   Layers (bottom → top): paper (CSS), paint canvas, live stroke canvas, line-art canvas.
   The line art is never painted on, so lines always stay crisp. */
window.Still = window.Still || {};
Still.Engine = function (paint, live, lines, size) {
  var self = this;
  this.size = size;
  this.paint = paint; this.pctx = paint.getContext('2d', { willReadFrequently: true });
  this.live = live; this.lctx = live.getContext('2d');
  this.lines = lines; this.linectx = lines.getContext('2d', { willReadFrequently: true });
  this.barrier = null;   // Uint8Array: 1 where a line blocks the fill
  this.undoStack = []; this.redoStack = [];
  this.ops = [];          // recorded actions for time-lapse replay
  this.tolerance = 128;   // line-alpha threshold (0-255). Lower = stricter lines.
  this.onChange = function () {};

  this.preloaded = {}; this.preHits = 0;
  this.loadLineArt = function (svg, cb) {
    var img = new Image();
    img.onload = function () {
      self.linectx.clearRect(0, 0, size, size);
      self.linectx.drawImage(this, 0, 0, size, size);
      self.buildBarrier();
      cb && cb();
    };
    img.onerror = function () { cb && cb(new Error('line art failed')); };
    var src = svg.indexOf('data:') === 0 ? svg : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    var pre = self.preloaded[src]; if (pre && pre.complete && pre.naturalWidth) { self.preHits++; img.onload.call(pre); return; } // already decoded in the background
    img.src = src;
  };

  this.buildBarrier = function () {
    var d = self.linectx.getImageData(0, 0, size, size).data, n = size * size;
    self.lineAlpha = new Uint8Array(n);
    for (var i = 0; i < n; i++) self.lineAlpha[i] = d[i * 4 + 3];
    self.applyTolerance();
  };
  this.applyTolerance = function () {
    var n = size * size, b = new Uint8Array(n), t = self.tolerance, a = self.lineAlpha;
    for (var i = 0; i < n; i++) b[i] = a[i] >= t ? 1 : 0;
    self.barrier = b;
  };
  this.setTolerance = function (t) { self.tolerance = t; if (self.lineAlpha) self.applyTolerance(); };

  function hexRgb(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }

  /* Scanline flood fill on the barrier map. Returns region mask and bbox. */
  this.region = function (x, y) {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    var b = self.barrier; if (!b || b[y * size + x]) return null;
    var mask = new Uint8Array(size * size), stack = [x, y];
    var minX = x, maxX = x, minY = y, maxY = y, count = 0;
    while (stack.length) {
      var sy = stack.pop(), sx = stack.pop(), i = sy * size + sx;
      if (mask[i] || b[i]) continue;
      var lx = sx, rx = sx;
      while (lx > 0 && !b[i - (sx - lx) - 1] && !mask[i - (sx - lx) - 1]) lx--;
      while (rx < size - 1 && !b[i + (rx - sx) + 1] && !mask[i + (rx - sx) + 1]) rx++;
      var row = sy * size;
      for (var px = lx; px <= rx; px++) {
        mask[row + px] = 1; count++;
        if (sy > 0) { var u = row - size + px; if (!mask[u] && !b[u]) stack.push(px, sy - 1); }
        if (sy < size - 1) { var dn = row + size + px; if (!mask[dn] && !b[dn]) stack.push(px, sy + 1); }
      }
      if (lx < minX) minX = lx; if (rx > maxX) maxX = rx;
      if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
    }
    // Antialias edge handling: grow the region 2px into the line so no pale halo
    // is left between paint and the soft edge of the line. Lines sit on top, so this is hidden.
    var grow = 2;
    for (var g = 0; g < grow; g++) {
      var add = [];
      for (var yy = Math.max(1, minY - 1); yy <= Math.min(size - 2, maxY + 1); yy++)
        for (var xx = Math.max(1, minX - 1); xx <= Math.min(size - 2, maxX + 1); xx++) {
          var k = yy * size + xx;
          if (mask[k] || !b[k]) continue;
          if (mask[k - 1] || mask[k + 1] || mask[k - size] || mask[k + size]) add.push(k);
        }
      for (var q = 0; q < add.length; q++) mask[add[q]] = 2;
      minX = Math.max(0, minX - 1); maxX = Math.min(size - 1, maxX + 1);
      minY = Math.max(0, minY - 1); maxY = Math.min(size - 1, maxY + 1);
    }
    return { mask: mask, minX: minX, minY: minY, maxX: maxX, maxY: maxY, count: count };
  };

  function snapshot(x, y, w, h) { return { x: x, y: y, img: self.pctx.getImageData(x, y, w, h) }; }
  function pushHistory(before, op) {
    var after = snapshot(before.x, before.y, before.img.width, before.img.height);
    self.undoStack.push({ before: before, after: after, op: op });
    if (self.undoStack.length > 60) self.undoStack.shift();
    self.redoStack = [];
    self.ops.push(op);
    self.onChange();
  }

  /* Forgiving fill: a tap on a line (or just off a shape) uses the nearest open pixel within `forgive` px. */
  this.forgive = 6;
  this.nearestOpen = function (x, y, R) {
    x = x | 0; y = y | 0; var b = self.barrier; if (!b) return null;
    for (var r = 0; r <= R; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; var xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < size && yy < size && !b[yy * size + xx]) return [xx, yy]; }
    return null;
  };
  /* opts: {color, color2, mode:'solid'|'gradient'} */
  this.fill = function (x, y, opts, record) {
    var r = self.region(x, y);
    if (!r && self.forgive) { var n = self.nearestOpen(x, y, self.forgive); if (n) { x = n[0]; y = n[1]; r = self.region(x, y); } }
    if (!r) return false;
    var w = r.maxX - r.minX + 1, h = r.maxY - r.minY + 1;
    var before = snapshot(r.minX, r.minY, w, h);
    var img = self.pctx.getImageData(r.minX, r.minY, w, h), d = img.data;
    var c1 = hexRgb(opts.color), c2 = hexRgb(opts.color2 || opts.color);
    var grad = opts.mode === 'gradient';
    var cx = x - r.minX, cy = y - r.minY, maxD = 1;
    if (grad) { // distance to farthest corner of the region box
      maxD = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy)) || 1;
    }
    for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
      var m = r.mask[(yy + r.minY) * size + xx + r.minX]; if (!m) continue;
      var o = (yy * w + xx) * 4, t = 0;
      if (grad) { t = Math.min(1, Math.hypot(xx - cx, yy - cy) / maxD); t = t * t * (3 - 2 * t); }
      d[o] = c1[0] + (c2[0] - c1[0]) * t; d[o + 1] = c1[1] + (c2[1] - c1[1]) * t; d[o + 2] = c1[2] + (c2[2] - c1[2]) * t; d[o + 3] = 255;
    }
    self.pctx.putImageData(img, r.minX, r.minY);
    if (record !== false) pushHistory(before, { t: 'fill', x: x | 0, y: y | 0, c: opts.color, c2: opts.color2, m: opts.mode });
    return true;
  };

  /* ---------- Brushes (v2) ----------
     Each stroke is stamped onto an off-screen "raw" canvas at full strength. The visible
     live canvas shows raw ∩ texture ∩ stay-inside mask, so you see the real result while
     drawing. On release it is merged into the paint layer with the brush's blend rule. */
  var raw = document.createElement('canvas'); raw.width = raw.height = size; var rctx = raw.getContext('2d');
  var maskCv = document.createElement('canvas'); maskCv.width = maskCv.height = size; var mctx = maskCv.getContext('2d');
  self.texCanvases = {};
  this.loadTextures = function (map, cb) {
    var names = Object.keys(map || {}), left = names.length; if (!left) { cb && cb(); return; }
    names.forEach(function (n) {
      var im = new Image();
      im.onload = function () { // grayscale → alpha (white = paint)
        var c = document.createElement('canvas'); c.width = im.width; c.height = im.height; var x = c.getContext('2d');
        x.drawImage(im, 0, 0); var d = x.getImageData(0, 0, c.width, c.height), p = d.data;
        for (var i = 0; i < p.length; i += 4) { p[i + 3] = p[i]; p[i] = p[i + 1] = p[i + 2] = 255; }
        x.putImageData(d, 0, 0); self.texCanvases[n] = c; if (--left === 0 && cb) cb();
      };
      im.onerror = function () { if (--left === 0 && cb) cb(); };
      im.src = map[n];
    });
  };
  /* brush presets: tex = texture name, merge = composite rule, soft = blur on release */
  this.BRUSHES = {
    round: { label: 'Soft round', tex: null, merge: 'source-over', vel: 0.25 },
    pencil: { label: 'Colored pencil', tex: 'crayon', merge: 'source-over', vel: 0.35, scale: 0.6 },
    charcoal: { label: 'Charcoal', tex: 'charcoal', merge: 'source-over', vel: 0.4, scale: 1 },
    watercolor: { label: 'Watercolor', tex: 'watercolor', merge: 'source-over', vel: 0.2, wet: true, scale: 1 },
    oil: { label: 'Oil', tex: 'oil', merge: 'source-over', vel: 0.15, scale: 1, rotate: true },
    marker: { label: 'Marker', tex: 'marker', merge: 'multiply', vel: 0, scale: 1 }
  };
  this.stayInside = true;
  var stroke = null;
  function bboxClip(ctx, x0, y0, w, h, fn) { ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip(); fn(); ctx.restore(); }
  this.buildMask = function (x, y) {
    var r = self.region(x, y); if (!r) return null;
    var img = mctx.createImageData(size, size), d = img.data, m = r.mask;
    for (var i = 0; i < m.length; i++) if (m[i]) d[i * 4 + 3] = 255;
    mctx.clearRect(0, 0, size, size); mctx.putImageData(img, 0, 0); return r;
  };
  /* o: {tool, brush, color, size, opacity, smoothing}; pressure 0..1 or null */
  this.beginStroke = function (x, y, o, pressure) {
    var b = self.BRUSHES[o.brush] || self.BRUSHES.round;
    stroke = { pts: [], sm: [x, y], o: o, b: b, minX: x, minY: y, maxX: x, maxY: y, lastT: performance.now(), vf: 1, w: o.size, masked: false };
    if (self.stayInside && o.inside !== false) stroke.masked = !!self.buildMask(x, y);
    rctx.clearRect(0, 0, size, size); self.lctx.clearRect(0, 0, size, size);
    self.live.style.opacity = o.tool === 'eraser' ? 0.5 : (b.merge === 'multiply' ? Math.min(1, o.opacity) : o.opacity);
    self.live.style.mixBlendMode = b.merge === 'multiply' ? 'multiply' : 'normal';
    var w = widthFor(o.size, 0, pressure); stroke.w = w;
    stamp(x, y, w); stroke.pts.push([Math.round(x), Math.round(y), Math.round(w * 10) / 10]); refresh(x - w, y - w, 2 * w, 2 * w);
  };
  function widthFor(base, v, pressure) {
    var f = 1;
    if (stroke) { var target = Math.max(0.45, Math.min(1.15, 1.15 - v * stroke.b.vel)); stroke.vf += (target - stroke.vf) * 0.25; f = stroke.vf; }
    if (pressure != null && pressure > 0 && pressure !== 0.5) f *= 0.25 + pressure * 1.25; // stylus pressure (0.5 = mouse default)
    return Math.max(1, base * f);
  }
  function stamp(x, y, w) {
    rctx.fillStyle = stroke.o.tool === 'eraser' ? '#ffffff' : stroke.o.color;
    rctx.beginPath(); rctx.arc(x, y, w / 2, 0, Math.PI * 2); rctx.fill();
  }
  function texPattern(ctx) {
    var t = stroke.b.tex && self.texCanvases[stroke.b.tex]; if (!t) return null;
    var p = ctx.createPattern(t, 'repeat'); return p;
  }
  /* repaint the visible live canvas inside a box: raw, then texture, then mask */
  function refresh(x, y, w, h) {
    var x0 = Math.max(0, Math.floor(x - 2)), y0 = Math.max(0, Math.floor(y - 2)), ww = Math.ceil(w + 4), hh = Math.ceil(h + 4);
    var c = self.lctx;
    bboxClip(c, x0, y0, ww, hh, function () {
      c.clearRect(x0, y0, ww, hh); c.drawImage(raw, 0, 0);
      if (stroke.o.tool !== 'eraser') { var p = texPattern(c); if (p) { c.globalCompositeOperation = 'destination-in'; c.fillStyle = p; c.fillRect(x0, y0, ww, hh); } }
      if (stroke.masked) { c.globalCompositeOperation = 'destination-in'; c.drawImage(maskCv, 0, 0); }
    });
  }
  /* explicitW: used by time-lapse replay to reproduce recorded widths */
  this.moveStroke = function (x, y, pressure, explicitW) {
    if (!stroke) return;
    var s = explicitW != null ? 0 : stroke.o.smoothing;
    var nx = stroke.sm[0] + (x - stroke.sm[0]) * (1 - s), ny = stroke.sm[1] + (y - stroke.sm[1]) * (1 - s);
    var last = stroke.sm, now = performance.now(), dist = Math.hypot(nx - last[0], ny - last[1]);
    var v = dist / Math.max(1, now - stroke.lastT); stroke.lastT = now;
    var w0 = stroke.w, w1 = explicitW != null ? explicitW : widthFor(stroke.o.size, v, pressure);
    var step = Math.max(0.7, Math.min(w0, w1) * 0.18), n = Math.max(1, Math.ceil(dist / step));
    for (var i = 1; i <= n; i++) { var t = i / n; stamp(last[0] + (nx - last[0]) * t, last[1] + (ny - last[1]) * t, w0 + (w1 - w0) * t); }
    stroke.sm = [nx, ny]; stroke.w = w1; stroke.pts.push([Math.round(nx), Math.round(ny), Math.round(w1 * 10) / 10]);
    var m = Math.max(w0, w1);
    refresh(Math.min(last[0], nx) - m, Math.min(last[1], ny) - m, Math.abs(nx - last[0]) + 2 * m, Math.abs(ny - last[1]) + 2 * m);
    stroke.minX = Math.min(stroke.minX, nx - m); stroke.maxX = Math.max(stroke.maxX, nx + m);
    stroke.minY = Math.min(stroke.minY, ny - m); stroke.maxY = Math.max(stroke.maxY, ny + m);
  };
  this.cancelStroke = function () { stroke = null; self.lctx.clearRect(0, 0, size, size); rctx.clearRect(0, 0, size, size); };
  this.isStroking = function () { return !!stroke; };
  this.isMaskedStroke = function () { return !!(stroke && stroke.masked); };
  this.endStroke = function (record) {
    if (!stroke) return;
    var o = stroke.o, b = stroke.b, pad = o.size * 1.3 + 12;
    var x0 = Math.max(0, Math.floor(stroke.minX - pad)), y0 = Math.max(0, Math.floor(stroke.minY - pad));
    var x1 = Math.min(size, Math.ceil(stroke.maxX + pad)), y1 = Math.min(size, Math.ceil(stroke.maxY + pad));
    var before = snapshot(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    var fin = self.live;
    if (b.wet && o.tool !== 'eraser') {
      // watercolor: soft bleed (blur) + pigment pooling at the edges, then re-clip to the shape
      var t = document.createElement('canvas'); t.width = t.height = size; var tc = t.getContext('2d');
      tc.filter = 'blur(' + Math.max(1.5, o.size * 0.08) + 'px)'; tc.drawImage(self.live, 0, 0); tc.filter = 'none';
      var e = document.createElement('canvas'); e.width = e.height = size; var ec = e.getContext('2d');
      ec.drawImage(t, 0, 0); ec.globalCompositeOperation = 'destination-out'; ec.filter = 'blur(' + Math.max(3, o.size * 0.22) + 'px)';
      ec.globalAlpha = 0.85; ec.drawImage(t, 0, 0); ec.filter = 'none'; ec.globalAlpha = 1; ec.globalCompositeOperation = 'source-over';
      tc.globalAlpha = 0.55; tc.globalCompositeOperation = 'source-over'; var keep = document.createElement('canvas'); keep.width = keep.height = size;
      var kc = keep.getContext('2d'); kc.globalAlpha = 0.6; kc.drawImage(t, 0, 0); kc.globalAlpha = 0.9; kc.drawImage(e, 0, 0);
      if (stroke.masked) { kc.globalAlpha = 1; kc.globalCompositeOperation = 'destination-in'; kc.drawImage(maskCv, 0, 0); }
      fin = keep;
    }
    self.pctx.save();
    if (o.tool === 'eraser') { self.pctx.globalCompositeOperation = 'destination-out'; self.pctx.globalAlpha = 1; }
    else { self.pctx.globalCompositeOperation = b.merge; self.pctx.globalAlpha = o.opacity; }
    self.pctx.drawImage(fin, 0, 0);
    self.pctx.restore();
    self.lctx.clearRect(0, 0, size, size); rctx.clearRect(0, 0, size, size);
    self.live.style.mixBlendMode = 'normal';
    if (record !== false) pushHistory(before, { t: 'stroke', tool: o.tool, br: o.brush, c: o.color, s: o.size, a: o.opacity, m: stroke.masked ? 1 : 0, p: stroke.pts });
    stroke = null;
  };
  /* Replays a recorded stroke (time-lapse). New strokes carry widths and rerun the real brush. */
  this.drawRecordedStroke = function (op, ctx) {
    if (op.p[0] && op.p[0].length === 3) {
      var p0 = op.p[0];
      self.beginStroke(p0[0], p0[1], { tool: op.tool, brush: op.br, color: op.c, size: p0[2], opacity: op.a, smoothing: 0, inside: !!op.m });
      for (var i = 1; i < op.p.length; i++) self.moveStroke(op.p[i][0], op.p[i][1], null, op.p[i][2]);
      self.endStroke(false); return;
    }
    ctx.save(); // v1 strokes
    if (op.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
    var tmp = document.createElement('canvas'); tmp.width = tmp.height = size;
    var t = tmp.getContext('2d'); t.strokeStyle = t.fillStyle = op.c; t.lineWidth = op.s; t.lineCap = t.lineJoin = 'round';
    t.beginPath(); t.moveTo(op.p[0][0], op.p[0][1]);
    for (var j = 1; j < op.p.length; j++) t.lineTo(op.p[j][0], op.p[j][1]);
    if (op.p.length === 1) { t.arc(op.p[0][0], op.p[0][1], op.s / 2, 0, 7); t.fill(); } else t.stroke();
    ctx.globalAlpha = op.tool === 'eraser' ? 1 : op.a; ctx.drawImage(tmp, 0, 0); ctx.restore();
  };

  this.undo = function () {
    var h = self.undoStack.pop(); if (!h) return false;
    self.pctx.putImageData(h.before.img, h.before.x, h.before.y);
    self.redoStack.push(h); self.ops.pop(); self.onChange(); return true;
  };
  this.redo = function () {
    var h = self.redoStack.pop(); if (!h) return false;
    self.pctx.putImageData(h.after.img, h.after.x, h.after.y);
    self.undoStack.push(h); self.ops.push(h.op); self.onChange(); return true;
  };
  this.clear = function () {
    var before = snapshot(0, 0, size, size);
    self.pctx.clearRect(0, 0, size, size);
    pushHistory(before, { t: 'clear' });
  };
  this.resetHistory = function () { self.undoStack = []; self.redoStack = []; };

  /* Share of open (non-line) area that has paint, sampled for speed. */
  this.progress = function () {
    var d = self.pctx.getImageData(0, 0, size, size).data, open = 0, painted = 0;
    for (var i = 0; i < size * size; i += 37) {
      if (self.barrier && self.barrier[i]) continue;
      open++; if (d[i * 4 + 3] > 20) painted++;
    }
    return open ? painted / open : 0;
  };
  /* Paper + paint + lines merged into one canvas (for export and thumbnails). */
  this.composite = function (out) {
    var c = document.createElement('canvas'); c.width = c.height = out || size;
    var x = c.getContext('2d'); x.fillStyle = '#fbfaf7'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(self.paint, 0, 0, c.width, c.height); x.drawImage(self.lines, 0, 0, c.width, c.height);
    return c;
  };
};
