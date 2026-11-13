/*
 * Startup safety net (plain script, runs before the app).
 * If Clarity has not finished starting after 10 seconds, it shows what went wrong on this
 * device, plus a repair button that clears cached app files. It never touches your data.
 * No information leaves the device; nothing here is sent anywhere.
 */
(function () {
  'use strict';
  var errors = [];
  window.__clarityErrors = errors;
  function add(msg) {
    if (errors.length < 8) errors.push(String(msg).slice(0, 220));
  }
  window.addEventListener(
    'error',
    function (e) {
      var t = e.target;
      if (t && t !== window && (t.src || t.href)) add('Could not load ' + (t.src || t.href).replace(location.origin, ''));
      else add((e.message || 'Script error') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
    },
    true
  );
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    add('Unhandled: ' + (r && r.name ? r.name + ': ' + r.message : String(r)));
  });

  function probeIndexedDB(done) {
    var finished = false;
    function end(v) { if (!finished) { finished = true; done(v); } }
    try {
      if (!window.indexedDB) return end('not available');
      var req = indexedDB.open('clarity-probe', 1);
      req.onsuccess = function () { try { req.result.close(); indexedDB.deleteDatabase('clarity-probe'); } catch (x) {} end('works'); };
      req.onerror = function () { end('failed: ' + (req.error ? req.error.name + ' ' + req.error.message : 'unknown')); };
      req.onblocked = function () { end('blocked by another open tab'); };
      setTimeout(function () { end('did not respond within 4 seconds'); }, 4000);
    } catch (x) {
      end('threw ' + (x && x.name ? x.name + ': ' + x.message : String(x)));
    }
  }

  function repair() {
    var jobs = [];
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
    }
    if (window.caches && caches.keys) {
      jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
    }
    Promise.all(jobs).then(
      function () { location.reload(); },
      function () { location.reload(); }
    );
  }

  function el(tag, text, style) {
    var n = document.createElement(tag);
    if (text) n.textContent = text;
    if (style) for (var k in style) n.style[k] = style[k];
    return n;
  }

  function show() {
    if (window.__clarityReady || document.getElementById('clarity-diagnostics')) return;
    probeIndexedDB(function (idb) {
      if (window.__clarityReady) return;
      var dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
      var fg = dark ? '#EEF3FB' : '#12263F';
      var muted = dark ? '#A6B3C8' : '#4A5C75';
      var box = el('div', null, {
        position: 'fixed', inset: '0', zIndex: '9999', overflow: 'auto', padding: '24px 18px',
        background: dark ? '#0A0F19' : '#F2F6FC', color: fg,
        font: '15px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
      });
      box.id = 'clarity-diagnostics';
      box.setAttribute('role', 'alert');
      var inner = el('div', null, { maxWidth: '520px', margin: '0 auto' });
      inner.appendChild(el('h1', 'Clarity is taking too long to start', { fontSize: '22px', margin: '8px 0 8px' }));
      inner.appendChild(el('p', 'Your saved data is not affected. Try “Repair and reload” first. If it still does not start, take a screenshot of this screen and send it to the developer.', { color: muted, margin: '0 0 16px' }));

      var scripts = document.querySelectorAll('script[type="module"]');
      var build = scripts.length ? (scripts[0].getAttribute('src') || '').split('/').pop() : 'none';
      var sw = navigator.serviceWorker ? (navigator.serviceWorker.controller ? 'active' : 'not controlling') : 'not supported';
      var rows = [
        ['Storage (IndexedDB)', idb],
        ['App started', window.__clarityModuleLoaded ? 'script loaded, did not finish' : 'app script did not run'],
        ['Secure crypto', window.crypto && crypto.subtle ? 'available' : 'missing'],
        ['WebAssembly', typeof WebAssembly === 'object' ? 'available' : 'off (Lockdown Mode?)'],
        ['Offline cache', sw],
        ['Private window', 'unknown: check Safari tabs'],
        ['Build', build],
        ['Browser', navigator.userAgent]
      ];
      var dl = el('div', null, { borderTop: '1px solid rgba(128,128,128,.25)', fontSize: '13px' });
      for (var i = 0; i < rows.length; i++) {
        var r = el('div', null, { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0', borderBottom: '1px solid rgba(128,128,128,.25)' });
        r.appendChild(el('span', rows[i][0], { color: muted, flex: 'none' }));
        r.appendChild(el('span', rows[i][1], { textAlign: 'right', wordBreak: 'break-word' }));
        dl.appendChild(r);
      }
      inner.appendChild(dl);
      if (errors.length) {
        inner.appendChild(el('p', 'Errors', { fontWeight: '600', margin: '16px 0 6px' }));
        for (var j = 0; j < errors.length; j++) inner.appendChild(el('div', errors[j], { fontSize: '13px', color: muted, wordBreak: 'break-word', margin: '0 0 4px' }));
      } else {
        inner.appendChild(el('p', 'No script errors were reported.', { fontSize: '13px', color: muted, margin: '16px 0 0' }));
      }
      var btns = el('div', null, { display: 'flex', gap: '10px', marginTop: '22px', flexWrap: 'wrap' });
      var b1 = el('button', 'Repair and reload', { height: '44px', padding: '0 18px', borderRadius: '999px', border: '0', background: dark ? '#79A6FF' : '#2559DB', color: dark ? '#06173A' : '#fff', font: 'inherit', fontWeight: '600' });
      b1.addEventListener('click', repair);
      var b2 = el('button', 'Reload', { height: '44px', padding: '0 18px', borderRadius: '10px', border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: fg, font: 'inherit', fontWeight: '600' });
      b2.addEventListener('click', function () { location.reload(); });
      btns.appendChild(b1);
      btns.appendChild(b2);
      inner.appendChild(btns);
      inner.appendChild(el('p', '“Repair and reload” removes the cached copy of the app’s files on this device. It does not delete your accounts, transactions or settings.', { fontSize: '12px', color: muted, marginTop: '12px' }));
      box.appendChild(inner);
      document.body.appendChild(box);
    });
  }

  window.__clarityShowDiagnostics = show;
  setTimeout(show, 15000);
})();
