/* BlitzBook web portal - the native shells around the portal. The iOS app (ios/BlitzBook) is a WKWebView showing
   this portal; what a web view cannot do on its own goes to the app through one message handler:
     print    {title, html}            the app renders the document, makes a PDF and opens the share sheet
     download {name, content, type}    the app writes the file and opens the share sheet (Save to Files, Mail ...)
     open     {url}                    the app opens the link outside (WhatsApp, UPI, the App Store)
   Everything else (storage, sync, file pickers, the camera for a signature) works in the web view as it does
   in Safari. Installed from Safari as a web app ("Add to Home Screen") there is no shell and the browser's own
   print and download do the job. */
(function (global) {
  'use strict';
  const handler = () => { try { return global.webkit && global.webkit.messageHandlers && global.webkit.messageHandlers.blitzbook || null; } catch (e) { return null; } };
  const Native = {
    // Running inside the iOS app
    get ios() { return !!handler(); },
    // Opened from the home screen as an installed web app (iPhone / iPad / Android / desktop)
    get installed() { return (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) || global.navigator.standalone === true; },
    get isApple() { return /iPad|iPhone|iPod/.test(global.navigator.userAgent) || (global.navigator.platform === 'MacIntel' && global.navigator.maxTouchPoints > 1); },
    post(kind, data) { const h = handler(); if (!h) return false; try { h.postMessage(Object.assign({ kind }, data || {})); return true; } catch (e) { return false; } }
  };
  global.Native = Native;
})(window);
