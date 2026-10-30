/* Phone-first studio (screens up to 480px): bottom thumb dock, ⋮ menu, slide-up color sheet.
   Every button here just presses the existing desktop control, so behavior stays identical. */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var studio = $('#studio'); if (!studio) return;
  function press(sel) { var el = $(sel); if (el) el.click(); }
  var dock = document.createElement('nav');
  dock.id = 'dock'; dock.className = 'dock'; dock.setAttribute('aria-label', 'Tools');
  dock.innerHTML =
    '<button data-t="fill" class="on"><b>◍</b>Fill</button>' +
    '<button data-t="brush"><b>✎</b>Brush</button>' +
    '<button data-t="eraser"><b>⌫</b>Eraser</button>' +
    '<button id="d-undo"><b>↶</b>Undo</button>' +
    '<button id="d-redo"><b>↷</b>Redo</button>' +
    '<button id="d-colors" aria-expanded="false"><b class="d-sw"></b>Colors</button>';
  studio.appendChild(dock);
  var more = document.createElement('button');
  more.id = 'more-btn'; more.className = 'ghost more-btn'; more.textContent = '⋮';
  more.setAttribute('aria-label', 'More options'); more.setAttribute('aria-expanded', 'false');
  $('.s-head').appendChild(more);
  var menu = document.createElement('div');
  menu.id = 'more-menu'; menu.className = 'more-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  var items = [['#cbn-btn', '🔢 Numbers'], ['.studio-a11y [data-pref=easy]', 'Easy mode'], ['.studio-a11y [data-pref=contrast]', 'High contrast'],
    ['.studio-a11y [data-pref=bigtext]', 'Larger text'], ['#replay', '▶ Time-lapse'], ['#calm-btn', '☾ Calm'],
    ['#zoom-reset', '⤢ Fit page'], ['#export', '⤓ Save PNG'], ['#clear', '↺ Start page over']];
  items.forEach(function (it) {
    var b = document.createElement('button'); b.setAttribute('role', 'menuitem'); b.dataset.sel = it[0]; b.textContent = it[1];
    b.onclick = function () { closeMenu(); press(it[0]); };
    menu.appendChild(b);
  });
  studio.appendChild(menu);
  function sync() {
    menu.querySelectorAll('button').forEach(function (b) {
      var o = $(b.dataset.sel); if (!o) return;
      var on = o.getAttribute('aria-pressed') === 'true' || o.classList.contains('primary') && b.dataset.sel !== '#export';
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  function closeMenu() { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); }
  more.onclick = function (e) { e.stopPropagation(); sync(); menu.hidden = !menu.hidden; more.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) setSheet(false); };
  document.addEventListener('pointerdown', function (e) { if (!menu.hidden && !menu.contains(e.target) && e.target !== more) closeMenu(); });
  function setSheet(open) { document.body.classList.toggle('sheet-open', open); $('#d-colors').setAttribute('aria-expanded', String(open)); }
  $('#d-colors').onclick = function () { closeMenu(); setSheet(!document.body.classList.contains('sheet-open')); };
  $('#d-undo').onclick = function () { press('#undo'); };
  $('#d-redo').onclick = function () { press('#redo'); };
  dock.querySelectorAll('[data-t]').forEach(function (b) {
    b.onclick = function () { press('.tools .tool[data-tool=' + b.dataset.t + ']'); };
  });
  /* Keep the dock in step with the real tool and color. */
  function refresh() {
    var act = $('.tools .tool.active'), t = act ? act.dataset.tool : 'fill';
    document.body.dataset.tool = t;
    dock.querySelectorAll('[data-t]').forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
    var c = $('#cur1'); if (c) $('.d-sw').style.background = getComputedStyle(c).backgroundColor;
  }
  new MutationObserver(refresh).observe($('.tools'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  new MutationObserver(refresh).observe($('#cur1'), { attributes: true });
  /* Picking a swatch closes the sheet so the page is visible again. */
  $('.colors').addEventListener('click', function (e) { if (e.target.closest('.sw') && window.matchMedia('(max-width:480px)').matches) setTimeout(function () { setSheet(false); }, 180); });
  $('#back').addEventListener('click', function () { setSheet(false); closeMenu(); });
  refresh();
  window.StillPhone = { setSheet: setSheet, sync: sync };
})();
