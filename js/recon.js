/* BlitzBook web portal - Tax Reconciliation (Company > Tax Reconciliation), for the four countries the books are kept in.

   Reconciling is checking the books against what the tax authority and the other party have, before a return is
   filed. Four tabs, each in the words and under the rules of the company's country:
     Purchases   the purchase bills of the books against the supplier-side data.
                 India: the GSTR-2B (or GSTR-2A) JSON downloaded from the GST portal, the statement that decides how
                 much input tax credit may be claimed. UAE, Australia, US: a sheet (CSV / Excel) of the suppliers'
                 tax invoices - a supplier statement, the ledger of the accountant, an export of another system.
     Sales       the invoices of the books against what was reported: India the GSTR-1 JSON as filed (or the e-invoice
                 list); elsewhere a sheet of the sales reported.
     Return      the figures of the period worked out from the books, line by line as the country's return asks for
                 them (GSTR-3B; VAT 201; BAS; sales tax by state), beside the figures filed, typed in: the difference shows.
     Checks      the rules a reconciliation is meant to catch, per country: tax numbers that do not validate, input tax
                 that cannot be claimed (no tax number, no bill number, a bill twice, unpaid beyond 180 days), the time
                 limit for claiming, e-invoices and e-way bills not made (India), tax invoices above AED 10,000 without
                 a TRN (UAE), purchases above A$82.50 without an ABN (Australia), economic nexus by state (US).
   Rows are paired by tax number (or name) and document number, then by number without its prefix, then by amount and
   date; each pair is Matched, Mismatch (the amounts differ by more than the tolerance), Probable (the number differs),
   Only in the books or Only in the file. The tolerance is settings.recon of the company's settings (Settings >
   Reconciliation). The uploaded files and the figures typed stay in this browser.

   Nothing here files anything: it is a working paper to settle differences before filing. */
