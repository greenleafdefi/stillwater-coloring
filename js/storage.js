/* Saves progress per page in localStorage. Everything stays on this computer. */
window.Still = window.Still || {};
Still.store = (function () {
  var PREFIX = 'stillwater:';
  function get(k, d) { try { var v = localStorage.getItem(PREFIX + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function set(k, v) {
    try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }
  function del(k) { try { localStorage.removeItem(PREFIX + k); } catch (e) {} }
  return {
    get: get, set: set, del: del,
    savePage: function (id, data) {
      // data: {paint, thumb, progress, ops, updated}
      var ok = set('page:' + id, data);
      if (!ok) { // too big: drop the replay data, keep the picture
        data.ops = []; data.opsTrimmed = true; ok = set('page:' + id, data);
      }
      return ok;
    },
    loadPage: function (id) { return get('page:' + id, null); },
    clearPage: function (id) { del('page:' + id); }
  };
})();
