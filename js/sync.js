/* BlitzBook web portal - keeps this browser and the Android app on the same books through the sync server
   (server/server.js). Nothing here decides what a record looks like: appformat.js turns every record into the
   app's row, this file only works out which rows changed here since the last round, sends them, and stores
   what changed elsewhere. It runs a few seconds after every save and every POLL_MS while the page is open.

   Without a reachable server the portal simply works on its own, as before. */
(function (global) {
  'use strict';
  // Address of a sync server, if one is hosted (see server/README.md). Blank: the portal works on its own and
  // data moves between app and portal by backup file (Export / Import). When the portal is opened through
  // server/server.js on this machine or the local network, that server is used.
  const DEFAULT_SERVER_URL = 'https://cufdskrmhdenppoxfhnk.supabase.co';
  // Supabase project instead of the sync server (see server/supabase/README.md): the project URL goes in
  // DEFAULT_SERVER_URL (or is entered under Sync), the anon (publishable) key here or under Sync as well.
  const SUPABASE_ANON_KEY = 'sb_publishable_wXaFiPC-b7zNGAKCo_1eow_4hUJxJCD';
  const POLL_MS = 10000, PUSH_DELAY_MS = 1200, TIMEOUT_MS = 20000;
  const URL_KEY = 'blitzbook.sync_url', SEEN_KEY = 'blitzbook.sync_seen', SB_KEY = 'blitzbook.supabase_key';

  // Order-independent text of a record, and a short fingerprint of it, to tell whether it changed
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function hash(v) {
    const str = canon(v); let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + str.length.toString(36);
  }
  class SyncError extends Error { constructor(status, message) { super(message); this.status = status; } }

  const Sync = {
    status: 'off',          // off | idle | syncing | offline | auth
    lastError: '', user: null, online: null,
    running: false, again: false, timer: null, poll: null, pinged: null, visible: null,
    onStatus: null,         // () => void
    onApplied: null,        // (keys) => void, records changed by another device
    onAuthLost: null,       // (message) => void, the password no longer matches the account

    // ---- server address
    serverUrl() {
      let u = '';
      try { u = localStorage.getItem(URL_KEY) || ''; } catch (e) { /* storage blocked */ }
      // Opened from a server on this machine or the local network (development): that server is the sync server
      const loc = global.location;
      const local = !!loc && /^https?:$/.test(loc.protocol) && /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(loc.hostname);
      if (!u && local) u = loc.origin;
      if (!u) u = DEFAULT_SERVER_URL;
      if (!u && loc && /^https?:$/.test(loc.protocol)) u = loc.origin;
      return u.replace(/\/+$/, '');
    },
    customUrl() { try { return localStorage.getItem(URL_KEY) || ''; } catch (e) { return ''; } },
    supabaseKey() { let k = ''; try { k = localStorage.getItem(SB_KEY) || ''; } catch (e) { /* storage blocked */ } return k || SUPABASE_ANON_KEY; },
    customSupabaseKey() { try { return localStorage.getItem(SB_KEY) || ''; } catch (e) { return ''; } },
    setSupabaseKey(k) { try { if (String(k || '').trim()) localStorage.setItem(SB_KEY, String(k).trim()); else localStorage.removeItem(SB_KEY); } catch (e) { /* storage blocked */ } this.pinged = null; this.online = null; },
    // True when the address is a Supabase project: requests then go to Supabase Auth and the books table
    isSupabase() { const u = this.serverUrl(); return !!global.Supabase && Supabase.looksLike(u) && !!this.supabaseKey(); },
    seen() { try { return localStorage.getItem(SEEN_KEY) || ''; } catch (e) { return ''; } },
    setServerUrl(u) {
      u = String(u || '').trim().replace(/\/+$/, '').replace(/\/(rest|auth|storage|realtime)\/v1$/i, '');
      if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
      try { if (u) localStorage.setItem(URL_KEY, u); else localStorage.removeItem(URL_KEY); } catch (e) { /* storage blocked */ }
      this.pinged = null; this.online = null;
    },

    async request(path, body) {
      const base = this.serverUrl();
      if (!base) throw new SyncError(0, 'No sync server is set');
      if (this.isSupabase()) {
        Supabase.configure(base, this.supabaseKey());
        try { return await Supabase.call(path, body || {}); } catch (e) { throw new SyncError(e.status || 0, e.message); }
      }
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
      let res;
      try {
        res = await fetch(base + '/api/' + path, body === undefined ? { signal: ctl && ctl.signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl && ctl.signal });
      } catch (e) { throw new SyncError(0, 'Cannot reach the sync server'); } finally { if (t) clearTimeout(t); }
      let json = null; try { json = await res.json(); } catch (e) { /* not ours */ }
      if (!res.ok) throw new SyncError(res.status, (json && json.error) || 'Sync server error ' + res.status);
      if (!json) throw new SyncError(0, 'That address is not a BlitzBook sync server');
      return json;
    },
    call(name, body) { return this.request(name, body || {}); },
    // Whether a BlitzBook server answers at the address. Asked once and remembered until the address changes.
    ready() {
      if (!this.pinged) this.pinged = this.request('ping').then(j => (this.online = j.app === 'BlitzBook'), () => (this.online = false));
      return this.pinged;
    },
    recheck() { this.pinged = null; return this.ready(); },

    // ---- per-user state: token, the server's data generation and revision, and a fingerprint of every
    // record as the server last had it
    state() { return Object.assign({ token: '', epoch: '', since: 0, last: 0, base: {}, subSince: 0 }, Store.get('sync', {})); },
    save(st) { Store.set('sync', st, true); },
    setToken(token) { const st = this.state(); st.token = token || ''; this.save(st); },

    start(user) {
      this.stop();
      this.user = user;
      Store.onChange = () => this.markDirty();
      if (typeof document !== 'undefined') {
        this.poll = setInterval(() => { if (!document.hidden) this.run(); }, POLL_MS);
        this.visible = () => { if (!document.hidden) this.run(); };
        document.addEventListener('visibilitychange', this.visible);
      }
      return this.run();
    },
    stop() {
      clearTimeout(this.timer); clearInterval(this.poll); this.timer = this.poll = null;
      if (this.visible && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visible);
      Store.onChange = null; this.user = null; this.again = false;
      this.setStatus('off');
    },
    markDirty() { if (!this.user) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), PUSH_DELAY_MS); },
    setStatus(s, err) { this.status = s; this.lastError = err || ''; if (this.onStatus) this.onStatus(); },

    // Signs this browser's account in on the server, creating it there the first time
    async link(st) {
      const u = this.user;
      let r;
      try { r = await this.call('login', { identity: u.phone || u.email, pw: u.password }); }
      catch (e) {
        if (e.status !== 404) throw e;
        r = await this.call('register', { name: u.name, phone: u.phone, email: u.email, pw: u.password, createdAt: u.createdAt });
      }
      st.token = r.token; this.save(st);
    },

    // Runs rounds until there is nothing left to exchange. A save made while a round is under way, the first
    // meeting with the server and a merged subscription each ask for one more.
    async run() {
      if (!this.user) return false;
      if (this.running) { this.again = true; return false; }
      this.running = true;
      let ok = false;
      try { for (let i = 0; i < 5 && this.user; i++) { this.again = false; ok = await this.round(); if (!this.again) break; } }
      finally { this.running = false; }
      return ok;
    },

    // One round: send what changed here, receive what changed elsewhere
    async round() {
      const uid = Store.uid;
      try {
        const url = this.serverUrl();
        if (!(await this.ready())) {
          // A plain web host with no sync server behind it is not an error: the portal works on its own there.
          // An address that was set, or that has answered before, is a server that is down: keep trying.
          const known = !!url && (!!this.customUrl() || !!DEFAULT_SERVER_URL || this.seen() === url);
          this.setStatus(known ? 'offline' : 'off', known ? 'Cannot reach the sync server' : '');
          if (known) this.pinged = null;
          return false;
        }
        try { localStorage.setItem(SEEN_KEY, url); } catch (e) { /* storage blocked */ }
        if (Store.uid !== uid || !this.user) return false;
        this.setStatus('syncing');
        const st = this.state();
        if (!st.token) await this.link(st);
        const snap = AppFormat.snapshot(), sent = {}, changes = [];
        // Another company's books: the subscription is the owner's and is never sent from here
        const cid = Store.cid || '', owner = cid && global.Companies ? Companies.ownerOf(cid) : '';
        // The first meeting with the server only listens: what is already there is taken in (so a party or item
        // entered on both sides becomes one record), and what is new here goes up in the next round
        if (st.epoch) {
          Object.keys(snap).forEach(k => { if (cid && k === 'sub') return; const h = hash(snap[k]); if (st.base[k] !== h) { changes.push({ k, d: snap[k] }); sent[k] = h; } });
          Object.keys(st.base).forEach(k => { if (!(k in snap) && k !== 'company' && k !== 'sub') { changes.push({ k, x: 1 }); sent[k] = null; } });
        }
        const body = () => ({ token: st.token, epoch: st.epoch, since: st.since, changes, company: cid, owner, sub_since: st.subSince });
        let resp;
        try { resp = await this.call('sync', body()); }
        catch (e) {
          if (e.status !== 401) throw e;
          st.token = ''; this.save(st); await this.link(st); // signed out by a password change: try the password this browser has
          resp = await this.call('sync', body());
        }
        if (Store.uid !== uid || !this.user) return false;
        if (resp.reset) { st.epoch = ''; st.since = 0; st.base = {}; st.subSince = 0; this.save(st); this.again = true; return false; }
        Object.keys(sent).forEach(k => { if (sent[k] == null) delete st.base[k]; else st.base[k] = sent[k]; });
        let applied = [];
        if (resp.changes.length) {
          // A record edited here while the request was on its way is left alone: it goes up next round
          const now = AppFormat.snapshot();
          const todo = resp.changes.filter(c => c.k === 'sub' || (now[c.k] ? hash(now[c.k]) : undefined) === st.base[c.k]);
          Store.quiet = true;
          try { applied = AppFormat.apply(todo, (key) => key in st.base); } finally { Store.quiet = false; }
          const after = AppFormat.snapshot();
          applied.forEach(k => { if (after[k]) st.base[k] = hash(after[k]); else delete st.base[k]; });
          const sub = todo.find(c => c.k === 'sub' && !c.x);
          if (sub) st.base.sub = hash(AppFormat.row.sub(sub.d)); // what the server has; a merged result differs and is sent next
        }
        if (!st.epoch) this.again = true;
        st.epoch = resp.epoch; st.since = resp.rev; st.last = Date.now();
        if (resp.sub_rev) st.subSince = resp.sub_rev;
        this.save(st);
        this.setStatus('idle');
        if (applied.length && this.onApplied) this.onApplied(applied);
        return true;
      } catch (e) {
        if (e.status === 401) { this.setStatus('auth', 'The password for this account was changed on another device'); if (this.onAuthLost) this.onAuthLost(this.lastError); }
        else { if (!e.status) this.pinged = null; this.setStatus('offline', e.message || 'Sync failed'); }
        return false;
      }
    },

    statusText() {
      const st = this.user ? this.state() : { last: 0 };
      if (this.status === 'syncing') return 'Syncing…';
      if (this.status === 'idle') return 'Synced';
      if (this.status === 'offline') return st.last ? 'Offline' : 'Not connected';
      if (this.status === 'auth') return 'Sign in again';
      return 'This device only';
    },
    hash, canon, SyncError, POLL_MS
  };
  global.Sync = Sync;
})(typeof window !== 'undefined' ? window : globalThis);
