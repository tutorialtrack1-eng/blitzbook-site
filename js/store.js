/* BlitzBook web portal - browser storage. Each collection is a JSON array, namespaced per user, mirroring the
   SQLite tables of the Android app (contacts, items_master, invoices, purchases, expenses, journal, notes,
   ledger_accounts, company_master). Backup files use the app's table layout (appformat.js), and every change is
   reported to sync.js so it reaches the app.

   Where it is kept: IndexedDB (database "blitzbook", store "kv"), which holds hundreds of megabytes, with every
   value also held in memory so that reads and writes stay synchronous for the rest of the portal; writes are
   flushed to IndexedDB a moment later in one transaction. Store.init() (index.html, before App.start) loads it
   and, the first time, moves the books out of localStorage, where the portal kept them until 1.18 and where a
   browser allows only 5 to 10 MB. Without IndexedDB (an old or locked-down browser, the Node tests) localStorage
   is used as before. The few keys other files read straight from localStorage (sync_url, theme ...) stay there. */
(function (global) {
  'use strict';
  const PREFIX = 'blitzbook.';
  const COLLECTIONS = ['contacts', 'items', 'invoices', 'challans', 'purchases', 'expenses', 'journal', 'notes', 'accounts', 'employees', 'attendance', 'clock', 'timesheets', 'reimbursements', 'payroll'];
  const DB_NAME = 'blitzbook', DB_STORE = 'kv';

  let db = null;                 // the open IndexedDB, null = localStorage only
  const mem = new Map();         // key -> JSON text, everything IndexedDB holds
  const pending = new Map();     // key -> JSON text or null (delete), waiting for the next flush
  let flushTimer = null, flushing = null, warned = false;

  function warnOnce(msg) {
    if (warned) return; warned = true;
    console.error('storage', msg);
    if (global.UI && UI.toast) UI.toast('This browser could not save: ' + msg + '. Export a backup (Company > Export / Import) and free some space.', 9000);
  }

  function read(key, fallback) {
    try {
      const v = db ? (mem.has(PREFIX + key) ? mem.get(PREFIX + key) : null) : localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    const text = JSON.stringify(value);
    if (!db) { try { localStorage.setItem(PREFIX + key, text); return true; } catch (e) { warnOnce(e && e.name === 'QuotaExceededError' ? 'its storage is full' : String(e && e.message || e)); return false; } }
    mem.set(PREFIX + key, text); pending.set(PREFIX + key, text); schedule();
    return true;
  }
  function remove(key) {
    if (!db) { try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ } return; }
    mem.delete(PREFIX + key); pending.set(PREFIX + key, null); schedule();
  }

  function schedule() { if (!flushTimer) flushTimer = setTimeout(flush, 0); }
  // Everything written since the last flush, in one transaction; a failure (quota, a closed database) is said once
  function flush() {
    flushTimer = null;
    if (!db || !pending.size) return Promise.resolve();
    const batch = Array.from(pending.entries()); pending.clear();
    flushing = new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(DB_STORE, 'readwrite'); } catch (e) { warnOnce(String(e && e.message || e)); resolve(); return; }
      const os = tx.objectStore(DB_STORE);
      batch.forEach(([k, v]) => { if (v == null) os.delete(k); else os.put(v, k); });
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => { warnOnce(tx.error && tx.error.name === 'QuotaExceededError' ? 'its storage is full' : String(tx.error && tx.error.message || 'write failed')); resolve(); };
    });
    return flushing;
  }

  function openDb() {
    return new Promise((resolve) => {
      let idb;
      try { idb = global.indexedDB; } catch (e) { idb = null; }
      if (!idb) { resolve(null); return; }
      let req;
      try { req = idb.open(DB_NAME, 1); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains(DB_STORE)) d.createObjectStore(DB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = req.onblocked = () => resolve(null);
    });
  }
  function loadAll(d) {
    return new Promise((resolve) => {
      let tx;
      try { tx = d.transaction(DB_STORE, 'readonly'); } catch (e) { resolve(false); return; }
      const req = tx.objectStore(DB_STORE).openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { mem.set(String(c.key), String(c.value)); c.continue(); } else resolve(true); };
      req.onerror = () => resolve(false);
    });
  }
  // The books the portal kept in localStorage before 1.18: users, the session and every "u<uid>.<key>" entry
  function migrateFromLocalStorage() {
    const keys = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && (k === PREFIX + 'users' || k === PREFIX + 'session' || k.startsWith(PREFIX + 'u'))) keys.push(k); } } catch (e) { return 0; }
    keys.forEach(k => { const v = localStorage.getItem(k); if (v != null) { mem.set(k, v); pending.set(k, v); } });
    return keys.length;
  }

  const Store = {
    // Opens IndexedDB and loads everything into memory; resolves to the storage in use ('indexeddb' or 'localstorage').
    // Safe to call again (it then only resolves).
    ready: null,
    init() {
      if (this.ready) return this.ready;
      this.ready = (async () => {
        const d = await openDb();
        if (!d) return 'localstorage';
        if (!(await loadAll(d))) { try { d.close(); } catch (e) { /* ignore */ } return 'localstorage'; }
        db = d;
        d.onversionchange = () => { try { d.close(); } catch (e) { /* ignore */ } db = null; };
        const moved = mem.size === 0 ? migrateFromLocalStorage() : 0;
        if (moved) {
          await flush();
          // Freed only once IndexedDB has them, so a failed move loses nothing
          Array.from(mem.keys()).forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
          console.log('storage: ' + moved + ' entries moved from localStorage to IndexedDB');
        }
        return 'indexeddb';
      })();
      return this.ready;
    },
    // Waits for pending writes to reach IndexedDB (tests, and before the page is left)
    async flush() { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } await flush(); await (flushing || Promise.resolve()); },
    engine() { return db ? 'indexeddb' : 'localstorage'; },
    // How full this browser's storage is: {usage, quota, pct} in bytes, or null when the browser does not say
    async storageInfo() {
      try {
        if (!global.navigator || !navigator.storage || !navigator.storage.estimate) return null;
        const e = await navigator.storage.estimate();
        if (!e || !e.quota) return null;
        return { usage: e.usage || 0, quota: e.quota, pct: Math.round((e.usage || 0) / e.quota * 1000) / 10 };
      } catch (e) { return null; }
    },

    // ---- users (shared, not namespaced)
    users() { return read('users', []); },
    saveUsers(list) { write('users', list); },
    findUser(identity) {
      const id = String(identity || '').trim().toLowerCase();
      if (!id) return null;
      return this.users().find(u => (u.email && u.email.toLowerCase() === id) || (u.phone && u.phone === id)) || null;
    },
    session() { return read('session', null); },
    setSession(s) { if (s) write('session', s); else remove('session'); },

    // ---- per-user namespace. One account may keep the books of several companies (companies.js): each company
    // has a namespace of its own, "<account id>:<company id>", the account's own first company simply "<account id>".
    uid: null,
    cid: '',          // the company whose books are open ('' = the account's own first company)
    account: null,    // the signed-in account's local id
    onChange: null,   // set by sync.js: called after every change to the signed-in user's data
    quiet: false,     // true while sync.js stores records that came from another device
    ns(accountId, cid) { return cid ? accountId + ':' + cid : String(accountId); },
    open(accountId, cid) { this.account = accountId; this.cid = cid || ''; this.uid = this.ns(accountId, cid); },
    key(k) { return 'u' + (this.uid || 0) + '.' + k; },
    get(k, fallback) { return read(this.key(k), fallback); },
    set(k, v, quiet) {
      // In another company the role decides what may be changed; the server refuses the rest anyway
      if (!quiet && !this.quiet && global.Companies && !Companies.mayWrite(k)) { if (global.UI && UI.toast) { UI.toast(Companies.readOnlyText(k), 4500); UI.hold = Date.now() + 2500; } return false; }
      const ok = write(this.key(k), v); if (!quiet && !this.quiet && this.onChange) this.onChange(k); return ok;
    },
    // Another user's value, e.g. the sync token of an account that is not signed in right now
    peek(uid, k, fallback) { return read('u' + uid + '.' + k, fallback); },
    poke(uid, k, v) { return write('u' + uid + '.' + k, v); },

    list(col) { return this.get(col, []); },
    saveList(col, list) { return this.set(col, list); },
    add(col, obj) { const list = this.list(col); obj.id = obj.id || U.uid(); obj.createdAt = obj.createdAt || Date.now(); list.push(obj); this.saveList(col, list); return obj; },
    update(col, obj) { const list = this.list(col); const i = list.findIndex(x => x.id === obj.id); if (i < 0) return this.add(col, obj); obj.updatedAt = Date.now(); list[i] = obj; this.saveList(col, list); return obj; },
    delete(col, id) { this.saveList(col, this.list(col).filter(x => x.id !== id)); },
    find(col, id) { return this.list(col).find(x => x.id === id) || null; },
    // Item master without the built-in quick items the user removed (those stay as hidden rows, as in the app)
    items() { return this.list('items').filter(i => !i.hidden); },

    company() {
      return Object.assign({
        name: '', gstin: '', address: '', phone: '', email: '', gstType: 'Regular', activity: 'General',
        bankName: '', bankAccountNo: '', bankIfsc: '', bankBranch: '', bankHolder: '',
        invoiceFormat: U.DEFAULT_INVOICE_FORMAT, signature: '', logo: '', pdfLayout: 0, paper: 'A4',
        // Terms & conditions printed at the foot of an invoice (when the invoice says so), and the credit period
        // that sets a Credit invoice's payment due date
        terms: '', termsOn: true, creditDays: 30
      }, this.get('company', {}));
    },
    saveCompany(c) { return this.set('company', c); },

    // ---- backup: the same file restores in the Android app (Export / Import there) and here
    exportAll() { return AppFormat.exportTables(); },
    importAll(obj) {
      if (AppFormat.isTables(obj)) return AppFormat.importTables(obj);
      // Files written by the first version of the portal
      if (!obj || obj.app !== 'BlitzBook' || !obj.data) throw new Error('That is not a BlitzBook backup file');
      if (obj.company) this.saveCompany(obj.company);
      COLLECTIONS.forEach(c => { if (Array.isArray(obj.data[c])) this.saveList(c, obj.data[c]); });
      return { invoices: this.list('invoices').length, items: this.items().length, contacts: this.list('contacts').length, company: !!obj.company };
    },
    COLLECTIONS
  };
  // Whatever is still queued goes out before the tab closes (IndexedDB finishes a started transaction)
  if (global.addEventListener) global.addEventListener('pagehide', () => { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; flush(); } });
  global.Store = Store;
})(typeof window !== 'undefined' ? window : globalThis);
