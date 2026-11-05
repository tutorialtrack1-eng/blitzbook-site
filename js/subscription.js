/* BlitzBook web portal - trial and subscription validity. Same scheme as Subscription.java in the Android app:
   a 30-day trial from first login, then an activation code. Two kinds of code:
     - a plan for a number of days (monthly, yearly, 2 years, 5 years): every feature, the days are added after the
       current validity ends;
     - a pack of invoices (15 to use within 3 months, or 40 within 6): every saved invoice, credit note or debit
       note uses one of them, and only the invoicing features are offered (an "invoice pack" account; see isLite).
       Invoices not used by the pack's date lapse. A saved invoice or note cannot be changed or deleted on a pack,
       so a pack cannot be reused by editing.
   Codes handed out live in Supabase (server/supabase/activation.sql); codes made with tools/LicenceKeyGen.java (tied
   to the login, time plans only) work too. With sync on, the trial start, the validity, the pack counters and the
   codes already used are shared with the app: one subscription per account, whichever device it is used on. */
(function (global) {
  'use strict';
  const TRIAL_MILLIS = 30 * 24 * 60 * 60 * 1000;
  // The packs on sale (same list in Subscription.java). days or invoices is 0 depending on the kind; packDays is
  // how long an invoice pack's invoices can be used.
  const PLANS = [
    { name: 'Monthly plan', days: 30, invoices: 0, price: 299 },
    { name: 'Yearly plan', days: 365, invoices: 0, price: 2499 },
    { name: '2 years plan', days: 730, invoices: 0, price: 3999 },
    { name: '5 years plan', days: 1825, invoices: 0, price: 7999 },
    { name: '15 invoices pack', days: 0, invoices: 15, packDays: 90, price: 99 },
    { name: '40 invoices pack', days: 0, invoices: 40, packDays: 180, price: 199 },
    // Full access: accounts and HR & payroll together (hr.js); the days count like a time plan and set full_until
    { name: 'Full access monthly', days: 30, invoices: 0, full: true, price: 599 },
    { name: 'Full access yearly', days: 365, invoices: 0, full: true, price: 4999 },
    { name: 'Full access 2 years', days: 730, invoices: 0, full: true, price: 7999 }
  ];
  const PLAN_NAMES = PLANS.map(p => p.name), PLAN_DAYS = PLANS.map(p => p.days), PLAN_PRICES = PLANS.map(p => p.price), PLAN_INVOICES = PLANS.map(p => p.invoices);
  // The plan names the payment function knows (server/supabase/functions/cashfree), in the same order
  const PLAN_KEYS = ['monthly', 'yearly', '2years', '5years', 'inv15', 'inv40', 'fullmonthly', 'fullyearly', 'full2years'];
  const SECRET = 'VANYA-INVOICE-BOOK-2026';
  const VENDOR_UPI_ID = 'blitzbook@upi';
  const VENDOR_NAME = 'BlitzBook';
  const VENDOR_PHONE = '8074386833';
  // Optional activation server, as in the app: receives {phone, email, days, invoices, amount, txnRef, status} after
  // payment and may answer {"code": "XXXX-XXXX-XXXX-XXXX"} to activate at once. Blank = the request goes to VENDOR_PHONE.
  const ACTIVATION_SERVER_URL = '';
  const DAY = 24 * 60 * 60 * 1000;

  async function sha256Hex(s) { return (await U.sha256Hex(s)).toUpperCase(); }
  async function makeCode(identity, days) {
    const id = String(identity || '').trim().toLowerCase();
    const hex = await sha256Hex(SECRET + '|' + id + '|' + days);
    return hex.slice(0, 4) + '-' + hex.slice(4, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16);
  }
  function normalize(code) { return String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }
  const n0 = (v) => Math.max(0, parseInt(v, 10) || 0);
  const dmy = (ms) => { const d = new Date(ms); return U.pad(d.getDate()) + '/' + U.pad(d.getMonth() + 1) + '/' + d.getFullYear(); };

  const Sub = {
    TRIAL_MILLIS, PLANS, PLAN_NAMES, PLAN_DAYS, PLAN_PRICES, PLAN_INVOICES, VENDOR_UPI_ID, VENDOR_NAME, VENDOR_PHONE, ACTIVATION_SERVER_URL,
    TRIAL_LABEL: '30-day',
    planLabel(i) { const p = PLANS[i]; return p.name + '  (' + this.planWhat(p) + ')  -  Rs ' + p.price; },
    // "3 months" for 90 days; what a plan gives: "365 days" or "15 invoices, valid 3 months"
    packValidity(days) { days = n0(days); return !days ? 'no end date' : days % 30 === 0 ? (days / 30) + (days === 30 ? ' month' : ' months') : days + ' days'; },
    planWhat(p) { return p.invoices ? p.invoices + ' invoices, ' + (p.packDays ? 'valid ' + this.packValidity(p.packDays) : 'no end date') : p.days + ' days' + (p.full ? ', accounts + HR & payroll' : ''); },
    // "Yearly plan" for 365 days, "20 invoices pack" for 20 invoices; "N days" / "N invoices" for a code outside the packs
    planName(days, invoices) { const p = PLANS.find(x => invoices ? x.invoices === invoices : x.days === days); return p ? p.name : invoices ? invoices + ' invoices' : days + ' days'; },
    upiUri(phone, plan, amount) {
      const tag = plan.invoices ? plan.invoices + 'inv' : plan.days + 'd';
      return 'upi://pay?pa=' + encodeURIComponent(VENDOR_UPI_ID) + '&pn=' + encodeURIComponent(VENDOR_NAME) +
        '&am=' + amount + '.00&cu=INR&tn=' + encodeURIComponent(VENDOR_NAME + ' ' + tag + ' ' + phone);
    },
    // Returns the code from the reply, '' when the server took the request and will send the code, null when unreachable
    async requestActivation(phone, email, plan, amount, txnRef, status) {
      if (!ACTIVATION_SERVER_URL) return null;
      try {
        const r = await fetch(ACTIVATION_SERVER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, email, days: plan.days, invoices: plan.invoices, amount, txnRef, status }) });
        if (!r.ok) return null;
        return String((await r.json()).code || '');
      } catch (e) { return null; }
    },
    markRegistered() { if (!Store.get('registered_at', 0)) Store.set('registered_at', Date.now()); },

    // ---- time plans and the trial
    subscriptionUntil() { return Store.get('valid_until', 0); },
    expiresAt() { const paid = this.subscriptionUntil(); if (paid > 0) return paid; return Store.get('registered_at', Date.now()) + TRIAL_MILLIS; },
    isTimeActive() { return Date.now() < this.expiresAt(); },
    isOnTrial() { return this.subscriptionUntil() <= 0; },
    daysLeft() { return Math.max(0, Math.floor((this.expiresAt() - Date.now() + DAY - 1) / DAY)); },

    // ---- invoice packs
    invoiceQuota() { return n0(Store.get('inv_quota', 0)); },
    invoicesUsed() { return n0(Store.get('inv_used', 0)); },
    // The date the pack's invoices can be used until (0: no end date, a pack bought before packs had one)
    packUntil() { return n0(Store.get('inv_until', 0)); },
    packExpired() { const u = this.packUntil(); return u > 0 && Date.now() >= u; },
    invoicesLeft() { return this.packExpired() ? 0 : Math.max(0, this.invoiceQuota() - this.invoicesUsed()); },
    // An account living on an invoice pack: no running time plan or trial, invoices left in the pack
    isLite() { return !this.isTimeActive() && this.invoicesLeft() > 0; },
    // Whether one more invoice / note may be saved; on a time plan or the trial always
    canAddInvoice() { return this.isTimeActive() || this.invoicesLeft() > 0; },
    // One invoice, credit note or debit note saved: on a pack it uses one of the invoices
    useInvoice() { if (this.isLite()) Store.set('inv_used', this.invoicesUsed() + 1); },

    isActive() { return this.isTimeActive() || this.invoicesLeft() > 0; },

    // ---- yearly plans: the GST return files (gst.js), companies, groups and members (companies.js) are for accounts on
    // a yearly plan or longer (2 years, 5 years), and the 30-day trial has them to try (isYearly). yearly_until is set
    // when such a plan is applied here (code, payment or a sync that stretched the validity by a year or more). An
    // account activated elsewhere before this was recorded still counts while more than 300 days of validity remain,
    // which only a yearly or longer plan can give. The group (consolidated) statements are the one thing the trial does
    // not have: they need the paid plan (isYearlyPaid).
    yearlyUntil() { return n0(Store.get('yearly_until', 0)); },
    isYearlyPaid() { const now = Date.now(), paid = this.subscriptionUntil(); return this.yearlyUntil() > now || (paid > now && paid - now > 300 * DAY); },
    isYearly() { return this.isYearlyPaid() || (this.isOnTrial() && this.isTimeActive()); },
    noteYearly(days, until) { if (n0(days) >= 360 && until > this.yearlyUntil()) Store.set('yearly_until', until); },
    // ---- Full access plans: HR & payroll (hr.js) for accounts on one, and during the trial so it can be tried.
    // full_until is set when such a plan (a payment, or a code with full true) is applied here or arrives by sync;
    // members run on the owner's record.
    fullUntil() { return n0(Store.get('full_until', 0)); },
    isFull() { return this.fullUntil() > Date.now() || (this.isOnTrial() && this.isTimeActive()); },
    noteFull(plan, until) { if ((plan.full === true || plan.full === 'true') && until > this.fullUntil()) Store.set('full_until', until); },
    // "Activated till 31/10/2026 (29 days left)", "Subscription valid till 31/03/2027 (180 days)",
    // "Invoice pack: 12 of 15 invoices left, valid till 01/01/2027" or "Activation expired on ..." / "Invoice pack used up"
    statusText() {
      const end = this.expiresAt(), left = end - Date.now();
      const d = new Date(end), date = U.pad(d.getDate()) + '/' + U.pad(d.getMonth() + 1) + '/' + d.getFullYear();
      if (left > 0) {
        const days = Math.floor((left + DAY - 1) / DAY);
        const pack = this.invoiceQuota() > 0 && !this.packExpired() ? '; invoice pack: ' + this.invoicesLeft() + ' of ' + this.invoiceQuota() + ' left for later' + (this.packUntil() ? ', valid till ' + dmy(this.packUntil()) : '') : '';
        const full = this.fullUntil() > Date.now() ? '; Full access (HR & payroll) till ' + dmy(this.fullUntil()) : '';
        if (this.isOnTrial()) return 'Activated till ' + date + ' (' + days + ' day' + (days === 1 ? '' : 's') + ' left, every feature to try except the group statements)' + pack;
        return 'Subscription valid till ' + date + ' (' + days + ' days)' + full + pack;
      }
      if (this.invoicesLeft() > 0) return 'Invoice pack: ' + this.invoicesLeft() + ' of ' + this.invoiceQuota() + ' invoices left' + (this.packUntil() ? ', valid till ' + dmy(this.packUntil()) : '');
      if (this.packExpired() && this.invoiceQuota() > this.invoicesUsed()) return 'Invoice pack expired on ' + dmy(this.packUntil()) + ' (' + (this.invoiceQuota() - this.invoicesUsed()) + ' invoices unused)';
      if (this.invoiceQuota() > 0) return 'Invoice pack used up (' + this.invoiceQuota() + ' invoices); activation expired on ' + date;
      return 'Activation expired on ' + date;
    },

    // A code issued in Supabase (one use, any account): {days, invoices, packDays}; -1 unknown, -2 used, -3 not reachable.
    // redeem_code_v2 knows both kinds; a project that only has the older redeem_code answers the days.
    async redeemOnline(code) {
      if (!global.Sync || !Sync.isSupabase || !Sync.isSupabase() || !Sync.user) return -3;
      try {
        Supabase.configure(Sync.serverUrl(), Sync.supabaseKey());
        let st = Sync.state();
        if (!st.token) { await Sync.link(st); st = Sync.state(); }
        const ask = async () => {
          try { return await Supabase.http('POST', '/rest/v1/rpc/redeem_code_v2', { code_in: code }, Sync.state().token); }
          catch (e) { if (e.status !== 404) throw e; const n = parseInt(await Supabase.http('POST', '/rest/v1/rpc/redeem_code', { code_in: code }, Sync.state().token), 10); return isNaN(n) || n < 0 ? { error: isNaN(n) ? -3 : n } : { days: n, invoices: 0 }; }
        };
        let r;
        try { r = await ask(); } catch (e) { if (e.status !== 401) throw e; st.token = ''; Sync.save(st); await Sync.link(st); r = await ask(); }
        if (!r || typeof r !== 'object') return -3;
        if (r.error != null) return r.error === -3 ? -3 : r.error;
        const days = n0(r.days), invoices = n0(r.invoices);
        return days > 0 || invoices > 0 ? { days, invoices, packDays: n0(r.pack_days), full: r.full === true } : -1;
      } catch (e) { return -3; }
    },
    // Returns {days, invoices} on success; -1 wrong code, -2 already used, -3 when the code could not be checked
    // online (the codes handed out live in Supabase: without a connection, or signed out there, they cannot be
    // verified). Codes issued in Supabase are tried first, then the codes made for this login with
    // tools/LicenceKeyGen.java. A plan's days are added to the end of the current validity (trial or subscription;
    // an expired account starts today); a pack's invoices join the pack balance.
    async activate(identity, code) {
      const entered = normalize(code);
      if (entered.length !== 16) return -1;
      const used = Store.get('used_codes', []);
      if (used.includes(entered)) return -2;
      const online = await this.redeemOnline(entered);
      if (online === -2) return -2;
      let plan = typeof online === 'object' ? online : null;
      if (!plan) for (const d of PLAN_DAYS) if (d > 0 && entered === normalize(await makeCode(identity, d))) { plan = { days: d, invoices: 0 }; break; }
      if (!plan) return online === -3 && global.Sync && Sync.isSupabase && Sync.isSupabase() ? -3 : -1;
      used.push(entered);
      Store.set('used_codes', used);
      this.applyPlan(plan);
      return plan;
    },
    // What a code or a payment gives: a plan's days follow whatever is still running, a pack's invoices join the
    // balance and the pack's date moves out to its validity from today. Invoices of a pack already past its date are
    // gone: they do not come back with the new pack.
    applyPlan(plan) {
      if (n0(plan.days) > 0) { const until = Math.max(Date.now(), this.expiresAt()) + n0(plan.days) * DAY; Store.set('valid_until', until); this.noteYearly(plan.days, until); this.noteFull(plan, until); }
      if (n0(plan.invoices) > 0) {
        const lapsed = this.packExpired(), packDays = n0(plan.packDays != null ? plan.packDays : plan.pack_days);
        if (lapsed) Store.set('inv_used', Math.max(this.invoicesUsed(), this.invoiceQuota()));
        Store.set('inv_quota', this.invoiceQuota() + n0(plan.invoices));
        // A pack without a validity of its own (bought before packs had one) after a lapsed pack: ten years
        if (packDays > 0 || lapsed) Store.set('inv_until', Math.max(this.packUntil(), Date.now() + (packDays || 3650) * DAY));
      }
    },

    // ---- payments through Cashfree, by way of the Supabase Edge Function server/supabase/functions/cashfree.
    // The function makes a Cashfree payment link for a plan; the customer pays on Cashfree's page and comes back to
    // #subscription?link=<id>; the function (webhook or our status question) then records a grant, and claimGrants()
    // turns grants into validity / pack invoices, exactly as an activation code does.
    paymentsAvailable() { return !!global.Sync && Sync.isSupabase && Sync.isSupabase() && !!Sync.user; },
    async withToken(fn) {
      Supabase.configure(Sync.serverUrl(), Sync.supabaseKey());
      let st = Sync.state();
      if (!st.token) { await Sync.link(st); st = Sync.state(); }
      try { return await fn(Sync.state().token); }
      catch (e) { if (e.status !== 401) throw e; st.token = ''; Sync.save(st); await Sync.link(st); return fn(Sync.state().token); }
    },
    async callPayments(action, body) {
      return this.withToken(async (token) => {
        const r = await fetch(Sync.serverUrl().replace(/\/+$/, '') + '/functions/v1/cashfree?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: Sync.supabaseKey(), Authorization: 'Bearer ' + token }, body: JSON.stringify(body || {}) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { const e = new Error(j.error || (r.status === 404 ? 'Online payment is not set up yet' : 'Payment service error ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    },
    pendingLinks() { return Store.get('pending_links', []) || []; },
    // {link_id, link_url, amount, plan}; the link is remembered until it is known to be paid or abandoned
    async createPaymentLink(planIndex) {
      const r = await this.callPayments('link', { plan: PLAN_KEYS[planIndex] });
      Store.set('pending_links', this.pendingLinks().filter(x => x !== r.link_id).concat([r.link_id]).slice(-10), true);
      return r;
    },
    forgetLink(linkId) { Store.set('pending_links', this.pendingLinks().filter(x => x !== linkId), true); },
    // {paid, status}; a paid link is forgotten here (its grant is collected by claimGrants)
    async checkPayment(linkId) { const r = await this.callPayments('status', { link_id: linkId }); if (r.paid) this.forgetLink(linkId); return r; },
    // Grants from payments not yet applied on any device, applied now; returns them
    async claimGrants() {
      if (!this.paymentsAvailable()) return [];
      try {
        const r = await this.withToken((token) => Supabase.http('POST', '/rest/v1/rpc/claim_grants', {}, token));
        const list = Array.isArray(r) ? r : [];
        list.forEach(g => this.applyPlan(g));
        return list;
      } catch (e) { return []; }
    },
    // Payments started earlier whose outcome is not known yet: ask about each, then collect grants
    async settlePending() {
      const links = this.pendingLinks();
      for (const id of links) { try { const r = await this.checkPayment(id); if (['EXPIRED', 'CANCELLED', 'FAILED'].includes(String(r.status))) this.forgetLink(id); } catch (e) { /* asked again next time */ } }
      return this.claimGrants();
    },
    PLAN_KEYS,
    pendingRequest() { return Store.get('pending_activation', ''); },
    savePendingRequest(t) { Store.set('pending_activation', t); },
    clearPendingRequest() { Store.set('pending_activation', ''); },
    makeCode
  };
  global.Sub = Sub;
})(window);
