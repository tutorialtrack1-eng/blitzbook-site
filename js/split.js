/* BlitzBook web portal - Split Company by Financial Year (Company > Split by Financial Year; Company Profile offers it
   when a later financial year is chosen while the books hold earlier entries; the Android app opens this screen).

   The books of the open company are broken at the first day of a financial year:
     - the company that is open carries on from that day: its members, roles, subscription, links and settings stay as
       they are, and it keeps every entry dated on or after the day;
     - a new company ("Vanya Living (2024-25 to 2025-26)") takes every entry dated before it, with the masters (parties,
       items, accounts, settings), and its books end the day before (booksTo, util.js booksDateError);
     - the company that carries on begins on that day with the closing position of the earlier years, the way a
       financial year is closed and the next one opened:
         * one opening voucher (narration "Opening balances as at ...", ledger.js isOpening) with the balance of every
           real account: cash, bank and every further bank account, each customer and supplier, assets, loans and
           other liabilities, Input and Output GST, reverse-charge GST payable, TDS payable, and the capital accounts;
           income, expense and purchase accounts are closed: the profit or loss of the earlier years, with the
           drawings, goes into Capital, which is the balancing figure, so the new year opens with the owner's capital
           exactly as the earlier years closed it;
         * the unpaid bills, each with its own number, date and party (the voucher's bills, appformat.js; outstanding
           and payables count them), so receipts and payments of the new year knock off against them;
         * the closing stock as opening stock (an STK document dated that day), lot by lot under FIFO and at the
           valuation's own rate otherwise, with the stock at every location other than Main moved there by a transfer.
   The closing figures are read from the same Books.balanceSheet the Balance Sheet shows, so the new year's opening
   Balance Sheet equals the earlier years' closing one, line by line.

   What is not split: HR & payroll, procurement, hotel, rentals, manpower and the roles stay with the company that
   carries on (payroll already posted its journal vouchers, and those move by date like every other entry).

   The new company is made on the server (companies.sql split_company: no Additional company licence for it), filled
   there first, and only then are the earlier entries taken out of the open company and the opening balances put in,
   so nothing is lost if the connection drops half way. */
