/* The Recent panel: a column on the right of every screen with what was touched last in the books that the
   screen is about. On the invoice editor it is the recent products (a tap puts one on the invoice), the last
   invoices and the customers billed last; on Purchases the last bills, the items bought and the suppliers; on
   Stock the stock entries and the items; and so on for every screen (SCREENS below). Each entry is a link that
   opens the record. The panel is hidden with its x and brought back with the floating "Recent" pill (this
   browser remembers the choice, like dark mode); the gear chooses per screen which sections to show and how
   many entries, kept with the account's books (not synced, like the tile order). Under 1100px wide the panel
   is a drawer over the page instead of a column. */
(function (global) {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const money = (v) => U.money(num(v));
  const HIDE_KEY = 'blitzbook.aside';   // 'hidden' when the panel was closed in this browser
  const CFG_KEY = 'aside_cfg';          // { screen: { off: [sectionKey...], n: 8 } } in the account's books
  const COUNTS = [5, 8, 12, 20];
  // Last touched first: the time it was saved or changed here, else its date (records that came from the app);
  // ties go by date, then by number, then by the order they were added
  const stamp = (r) => Math.max(num(r.updatedAt), num(r.createdAt), U.dateMs(r.date) || 0);
  const newest = (list) => list.map((r, i) => ({ r, i })).sort((a, b) => stamp(b.r) - stamp(a.r) || U.dateMs(b.r.date) - U.dateMs(a.r.date) || String(b.r.no || '').localeCompare(String(a.r.no || ''), undefined, { numeric: true }) || b.i - a.i).map(x => x.r);
  const firstLine = (s) => String(s || '').split('\n')[0].trim();
  const invTotal = (i) => i.totals ? (num(i.totals.rounded) || num(i.totals.grand)) : 0;
  const take = (list, n) => list.slice(0, n);

  // Distinct names, in the order they were last used, out of the line items of the newest documents
  function recentNames(docs, field, n) {
    const out = [], seen = new Set();
    for (const d of newest(docs)) {
      for (const it of (d.items || [])) {
        const name = String(it[field] || '').trim(), k = name.toLowerCase();
        if (!name || seen.has(k)) continue;
        seen.add(k); out.push({ name, hsn: it.hsn || '', gst: it.gst, rate: it.rate, uqc: it.uqc });
        if (out.length >= n) return out;
      }
    }
    return out;
  }
  // Distinct party names out of the newest documents (invoices: the buyer's first line; purchases: the supplier)
  function recentParties(docs, nameOf, n) {
    const out = [], seen = new Set();
    for (const d of newest(docs)) {
      const name = String(nameOf(d) || '').trim(), k = name.toLowerCase();
      if (!name || seen.has(k)) continue;
      seen.add(k); out.push(name);
      if (out.length >= n) break;
    }
    return out;
  }
  const contactByName = (name) => { const k = String(name || '').trim().toLowerCase(); return Store.list('contacts').find(c => String(c.name || '').trim().toLowerCase() === k) || null; };

  // ---- the sections: each gives rows { t (title), s (subtitle), r (right), go (what a tap does) } ----
  const row = (t, s, r, go) => ({ t, s, r, go });
  const SECTIONS = {
    products: { t: 'Recent products', ic: 'box', rows: (n) => recentNames(Store.list('invoices'), 'desc', n).map(p => {
      const m = Biz.findMaster(p.name), rate = m && !m.hidden && num(m.rate) > 0 ? m.rate : p.rate;
      return row(p.name, (p.hsn ? 'HSN ' + p.hsn + ' · ' : '') + (p.gst != null ? 'GST ' + p.gst + '%' : ''), num(rate) > 0 ? U.indianNumber(num(rate)) : '', { product: p.name });
    }) },
    invoices: { t: 'Recent invoices', ic: 'receipt', rows: (n) => take(newest(Store.list('invoices')), n).map(i => row(i.no, firstLine(i.buyer && i.buyer.name) + ' · ' + i.date, money(invTotal(i)), { route: 'invoice', params: { id: i.id } })) },
    challans: { t: 'Recent challans', ic: 'truck', rows: (n) => take(newest(Store.list('challans')), n).map(d => row(d.no, firstLine(d.buyer && d.buyer.name) + ' · ' + d.date, d.invoiceNo ? 'Invoiced' : '', { route: 'invoice', params: { challan: d.id } })) },
    customers: { t: 'Recent customers', ic: 'user', rows: (n) => recentParties(Store.list('invoices'), (i) => firstLine(i.buyer && i.buyer.name), n).map(name => { const c = contactByName(name); return row(name, c ? (c.phone || c.gstin || '') : 'Not in contacts yet', '', c ? { contact: c } : { route: 'contacts', params: { type: 'Customer' } }); }) },
    purchases: { t: 'Recent purchases', ic: 'cart', rows: (n) => take(newest(Store.list('purchases').filter(p => p.kind !== 'STK')), n).map(p => row(p.no, (p.supplier || '-') + ' · ' + p.date, money(p.total), { no: p.no })) },
    bought: { t: 'Recently bought items', ic: 'box', rows: (n) => recentNames(Store.list('purchases').filter(p => p.kind !== 'QTN'), 'name', n).map(p => row(p.name, (p.hsn ? 'HSN ' + p.hsn + ' · ' : '') + 'GST ' + (p.gst || '0') + '%', num(p.rate) > 0 ? U.indianNumber(num(p.rate)) : '', { item: p.name })) },
    suppliers: { t: 'Recent suppliers', ic: 'truck', rows: (n) => recentParties(Store.list('purchases').filter(p => p.kind !== 'STK'), (p) => p.supplier, n).map(name => { const c = contactByName(name); return row(name, c ? (c.phone || c.gstin || '') : 'Not in contacts yet', '', c ? { contact: c } : { route: 'contacts', params: { type: 'Supplier' } }); }) },
    stock: { t: 'Recent stock entries', ic: 'layers', rows: (n) => take(newest(Store.list('purchases').filter(p => p.kind === 'STK' || (p.kind === 'PUR' && p.items.some(it => it.stock)))), n).map(p => row(p.no, (p.kind === 'STK' ? 'Stock upload' : p.supplier || '-') + ' · ' + p.date, p.items.filter(it => p.kind === 'STK' || it.stock).length + ' item' + (p.items.length === 1 ? '' : 's'), { no: p.no })) },
    inhand: { t: 'Stock in hand (latest)', ic: 'box', rows: (n) => take(newest(Store.list('purchases').filter(p => p.kind !== 'QTN')).reduce((acc, p) => { p.items.forEach(it => { if ((p.kind === 'STK' || it.stock) && it.name && !acc.some(a => a.k === String(it.name).toLowerCase())) acc.push({ k: String(it.name).toLowerCase(), name: it.name }); }); return acc; }, []), n).map(x => { const s = Books.stock(null).find(r => String(r.name).toLowerCase() === x.k); return row(x.name, s ? 'In hand ' + U.fmtQty(s.onHand) + (s.uqc ? ' ' + s.uqc : '') : '', s ? money(s.value) : '', { route: 'stock' }); }) },
    items: { t: 'Recent items', ic: 'grid', rows: (n) => take(newest(Store.items()), n).map(i => row(i.name, (i.category ? i.category + ' · ' : '') + 'GST ' + (i.gst || '0') + '%', num(i.rate) > 0 ? U.indianNumber(num(i.rate)) : '', { item: i.name })) },
    cnotes: { t: 'Recent credit notes', ic: 'ledger', rows: (n) => take(newest(Store.list('notes').filter(x => x.kind === 'CN')), n).map(x => row(x.no, (x.party || '-') + ' · ' + x.date, money(x.total), { no: x.no })) },
    dnotes: { t: 'Recent debit notes', ic: 'ledger', rows: (n) => take(newest(Store.list('notes').filter(x => x.kind === 'DN')), n).map(x => row(x.no, (x.party || '-') + ' · ' + x.date, money(x.total), { no: x.no })) },
    receipts: { t: 'Recent receipts', ic: 'wallet', rows: (n) => take(newest(Store.list('journal').filter(j => j.vtype === 'receipt')), n).map(v => row(v.no || 'Receipt', (v.party || '-') + ' · ' + v.date, money(vAmount(v)), v.no ? { no: v.no } : { route: 'money', params: { kind: 'receipt' } })) },
    payments: { t: 'Recent payments', ic: 'payout', rows: (n) => take(newest(Store.list('journal').filter(j => j.vtype === 'payment')), n).map(v => row(v.no || 'Payment', (v.party || '-') + ' · ' + v.date, money(vAmount(v)), v.no ? { no: v.no } : { route: 'money', params: { kind: 'payment' } })) },
    journal: { t: 'Recent journal entries', ic: 'book', rows: (n) => take(newest(Store.list('journal').filter(j => !j.vtype)), n).map(j => row(j.no || (j.lines && j.lines[0] ? j.lines[0].account : 'Entry'), (j.narration || '-') + ' · ' + j.date, money(vAmount(j)), j.no ? { no: j.no } : { route: 'journal' })) },
    expenses: { t: 'Recent expenses', ic: 'rupee', rows: (n) => take(newest(Store.list('expenses')), n).map(e => row(e.category || 'Expense', (e.description ? e.description + ' · ' : '') + e.date, money(e.amount), e.no ? { no: e.no } : { route: 'expenses' })) },
    contacts: { t: 'Recent contacts', ic: 'users', rows: (n) => take(newest(Store.list('contacts')), n).map(c => row(c.name, (c.type || 'Customer') + (c.phone ? ' · ' + c.phone : ''), '', { contact: c })) },
    pos: { t: 'Recent purchase orders', ic: 'cart', rows: (n) => take(newest(Store.list('procure').filter(d => d.kind === 'PO')), n).map(d => row(d.no, (d.supplier || '-') + ' · ' + d.date, money(d.total), { no: d.no })) },
    employees: { t: 'Recent employees', ic: 'users', rows: (n) => take(newest(Store.list('employees')), n).map(e => row(e.name, [e.code, e.designation, e.department].filter(Boolean).join(' · '), '', { route: 'employees' })) }
  };
  const vAmount = (v) => (v.lines || []).filter(l => l.side === 'Dr').reduce((s, l) => s + num(l.amount), 0) || num(v.amount);

  // Which sections each screen gets, in order; a screen not listed gets the dashboard's set
  const SCREENS = {
    dashboard: ['invoices', 'products', 'purchases', 'receipts', 'payments'],
    invoice: ['products', 'invoices', 'customers', 'challans'],
    sales: ['invoices', 'products', 'customers', 'receipts'],
    challans: ['challans', 'invoices', 'products', 'customers'],
    notes: ['cnotes', 'dnotes', 'invoices', 'purchases'],
    purchases: ['purchases', 'pos', 'bought', 'suppliers'],
    procurement: ['pos', 'purchases', 'suppliers', 'bought'],
    inventory: ['inhand', 'bought', 'items', 'purchases'],
    expenses: ['expenses', 'payments', 'suppliers'],
    items: ['items', 'products', 'bought', 'inhand'],
    stock: ['stock', 'inhand', 'bought', 'items'],
    money: ['receipts', 'payments', 'invoices', 'purchases'],
    journal: ['journal', 'receipts', 'payments', 'expenses'],
    contacts: ['contacts', 'customers', 'suppliers', 'invoices'],
    ledger: ['customers', 'suppliers', 'invoices', 'purchases'],
    salesReport: ['invoices', 'products', 'customers'],
    aging: ['invoices', 'customers', 'receipts'],
    payables: ['purchases', 'suppliers', 'payments'],
    pnl: ['invoices', 'purchases', 'expenses', 'journal'],
    balance: ['invoices', 'purchases', 'receipts', 'payments'],
    gst: ['invoices', 'purchases', 'cnotes', 'dnotes'],
    employees: ['employees'], attendance: ['employees'], clock: ['employees'], timesheets: ['employees'], reimbursements: ['employees', 'payments'], payroll: ['employees', 'payments'], hrsettings: ['employees'],
    backup: ['invoices', 'purchases'], migrate: ['invoices', 'purchases', 'contacts'], companies: ['invoices', 'purchases'], group: ['invoices', 'purchases'], ai: ['invoices', 'purchases']
  };
  // Sections an invoice pack (invoicing only) or a role in another company may not look at follow the screens they belong to
  const SECTION_SCREEN = { products: 'sales', invoices: 'sales', challans: 'challans', customers: 'contacts', purchases: 'purchases', bought: 'purchases', suppliers: 'contacts', stock: 'stock', inhand: 'stock', items: 'items', cnotes: 'notes', dnotes: 'notes', receipts: 'money', payments: 'money', journal: 'journal', expenses: 'expenses', contacts: 'contacts', employees: 'employees', pos: 'procurement' };
  const LITE_SECTIONS = ['products', 'invoices', 'customers', 'cnotes', 'dnotes', 'contacts'];

  const Aside = {
    screen: 'dashboard',
    hidden() { try { return localStorage.getItem(HIDE_KEY) === 'hidden'; } catch (e) { return false; } },
    setHidden(h) { try { if (h) localStorage.setItem(HIDE_KEY, 'hidden'); else localStorage.removeItem(HIDE_KEY); } catch (e) { /* storage blocked */ } },
    cfg() { const c = Store.get(CFG_KEY, {}); return c && typeof c === 'object' ? c : {}; },
    cfgOf(screen) { return Object.assign({ off: [], n: 8 }, this.cfg()[screen] || {}); },
    saveCfg(screen, c) { const all = this.cfg(); all[screen] = c; Store.set(CFG_KEY, all, true); },
    allowed(key) { const s = SECTION_SCREEN[key]; return (!Sub.isLite() || LITE_SECTIONS.includes(key)) && (!s || Companies.mayOpen(s)); },
    sectionsFor(screen) { return (SCREENS[screen] || SCREENS.dashboard).filter(k => this.allowed(k)); },
    // Builds the panel's markup; called by App.view after every screen draw, and from the panel's own buttons
    render(screen) {
      if (screen) this.screen = screen;
      const el = $('#aside'); if (!el || !App.user) return;
      const s = this.screen, c = this.cfgOf(s), keys = this.sectionsFor(s), on = keys.filter(k => !c.off.includes(k));
      // A login that may open none of the screens the sections belong to (an employee) gets no panel at all
      if (!keys.length) { el.innerHTML = ''; document.body.classList.add('aside-off'); const f = $('#asideFab'); if (f) f.classList.add('hidden'); return; }
      document.body.classList.toggle('aside-off', this.hidden());
      el.innerHTML = '<div class="as-hd"><span class="as-title">' + icon('trend') + 'Recent</span>' +
        '<span class="as-tools"><button class="as-ic" id="asCfg" title="Choose what this panel shows">' + icon('grid') + '</button><button class="as-ic" id="asClose" title="Hide this panel">&times;</button></span></div>' +
        '<div class="as-body">' + (on.length ? on.map(k => {
          const sec = SECTIONS[k]; let rows = []; try { rows = sec.rows(c.n); } catch (e) { rows = []; }
          return '<section class="as-sec"><h4>' + icon(sec.ic) + esc(sec.t) + '</h4>' + (rows.length
            // One line per entry: the name or number, and the amount; the rest shows once the entry is opened
            ? rows.map((r, i) => '<button class="as-row" data-sec="' + k + '" data-i="' + i + '" title="' + esc(r.s || r.t) + '"><span class="as-t">' + esc(r.t) + '</span>' + (r.r ? '<span class="as-r">' + esc(r.r) + '</span>' : '') + '</button>').join('')
            : '<div class="as-empty">Nothing here yet</div>') + '</section>';
        }).join('') : '<div class="as-empty">Every section is off for this screen. Use the grid button above to turn some on.</div>') + '</div>';
      this.rows = {}; on.forEach(k => { try { this.rows[k] = SECTIONS[k].rows(c.n); } catch (e) { this.rows[k] = []; } });
      $('#asClose', el).onclick = () => { this.setHidden(true); this.render(); UI.toast('Recent panel hidden. The Recent button at the bottom right brings it back.', 3500); };
      $('#asCfg', el).onclick = () => this.configure();
      $$('.as-row', el).forEach(b => b.onclick = () => { const r = (this.rows[b.dataset.sec] || [])[+b.dataset.i]; if (r) this.act(r.go); });
      const fab = $('#asideFab'); if (fab) fab.classList.toggle('hidden', !this.hidden() && window.innerWidth >= 1100);
      if (window.innerWidth < 1100) el.classList.remove('open');
    },
    // What a tap on a row does
    act(go) {
      if (!go) return;
      if (window.innerWidth < 1100) $('#aside').classList.remove('open');
      if (go.product) {
        // On the invoice editor the product joins the open invoice; anywhere else a new invoice starts with it
        if (App.current && App.current.route === 'invoice' && global.Invoice && Invoice.inv && !Invoice.locked) { this.addToInvoice(go.product); return; }
        App.go('invoice', { quickItem: go.product }); return;
      }
      if (go.item) {
        if (App.current && App.current.route === 'invoice' && global.Invoice && Invoice.inv && !Invoice.locked) { this.addToInvoice(go.item); return; }
        if (App.current && App.current.route === 'purchases' && $('#pRows')) { const i = $$('#pRows input[data-k=name]').find(x => !x.value.trim()); if (i) { i.value = go.item; i.dispatchEvent(new Event('input', { bubbles: true })); i.focus(); return; } }
        App.go('items'); return;
      }
      if (go.contact) { const type = go.contact.type || 'Customer'; App.go('contacts', { type }); if (global.Ledger && Ledger.Contacts && Ledger.Contacts.edit) Ledger.Contacts.edit(go.contact, () => App.go('contacts', { type })); return; }
      if (go.no) { App.go('open', { no: go.no }); return; }
      if (go.route) App.go(go.route, go.params || {});
    },
    // Puts a product on the open invoice: a blank last row takes it, otherwise a row is added; a row that already
    // has it gets one more
    addToInvoice(name) {
      const inv = Invoice.inv, m = Biz.findMaster(name), last = inv.items[inv.items.length - 1];
      const at = inv.items.findIndex(x => String(x.desc || '').trim().toLowerCase() === name.toLowerCase());
      if (at >= 0) { inv.items[at].qty = num(inv.items[at].qty) + 1; Invoice.renderRows(); UI.toast(name + ': quantity ' + U.fmtQty(inv.items[at].qty), 2000, 'ok'); return; }
      const used = recentNames(Store.list('invoices'), 'desc', 200).find(p => p.name.toLowerCase() === name.toLowerCase()) || {};
      const fill = { desc: name, hsn: m && !m.hidden ? m.hsn : (used.hsn || U.hsnFor(name)), gst: m && !m.hidden ? m.gst : (used.gst || '18'), qty: 1, uqc: used.uqc || 'NOS', rate: m && !m.hidden && num(m.rate) > 0 ? Biz.exclRate(m.rate, m.gst) : (num(used.rate) > 0 ? used.rate : '') };
      const blank = last && !String(last.desc || '').trim() && !num(last.qty) && !num(last.rate);
      if (blank) Object.assign(last, fill); else inv.items.push(Object.assign({ sl: inv.items.length + 1, inc: false, taxable: 0, totalIncl: 0, subSerial: '', subDesc: '', subInfo: '' }, fill));
      inv.items.forEach((x, n) => x.sl = n + 1);
      Invoice.renderRows();
      UI.toast(name + ' added to the invoice', 2000, 'ok');
    },
    // The gear: per screen, which sections and how many entries
    configure() {
      const s = this.screen, c = this.cfgOf(s), keys = this.sectionsFor(s);
      const bg = UI.modal({ title: 'Recent panel on this screen', body: 
        keys.map(k => UI.check('asS_' + k, SECTIONS[k].t, !c.off.includes(k))).join('') +
        '<div style="margin-top:12px">' + UI.field('Entries per section', UI.select('asN', COUNTS.map(n => [n, String(n)]), c.n)) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Reset', cls: 'outline', onClick: () => { const all = this.cfg(); delete all[s]; Store.set(CFG_KEY, all, true); this.render(); UI.toast('Standard sections restored'); } },
          { label: 'Save', cls: 'green', onClick: (bg) => { this.saveCfg(s, { off: keys.filter(k => !UI.val('asS_' + k, bg)), n: +UI.val('asN', bg) || 8 }); this.render(); UI.toast('Recent panel saved'); } }] });
      return bg;
    },
    // Mounted once by App.shell: the column, and the floating pill that shows it again (or opens the drawer)
    mount() {
      if ($('#aside')) return;
      const view = $('#view'); if (!view) return;
      const wrap = document.createElement('div'); wrap.className = 'body'; wrap.id = 'body';
      view.parentNode.insertBefore(wrap, view); wrap.appendChild(view);
      const el = document.createElement('aside'); el.id = 'aside'; el.className = 'aside'; el.setAttribute('aria-label', 'Recent'); wrap.appendChild(el);
      const fab = document.createElement('button'); fab.id = 'asideFab'; fab.className = 'aside-fab'; fab.title = 'Recent'; fab.innerHTML = icon('trend') + '<span>Recent</span>'; document.body.appendChild(fab);
      fab.onclick = () => { if (window.innerWidth < 1100) { this.setHidden(false); this.render(); el.classList.toggle('open'); } else { this.setHidden(false); this.render(); UI.toast('Recent panel shown', 1500, 'ok'); } };
      document.addEventListener('click', (e) => { if (window.innerWidth < 1100 && el.classList.contains('open') && !el.contains(e.target) && e.target !== fab && !fab.contains(e.target)) el.classList.remove('open'); });
      window.addEventListener('resize', () => { const f = $('#asideFab'); if (f) f.classList.toggle('hidden', !this.hidden() && window.innerWidth >= 1100); });
      this.render(App.current ? App.current.route : 'dashboard');
    },
    unmount() { const f = $('#asideFab'); if (f) f.remove(); }
  };
  global.Aside = Aside;
})(window);
