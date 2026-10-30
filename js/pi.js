/* Optional Pi Network support. Stillwater works the same everywhere; inside the Pi Browser
   this adds "Sign in with Pi". Docs: https://github.com/pi-apps/pi-platform-docs
   - The SDK is loaded from https://sdk.minepi.com/pi-sdk.js. If it can't load (offline, file://,
     normal browser) nothing breaks.
   - sandbox: true when the URL has ?pi_sandbox=1, or when running on localhost.
   - NO payments, NO secrets. Sign-in only reads the username, and that username is NOT
     verified by a server (the docs say to verify the access token with GET /v2/me on your backend). */
window.Still = window.Still || {};
Still.Pi = (function () {
  var st = { loaded: false, ready: false, user: null, sandbox: /[?&]pi_sandbox=1/.test(location.search) || /^(localhost|127\.0\.0\.1)$/.test(location.hostname) };
  /* Only the Pi Browser (its user agent contains "PiBrowser") or an explicit sandbox test URL ever sees Pi UI.
     A normal browser never loads the SDK and never shows the button. */
  st.inPiBrowser = /PiBrowser/i.test(navigator.userAgent || '');
  st.enabled = st.inPiBrowser || /[?&]pi_sandbox=1/.test(location.search);
  var listeners = [];
  function emit() { listeners.forEach(function (f) { try { f(st); } catch (e) {} }); }
  function load() {
    if (!st.enabled || location.protocol === 'file:') return; // not Pi Browser, or no http(s): no SDK, no Pi UI
    var s = document.createElement('script'); s.src = 'https://sdk.minepi.com/pi-sdk.js'; s.async = true;
    s.onload = function () { st.loaded = true; try { window.Pi.init({ version: '2.0', sandbox: st.sandbox }); st.ready = typeof window.Pi.authenticate === 'function'; } catch (e) { st.ready = false; } emit(); };
    s.onerror = function () { st.loaded = false; emit(); };
    document.head.appendChild(s);
  }
  function signIn() {
    if (!st.ready || !window.Pi) return Promise.reject(new Error('Pi sign-in works only inside the Pi Browser.'));
    var timeout = new Promise(function (_, no) { setTimeout(function () { no(new Error('No answer from Pi. Open Stillwater inside the Pi Browser to sign in.')); }, 15000); });
    return Promise.race([timeout, window.Pi.authenticate(['username'], function onIncompletePaymentFound() { /* no payments in Stillwater */ })
      .then(function (auth) { st.user = { username: auth.user && auth.user.username }; emit(); return st.user; })]);
  }
  load();
  return { state: st, signIn: signIn, onChange: function (f) { listeners.push(f); } };
})();