(function (global) {
  'use strict';
  const { esc, money } = U;
  const num = U.num, r2 = (v) => U.round2(v), lower = (s) => String(s || '').trim().toLowerCase(), DAY = 86400000;
  // Entries of a financial year: they go with the company that keeps the year they are dated in
  const DATED = ['invoices', 'challans', 'purchases', 'expenses', 'journal', 'notes', 'bank'];
  const DATED_INV = ['ADJ', 'TRF', 'CNT'];   // inventory documents with a date; recipes, item settings and the settings stay with both
  const MASTERS = ['contacts', 'items', 'accounts'];
  const SINGLES = ['settings', 'biz', 'fx'];
  // Where amounts that belong to no named party are carried (credit sales or purchases with no party, expenses on credit)
  const LOOSE_DR = 'Sundry Debtors', LOOSE_CR = 'Outstanding Expenses';
  const LABEL = { invoices: 'Invoices', challans: 'Delivery challans', purchases: 'Purchases, quotations & stock', expenses: 'Expenses', journal: 'Journal, receipts & payments', notes: 'Credit & debit notes', bank: 'Bank statement lines', inventory: 'Stock adjustments, counts & transfers' };

  const fyOf = (ms, m) => U.fyFirstYear(new Date(ms), m);

  const Split = {
    // Why the open company cannot be split ('' when it can)
    why() {
      if (!global.Companies || !Companies.available()) return 'Splitting makes a second company in BlitzBook\'s cloud: sign in with sync on first.';
      if (Companies.role() !== 'owner') return 'Only the owner of the company can split its books.';
      const end = U.booksEnd(); if (end) return 'This company already holds the earlier years of a split: its books end on ' + U.dmy(end) + '.';
      return '';
    },
    // The financial years the books can be split at (the calendar year each starts in), latest first: every year
    // after the one the earliest entry is in, up to the running one
    choices() {
      const first = Store.whole(() => Store.earliestEntry()); if (!first) return [];
      const m = U.fyMonth(), a = fyOf(first.ms, m) + 1, b = fyOf(Date.now(), m), out = [];
      for (let y = b; y >= a; y--) out.push(y);
      return out;
    },
    defaultName(year) {
      const m = U.fyMonth(), first = Store.whole(() => Store.earliestEntry()), from = first ? fyOf(first.ms, m) : year - 1;
      const a = U.fyLabel(from, m), b = U.fyLabel(year - 1, m);
      return (Store.company().name || 'Company') + ' (' + (a === b ? a : a + ' to ' + b) + ')';
    },

    /* Everything the split does, worked out without changing anything: the opening voucher, the bills, the opening
       stock, the entries that move and the ones that stay. year = the calendar year the new financial year starts in. */
    plan(year) {
      return Store.whole(() => {
        const m = U.fyMonth(), S = U.fyStartDate(year, m).getTime(), asAt = S - 1, day = U.dmy(new Date(S)), lastDay = U.dmy(new Date(S - DAY));
        const before = (d) => { const ms = U.dateMs(d && d.date); return !!ms && ms < S; };
        const bs = Books.balanceSheet(asAt), nature = Books.natures();

        // ---- the opening voucher: every real account at its closing balance (Dr positive, Cr negative)
        const lines = [], put = (account, v) => { v = r2(v); if (Math.abs(v) < 0.005) return; const at = lines.find(l => lower(l.account) === lower(account)); const cur = at ? (at.side === 'Dr' ? at.amount : -at.amount) + v : v; if (at) lines.splice(lines.indexOf(at), 1); if (Math.abs(r2(cur)) >= 0.005) lines.push({ account, side: cur > 0 ? 'Dr' : 'Cr', amount: Math.abs(r2(cur)) }); };
        put('Cash', bs.cash); put('Bank', bs.bank);
        bs.assets.forEach(a => put(a[0], a[1]));
        let partyDr = 0, partyCr = 0;
        bs.parties.forEach(p => { put(p[0], p[1]); if (p[1] > 0) partyDr += p[1]; else partyCr -= p[1]; });
        put(LOOSE_DR, bs.receivables - partyDr); put(LOOSE_CR, -(bs.payables - partyCr));
        put('Input CGST', bs.inCgst); put('Input SGST', bs.inSgst); put('Input IGST', bs.inIgst);
        put('Output CGST', -bs.outCgst); put('Output SGST', -bs.outSgst); put('Output IGST', -bs.outIgst);
        put('RCM GST Payable', -bs.rcmPayable); put('TDS Payable', -bs.tdsPayable);
        bs.liabilities.forEach(l => put(l[0], -l[1]));
        // Capital accounts of their own (a partner's capital, reserves) are carried as they stand; Drawings and the
        // profit or loss of the earlier years are closed into Capital below
        const capNames = new Set(['capital']);
        Books.journalBalances(null, asAt).forEach(b => { if (nature(b.name) === Books.N.CAPITAL && !/^(capital|drawings?)$/i.test(String(b.name).trim())) { put(b.name, b.v); capNames.add(lower(b.name)); } });

        const stock = this.stockPlan(asAt, day);
        const side = (s, f) => lines.filter(l => l.side === s && (!f || f(l))).reduce((t, l) => t + l.amount, 0);
        // Capital is the balancing figure: with the opening stock it makes the owner's capital what the earlier years closed with
        const capitalCr = r2(side('Dr') - side('Cr'));
        put('Capital', -capitalCr);
        lines.sort((a, b) => (a.side === b.side ? 0 : a.side === 'Dr' ? -1 : 1));
        // The owner's capital the new year's Balance Sheet will show (the balancing figure there): what the real
        // accounts and the opening stock come to. It must be the capital the earlier years closed with.
        const real = (l) => !capNames.has(lower(l.account));
        const opensWith = r2(side('Dr', real) - side('Cr', real) + stock.worth), ties = Math.abs(opensWith - r2(bs.capital)) < 0.05;

        // ---- the unpaid bills, each under its number with the year it is of, so it never meets a number of the new year
        const tag = (date) => ' (' + U.fyLabel(fyOf(U.dateMs(date) || asAt, m), m) + ')';
        const bills = [];
        Biz.outstanding(asAt).open.forEach(r => bills.push({ no: r.opening ? r.no : r.no + tag(r.date), date: r.date, party: r.party === '(cash sale)' ? '' : r.party, amount: r2(r.balance), side: 'recv' }));
        Books.payables(asAt).open.forEach(r => bills.push({ no: r.opening ? r.no : r.no + tag(r.date), date: r.date, party: r.party === '(no supplier)' ? '' : r.party, amount: r2(r.balance), side: 'pay' }));

        // ---- parties and accounts the voucher names that are not in the books as such yet
        const known = new Set(Books.accounts().map(a => lower(a.name)));
        const newContacts = [], newAccounts = [];
        lines.forEach(l => {
          if (known.has(lower(l.account))) return;
          const party = bs.parties.find(p => lower(p[0]) === lower(l.account));
          if (party) newContacts.push({ name: l.account, type: party[1] > 0 ? 'Customer' : 'Supplier' });
          else newAccounts.push({ name: l.account, nature: l.account === LOOSE_DR ? Books.N.ASSET : Books.N.LIABILITY });
          known.add(lower(l.account));
        });

        // ---- what moves and what stays
        const old = {}, keep = {}, counts = {};
        DATED.forEach(col => { const all = Store.list(col); old[col] = all.filter(before); keep[col] = all.filter(d => !before(d)); counts[col] = old[col].length; });
        // Inventory: adjustments, counts and transfers go by their date; recipes, item settings and the settings go to both
        const invAll = Store.list('inventory'), invDated = (d) => DATED_INV.includes(d.kind) && before(d);
        old.inventory = invAll.filter(d => !DATED_INV.includes(d.kind) || invDated(d));
        keep.inventory = invAll.filter(d => !invDated(d));
        const movedInv = invAll.filter(invDated);
        counts.inventory = movedInv.length;
        // An opening voucher the company that carries on already has on that day is replaced by the one worked out here
        const replaced = keep.journal.filter(j => !j.vtype && Books.isOpening(j) && U.dateMs(j.date) === S);
        keep.journal = keep.journal.filter(j => !replaced.includes(j));
        const moving = Object.keys(counts).reduce((t, k) => t + counts[k], 0);
        // Receipts, payments and notes of the new year already entered against a bill of the earlier years now name
        // that bill as it is carried forward ("INV-0007" -> "INV-0007 (2025-26)"), unless a bill of the new year has
        // the same number (numbers that start again each year): then they are about that one
        const renRecv = new Map(), renPay = new Map();
        const keptNo = (col, f) => new Set(keep[col].filter(f).map(x => lower(x.no)));
        const newInv = keptNo('invoices', i => i.kind === 'invoice'), newPur = keptNo('purchases', x => x.kind === 'PUR');
        Biz.outstanding(asAt).open.forEach(r => { if (!r.opening && !newInv.has(lower(r.no))) renRecv.set(lower(r.no), r.no + tag(r.date)); });
        Books.payables(asAt).open.forEach(r => { if (!r.opening && !newPur.has(lower(r.no))) renPay.set(lower(r.no), r.no + tag(r.date)); });
        const ren = { recv: renRecv, pay: renPay };
        const notesRepointed = keep.notes.filter(n => this.repoint(n, ren)).length;
        const repointed = keep.journal.filter(j => this.repoint(j, ren)).length + notesRepointed;
        const masters = {}; MASTERS.forEach(col => { masters[col] = Store.list(col); });
        const singles = {}; SINGLES.forEach(k => { const v = Store.get(k, null); if (v && typeof v === 'object' && Object.keys(v).length) singles[k] = v; });
        const lastYear = Books.profitLoss(U.fyStartDate(year - 1, m).getTime(), asAt);
        return { year, month: m, S, day, lastDay, bs, lines, bills, stock, newContacts, newAccounts, old, keep, counts, moving, replaced: replaced.length, masters, singles,
          movedInv, replacedIds: replaced.map(j => j.id), ren, repointed, notesRepointed,
          capital: bs.capital, capitalCr, opensWith, ties, lastProfit: lastYear.netProfit, label: U.fyLabel(year, m), prevLabel: U.fyLabel(year - 1, m) };
      });
    },

    // Points a receipt, payment or note of the new year at the name an old bill is carried forward under; true when it changed
    repoint(r, ren) {
      const name = (m, no) => m.get(lower(no)) || no;
      if (r.kind === 'CN' || r.kind === 'DN') { if (!r.ref) return false; const to = name(r.kind === 'CN' ? ren.recv : ren.pay, r.ref); if (to === r.ref) return false; r.ref = to; return true; }
      const m = r.vtype === 'receipt' ? ren.recv : r.vtype === 'payment' ? ren.pay : null; if (!m) return false;
      const was = JSON.stringify([r.alloc, r.ref]);
      if (Array.isArray(r.alloc)) r.alloc = r.alloc.map(a => Object.assign({}, a, { no: name(m, a.no) }));
      if (r.ref) r.ref = String(r.ref).split(',').map(x => name(m, x.trim())).join(', ');
      return JSON.stringify([r.alloc, r.ref]) !== was;
    },

    /* The closing stock as opening stock: one STK document dated the day the new year begins, its lines valued so the
       stock is worth exactly what the earlier years closed with (FIFO lot by lot, the average or last rate otherwise),
       and a transfer to every location other than Main that held stock. Items below zero start at zero. */
    stockPlan(asAt, day) {
      const rows = Books.stock(asAt), method = global.Inv ? Inv.settings().method : 'last', items = [];
      let value = 0, below = 0;
      const line = (r, qty, rate) => ({ name: r.name, hsn: r.hsn || '', qty: Math.round(qty * 1000) / 1000, uqc: r.uqc || 'NOS', rate: Math.round(rate * 10000) / 10000, gst: '0', stock: true });
      rows.forEach(r => {
        if (!(r.onHand > 1e-9)) { if (r.onHand < -1e-9) below++; return; }
        const v = num(r.value);
        const layers = method === 'fifo' && Array.isArray(r.layers) ? r.layers.filter(l => l.qty > 1e-9) : [];
        const lq = layers.reduce((s, l) => s + l.qty, 0), lv = layers.reduce((s, l) => s + l.qty * l.rate, 0);
        if (layers.length > 1 && Math.abs(lq - r.onHand) < 1e-6 && Math.abs(lv - v) < 0.01) layers.forEach(l => items.push(line(r, l.qty, l.rate)));
        else items.push(line(r, r.onHand, v / r.onHand));
        value += v;
      });
      const transfers = [];
      if (global.Inv && Inv.byLocation) {
        const at = Inv.byLocation(asAt), by = new Map();
        at.rows.forEach(r => Object.keys(r.by).forEach(loc => { const q = num(r.by[loc]); if (loc === 'Main' || q <= 1e-9) return; if (!by.has(loc)) by.set(loc, []); by.get(loc).push({ name: r.name, qty: Math.round(q * 1000) / 1000, uqc: r.uqc || '' }); }));
        by.forEach((list, loc) => transfers.push({ kind: 'TRF', date: day, from: 'Main', to: loc, notes: 'Stock at ' + loc + ' brought forward', items: list }));
      }
      const worth = items.reduce((s, it) => s + it.qty * it.rate, 0);
      return { items, value: r2(value), worth: r2(worth), below, transfers, method };
    },

    // The records of the company that keeps the earlier years, as rows of the books table
    archiveRows(p, aid, name) {
      const ns = Store.ns(App.user.id, aid), co = Store.company();
      const rows = Companies.within(ns, aid, () => {
        const wasQuiet = Store.quiet; Store.quiet = true;
        try {
          Store.set('company', Object.assign({}, co, { name, booksTo: p.lastDay }), true);
          DATED.forEach(col => Store.set(col, p.old[col], true));
          Store.set('inventory', p.old.inventory, true);
          MASTERS.forEach(col => Store.set(col, p.masters[col], true));
          Object.keys(p.singles).forEach(k => Store.set(k, p.singles[k], true));
          const snap = AppFormat.snapshot(); delete snap.sub;
          return Object.keys(snap).map(k => ({ user_id: aid, k, d: snap[k] }));
        } finally { Store.quiet = wasQuiet; Store.wipe(ns); }
      });
      U.regionReset();
      return rows;
    },

    /* The open company after the split: the earlier entries out (by id: whatever else the books hold now stays), the
       new year's receipts, payments and notes pointed at the carried bills, the opening balances and the opening stock in */
    applyHere(p, aName) {
      Store.whole(() => {
        const contacts = Store.list('contacts'), accounts = Store.list('accounts');
        p.newContacts.forEach(c => { if (!contacts.some(x => lower(x.name) === lower(c.name))) contacts.push({ id: U.uid(), createdAt: Date.now(), no: Ledger.nextContactNo(c.type, contacts), type: c.type, name: c.name, phone: '', email: '', gstin: '', state: '', address: '', tds: false, tdsSection: '', tdsRate: 0 }); });
        p.newAccounts.forEach(a => { if (!accounts.some(x => lower(x.name) === lower(a.name))) accounts.push({ id: U.uid(), createdAt: Date.now(), name: a.name, nature: a.nature }); });
        if (p.newContacts.length) Store.set('contacts', contacts);
        if (p.newAccounts.length) Store.set('accounts', accounts);

        // Only the lists that change are written (each write is sent to the server and the app)
        DATED.forEach(col => {
          const gone = new Set(p.old[col].map(x => x.id)); if (col === 'journal') p.replacedIds.forEach(id => gone.add(id));
          const list = Store.list(col).filter(x => !gone.has(x.id));
          let changed = gone.size > 0;
          if (col === 'journal' || col === 'notes') list.forEach(r => { if (this.repoint(r, p.ren)) changed = true; });
          if (col === 'journal' && p.lines.length) { list.push({ id: U.uid(), createdAt: Date.now(), date: p.day, narration: 'Opening balances as at ' + p.day + ', brought forward from ' + aName + ' (books split by financial year)', lines: p.lines.map(l => Object.assign({}, l)), bills: p.bills.map(b => Object.assign({}, b)) }); changed = true; }
          if (col === 'purchases' && p.stock.items.length) {
            let max = 0; list.forEach(x => { const mm = /^STK-\s*(\d+)\s*$/.exec(x.no || ''); if (mm) max = Math.max(max, +mm[1]); });
            list.push(Ledger.purchaseTotals({ id: U.uid(), createdAt: Date.now(), kind: 'STK', no: 'STK-' + String(max + 1).padStart(4, '0'), date: p.day, supplier: 'Opening stock', supplierGstin: '', paidBy: 'Credit', rcm: false, inclusive: false, tdsRate: 0, tdsSection: '', items: p.stock.items.map(it => Object.assign({}, it)), notes: 'Closing stock of ' + p.prevLabel + ' brought forward from ' + aName }));
            changed = true;
          }
          if (changed) Store.set(col, list);
        });
        const goneInv = new Set(p.movedInv.map(d => d.id)), inventory = Store.list('inventory').filter(d => !goneInv.has(d.id));
        if (p.stock.transfers.length) {
          let max = 0; inventory.forEach(d => { const mm = /^TRF-(\d+)$/.exec(d.no || ''); if (mm) max = Math.max(max, +mm[1]); });
          p.stock.transfers.forEach(t => inventory.push(Object.assign({ id: U.uid(), createdAt: Date.now(), no: 'TRF-' + String(++max).padStart(4, '0') }, t)));
        }
        if (goneInv.size || p.stock.transfers.length) Store.set('inventory', inventory);
        Store.saveCompany(Object.assign({}, Store.company(), { fyStart: String(p.year), fyMonth: p.month, booksFrom: '', booksTo: '' }));
      });
    },

    // Splits the open company at the financial year that starts in year; step(text) reports progress
    async run(year, name, step) {
      step = step || (() => {});
      const why = this.why(); if (why) throw new Error(why);
      name = String(name || '').trim().slice(0, 120); if (!name) throw new Error('Enter the name of the company for the earlier years');
      step('Syncing with the server…');
      await Sync.run();
      if (!Sync.settled()) throw new Error('Could not sync with the server (' + (Sync.lastError || Sync.status) + '). The split needs every entry on the server first: check the connection and try again.');
      const p = this.plan(year);
      if (!p.moving) throw new Error('Nothing is dated before ' + p.day + ': there is nothing to split.');
      // Sync rests while the split works, so nothing arrives half way; it starts again at the end and sends the result
      const user = Sync.user, cidWas = Store.cid;
      Sync.stop();
      const resume = () => { if (user && Store.cid === cidWas && !Sync.user) return Sync.start(user); return Sync.run(); };
      let aid;
      try {
        step('Creating ' + name + '…');
        let r;
        try { r = Companies.checked(await Companies.rpc('split_company', { cid: Store.cid || Companies.myUid(), name_in: name }), 'Split'); }
        catch (e) { if (e.status === 404 || /split_company|function/i.test(e.message || '')) throw new Error('The server is not ready to split companies yet: run server/supabase/split.sql once in the Supabase SQL Editor.'); throw e; }
        aid = r.id;
        try {
          step('Copying the earlier years to ' + name + '…');
          const rows = this.archiveRows(p, aid, name);
          for (let i = 0; i < rows.length; i += 200) {
            const chunk = rows.slice(i, i + 200);
            await Sub.withToken((token) => Supabase.http('POST', '/rest/v1/books?on_conflict=user_id,k', chunk, token, { Prefer: 'resolution=merge-duplicates,return=minimal', 'X-Company': aid }));
            step('Copying the earlier years to ' + name + '… ' + Math.min(rows.length, i + 200) + ' of ' + rows.length);
          }
        } catch (e) {
          try { await Companies.rpc('delete_company', { cid: aid }); } catch (x) { /* left for the owner to delete */ }
          throw new Error('The earlier years could not be copied (' + (e.message || 'no connection') + '). Nothing was changed in this company.');
        }
        step('Carrying the balances forward…');
        this.applyHere(p, name);
      } catch (e) { await resume(); throw e; }
      step('Syncing with the server…');
      await resume();
      await Companies.load().catch(() => null);
      return { id: aid, name, plan: p };
    },

    // ------------------------------------------------------------ the screen
    screen(params) {
      const why = this.why(), years = why ? [] : this.choices();
      const want = parseInt(params && params.year, 10), year = years.includes(want) ? want : years[0];
      const root = App.view(App.header('Split Company by Financial Year', '') +
        '<div class="card white"><div class="bd">' +
        '<p>Break the books at the start of a financial year. <b>' + esc(Store.company().name || 'This company') + '</b> carries on from that day with its members, roles, subscription and settings, and begins the year with the <b>closing balances of the earlier years as its opening balances</b>: every party, cash, bank, assets, loans, GST and TDS, the unpaid bills one by one, and the closing stock as opening stock. The profit or loss of the earlier years and the drawings close into Capital. The earlier years move to a <b>new company</b> of their own (no extra licence), where they stay to be looked at, corrected and reported on.</p>' +
        (why ? '<div class="empty">' + esc(why) + '</div>' : !years.length ? '<div class="empty">The books hold no entries from an earlier financial year: there is nothing to split.</div>' :
          '<div class="grid2">' + UI.field('The new financial year starts on', UI.select('spYear', years.map(y => [String(y), U.dmy(U.fyStartDate(y)) + '  (' + U.fyLabel(y) + ')']), String(year))) +
          UI.field('Company for the earlier years', UI.input('spName', this.defaultName(year), { attrs: ' maxlength="120"' }), { hint: 'The new company that keeps the entries dated before that day' }) + '</div>' +
          '<div id="spPlan"></div>') +
        '</div></div>');
      App.wireBack(root);
      if (why || !years.length) return;
      let named = false;
      $('#spName').addEventListener('input', () => { named = true; });
      const draw = () => {
        const y = parseInt(UI.val('spYear'), 10); if (!named) $('#spName').value = this.defaultName(y);
        const p = this.plan(y);
        const dr = p.lines.filter(l => l.side === 'Dr'), cr = p.lines.filter(l => l.side === 'Cr'), tot = (l) => l.reduce((s, x) => s + x.amount, 0);
        const recv = p.bills.filter(b => b.side === 'recv'), pay = p.bills.filter(b => b.side === 'pay'), sumB = (l) => l.reduce((s, b) => s + b.amount, 0);
        const ok = p.ties;
        $('#spPlan').innerHTML =
          '<h3 style="margin:16px 0 6px">What moves to the new company</h3>' +
          '<table class="list"><tbody>' + Object.keys(p.counts).filter(k => p.counts[k]).map(k => '<tr><td>' + esc(LABEL[k]) + '</td><td class="num"><b>' + p.counts[k] + '</b></td></tr>').join('') +
          '<tr><td>Everything dated up to</td><td class="num"><b>' + esc(p.lastDay) + '</b></td></tr></tbody></table>' +
          '<div class="hint">Parties, items, accounts and settings are copied to it as well. HR & payroll, procurement, hotel and rentals stay here.</div>' +
          '<h3 style="margin:16px 0 6px">Opening balances on ' + esc(p.day) + '</h3>' +
          '<div class="tablewrap"><table class="list"><thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>' +
          p.lines.map(l => '<tr><td>' + esc(l.account) + (l.account === 'Capital' ? ' <span class="small muted">(balancing: capital ' + money(p.capital) + ' less opening stock)</span>' : '') + '</td><td class="num">' + (l.side === 'Dr' ? money(l.amount) : '') + '</td><td class="num">' + (l.side === 'Cr' ? money(l.amount) : '') + '</td></tr>').join('') +
          '<tr class="tot"><td><b>Total</b></td><td class="num"><b>' + money(tot(dr)) + '</b></td><td class="num"><b>' + money(tot(cr)) + '</b></td></tr></tbody></table></div>' +
          '<table class="list" style="margin-top:10px"><tbody>' +
          '<tr><td>Opening stock (' + p.stock.items.length + ' line' + (p.stock.items.length === 1 ? '' : 's') + ', ' + esc({ last: 'last purchase rate', avg: 'weighted average', fifo: 'FIFO lots' }[p.stock.method] || p.stock.method) + ')' + (p.stock.transfers.length ? ', moved to ' + p.stock.transfers.map(t => esc(t.to)).join(', ') : '') + (p.stock.below ? '<div class="small red">' + p.stock.below + ' item' + (p.stock.below === 1 ? ' is' : 's are') + ' below zero and start' + (p.stock.below === 1 ? 's' : '') + ' at zero</div>' : '') + '</td><td class="num"><b>' + money(p.stock.worth) + '</b></td></tr>' +
          '<tr><td>Unpaid sales invoices carried forward (' + recv.length + ')</td><td class="num"><b>' + money(sumB(recv)) + '</b></td></tr>' +
          '<tr><td>Unpaid purchase bills carried forward (' + pay.length + ')</td><td class="num"><b>' + money(sumB(pay)) + '</b></td></tr>' +
          '<tr><td>Profit or loss of ' + esc(p.prevLabel) + ' (closed into Capital)</td><td class="num"><b>' + money(p.lastProfit) + '</b></td></tr>' +
          '<tr><td>Owner\'s capital the new year opens with</td><td class="num"><b>' + money(p.capital) + '</b> ' + (ok ? '<span class="pill ok">ties with the closing Balance Sheet</span>' : '<span class="pill warn">check</span>') + '</td></tr></tbody></table>' +
          (p.newContacts.length || p.newAccounts.length ? '<div class="hint">Made in the books for the opening balances: ' + esc(p.newContacts.map(c => c.name + ' (' + c.type.toLowerCase() + ')').concat(p.newAccounts.map(a => a.name)).join(', ')) + '.</div>' : '') +
          (p.replaced ? '<div class="hint red">The opening balances already entered on ' + esc(p.day) + ' are replaced by these.</div>' : '') +
          (p.repointed ? '<div class="hint">' + p.repointed + ' receipt' + (p.repointed === 1 ? '' : 's') + ', payment' + (p.repointed === 1 ? '' : 's') + ' or note' + (p.repointed === 1 ? '' : 's') + ' of the new year already knocked off against bills of the earlier years: they will name those bills as carried forward.</div>' : '') +
          '<div class="hint" style="margin-top:10px">Before splitting: open the app on every phone that keeps these books so that what was entered there is on the server. Invoice numbers without {FY} in the format start again from 1 in the new year, which the GST rules allow (a number is unique within a financial year); the unpaid bills carry the year in their number, e.g. "' + esc((p.bills[0] && p.bills[0].no) || 'INV-0007 (' + p.prevLabel + ')') + '".</div>' +
          '<div class="btnrow" style="margin-top:12px"><button class="btn outline" id="spBackup">Download a backup first</button><button class="btn red" id="spGo"' + (p.moving ? '' : ' disabled') + '>Split the books</button></div><div id="spStep" class="hint"></div>';
        $('#spBackup').onclick = () => { UI.download('BlitzBook_' + String(Store.company().name || 'books').replace(/[^\w]+/g, '_') + '_before_split.json', JSON.stringify(Store.exportAll()), 'application/json'); UI.toast('Backup downloaded'); };
        $('#spGo').onclick = () => {
          const name = String(UI.val('spName')).trim();
          if (!name) { UI.mark('spName', true); return UI.toast('Enter the name of the company for the earlier years'); }
          UI.confirm('Split the books', 'Move ' + p.moving + ' entr' + (p.moving === 1 ? 'y' : 'ies') + ' dated up to ' + p.lastDay + ' to a new company "' + name + '", and begin ' + (Store.company().name || 'this company') + ' on ' + p.day + ' with the opening balances shown?\n\nThe new company has the earlier years in full; this one keeps only what is dated from ' + p.day + '.', async () => {
            $('#spGo').disabled = true; $('#spYear').disabled = true;
            try {
              const res = await this.run(y, name, (t) => { if ($('#spStep')) $('#spStep').textContent = t; });
              UI.alert('Books split', esc(Store.company().name || 'This company') + ' now begins on ' + esc(res.plan.day) + ' with the opening balances of the earlier years. The entries up to ' + esc(res.plan.lastDay) + ' are in "' + esc(res.name) + '": open it from the company chip in the top bar.');
              App.refreshBar && App.refreshBar(); App.refreshNav && App.refreshNav();
              App.go('balance');
            } catch (e) { if ($('#spStep')) $('#spStep').textContent = ''; if ($('#spGo')) $('#spGo').disabled = false; if ($('#spYear')) $('#spYear').disabled = false; UI.alert('Split not done', esc(e.message || String(e))); }
          }, 'Split');
        };
      };
      $('#spYear').addEventListener('change', draw);
      draw();
    }
  };
  App.routes.split = (p) => Split.screen(p || {});
  global.Split = Split;
})(window);