(function (global) {
  'use strict';
  const { esc, num } = U;
  const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
  const money = (v) => U.inr(v);
  const MONTHS = U.MONTHS;
  const DAY = 86400000;
  const DEFAULTS = { tol: 1, days: 0, loose: true };
  const first = (s) => String(s || '').split('\n')[0].trim();

  // ------------------------------------------------------------ periods (months, quarters, financial years)
  const span = (a, b, label) => ({ from: a.getTime(), to: b.getTime(), label, key: U.dmy(a) + '-' + U.dmy(b) });
  function periods() {
    const out = [], n = new Date(), fm = U.fyMonth() - 1;
    for (let i = 0; i < 18; i++) { const a = new Date(n.getFullYear(), n.getMonth() - i, 1); out.push(span(a, new Date(a.getFullYear(), a.getMonth() + 1, 0), MONTHS[a.getMonth()] + ' ' + a.getFullYear())); }
    const q0 = new Date(n.getFullYear(), n.getMonth() - ((n.getMonth() - fm + 12) % 3), 1);
    for (let i = 0; i < 8; i++) { const a = new Date(q0.getFullYear(), q0.getMonth() - 3 * i, 1), b = new Date(a.getFullYear(), a.getMonth() + 3, 0); out.push(span(a, b, 'Quarter ' + MONTHS[a.getMonth()].slice(0, 3) + ' - ' + MONTHS[b.getMonth()].slice(0, 3) + ' ' + b.getFullYear())); }
    const y = U.fyFirstYear();
    [y, y - 1].forEach(v => out.push(span(U.fyStartDate(v), U.fyEndDate(v), 'Financial year ' + U.fyLabel(v))));
    return out;
  }

  // ------------------------------------------------------------ tax numbers
  // An Australian Business Number: 11 digits, the first less one, weighted, divisible by 89
  function validAbn(v) { const d = String(v || '').replace(/\s/g, ''); if (!/^\d{11}$/.test(d)) return false; const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]; return d.split('').reduce((s, c, i) => s + (i === 0 ? +c - 1 : +c) * w[i], 0) % 89 === 0; }
  // A UAE Tax Registration Number: 15 digits (those the FTA issues begin with 100)
  function validTrn(v) { return /^\d{15}$/.test(String(v || '').replace(/[\s-]/g, '')); }
  function validTaxId(v, code) { const s = String(v || '').trim(); if (!s) return true; code = code || U.region().code; return code === 'IN' ? s.length === 15 && U.isValidGstin(s) : code === 'AE' ? validTrn(s) : code === 'AU' ? validAbn(s) : /\d{2}-?\d{7}|\w{5,}/.test(s); }
  const normId = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normName = (v) => first(v).toUpperCase().replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|LLC|INC|CO|COMPANY|CORP|PTY|FZE|FZCO|FZ|THE|AND|M\/S|MS)\b/g, '').replace(/[^A-Z0-9]/g, '');
  // A document number as it is compared: letters and digits only; and loosely: its last run of digits without leading zeros
  const normNo = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
  // ... the financial year in it (26-27, 2026-27, 2026) is not part of the number
  const looseNo = (v) => {
    const s = String(v || '').replace(/(^|[^0-9])(?:19|20)?(\d{2})\s*[-\/]\s*(?:19|20)?(\d{2})(?![0-9])/g, (m, pre, a, b) => +b === (+a + 1) % 100 ? pre + ' ' : m);
    const runs = s.match(/\d+/g); if (!runs) return normNo(v);
    const pick = runs.filter(x => !(runs.length > 1 && /^(19|20)\d{2}$/.test(x)));
    return String(parseInt(pick[pick.length - 1] || runs[runs.length - 1], 10));
  };

  // ------------------------------------------------------------ the books as rows
  // {id, kind, type: 'I' invoice | 'C' credit note | 'D' debit note, taxId, party, no, date, ms, taxable, tax, total, open: {route...}}
  const taxOf = (x) => r2(num(x.cgst) + num(x.sgst) + num(x.igst)) || r2(num(x.gst));
  function purchaseRows() {
    const out = [];
    Store.list('purchases').filter(p => p.kind === 'PUR').forEach(p => out.push({ id: p.id, kind: 'Purchase', type: 'I', taxId: normId(p.supplierGstin), party: p.supplier || '', no: String(p.billNo || p.no || ''), ownNo: p.no, hasBillNo: !!String(p.billNo || '').trim(), date: p.billDate || p.date, ms: U.dateMs(p.billDate || p.date) || U.dateMs(p.date), bookMs: U.dateMs(p.date), taxable: num(p.taxable), tax: taxOf(p), total: num(p.total), rcm: !!p.rcm }));
    // An expense with the vendor's tax number and tax on it is a claim of input tax too
    Store.list('expenses').filter(e => String(e.vendorGstin || '').trim() && taxOf(e) > 0).forEach(e => out.push({ id: e.id, kind: 'Expense', type: 'I', taxId: normId(e.vendorGstin), party: e.description || e.category || '', no: String(e.billNo || e.no || ''), ownNo: e.no, hasBillNo: !!String(e.billNo || '').trim(), date: e.date, ms: U.dateMs(e.date), bookMs: U.dateMs(e.date), taxable: num(e.taxable) || num(e.amount), tax: taxOf(e), total: num(e.amount), rcm: !!e.rcm }));
    // Our debit note to a supplier is the supplier's credit note to us
    Store.list('notes').filter(n => n.kind === 'DN').forEach(n => out.push({ id: n.id, kind: 'Debit note', type: 'C', taxId: normId(n.partyGstin), party: n.party || '', no: String(n.no || ''), ownNo: n.no, hasBillNo: false, date: n.date, ms: U.dateMs(n.date), bookMs: U.dateMs(n.date), taxable: num(n.taxable), tax: taxOf(n), total: num(n.total) }));
    return out;
  }
  function salesRows() {
    const out = [];
    Biz.invoices().forEach(i => { const t = i.totals || {}; out.push({ id: i.id, kind: 'Invoice', type: 'I', taxId: normId(i.buyer && i.buyer.gstin), party: first(i.buyer && i.buyer.name) || 'Cash sale', no: String(i.no || ''), ownNo: i.no, hasBillNo: true, date: i.date, ms: U.dateMs(i.date), bookMs: U.dateMs(i.date), taxable: num(t.taxable), tax: i.rcm ? 0 : r2(num(t.cgst) + num(t.sgst) + num(t.igst)), total: num(t.rounded) || num(t.grand), rcm: !!i.rcm, state: i.buyer && i.buyer.state }); });
    Store.list('notes').filter(n => n.kind === 'CN').forEach(n => out.push({ id: n.id, kind: 'Credit note', type: 'C', taxId: normId(n.partyGstin), party: n.party || '', no: String(n.no || ''), ownNo: n.no, hasBillNo: true, date: n.date, ms: U.dateMs(n.date), bookMs: U.dateMs(n.date), taxable: num(n.taxable), tax: taxOf(n), total: num(n.total) }));
    return out;
  }

  // ------------------------------------------------------------ the other side: a file from the portal, the supplier or another system
  const amt = (v) => { if (typeof v === 'number') return v; let s = String(v == null ? '' : v).trim(); if (!s) return 0; const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /\bCR\b/i.test(s); s = s.replace(/[^0-9.]/g, ''); const n = parseFloat(s); return isFinite(n) ? (neg ? -n : n) : 0; };
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function dateIn(v, mdy) {
    const s = String(v == null ? '' : v).trim(); if (!s) return '';
    if (/^\d{5}(\.\d+)?$/.test(s)) return U.sheetDate(String(Math.floor(+s)));
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return U.pad(+m[3]) + '/' + U.pad(+m[2]) + '/' + m[1];
    m = /^(\d{1,2})[\/.\- ]([A-Za-z]{3})[A-Za-z]*[\/.\- ,]+(\d{2,4})$/.exec(s); if (m && MON[m[2].toLowerCase()]) return U.pad(+m[1]) + '/' + U.pad(MON[m[2].toLowerCase()]) + '/' + (m[3].length === 2 ? '20' + m[3] : m[3]);
    m = /^([A-Za-z]{3})[A-Za-z]*[\/.\- ]+(\d{1,2})[\/.\- ,]+(\d{4})$/.exec(s); if (m && MON[m[1].toLowerCase()]) return U.pad(+m[2]) + '/' + U.pad(MON[m[1].toLowerCase()]) + '/' + m[3];
    m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(s);
    if (m) { let d = +m[1], mo = +m[2]; if ((mdy && d <= 12) || mo > 12) { const t = d; d = mo; mo = t; } return U.pad(d) + '/' + U.pad(mo) + '/' + (m[3].length === 2 ? '20' + m[3] : m[3]); }
    return s;
  }
  const row = (o) => { const r = { taxId: normId(o.taxId), party: String(o.party || '').trim(), no: String(o.no == null ? '' : o.no).trim(), date: o.date || '', taxable: r2(o.taxable), tax: r2(o.tax), total: r2(o.total), type: o.type || 'I', note: o.note || '' }; r.ms = U.dateMs(r.date); if (!r.total) r.total = r2(r.taxable + r.tax); return r; };
  /* The JSON files of the GST portal. GSTR-2B: {data: {docdata: {b2b: [{ctin, trdnm, inv: [{inum, dt, val, items: [{txval,
     igst, cgst, sgst}]}]}], cdnr: [{ctin, nt: [{ntnum, typ, dt, val, ...}]}]}}}. GSTR-2A and GSTR-1: {b2b: [{ctin, inv: [{inum,
     idt, val, itms: [{itm_det: {txval, iamt, camt, samt}}]}]}], cdnr / cdn: [{ctin, nt: [{nt_num, nt_dt, ntty, val, itms}]}]}. */
  function fromGstJson(j) {
    const out = [], root = (j && j.data && (j.data.docdata || j.data)) || j || {};
    const sumOf = (d) => {
      const its = d.items || d.itms || [], o = { taxable: 0, tax: 0 };
      if (its.length) its.forEach(x => { const t = x.itm_det || x; o.taxable += num(t.txval); o.tax += num(t.igst) + num(t.cgst) + num(t.sgst) + num(t.iamt) + num(t.camt) + num(t.samt); });
      else { o.taxable = num(d.txval); o.tax = num(d.igst) + num(d.cgst) + num(d.sgst) + num(d.iamt) + num(d.camt) + num(d.samt); }
      return o;
    };
    const docs = (list, key, type) => (Array.isArray(list) ? list : []).forEach(p => {
      const taxId = p.ctin || p.gstin || '', party = p.trdnm || p.lglnm || p.cname || '';
      (p[key] || []).forEach(d => { const s = sumOf(d), ty = type || (/^d/i.test(d.typ || d.ntty || '') ? 'D' : 'C');
        out.push(row({ taxId, party, no: d.inum || d.ntnum || d.nt_num || '', date: dateIn(d.dt || d.idt || d.nt_dt || ''), taxable: s.taxable, tax: s.tax, total: num(d.val), type: ty, note: [d.itcavl === 'N' ? 'ITC not available' + (d.rsn ? ' (' + d.rsn + ')' : '') : '', d.rev === 'Y' || d.rchrg === 'Y' ? 'reverse charge' : '', p.cfs === 'N' ? 'supplier has not filed' : ''].filter(Boolean).join('; ') })); });
    });
    ['b2b', 'b2ba'].forEach(k => docs(root[k], 'inv', 'I'));
    ['cdnr', 'cdnra', 'cdn', 'cdna'].forEach(k => docs(root[k], 'nt', null));
    // GSTR-1: large invoices to unregistered buyers, by state
    (Array.isArray(root.b2cl) ? root.b2cl : []).forEach(p => (p.inv || []).forEach(d => { const s = sumOf(d); out.push(row({ taxId: '', party: 'Unregistered (' + (p.pos || '') + ')', no: d.inum, date: dateIn(d.idt), taxable: s.taxable, tax: s.tax, total: num(d.val) })); }));
    return out;
  }
  const HEADS = {
    taxId: ['gstinofsupplier', 'gstinuinofrecipient', 'gstin', 'ctin', 'suppliergstin', 'trn', 'taxregistrationnumber', 'abn', 'taxid', 'ein', 'vatnumber', 'vatno', 'taxnumber', 'taxno'],
    party: ['tradelegalname', 'tradename', 'legalname', 'suppliername', 'vendorname', 'customername', 'receivername', 'partyname', 'supplier', 'vendor', 'customer', 'party', 'name', 'contact'],
    no: ['invoicenumber', 'invoiceno', 'invno', 'billnumber', 'billno', 'documentnumber', 'documentno', 'docno', 'notenumber', 'noteno', 'inum', 'vouchernumber', 'referenceno', 'reference', 'number', 'invoice'],
    date: ['invoicedate', 'billdate', 'documentdate', 'docdate', 'notedate', 'date'],
    taxable: ['taxablevalue', 'taxableamount', 'taxable', 'netamount', 'amountexcl', 'amountexcludingtax', 'subtotal', 'exclusive', 'net'],
    igst: ['integratedtax', 'igst'], cgst: ['centraltax', 'cgst'], sgst: ['stateuttax', 'statetax', 'sgst', 'utgst'],
    tax: ['totaltax', 'taxamount', 'vatamount', 'gstamount', 'salestax', 'vat', 'gst', 'tax'],
    total: ['invoicevalue', 'notevalue', 'grandtotal', 'totalamount', 'amountincl', 'gross', 'inclusive', 'total', 'value', 'amount'],
    type: ['notetype', 'documenttype', 'doctype', 'type']
  };
  // A sheet: the heading row is found (two heading rows, as in the GST portal's Excel, are read as one), the columns by their names
  function fromSheet(rows, mdy) {
    const key = (c) => String(c == null ? '' : c).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
    let at = -1;
    for (let i = 0; i < Math.min(rows.length, 20) && at < 0; i++) { const ks = rows[i].map(key); if (ks.some(k => HEADS.no.some(h => k.includes(h))) || (ks.some(k => HEADS.taxId.some(h => k === h || k.startsWith(h))) && ks.some(k => /value|amount|tax|total/.test(k)))) at = i; }
    if (at < 0) throw new Error('No heading row was found. The sheet needs a row of headings such as: ' + U.region().taxId + ', Invoice No, Invoice Date, Taxable Value, Tax, Total.');
    let head = rows[at].map(key), body = rows.slice(at + 1);
    const next = rows[at + 1];
    if (next && next.some(c => /number|date|value|tax/i.test(String(c))) && !next.some(c => /^\s*[\d,]+(\.\d+)?\s*$/.test(String(c)) && amt(c) > 31)) { head = head.map((h, i) => key(next[i]) || h); body = rows.slice(at + 2); }
    const find = (name, used) => { for (const h of HEADS[name]) { const i = head.findIndex((k, n) => !used.has(n) && k === h); if (i >= 0) return i; } for (const h of HEADS[name]) { const i = head.findIndex((k, n) => !used.has(n) && k.includes(h)); if (i >= 0) return i; } return -1; };
    const used = new Set(), col = {};
    ['taxId', 'no', 'date', 'igst', 'cgst', 'sgst', 'taxable', 'type', 'party', 'tax', 'total'].forEach(n => { col[n] = find(n, used); if (col[n] >= 0) used.add(col[n]); });
    if (col.no < 0) throw new Error('No column for the invoice number was found (Invoice No, Bill No, Document Number ...).');
    const g = (r, n) => col[n] >= 0 ? r[col[n]] : '';
    // Rate-wise lines of one document are summed
    const by = new Map();
    body.forEach(r => {
      const no = String(g(r, 'no') == null ? '' : g(r, 'no')).trim(); if (!no || /^total/i.test(no)) return;
      const taxId = normId(g(r, 'taxId')), k = taxId + '|' + normNo(no), split = amt(g(r, 'igst')) + amt(g(r, 'cgst')) + amt(g(r, 'sgst'));
      const ty = /credit/i.test(String(g(r, 'type'))) ? 'C' : /debit/i.test(String(g(r, 'type'))) ? 'D' : 'I';
      let e = by.get(k); if (!e) { e = { taxId, party: g(r, 'party'), no, date: dateIn(g(r, 'date'), mdy), taxable: 0, tax: 0, total: 0, type: ty, n: 0 }; by.set(k, e); }
      e.taxable += amt(g(r, 'taxable')); e.tax += split || amt(g(r, 'tax')); e.total = Math.max(e.total, amt(g(r, 'total'))); e.n++;
    });
    return Array.from(by.values()).map(e => { if (!e.taxable && e.total) e.taxable = e.total - e.tax; return row(e); });
  }

  // ------------------------------------------------------------ pairing the two sides
  // Returns [{status: matched | mismatch | probable | bookOnly | otherOnly, b, o, why}]
  function match(book, other, p, opts) {
    const tol = Math.max(0, num(opts.tol)), days = Math.max(0, num(opts.days)), res = [], usedB = new Set(), usedO = new Set();
    const pk = (r) => r.taxId || 'N:' + normName(r.party), near = (a, b) => Math.abs(num(a) - num(b)) <= tol + 0.005;
    const same = (b, o) => near(b.taxable, o.taxable) && near(b.tax, o.tax);
    const diffs = (b, o) => { const d = []; if (!near(b.taxable, o.taxable)) d.push('taxable differs by ' + money(r2(b.taxable - o.taxable))); if (!near(b.tax, o.tax)) d.push('tax differs by ' + money(r2(b.tax - o.tax))); if (b.ms && o.ms && Math.abs(b.ms - o.ms) > days * DAY) d.push('date ' + b.date + ' / ' + o.date); return d; };
    const index = (keyOf) => { const m = new Map(); other.forEach((o, i) => { const k = keyOf(o); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(i); }); return m; };
    const pair = (bi, oi, status, why) => { usedB.add(bi); usedO.add(oi); res.push({ status, b: book[bi], o: other[oi], why: why || '' }); };
    const pass = (keyOf, decide) => { const m = index(keyOf); book.forEach((b, bi) => { if (usedB.has(bi)) return; const k = keyOf(b); if (!k) return; const c = (m.get(k) || []).filter(oi => !usedO.has(oi) && other[oi].type === b.type); if (!c.length) return; const oi = c.find(x => same(b, other[x])); decide(b, bi, oi != null ? oi : c[0], oi != null); }); };
    // 1. the same party and the same number
    pass((r) => normNo(r.no) ? pk(r) + '|' + normNo(r.no) : '', (b, bi, oi, ok) => { const d = diffs(b, other[oi]); pair(bi, oi, ok ? 'matched' : 'mismatch', ok ? d.filter(x => /^date/.test(x)).join('; ') : d.join('; ')); });
    // 2. the same party, the number without its prefix, year or leading zeros
    if (opts.loose !== false) pass((r) => looseNo(r.no) ? pk(r) + '|' + looseNo(r.no) : '', (b, bi, oi, ok) => { if (ok) pair(bi, oi, 'probable', 'number written differently: ' + b.no + ' / ' + other[oi].no); });
    // 3. the same party and the same amounts, close in date: the number is missing or mistyped on one side
    book.forEach((b, bi) => { if (usedB.has(bi) || !b.taxId) return; const c = other.map((o, oi) => oi).filter(oi => !usedO.has(oi) && other[oi].type === b.type && other[oi].taxId === b.taxId && same(b, other[oi]) && (!b.ms || !other[oi].ms || Math.abs(b.ms - other[oi].ms) <= 45 * DAY)); if (c.length === 1) pair(bi, c[0], 'probable', b.hasBillNo ? 'same amounts, number differs: ' + b.no + ' / ' + other[c[0]].no : 'same amounts; the bill number is not in the books (' + other[c[0]].no + ')'); });
    // 4. the same number under another tax number (a wrong or missing tax number in the books)
    pass((r) => normNo(r.no) && normNo(r.no).length >= 3 ? normNo(r.no) : '', (b, bi, oi, ok) => { if (ok) pair(bi, oi, 'probable', (b.taxId ? 'tax number differs: ' + b.taxId + ' / ' + (other[oi].taxId || 'none') : 'no tax number in the books (' + (other[oi].taxId || 'none') + ')')); });
    const inP = (ms) => ms >= p.from && ms <= p.to + DAY - 1;
    res.forEach(x => { if (x.b && !inP(x.b.bookMs)) x.why = (x.why ? x.why + '; ' : '') + 'in the books on ' + U.dmy(new Date(x.b.bookMs)) + ', outside this period'; });
    book.forEach((b, bi) => { if (!usedB.has(bi) && inP(b.bookMs)) res.push({ status: 'bookOnly', b, o: null, why: '' }); });
    other.forEach((o, oi) => { if (!usedO.has(oi)) res.push({ status: 'otherOnly', b: null, o, why: o.note || '' }); });
    return res;
  }

  // ------------------------------------------------------------ the figures of a period, as the country's return asks for them
  function figures(p) {
    const inR = (d) => Books.inRange(d, p.from, p.to), z = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, tax: 0 });
    const add = (o, taxable, x, sign) => { sign = sign || 1; const ig = num(x.igst), cg = num(x.cgst), sg = num(x.sgst), t = ig + cg + sg || num(x.gst); o.taxable = r2(o.taxable + sign * num(taxable)); o.igst = r2(o.igst + sign * (ig || (cg || sg ? 0 : t))); o.cgst = r2(o.cgst + sign * cg); o.sgst = r2(o.sgst + sign * sg); o.tax = r2(o.tax + sign * t); };
    const f = { out: z(), zero: 0, rcmOut: 0, rcmIn: z(), itc: z(), gross: 0, invoices: 0, byState: new Map() };
    const st = (name) => { if (!f.byState.has(name)) f.byState.set(name, { taxable: 0, tax: 0, gross: 0, n: 0 }); return f.byState.get(name); };
    Biz.invoices().filter(i => inR(i.date)).forEach(i => {
      const t = i.totals || {}, gross = num(t.rounded) || num(t.grand), s = st(U.stateName(i.buyer && i.buyer.state) || 'Not stated');
      f.invoices++; f.gross = r2(f.gross + gross); s.n++; s.gross = r2(s.gross + gross);
      if (i.rcm) { f.rcmOut = r2(f.rcmOut + num(t.taxable)); s.taxable = r2(s.taxable + num(t.taxable)); return; }
      const zero = (i.items || []).reduce((a, it) => a + (num(it.gst) === 0 || !Biz.chargesGst() ? num(it.taxable) : 0), 0);
      f.zero = r2(f.zero + zero); add(f.out, num(t.taxable) - zero, t);
      s.taxable = r2(s.taxable + num(t.taxable)); s.tax = r2(s.tax + num(t.cgst) + num(t.sgst) + num(t.igst));
    });
    Store.list('notes').filter(n => inR(n.date)).forEach(n => { if (n.kind === 'CN') { add(f.out, n.taxable, n, -1); f.gross = r2(f.gross - num(n.total)); } else add(f.itc, n.taxable, n, -1); });
    Store.list('purchases').filter(x => x.kind === 'PUR' && inR(x.date)).forEach(x => { add(f.itc, x.taxable, x); if (x.rcm) add(f.rcmIn, x.taxable, x); });
    Store.list('expenses').filter(x => inR(x.date)).forEach(x => { const tb = num(x.taxable) || num(x.amount); if (!taxOf(x)) return; add(f.itc, tb, x); if (x.rcm) add(f.rcmIn, tb, x); });
    f.payable = r2(f.out.tax + f.rcmIn.tax - f.itc.tax);
    return f;
  }
  // [key, label, the figure of the books]; a key the user types the filed figure against
  function returnLines(r, f) {
    if (r.code === 'IN') return [
      ['31a_tx', '3.1(a) Outward taxable supplies - taxable value', f.out.taxable], ['31a_i', '3.1(a) Integrated tax (IGST)', f.out.igst], ['31a_c', '3.1(a) Central tax (CGST)', f.out.cgst], ['31a_s', '3.1(a) State / UT tax (SGST)', f.out.sgst],
      ['31c_tx', '3.1(c) Nil rated and exempt supplies - value', f.zero],
      ['31d_tx', '3.1(d) Inward supplies under reverse charge - taxable value', f.rcmIn.taxable], ['31d_t', '3.1(d) Tax under reverse charge', f.rcmIn.tax],
      ['4a_i', '4(A) Input tax credit - IGST', f.itc.igst], ['4a_c', '4(A) Input tax credit - CGST', f.itc.cgst], ['4a_s', '4(A) Input tax credit - SGST', f.itc.sgst],
      ['net', 'Tax payable after credit (3.1 less 4)', f.payable]];
    if (r.code === 'AE') return [
      ['b1_a', 'Box 1 - Standard rated supplies, amount', f.out.taxable], ['b1_v', 'Box 1 - VAT on standard rated supplies', f.out.tax],
      ['b3_a', 'Box 3 - Supplies subject to reverse charge, amount', f.rcmIn.taxable], ['b3_v', 'Box 3 - VAT under reverse charge', f.rcmIn.tax],
      ['b4_a', 'Box 4 - Zero rated supplies', f.zero],
      ['b8_v', 'Box 8 - Total output VAT', r2(f.out.tax + f.rcmIn.tax)],
      ['b9_a', 'Box 9 - Standard rated expenses, amount', r2(f.itc.taxable - f.rcmIn.taxable)], ['b9_v', 'Box 9 - Recoverable VAT on expenses', r2(f.itc.tax - f.rcmIn.tax)],
      ['b10_v', 'Box 10 - Recoverable VAT under reverse charge', f.rcmIn.tax],
      ['b11_v', 'Box 11 - Total recoverable VAT', f.itc.tax], ['b14', 'Box 14 - VAT payable (or refundable when negative)', f.payable]];
    if (r.code === 'AU') return [
      ['g1', 'G1 - Total sales (including GST)', f.gross], ['g3', 'G3 - GST-free sales', f.zero],
      ['a1', '1A - GST on sales', r2(f.out.tax + f.rcmIn.tax)], ['g11', 'G11 - Non-capital purchases (including GST)', r2(f.itc.taxable + f.itc.tax)],
      ['b1', '1B - GST on purchases', f.itc.tax], ['net', 'Amount payable to the ATO (refund when negative)', f.payable]];
    return [
      ['gross', 'Gross sales (including sales tax)', f.gross], ['taxable', 'Taxable sales', f.out.taxable], ['exempt', 'Exempt and non-taxable sales', f.zero],
      ['collected', 'Sales tax collected', f.out.tax], ['use', 'Use tax on purchases the supplier charged no tax on', f.rcmIn.tax], ['remit', 'Sales and use tax to remit', r2(f.out.tax + f.rcmIn.tax)]];
  }

  // ------------------------------------------------------------ the checks, per country
  // Economic nexus for a seller with no presence in the state: sales into the state in a year (and, where given, a count of sales)
  const NEXUS = { CA: [500000], TX: [500000], NY: [500000, 100, 'and'], AL: [250000], MS: [250000], CT: [100000, 200, 'and'], AK: null, DE: null, MT: null, NH: null, OR: null };
  function checks(p) {
    const r = U.region(), c = Store.company(), out = [], inR = (d) => Books.inRange(d, p.from, p.to);
    const add = (level, title, detail, heads, rows) => out.push({ level, title, detail, heads: heads || [], rows: rows || [] });
    const purchases = Store.list('purchases').filter(x => x.kind === 'PUR'), pIn = purchases.filter(x => inR(x.date)), invs = Biz.invoices(), iIn = invs.filter(i => inR(i.date));
    const contacts = Store.list('contacts'), tid = r.taxId, tax = r.tax;
    // -- every country
    if (!String(c.gstin || '').trim()) add('warn', 'The company has no ' + tid, 'Company Profile has no ' + tid + '. If the business is registered, add it: it prints on every invoice and is the number the return is filed under.');
    else if (!validTaxId(c.gstin, r.code)) add('bad', 'The ' + tid + ' of the company does not validate', c.gstin + ' is not a valid ' + tid + ' (' + r.taxIdHint + ').');
    const badIds = contacts.filter(x => String(x.gstin || '').trim() && !validTaxId(x.gstin, r.code));
    if (badIds.length) add('bad', badIds.length + ' contact' + (badIds.length === 1 ? ' has' : 's have') + ' a ' + tid + ' that does not validate', 'A wrong ' + tid + ' on a supplier loses the input tax; on a customer it sends the sale to the wrong registration.', ['No', 'Name', 'Type', tid], badIds.map(x => [x.no || '', x.name, x.type || 'Customer', x.gstin]));
    const noId = pIn.filter(x => taxOf(x) > 0 && !x.rcm && !String(x.supplierGstin || '').trim());
    if (noId.length && r.code !== 'US') add('bad', noId.length + ' purchase' + (noId.length === 1 ? '' : 's') + ' with ' + tax + ' but no supplier ' + tid, 'Input tax of ' + money(noId.reduce((s, x) => s + taxOf(x), 0)) + ' is claimed on bills that do not carry the supplier\'s ' + tid + '. Without it the bill is not a valid tax invoice and the credit can be refused.', ['No', 'Date', 'Supplier', tax], noId.map(x => [x.no, x.date, x.supplier, money(taxOf(x))]));
    const seen = new Map(), dup = [];
    purchases.forEach(x => { const k = (normId(x.supplierGstin) || 'N:' + normName(x.supplier)) + '|' + normNo(x.billNo || ''); if (!normNo(x.billNo || '')) return; if (seen.has(k)) dup.push([seen.get(k), x]); else seen.set(k, x); });
    if (dup.length) add('bad', dup.length + ' supplier bill' + (dup.length === 1 ? ' is' : 's are') + ' in the books twice', 'The same supplier and bill number on two purchases claims the input tax twice.', ['Bill No', 'Supplier', 'First', 'Again'], dup.map(d => [d[1].billNo, d[1].supplier, d[0].no + ' (' + d[0].date + ')', d[1].no + ' (' + d[1].date + ')']));
    const noBill = pIn.filter(x => taxOf(x) > 0 && !String(x.billNo || '').trim());
    if (noBill.length) add('warn', noBill.length + ' purchase' + (noBill.length === 1 ? '' : 's') + ' without the supplier\'s bill number', 'The supplier\'s own invoice number (Supplier Bill No on the purchase) is what the supplier-side data is matched by. Without it a bill is paired by amount only.', ['No', 'Date', 'Supplier', 'Total'], noBill.map(x => [x.no, x.date, x.supplier, money(x.total)]));
    let pay = []; try { pay = Books.payables().open || []; } catch (e) { pay = []; }
    const old = pay.filter(x => x.days > 180), pBy = new Map(purchases.map(x => [x.no, x]));
    const oldTax = old.filter(x => pBy.has(x.no) && taxOf(pBy.get(x.no)) > 0);

    if (r.code === 'IN') {
      if (oldTax.length) add('bad', oldTax.length + ' purchase bill' + (oldTax.length === 1 ? '' : 's') + ' unpaid for more than 180 days', 'Section 16(2) and rule 37 of the CGST Rules: input tax credit taken on a bill not paid within 180 days of its date is added back to the output tax, with interest, and taken again when the bill is paid. ITC at stake: ' + money(oldTax.reduce((s, x) => s + taxOf(pBy.get(x.no)) * Math.min(1, x.balance / (num(pBy.get(x.no).total) || 1)), 0)) + '.', ['No', 'Supplier', 'Unpaid', 'Days'], oldTax.map(x => [x.no, x.party || pBy.get(x.no).supplier, money(x.balance), x.days]));
      // Section 16(4): credit on a bill of a financial year is claimed by 30 November after that year ends
      const fy = U.fyFirstYear() - 1, due = new Date(fy + 1, 10, 30), left = Math.ceil((due.getTime() - Date.now()) / DAY), prev = purchases.filter(x => Books.inRange(x.date, U.fyStartDate(fy).getTime(), U.fyEndDate(fy).getTime()) && taxOf(x) > 0);
      if (prev.length && left >= 0 && left <= 90) add('warn', 'Input tax credit of ' + U.fyLabel(fy) + ' closes on 30 November ' + (fy + 1) + ' (' + left + ' day' + (left === 1 ? '' : 's') + ' left)', 'Section 16(4): credit on the bills of ' + U.fyLabel(fy) + ' (' + prev.length + ' purchases, ' + money(prev.reduce((s, x) => s + taxOf(x), 0)) + ' of tax) not claimed in a GSTR-3B filed by that day is lost. Reconcile that year with GSTR-2B and claim what is left in the October return.');
      const pos = iIn.filter(i => { const g = String(i.buyer.gstin || '').trim(), s = U.stateCode(i.buyer.state); return g.length === 15 && s && g.slice(0, 2) !== s; });
      if (pos.length) add('warn', pos.length + ' invoice' + (pos.length === 1 ? '' : 's') + ' where the buyer\'s state is not the state of its GSTIN', 'The state decides IGST against CGST + SGST. A different place of supply can be right (bill to / ship to), otherwise the tax is charged under the wrong head.', ['Invoice', 'Date', 'Buyer', 'GSTIN', 'State'], pos.map(i => [i.no, i.date, first(i.buyer.name), i.buyer.gstin, i.buyer.state]));
      const noHsn = iIn.filter(i => (i.items || []).some(it => num(it.taxable) > 0 && String(it.hsn || '').replace(/\D/g, '').length < 4));
      if (noHsn.length) add('warn', noHsn.length + ' invoice' + (noHsn.length === 1 ? '' : 's') + ' with a line without an HSN / SAC code', 'Table 12 of GSTR-1 and the e-invoice need the HSN code (4 digits up to Rs 5 crore of turnover, 6 above).', ['Invoice', 'Date', 'Buyer'], noHsn.map(i => [i.no, i.date, first(i.buyer.name)]));
      if (global.EDocs && EDocs.applies()) { const pend = EDocs.pendingList(); if (pend.length) add('bad', pend.length + ' invoice' + (pend.length === 1 ? '' : 's') + ' waiting for an e-invoice or an e-way bill', 'Above the limit set under Settings > E-Invoice & E-Way Bill. A B2B invoice without its IRN is not a valid tax invoice for the buyer\'s credit; goods moved without an e-way bill can be detained.', ['Invoice', 'Date', 'Buyer', 'Value', 'Needs'], pend.map(i => { const q = EDocs.pending(i); return [i.no, i.date, first(i.buyer.name), money(EDocs.total(i)), [q.einv ? 'e-Invoice' : '', q.ewb ? 'E-Way Bill' : ''].filter(Boolean).join(' + ')]; })); }
      const rc = pIn.filter(x => x.rcm);
      if (rc.length) add('info', 'Reverse charge on ' + rc.length + ' purchase' + (rc.length === 1 ? '' : 's') + ': ' + money(rc.reduce((s, x) => s + taxOf(x), 0)), 'Tax under reverse charge is paid in cash through GSTR-3B (table 3.1(d)), not from the credit ledger, and is then claimed as credit in table 4(A)(3).');
    }
    if (r.code === 'AE') {
      const big = iIn.filter(i => (num(i.totals.rounded) || num(i.totals.grand)) > 10000 && !String(i.buyer.gstin || '').trim());
      if (big.length) add('warn', big.length + ' invoice' + (big.length === 1 ? '' : 's') + ' above AED 10,000 without the buyer\'s TRN', 'A simplified tax invoice is allowed only up to AED 10,000 or to a buyer who is not registered. To a registered buyer above that, the full tax invoice carries the buyer\'s TRN (Article 59 of the Executive Regulation).', ['Invoice', 'Date', 'Buyer', 'Total'], big.map(i => [i.no, i.date, first(i.buyer.name), money(num(i.totals.rounded) || num(i.totals.grand))]));
      const rate = iIn.filter(i => !i.rcm && (i.items || []).some(it => num(it.taxable) > 0 && ![0, 5].includes(num(it.gst))));
      if (rate.length) add('warn', rate.length + ' invoice' + (rate.length === 1 ? '' : 's') + ' with a VAT rate other than 5% or 0%', 'UAE VAT is 5% (standard) or 0% (zero-rated); exempt supplies carry no VAT.', ['Invoice', 'Date', 'Buyer'], rate.map(i => [i.no, i.date, first(i.buyer.name)]));
      if (oldTax.length) add('warn', oldTax.length + ' purchase bill' + (oldTax.length === 1 ? '' : 's') + ' unpaid for more than 6 months', 'Input VAT recovered on a bill that is not paid within 6 months after the agreed date of payment is reduced by that amount in the return of that period, and recovered again when it is paid.', ['No', 'Supplier', 'Unpaid', 'Days'], oldTax.map(x => [x.no, x.party || pBy.get(x.no).supplier, money(x.balance), x.days]));
      const due = new Date(p.to + 28 * DAY);
      add('info', 'VAT return for ' + p.label + ' is due by ' + U.dmy(due), 'The VAT 201 return and the payment reach the FTA (EmaraTax) by the 28th day after the tax period ends. Records are kept for at least 5 years.');
      const rc = pIn.filter(x => x.rcm); if (rc.length) add('info', 'Reverse charge on ' + rc.length + ' purchase' + (rc.length === 1 ? '' : 's') + ': ' + money(rc.reduce((s, x) => s + taxOf(x), 0)), 'Reported as output VAT in Box 3 and, as far as it is recoverable, as input VAT in Box 10 of the same return.');
    }
    if (r.code === 'AU') {
      const noAbn = pIn.filter(x => num(x.total) > 82.5 && taxOf(x) > 0 && !validAbn(x.supplierGstin));
      if (noAbn.length) add('bad', noAbn.length + ' purchase' + (noAbn.length === 1 ? '' : 's') + ' above $82.50 with GST but no valid supplier ABN', 'A GST credit on a purchase of more than $82.50 (GST included) needs a tax invoice, and a tax invoice carries the supplier\'s ABN.', ['No', 'Date', 'Supplier', 'Total', 'GST'], noAbn.map(x => [x.no, x.date, x.supplier, money(x.total), money(taxOf(x))]));
      const wh = pIn.filter(x => num(x.taxable) > 75 && !String(x.supplierGstin || '').trim());
      if (wh.length) add('warn', wh.length + ' purchase' + (wh.length === 1 ? '' : 's') + ' above $75 from a supplier with no ABN', 'A payment of more than $75 (GST excluded) to a supplier who quotes no ABN is subject to withholding at the top rate (47%), reported at W4 of the BAS, unless an exception applies.', ['No', 'Date', 'Supplier', 'Amount'], wh.map(x => [x.no, x.date, x.supplier, money(x.taxable)]));
      const big = iIn.filter(i => (num(i.totals.rounded) || num(i.totals.grand)) >= 1000 && !String(i.buyer.gstin || '').trim() && !first(i.buyer.name));
      if (big.length) add('warn', big.length + ' invoice' + (big.length === 1 ? '' : 's') + ' of $1,000 or more without the buyer\'s identity', 'A tax invoice for a sale of $1,000 or more shows the buyer\'s identity or ABN.', ['Invoice', 'Date', 'Total'], big.map(i => [i.no, i.date, money(num(i.totals.rounded) || num(i.totals.grand))]));
      const rate = iIn.filter(i => !i.rcm && (i.items || []).some(it => num(it.taxable) > 0 && ![0, 10].includes(num(it.gst))));
      if (rate.length) add('warn', rate.length + ' invoice' + (rate.length === 1 ? '' : 's') + ' with a GST rate other than 10% or 0%', 'Australian GST is 10%; GST-free and input-taxed sales carry none.', ['Invoice', 'Date', 'Buyer'], rate.map(i => [i.no, i.date, first(i.buyer.name)]));
      const end = new Date(p.to), quarterly = new Date(end.getFullYear(), end.getMonth() + 1, 28), monthly = new Date(end.getFullYear(), end.getMonth() + 1, 21);
      add('info', 'BAS for ' + p.label, 'A quarterly BAS is due on the 28th of the month after the quarter (' + U.dmy(quarterly) + '; the December quarter by 28 February), a monthly one on the 21st (' + U.dmy(monthly) + '). A GST credit is claimed within 4 years.');
    }
    if (r.code === 'US') {
      const home = U.stateCode(U.matchState(c.homeState, '')) || '', y = new Date().getFullYear(), by = new Map();
      invs.forEach(i => { const ms = U.dateMs(i.date), yr = ms ? new Date(ms).getFullYear() : 0; if (yr !== y && yr !== y - 1) return; const code = U.stateCode(i.buyer && i.buyer.state); if (!code) return; const k = code + '|' + yr; const e = by.get(k) || { code, yr, name: U.stateName(i.buyer.state), sales: 0, n: 0, tax: 0 }; e.sales = r2(e.sales + (num(i.totals.rounded) || num(i.totals.grand))); e.n++; e.tax = r2(e.tax + num(i.totals.igst) + num(i.totals.cgst) + num(i.totals.sgst)); by.set(k, e); });
      const rows = [];
      Array.from(by.values()).forEach(e => { if (e.code === home) return; const rule = NEXUS[e.code]; if (rule === null) return; const lim = (rule && rule[0]) || 100000, cnt = rule && rule[1], and = rule && rule[2] === 'and'; const over = and ? e.sales > lim && e.n > cnt : e.sales > lim || (cnt ? e.n >= cnt : false), near = !over && e.sales >= lim * 0.8; if (over || near) rows.push([e.name, e.yr, money(e.sales), e.n, money(lim) + (cnt ? (and ? ' and ' : ' or ') + cnt + ' sales' : ''), over ? (e.tax > 0 ? 'Over - tax collected ' + money(e.tax) : 'OVER - no tax collected') : 'Near (80%)']); });
      if (rows.length) add(rows.some(x => /OVER/.test(x[5])) ? 'bad' : 'warn', 'Economic nexus: ' + rows.length + ' state' + (rows.length === 1 ? '' : 's') + ' over or near the threshold', 'A seller with no presence in a state must register and collect its sales tax once sales into the state pass its threshold in the current or the previous calendar year (most states: $100,000; some also count 200 sales). The thresholds change: confirm each on the state\'s own site before acting.', ['State', 'Year', 'Sales', 'Invoices', 'Threshold', 'Status'], rows);
      const taxed = new Set(iIn.filter(i => num(i.totals.igst) + num(i.totals.cgst) + num(i.totals.sgst) > 0).map(i => U.stateCode(i.buyer.state)));
      const exempt = iIn.filter(i => taxed.has(U.stateCode(i.buyer.state)) && num(i.totals.igst) + num(i.totals.cgst) + num(i.totals.sgst) === 0 && !String(i.buyer.gstin || '').trim() && num(i.totals.taxable) > 0);
      if (exempt.length) add('warn', exempt.length + ' untaxed sale' + (exempt.length === 1 ? '' : 's') + ' in a state where tax is collected, with no certificate on file', 'A sale without sales tax in a state where the business collects it needs a resale or exemption certificate from the buyer (kept as the buyer\'s Tax ID here), or the tax falls on the seller in an audit.', ['Invoice', 'Date', 'Buyer', 'State', 'Amount'], exempt.map(i => [i.no, i.date, first(i.buyer.name), U.stateName(i.buyer.state), money(i.totals.taxable)]));
      const use = pIn.filter(x => taxOf(x) === 0 && !x.rcm && num(x.total) > 0);
      if (use.length) add('info', use.length + ' purchase' + (use.length === 1 ? '' : 's') + ' with no sales tax charged (' + money(use.reduce((s, x) => s + num(x.total), 0)) + ')', 'Where a supplier charged no sales tax on a taxable purchase (often an out-of-state or online seller), use tax is owed to the state. Tick "Use tax" on those purchases so it is counted in the return.');
    }
    if (!out.some(x => x.level === 'bad' || x.level === 'warn')) add('ok', 'Nothing found', 'The checks of ' + r.name + ' found nothing to correct in ' + p.label + '.');
    return out;
  }

  // ------------------------------------------------------------ the screen
  const STATUS = { matched: ['Matched', 'ok'], mismatch: ['Mismatch', 'bad'], probable: ['Probable', 'warn'], bookOnly: ['Only in the books', 'bad'], otherOnly: ['Only in the file', 'bad'], accepted: ['Accepted', 'ok'] };
  const Recon = {
    validAbn, validTrn, validTaxId, normNo, looseNo, match, fromGstJson, fromSheet, figures, returnLines, checks, purchaseRows, salesRows, periods,
    settings() { const d = global.Settings ? Settings.doc().recon : null; return Object.assign({}, DEFAULTS, d && typeof d === 'object' ? d : {}); },
    // What was uploaded and typed, kept in this browser: {key: {name, at, rows, accepted: [pair]}} and {periodKey: {line: figure}}
    data() { const d = Store.get('recon_data', {}); return d && typeof d === 'object' ? d : {}; },
    saveData(k, v) { const d = this.data(); if (v) d[k] = v; else delete d[k]; const keys = Object.keys(d).sort((a, b) => num(d[b].at) - num(d[a].at)); keys.slice(16).forEach(x => delete d[x]); Store.set('recon_data', d, true); },
    filed() { const d = Store.get('recon_filed', {}); return d && typeof d === 'object' ? d : {}; },
    tabs() {
      const r = U.region();
      return [
        { id: 'purchases', t: r.code === 'IN' ? 'Purchases vs GSTR-2B' : 'Purchases vs supplier data' },
        { id: 'sales', t: r.code === 'IN' ? 'Sales vs GSTR-1' : 'Sales vs reported' },
        { id: 'return', t: r.code === 'IN' ? 'Books vs GSTR-3B' : r.code === 'AE' ? 'Books vs VAT 201' : r.code === 'AU' ? 'Books vs BAS' : 'Books vs state returns' },
        { id: 'checks', t: 'Checks' }];
    },
    screen(params) {
      params = params || {};
      const r = U.region(), all = periods(), p = all.find(x => x.key === params.period) || all[1] || all[0], tabs = this.tabs(), tab = tabs.some(t => t.id === params.tab) ? params.tab : 'purchases';
      if (App.current && App.current.route === 'recon') App.current.params = { tab, period: p.key };
      const picker = '<select id="rcPeriod" style="min-height:36px">' + all.map(x => '<option value="' + esc(x.key) + '"' + (x.key === p.key ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('') + '</select>';
      const body = tab === 'return' ? this.returnTab(r, p) : tab === 'checks' ? this.checksTab(r, p) : this.matchTab(r, p, tab);
      const root = App.view(App.header('Tax Reconciliation', '<div class="btnrow" style="margin:0">' + picker + '<button class="btn sm outline" id="rcSet" title="Tolerance and matching rules">Settings</button></div>') +
        '<div class="hint" style="margin-bottom:10px">' + esc(r.name) + ' · ' + esc(r.tax) + (Store.company().gstin ? ' · ' + esc(r.taxId) + ' ' + esc(Store.company().gstin) : '') + ' · ' + esc(p.label) + '</div>' +
        '<div class="setnav" role="tablist">' + tabs.map(t => '<button type="button" role="tab" class="' + (t.id === tab ? 'sel' : '') + '" data-rc="' + t.id + '"><span>' + esc(t.t) + '</span></button>').join('') + '</div>' + body.html +
        '<div class="hint">A working paper from the entries in the books: it files nothing. Settle the differences, then file the return; check the result with your ' + esc(r.adviser) + '.</div>');
      App.wireBack(root);
      const again = (t) => App.go('recon', { tab: t || tab, period: p.key });
      $('#rcPeriod').onchange = (e) => App.go('recon', { tab, period: e.target.value });
      $('#rcSet').onclick = () => App.go('settings', { tab: 'recon' });
      $$('[data-rc]', root).forEach(b => b.onclick = () => again(b.dataset.rc));
      if (body.wire) body.wire(root, again);
    },

    // ---- Purchases / Sales against a file
    matchTab(r, p, tab) {
      const pur = tab === 'purchases', key = tab + ':' + p.key, d = this.data()[key], set = this.settings(), india = r.code === 'IN';
      const fileWord = pur ? (india ? 'GSTR-2B' : 'supplier data') : (india ? 'GSTR-1' : 'reported sales');
      const how = pur
        ? (india ? 'On the GST portal: Returns Dashboard > the period > <b>GSTR-2B</b> > Download > <b>Generate JSON file</b>. Upload that file here (a GSTR-2A JSON works too). An Excel or CSV sheet with the headings GSTIN, Invoice Number, Invoice Date, Taxable Value, Integrated / Central / State Tax is taken as well.'
          : r.code === 'AE' ? 'Upload a sheet (CSV or Excel) of the suppliers\' tax invoices of the period: a supplier statement, your accountant\'s input VAT listing or an export of another system, with the headings TRN, Invoice No, Invoice Date, Taxable Amount, VAT, Total. The FTA has no statement of purchases to download, so the supplier\'s own tax invoices are the evidence for the input VAT in Box 9.'
          : r.code === 'AU' ? 'Upload a sheet (CSV or Excel) of the suppliers\' tax invoices of the period: a supplier statement or an export of another system, with the headings ABN, Invoice No, Invoice Date, Amount excl GST, GST, Total. The GST credit at 1B rests on holding a valid tax invoice for each purchase.'
          : 'Upload a sheet (CSV or Excel) of the vendors\' invoices of the period: a vendor statement or an export of another system, with the headings Tax ID, Vendor, Invoice No, Invoice Date, Amount, Sales Tax, Total.')
        : (india ? 'On the GST portal: Returns Dashboard > the period > <b>GSTR-1</b> > Download > JSON of the return as filed (or the e-invoice list of the e-invoice portal as Excel). Sales to unregistered buyers are reported in total (B2CS), so the invoices compared here are the ones to registered buyers.'
          : 'Upload a sheet (CSV or Excel) of the sales reported for the period (an export of the filing software, the point of sale or the marketplace), with the headings ' + esc(r.taxId) + ', Customer, Invoice No, Invoice Date, Taxable Amount, ' + esc(r.tax) + ', Total.');
      let res = null, book = pur ? purchaseRows() : salesRows(), note = '';
      if (d && Array.isArray(d.rows)) {
        const other = d.rows.map(x => Object.assign({}, x));
        // GSTR-1 lists invoice by invoice only the sales to registered buyers (and large inter-state ones)
        if (!pur && india && other.some(o => o.taxId)) { const before = book.length; book = book.filter(b => b.taxId || other.some(o => !o.taxId && normNo(o.no) === normNo(b.no))); note = (before - book.length) ? (before - book.length) + ' sales to unregistered buyers are left out here: GSTR-1 reports them in total (compare the totals under Books vs GSTR-3B).' : ''; }
        res = match(book, other, p, set);
        const acc = new Set(d.accepted || []); res.forEach(x => { x.key = (x.b ? x.b.id : '') + '|' + (x.o ? x.o.taxId + '~' + normNo(x.o.no) : ''); if (acc.has(x.key) && x.status !== 'matched') { x.was = x.status; x.status = 'accepted'; } });
      }
      const count = (s) => res ? res.filter(x => x.status === s).length : 0, sum = (rows, side, k) => r2(rows.reduce((a, x) => a + (x[side] ? num(x[side][k]) * (x[side].type === 'C' ? -1 : 1) : 0), 0));
      const inP = book.filter(b => b.bookMs >= p.from && b.bookMs <= p.to + DAY - 1), sgn = (b) => b.type === 'C' ? -1 : 1;
      const bookTax = r2(inP.reduce((a, b) => a + sgn(b) * b.tax, 0)), otherTax = res ? r2(d.rows.reduce((a, o) => a + (o.type === 'C' ? -1 : 1) * num(o.tax), 0)) : 0;
      const tile = (k, v, cls) => '<div class="rctile"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + v + '</div></div>';
      const filter = this.filter || 'issues';
      const shown = res ? res.filter(x => filter === 'all' ? true : filter === 'issues' ? !['matched', 'accepted'].includes(x.status) : x.status === filter) : [];
      const cell = (x, k, isNum) => { const b = x.b ? (isNum ? money(x.b[k]) : esc(x.b[k])) : '<span class="muted">—</span>', o = x.o ? (isNum ? money(x.o[k]) : esc(x.o[k])) : '<span class="muted">—</span>'; const differ = x.b && x.o && (isNum ? Math.abs(num(x.b[k]) - num(x.o[k])) > num(set.tol) + 0.005 : false); return '<td class="' + (isNum ? 'num' : '') + (differ ? ' rcdiff' : '') + '">' + b + (x.b && x.o && (isNum ? differ : String(x.b[k]) !== String(x.o[k])) ? '<div class="small muted">' + o + '</div>' : !x.b ? '<div class="small">' + o + '</div>' : '') + '</td>'; };
      const table = res ? (shown.length ? '<div class="tablewrap"><table class="list" id="rcTable"><thead><tr><th>Status</th><th>' + esc(r.taxId) + '</th><th>Party</th><th>Number</th><th>Date</th><th class="num">Taxable</th><th class="num">' + esc(r.tax) + '</th><th>Note</th><th></th></tr></thead><tbody>' +
        shown.slice(0, 500).map((x, n) => { const s = STATUS[x.status], src = x.b || x.o; return '<tr><td><span class="pill ' + s[1] + '">' + s[0] + '</span>' + (x.b ? '<div class="small muted">' + esc(x.b.kind) + (x.b.ownNo && x.b.ownNo !== x.b.no ? ' ' + esc(x.b.ownNo) : '') + '</div>' : '') + '</td><td>' + esc(src.taxId || '-') + '</td><td>' + esc(U.titleCase(first(src.party)) || '-') + '</td>' + cell(x, 'no') + cell(x, 'date') + cell(x, 'taxable', true) + cell(x, 'tax', true) + '<td class="small" style="min-width:170px">' + esc(x.why) + '</td>' +
          '<td class="actions">' + (['mismatch', 'probable'].includes(x.status) ? '<button class="btn sm outline" data-acc="' + esc(x.key) + '">Accept</button>' : x.status === 'accepted' ? '<button class="btn sm outline" data-unacc="' + esc(x.key) + '">Undo</button>' : '') + (x.status === 'otherOnly' && pur && x.o.type === 'I' ? '<button class="btn sm green" data-addp="' + res.indexOf(x) + '">Add to books</button>' : '') + (x.b ? '<button class="btn sm" data-openb="' + esc(x.b.ownNo || '') + '">Open</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' + (shown.length > 500 ? '<div class="hint">The first 500 of ' + shown.length + ' rows are shown; the Excel file has them all.</div>' : '')
        : '<div class="empty">' + (filter === 'issues' ? 'No differences: every row is matched.' : 'No rows of this kind.') + '</div>') : '';
      const html = '<div class="card white"><div class="hd">' + esc(pur ? 'Purchases of the books against ' + fileWord : 'Sales of the books against ' + fileWord) + '</div><div class="bd">' +
        '<p class="hint" style="margin-top:0">' + how + '</p>' +
        '<div class="btnrow"><button class="btn green" id="rcUp">' + (d ? 'Upload another file' : 'Upload the file') + '</button>' + (d ? '<button class="btn outline" id="rcXls">Excel</button><button class="btn outline" id="rcPdf">PDF</button><button class="btn red outline" id="rcClear">Remove the file</button><span class="hint">' + esc(d.name) + ' · ' + d.rows.length + ' documents</span>' : '<button class="btn outline" id="rcTpl">Template (CSV)</button>') + '</div>' +
        (res ? '<div class="rctiles">' + tile('Matched', count('matched') + count('accepted'), 'green') + tile('Mismatch', count('mismatch'), count('mismatch') ? 'red' : '') + tile('Probable', count('probable')) + tile('Only in the books', count('bookOnly'), count('bookOnly') ? 'red' : '') + tile('Only in the file', count('otherOnly'), count('otherOnly') ? 'red' : '') +
          tile(esc(r.tax) + ' in the books', money(bookTax)) + tile(esc(r.tax) + ' in the file', money(otherTax)) + tile('Difference', money(r2(bookTax - otherTax)), Math.abs(bookTax - otherTax) > num(set.tol) ? 'red' : 'green') + '</div>' +
          (pur && count('bookOnly') ? '<div class="hint red">' + (india ? 'Input tax credit of ' + money(sum(res.filter(x => x.status === 'bookOnly'), 'b', 'tax')) + ' is in the books but not in GSTR-2B: it cannot be claimed until the supplier files its GSTR-1 (section 16(2)(aa)). Ask those suppliers to file, or defer the credit.' : 'Input tax of ' + money(sum(res.filter(x => x.status === 'bookOnly'), 'b', 'tax')) + ' is in the books without a matching supplier invoice in the file: make sure a valid tax invoice is held for each.') + '</div>' : '') +
          (pur && count('otherOnly') ? '<div class="hint">' + money(sum(res.filter(x => x.status === 'otherOnly'), 'o', 'tax')) + ' of tax is in the file but not in the books: bills not entered yet (Add to books), or not yours.</div>' : '') +
          (note ? '<div class="hint">' + esc(note) + '</div>' : '') +
          '<div class="btnrow"><select id="rcFilter" style="min-height:34px">' + [['issues', 'Differences only'], ['all', 'All rows'], ['matched', 'Matched'], ['mismatch', 'Mismatch'], ['probable', 'Probable'], ['bookOnly', 'Only in the books'], ['otherOnly', 'Only in the file'], ['accepted', 'Accepted']].map(o => '<option value="' + o[0] + '"' + (o[0] === filter ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select><span class="hint">Tolerance ' + money(set.tol) + ' · where the two sides differ, the file\'s value is the smaller line</span></div>' + table
        : '<div class="empty">' + inP.length + ' ' + (pur ? 'purchase bills and notes' : 'invoices and notes') + ' in the books for ' + esc(p.label) + ', with ' + esc(r.tax) + ' of ' + money(bookTax) + '. Upload the file to compare.</div>') + '</div></div>';
      return { html, wire: (root, again) => {
        $('#rcUp').onclick = () => this.upload((rows, name) => { this.saveData(key, { name, at: Date.now(), rows, accepted: [] }); UI.toast(rows.length + ' documents read from ' + name, 3000, 'ok'); again(); }, r.code === 'US');
        if ($('#rcTpl')) $('#rcTpl').onclick = () => UI.download('BlitzBook_reconciliation_template.csv', UI.csv([[r.taxId, pur ? 'Supplier' : 'Customer', 'Invoice No', 'Invoice Date', 'Taxable Amount', r.tax, 'Total', 'Type'], [r.code === 'IN' ? '29ABCDE1234F1Z5' : r.code === 'AE' ? '100123456700003' : r.code === 'AU' ? '51824753556' : '12-3456789', 'Sample Trading Co', 'INV-0042', U.today(), '1000.00', r.code === 'IN' ? '180.00' : r.code === 'AE' ? '50.00' : r.code === 'AU' ? '100.00' : '82.50', '', 'Invoice']]), 'text/csv');
        if (!d) return;
        $('#rcClear').onclick = () => UI.confirm('Remove the file', 'Remove ' + d.name + ' and what was accepted against it?', () => { this.saveData(key, null); again(); }, 'Remove');
        $('#rcFilter').onchange = (e) => { this.filter = e.target.value; again(); };
        const sheet = () => res.map(x => [STATUS[x.status][0], (x.b || x.o).taxId, first((x.b || x.o).party), x.b ? x.b.no : '', x.b ? x.b.date : '', x.b ? x.b.taxable : '', x.b ? x.b.tax : '', x.o ? x.o.no : '', x.o ? x.o.date : '', x.o ? x.o.taxable : '', x.o ? x.o.tax : '', x.b && x.o ? r2(x.b.tax - x.o.tax) : '', x.why]);
        const heads = ['Status', r.taxId, 'Party', 'No (books)', 'Date (books)', 'Taxable (books)', r.tax + ' (books)', 'No (file)', 'Date (file)', 'Taxable (file)', r.tax + ' (file)', 'Difference', 'Note'];
        $('#rcXls').onclick = () => UI.xls('Reconciliation_' + tab, heads, sheet());
        $('#rcPdf').onclick = () => UI.pdf('Reconciliation - ' + (pur ? 'Purchases' : 'Sales') + ' against ' + fileWord, p.label + ' · ' + d.name, ['Status', r.taxId, 'Party', 'No', 'Date', 'Taxable', r.tax, 'Note'], res.filter(x => !['matched', 'accepted'].includes(x.status)).map(x => { const s = x.b || x.o; return [STATUS[x.status][0], s.taxId, first(s.party), s.no, s.date, money(s.taxable), money(s.tax), x.why]; }));
        const accept = (k, on) => { const cur = this.data()[key]; if (!cur) return; const a = new Set(cur.accepted || []); if (on) a.add(k); else a.delete(k); cur.accepted = Array.from(a); this.saveData(key, cur); again(); };
        $$('[data-acc]', root).forEach(b => b.onclick = () => accept(b.dataset.acc, true));
        $$('[data-unacc]', root).forEach(b => b.onclick = () => accept(b.dataset.unacc, false));
        $$('[data-openb]', root).forEach(b => b.onclick = () => { if (b.dataset.openb) location.hash = '#open?no=' + encodeURIComponent(b.dataset.openb); });
        // A bill the supplier reported that is not in the books: a purchase is started from it, to be completed and saved
        $$('[data-addp]', root).forEach(b => b.onclick = () => { const o = res[+b.dataset.addp].o, rate = o.taxable ? Math.round(o.tax / o.taxable * 1000) / 10 : 0, sup = Store.list('contacts').find(c => normId(c.gstin) === o.taxId && o.taxId);
          Ledger.Purchases.edit({ kind: 'PUR', supplier: sup ? sup.name : U.titleCase(o.party), supplierGstin: o.taxId, billNo: o.no, billDate: o.date, date: o.date && U.dateMs(o.date) ? o.date : U.today(), paidBy: 'Credit', items: [{ name: 'As per ' + fileWord + ' ' + o.no, hsn: '', qty: 1, rate: o.taxable, gst: String(U.taxRates().map(Number).sort((a, c) => Math.abs(a - rate) - Math.abs(c - rate))[0]), uqc: 'NOS', stock: false }], notes: 'From ' + fileWord + ' (' + d.name + ')' }); });
      } };
    },
    upload(onRows, mdy) {
      const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,.csv,.xlsx,application/json,text/csv';
      i.onchange = async () => {
        const f = i.files[0]; if (!f) return;
        try {
          const buf = await f.arrayBuffer(), b = new Uint8Array(buf); let rows;
          if (b[0] === 0xD0 && b[1] === 0xCF) throw new Error('Old Excel (.xls) is not read. Save the file as .xlsx or .csv.');
          if (b[0] === 0x50 && b[1] === 0x4B) rows = fromSheet(await U.xlsxRows(buf), mdy);
          else { const text = new TextDecoder().decode(b).replace(/^﻿/, ''); rows = /^\s*[\[{]/.test(text) ? fromGstJson(JSON.parse(text)) : fromSheet(UI.parseCsv(text), mdy); }
          if (!rows.length) throw new Error('No invoices were found in ' + f.name + '. For GSTR-2B use the JSON file of the portal; a sheet needs a heading row.');
          onRows(rows, f.name);
        } catch (e) { UI.alert('Upload failed', e.message); }
      };
      i.click();
    },

    // ---- Books against the return filed
    returnTab(r, p) {
      const f = figures(p), L = returnLines(r, f), filed = this.filed()[p.key] || {}, set = this.settings(), us = r.code === 'US';
      const diff = (book, v) => v === '' || v == null ? '' : r2(num(v) - num(book));
      const rows = L.map(l => { const v = filed[l[0]], d = diff(l[2], v); return '<tr><td class="left">' + esc(l[1]) + '</td><td class="num">' + money(l[2]) + '</td><td class="num"><input class="num rcIn" data-k="' + l[0] + '" type="number" step="any" value="' + esc(v == null ? '' : v) + '" style="max-width:150px;text-align:right" placeholder="as filed"></td><td class="num rcDiff' + (d !== '' && Math.abs(d) > num(set.tol) ? ' rcdiff' : '') + '" data-d="' + l[0] + '">' + (d === '' ? '' : money(d)) + '</td></tr>'; }).join('');
      const states = Array.from(f.byState.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const stateRows = states.map(e => { const k = 'st_' + e[0], v = filed[k], d = diff(e[1].tax, v); return '<tr><td class="left">' + esc(e[0]) + '</td><td class="num">' + e[1].n + '</td><td class="num">' + money(e[1].taxable) + '</td><td class="num">' + money(e[1].tax) + '</td>' + (us ? '<td class="num"><input class="num rcIn" data-k="' + esc(k) + '" type="number" step="any" value="' + esc(v == null ? '' : v) + '" style="max-width:130px;text-align:right" placeholder="remitted"></td><td class="num rcDiff" data-d="' + esc(k) + '">' + (d === '' ? '' : money(d)) + '</td>' : '') + '</tr>'; }).join('');
      const what = r.code === 'IN' ? 'GSTR-3B as filed (or the liability and credit ledgers of the portal)' : r.code === 'AE' ? 'the VAT 201 return as filed on EmaraTax' : r.code === 'AU' ? 'the BAS as lodged with the ATO' : 'the returns filed with each state';
      return { html: '<div class="card white"><div class="hd">The books beside the return</div><div class="bd"><p class="hint" style="margin-top:0">The first column is worked out from the invoices, notes, purchases and expenses of ' + esc(p.label) + '. Type the figures of ' + what + ' in the second: the difference is what has to be explained (an entry made after filing, a bill of another period, a rounding) or corrected in the next return.</p>' +
          '<div class="tablewrap"><table class="list stmt" id="rcRet"><thead><tr><th>Line of the return</th><th class="num">Books</th><th class="num">As filed</th><th class="num">Difference</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          '<div class="btnrow"><button class="btn green" id="rcSave">Save the figures</button><button class="btn outline" id="rcRetXls">Excel</button><button class="btn outline" id="rcGst">' + esc(r.returns) + '</button></div></div></div>' +
          '<div class="card white"><div class="hd">Sales by ' + esc(r.stateWord.toLowerCase()) + '</div><div class="bd">' + (states.length ? '<div class="tablewrap"><table class="list stmt"><thead><tr><th>' + esc(r.stateWord) + '</th><th class="num">Invoices</th><th class="num">Taxable</th><th class="num">' + esc(r.tax) + '</th>' + (us ? '<th class="num">Remitted</th><th class="num">Difference</th>' : '') + '</tr></thead><tbody>' + stateRows + '</tbody></table></div>' : '<div class="empty">No sales in this period.</div>') +
          (us ? '<div class="hint">Sales tax is filed state by state: type what was remitted to each state to see what is still owed.</div>' : '') + '</div></div>',
        wire: (root, again) => {
          const read = () => { const o = {}; $$('.rcIn', root).forEach(el => { if (String(el.value).trim() !== '') o[el.dataset.k] = num(el.value); }); return o; };
          const books = new Map(L.map(l => [l[0], l[2]])); states.forEach(e => books.set('st_' + e[0], e[1].tax));
          $$('.rcIn', root).forEach(el => el.addEventListener('input', () => { const c = $$('.rcDiff', root).find(x => x.dataset.d === el.dataset.k); if (!c) return; const d = diff(books.get(el.dataset.k), String(el.value).trim() === '' ? '' : el.value); c.textContent = d === '' ? '' : money(d); c.classList.toggle('rcdiff', d !== '' && Math.abs(d) > num(set.tol)); }));
          $('#rcSave').onclick = () => { const all = this.filed(), v = read(); if (Object.keys(v).length) all[p.key] = v; else delete all[p.key]; Store.set('recon_filed', all, true); UI.toast('Figures of ' + p.label + ' saved', 2500, 'ok'); again(); };
          $('#rcRetXls').onclick = () => { const v = read(); UI.xls('Return_reconciliation', ['Line', 'Books', 'As filed', 'Difference'], L.map(l => [l[1], l[2], v[l[0]] == null ? '' : v[l[0]], v[l[0]] == null ? '' : r2(v[l[0]] - l[2])])); };
          $('#rcGst').onclick = () => App.go('gst');
        } };
    },

    // ---- The rules of the country
    checksTab(r, p) {
      const list = checks(p), cls = { bad: 'bad', warn: 'warn', info: '', ok: 'ok' }, word = { bad: 'To correct', warn: 'To look at', info: 'Note', ok: 'Clear' };
      return { html: '<div class="hint" style="margin:10px 0">The rules of ' + esc(r.name) + ' a reconciliation is meant to catch, checked on the books of ' + esc(p.label) + ' (contacts and unpaid bills: as they stand today).</div>' +
          list.map((c, n) => '<div class="card white"><div class="hd"><span class="pill ' + cls[c.level] + '">' + word[c.level] + '</span> ' + esc(c.title) + '</div><div class="bd"><p class="hint" style="margin-top:0">' + esc(c.detail) + '</p>' +
            (c.rows.length ? '<div class="tablewrap"><table class="list"><thead><tr>' + c.heads.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + c.rows.slice(0, 50).map(row => '<tr>' + row.map((v, i) => '<td>' + (i === 0 && /^[A-Z]{2,5}-?\d|^\d/.test(String(v)) && c.heads[0] !== 'State' && c.heads[0] !== 'Bill No' ? U.noLink(v) : esc(v)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' + (c.rows.length > 50 ? '<div class="hint">' + (c.rows.length - 50) + ' more in the Excel file.</div>' : '') +
              '<div class="btnrow"><button class="btn sm outline" data-cx="' + n + '">Excel</button></div>' : '') + '</div></div>').join(''),
        wire: (root) => { $$('[data-cx]', root).forEach(b => b.onclick = () => { const c = list[+b.dataset.cx]; UI.xls('Check', c.heads, c.rows); }); } };
    },

    // ---- Settings > Reconciliation
    tab() {
      const s = this.settings(), edit = Settings.mayEdit(), r = U.region(), dis = edit ? '' : ' disabled';
      const law = r.code === 'IN' ? 'India (GST): purchases against GSTR-2B / 2A, sales against GSTR-1, the books against GSTR-3B; credit only for bills in GSTR-2B (section 16(2)(aa)), the 180-day payment rule (rule 37), the 30 November limit (section 16(4)), e-invoice and e-way bill.'
        : r.code === 'AE' ? 'United Arab Emirates (VAT): input VAT against the suppliers\' tax invoices, the books against the boxes of VAT 201; TRN of 15 digits, full tax invoice above AED 10,000, the 6-month payment rule, the return by the 28th.'
        : r.code === 'AU' ? 'Australia (GST): GST credits against the suppliers\' tax invoices, the books against the BAS labels G1, G3, G11, 1A and 1B; ABN check, tax invoice above $82.50, no-ABN withholding, tax invoice of $1,000 or more.'
        : 'United States (sales tax): sales tax collected against what was remitted, state by state; economic nexus thresholds per state, untaxed sales without an exemption certificate, use tax on purchases.';
      return { html: '<div class="card white"><div class="hd">Reconciliation</div><div class="bd"><p class="hint" style="margin-top:0">How the books are compared with the data of the tax authority and of suppliers (Company &gt; Tax Reconciliation). The rules follow the country of the books: <b>' + esc(law) + '</b> The country is set in the Company Profile.</p>' +
          '<div class="grid3">' + UI.field('Tolerance (' + esc(r.currency) + ')', UI.input('rsTol', s.tol, { type: 'number', attrs: ' min="0" step="any"' + dis }), { hint: 'Amounts closer than this count as the same (rounding)' }) +
          UI.field('Date difference allowed (days)', UI.input('rsDays', s.days, { type: 'number', attrs: ' min="0" step="1"' + dis }), { hint: 'A bigger difference is noted, never a mismatch on its own' }) +
          '<div class="field"><label>Document numbers</label>' + UI.check('rsLoose', 'Also pair numbers written differently (INV/0042/25-26 with 42)', s.loose !== false).replace('<input', '<input' + dis) + '<div class="hint">Such pairs are shown as Probable, to be accepted by hand.</div></div></div>' +
          '<div class="btnrow">' + (edit ? '<button class="btn green" id="rsSave">Save</button>' : '') + '<button class="btn outline" id="rsOpen">Open Tax Reconciliation</button></div>' + (edit ? '' : '<div class="hint">Only the owner or an admin changes this.</div>') + '</div></div>',
        wire: (root, again) => {
          $('#rsOpen').onclick = () => App.go('recon');
          if (edit) $('#rsSave').onclick = () => { if (Settings.save({ recon: { tol: Math.max(0, num(UI.val('rsTol', root))), days: Math.max(0, Math.round(num(UI.val('rsDays', root)))), loose: !!UI.val('rsLoose', root) } }) === false) return; UI.toast('Reconciliation settings saved', 3000, 'ok'); again(); };
        } };
    }
  };

  App.routes.recon = (p) => Recon.screen(p || {});
  global.Recon = Recon;
})(window);
