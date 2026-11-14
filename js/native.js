/* BlitzBook web portal - the native shells around the portal. The iOS app (ios/BlitzBook) is a WKWebView showing
   this portal; what a web view cannot do on its own goes to the app through one message handler:
     print    {title, html}            the app renders the document, makes a PDF and opens the share sheet
     download {name, content, type}    the app writes the file and opens the share sheet (Save to Files, Mail ...)
     open     {url}                    the app opens the link outside (WhatsApp, UPI, the App Store)
   Everything else (storage, sync, file pickers, the camera for a signature) works in the web view as it does
   in Safari. Installed from Safari as a web app ("Add to Home Screen") there is no shell and the browser's own
   print and download do the job.
   The Android app shows the portal's HR screens the same way (PortalActivity, a WebView) and gives the page one
   object, BlitzNative: print(title, html), download(name, base64, type), open(url) and fetch(id, url, method,
   headers, body). fetch is there because several ISPs block supabase.co for the phone's own DNS, which a web view
   uses: every request to the Supabase project leaves through the app, which looks the address up over HTTPS, and
   the answer comes back through __bbReply. */
(function (global) {
  'use strict';
  const handler = () => { try { return global.webkit && global.webkit.messageHandlers && global.webkit.messageHandlers.blitzbook || null; } catch (e) { return null; } };
  const droid = () => { try { return global.BlitzNative || null; } catch (e) { return null; } };
  const Native = {
    // Running inside the iOS app
    get ios() { return !!handler(); },
    // Opened from the home screen as an installed web app (iPhone / iPad / Android / desktop)
    get installed() { return (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) || global.navigator.standalone === true; },
    get isApple() { return /iPad|iPhone|iPod/.test(global.navigator.userAgent) || (global.navigator.platform === 'MacIntel' && global.navigator.maxTouchPoints > 1); },
    // Running inside the Android app (a portal screen opened from an HR tile)
    get android() { return !!droid(); },
    // Inside either app: printing and downloads go to the app, and the links to the apps are not shown
    get shell() { return this.ios || this.android; },
    post(kind, data) {
      const h = handler(); data = data || {};
      if (h) { try { h.postMessage(Object.assign({ kind }, data)); return true; } catch (e) { return false; } }
      const a = droid(); if (!a) return false;
      try {
        if (kind === 'print') a.print(String(data.title || 'Document'), String(data.html || ''));
        else if (kind === 'download') return this.save(data.name, data.content, data.type);
        else if (kind === 'open') a.open(String(data.url || ''));
        else return false;
        return true;
      } catch (e) { return false; }
    },
    // A file for the Android app to write to Downloads: text, bytes or a Blob, sent as base64
    save(name, content, type) {
      const a = droid(); if (!a) return false;
      const send = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); a.download(String(name || 'file'), btoa(s), String(type || 'application/octet-stream')); };
      try {
        if (typeof content === 'string') send(new TextEncoder().encode(content));
        else if (content instanceof ArrayBuffer) send(new Uint8Array(content));
        else if (ArrayBuffer.isView(content)) send(new Uint8Array(content.buffer, content.byteOffset, content.byteLength));
        else if (typeof Blob !== 'undefined' && content instanceof Blob) content.arrayBuffer().then(b => send(new Uint8Array(b)));
        else return false;
        return true;
      } catch (e) { return false; }
    }
  };
  // Inside the Android app the requests to the Supabase project go out through the app (see the note at the top)
  if (droid() && typeof droid().fetch === 'function' && typeof global.fetch === 'function' && !global.__bbFetch) {
    global.__bbFetch = true;
    const real = global.fetch, waiting = new Map();
    let seq = 0;
    global.__bbReply = (id, status, text) => {
      const w = waiting.get(String(id)); if (!w) return;
      waiting.delete(String(id));
      if (status < 200) { w.reject(new TypeError('Failed to fetch')); return; }
      try { w.resolve(new Response([204, 205, 304].includes(status) ? null : String(text == null ? '' : text), { status, headers: { 'Content-Type': 'application/json' } })); } catch (e) { w.reject(new TypeError('Failed to fetch')); }
    };
    global.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : '';
        init = init || {};
        if (/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\//i.test(url) && (init.body == null || typeof init.body === 'string')) {
          const headers = {};
          if (init.headers) { if (typeof Headers !== 'undefined' && init.headers instanceof Headers) init.headers.forEach((v, k) => { headers[k] = v; }); else Object.keys(init.headers).forEach(k => { headers[k] = String(init.headers[k]); }); }
          const id = String(++seq);
          return new Promise((resolve, reject) => {
            waiting.set(id, { resolve, reject });
            try { droid().fetch(id, url, String(init.method || 'GET'), JSON.stringify(headers), init.body == null ? null : init.body); }
            catch (e) { waiting.delete(id); reject(new TypeError('Failed to fetch')); }
          });
        }
      } catch (e) { /* the browser's own fetch below */ }
      return real.apply(this, arguments);
    };
  }
  global.Native = Native;
})(window);
