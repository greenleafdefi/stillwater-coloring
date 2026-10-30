/* Zoom and pan. Mouse wheel = zoom at cursor. Space+drag or middle mouse = pan.
   Two fingers = pinch zoom + pan. The canvas stack is moved with a CSS transform. */
window.Still = window.Still || {};
Still.View = function (viewport, stack, size) {
  var self = this;
  this.scale = 1; this.x = 0; this.y = 0;
  this.min = 0.3; this.max = 8;
  function apply() { stack.style.transform = 'translate(' + self.x + 'px,' + self.y + 'px) scale(' + self.scale + ')'; if (self.onChange) self.onChange(); }
  this.fit = function () {
    var r = viewport.getBoundingClientRect(), s = Math.min(r.width, r.height) * 0.92 / size;
    self.scale = s; self.x = (r.width - size * s) / 2; self.y = (r.height - size * s) / 2; apply();
  };
  this.zoomAt = function (factor, cx, cy) {
    var ns = Math.max(self.min, Math.min(self.max, self.scale * factor)); factor = ns / self.scale;
    self.x = cx - (cx - self.x) * factor; self.y = cy - (cy - self.y) * factor; self.scale = ns; apply();
  };
  this.zoomCenter = function (factor) { var r = viewport.getBoundingClientRect(); self.zoomAt(factor, r.width / 2, r.height / 2); };
  this.panBy = function (dx, dy) { self.x += dx; self.y += dy; apply(); };
  /* Screen point → canvas pixel. */
  this.toCanvas = function (clientX, clientY) {
    var r = viewport.getBoundingClientRect();
    return [(clientX - r.left - self.x) / self.scale, (clientY - r.top - self.y) / self.scale];
  };
  viewport.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = viewport.getBoundingClientRect();
    if (e.ctrlKey || Math.abs(e.deltaY) > 0 && !e.shiftKey) self.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    else self.panBy(-e.deltaX, -e.deltaY);
  }, { passive: false });
  window.addEventListener('resize', function () { self.fit(); });
};
