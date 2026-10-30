/* Calm Mode: a visual breathing guide (in 4s, hold 4s, out 6s) and a slow ambient
   color glow behind the page. No sound at all: every cue is shown on screen. */
window.Still = window.Still || {};
Still.Calm = function (root) {
  var orb = root.querySelector('.breath-orb'), label = root.querySelector('.breath-label'),
      count = root.querySelector('.breath-count'), bar = root.querySelector('.breath-bar i');
  var phases = [{ t: 'Breathe in', d: 4, s: 1 }, { t: 'Hold', d: 4, s: 1 }, { t: 'Breathe out', d: 6, s: 0.55 }];
  var timer = null, start = 0, on = false, cycles = 0;
  this.active = function () { return on; };
  function tick() {
    var total = 14, el = (performance.now() - start) / 1000, inCycle = el % total, acc = 0, p, i;
    cycles = Math.floor(el / total);
    for (i = 0; i < phases.length; i++) { if (inCycle < acc + phases[i].d) { p = phases[i]; break; } acc += phases[i].d; }
    var left = Math.ceil(acc + p.d - inCycle);
    label.textContent = p.t; count.textContent = left;
    var prog = (inCycle - acc) / p.d, from = i === 0 ? 0.55 : (i === 1 ? 1 : 1), to = p.s;
    var sc = from + (to - from) * (0.5 - Math.cos(prog * Math.PI) / 2);
    orb.style.transform = 'scale(' + sc.toFixed(3) + ')';
    bar.style.width = (inCycle / total * 100).toFixed(1) + '%';
    root.querySelector('.breath-cycles').textContent = cycles + (cycles === 1 ? ' breath' : ' breaths');
    timer = requestAnimationFrame(tick);
  }
  this.start = function () { on = true; document.body.classList.add('calm'); root.hidden = false; start = performance.now(); tick(); };
  this.stop = function () { on = false; document.body.classList.remove('calm'); root.hidden = true; cancelAnimationFrame(timer); };
  this.toggle = function () { on ? this.stop() : this.start(); return on; };
};
