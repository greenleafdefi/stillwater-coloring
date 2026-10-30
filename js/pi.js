/* Pi Network sign-in (Pi App Studio). Docs: https://pi-apps.github.io/pi-sdk-docs/quick-start/genai/Authentication
   - The SDK tag (https://sdk.minepi.com/pi-sdk.js) is always in <head>. If it can't load (offline, blocked,
     file://) window.Pi is missing and the app simply has no Pi features.
   - The "Sign in with Pi" UI exists ONLY inside Pi: the Pi Browser, or the PiNet iframe on *.pinet.com / *.minepi.com.
     A normal browser never sees it, and nothing is called there.
   - Flow: await Pi.init({version:"2.0"}) → Pi.authenticate(["username"]) → keep ONLY the accessToken →
     POST it once to App Studio. Only the user App Studio returns is trusted and shown; the sessionToken is kept
     in memory only (never stored). NO payments. */
window.Still = window.Still || {};
Still.Pi = (function () {
  var LOGIN = 'https://backend.appstudio-u7cm9zhmha0ruwv8.piappengine.com/pi/auth/v1/login';
  var PI_HOST = /(^|\.)(pinet\.com|minepi\.com)$/i;
  function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }
  function insidePi() {
    if (/PiBrowser/i.test(navigator.userAgent || '')) return true;
    if (PI_HOST.test(location.hostname)) return true;
    var framed = false; try { framed = window.self !== window.top; } catch (e) { framed = true; }
    if (!framed) return false;
    var anc = location.ancestorOrigins ? Array.prototype.slice.call(location.ancestorOrigins) : [];
    if (document.referrer) anc.push(document.referrer);
    return anc.some(function (o) { return PI_HOST.test(hostOf(o)); });
  }
  var st = { enabled: insidePi(), loaded: !!window.Pi, ready: false, user: null, busy: false };
  var session = null; // App Studio sessionToken: memory only
  var listeners = [];
  function emit() { listeners.forEach(function (f) { try { f(st); } catch (e) {} }); }
  var initP = null;
  function init() {
    if (initP) return initP;
    initP = (st.enabled && window.Pi && typeof window.Pi.init === 'function')
      ? Promise.resolve().then(function () { return window.Pi.init({ version: '2.0' }); }).then(function () { st.ready = typeof window.Pi.authenticate === 'function'; emit(); }, function () { st.ready = false; emit(); })
      : Promise.resolve();
    return initP;
  }
  function withTimeout(p, ms, msg) { return Promise.race([p, new Promise(function (_, no) { setTimeout(function () { no(new Error(msg)); }, ms); })]); }
  function signIn() {
    if (!st.enabled) return Promise.reject(new Error('Pi sign-in works only inside Pi.'));
    if (st.user) return Promise.resolve(st.user);
    if (st.busy) return Promise.reject(new Error('Signing in…'));
    st.busy = true;
    return init().then(function () {
      if (!st.ready) throw new Error('Pi is not available right now.');
      return withTimeout(window.Pi.authenticate(['username'], function onIncompletePaymentFound() { /* Stillwater has no payments */ }), 30000, 'No answer from Pi.');
    }).then(function (auth) {
      var accessToken = auth && auth.accessToken; // uid/username from authenticate are ignored
      if (!accessToken) throw new Error('Pi did not return a sign-in token.');
      return withTimeout(fetch(LOGIN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: accessToken }) }), 20000, 'Sign-in server did not answer.');
    }).then(function (res) {
      if (!res.ok) throw new Error('Pi sign-in was not accepted (' + res.status + ').');
      return res.json();
    }).then(function (j) {
      if (!j || !j.user || !j.user.username || !j.user.uid) throw new Error('Pi sign-in answer was incomplete.');
      session = j.sessionToken || null;
      st.user = { uid: String(j.user.uid), username: String(j.user.username) }; st.busy = false; emit(); return st.user;
    }).catch(function (e) { st.busy = false; emit(); throw e; });
  }
  function start() { if (!st.enabled) return; init().then(function () { if (st.ready) signIn().catch(function () {}); }); } // auto sign-in inside Pi
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  return { state: st, signIn: signIn, hasSession: function () { return !!session; }, onChange: function (f) { listeners.push(f); try { f(st); } catch (e) {} } };
})();
