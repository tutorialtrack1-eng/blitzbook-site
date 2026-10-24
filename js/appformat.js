/* BlitzBook web portal - the Android app's data layout. The app keeps its books in SQLite tables; the portal keeps
   nested documents. This file converts both ways, one record at a time, and is used for two things:
     - sync: every record travels as the app's row (keyed "inv:<no>", "item:<name>", "contact:<id>" ...)
     - backup files: Export writes the app's table layout, so the file restores in the app and in the portal.
   Column names are the ones in DatabaseHelper.java / Ledger.java. */
(function (global) {
  'use strict';
  const { num, round2 } = U;
  const s = (v) => v == null ? '' : String(v);
  const b01 = (v) => v ? 1 : 0;
  const lower = (v) => s(v).trim().toLowerCase();
  // SQLite NULLs are simply left out of a row
  const clean = (o) => { Object.keys(o).forEach(k => { if (o[k] == null) delete o[k]; }); return o; };
  const PUR_KIND = { PUR: 'Purchase', QTN: 'Quotation', STK: 'Stock' };
  const NOTE_KIND = { CN: 'Credit Note', DN: 'Debit Note' };

  function sellerCode() { const g = s(Store.company().gstin).trim(); return /^\d{2}/.test(g) ? g.slice(0, 2) : '37'; }
  function isInter(gstin) { const g = s(gstin).trim(); return /^\d{2}/.test(g) && g.slice(0, 2) !== sellerCode(); }
  function split(gst, inter) { return inter ? [0, 0, gst] : [gst / 2, gst / 2, 0]; }

  // ------------------------------------------------------------ portal document -> app row
  const row = {
    company(c) {
      return clean({ company_name: c.name, gstin: c.gstin, address: c.address, phone: c.phone, email: c.email, bank_name: c.bankName, account_no: c.bankAccountNo,
        ifsc_code: c.bankIfsc, branch_name: c.bankBranch, account_holder: c.bankHolder, gst_reg_type: c.gstType, invoice_format: c.invoiceFormat, line_of_activity: c.activity, signature: c.signature || '' });
    },
    item(i) {
      return clean({ item_name: s(i.name).trim(), hsn: s(i.hsn), gst_rate: s(i.gst == null || i.gst === '' ? '18' : i.gst), rate: i.rate === '' || i.rate == null ? null : num(i.rate),
        category: s(i.category), hidden: b01(i.hidden), item_code: s(i.code) });
    },
    account(a) { return { name: s(a.name).trim(), nature: s(a.nature) }; },
    contact(c) {
      return { name: s(c.name), address: s(c.address), phone: s(c.phone), gstin: s(c.gstin), state: s(c.state), email: s(c.email), type: c.type || 'Customer',
        tds_applicable: b01(c.tds), tds_section: c.tds ? s(c.tdsSection) : '', tds_rate: c.tds ? num(c.tdsRate) : 0 };
    },
    invoice(i) {
      const o = i.other || {}, t = i.totals || {}, b = i.buyer || {}, c = i.sameShip ? b : (i.consignee || {}), rcm = !!i.rcm;
      return { invoice_no: s(i.no).trim(), date: s(i.date), payment_mode: s(i.payment),
        buyer_name_addr: s(b.name), buyer_phone: s(b.phone), buyer_email: s(b.email), buyer_gstin: s(b.gstin), buyer_state: s(b.state),
        same_as_billing: b01(i.sameShip), consignee_name_addr: s(c.name), consignee_phone: s(c.phone), consignee_email: s(c.email), consignee_gstin: s(c.gstin), consignee_state: s(c.state),
        destination: s(o.destination), vehicle: s(o.vehicleType), vehicle_number: s(o.vehicleNo),
        others_checked: b01(o.transporter || o.deliveryNote || o.orderNo || o.orderDate || o.reference || o.info),
        transporter: s(o.transporter), delivery_challan: s(o.deliveryNote), order_no: s(o.orderNo), order_date: s(o.orderDate), ref_no: s(o.reference), additional_info: s(o.info),
        // Consignment details of a transporter's invoice (LR = lorry receipt / consignment note)
        lr_no: s(o.lrNo), lr_date: s(o.lrDate), origin: s(o.origin), goods_desc: s(o.goods),
        // Under reverse charge nothing is collected, so the app's sales register records no GST
        taxable_value: num(t.taxable), cgst: rcm ? 0 : num(t.cgst), sgst: rcm ? 0 : num(t.sgst), igst: rcm ? 0 : num(t.igst),
        grand_total: num(t.grand), rounded_total: num(t.rounded), amount_words: s(t.words), rcm: b01(rcm),
        // Payment due date and the terms & conditions printed on this invoice (blank when not included)
        due_date: s(i.dueDate), terms: i.termsOn ? s(i.terms) : '',
        items: (i.items || []).map((it, n) => ({ sl_no: n + 1, particulars: s(it.desc), hsn: s(it.hsn), gst_rate: s(it.gst), qty: num(it.qty), uqc: s(it.uqc) || 'NOS', rate: num(it.rate), amount: num(it.taxable),
          sub_serial_no: s(it.subSerial), sub_description: s(it.subDesc), sub_other_info: s(it.subInfo) })) };
    },
    // A delivery challan is an invoice-shaped document of its own: challan_no is its number, invoice_no the invoice
    // it was turned into (blank while it is open)
    challan(d) { const r = row.invoice(d); r.challan_no = r.invoice_no; r.invoice_no = s(d.invoiceNo); return r; },
    expense(e) {
      const gst = num(e.gst), sp = e.cgst == null ? split(gst, isInter(e.vendorGstin)) : [num(e.cgst), num(e.sgst), num(e.igst)];
      return { date: s(e.date), category: s(e.category), description: s(e.description), amount: num(e.amount), payment_mode: s(e.paidBy) || 'Cash',
        taxable: num(e.taxable), gst_rate: s(e.rate || '0'), gst, cgst: sp[0], sgst: sp[1], igst: sp[2], rcm: b01(e.rcm), vendor_gstin: s(e.vendorGstin) };
    },
    purchase(p) {
      return { doc_no: s(p.no), kind: PUR_KIND[p.kind] || 'Purchase', date: s(p.date), supplier: s(p.supplier), supplier_gstin: s(p.supplierGstin), payment_mode: s(p.paidBy) || 'Cash', notes: s(p.notes),
        taxable: num(p.taxable), gst: num(p.gst), total: num(p.total), rcm: b01(p.rcm), cgst: num(p.cgst), sgst: num(p.sgst), igst: num(p.igst), inclusive: b01(p.inclusive), tds_rate: num(p.tdsRate), tds: num(p.tds),
        items: (p.items || []).map(it => ({ item_name: s(it.name), hsn: s(it.hsn), qty: num(it.qty), uqc: s(it.uqc) || 'NOS', rate: num(it.rate), gst_rate: s(it.gst || '0'), amount: num(it.amount), is_stock: b01(it.stock) })) };
    },
    note(n) {
      return { kind: NOTE_KIND[n.kind] || 'Credit Note', note_no: s(n.no), date: s(n.date), party: s(n.party), party_gstin: s(n.partyGstin), ref_no: s(n.ref), reason: s(n.reason),
        taxable: num(n.taxable), gst_rate: s(n.rate || '0'), cgst: num(n.cgst), sgst: num(n.sgst), igst: num(n.igst), total: num(n.total), settlement: s(n.settle) || 'Credit' };
    },
    // Receipts and payments are journal vouchers with a few more columns; a plain entry carries none of them
    journal(j) {
      const kind = j.vtype === 'receipt' ? 'Receipt' : j.vtype === 'payment' ? 'Payment' : '';
      // alloc: the invoices a receipt is knocked off against, [{no, amount}] as JSON text (the app keeps it as a column)
      return clean({ date: s(j.date), narration: s(j.narration), kind: kind || null, doc_no: kind ? s(j.no) : null, party: kind ? s(j.party) : null, ref_no: kind ? s(j.ref) : null, mode: kind ? s(j.mode) : null, bank_ref: kind ? s(j.bankRef) : null,
        alloc: kind && Array.isArray(j.alloc) && j.alloc.length ? JSON.stringify(j.alloc.map(a => ({ no: s(a.no).trim(), amount: num(a.amount) }))) : null,
        lines: (j.lines || []).map(l => ({ account: s(l.account), side: l.side === 'Cr' ? 'Cr' : 'Dr', amount: num(l.amount) })) });
    },
    employee(e) { return JSON.parse(JSON.stringify(e)); },
    attendance(a) { return JSON.parse(JSON.stringify(a)); },
    clock(c) { return JSON.parse(JSON.stringify(c)); },
    timesheet(t) { return JSON.parse(JSON.stringify(t)); },
    reimbursement(r) { return JSON.parse(JSON.stringify(r)); },
    payroll(p) { return JSON.parse(JSON.stringify(p)); },
    sub(x) { return { registered_at: num(x.registered_at), valid_until: num(x.valid_until), used_codes: (x.used_codes || []).slice().sort(), inv_quota: num(x.inv_quota), inv_used: num(x.inv_used), inv_until: num(x.inv_until), yearly_until: num(x.yearly_until), full_until: num(x.full_until) }; }
  };

  // ------------------------------------------------------------ app row -> portal document (old = the record already here, if any)
  const doc = {
    company(r, old) {
      const act = s(r.line_of_activity);
      return Object.assign({}, old, { name: s(r.company_name), gstin: s(r.gstin), address: s(r.address), phone: s(r.phone), email: s(r.email),
        bankName: s(r.bank_name), bankAccountNo: s(r.account_no), bankIfsc: s(r.ifsc_code), bankBranch: s(r.branch_name), bankHolder: s(r.account_holder),
        gstType: s(r.gst_reg_type) || (s(r.gstin).trim() ? 'Regular' : 'Unregistered'), invoiceFormat: s(r.invoice_format).includes('#') ? s(r.invoice_format) : U.DEFAULT_INVOICE_FORMAT,
        activity: act && !act.startsWith('Select') ? act : 'General', signature: r.signature === undefined && old ? s(old.signature) : s(r.signature) });
    },
    item(r, old) {
      return Object.assign({}, old, { name: s(r.item_name), hsn: s(r.hsn), gst: s(r.gst_rate) || '18', rate: r.rate == null ? '' : num(r.rate), category: s(r.category), hidden: num(r.hidden) === 1, code: s(r.item_code) });
    },
    account(r, old) { return Object.assign({}, old, { name: s(r.name), nature: s(r.nature) }); },
    contact(r, old) {
      return Object.assign({}, old, { type: /^supp/i.test(s(r.type)) ? 'Supplier' : 'Customer', name: s(r.name), phone: s(r.phone), email: s(r.email), gstin: s(r.gstin), state: s(r.state), address: s(r.address),
        tds: num(r.tds_applicable) === 1, tdsSection: s(r.tds_section), tdsRate: num(r.tds_rate) });
    },
    invoice(r, old) {
      const party = (p) => ({ name: s(r[p + '_name_addr']), phone: s(r[p + '_phone']), email: s(r[p + '_email']), gstin: s(r[p + '_gstin']), state: s(r[p + '_state']) });
      const was = (old && old.items) || [];
      const items = (r.items || []).map((it, n) => {
        const amt = num(it.amount) || round2(num(it.qty) * num(it.rate)), g = num(it.gst_rate), o = was[n];
        // "Inc. GST" is how the row was typed here; keep it while the row itself is unchanged
        const same = o && s(o.desc) === s(it.particulars) && Math.abs(num(o.taxable) - amt) < 0.005;
        return { sl: n + 1, desc: s(it.particulars), hsn: s(it.hsn), gst: s(it.gst_rate) || '0', inc: same ? !!o.inc : false, qty: num(it.qty), uqc: s(it.uqc) || 'NOS', rate: num(it.rate),
          taxable: amt, totalIncl: round2(amt * (1 + g / 100)), subSerial: s(it.sub_serial_no), subDesc: s(it.sub_description), subInfo: s(it.sub_other_info) };
      });
      const rcm = num(r.rcm) === 1, intra = s(r.buyer_state).includes('(' + sellerCode() + ')');
      let cgst = num(r.cgst), sgst = num(r.sgst), igst = num(r.igst);
      if (rcm) { // stored as zero by the app; the invoice still shows what the buyer has to pay
        const gst = items.reduce((t, it) => t + it.taxable * num(it.gst) / 100, 0);
        [cgst, sgst, igst] = split(round2(gst), !intra).map(round2);
      }
      const grand = num(r.grand_total), rounded = num(r.rounded_total) || Math.round(grand);
      // A row from a device that does not know the due date or the terms (the app) leaves what was here
      const dueDate = r.due_date === undefined && old ? s(old.dueDate) : s(r.due_date);
      const terms = r.terms === undefined && old ? { terms: s(old.terms), termsOn: !!old.termsOn } : { terms: s(r.terms), termsOn: !!s(r.terms) };
      return Object.assign({}, old, { kind: 'invoice', no: s(r.invoice_no).trim(), date: s(r.date), payment: s(r.payment_mode) || 'Cash', rcm, dueDate, terms: terms.terms, termsOn: terms.termsOn,
        buyer: party('buyer'), sameShip: num(r.same_as_billing) === 1, consignee: party('consignee'),
        other: { destination: s(r.destination), vehicleType: s(r.vehicle), vehicleNo: s(r.vehicle_number), transporter: s(r.transporter), deliveryNote: s(r.delivery_challan),
          orderNo: s(r.order_no), orderDate: s(r.order_date), reference: s(r.ref_no), info: s(r.additional_info),
          // A row from an app that does not know the consignment columns yet leaves what was here
          lrNo: r.lr_no === undefined && old ? s((old.other || {}).lrNo) : s(r.lr_no), lrDate: r.lr_date === undefined && old ? s((old.other || {}).lrDate) : s(r.lr_date),
          origin: r.origin === undefined && old ? s((old.other || {}).origin) : s(r.origin), goods: r.goods_desc === undefined && old ? s((old.other || {}).goods) : s(r.goods_desc) },
        items, totals: { intra, taxable: num(r.taxable_value), cgst, sgst, igst, grand, rounded, words: s(r.amount_words) || U.toIndianWords(rounded) } });
    },
    challan(r, old) {
      const d = doc.invoice(Object.assign({}, r, { invoice_no: r.challan_no }), old);
      d.kind = 'challan'; d.invoiceNo = s(r.invoice_no).trim();
      return d;
    },
    expense(r, old) {
      const gst = num(r.gst), amount = num(r.amount);
      return Object.assign({ mode: 'taxable' }, old, { date: s(r.date), paidBy: s(r.payment_mode) || 'Cash', category: s(r.category), description: s(r.description),
        rate: s(r.gst_rate) || '0', taxable: num(r.taxable) || (gst ? 0 : amount), gst, cgst: num(r.cgst), sgst: num(r.sgst), igst: num(r.igst), amount, bill: amount, vendorGstin: s(r.vendor_gstin), rcm: num(r.rcm) === 1 });
    },
    purchase(r, old) {
      const kind = /quot/i.test(s(r.kind)) ? 'QTN' : /stock/i.test(s(r.kind)) ? 'STK' : 'PUR', total = num(r.total), tds = num(r.tds);
      return Object.assign({}, old, { kind, no: s(r.doc_no), date: s(r.date), supplier: s(r.supplier), supplierGstin: s(r.supplier_gstin), paidBy: s(r.payment_mode) || 'Cash', notes: s(r.notes),
        rcm: num(r.rcm) === 1, inclusive: num(r.inclusive) === 1, tdsRate: num(r.tds_rate), tdsSection: (old && old.tdsSection) || '',
        items: (r.items || []).map(it => ({ name: s(it.item_name), hsn: s(it.hsn), qty: num(it.qty), uqc: s(it.uqc) || 'NOS', rate: num(it.rate), gst: s(it.gst_rate) || '0', stock: num(it.is_stock) === 1,
          amount: num(it.amount), gstAmt: round2(num(it.amount) * num(it.gst_rate) / 100) })),
        taxable: num(r.taxable), gst: num(r.gst), cgst: num(r.cgst), sgst: num(r.sgst), igst: num(r.igst), total, tds, payable: round2(total - tds) });
    },
    note(r, old) {
      const cgst = num(r.cgst), sgst = num(r.sgst), igst = num(r.igst);
      return Object.assign({}, old, { kind: /debit/i.test(s(r.kind)) ? 'DN' : 'CN', no: s(r.note_no), date: s(r.date), party: s(r.party), partyGstin: s(r.party_gstin), ref: s(r.ref_no), reason: s(r.reason),
        taxable: num(r.taxable), rate: s(r.gst_rate) || '0', settle: s(r.settlement) || 'Credit', gst: round2(cgst + sgst + igst), cgst, sgst, igst, total: num(r.total) });
    },
    employee(r, old) { return Object.assign({}, old, JSON.parse(JSON.stringify(r))); },
    attendance(r, old) { return Object.assign({}, old, JSON.parse(JSON.stringify(r))); },
    clock(r, old) { return Object.assign({}, old, JSON.parse(JSON.stringify(r))); },
    timesheet(r, old) { return Object.assign({}, old, JSON.parse(JSON.stringify(r))); },
    reimbursement(r, old) { return Object.assign({}, old, JSON.parse(JSON.stringify(r))); },
    payroll(r, old) { return Object.assign({}, old, JSON.parse(JSON.stringify(r))); },
    journal(r, old) {
      const kind = /^rec/i.test(s(r.kind)) ? 'receipt' : /^pay/i.test(s(r.kind)) ? 'payment' : '';
      const j = Object.assign({}, old, { date: s(r.date), narration: s(r.narration), lines: (r.lines || []).map(l => ({ account: s(l.account), side: s(l.side) === 'Cr' ? 'Cr' : 'Dr', amount: num(l.amount) })) });
      ['vtype', 'no', 'party', 'ref', 'mode', 'bankRef', 'alloc'].forEach(k => delete j[k]);
      if (kind) {
        let alloc = []; try { const a = typeof r.alloc === 'string' ? JSON.parse(r.alloc) : r.alloc; if (Array.isArray(a)) alloc = a.map(x => ({ no: s(x.no).trim(), amount: num(x.amount) })).filter(x => x.no && x.amount > 0); } catch (e) { /* not ours */ }
        Object.assign(j, { vtype: kind, no: s(r.doc_no), party: s(r.party), ref: s(r.ref_no), mode: s(r.mode), bankRef: s(r.bank_ref) });
        if (alloc.length) j.alloc = alloc;
      }
      return j;
    }
  };

  // ------------------------------------------------------------ keyed records for sync
  // name = record kind, col = Store collection, key = what identifies the record on every device
  const KINDS = [
    { name: 'item', col: 'items', prefix: 'item:', key: (d) => lower(d.name) },
    { name: 'account', col: 'accounts', prefix: 'acct:', key: (d) => lower(d.name) },
    { name: 'invoice', col: 'invoices', prefix: 'inv:', key: (d) => d.kind === 'invoice' ? s(d.no).trim() : '' },
    { name: 'challan', col: 'challans', prefix: 'dc:', key: (d) => s(d.no).trim() },
    { name: 'contact', col: 'contacts', prefix: 'contact:', key: (d) => s(d.id), byId: true },
    { name: 'expense', col: 'expenses', prefix: 'exp:', key: (d) => s(d.id), byId: true },
    { name: 'purchase', col: 'purchases', prefix: 'pur:', key: (d) => s(d.id), byId: true },
    { name: 'note', col: 'notes', prefix: 'note:', key: (d) => s(d.id), byId: true },
    { name: 'journal', col: 'journal', prefix: 'jrn:', key: (d) => s(d.id), byId: true },
    // HR (hr.js): employees, one attendance record per employee and month, one payroll run per month; kept as they are
    { name: 'employee', col: 'employees', prefix: 'emp:', key: (d) => s(d.id), byId: true },
    { name: 'attendance', col: 'attendance', prefix: 'att:', key: (d) => s(d.id), byId: true },
    { name: 'clock', col: 'clock', prefix: 'clk:', key: (d) => s(d.id), byId: true },
    { name: 'timesheet', col: 'timesheets', prefix: 'ts:', key: (d) => s(d.id), byId: true },
    { name: 'reimbursement', col: 'reimbursements', prefix: 'rb:', key: (d) => s(d.id), byId: true },
    { name: 'payroll', col: 'payroll', prefix: 'pay:', key: (d) => s(d.id), byId: true }
  ];
  function subState() { return { registered_at: Store.get('registered_at', 0), valid_until: Store.get('valid_until', 0), used_codes: Store.get('used_codes', []), inv_quota: Store.get('inv_quota', 0), inv_used: Store.get('inv_used', 0), inv_until: Store.get('inv_until', 0), yearly_until: Store.get('yearly_until', 0), full_until: Store.get('full_until', 0) }; }

  // Every record of the signed-in user as {key: app row}
  function snapshot() {
    const out = {};
    const c = Store.get('company', null);
    if (c && s(c.name).trim()) out.company = row.company(Store.company());
    KINDS.forEach(k => Store.list(k.col).forEach(d => { const id = k.key(d); if (id) out[k.prefix + id] = row[k.name](d); }));
    const hr = Store.get('hr', null); if (hr && Object.keys(hr).length) out.hr = JSON.parse(JSON.stringify(hr)); // HR settings (hr.js)
    out.sub = row.sub(subState());
    return out;
  }

  // Applies records received from another device: [{k, d}] to store, [{k, x: 1}] to delete. synced(key) tells
  // whether a record here is already known to the server. Returns the keys that were applied.
  function apply(changes, synced) {
    const done = [], lists = {};
    const list = (col) => lists[col] || (lists[col] = Store.list(col));
    const company = changes.find(c => c.k === 'company'); // first: invoices read the seller's state from it
    if (company && !company.x) { Store.saveCompany(doc.company(company.d, Store.company())); done.push('company'); }
    changes.forEach(c => {
      if (c.k === 'company') return;
      if (c.k === 'hr') { if (!c.x) { Store.set('hr', c.d, true); done.push('hr'); } return; }
      if (c.k === 'sub') {
        if (c.x) return;
        // Trial start is the earliest seen, validity the latest, a code used anywhere is used everywhere, and the
        // invoice pack counters (bought, used) and the pack's date are the highest seen on any device
        const a = subState(), b = row.sub(c.d);
        const starts = [a.registered_at, b.registered_at].filter(v => v > 0);
        if (starts.length) Store.set('registered_at', Math.min.apply(null, starts));
        Store.set('valid_until', Math.max(a.valid_until, b.valid_until));
        // A yearly plan activated in the app shows up here as a validity stretched by a year or more
        Store.set('yearly_until', Math.max(a.yearly_until, b.yearly_until, b.valid_until - Math.max(a.valid_until, Date.now()) >= 360 * 24 * 3600 * 1000 ? b.valid_until : 0));
        Store.set('full_until', Math.max(num(a.full_until), num(b.full_until)));
        Store.set('used_codes', Array.from(new Set(a.used_codes.concat(b.used_codes))));
        Store.set('inv_quota', Math.max(num(a.inv_quota), num(b.inv_quota)));
        Store.set('inv_used', Math.max(num(a.inv_used), num(b.inv_used)));
        Store.set('inv_until', Math.max(num(a.inv_until), num(b.inv_until)));
        done.push('sub'); return;
      }
      const kind = KINDS.find(k => c.k.startsWith(k.prefix)); if (!kind) return;
      const id = c.k.slice(kind.prefix.length), l = list(kind.col);
      let at = l.findIndex(d => k_eq(kind, d, id));
      if (c.x) { if (at >= 0) { for (let n = l.length - 1; n >= 0; n--) if (k_eq(kind, l[n], id)) l.splice(n, 1); done.push(c.k); } return; }
      // The same party typed on two devices before they first met becomes one contact, not two
      if (at < 0 && kind.name === 'contact') at = l.findIndex(d => lower(d.name) === lower(c.d.name) && s(d.type || 'Customer') === (/^supp/i.test(s(c.d.type)) ? 'Supplier' : 'Customer') && !synced(kind.prefix + d.id));
      const fresh = doc[kind.name](c.d, at >= 0 ? l[at] : null);
      if (kind.byId) fresh.id = id; else if (!fresh.id) fresh.id = U.uid();
      if (!fresh.createdAt) fresh.createdAt = Date.now();
      if (at >= 0) l[at] = fresh; else l.push(fresh);
      done.push(c.k);
    });
    Object.keys(lists).forEach(col => Store.saveList(col, lists[col]));
    return done;
  }
  function k_eq(kind, d, id) { return kind.key(d) === id; }

  // ------------------------------------------------------------ backup files in the app's table layout
  const TABLES = ['company_master', 'items_master', 'contacts', 'history', 'invoices', 'invoice_items', 'challans', 'challan_items', 'expenses', 'purchases', 'purchase_items', 'journal', 'journal_vouchers', 'journal_lines', 'ledger_accounts', 'notes', 'employees', 'attendance', 'clock', 'timesheets', 'reimbursements', 'payroll'];

  function exportTables() {
    const t = { company_master: [], items_master: [], contacts: [], history: [], invoices: [], invoice_items: [], challans: [], challan_items: [], expenses: [], purchases: [], purchase_items: [], journal_vouchers: [], journal_lines: [], ledger_accounts: [], notes: [] };
    const co = Store.company(), c = row.company(co), sig = c.signature; delete c.signature;
    if (s(co.name).trim()) t.company_master.push(Object.assign({ id: 1 }, c));
    const add = (table, r, extra) => { const o = Object.assign({ id: t[table].length + 1 }, extra, r); t[table].push(o); return o.id; };
    const children = (parent, r, field, table, fk, extra) => { const kids = r[field]; delete r[field]; const id = add(parent, r, extra); kids.forEach(k => add(table, k, { [fk]: id })); };
    Store.list('items').forEach(d => { if (s(d.name).trim()) add('items_master', row.item(d)); });
    Store.list('contacts').forEach(d => add('contacts', row.contact(d), { sync_id: s(d.id) }));
    Store.list('invoices').forEach(d => { if (d.kind === 'invoice' && s(d.no).trim()) children('invoices', row.invoice(d), 'items', 'invoice_items', 'invoice_id'); });
    Store.list('challans').forEach(d => { if (s(d.no).trim()) children('challans', row.challan(d), 'items', 'challan_items', 'challan_id'); });
    Store.list('expenses').forEach(d => add('expenses', row.expense(d), { sync_id: s(d.id) }));
    Store.list('purchases').forEach(d => children('purchases', row.purchase(d), 'items', 'purchase_items', 'purchase_id', { sync_id: s(d.id) }));
    Store.list('journal').forEach(d => children('journal_vouchers', row.journal(d), 'lines', 'journal_lines', 'voucher_id', { sync_id: s(d.id) }));
    Store.list('accounts').forEach(d => { if (s(d.name).trim()) add('ledger_accounts', row.account(d)); });
    Store.list('notes').forEach(d => add('notes', row.note(d), { sync_id: s(d.id) }));
    // HR records (hr.js) go as they are; read by the portal only, the app skips tables and keys it does not know
    t.employees = Store.list('employees'); t.attendance = Store.list('attendance'); t.clock = Store.list('clock'); t.timesheets = Store.list('timesheets'); t.reimbursements = Store.list('reimbursements'); t.payroll = Store.list('payroll');
    t.blitzbook_web = { version: 2, exportedAt: new Date().toISOString(), signature: sig || '', pdfLayout: co.pdfLayout || 0, paper: co.paper || 'A4', hr: Store.get('hr', null) };
    return t;
  }

  function isTables(obj) { return !!obj && typeof obj === 'object' && TABLES.some(t => Array.isArray(obj[t])); }

  // Replaces everything in the portal with the contents of an app (or portal) backup. Returns record counts.
  function importTables(obj) {
    if (!isTables(obj)) throw new Error('That is not a BlitzBook backup file');
    const rows = (t) => Array.isArray(obj[t]) ? obj[t] : [];
    const web = obj.blitzbook_web || {};
    const co = rows('company_master');
    if (co.length) {
      const r = co.slice().sort((a, b) => num(b.id) - num(a.id))[0];
      const c = doc.company(Object.assign({}, r, web.signature === undefined ? {} : { signature: web.signature }), Store.company());
      if (web.pdfLayout != null) c.pdfLayout = web.pdfLayout;
      if (web.paper) c.paper = web.paper;
      Store.saveCompany(c);
    }
    const mk = (name, r, id) => Object.assign(doc[name](r, null), { id: id || U.uid(), createdAt: Date.now() });
    const group = (table, fk) => { const m = new Map(); rows(table).slice().sort((a, b) => num(a.sl_no) - num(b.sl_no) || num(a.id) - num(b.id)).forEach(r => { const k = s(r[fk]); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return m; };
    const put = (col, table, fn) => { if (Array.isArray(obj[table])) Store.saveList(col, rows(table).map(fn).filter(Boolean)); };
    put('items', 'items_master', r => s(r.item_name).trim() ? mk('item', r) : null);
    put('contacts', 'contacts', r => s(r.name).trim() ? mk('contact', r, s(r.sync_id)) : null);
    const invItems = group('invoice_items', 'invoice_id');
    put('invoices', 'invoices', r => s(r.invoice_no).trim() ? mk('invoice', Object.assign({}, r, { items: invItems.get(s(r.id)) || [] })) : null);
    const dcItems = group('challan_items', 'challan_id');
    put('challans', 'challans', r => s(r.challan_no).trim() ? mk('challan', Object.assign({}, r, { items: dcItems.get(s(r.id)) || [] })) : null);
    put('expenses', 'expenses', r => mk('expense', r, s(r.sync_id)));
    const purItems = group('purchase_items', 'purchase_id');
    put('purchases', 'purchases', r => mk('purchase', Object.assign({}, r, { items: purItems.get(s(r.id)) || [] }), s(r.sync_id)));
    put('accounts', 'ledger_accounts', r => s(r.name).trim() ? mk('account', r) : null);
    put('notes', 'notes', r => mk('note', r, s(r.sync_id)));
    ['employees', 'attendance', 'clock', 'timesheets', 'reimbursements', 'payroll'].forEach(col => { if (Array.isArray(obj[col])) Store.saveList(col, obj[col]); });
    if (web.hr) Store.set('hr', web.hr);
    if (Array.isArray(obj.journal_vouchers) || Array.isArray(obj.journal)) {
      const lines = group('journal_lines', 'voucher_id');
      const list = rows('journal_vouchers').map(r => mk('journal', Object.assign({}, r, { lines: lines.get(s(r.id)) || [] }), s(r.sync_id)));
      // Backups from before multi-line vouchers hold one debit and one credit account per row
      rows('journal').forEach(r => list.push(mk('journal', { date: r.date, narration: r.narration, lines: [{ account: r.debit_account, side: 'Dr', amount: r.amount }, { account: r.credit_account, side: 'Cr', amount: r.amount }] })));
      Store.saveList('journal', list);
    }
    return { invoices: Store.list('invoices').length, items: Store.list('items').filter(i => !i.hidden).length, contacts: Store.list('contacts').length, company: co.length > 0 };
  }

  global.AppFormat = { row, doc, KINDS, snapshot, apply, exportTables, importTables, isTables, sellerCode, isInter };
})(typeof window !== 'undefined' ? window : globalThis);
