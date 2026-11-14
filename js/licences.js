/* BlitzBook web portal - licences: a seat per user, in the manner of the per-user editions of Salesforce.
   The owner of the companies buys seats of a kind for a month or a year (Cashfree, server/supabase/functions/cashfree)
   and the owner or an admin assigns them to the members of a company, or to someone invited, who takes the seat along
   on registering (server/supabase/companies.sql: licences, licence_seats, assign_licence). A member with a seat that is
   running works in the company whatever the owner's own plan or trial does, and gets what the kind opens:
     self  Self Service   the Web Clock, the user's own timesheet and claims, their payslips
     hr    HR             employees, attendance, timesheets, reimbursements, payroll, HR settings
     acc   Accounts       invoices, purchases, inventory, receipts and payments, journal, the reports, GST
     full  Accounts + HR  everything
     pro   Professional   everything, and the Professionals tab (professional.js) printed and exported
     co    Additional company   not a seat: one for every company the account owns after its first
   The kind and its date come with the company list (my_companies: lic, lic_until, lic_seats), so they are known
   offline. Every member needs one: without a running licence the company is locked for that login, whatever plan the
   owner is on (the owner works on their own plan). */
(function (global) {
  'use strict';
  const { esc } = U;
  // Rs per user: for a month, and for a year paid at once (the same prices as the cashfree function charges)
  const KINDS = [
    { key: 'self', name: 'Self Service', month: 49, year: 499, who: 'Every employee', what: 'Web Clock in and out, their own timesheet and claims, their payslips' },
    { key: 'hr', name: 'HR', month: 199, year: 1999, who: 'HR and payroll staff, managers', what: 'Employees, attendance, timesheets, reimbursements, payroll, payslips, HR settings' },
    { key: 'acc', name: 'Accounts', month: 299, year: 2499, who: 'Accountants, billing and sales staff', what: 'Invoices, purchases, inventory, receipts and payments, journal, reports, GST' },
    { key: 'full', name: 'Accounts + HR', month: 449, year: 3999, who: 'Admins and people who do both', what: 'Everything in Accounts and in HR' },
    // The Professionals tab (professional.js) on top of everything else: priced for the people who earn with it
    { key: 'pro', name: 'Professional', month: 999, year: 9999, who: 'Accountants and tax professionals', what: 'Everything in Accounts + HR, and the Professionals tab: project report with projected balance sheet, operating statement, funds flow, depreciation and repayment schedules, DSCR and ratios, printed and exported' },
    // Not a seat for a user: one for every company the account owns after its first (the server counts the companies)
    { key: 'co', name: 'Additional company', month: 149, year: 1499, who: 'One for each company after your first', what: 'The books of one more company under the same login: for accountants and tax professionals who keep the books of several clients', company: true }
  ];
  // The licence a role works with, for Assign by role
  const ROLE_KIND = { employee: 'self', hr: 'hr', manager: 'hr', accountant: 'acc', sales: 'acc', viewer: 'acc', admin: 'full' };
  const rs = (v) => 'Rs ' + U.indianNumber(v).replace(/\.00$/, '');
  const dmy = (ms) => U.dmy(new Date(ms));

  const Lic = {
    KINDS, ROLE_KIND,
    kind(k) { return KINDS.find(x => x.key === k) || null; },
    name(k) { const x = this.kind(k); return x ? x.name : k; },
    // The licence of this login in the company that is open: { kind, until, valid }, null when none is assigned (or the company is one's own)
    mine() {
      if (!Store.cid || !global.Companies) return null;
      const c = Companies.current();
      if (!c || c.role === 'owner' || !this.kind(c.lic) || this.kind(c.lic).company) return null;
      const until = parseInt(c.lic_until, 10) || 0;
      return { kind: c.lic, until, valid: until > Date.now() };
    },
    valid() { const m = this.mine(); return !!m && m.valid; },
    // Every member needs a licence of their own: true in another owner's company once the server knows licences (the
    // company list then carries lic; before companies.sql is run again it does not, and the owner's plan still covers)
    required() { if (!Store.cid || !global.Companies) return false; const c = Companies.current(); return !!c && c.role !== 'owner' && c.lic !== undefined; },
    // A company of the account's own, after its first, that no Additional company licence covers (any more)
    companyUnpaid() { if (!Store.cid || !global.Companies) return false; const c = Companies.current(); return !!c && c.role === 'owner' && c.co_ok === false; },
    // A member who needs a licence and has none that is running, or a company that is not paid for: nothing opens
    missing() { return (this.required() && !this.valid()) || this.companyUnpaid(); },
    // Seats the owner of the open company has running, all kinds together
    seats() { const c = global.Companies ? Companies.current() : null; return c ? parseInt(c.lic_seats, 10) || 0 : 0; },
    // The company the licences are looked at for: the one open, the account's first company otherwise
    cid() { return Store.cid || Companies.myUid(); },
    notSetUp(e) { return e && (e.status === 404 || /licence_summary|assign_licence|my_payslips|schema cache/i.test(e.message || '')); },

    // ------------------------------------------------------------ the Licences screen
    async screen(p) {
      const root = App.view(App.header('Licences') +
        '<div class="card white"><div class="bd"><div class="hint" style="margin:0">A licence is a seat for one user. Buy as many seats of each kind as you have users and assign them below: a user with a licence keeps working in the company whatever happens to the 30-day trial or the plan of the account. A licence can be moved to another user at any time.</div></div></div>' +
        '<div id="lcKinds"><div class="hint">Loading…</div></div><div id="lcMembers"></div>');
      App.wireBack(root);
      const here = () => App.current && App.current.route === 'licences';
      // Back from the payment page: confirm the order, which makes the seats
      if (p && p.link) {
        try { history.replaceState(null, '', location.pathname + location.search + '#licences'); } catch (e) { /* fine */ }
        try { const r = await Sub.checkPayment(p.link); UI.toast(r.paid ? 'Payment received: the licences are added' : 'The payment is not reported as paid yet. If you did pay, open Licences again in a minute.', 6000); } catch (e) { UI.toast(e.message || 'The payment could not be checked', 6000); }
      }
      if (!Companies.available()) { if (here()) $('#lcKinds').innerHTML = '<div class="empty">Licences live in your BlitzBook account on the server. This browser is not signed in to the server right now.</div>'; return; }
      const cid = this.cid(), c = Companies.find(cid) || Companies.current() || {}, owner = !Store.cid || c.role === 'owner';
      const draw = async () => {
        let sum, members;
        try { sum = Companies.checked(await Companies.rpc('licence_summary', { cid }), 'Licences'); members = Companies.checked(await Companies.rpc('list_members', { cid }), 'Members'); }
        catch (e) { if (here()) $('#lcKinds').innerHTML = '<div class="empty">' + esc(this.notSetUp(e) ? 'Licences are not set up on the server yet (run server/supabase/companies.sql and cashfree.sql in the SQL Editor and deploy the cashfree function).' : (e.message || 'The licences could not be loaded') + '.') + '</div>'; return; }
        if (!here()) return;
        const of = new Map((sum.kinds || []).map(k => [k.kind, k]));
        // The owner types how many seats of each kind to buy: every kind in the one payment
        $('#lcKinds').innerHTML = '<div class="tablewrap"><table class="list cards" id="lcTable"><thead><tr><th>Licence</th><th>For</th><th>What it opens</th><th class="num">Per user / month</th><th class="num">Per user / year</th><th class="num">Seats</th><th>Valid till</th>' + (owner ? '<th class="num">Buy seats</th>' : '') + '</tr></thead><tbody>' +
          KINDS.map(k => { const s = of.get(k.key) || { seats: 0, used: 0, until: 0 };
            return '<tr data-kind="' + k.key + '"><td data-l="Licence"><b>' + esc(k.name) + '</b></td><td data-l="For">' + esc(k.who) + '</td><td class="left" data-l="Opens">' + esc(k.what) + '</td><td class="num" data-l="Month">' + rs(k.month) + '</td><td class="num" data-l="Year"><b>' + rs(k.year) + '</b><div class="small muted">' + rs(Math.round(k.year / 12)) + ' a month</div></td>' +
              '<td class="num" data-l="Seats"><b>' + s.used + ' of ' + s.seats + '</b><div class="small muted">' + (k.company ? 'companies' : 'assigned') + '</div>' + (owner && s.seats > 0 ? '<button class="btn sm outline lcLess" data-kind="' + k.key + '" title="Give back seats that are not needed any more (no refund)"' + (s.seats > s.used ? '' : ' disabled') + '>Reduce</button>' : '') + '</td><td data-l="Valid till">' + (s.until ? dmy(s.until) : '-') + '</td>' + (owner ? '<td class="num" data-l="Buy seats"><input type="number" class="lcQty" data-kind="' + k.key + '" min="0" max="500" step="1" placeholder="0" style="width:90px;min-height:34px;text-align:right"></td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>' +
          (owner ? '<div class="btnrow" id="lcCart" style="align-items:center">' + UI.select('lcPeriod', [['year', 'For 1 year'], ['month', 'For 1 month']], 'year', { attrs: ' style="width:auto;min-height:36px"' }) + '<b id="lcTotal" style="flex:1"></b><button class="btn green" id="lcPay" disabled>Pay</button></div><div class="hint">Type the seats to buy beside each kind: any number of users, several kinds at once, one payment on Cashfree (UPI, card or net banking). The seats run from today for the period.</div>' +
            // Seats given with a code (server/supabase/activation.sql, redeem_licence_code): entered here, they join the seats above
            '<div class="btnrow" id="lcCodeRow" style="align-items:center;margin-top:10px"><input id="lcCode" placeholder="Licence activation code (XXXX-XXXX-XXXX-XXXX)" maxlength="24" autocomplete="off" style="flex:1;min-width:220px;text-transform:uppercase"><button class="btn blue" id="lcCodeBtn">Activate code</button></div>'
            : '<div class="hint" style="margin:8px 0">Licences are bought by the owner of the company' + (c.owner_name ? ', ' + esc(c.owner_name) : '') + '; you can assign the ones there are.</div>');
        const list = (Array.isArray(members) ? members : []).filter(m => m.role !== 'owner');
        // A member whose employee record has been offboarded (deactivated) is marked, so the seat can be freed for someone else
        const left = (m) => this.offboarded(m);
        const opts = [['', 'No licence']].concat(KINDS.filter(k => !k.company).map(k => [k.key, k.name]));
        const without = list.filter(m => !m.lic).length;
        // The Additional company licence covers the company, not a user: it is in the list for everyone to see, but cannot be picked
        const coK = KINDS.find(k => k.company), coS = of.get('co') || { seats: 0, used: 0, until: 0 };
        const coSel = '<option value="" disabled>' + esc(coK.name) + ' (covers the company, not a user)</option>';
        const coLine = '<div class="hint" style="margin:6px 0 10px"><b>' + esc(coK.name) + ':</b> ' +
          (c.co_ok === false ? '<span class="pill bad">not covered</span> this company needs one: ' + coS.used + ' additional ' + (coS.used === 1 ? 'company' : 'companies') + ', ' + coS.seats + ' licence' + (coS.seats === 1 ? '' : 's') + ' running. Buy one above or enter a code.'
            : '<span class="pill ok">covered</span> ' + coS.used + ' of ' + coS.seats + ' used' + (coS.until ? ', valid till ' + dmy(coS.until) : '') + '. It is counted against the companies the owner has after the first, so it is not assigned to a member.') + '</div>';
        $('#lcMembers').innerHTML = '<div class="section-title" style="margin-top:16px">Who has which licence in ' + esc(c.name || 'this company') + (list.length ? '<span class="tilehint"><button class="btn sm blue" id="lcAuto"' + (without ? '' : ' disabled') + ' title="Gives every member without a licence the kind their role works with, while seats are free">Assign by role (' + without + ' without)</button></span>' : '') + '</div>' + coLine + (list.length ?
          '<div class="tablewrap"><table class="list cards"><thead><tr><th>Name</th><th>Mobile</th><th>Email</th><th>Role</th><th>Licence</th></tr></thead><tbody>' + list.map((m, n) => '<tr><td data-l="Name"><b>' + esc(m.name || (m.invited ? 'Invited' : '-')) + '</b>' + (m.invited ? '<div class="small muted">Not registered yet</div>' : '') + '</td><td data-l="Mobile">' + esc(m.phone || '-') + '</td><td data-l="Email">' + esc(m.email || '-') + '</td><td data-l="Role"><span class="pill warn">' + esc(Companies.ROLE_LABEL[m.role] || m.role) + '</span>' + (left(m) ? ' <span class="pill bad" title="Their employee record is deactivated (Offboard)">Offboarded</span>' : '') + '</td><td data-l="Licence">' + UI.select('lc_' + n, opts, m.lic || '', { attrs: ' data-n="' + n + '" class="lcPick" style="min-height:34px;padding:4px 8px"' }).replace('</select>', coSel + '</select>') + (m.lic ? ' <button class="btn sm ' + (left(m) ? 'red' : 'outline') + ' lcFree" data-n="' + n + '" title="Take the licence away: the seat is free for someone else">Remove licence</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>' :
          '<div class="empty">No members yet. Add people under Companies &gt; Members, or with Give login on the employee list.</div>') +
          '<div class="hint" style="margin-top:10px">Every member needs a licence: without one that is running the company is locked for that login. The owner works on their own plan (Subscription).</div>';
        $$('.lcFree', root).forEach(b => b.onclick = () => { const m = list[+b.dataset.n]; UI.confirm('Remove licence', 'Take the ' + this.name(m.lic) + ' licence away from ' + (m.name || m.phone || m.email) + '? They are locked out of this company until they get one again; the seat is free for someone else.', async () => { await this.assign(cid, m, ''); draw(); }, 'Remove licence'); });
        $$('.lcLess', root).forEach(b => b.onclick = () => this.reduce(cid, b.dataset.kind, of.get(b.dataset.kind) || { seats: 0, used: 0 }, draw));
        $$('.lcPick', root).forEach(sel => sel.onchange = async () => { const m = list[+sel.dataset.n]; await this.assign(cid, m, sel.value); draw(); });
        // Everybody at once: each member without a licence gets the kind their role works with, while a seat of it is free
        if ($('#lcAuto')) $('#lcAuto').onclick = async () => {
          $('#lcAuto').disabled = true;
          const free = {}; KINDS.forEach(k => { const s = of.get(k.key) || { seats: 0, used: 0 }; free[k.key] = Math.max(0, s.seats - s.used); });
          let done = 0; const short = {};
          for (const m of list) {
            if (m.lic) continue;
            const k = ROLE_KIND[m.role] || 'acc';
            if (free[k] <= 0) { short[k] = (short[k] || 0) + 1; continue; }
            try { Companies.checked(await Companies.rpc('assign_licence', { cid, who_in: m.user_id || m.phone || m.email || '', kind_in: k }), 'Assign'); free[k]--; done++; } catch (e) { short[k] = (short[k] || 0) + 1; }
          }
          const lack = Object.keys(short).map(k => short[k] + ' ' + this.name(k)).join(', ');
          UI.toast(done + ' licence' + (done === 1 ? '' : 's') + ' assigned' + (lack ? '. Seats still needed: ' + lack + ' (buy them above)' : ''), lack ? 8000 : 3000);
          Companies.load().catch(() => null); draw();
        };
        if (owner) {
          const cart = () => { const yearly = UI.val('lcPeriod') !== 'month', items = $$('.lcQty', root).map(i => ({ kind: i.dataset.kind, seats: Math.max(0, Math.min(500, parseInt(i.value, 10) || 0)) })).filter(x => x.seats > 0); return { yearly, items, users: items.reduce((n, x) => n + x.seats, 0), amount: items.reduce((n, x) => n + x.seats * (yearly ? this.kind(x.kind).year : this.kind(x.kind).month), 0) }; };
          const show = () => { const t = cart(); $('#lcTotal').textContent = t.items.length ? t.items.map(x => x.seats + ' ' + this.name(x.kind)).join(' + ') + ' for ' + (t.yearly ? '1 year' : '1 month') + ': ' + rs(t.amount) : ''; $('#lcPay').disabled = !t.items.length; };
          $$('.lcQty', root).forEach(i => i.addEventListener('input', show)); $('#lcPeriod').addEventListener('change', show); show();
          $('#lcPay').onclick = () => { const t = cart(); if (t.items.length) this.pay(t); };
          $('#lcCodeBtn').onclick = async () => {
            const code = String($('#lcCode').value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            if (code.length !== 16) return UI.toast('A licence code has 16 letters and digits');
            $('#lcCodeBtn').disabled = true;
            let r; try { r = await Companies.rpc('redeem_licence_code', { code_in: code }); } catch (e) { r = { error: e && e.status === 404 ? -4 : -3 }; }
            if ($('#lcCodeBtn')) $('#lcCodeBtn').disabled = false;
            if (!r || typeof r !== 'object' || r.error != null) return UI.toast(r && r.error === -2 ? 'This code has already been used' : r && r.error === -1 ? 'This is not a licence code. A plan or invoice-pack code is entered under Subscription.' : r && r.error === -4 ? 'Licence codes are not set up on the server yet (run server/supabase/activation.sql)' : 'The code could not be checked. Check the connection and try again.', 6000);
            UI.toast(r.seats + ' ' + this.name(r.kind) + ' seat' + (r.seats === 1 ? '' : 's') + ' added, valid till ' + dmy(r.until), 6000, 'ok');
            Companies.load().catch(() => null); draw();
          };
        }
      };
      draw();
    },
    // One payment for the seats typed: [{kind, seats}] for a month or a year
    async pay(t) {
      if (!Sub.paymentsAvailable()) return UI.toast('Sign in to the server to buy licences');
      const wait = UI.modal({ title: 'Pay ' + rs(t.amount), body: '<p>Opening the secure payment page for <b>' + esc(t.items.map(x => x.seats + ' ' + this.name(x.kind)).join(', ')) + '</b>…</p>', buttons: [], cancelable: false });
      try {
        const r = await Sub.callPayments('link', { plan: 'lic', items: t.items, period: t.yearly ? 'year' : 'month' });
        // Inside the Android app the payment page opens in the browser; here the portal goes there and comes back
        if (global.Native && Native.android) { wait.remove(); Native.post('open', { url: r.link_url }); UI.alert('Pay in the browser', 'The payment page has opened in your browser. When the payment is done, come back here and open Licences again: the seats are then there.'); return; }
        location.href = r.link_url;
      } catch (e) { wait.remove(); UI.toast(/Unknown plan/i.test(e.message || '') || e.status === 404 ? 'Buying licences is not set up on the server yet (deploy the cashfree function).' : (e.message || 'Could not start the payment'), 7000); }
    },
    // Gives a member or someone invited a licence ('' takes it away); says what happened
    async assign(cid, m, kind) {
      try { Companies.checked(await Companies.rpc('assign_licence', { cid, who_in: m.user_id || m.phone || m.email || '', kind_in: kind }), 'Assign'); UI.toast(kind ? this.name(kind) + ' licence assigned to ' + (m.name || m.phone || m.email) : 'Licence taken away'); Companies.load().catch(() => null); return true; }
      catch (e) { UI.toast(this.notSetUp(e) ? 'Licences are not set up on the server yet' : e.message, 7000); return false; }
    },
    // The employee record of a member (by mobile number or email) is deactivated: they have been offboarded
    offboarded(m) {
      const ph = String(m.phone || '').replace(/\D/g, '').slice(-10), em = String(m.email || '').trim().toLowerCase();
      if (!ph && !em) return false;
      const same = (e) => (ph && String(e.phone || '').replace(/\D/g, '').slice(-10) === ph) || (em && String(e.email || '').trim().toLowerCase() === em);
      const recs = (Store.list('employees') || []).filter(same);
      return recs.length > 0 && recs.every(e => e.active === false);
    },
    // The owner gives back seats of a kind that are free (no refund): asks how many, then the server takes them off
    reduce(cid, kind, s, onDone) {
      const free = Math.max(0, s.seats - s.used), k = this.kind(kind);
      if (!free) return UI.toast('No seat of ' + this.name(kind) + ' is free: ' + (k && k.company ? 'every seat covers a company' : 'take the licence away from a member first'), 6000);
      const bg = UI.modal({ title: 'Reduce ' + this.name(kind) + ' licences', body: '<p>' + s.seats + ' seat' + (s.seats === 1 ? '' : 's') + ' running, ' + s.used + (k && k.company ? ' covering companies' : ' assigned') + ', <b>' + free + ' free</b>.</p>' +
          UI.field('Seats to give back', UI.input('lcLessN', String(free), { type: 'number', attrs: ' min="1" max="' + free + '" step="1"' })) +
          '<div class="hint">The seats that end first are given back. There is no refund for the days left on them.</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Reduce', cls: 'red', onClick: async (bg) => {
          const n = parseInt(UI.val('lcLessN', bg), 10) || 0;
          if (n < 1 || n > free) { UI.mark('lcLessN', true, bg); UI.toast('Give back 1 to ' + free + ' seats'); return false; }
          try { const r = Companies.checked(await Companies.rpc('reduce_licences', { cid, kind_in: kind, seats_in: n }), 'Reduce'); UI.toast(n + ' ' + this.name(kind) + ' seat' + (n === 1 ? '' : 's') + ' given back; ' + r.seats + ' left', 6000, 'ok'); Companies.load().catch(() => null); if (onDone) onDone(); }
          catch (e) { UI.toast(this.notSetUp(e) || e.status === 404 ? 'Reducing licences is not set up on the server yet (run server/supabase/companies.sql)' : e.message, 7000); return false; }
        } }] });
      return bg;
    },

    // ------------------------------------------------------------ My Payslips
    // The login's own payslips of the finalised months: from the server in another owner's company (a member cannot
    // read the payroll, which holds everybody's pay), from the books at hand in one's own
    async payslips() {
      const root = App.view(App.header('My Payslips') + '<div id="psList"><div class="hint">Loading…</div></div>');
      App.wireBack(root);
      const here = () => App.current && App.current.route === 'payslips';
      let list = [];
      try {
        if (Store.cid && Companies.role() !== 'owner') list = Companies.checked(await Companies.rpc('my_payslips', { cid: Store.cid }), 'Payslips');
        else { const me = HR.myEmployee(); list = me ? Store.list('payroll').filter(r => r.status === 'final').map(r => ({ month: r.month, finalisedAt: r.finalisedAt, row: (r.rows || []).find(x => x.empId === me.id) })).filter(x => x.row).sort((a, b) => String(b.month).localeCompare(String(a.month))) : []; }
      } catch (e) { if (here()) $('#psList').innerHTML = '<div class="empty">' + esc(this.notSetUp(e) ? 'Payslips for your own login are not set up on the server yet.' : (e.message || 'The payslips could not be loaded') + '.') + '</div>'; return; }
      if (!here()) return;
      list = Array.isArray(list) ? list : [];
      const num = U.num, money = U.money;
      $('#psList').innerHTML = list.length ? '<div class="tablewrap"><table class="list cards"><thead><tr><th>Month</th><th class="num">Paid days / hours</th><th class="num">Earnings</th><th class="num">Deductions</th><th class="num">Net pay</th><th></th></tr></thead><tbody>' +
        list.map((x, n) => { const r = x.row; return '<tr><td data-l="Month"><b>' + esc(HR.monthLabel(x.month)) + '</b></td><td class="num" data-l="Paid">' + esc(r.payType === 'hourly' ? num(r.hours) + ' h' : num(r.paid) + ' of ' + num(r.days)) + '</td><td class="num" data-l="Earnings">' + money(num(r.gross) + num(r.ot) + num(r.reimb)) + '</td><td class="num" data-l="Deductions">' + money(r.deductions) + '</td><td class="num" data-l="Net pay"><b>' + money(r.net) + '</b></td><td class="actions"><button class="btn sm green" data-slip="' + n + '">Payslip</button></td></tr>'; }).join('') + '</tbody></table></div>' :
        '<div class="empty">No payslips yet. A payslip appears here once the payroll of a month is finalised, for the employee record that carries your mobile number or email.</div>';
      $$('[data-slip]', root).forEach(b => b.onclick = () => { const x = list[+b.dataset.slip]; HR.payslip({ month: x.month, finalisedAt: x.finalisedAt, status: 'final', rows: [x.row] }, x.row); });
    }
  };
  App.routes.licences = (p) => Lic.screen(p || {});
  App.routes.payslips = () => { if (global.HR && !HR.allowed()) { if (!App.current || App.current.route === 'dashboard') App.routes.dashboard({}); HR.lock(); return; } Lic.payslips(); };
  global.Lic = Lic;
})(window);
