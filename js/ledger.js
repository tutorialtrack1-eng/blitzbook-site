/* BlitzBook web portal - Parties, Item master, Purchases & Quotations, Expenses, Journal, Stock in Hand, and the
   figures behind Profit & Loss and the Balance Sheet (Books, a port of Ledger.java so both show the same numbers). */
(function (global) {
  'use strict';
  const { esc, num, money } = U;
  const EXPENSE_CATS = ['Rent', 'Salaries & Wages', 'Electricity & Water', 'Transport & Fuel', 'Office Supplies', 'Marketing & Advertising', 'Repairs & Maintenance', 'Professional Fees', 'Bank Charges', 'Telephone & Internet', 'Packing Material', 'Insurance', 'Taxes & Licences', 'Other'];
  const TDS_SECTIONS = ['194C Contractors', '194J Professional / Technical', '194H Commission', '194I Rent', '194Q Purchase of Goods', '194A Interest', 'Other'];
  const KIND_LABEL = { PUR: 'Purchase', QTN: 'Quotation', STK: 'Stock' };

  // ------------------------------------------------------------ books of account
  // What an account is for. Decides where a journal balance lands in the statements.
  const N = { CASH: 'Cash', BANK: 'Bank', CUSTOMER: 'Customer (Party)', SUPPLIER: 'Supplier (Party)', ASSET: 'Asset', LIABILITY: 'Liability', CAPITAL: 'Capital / Drawings', INCOME: 'Income', EXPENSE: 'Expense', PURCHASES: 'Purchases',
    OUT_CGST: 'Output CGST', OUT_SGST: 'Output SGST', OUT_IGST: 'Output IGST', IN_CGST: 'Input CGST', IN_SGST: 'Input SGST', IN_IGST: 'Input IGST', RCM: 'RCM GST Payable', TDS: 'TDS Payable' };
  const BUILT_IN = [['Cash', N.CASH], ['Bank', N.BANK], ['Capital', N.CAPITAL], ['Drawings', N.CAPITAL], ['Sales', N.INCOME], ['Other Income', N.INCOME], ['Purchases', N.PURCHASES], ['Depreciation', N.EXPENSE], ['Fixed Assets', N.ASSET], ['Loans', N.LIABILITY],
    ['Output CGST', N.OUT_CGST], ['Output SGST', N.OUT_SGST], ['Output IGST', N.OUT_IGST], ['Input CGST', N.IN_CGST], ['Input SGST', N.IN_SGST], ['Input IGST', N.IN_IGST], ['RCM GST Payable', N.RCM], ['TDS Payable', N.TDS]];
  // Names used by entries made before accounts existed
  const LEGACY_NATURE = { 'Receivables (Customers)': N.CUSTOMER, 'Payables (Suppliers)': N.SUPPLIER, 'Sales / Other Income': N.INCOME, 'Expenses': N.EXPENSE, 'GST Payable': N.OUT_CGST };
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });

  const Books = {
    N, BUILT_IN,
    // Built-in accounts, then every customer and supplier, then user-created accounts
    accounts() {
      const out = BUILT_IN.map(a => ({ name: a[0], nature: a[1], builtIn: true }));
      Store.list('contacts').slice().sort(byName).forEach(c => { const name = String(c.name || '').trim(); if (name) out.push({ name, nature: c.type === 'Supplier' ? N.SUPPLIER : N.CUSTOMER }); });
      Store.list('accounts').slice().sort(byName).forEach(a => out.push({ name: a.name, nature: a.nature }));
      return out;
    },
    natures() { const m = new Map(); this.accounts().forEach(a => m.set(a.name.toLowerCase(), a.nature)); return (name) => m.get(String(name).toLowerCase()) || LEGACY_NATURE[name] || N.ASSET; },
    // Both bounds inclusive (timestamps at midnight); a null bound is open-ended. Unreadable dates are left out.
    inRange(date, from, to) { const d = U.dateMs(date); return !!d && (from == null || d >= from) && (to == null || d <= to); },
    // Debit balance (positive) or credit balance (negative) of every account touched by journal lines
    journalBalances(from, to) {
      const bal = new Map();
      Store.list('journal').forEach(j => { if (!this.inRange(j.date, from, to)) return; j.lines.forEach(l => { const k = String(l.account).toLowerCase(), cur = bal.get(k) || { name: l.account, v: 0 }; cur.v += l.side === 'Dr' ? num(l.amount) : -num(l.amount); bal.set(k, cur); }); });
      return Array.from(bal.values()).sort(byName);
    },
    // Older purchases only stored the GST total; treat those as intra-state (CGST + SGST)
    gstSplit(p) { const c = num(p.cgst), s = num(p.sgst), i = num(p.igst), g = num(p.gst); return !c && !s && !i && g ? [g / 2, g / 2, 0] : [c, s, i]; },
    expenseAmounts(e) { const gst = num(e.gst), taxable = num(e.taxable); return { taxable: !taxable && !gst ? num(e.amount) : taxable, gst, cgst: num(e.cgst), sgst: num(e.sgst), igst: num(e.igst), amount: num(e.amount) }; },

    // Quantities bought as stock (purchases and uploaded stock, not quotations) less quantities invoiced, by item
    // name. asAt limits both sides to that date; null means everything to date. The rate is the latest purchase's.
    stock(asAt) {
      const lines = new Map();
      Store.list('purchases').filter(p => p.kind !== 'QTN' && this.inRange(p.date, null, asAt))
        .sort((a, b) => U.dateMs(a.date) - U.dateMs(b.date) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }))
        .forEach(p => p.items.forEach(it => {
          const name = String(it.name || '').trim(); if (!it.stock || !name) return;
          const k = name.toLowerCase(); let l = lines.get(k);
          if (!l) { l = { name, hsn: '', uqc: '', purchased: 0, sold: 0, lastRate: 0 }; lines.set(k, l); }
          if (it.hsn && !l.hsn) l.hsn = it.hsn;
          if (it.uqc) l.uqc = it.uqc;
          l.purchased += num(it.qty); l.lastRate = num(it.rate);
        }));
      if (!lines.size) return [];
      Store.list('invoices').forEach(inv => { if (inv.kind !== 'invoice' || !this.inRange(inv.date, null, asAt)) return; inv.items.forEach(it => { const l = lines.get(String(it.desc || '').trim().toLowerCase()); if (l) l.sold += num(it.qty); }); });
      return Array.from(lines.values()).sort(byName).map(l => Object.assign(l, { onHand: l.purchased - l.sold, value: Math.max(0, l.purchased - l.sold) * l.lastRate }));
    },

    profitLoss(from, to) {
      const pl = { invoices: 0, purchases: 0, rcmInvoices: 0, rcmPurchases: 0, creditNotes: 0, debitNotes: 0, sales: 0, salesReturns: 0, purchasesValue: 0, purchaseReturns: 0, rcmGst: 0, otherIncome: 0,
        outCgst: 0, outSgst: 0, outIgst: 0, inCgst: 0, inSgst: 0, inIgst: 0, expensesByCategory: new Map() };
      const addExp = (k, v) => pl.expensesByCategory.set(k, (pl.expensesByCategory.get(k) || 0) + v);
      Store.list('invoices').forEach(i => {
        if (i.kind !== 'invoice' || !this.inRange(i.date, from, to)) return;
        pl.invoices++; pl.sales += num(i.totals.taxable);
        // GST on a reverse-charge sale is paid by the buyer, so nothing is collected on it
        if (i.rcm) pl.rcmInvoices++; else { pl.outCgst += num(i.totals.cgst); pl.outSgst += num(i.totals.sgst); pl.outIgst += num(i.totals.igst); }
      });
      Store.list('purchases').forEach(p => {
        if (p.kind !== 'PUR' || !this.inRange(p.date, from, to)) return;
        pl.purchases++; pl.purchasesValue += num(p.taxable);
        const s = this.gstSplit(p); pl.inCgst += s[0]; pl.inSgst += s[1]; pl.inIgst += s[2];
        if (p.rcm) { pl.rcmPurchases++; pl.rcmGst += num(p.gst); }
      });
      Store.list('notes').forEach(n => {
        if (!this.inRange(n.date, from, to)) return;
        if (n.kind === 'CN') { pl.creditNotes++; pl.salesReturns += num(n.taxable); pl.outCgst -= num(n.cgst); pl.outSgst -= num(n.sgst); pl.outIgst -= num(n.igst); }
        else { pl.debitNotes++; pl.purchaseReturns += num(n.taxable); pl.inCgst -= num(n.cgst); pl.inSgst -= num(n.sgst); pl.inIgst -= num(n.igst); }
      });
      Store.list('expenses').forEach(x => {
        if (!this.inRange(x.date, from, to)) return;
        const e = this.expenseAmounts(x);
        addExp(String(x.category || '').trim() || 'Other', e.taxable);
        pl.inCgst += e.cgst; pl.inSgst += e.sgst; pl.inIgst += e.igst;
        if (x.rcm) pl.rcmGst += e.gst;
      });
      // Journal: income and expense accounts by name (Depreciation, Interest ...), purchases into cost of goods
      const nature = this.natures();
      this.journalBalances(from, to).forEach(b => { const n = nature(b.name); if (n === N.INCOME) pl.otherIncome -= b.v; else if (n === N.PURCHASES) pl.purchasesValue += b.v; else if (n === N.EXPENSE) addExp(b.name, b.v); });
      pl.expensesByCategory = new Map(Array.from(pl.expensesByCategory.entries()).sort((a, b) => a[0].localeCompare(b[0])));
      pl.outputGst = pl.outCgst + pl.outSgst + pl.outIgst; pl.inputGst = pl.inCgst + pl.inSgst + pl.inIgst;
      pl.expenses = Array.from(pl.expensesByCategory.values()).reduce((s, v) => s + v, 0);
      pl.grossProfit = pl.sales - pl.salesReturns + pl.otherIncome - (pl.purchasesValue - pl.purchaseReturns);
      pl.netProfit = pl.grossProfit - pl.expenses;
      return pl;
    },

    /* Position as at a date: money received on invoices less purchases and expenses paid gives cash and bank;
       credit sales are receivables, credit purchases and expenses are payables; credit and debit notes adjust those;
       stock is valued at the last purchase rate; GST collected and paid are carried as Output and Input GST; TDS
       deducted from suppliers is a liability until paid; journal vouchers move every named account. Owner's capital
       is the balancing figure (accumulated profit). */
    balanceSheet(asAt) {
      const bs = { cash: 0, bank: 0, receivables: 0, stockValue: 0, payables: 0, rcmPayable: 0, tdsPayable: 0, outCgst: 0, outSgst: 0, outIgst: 0, inCgst: 0, inSgst: 0, inIgst: 0, parties: [], assets: [], liabilities: [] };
      // What each party owes us (positive) or is owed by us (negative): credit sales and purchases, credit and
      // debit notes settled on account, and every journal line on the party, which is how receipts and
      // payments against those bills bring the balance down
      const party = new Map();
      const addParty = (name, v) => { const n = String(name || '').trim(); if (!n) return false; const k = n.toLowerCase(), cur = party.get(k) || { name: n, bal: 0 }; cur.bal += v; party.set(k, cur); return true; };
      const money = (mode, amt, credit) => { const m = String(mode || '').toLowerCase(); if (m === 'credit') credit(amt); else if (m === 'cash') bs.cash += amt; else bs.bank += amt; };
      Store.list('invoices').forEach(i => {
        if (i.kind !== 'invoice' || !this.inRange(i.date, null, asAt)) return;
        if (!i.rcm) { bs.outCgst += num(i.totals.cgst); bs.outSgst += num(i.totals.sgst); bs.outIgst += num(i.totals.igst); }
        money(i.payment, num(i.totals.rounded) || num(i.totals.grand), (v) => { if (!addParty(this.partyName(i.buyer.name), v)) bs.receivables += v; });
      });
      Store.list('purchases').forEach(p => {
        if (p.kind !== 'PUR' || !this.inRange(p.date, null, asAt)) return;
        bs.tdsPayable += num(p.tds);
        const s = this.gstSplit(p); bs.inCgst += s[0]; bs.inSgst += s[1]; bs.inIgst += s[2];
        // Reverse charge GST is owed to the government by us (and claimable as input credit once paid)
        if (p.rcm) bs.rcmPayable += num(p.gst);
        money(p.paidBy, -(num(p.total) - num(p.tds)), (v) => { if (!addParty(p.supplier, v)) bs.payables -= v; });
      });
      Store.list('expenses').forEach(x => {
        if (!this.inRange(x.date, null, asAt)) return;
        const e = this.expenseAmounts(x);
        bs.inCgst += e.cgst; bs.inSgst += e.sgst; bs.inIgst += e.igst;
        if (x.rcm) bs.rcmPayable += e.gst;
        money(x.paidBy, -e.amount, (v) => bs.payables -= v);
      });
      Store.list('notes').forEach(n => {
        if (!this.inRange(n.date, null, asAt)) return;
        const total = num(n.total);
        if (n.kind === 'CN') { bs.outCgst -= num(n.cgst); bs.outSgst -= num(n.sgst); bs.outIgst -= num(n.igst); money(n.settle, -total, (v) => { if (!addParty(n.party, v)) bs.receivables += v; }); }
        else { bs.inCgst -= num(n.cgst); bs.inSgst -= num(n.sgst); bs.inIgst -= num(n.igst); money(n.settle, total, (v) => { if (!addParty(n.party, v)) bs.payables -= v; }); }
      });
      bs.stockValue = this.stock(asAt).reduce((s, l) => s + l.value, 0);
      const nature = this.natures();
      this.journalBalances(null, asAt).forEach(b => {
        const bal = b.v; if (!bal) return;
        switch (nature(b.name)) {
          case N.CASH: bs.cash += bal; break;
          case N.BANK: if (b.name.toLowerCase() === 'bank') bs.bank += bal; else bs.assets.push([b.name, bal]); break;
          case N.CUSTOMER: case N.SUPPLIER: addParty(b.name, bal); break;
          case N.OUT_CGST: bs.outCgst -= bal; break;
          case N.OUT_SGST: bs.outSgst -= bal; break;
          case N.OUT_IGST: bs.outIgst -= bal; break;
          case N.IN_CGST: bs.inCgst += bal; break;
          case N.IN_SGST: bs.inSgst += bal; break;
          case N.IN_IGST: bs.inIgst += bal; break;
          case N.RCM: bs.rcmPayable -= bal; break;
          case N.TDS: bs.tdsPayable -= bal; break;
          case N.ASSET: bs.assets.push([b.name, bal]); break;
          case N.LIABILITY: bs.liabilities.push([b.name, -bal]); break;
          default: break; // capital, drawings, income, expenses, purchases sit in the balancing capital
        }
      });
      Array.from(party.values()).sort(byName).forEach(p => { if (Math.abs(p.bal) < 0.005) return; bs.parties.push([p.name, p.bal]); if (p.bal > 0) bs.receivables += p.bal; else bs.payables -= p.bal; });
      const sum = (l) => l.reduce((s, x) => s + x[1], 0);
      bs.totalAssets = bs.cash + bs.bank + bs.receivables + bs.stockValue + bs.inCgst + bs.inSgst + bs.inIgst + sum(bs.assets);
      bs.totalLiabilities = bs.payables + bs.outCgst + bs.outSgst + bs.outIgst + bs.rcmPayable + bs.tdsPayable + sum(bs.liabilities);
      bs.capital = bs.totalAssets - bs.totalLiabilities;
      return bs;
    },
    // The party an invoice is billed to: the first line of the buyer box
    partyName(nameAddr) { return String(nameAddr || '').split('\n')[0].trim(); },
    // Outstanding balance of one party as at today (positive = owed to us, negative = owed by us), 0 when unknown
    partyBalance(name) { const k = String(name || '').trim().toLowerCase(); const hit = this.balanceSheet(null).parties.find(p => p[0].toLowerCase() === k); return hit ? hit[1] : 0; },

    /* One party's ledger account, for reconciling with the party's own statement: every bill (purchase or sales
       invoice), every credit / debit note and every journal line on the party (receipts, payments, vouchers), in
       date order with a running balance. dr = the party owes us more, cr = we owe the party more. A bill paid at
       once (cash, online) is shown as billed and settled the same day, so the statement is complete even though
       the balance never moved. Entries before `from` roll into the opening balance; entries after `to` are left
       out. Both bounds may be null. */
    /* Credit purchase bills and what is still owed on each as at a date (today when none is given): the bill less
       TDS, less the payments recorded against that bill number (a payment knocked off against several bills carries
       its allocations; an older one names one bill) and the debit notes adjusted against it on account. A payment
       that names no bill is money on account of the supplier and is reported as such. days = age of the bill,
       bucket = 0: up to 30 days, 1: 31-60, 2: 61-90, 3: over 90. The supplier side of Biz.outstanding. */
    payables(asAt) {
      const at = asAt == null ? Date.now() : asAt, key = (s) => String(s || '').trim().toLowerCase();
      const amountOf = (v) => (v.lines || []).filter(l => l.side === 'Dr').reduce((s, l) => s + num(l.amount), 0);
      const payments = Store.list('journal').filter(j => j.vtype === 'payment' && this.inRange(j.date, null, at));
      const allocs = (v) => Array.isArray(v.alloc) && v.alloc.length ? v.alloc : (key(v.ref) ? [{ no: v.ref, amount: amountOf(v) }] : []);
      const byRef = new Map(); payments.forEach(v => allocs(v).forEach(a => { const k = key(a.no); if (k) byRef.set(k, (byRef.get(k) || 0) + num(a.amount)); }));
      const noted = new Map(); Store.list('notes').forEach(n => { if (n.kind === 'DN' && (n.settle || 'Credit') === 'Credit' && this.inRange(n.date, null, at)) { const k = key(n.ref); noted.set(k, (noted.get(k) || 0) + num(n.total)); } });
      const all = [];
      Store.list('purchases').forEach(p => {
        if (p.kind !== 'PUR' || String(p.paidBy || '').toLowerCase() !== 'credit' || !key(p.no) || !this.inRange(p.date, null, at)) return;
        const total = U.round2(num(p.total) - num(p.tds)), paid = byRef.get(key(p.no)) || 0, dn = noted.get(key(p.no)) || 0;
        const days = Math.max(0, Math.floor((at - U.dateMs(p.date)) / 86400000));
        all.push({ id: p.id, no: p.no, date: p.date, party: String(p.supplier || '').trim() || '(no supplier)', total, paid, noted: dn, balance: Math.max(0, U.round2(total - paid - dn)), days, bucket: days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3 });
      });
      const nos = new Set(all.map(r => key(r.no))), onAccount = new Map();
      payments.forEach(v => {
        const used = allocs(v).filter(a => nos.has(key(a.no))).reduce((s, a) => s + num(a.amount), 0), rest = U.round2(amountOf(v) - used);
        if (rest <= 0.005) return;
        const k = key(v.party); if (k) onAccount.set(k, { party: v.party, amount: (onAccount.get(k) || { amount: 0 }).amount + rest });
      });
      return { all, open: all.filter(r => r.balance > 0.005), onAccount: Array.from(onAccount.values()) };
    },

    partyLedger(name, from, to) {
      const k = String(name || '').trim().toLowerCase(), all = [];
      if (!k) return { opening: 0, entries: [], closing: 0, totalDr: 0, totalCr: 0 };
      const add = (date, type, no, particulars, dr, cr, order) => all.push({ date, ms: U.dateMs(date) || 0, type, no: no || '', particulars, dr: U.round2(dr), cr: U.round2(cr), order });
      Store.list('purchases').forEach(p => {
        if (p.kind !== 'PUR' || String(p.supplier || '').trim().toLowerCase() !== k) return;
        const amt = num(p.total) - num(p.tds);
        add(p.date, 'Purchase', p.no, 'Purchase bill' + (num(p.tds) > 0 ? ' (less TDS ' + money(p.tds) + ')' : '') + (p.rcm ? ', reverse charge' : ''), 0, amt, 1);
        if (String(p.paidBy || '').toLowerCase() !== 'credit') add(p.date, 'Payment', p.no, 'Paid by ' + p.paidBy, amt, 0, 2);
      });
      Store.list('invoices').forEach(i => {
        if (i.kind !== 'invoice' || this.partyName(i.buyer.name).toLowerCase() !== k) return;
        const amt = num(i.totals.rounded) || num(i.totals.grand);
        add(i.date, 'Invoice', i.no, 'Sales invoice' + (i.rcm ? ', reverse charge' : ''), amt, 0, 1);
        if (String(i.payment || '').toLowerCase() !== 'credit') add(i.date, 'Receipt', i.no, 'Received by ' + i.payment, 0, amt, 2);
      });
      Store.list('notes').forEach(n => {
        if (String(n.party || '').trim().toLowerCase() !== k) return;
        const t = num(n.total), cn = n.kind === 'CN';
        add(n.date, cn ? 'Credit Note' : 'Debit Note', n.no, (cn ? 'Credit note' : 'Debit note') + (n.ref ? ' against ' + n.ref : '') + (n.reason ? ': ' + n.reason : ''), cn ? 0 : t, cn ? t : 0, 3);
        if (String(n.settle || 'Credit') !== 'Credit') add(n.date, cn ? 'Payment' : 'Receipt', n.no, (cn ? 'Refunded by ' : 'Received back by ') + n.settle, cn ? t : 0, cn ? 0 : t, 4);
      });
      Store.list('journal').forEach(j => j.lines.forEach(l => {
        if (String(l.account || '').trim().toLowerCase() !== k) return;
        const other = j.lines.filter(x => x !== l).map(x => x.account).join(', ');
        const what = j.vtype === 'receipt' ? 'Received in ' + (j.mode || other) : j.vtype === 'payment' ? 'Paid from ' + (j.mode || other) : (l.side === 'Dr' ? 'To ' : 'By ') + other;
        add(j.date, j.vtype === 'receipt' ? 'Receipt' : j.vtype === 'payment' ? 'Payment' : 'Journal', j.no, what + (j.ref ? ' against ' + j.ref : '') + (j.bankRef ? ' (' + j.bankRef + ')' : '') + (j.narration ? ' · ' + j.narration : ''), l.side === 'Dr' ? num(l.amount) : 0, l.side === 'Cr' ? num(l.amount) : 0, 5);
      }));
      all.sort((a, b) => a.ms - b.ms || a.order - b.order || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
      let bal = 0, opening = 0, totalDr = 0, totalCr = 0; const entries = [];
      all.forEach(e => {
        bal = U.round2(bal + e.dr - e.cr);
        if (from != null && e.ms < from) { opening = bal; return; }
        if (to != null && e.ms > to) return;
        totalDr += e.dr; totalCr += e.cr; entries.push(Object.assign(e, { bal }));
      });
      return { opening, entries, closing: entries.length ? entries[entries.length - 1].bal : opening, totalDr: U.round2(totalDr), totalCr: U.round2(totalCr) };
    }
  };

  // PUR-0001 / QTN-0001 / STK-0001: one running series per kind
  function nextNo(kind) { let max = 0; Store.list('purchases').forEach(x => { const m = new RegExp('^' + kind + '-\\s*(\\d+)\\s*$').exec(x.no || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); }); return kind + '-' + String(max + 1).padStart(4, '0'); }
  function listTable(headers, rows, emptyMsg) { return '<div class="tablewrap">' + (rows.length ? '<table class="list cards"><thead><tr>' + headers.map(h => '<th class="' + (h.startsWith('#') ? 'num' : '') + '">' + esc(h.replace('#', '')) + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>' : '<div class="empty">' + esc(emptyMsg) + '</div>') + '</div>'; }
  function td(label, v, cls) { return '<td class="' + (cls || '') + '" data-l="' + esc(label) + '">' + v + '</td>'; }
  // Column of an uploaded sheet by its heading; without a heading row the app's column order applies
  function columns(rows, first, order) {
    const head = rows.length && String(rows[0][0] || '').trim().toLowerCase() === first ? rows[0].map(c => String(c).trim().toLowerCase()) : null;
    const at = {}; order.forEach((name, i) => { at[name] = head ? head.findIndex(c => c.replace(/[^a-z]/g, '').startsWith(name)) : i; });
    return { body: head ? rows.slice(1) : rows, get: (r, name) => at[name] >= 0 && r[at[name]] != null ? String(r[at[name]]).trim() : '' };
  }

  // ------------------------------------------------------------ contacts
  const Contacts = {
    select: false,
    open(p) {
      const type = p.type || 'Customer';
      const list = Biz.contactsOf(type);
      // What each party owes (invoices) or is owed (purchase bills) after receipts, payments and notes
      const bal = new Map(Books.balanceSheet(null).parties.map(x => [x[0].toLowerCase(), x[1]]));
      const owed = (c) => { const b = bal.get(String(c.name || '').trim().toLowerCase()); return !b || Math.abs(b) < 0.005 ? '' : '<div class="small"><span class="pill ' + (b > 0 ? 'ok' : 'warn') + '">' + (b > 0 ? 'Owes you ' : 'You owe ') + money(Math.abs(b)) + '</span></div>'; };
      const root = App.view(App.header(type + ' Contacts', '<div class="btnrow" style="margin:0"><button class="btn sm green" id="cAdd">+ Add ' + type + '</button><button class="btn sm outline" id="cCsv">Upload CSV / Excel</button><button class="btn sm outline" id="cTpl">Template</button><button class="btn sm outline" id="cSel">' + (Contacts.select ? 'Done' : 'Select') + '</button><button class="btn sm outline" id="cSwap">' + (type === 'Customer' ? 'Suppliers' : 'Customers') + '</button></div>') +
        (Contacts.select ? '<div class="btnrow"><label class="check"><input type="checkbox" id="selAll"> Select all</label><button class="btn sm red" id="bDel">Delete selected</button></div>' : '') +
        listTable(['', 'Name', 'Phone', 'GSTIN', 'State', 'TDS', ''], list.map(c => '<tr>' + td('', Contacts.select ? '<input type="checkbox" class="selbox" data-id="' + esc(c.id) + '">' : '') + td('Name', '<b>' + esc(c.name) + '</b>' + (c.address ? '<div class="small muted">' + esc(c.address) + '</div>' : '') + owed(c)) + td('Phone', esc(c.phone) + (c.email ? '<div class="small muted">' + esc(c.email) + '</div>' : '')) + td('GSTIN', esc(c.gstin)) + td('State', esc(U.stateName(c.state))) + td('TDS', c.tds ? esc(U.fmtQty(c.tdsRate) + '%') : '-') +
          '<td class="actions">' + (Contacts.select ? '' : '<button class="btn sm" data-l="' + esc(c.name) + '">Ledger</button><button class="btn sm outline" data-e="' + esc(c.id) + '">Edit</button><button class="btn sm red" data-d="' + esc(c.id) + '">Delete</button>') + '</td></tr>'), 'No ' + type + ' contacts found. Click "+ Add ' + type + '" to create one.'));
      App.wireBack(root);
      $('#cAdd').onclick = () => Contacts.edit({ type }); $('#cSwap').onclick = () => { Contacts.select = false; App.go('contacts', { type: type === 'Customer' ? 'Supplier' : 'Customer' }); };
      $('#cSel').onclick = () => { Contacts.select = !Contacts.select; Contacts.open({ type }); };
      $('#cTpl').onclick = () => { UI.download('BlitzBook_Contacts_Template.csv', 'Name,Phone,Email,GSTIN,Address,State\nRamesh Traders,9876543210,ramesh@gmail.com,37ABCDE1234F1ZZ,100 Feet Road Vijayawada,Andhra Pradesh\nSuresh Enterprises,9123456789,suresh@gmail.com,36XYZAB5678G2ZY,MG Road Hyderabad,Telangana\n', 'text/csv'); UI.toast('Template downloaded'); };
      $('#cCsv').onclick = () => UI.pickSheet((rows) => Contacts.importRows(rows, type));
      if (Contacts.select) {
        const picked = () => $$('.selbox:checked', root).map(b => b.dataset.id);
        $('#selAll').onchange = e => $$('.selbox', root).forEach(b => b.checked = e.target.checked);
        $('#bDel').onclick = () => { const ids = picked(); if (!ids.length) return UI.toast('Tick the contacts first'); UI.confirm('Delete Contacts', 'Delete ' + ids.length + ' selected contacts?', () => { Store.saveList('contacts', Store.list('contacts').filter(c => !ids.includes(c.id))); UI.toast('Contacts deleted'); Contacts.open({ type }); }, 'Delete'); };
      }
      $$('[data-l]', root).forEach(b => b.onclick = () => App.go('ledger', { party: b.dataset.l }));
      $$('[data-e]', root).forEach(b => b.onclick = () => Contacts.edit(Store.find('contacts', b.dataset.e)));
      $$('[data-d]', root).forEach(b => b.onclick = () => { const c = Store.find('contacts', b.dataset.d); UI.confirm('Delete Contact', 'Are you sure you want to delete contact "' + c.name + '"?', () => { Store.delete('contacts', c.id); UI.toast('Contact "' + c.name + '" deleted'); Contacts.open({ type }); }, 'Delete'); });
    },
    // Columns: Name, Phone, Email, GSTIN, Address, State (the app's template). A name already in the contacts is
    // updated (upsert) or left alone (insert only); the preview says how many of each the file holds.
    importRows(rows, type) {
      const col = columns(rows, rows.length && /^type$/i.test(String(rows[0][0]).trim()) ? 'type' : 'name', ['name', 'phone', 'email', 'gstin', 'address', 'state']);
      const head = rows.length ? rows[0].map(c => String(c).trim().toLowerCase()) : [], typeAt = head.indexOf('type');
      const recs = [];
      col.body.forEach(r => {
        const name = col.get(r, 'name'); if (!name) return;
        const gstin = col.get(r, 'gstin').toUpperCase(), state = col.get(r, 'state');
        recs.push({ f: { name, phone: col.get(r, 'phone'), email: col.get(r, 'email').toLowerCase(), gstin, address: col.get(r, 'address'), state: U.matchState(state, gstin) || state }, type: typeAt >= 0 ? (/supp/i.test(r[typeAt] || '') ? 'Supplier' : 'Customer') : type });
      });
      if (!recs.length) { UI.alert('Upload Contacts', 'No contacts found in the file. The columns are Name, Phone, Email, GSTIN, Address, State (download the template).'); return; }
      const list = Store.list('contacts'), known = recs.filter(x => list.some(c => c.name.toLowerCase() === x.f.name.toLowerCase())).length;
      const bg = UI.modal({ title: 'Upload Contacts', focus: false, body: '<p>' + recs.length + ' contact' + (recs.length === 1 ? '' : 's') + ' in the file: <b>' + (recs.length - known) + '</b> new, <b>' + known + '</b> already in the books (by name).</p>' + UI.modeField('Contacts'),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Upload', cls: 'green', onClick: (bg) => {
          const mode = UI.modeOf(bg), r = { inserted: 0, updated: 0, unchanged: 0, skipped: 0, lines: [] };
          recs.forEach(x => {
            const ex = list.find(c => c.name.toLowerCase() === x.f.name.toLowerCase());
            if (!ex) { list.push(Object.assign({ id: U.uid(), createdAt: Date.now(), type: x.type, tds: false, tdsSection: '', tdsRate: 0 }, x.f)); r.inserted++; return; }
            if (mode === 'insert') { r.skipped++; r.lines.push(x.f.name + ': already here, left as it is'); return; }
            // Only a row that brings something different counts as an update
            if (Object.keys(x.f).every(k => String(ex[k] || '') === String(x.f[k] || ''))) { r.unchanged++; return; }
            Object.assign(ex, x.f, { updatedAt: Date.now() }); r.updated++;
          });
          Store.saveList('contacts', list);
          UI.importResult('Contacts uploaded', r, () => Contacts.open({ type }));
        } }] });
      return bg;
    },
    // Create or edit a customer / supplier, including the TDS to deduct or expect on their bills
    edit(c, onSaved) {
      c = Object.assign({ type: 'Customer', name: '', phone: '', email: '', gstin: '', state: '', address: '', tds: false, tdsSection: TDS_SECTIONS[0], tdsRate: '' }, c || {});
      const bg = UI.modal({ title: (c.id ? 'Edit Contact' : 'Create Contact') + ' (' + c.type + ')', body: '<div class="grid2">' +
        UI.field('Contact Type', UI.select('pType', ['Customer', 'Supplier'], c.type), { req: true }) + UI.field('Name / Company Name', UI.input('pName', c.name), { req: true }) +
        UI.field('Phone (10 digits)', UI.input('pPhone', c.phone, { type: 'tel', attrs: ' maxlength="10"' })) + UI.field('Email Address', UI.input('pEmail', c.email, { type: 'email' })) +
        UI.field('GSTIN Number', UI.input('pGstin', c.gstin, { attrs: ' maxlength="15" style="text-transform:uppercase"' })) + UI.field('State', UI.select('pState', U.STATES, U.matchState(c.state, c.gstin) || U.stateByCode(Biz.sellerStateCode()))) +
        UI.field('Address', '<textarea id="pAddr">' + esc(c.address) + '</textarea>', { span: true }) +
        '<div class="field span">' + UI.check('pTds', 'TDS applicable', c.tds) + '</div><div id="tdsBox" class="grid2 keep2 span ' + (c.tds ? '' : 'hidden') + '">' + UI.field('TDS Section', UI.select('pTdsSec', TDS_SECTIONS, c.tdsSection)) + UI.field('TDS Rate %', UI.input('pTdsRate', c.tdsRate || '', { type: 'number', placeholder: 'e.g. 1, 2, 10', attrs: ' step="any" min="0" max="30"' })) +
        '<div class="hint span" style="grid-column:1/-1">Supplier: this rate is deducted from their bills and shown as TDS payable. Customer: they deduct it from your invoices.</div></div></div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save Contact', cls: 'green', onClick: (bg) => {
          const v = (id) => UI.val(id, bg);
          const tds = v('pTds');
          Object.assign(c, { type: v('pType'), name: v('pName').trim(), phone: v('pPhone').trim(), email: v('pEmail').trim().toLowerCase(), gstin: v('pGstin').trim().toUpperCase(), state: v('pState'), address: v('pAddr').trim().toUpperCase(), tds, tdsSection: tds ? v('pTdsSec') : '', tdsRate: tds ? num(v('pTdsRate')) : 0 });
          if (!c.name) { UI.mark('pName', true, bg); UI.toast('Name is required'); return false; }
          if (!U.isValidPhone(c.phone)) { UI.mark('pPhone', true, bg); UI.toast('Enter correct contact phone number'); return false; }
          if (!U.isValidEmail(c.email)) { UI.mark('pEmail', true, bg); UI.toast('Enter correct contact email address'); return false; }
          if (!U.isValidGstin(c.gstin)) { UI.mark('pGstin', true, bg); UI.toast('Enter a valid contact GSTIN (15 characters, e.g. 37ABCDE1234F1ZZ)'); return false; }
          if (c.tds && !(c.tdsRate > 0 && c.tdsRate <= 30)) { UI.mark('pTdsRate', true, bg); UI.toast('Enter the TDS rate'); return false; }
          if (c.id) Store.update('contacts', c); else Store.add('contacts', c);
          UI.toast(c.type + ' contact saved'); if (onSaved) onSaved(c); else App.go('contacts', { type: c.type });
        } }] });
      $('#pTds', bg).addEventListener('change', e => $('#tdsBox', bg).classList.toggle('hidden', !e.target.checked));
      $('#pGstin', bg).addEventListener('input', e => { const g = e.target.value.trim(); e.target.classList.toggle('err', g.length >= 15 && !U.isValidGstin(g)); if (g.length >= 2 && U.stateByCode(g.slice(0, 2))) $('#pState', bg).value = U.stateByCode(g.slice(0, 2)); });
    }
  };
  App.routes.contacts = (p) => Contacts.open(p);

  // ------------------------------------------------------------ items master
  // Normal mode: add / edit / delete one at a time. Select mode: tick many, then delete or update them together.
  const Items = {
    select: false,
    open() {
      const list = Store.items().sort(byName);
      // Quantity in hand (purchases less sales) by item name, for a glance at stock on the master list
      const inHand = new Map(Books.stock(null).map(l => [l.name.toLowerCase(), l]));
      const handCell = (i) => { const l = inHand.get(String(i.name || '').trim().toLowerCase()); return l ? '<span class="' + (l.onHand <= 0 ? 'red bold' : 'bold') + '">' + U.fmtQty(l.onHand) + '</span>' + (l.uqc ? ' ' + esc(l.uqc) : '') + '<div class="small muted">bought ' + U.fmtQty(l.purchased) + ', sold ' + U.fmtQty(l.sold) + '</div>' : '-'; };
      const root = App.view(App.header(Items.select ? 'Select Items' : 'Stock - Item Master', '<div class="btnrow" style="margin:0"><button class="btn sm" id="itAdd">+ Add Item</button><button class="btn sm outline" id="itStock">Stock in Hand</button><button class="btn sm outline" id="itSel">' + (Items.select ? 'Done' : 'Select') + '</button></div>') +
        (Items.select ? '<div class="btnrow"><label class="check"><input type="checkbox" id="selAll"> Select all</label><button class="btn sm outline" id="bCat">Set category</button><button class="btn sm outline" id="bGst">Set GST %</button><button class="btn sm red" id="bDel">Delete</button></div>' : '') +
        listTable(['', 'Item', 'Code', 'Category', 'HSN/SAC', 'GST %', '#Unit Price' + (Biz.chargesGst() ? ' (incl. tax)' : ''), '#In Hand', ''], list.map(i => '<tr>' + td('', Items.select ? '<input type="checkbox" class="selbox" data-id="' + esc(i.id) + '">' : '') + td('Item', '<b>' + esc(i.name) + '</b>') + td('Code', esc(i.code || '')) + td('Category', esc(i.category || '')) + td('HSN/SAC', esc(i.hsn || '')) + td('GST %', esc(i.gst || '0') + '%') + td('Unit Price', money(i.rate), 'num') + td('In Hand', handCell(i), 'num') +
          '<td class="actions">' + (Items.select ? '' : '<button class="btn sm outline" data-e="' + esc(i.id) + '">Edit</button><button class="btn sm red" data-d="' + esc(i.id) + '">Delete</button>') + '</td></tr>'), 'No master items found. Invoiced items will appear here automatically.'));
      App.wireBack(root);
      $('#itAdd').onclick = () => Quick.editItem(null, () => Items.open());
      $('#itStock').onclick = () => App.go('stock');
      $('#itSel').onclick = () => { Items.select = !Items.select; Items.open(); };
      if (Items.select) {
        const picked = () => $$('.selbox:checked', root).map(b => b.dataset.id);
        $('#selAll').onchange = e => $$('.selbox', root).forEach(b => b.checked = e.target.checked);
        // Applies one new category or GST rate to every ticked item
        const apply = (ids, fn) => { const all = Store.list('items'); all.forEach(i => { if (ids.includes(i.id)) fn(i); }); Store.saveList('items', all); UI.toast('Updated ' + ids.length + ' items'); Items.open(); };
        $('#bCat').onclick = () => { const ids = picked(); if (!ids.length) return UI.toast('Tick the items first'); UI.prompt('Set Category', 'New category for ' + ids.length + ' items', '', (v) => { const c = U.nameCase(v); if (c) apply(ids, i => i.category = c); }, { okLabel: 'Apply', list: Biz.categories() }); };
        $('#bGst').onclick = () => { const ids = picked(); if (!ids.length) return UI.toast('Tick the items first'); UI.menu('GST rate for ' + ids.length + ' items', U.GST_RATES.map(r => r + '%'), (n) => apply(ids, i => i.gst = U.GST_RATES[n]), U.GST_RATES.indexOf('18')); };
        $('#bDel').onclick = () => { const ids = picked(); if (!ids.length) return UI.toast('Tick the items first'); UI.confirm('Delete Items', 'Delete ' + ids.length + ' selected items from the item master?', () => { Store.saveList('items', Store.list('items').filter(i => !ids.includes(i.id))); UI.toast('Items deleted'); Items.open(); }, 'Delete'); };
      }
      $$('[data-e]', root).forEach(b => b.onclick = () => Quick.editItem(Store.find('items', b.dataset.e), () => Items.open()));
      $$('[data-d]', root).forEach(b => b.onclick = () => { const i = Store.find('items', b.dataset.d); UI.confirm('Delete Item', 'Delete "' + i.name + '" from the item master?', () => { Store.delete('items', i.id); UI.toast('Item deleted from Master'); Items.open(); }, 'Delete'); });
    }
  };
  App.routes.items = () => Items.open();

  // ------------------------------------------------------------ purchases & quotations
  // Same arithmetic as Ledger.Purchase.recalc(): rates typed with GST included have the taxable part backed out,
  // a supplier in another state (by GSTIN) means IGST, and under reverse charge the supplier is paid the taxable value
  function purchaseTotals(p) {
    let taxable = 0, gst = 0;
    p.items.forEach(it => { const g = num(it.gst); let amt = num(it.qty) * num(it.rate); if (p.inclusive) amt = amt / (1 + g / 100); it.amount = amt; it.gstAmt = amt * g / 100; taxable += it.amount; gst += it.gstAmt; });
    const inter = Biz.isInter(p.supplierGstin);
    p.taxable = taxable; p.gst = gst; p.cgst = inter ? 0 : gst / 2; p.sgst = inter ? 0 : gst / 2; p.igst = inter ? gst : 0;
    p.total = p.rcm ? taxable : taxable + gst; p.tds = p.tdsRate ? Math.round(taxable * p.tdsRate) / 100 : 0; p.payable = p.total - p.tds;
    return p;
  }
  // Items bought as stock join the item master so they show up in item suggestions and the quick picker
  function stockItemsToMaster(p) {
    if (p.kind === 'QTN') return;
    p.items.forEach(it => { if (it.stock && it.name) Biz.upsertMaster(it.name, Object.assign({ gst: String(it.gst), hidden: false }, it.hsn ? { hsn: it.hsn } : {})); });
  }
  // The supplier on a purchase joins the contacts as a Supplier (the supplier list, the ledger and TDS know them);
  // a known supplier gets a blank GSTIN filled from the bill
  function supplierToContacts(p) {
    const name = String(p.supplier || '').trim();
    if (p.kind !== 'PUR' || !name) return;
    const list = Store.list('contacts'), ex = list.find(c => String(c.name || '').trim().toLowerCase() === name.toLowerCase());
    if (ex) { if (!ex.gstin && p.supplierGstin) { ex.gstin = p.supplierGstin; ex.updatedAt = Date.now(); Store.saveList('contacts', list); } return; }
    list.push({ id: U.uid(), createdAt: Date.now(), type: 'Supplier', name, phone: '', email: '', gstin: p.supplierGstin || '', address: '', state: U.matchState('', p.supplierGstin) || '', tds: false, tdsSection: '', tdsRate: 0 });
    Store.saveList('contacts', list);
  }
  const Purchases = {
    open() {
      const list = Store.list('purchases').slice().sort((a, b) => U.dateMs(b.date) - U.dateMs(a.date) || String(b.no).localeCompare(String(a.no), undefined, { numeric: true }));
      // Credit bills show what is still owed on them (payments against the bill bring it down); over 30 days is overdue
      const due = new Map(Books.payables().all.map(r => [r.no, r]));
      const dueCell = (p) => { const r = due.get(p.no); if (!r) return '-'; return r.balance > 0.005 ? '<span class="pill ' + (r.days > 30 ? 'bad' : 'warn') + '">' + money(r.balance) + ' due</span><div class="small muted">' + r.days + ' day' + (r.days === 1 ? '' : 's') + (r.days > 30 ? ', overdue' : '') + '</div>' : '<span class="pill ok">Settled</span>'; };
      const root = App.view(App.header('Purchases & Quotations', '<div class="btnrow" style="margin:0"><button class="btn sm green" id="pNew">+ Purchase</button><button class="btn sm blue" id="qNew">+ Quotation</button><button class="btn sm outline" id="pStock">Stock</button><button class="btn sm outline" id="pDN">Debit Notes</button><button class="btn sm outline" id="pPay">Payments</button><button class="btn sm outline" id="pOut">Outstanding</button><button class="btn sm outline" id="pLedger">Supplier Ledger</button></div>') +
        listTable(['No', 'Date', 'Supplier', '#Total', 'Paid By', 'Due', ''], list.map(p => {
          return '<tr>' + td('No', '<b>' + U.noLink(p.no) + '</b> <span class="pill">' + KIND_LABEL[p.kind] + '</span>') + td('Date', esc(p.date)) +
            td('Supplier', esc(p.supplier || '(no supplier)')) +
            td('Total', money(p.total) + (p.rcm ? '<div class="small muted">RCM GST ' + money(p.gst) + '</div>' : '') + (num(p.tds) > 0 ? '<div class="small muted">TDS ' + money(p.tds) + ' (payable ' + money(num(p.total) - num(p.tds)) + ')</div>' : ''), 'num') + td('Paid By', esc(p.paidBy)) + td('Due', dueCell(p)) +
            '<td class="actions">' + (p.kind === 'QTN' ? '<button class="btn sm green" data-conv="' + esc(p.id) + '">To Purchase</button>' : '') + '<button class="btn sm" data-p="' + esc(p.id) + '">Print</button><button class="btn sm outline" data-e="' + esc(p.id) + '">Edit</button><button class="btn sm red" data-d="' + esc(p.id) + '">Delete</button></td></tr>';
        }), 'No purchases or quotations yet. The items of a purchase count as stock (the "Stock" tick on each line; untick it for a service).'));
      App.wireBack(root);
      $('#pNew').onclick = () => Purchases.edit({ kind: 'PUR' }); $('#qNew').onclick = () => Purchases.edit({ kind: 'QTN' }); $('#pStock').onclick = () => App.go('stock'); $('#pDN').onclick = () => App.go('notes', { kind: 'DN' }); $('#pPay').onclick = () => App.go('money', { kind: 'payment' });
      $('#pLedger').onclick = () => App.go('ledger', { type: 'Supplier' });
      $('#pOut').onclick = () => App.go('payables');
      $$('[data-e]', root).forEach(b => b.onclick = () => Purchases.edit(Store.find('purchases', b.dataset.e)));
      $$('[data-p]', root).forEach(b => b.onclick = () => { const p = Store.find('purchases', b.dataset.p); UI.menu('Print ' + KIND_LABEL[p.kind], Print.SHEETS.map(k => Print.PAPERS[k].label), (i) => Print.show(Print.purchase(p, Store.company(), Print.SHEETS[i]))); });
      $$('[data-conv]', root).forEach(b => b.onclick = () => { const q = Store.find('purchases', b.dataset.conv); UI.confirm('Convert Quotation', 'Record ' + q.no + ' as a purchase? It will then count in stock, profit & loss and the balance sheet.', () => { q.kind = 'PUR'; q.no = nextNo('PUR'); Store.update('purchases', purchaseTotals(q)); stockItemsToMaster(q); supplierToContacts(q); Purchases.open(); }, 'Convert'); });
      $$('[data-d]', root).forEach(b => b.onclick = () => { const p = Store.find('purchases', b.dataset.d); UI.confirm('Delete ' + KIND_LABEL[p.kind], 'Delete ' + p.no + '? This cannot be undone.', () => { Store.delete('purchases', p.id); Purchases.open(); }, 'Delete'); });
    },
    edit(p) {
      const fresh = !p.id, isQ = p.kind === 'QTN';
      p = Object.assign({ kind: 'PUR', no: fresh ? nextNo(p.kind || 'PUR') : '', date: U.today(), supplier: '', supplierGstin: '', paidBy: 'Cash', rcm: false, inclusive: false, tdsRate: 0, tdsSection: '', items: [], notes: '' }, JSON.parse(JSON.stringify(p)));
      if (!p.items.length) p.items.push({ name: '', hsn: '', qty: '', rate: '', gst: '18', uqc: 'NOS', stock: true });
      const suppliers = Biz.contactsOf('Supplier');
      let tdsRate = p.tdsRate, tdsSection = p.tdsSection;
      const rowsHtml = () => p.items.map((it, i) => '<tr data-i="' + i + '">' + td('Item', '<input data-k="name" list="pItemsDl" placeholder="Item name" value="' + esc(it.name) + '">', 'desc') + td('HSN', '<input data-k="hsn" class="num" inputmode="numeric" value="' + esc(it.hsn) + '">', 'hsn') + td('Qty', '<input data-k="qty" class="num" type="number" step="any" min="0" value="' + esc(it.qty) + '">', 'qty') + td('Rate', '<input data-k="rate" class="num" type="number" step="any" min="0" value="' + esc(it.rate) + '">', 'rate') + td('GST %', UI.select('', U.GST_RATES.map(r => [r, r + '%']), it.gst, { attrs: ' data-k="gst"' }), 'gst') + td('Stock', '<input type="checkbox" data-k="stock"' + (it.stock ? ' checked' : '') + '>', 'inc') + '<td class="del"><button class="delbtn" title="Remove item" data-del>🗑</button></td></tr>').join('');
      const bg = UI.modal({ title: (fresh ? 'New ' : 'Edit ') + (isQ ? 'Quotation' : p.kind === 'STK' ? 'Stock' : 'Purchase'), wide: true, body: '<div class="grid3">' +
        UI.field((isQ ? 'Quotation' : 'Purchase') + ' No', UI.input('pNo', p.no)) + UI.field('Date', UI.dateInput('pDate', p.date), { req: true }) + UI.field(isQ ? 'Expected Payment' : 'Paid By', UI.select('pPaid', U.PAYMENT_MODES, p.paidBy)) +
        UI.field('Supplier', UI.input('pSup', p.supplier, { list: 'pSupDl', placeholder: 'Supplier name' }) + UI.datalist('pSupDl', suppliers.map(s => s.name))) + UI.field('Supplier GSTIN', UI.input('pGstin', p.supplierGstin, { attrs: ' maxlength="15" style="text-transform:uppercase"' })) +
        '<div class="field"><label>Options</label>' + UI.check('pRcm', 'Reverse charge (RCM) - GST payable by us, not to the supplier', p.rcm) + UI.check('pInc', 'Item rates include GST', p.inclusive) + '<div id="tdsRow" class="hidden">' + UI.check('pTds', 'Deduct TDS', false) + '</div></div></div>' +
        '<div class="tablewrap" style="margin-top:8px"><table class="items"><thead><tr><th>Item</th><th class="hsn">HSN</th><th class="qty">Qty</th><th class="rate">Rate</th><th class="gst">GST %</th><th class="inc">Stock</th><th class="del"></th></tr></thead><tbody id="pRows">' + rowsHtml() + '</tbody></table></div>' + UI.datalist('pItemsDl', Biz.itemLabels()) +
        '<div class="btnrow"><button class="btn sm" id="pAdd">+ Add Item</button></div><div class="totals" id="pTot"></div>' + UI.field('Notes', '<textarea id="pNotes">' + esc(p.notes) + '</textarea>'),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const v = (id) => UI.val(id, bg);
          if (!UI.dateVal('pDate', bg)) { UI.toast('Date is required'); return false; }
          const items = [];
          for (const it of p.items) {
            // An item already in the master keeps its name exactly; a new one is tidied the way the app does it
            const m = Biz.findMaster(it.name), name = m && !m.hidden ? m.name : U.nameCase(it.name);
            if (!name && !num(it.qty) && !num(it.rate)) continue;
            if (!name) { UI.toast('Item name is required'); return false; }
            if (num(it.qty) <= 0) { UI.toast('Enter quantity for ' + name); return false; }
            if (num(it.rate) <= 0) { UI.toast('Enter rate for ' + name); return false; }
            items.push({ name, hsn: String(it.hsn || '').trim(), qty: num(it.qty), uqc: it.uqc || 'NOS', rate: num(it.rate), gst: String(it.gst), stock: !!it.stock });
          }
          if (!items.length) { UI.toast('Add at least one item'); return false; }
          if (!U.isValidGstin(v('pGstin'))) { UI.mark('pGstin', true, bg); UI.toast('Enter a valid supplier GSTIN (15 characters, e.g. 37ABCDE1234F1ZZ)'); return false; }
          const tds = $('#pTds', bg).checked;
          Object.assign(p, { no: v('pNo').trim(), date: UI.dateVal('pDate', bg), paidBy: v('pPaid'), supplier: (suppliers.find(x => x.name.toLowerCase() === v('pSup').trim().toLowerCase()) || { name: U.nameCase(v('pSup')) }).name, supplierGstin: v('pGstin').trim().toUpperCase(), rcm: v('pRcm'), inclusive: v('pInc'), notes: v('pNotes').trim(), tdsRate: tds ? tdsRate : 0, tdsSection: tds ? tdsSection : '', items });
          purchaseTotals(p);
          if (p.id) Store.update('purchases', p); else Store.add('purchases', p);
          stockItemsToMaster(p); supplierToContacts(p);
          UI.toast((isQ ? 'Quotation ' : 'Purchase ') + p.no + ' saved'); Purchases.open();
        } }] });
      // TDS comes from the supplier's contact record; the deduction is shown and held as TDS payable
      const refreshTds = () => {
        const s = suppliers.find(x => x.name.toLowerCase() === UI.val('pSup', bg).trim().toLowerCase()) || Store.list('contacts').find(x => x.name.toLowerCase() === UI.val('pSup', bg).trim().toLowerCase());
        const rate = s && s.tds ? num(s.tdsRate) : 0, row = $('#tdsRow', bg), box = $('#pTds', bg), label = (t) => { $('label', row).lastChild.textContent = ' ' + t; };
        if (rate > 0) { label('Deduct TDS @ ' + U.fmtQty(rate) + '% (' + s.tdsSection + ')'); const shown = !row.classList.contains('hidden'); row.classList.remove('hidden'); if ((fresh || p.tdsRate > 0) && !shown) box.checked = true; tdsRate = rate; tdsSection = s.tdsSection; }
        else if (p.tdsRate > 0) { label('Deduct TDS @ ' + U.fmtQty(p.tdsRate) + '%'); if (row.classList.contains('hidden')) box.checked = true; row.classList.remove('hidden'); tdsRate = p.tdsRate; tdsSection = p.tdsSection; }
        else { row.classList.add('hidden'); box.checked = false; tdsRate = 0; }
      };
      const tot = () => {
        const t = purchaseTotals({ items: p.items.map(it => Object.assign({}, it)), rcm: UI.val('pRcm', bg), inclusive: UI.val('pInc', bg), supplierGstin: UI.val('pGstin', bg), tdsRate: $('#pTds', bg).checked ? tdsRate : 0 });
        const r = (k, v) => '<div class="k">' + k + '</div><div class="v">' + v + '</div>';
        $('#pTot', bg).innerHTML = r('Taxable', money(t.taxable)) + (t.igst || Biz.isInter(UI.val('pGstin', bg)) ? r(t.rcm ? 'RCM IGST (paid by us)' : 'IGST', money(t.igst)) : r(t.rcm ? 'RCM CGST (paid by us)' : 'CGST', money(t.cgst)) + r(t.rcm ? 'RCM SGST (paid by us)' : 'SGST', money(t.sgst))) +
          r(t.rcm ? 'Bill value' : 'Total', money(t.total)) + (t.tds ? r('Less TDS', money(t.tds)) + r('Payable to supplier', money(t.payable)) : '');
      };
      const wire = () => { $$('#pRows tr', bg).forEach(tr => { const it = p.items[+tr.dataset.i]; $$('[data-k]', tr).forEach(el => { const h = () => { it[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset.k === 'name') { const m = Biz.itemFromLabel(el.value); if (m) { it.name = m.name; if (el.value !== m.name) el.value = m.name; if (m.hsn) it.hsn = m.hsn; if (m.gst) it.gst = m.gst; $('[data-k=hsn]', tr).value = it.hsn; $('[data-k=gst]', tr).value = it.gst; } } tot(); }; el.addEventListener('input', h); el.addEventListener('change', h); });
        // The only row is cleared rather than removed so there is always one to type into
        $('[data-del]', tr).onclick = () => { if (p.items.length > 1) p.items.splice(+tr.dataset.i, 1); else Object.assign(it, { name: '', qty: '', rate: '' }); $('#pRows', bg).innerHTML = rowsHtml(); wire(); tot(); }; }); };
      $('#pAdd', bg).onclick = () => { p.items.push({ name: '', hsn: '', qty: '', rate: '', gst: '18', uqc: 'NOS', stock: true }); $('#pRows', bg).innerHTML = rowsHtml(); wire(); const rows = $$('#pRows tr', bg); $('[data-k=name]', rows[rows.length - 1]).focus(); };
      ['pRcm', 'pInc', 'pTds'].forEach(id => $('#' + id, bg).addEventListener('change', tot));
      $('#pGstin', bg).addEventListener('input', e => { const g = e.target.value.trim(); e.target.classList.toggle('err', g.length >= 15 && !U.isValidGstin(g)); tot(); });
      const supChanged = (fill) => { const s = suppliers.find(x => x.name.toLowerCase() === UI.val('pSup', bg).trim().toLowerCase()); if (fill && s && s.gstin) $('#pGstin', bg).value = s.gstin; refreshTds(); tot(); };
      $('#pSup', bg).addEventListener('input', () => supChanged(false)); $('#pSup', bg).addEventListener('change', () => supChanged(true));
      wire(); refreshTds(); tot();
    }
  };
  App.routes.purchases = () => Purchases.open();

  // ------------------------------------------------------------ expenses
  const Expenses = {
    open() {
      // Newest date first, then newest entry
      const list = Store.list('expenses').slice().sort((a, b) => U.dateMs(b.date) - U.dateMs(a.date) || num(b.createdAt) - num(a.createdAt));
      const total = list.reduce((s, e) => s + num(e.amount), 0);
      const root = App.view(App.header('Expenses', '<button class="btn sm green" id="eNew">+ Add Expense</button>') +
        '<div class="hint bold" style="margin-bottom:10px">' + (list.length ? list.length + ' entries   |   Total: ' + money(total) : 'No expenses recorded yet.') + '</div>' +
        listTable(['Date', 'Category', 'Paid By', '#Taxable', '#GST', '#Amount', ''], list.map(e => '<tr>' + td('Date', esc(e.date) + (e.no ? '<div class="small">' + U.noLink(e.no) + '</div>' : '')) + td('Category', '<b>' + esc(e.category) + '</b>' + (e.description ? '<div class="small muted">' + esc(e.description) + '</div>' : '')) + td('Paid By', esc(e.paidBy)) + td('Taxable', money(Books.expenseAmounts(e).taxable), 'num') + td('GST', money(e.gst) + (e.rcm ? '<div class="small muted">RCM, paid by us</div>' : ''), 'num') + td('Amount', '<b>' + money(e.amount) + '</b>', 'num') +
          '<td class="actions"><button class="btn sm outline" data-e="' + esc(e.id) + '">Edit</button><button class="btn sm red" data-d="' + esc(e.id) + '">Delete</button></td></tr>'), 'No expenses recorded yet.'));
      App.wireBack(root);
      $('#eNew').onclick = () => Expenses.edit(null);
      $$('[data-e]', root).forEach(b => b.onclick = () => Expenses.edit(Store.find('expenses', b.dataset.e)));
      $$('[data-d]', root).forEach(b => b.onclick = () => { const e = Store.find('expenses', b.dataset.d); UI.confirm('Delete Expense', 'Delete this ' + e.category + ' expense of ' + money(e.amount) + '?', () => { Store.delete('expenses', e.id); Expenses.open(); }, 'Delete'); });
    },
    /* GST on the bill (registered businesses only). Either type the full bill value and the taxable / GST parts are
       worked out, or type the taxable value and the bill value is worked out: the other side is greyed out so the
       three figures always agree. amount = what was paid to the vendor: taxable + GST for a normal bill, taxable
       only under reverse charge (the GST is then paid by us to the government). */
    edit(e) {
      const gstOn = Biz.chargesGst(), was = e;
      e = Object.assign({ date: U.today(), paidBy: 'Cash', category: '', rate: '0', taxable: '', gst: 0, amount: '', vendorGstin: '', rcm: false, description: '' }, e || {});
      const known = was ? Books.expenseAmounts(was) : null, byTaxable = !!known && (known.taxable > 0 || known.amount > 0);
      const bg = UI.modal({ title: e.id ? 'Edit Expense' : 'Add Expense', body: '<div class="grid2">' + UI.field('Date', UI.dateInput('eDate', e.date), { req: true }) + UI.field('Paid By', UI.select('ePaid', U.PAYMENT_MODES, e.paidBy)) +
        UI.field('Category', UI.input('eCat', e.category, { list: 'eCatDl', placeholder: 'e.g. Rent' }) + UI.datalist('eCatDl', EXPENSE_CATS), { req: true, span: true }) +
        (gstOn ? UI.field('How do you want to enter it?', UI.select('eMode', [['bill', 'Enter bill value (incl. GST)'], ['taxable', 'Enter taxable value + GST']], byTaxable ? 'taxable' : 'bill'), { span: true }) +
          UI.field('Bill Value', UI.input('eBill', '', { type: 'number', placeholder: '0.00', attrs: ' step="any" min="0"' })) + UI.field('GST Rate %', UI.select('eRate', U.GST_RATES, e.rate)) +
          UI.field('Taxable Value', UI.input('eTax', byTaxable ? known.taxable || known.amount : '', { type: 'number', placeholder: '0.00', attrs: ' step="any" min="0"' })) + UI.field('GST Amount', UI.input('eGst', '', { disabled: true })) +
          UI.field('Vendor GSTIN', UI.input('eVGstin', e.vendorGstin, { placeholder: 'optional, decides IGST vs CGST/SGST', attrs: ' maxlength="15" style="text-transform:uppercase"' })) + '<div class="field"><label>&nbsp;</label>' + UI.check('eRcm', 'Reverse charge (RCM) - GST payable by us, not to the vendor', e.rcm) + '</div>'
          : UI.field('Amount', UI.input('eAmt', num(e.amount) > 0 ? e.amount : '', { type: 'number', placeholder: '0.00', attrs: ' step="any" min="0"' }), { req: true, span: true })) +
        UI.field('Description', UI.input('eDesc', e.description, { placeholder: 'What was it for?' }), { span: true }) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const v = (id) => UI.val(id, bg), cat = U.nameCase(v('eCat'));
          if (!cat) { UI.mark('eCat', true, bg); UI.toast('Category is required'); return false; }
          if (!UI.dateVal('eDate', bg)) { UI.toast('Date is required'); return false; }
          if (gstOn) {
            const f = calc();
            if (!U.isValidGstin(v('eVGstin'))) { UI.mark('eVGstin', true, bg); UI.toast('Enter a valid vendor GSTIN (15 characters, e.g. 37ABCDE1234F1ZZ)'); return false; }
            if (f.taxable <= 0) { UI.mark(v('eMode') === 'bill' ? 'eBill' : 'eTax', true, bg); UI.toast('Enter the amount'); return false; }
            const vg = v('eVGstin').trim().toUpperCase(), inter = Biz.isInter(vg), gst = U.round2(f.gst), taxable = U.round2(f.taxable);
            Object.assign(e, { mode: v('eMode'), rate: v('eRate'), vendorGstin: vg, rcm: f.rcm, taxable, gst, cgst: inter ? 0 : gst / 2, sgst: inter ? 0 : gst / 2, igst: inter ? gst : 0, amount: f.rcm ? taxable : U.round2(taxable + gst) });
          } else {
            const amt = num(v('eAmt'));
            if (amt <= 0) { UI.mark('eAmt', true, bg); UI.toast('Enter the amount'); return false; }
            Object.assign(e, { taxable: amt, gst: 0, rate: '0', rcm: false, cgst: 0, sgst: 0, igst: 0, amount: amt });
          }
          Object.assign(e, { date: UI.dateVal('eDate', bg), paidBy: v('ePaid'), category: cat, description: v('eDesc').trim() });
          delete e.bill;
          if (e.id) Store.update('expenses', e); else Store.add('expenses', e); UI.toast('Expense saved'); Expenses.open();
        } }] });
      const calc = () => {
        const mode = UI.val('eMode', bg), r = num(UI.val('eRate', bg)) / 100, rcm = UI.val('eRcm', bg);
        $('#eBill', bg).disabled = mode !== 'bill'; $('#eTax', bg).disabled = mode === 'bill';
        let taxable, gst;
        // A reverse-charge bill carries no GST, so the bill value is the taxable value itself
        if (mode === 'bill') { const bill = num(UI.val('eBill', bg)); taxable = rcm ? bill : bill / (1 + r); gst = taxable * r; $('#eTax', bg).value = taxable.toFixed(2); }
        else { taxable = num(UI.val('eTax', bg)); gst = taxable * r; $('#eBill', bg).value = (rcm ? taxable : taxable + gst).toFixed(2); }
        $('#eGst', bg).value = gst.toFixed(2);
        return { taxable, gst, rcm };
      };
      if (gstOn) { ['eMode', 'eBill', 'eRate', 'eTax', 'eRcm'].forEach(id => { $('#' + id, bg).addEventListener('input', calc); $('#' + id, bg).addEventListener('change', calc); }); calc(); }
    }
  };
  App.routes.expenses = () => Expenses.open();

  // ------------------------------------------------------------ journal
  const ACCOUNT_KINDS = [['Customer (Party)', N.CUSTOMER], ['Supplier (Party)', N.SUPPLIER], ['Expense account (e.g. Depreciation, Interest)', N.EXPENSE], ['Income account', N.INCOME], ['Asset account (e.g. Vehicle, Machinery)', N.ASSET], ['Liability account (e.g. Loan from bank)', N.LIABILITY], ['Bank account', N.BANK], ['Cash / petty cash', N.CASH]];
  const NEW_ACCOUNT = '\u0001new';
  const Journal = {
    open() {
      const list = Store.list('journal').slice().sort((a, b) => U.dateMs(b.date) - U.dateMs(a.date) || num(b.createdAt) - num(a.createdAt));
      const drTotal = (j) => j.lines.filter(l => l.side === 'Dr').reduce((s, l) => s + num(l.amount), 0);
      const root = App.view(App.header('Journal Entries', '<div class="btnrow" style="margin:0"><button class="btn sm green" id="jNew">+ Add Journal Entry</button><button class="btn sm outline" id="jMoney">Receipts &amp; Payments</button></div>') +
        '<div class="hint" style="margin-bottom:10px">' + (list.length ? list.length + ' entries. Debit the account that receives value, credit the account that gives it.' : 'No journal entries yet. Use them for capital introduced, drawings, loans, asset purchases, depreciation, payments received or made, and corrections. An entry can have any number of debit and credit lines.') + '</div>' +
        // The lines in two columns: the accounts debited and the accounts credited, each with its amount
        listTable(['Date', 'Debit', 'Credit', 'Narration', '#Amount', ''], list.map(j => '<tr>' + td('Date', esc(j.date) + (j.vtype ? '<div><span class="pill ' + (j.vtype === 'receipt' ? 'ok' : 'warn') + '">' + (j.vtype === 'receipt' ? 'Receipt' : 'Payment') + (j.no ? ' ' + U.noLink(j.no) : '') + '</span></div>' : j.no ? '<div class="small">' + U.noLink(j.no) + '</div>' : '')) +
          td('Debit', '<div class="jl">' + j.lines.filter(l => l.side === 'Dr').map(l => '<div>' + esc(l.account) + '  <b>' + money(l.amount) + '</b></div>').join('') + '</div>') +
          td('Credit', '<div class="jl">' + j.lines.filter(l => l.side !== 'Dr').map(l => '<div>' + esc(l.account) + '  <b>' + money(l.amount) + '</b></div>').join('') + '</div>') + td('Narration', esc(j.narration)) + td('Amount', money(drTotal(j)), 'num') +
          '<td class="actions"><button class="btn sm outline" data-e="' + esc(j.id) + '">Edit</button><button class="btn sm red" data-d="' + esc(j.id) + '">Delete</button></td></tr>'), 'No journal entries yet.'));
      App.wireBack(root);
      $('#jMoney').onclick = () => App.go('money');
      $('#jNew').onclick = () => Journal.edit(null);
      $$('[data-e]', root).forEach(b => b.onclick = () => { const j = Store.find('journal', b.dataset.e); if (j.vtype && global.Money) Money.edit(j.vtype, j, () => Journal.open()); else Journal.edit(j); });
      $$('[data-d]', root).forEach(b => b.onclick = () => { const j = Store.find('journal', b.dataset.d); UI.confirm('Delete Journal Entry', 'Delete this entry of ' + money(drTotal(j)) + '?', () => { Store.delete('journal', j.id); Journal.open(); }, 'Delete'); });
    },
    // Parties are saved as contacts so they also appear in the customer / supplier lists and invoice suggestions
    newAccount(onDone) {
      const bg = UI.modal({ title: 'Create Party / Account', body: UI.field('Type', UI.select('aType', ACCOUNT_KINDS.map((k, i) => [i, k[0]]), 2), { req: true }) + UI.field('Name', UI.input('aName', ''), { req: true }) +
        '<div id="aParty" class="hidden">' + UI.field('Phone', UI.input('aPhone', '', { type: 'tel', attrs: ' maxlength="10"' })) + UI.field('GSTIN', UI.input('aGstin', '', { placeholder: 'GSTIN (optional)', attrs: ' maxlength="15" style="text-transform:uppercase"' })) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Create', cls: 'green', onClick: (bg) => {
          const k = +UI.val('aType', bg), name = U.nameCase(UI.val('aName', bg));
          if (!name) { UI.mark('aName', true, bg); UI.toast('Name is required'); return false; }
          if (k <= 1) {
            const phone = UI.val('aPhone', bg).trim(), gstin = UI.val('aGstin', bg).trim().toUpperCase();
            if (!U.isValidPhone(phone)) { UI.mark('aPhone', true, bg); UI.toast('Enter correct party phone number'); return false; }
            if (!U.isValidGstin(gstin)) { UI.mark('aGstin', true, bg); UI.toast('Enter a valid party GSTIN (15 characters, e.g. 37ABCDE1234F1ZZ)'); return false; }
            const list = Store.list('contacts'), ex = list.find(x => x.name.toLowerCase() === name.toLowerCase()), f = { name, phone, gstin, type: k === 0 ? 'Customer' : 'Supplier' };
            if (ex) Object.assign(ex, f, { updatedAt: Date.now() }); else list.push(Object.assign({ id: U.uid(), createdAt: Date.now(), address: '', state: '', email: '', tds: false, tdsSection: '', tdsRate: 0 }, f));
            Store.saveList('contacts', list);
          } else if (Books.accounts().some(a => a.name.toLowerCase() === name.toLowerCase())) { UI.toast('An account with that name already exists'); }
          else Store.add('accounts', { name, nature: ACCOUNT_KINDS[k][1] });
          UI.toast(name + ' created'); if (onDone) onDone(name);
        } }] });
      const show = () => $('#aParty', bg).classList.toggle('hidden', +UI.val('aType', bg) > 1);
      $('#aType', bg).addEventListener('change', show); show();
    },
    // A voucher with any number of debit and credit lines; it can only be saved when the two sides agree
    edit(j) {
      j = Object.assign({ date: U.today(), narration: '', lines: [] }, j ? JSON.parse(JSON.stringify(j)) : {});
      // manual = the user typed this amount; otherwise the editor fills it in to balance the entry
      let lines = j.lines.length ? j.lines.map(l => ({ account: l.account, side: l.side, amount: num(l.amount) > 0 ? num(l.amount).toFixed(2) : '', manual: num(l.amount) > 0 })) : [{ account: '', side: 'Dr', amount: '', manual: false }, { account: '', side: 'Cr', amount: '', manual: false }];
      const options = (sel) => { const acc = Books.accounts(); return '<option value="">Tap to choose account</option><option value="' + NEW_ACCOUNT + '">+ Create new party / account...</option>' + (sel && !acc.some(a => a.name === sel) ? '<option selected>' + esc(sel) + '</option>' : '') + acc.map(a => '<option value="' + esc(a.name) + '"' + (a.name === sel ? ' selected' : '') + '>' + esc(a.name + '   (' + a.nature + ')') + '</option>').join(''); };
      const rows = () => lines.map((l, i) => '<tr data-i="' + i + '">' + td('Dr/Cr', UI.select('', ['Dr', 'Cr'], l.side, { attrs: ' data-k="side"' }), 'gst') + td('Account', '<select data-k="account">' + options(l.account) + '</select>', 'desc') + td('Amount', '<input data-k="amount" class="num' + (l.manual ? '' : ' auto') + '" type="number" step="any" min="0" placeholder="Amount" value="' + esc(l.amount) + '">', 'rate') + '<td class="del"><button class="delbtn" title="Remove line" data-del>🗑</button></td></tr>').join('');
      const bg = UI.modal({ title: j.id ? 'Edit Journal Entry' : 'Add Journal Entry', wide: true, body: UI.field('Date', UI.dateInput('jDate', j.date), { req: true }) +
        '<div class="tablewrap" style="margin-top:8px"><table class="items"><thead><tr><th class="gst">Dr / Cr</th><th>Account</th><th class="rate">Amount</th><th class="del"></th></tr></thead><tbody id="jRows">' + rows() + '</tbody></table></div>' +
        '<div class="btnrow"><button class="btn sm blue" id="jDr">+ Debit line</button><button class="btn sm" id="jCr">+ Credit line</button><b id="jBal"></b></div>' + UI.field('Narration', '<textarea id="jNarr" placeholder="e.g. Capital introduced by owner">' + esc(j.narration) + '</textarea>') +
        '<div class="hint">Examples: capital brought in = Dr Bank, Cr Capital.  Depreciation = Dr Depreciation, Cr Fixed Assets.  Customer pays part cash, part bank = Dr Cash, Dr Bank, Cr &lt;customer&gt;.  GST paid = Dr Output CGST, Dr Output SGST, Cr Bank.</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          if (!UI.dateVal('jDate', bg)) { UI.toast('Date is required'); return false; }
          for (const l of lines) { if (!l.account) { UI.toast('Choose an account on every line'); return false; } if (num(l.amount) <= 0) { UI.toast('Enter the amount on every line'); return false; } }
          const dr = lines.filter(l => l.side === 'Dr').reduce((s, l) => s + num(l.amount), 0), cr = lines.filter(l => l.side === 'Cr').reduce((s, l) => s + num(l.amount), 0);
          if (Math.abs(dr - cr) >= 0.005 || dr <= 0) { UI.toast('Debit and credit totals must be equal'); return false; }
          j.date = UI.dateVal('jDate', bg); j.narration = UI.val('jNarr', bg).trim(); j.lines = lines.map(l => ({ account: l.account, side: l.side, amount: num(l.amount) }));
          if (j.id) Store.update('journal', j); else Store.add('journal', j); UI.toast('Journal entry saved'); Journal.open();
        } }] });
      // Auto-balance: the last untyped line on the lighter side receives whatever makes both sides equal
      const refresh = () => {
        let drManual = 0, crManual = 0, drAuto = -1, crAuto = -1;
        lines.forEach((l, i) => { if (l.manual) { if (l.side === 'Dr') drManual += num(l.amount); else crManual += num(l.amount); } else { l.amount = ''; if (l.side === 'Dr') drAuto = i; else crAuto = i; } });
        const gap = drManual - crManual;
        if (gap > 0.004 && crAuto >= 0) lines[crAuto].amount = gap.toFixed(2); else if (gap < -0.004 && drAuto >= 0) lines[drAuto].amount = (-gap).toFixed(2);
        $$('#jRows tr', bg).forEach(tr => { const l = lines[+tr.dataset.i], el = $('[data-k=amount]', tr); if (!l.manual) el.value = l.amount; el.classList.toggle('auto', !l.manual); });
        const dr = lines.filter(l => l.side === 'Dr').reduce((s, l) => s + num(l.amount), 0), cr = lines.filter(l => l.side === 'Cr').reduce((s, l) => s + num(l.amount), 0), ok = Math.abs(dr - cr) < 0.005;
        $('#jBal', bg).textContent = 'Debit ' + money(dr) + '   Credit ' + money(cr) + (ok ? '   (balanced)' : '   Difference ' + money(Math.abs(dr - cr)));
        $('#jBal', bg).className = ok && dr > 0 ? 'green' : 'red';
      };
      const wire = () => {
        $$('#jRows tr', bg).forEach(tr => {
          const i = +tr.dataset.i, l = lines[i];
          $('[data-k=side]', tr).addEventListener('change', e => { l.side = e.target.value; refresh(); });
          $('[data-k=account]', tr).addEventListener('change', e => {
            if (e.target.value !== NEW_ACCOUNT) { l.account = e.target.value; return; }
            e.target.value = l.account;
            Journal.newAccount((name) => { l.account = name; redraw(); });
          });
          $('[data-k=amount]', tr).addEventListener('input', e => { l.amount = e.target.value; l.manual = e.target.value.trim() !== ''; refresh(); });
          $('[data-del]', tr).onclick = () => { if (lines.length <= 2) { UI.toast('An entry needs at least one debit and one credit line'); return; } lines.splice(i, 1); redraw(); };
        });
        refresh();
      };
      const redraw = () => { $('#jRows', bg).innerHTML = rows(); wire(); };
      $('#jDr', bg).onclick = () => { lines.push({ account: '', side: 'Dr', amount: '', manual: false }); redraw(); };
      $('#jCr', bg).onclick = () => { lines.push({ account: '', side: 'Cr', amount: '', manual: false }); redraw(); };
      wire();
    }
  };
  App.routes.journal = () => Journal.open();

  // ------------------------------------------------------------ stock in hand
  // Removing an item from stock: its lines leave the stock-upload documents and its purchase lines lose the
  // "Stock" tick, so it no longer counts in stock in hand. Purchases themselves stay in the books. Optionally
  // the item also leaves the item master. Returns the number of items removed.
  function removeFromStock(names, fromMaster) {
    const keys = new Set(names.map(n => String(n).trim().toLowerCase()));
    const purchases = Store.list('purchases').filter(p => {
      if (p.kind === 'QTN') return true;
      p.items.forEach(it => { if (it.stock && keys.has(String(it.name || '').trim().toLowerCase())) it.stock = false; });
      if (p.kind === 'STK') { p.items = p.items.filter(it => !keys.has(String(it.name || '').trim().toLowerCase())); return p.items.length > 0; }
      return true;
    });
    purchases.forEach(p => { if (p.kind === 'STK') purchaseTotals(p); });
    Store.saveList('purchases', purchases);
    if (fromMaster) Store.saveList('items', Store.list('items').filter(i => !keys.has(String(i.name || '').trim().toLowerCase())));
    return keys.size;
  }
  const Stock = { select: false };
  App.routes.stock = function () {
    const rows = Books.stock(null), total = rows.reduce((s, r) => s + r.value, 0), sel = Stock.select && rows.length > 0;
    // Purchase lines that were not ticked as stock: one click counts everything bought as stock
    const untagged = Store.list('purchases').filter(p => p.kind === 'PUR').reduce((n, p) => n + p.items.filter(it => !it.stock && String(it.name || '').trim()).length, 0);
    const root = App.view(App.header(sel ? 'Select Stock Items' : 'Stock in Hand', '<div class="btnrow" style="margin:0"><button class="btn sm green" id="stUp">Upload Stock</button><button class="btn sm outline" id="stTpl">Template</button><button class="btn sm outline" id="stItems">Item Master</button>' + (rows.length ? '<button class="btn sm outline" id="stSel">' + (sel ? 'Done' : 'Select') + '</button>' : '') + '</div>') +
      (sel ? '<div class="btnrow"><label class="check"><input type="checkbox" id="selAll"> Select all</label><button class="btn sm red" id="bDel">Delete selected</button></div>' : '') +
      (untagged && !sel ? '<div class="btnrow"><button class="btn sm blue" id="stAll">Count all purchases as stock</button><span class="hint">' + untagged + ' purchase line' + (untagged === 1 ? '' : 's') + ' not counted in stock</span></div>' : '') +
      (rows.length ? '<div class="hint bold" style="margin-bottom:10px">Stock value (at last purchase rate): ' + money(total) + '</div>' : '') +
      listTable(['', 'Item', '#Bought', '#Sold', '#In Hand', '#Rate', '#Value', ''], rows.map(s => '<tr>' + td('', sel ? '<input type="checkbox" class="selbox" data-n="' + esc(s.name) + '">' : '') + td('Item', '<b>' + esc(s.name) + '</b>' + (s.uqc ? ' (' + esc(s.uqc) + ')' : '')) + td('Bought', U.fmtQty(s.purchased), 'num') + td('Sold', U.fmtQty(s.sold), 'num') + td('In Hand', '<span class="' + (s.onHand <= 0 ? 'red bold' : '') + '">' + U.fmtQty(s.onHand) + '</span>', 'num') + td('Rate', U.indianNumber(s.lastRate), 'num') + td('Value', money(s.value), 'num') +
        '<td class="actions">' + (sel ? '' : '<button class="btn sm red" data-d="' + esc(s.name) + '">Delete</button>') + '</td></tr>'),
        'No stock items yet. Every item on a purchase counts as stock (the "Stock" tick on the line; untick it for a service). Quantities sold on invoices are deducted automatically.'));
    App.wireBack(root);
    if ($('#stAll')) $('#stAll').onclick = () => UI.confirm('Count Purchases as Stock', 'Tick "Stock" on every line of every purchase, so what was bought counts in stock in hand (quantities sold on invoices are deducted)? Untick a line on its purchase later if it is not stock, a service for instance.', () => {
      const all = Store.list('purchases'); let n = 0;
      all.forEach(p => { if (p.kind !== 'PUR') return; p.items.forEach(it => { if (!it.stock && String(it.name || '').trim()) { it.stock = true; n++; } }); });
      Store.saveList('purchases', all);
      all.forEach(p => stockItemsToMaster(p));
      UI.toast(n + ' purchase line' + (n === 1 ? '' : 's') + ' now count in stock'); App.go('stock');
    }, 'Count as stock');
    // Confirms, with the choice of also dropping the items from the item master
    const confirmDelete = (names) => {
      const one = names.length === 1;
      UI.modal({ title: one ? 'Delete Stock Item' : 'Delete Stock Items', body: '<p>' + (one ? 'Remove <b>' + esc(names[0]) + '</b>' : 'Remove <b>' + names.length + ' items</b>') + ' from stock? Uploaded stock quantities are deleted and purchase lines stop counting as stock. Purchases and invoices themselves are kept.</p>' + UI.check('stMaster', 'Also delete from the item master (no longer offered on invoices)', false),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Delete', cls: 'red', onClick: (bg) => { const n = removeFromStock(names, UI.val('stMaster', bg)); UI.toast(n + (n === 1 ? ' item' : ' items') + ' removed from stock'); Stock.select = false; App.go('stock'); } }] });
    };
    $('#stItems').onclick = () => App.go('items');
    if ($('#stSel')) $('#stSel').onclick = () => { Stock.select = !Stock.select; App.go('stock'); };
    if (sel) {
      $('#selAll').onchange = e => $$('.selbox', root).forEach(b => b.checked = e.target.checked);
      $('#bDel').onclick = () => { const names = $$('.selbox:checked', root).map(b => b.dataset.n); if (!names.length) return UI.toast('Tick the items first'); confirmDelete(names); };
    }
    $$('[data-d]', root).forEach(b => b.onclick = () => confirmDelete([b.dataset.d]));
    $('#stTpl').onclick = () => { UI.download('BlitzBook_Stock_Template.csv', 'Item,HSN,Qty,UQC,Rate,GST%\nWooden Chair,9401,10,NOS,1500,18\nDining Table,9403,2,NOS,12000,18\n', 'text/csv'); UI.toast('Template downloaded'); };
    // Columns: Item, HSN, Qty, UQC, Rate, GST%. New items become one opening-stock document dated today. An item
    // uploaded earlier is brought to the file's quantity and rate (upsert) or left alone (insert only). Every item
    // joins the item master so it can be invoiced straight away.
    $('#stUp').onclick = () => UI.pickSheet((sheet) => {
      const col = columns(sheet, 'item', ['item', 'hsn', 'qty', 'uqc', 'rate', 'gst']);
      const items = col.body.map(r => ({ name: U.nameCase(col.get(r, 'item')), hsn: col.get(r, 'hsn'), qty: num(col.get(r, 'qty')), uqc: col.get(r, 'uqc').toUpperCase() || 'NOS', rate: num(col.get(r, 'rate')), gst: col.get(r, 'gst').replace('%', '') || '18', stock: true })).filter(it => it.name && it.qty > 0);
      if (!items.length) { UI.alert('Upload Stock', 'No stock rows found. The columns are Item, HSN, Qty, UQC, Rate, GST% (download the template).'); return; }
      // The uploaded line an item already has, in the latest stock-upload document that carries it
      const docs = Store.list('purchases'), key = (s) => String(s || '').trim().toLowerCase();
      const lineOf = (name) => { for (let n = docs.length - 1; n >= 0; n--) { const p = docs[n]; if (p.kind !== 'STK') continue; const it = p.items.find(x => key(x.name) === key(name)); if (it) return { p, it }; } return null; };
      const known = items.filter(it => lineOf(it.name)).length;
      UI.modal({ title: 'Upload Stock', focus: false, body: '<p>' + items.length + ' item' + (items.length === 1 ? '' : 's') + ' in the file: <b>' + (items.length - known) + '</b> new, <b>' + known + '</b> uploaded earlier.</p>' + UI.modeField('Stock items') +
        '<div class="hint">Upsert sets an item uploaded earlier to the quantity and rate in the file (it does not add to it). Stock bought on purchase bills is never changed by an upload.</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Upload', cls: 'green', onClick: (bg) => {
          const mode = UI.modeOf(bg), r = { inserted: 0, updated: 0, unchanged: 0, skipped: 0, lines: [] }, fresh = [], touched = new Set();
          items.forEach(it => {
            const was = lineOf(it.name);
            if (!was) { fresh.push(it); r.inserted++; return; }
            if (mode === 'insert') { r.skipped++; r.lines.push(it.name + ': uploaded earlier, left as it is'); return; }
            const same = num(was.it.qty) === it.qty && num(was.it.rate) === it.rate && String(was.it.gst) === String(it.gst) && (!it.hsn || was.it.hsn === it.hsn) && was.it.uqc === it.uqc;
            if (same) { r.unchanged++; return; }
            Object.assign(was.it, { qty: it.qty, rate: it.rate, gst: it.gst, uqc: it.uqc }, it.hsn ? { hsn: it.hsn } : {}); touched.add(was.p); r.updated++;
          });
          touched.forEach(p => Store.update('purchases', purchaseTotals(p)));
          if (fresh.length) Store.add('purchases', purchaseTotals({ kind: 'STK', no: nextNo('STK'), date: U.today(), supplier: 'Stock upload', supplierGstin: '', paidBy: 'Credit', rcm: false, inclusive: false, tdsRate: 0, tdsSection: '', items: fresh, notes: '' }));
          items.forEach(it => Biz.upsertMaster(it.name, Object.assign({ gst: it.gst, hidden: false }, it.hsn ? { hsn: it.hsn } : {})));
          UI.importResult('Stock uploaded', r, () => App.go('stock'));
        } }] });
    });
  };

  global.Books = Books;
  global.Ledger = { EXPENSE_CATS, TDS_SECTIONS, purchaseTotals, Contacts, Items, Purchases, Expenses, Journal, listTable, td, columns, nextNo };
})(window);
