/* BlitzBook web portal - Supabase as the backend. Supabase (https://supabase.com, free tier is enough) gives the
   portal and the app a hosted account system and a database without running the Node sync server:
     - Supabase Auth keeps the accounts, sends the registration / password-reset OTP by email (and by SMS when an
       SMS provider is set up in the Supabase dashboard) and checks it;
     - one table, public.books, keeps every record of every account as the same keyed rows the sync server
       keeps (see server/supabase/schema.sql), guarded by row-level security so an account only sees its own.
   This file answers the same requests the sync server answers (ping, otp, register, login, exists, password,
   reset, sync), so nothing else in the portal cares which backend is in use. The "token" the rest of the
   portal keeps is the Supabase access token; when it expires the portal signs in again with the stored
   password hash, exactly as it does with the sync server.
   The identity used to log in may be the mobile number or the email: public.profiles maps one to the other.
   Passwords never reach Supabase as typed either: the SHA-256 hash the portal already makes is the password. */
(function (global) {
  'use strict';
  const PHONE = /^[6-9][0-9]{9}$/, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  class SbError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
  const maskPhone = (p) => p ? p.slice(0, 2) + 'XXXXXX' + p.slice(-2) : '';
  const maskEmail = (e) => { const i = e.indexOf('@'); return i > 0 ? e.slice(0, Math.min(2, i)) + '***' + e.slice(i) : ''; };
  // Order-independent text of a record, to tell a row we just pushed from one changed elsewhere
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function jwtSub(token) { try { return JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || ''; } catch (e) { return ''; } }

  const Supabase = {
    url: '', key: '',
    configure(url, key) { this.url = String(url || '').trim().replace(/\/+$/, ''); this.key = String(key || '').trim(); },
    enabled() { return !!this.url && !!this.key; },
    // Whether an address is a Supabase project rather than a BlitzBook sync server
    looksLike(url) { return /\.supabase\.(co|in)\b/i.test(String(url || '')); },

    async http(method, path, body, token, extraHeaders) {
      const headers = Object.assign({ apikey: this.key, 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, extraHeaders || {});
      let res;
      try { res = await fetch(this.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
      catch (e) { throw new SbError(0, 'Cannot reach Supabase'); }
      const text = await res.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
      if (!res.ok) {
        const msg = (json && (json.msg || json.message || json.error_description || json.error)) || ('Supabase error ' + res.status);
        throw new SbError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      return json;
    },
    rpc(name, args) { return this.http('POST', '/rest/v1/rpc/' + name, args || {}); },
    // {email, phone} of the account behind a mobile number or email, null when no account has it
    async loginOf(identity) { const id = norm(identity); if (!id) return null; const r = await this.rpc('identity_login', { identity: id }); return r && typeof r === 'object' ? r : null; },
    session(s) { return { token: s.access_token, user: this.publicUser(s.user) }; },
    publicUser(u) {
      const m = (u && u.user_metadata) || {};
      return { name: m.name || '', phone: m.phone || (u && u.phone ? String(u.phone).replace(/^91/, '') : ''), email: (u && u.email) || '', createdAt: u && u.created_at ? Date.parse(u.created_at) || Date.now() : Date.now() };
    },
    async signIn(login, pw) {
      try { return await this.http('POST', '/auth/v1/token?grant_type=password', Object.assign(login.email ? { email: login.email } : { phone: '91' + login.phone }, { password: pw })); }
      catch (e) { if (e.status === 400) throw new SbError(401, 'Incorrect password'); throw e; }
    },

    // ------------------------------------------------------------ the sync server's requests
    async call(name, b) {
      b = b || {};
      switch (name) {
        case 'ping': { await this.http('GET', '/auth/v1/settings'); return { app: 'BlitzBook', ok: true, supabase: true, time: Date.now() }; }
        case 'exists': return { exists: !!(await this.loginOf(b.identity)) };
        case 'otp': return this.otp(b);
        case 'register': return this.register(b);
        case 'login': {
          const login = await this.loginOf(b.identity);
          if (!login) throw new SbError(404, 'No account with that mobile number or email');
          return this.session(await this.signIn(login, b.pw));
        }
        case 'password': {
          await this.http('PUT', '/auth/v1/user', { password: b.pw }, b.token);
          try { await this.http('POST', '/auth/v1/logout?scope=others', {}, b.token); } catch (e) { /* other devices sign out when their token expires */ }
          return { token: b.token };
        }
        case 'reset': {
          const login = await this.loginOf(b.identity);
          if (!login) throw new SbError(404, 'No account with that mobile number or email');
          const s = await this.verify(login.email ? { type: 'recovery', email: login.email, token: String(b.otp || '').trim() } : { type: 'sms', phone: '91' + login.phone, token: String(b.otp || '').trim() });
          await this.http('PUT', '/auth/v1/user', { password: b.pw }, s.access_token);
          try { await this.http('POST', '/auth/v1/logout?scope=others', {}, s.access_token); } catch (e) { /* see above */ }
          return this.session(s);
        }
        case 'sync': return this.sync(b);
        default: throw new SbError(404, 'Unknown request');
      }
    },
    async verify(body) {
      try { return await this.http('POST', '/auth/v1/verify', body); }
      catch (e) { if (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 422) throw new SbError(400, 'Invalid or expired OTP. Check it, or ask for a new one.'); throw e; }
    },
    // Registration: the OTP goes to the email (or, with an SMS provider in the Supabase project, to the mobile
    // number when there is no email); a password reset OTP goes to the account's email
    async otp(b) {
      if (String(b.purpose) === 'reset') {
        const login = await this.loginOf(b.identity);
        if (!login) throw new SbError(404, 'No account with that mobile number or email');
        if (login.email) { await this.http('POST', '/auth/v1/recover', { email: login.email }); return { sent: { sms: false, email: true }, to: { phone: '', email: maskEmail(login.email) }, expiresIn: 3600 }; }
        await this.http('POST', '/auth/v1/otp', { phone: '91' + login.phone });
        return { sent: { sms: true, email: false }, to: { phone: maskPhone(login.phone), email: '' }, expiresIn: 600 };
      }
      const phone = norm(b.phone), email = norm(b.email);
      if (phone && !PHONE.test(phone)) throw new SbError(400, 'Enter a valid 10-digit mobile number');
      if (email && !EMAIL.test(email)) throw new SbError(400, 'Enter a valid email address');
      if ((phone && await this.loginOf(phone)) || (email && await this.loginOf(email))) throw new SbError(409, 'This mobile number or email is already registered');
      if (email) {
        await this.http('POST', '/auth/v1/otp', { email, create_user: true, data: { name: String(b.name || ''), phone } });
        return { sent: { sms: false, email: true }, to: { phone: '', email: maskEmail(email) }, expiresIn: 3600 };
      }
      if (!phone) throw new SbError(400, 'A valid mobile number or email is required');
      try { await this.http('POST', '/auth/v1/otp', { phone: '91' + phone, create_user: true, data: { name: String(b.name || '') } }); }
      catch (e) { throw new SbError(400, 'Enter an email address to receive the OTP' + (e.status ? ' (SMS is not set up: ' + e.message + ')' : '')); }
      return { sent: { sms: true, email: false }, to: { phone: maskPhone(phone), email: '' }, expiresIn: 600 };
    },
    async register(b) {
      const name = String(b.name || '').trim().slice(0, 120), phone = norm(b.phone), email = norm(b.email);
      if (b.otp === undefined) throw new SbError(400, 'Register this account with the OTP sent to it');
      if (!email && !phone) throw new SbError(400, 'A valid mobile number or email is required');
      const s = await this.verify(email ? { type: 'email', email, token: String(b.otp).trim() } : { type: 'sms', phone: '91' + phone, token: String(b.otp).trim() });
      const u = await this.http('PUT', '/auth/v1/user', { password: b.pw, data: { name, phone } }, s.access_token);
      const row = { id: u.id, name, phone: phone || null, email: email || null };
      try { await this.http('POST', '/rest/v1/profiles', row, s.access_token, { Prefer: 'resolution=merge-duplicates,return=minimal' }); }
      catch (e) { if (e.status === 409) throw new SbError(409, 'This mobile number or email is already registered'); throw e; }
      s.user = Object.assign({}, s.user, u, { user_metadata: { name, phone } });
      return this.session(s);
    },

    // One sync round on the books table: push what changed here, then read everything newer than the last
    // revision seen, leaving out the rows we just pushed. Deleted records are rows whose d is null.
    // b.company names another company whose books are opened (companies.js): its id goes in the rows and in the
    // X-Company header the server's rules look at, and the owner's subscription record (b.owner) is read as
    // this company's "sub" whenever it changed since b.sub_since (answered as sub_rev).
    async sync(b) {
      const token = b.token, uid = jwtSub(token);
      if (!uid) throw new SbError(401, 'Signed out');
      const epoch = 'sb:' + this.url;
      if (b.epoch && b.epoch !== epoch) return { epoch, reset: true };
      const since = b.epoch ? Math.max(0, parseInt(b.since, 10) || 0) : 0;
      const cid = String(b.company || '') || uid, hdr = cid === uid ? {} : { 'X-Company': cid };
      const changes = Array.isArray(b.changes) ? b.changes : [], pushed = new Map();
      if (changes.length) {
        const rows = changes.map(c => { const d = c.x ? null : c.d; pushed.set(c.k, canon(d)); return { user_id: cid, k: c.k, d }; });
        for (let i = 0; i < rows.length; i += 200) await this.http('POST', '/rest/v1/books?on_conflict=user_id,k', rows.slice(i, i + 200), token, Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, hdr));
      }
      const out = []; let rev = since;
      for (let from = since; ;) {
        const page = await this.http('GET', '/rest/v1/books?select=k,d,r&user_id=eq.' + cid + '&r=gt.' + from + '&order=r.asc&limit=1000', undefined, token, hdr) || [];
        page.forEach(r => {
          rev = Math.max(rev, r.r); from = r.r;
          if (pushed.has(r.k) && pushed.get(r.k) === canon(r.d)) return;
          if (r.d == null) { if (since > 0) out.push({ k: r.k, x: 1 }); } else out.push({ k: r.k, d: r.d });
        });
        if (page.length < 1000) break;
      }
      const res = { epoch, rev, changes: out };
      if (cid !== uid) {
        const owner = String(b.owner || ''), subSince = Math.max(0, parseInt(b.sub_since, 10) || 0);
        if (owner) {
          const rows = await this.http('GET', '/rest/v1/books?select=d,r&user_id=eq.' + owner + '&k=eq.sub&r=gt.' + subSince + '&limit=1', undefined, token, hdr) || [];
          if (rows.length && rows[0].d) { res.changes = res.changes.filter(c => c.k !== 'sub').concat([{ k: 'sub', d: rows[0].d }]); res.sub_rev = rows[0].r; }
        }
      }
      return res;
    },
    SbError
  };
  global.Supabase = Supabase;
})(typeof window !== 'undefined' ? window : globalThis);
