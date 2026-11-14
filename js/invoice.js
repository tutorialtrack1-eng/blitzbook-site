/* BlitzBook web portal - New Invoice editor, quick item picker, print flow, Sales list, Credit / Debit notes. */
(function (global) {
  'use strict';
  const { esc, num, money, indianNumber } = U;

  function chargesGst() { return Store.company().gstType === 'Regular'; }
  function isComposition() { return Store.company().gstType === 'Composition'; }
  function sellerStateCode() { const g = (Store.company().gstin || '').trim(); return /^\d{2}/.test(g) ? g.slice(0, 2) : '37'; }
  function sellerStateName() { return U.stateName(U.stateByCode(sellerStateCode())) || 'your state'; }
  // A GSTIN whose first two digits differ from ours belongs to another state; blank counts as local
  function isInter(gstin) { const g = String(gstin || '').trim(); return /^\d{2}/.test(g) && g.slice(0, 2) !== sellerStateCode(); }
  function activity() { const a = Store.company().activity || ''; return a && !a.startsWith('Select') ? a : 'General'; }
  // A goods transport agency bills freight: its documents are consignment notes, with a consignor, a consignee,
  // the route and the vehicle, and GST on freight is usually paid by the recipient under reverse charge
  function isTransporter() { return activity().toLowerCase().includes('transport'); }
  // A restaurant, cafe or canteen (Food and Beverages): invoices carry the table number and the steward
  // A Food and Beverages company that trades or distributes (Company Profile) is not one: it bills like any goods business
  function isRestaurant() { return U.isRestaurantCo(Store.company()); }
  const stewards = () => global.HR && HR.employees ? HR.employees().map(e => e.name) : [];
  // Which extra fields an invoice needs: a restaurant the table and the steward, a service business its references,
  // a transporter the consignment, anyone moving goods the dispatch details
  function vertical() { const a = activity().toLowerCase(); return isRestaurant() ? 'restaurant' : isTransporter() ? 'transport' : /service|consult|software|profession|agency|clinic|hospital|education|school|coaching/.test(a) ? 'service' : 'goods'; }
  // Reverse charge on a sale only arises for notified services (transport, security, legal ...)
  function rcmAllowed() { return chargesGst() && (activity().toLowerCase().includes('service') || isTransporter()); }
  function contactsOf(type) { return Store.list('contacts').filter(c => !type || (c.type || 'Customer') === type).sort((a, b) => a.name.localeCompare(b.name)); }
  function partyFromContact(c) { return { name: c.name + (c.address ? '\n' + c.address : ''), phone: c.phone || '', email: c.email || '', gstin: c.gstin || '', state: U.matchState(c.state, c.gstin) || U.stateByCode(sellerStateCode()) }; }
  function blankParty() { return { name: '', phone: '', email: '', gstin: '', state: U.stateByCode(sellerStateCode()) || U.STATES[0] }; }
  // Quick item and item master prices are what the customer pays, GST included. Invoice rows carry the rate before
  // GST, so the GST is worked back out of the price (to 4 decimals, so qty x rate x (1 + GST) lands on the price again).
  function exclRate(price, gst) { const p = num(price), g = chargesGst() ? num(gst) : 0; return p > 0 && g > 0 ? Math.round(p / (1 + g / 100) * 10000) / 10000 : p; }
  function inclPrice(rate, gst) { const g = chargesGst() ? num(gst) : 0; return U.round2(num(rate) * (1 + g / 100)); }
  function priceLabel() { return chargesGst() ? 'Unit Price ₹ (inclusive of tax)' : 'Unit Price ₹'; }
  function blankItem(sl) { return { sl, desc: '', hsn: '', gst: '18', inc: false, qty: '', uqc: 'NOS', rate: '', taxable: 0, totalIncl: 0, subSerial: '', subDesc: '', subInfo: '' }; }
  // Saved invoices, newest first: by date, then by number
  function invoices() {
    return Store.list('invoices').filter(i => i.kind === 'invoice').sort((a, b) => U.dateMs(b.date) - U.dateMs(a.date) || String(b.no).localeCompare(String(a.no), undefined, { numeric: true }));
  }
  // Delivery challans, newest first. They have a number series of their own (DC-0001, DC-0002 ...), and an
  // invoiceNo once they have been turned into an invoice.
  function challans() {
    return Store.list('challans').sort((a, b) => U.dateMs(b.date) - U.dateMs(a.date) || String(b.no).localeCompare(String(a.no), undefined, { numeric: true }));
  }
  function nextChallanNo() {
    let max = 0; Store.all('challans').forEach(d => { const m = /(\d+)\s*$/.exec(String(d.no || '')); if (m) max = Math.max(max, +m[1]); });
    return 'DC-' + String(max + 1).padStart(4, '0');
  }
  function stepChallanNo(no, dir) {
    const m = /^(.*?)(\d+)\s*$/.exec(String(no || '')); if (!m) return nextChallanNo();
    return m[1] + String(Math.max(1, +m[2] + dir)).padStart(m[2].length, '0');
  }
  function nextInvoiceNo() {
    const fmt = Store.company().invoiceFormat || U.DEFAULT_INVOICE_FORMAT;
    let max = 0; Store.all('invoices').forEach(i => { if (i.kind === 'invoice') max = Math.max(max, U.parseInvoiceCounter(fmt, i.no)); });
    return U.formatInvoiceNo(fmt, max + 1);
  }
  function stepInvoiceNo(s, delta) {
    const fmt = Store.company().invoiceFormat || U.DEFAULT_INVOICE_FORMAT;
    const cur = U.parseInvoiceCounter(fmt, s);
    if (cur > 0) return U.formatInvoiceNo(fmt, Math.max(1, cur + delta));
    const m = /(\d+)\s*$/.exec(s); if (!m) return s;
    const n = Math.max(0, parseInt(m[1], 10) + delta); return s.slice(0, m.index) + String(n).padStart(m[1].length, '0');
  }
  // Credit notes against an invoice cannot return more than the invoice; debit notes likewise against a purchase.
  // Returns what is still open on the referenced document (before GST), or -1 when the reference is unknown.
  function noteCap(kind, ref, exceptId) {
    ref = String(ref || '').trim(); if (!ref) return -1;
    let base;
    if (kind === 'CN') { const inv = Store.list('invoices').find(i => i.kind === 'invoice' && i.no === ref); if (!inv) return -1; base = num(inv.totals.taxable); }
    else { const p = Store.list('purchases').find(x => x.kind === 'PUR' && x.no === ref); if (!p) return -1; base = num(p.taxable); }
    const used = Store.list('notes').filter(x => x.kind === kind && x.ref === ref && x.id !== exceptId).reduce((s, x) => s + num(x.taxable), 0);
    return U.round2(base - used);
  }
  function creditNotesFor(invoiceNo) { return Store.list('notes').filter(x => x.kind === 'CN' && x.ref === invoiceNo).map(x => x.no); }
  /* Why a note is issued: picked from a list, with remarks typed beside it. The two are kept as one text in the
     note's reason ("Price adjustment: rate agreed at 450"), which is what the app keeps too, so a note made on either
     side reads the same on the other. A reason typed before the list existed shows as Other with its words as the
     remarks. */
  const NOTE_REASONS = { CN: ['Price adjustment', 'Quantity issue', 'Goods returned', 'Damaged or defective goods', 'Discount allowed', 'Wrong billing', 'Deficiency in service', 'Order cancelled', 'Other'],
    DN: ['Price adjustment', 'Quantity issue', 'Goods returned to supplier', 'Damaged or defective goods', 'Discount received', 'Wrong billing', 'Deficiency in service', 'Order cancelled', 'Other'] };
  function splitReason(kind, reason) {
    const list = NOTE_REASONS[kind] || NOTE_REASONS.CN, r = String(reason || '').trim(); if (!r) return { cat: '', remarks: '' };
    const hit = list.find(c => c !== 'Other' && (r.toLowerCase() === c.toLowerCase() || r.toLowerCase().startsWith(c.toLowerCase() + ': ')));
    return hit ? { cat: hit, remarks: r.slice(hit.length + 1).trim() } : { cat: 'Other', remarks: /^other$/i.test(r) ? '' : r.replace(/^other:\s*/i, '') };
  }
  function joinReason(cat, remarks) { remarks = String(remarks || '').trim(); return !cat ? remarks : cat === 'Other' ? (remarks || 'Other') : cat + (remarks ? ': ' + remarks : ''); }
  // The credit notes issued against an invoice, with what they come to
  function creditNotesOf(invoiceNo) { return Store.list('notes').filter(x => x.kind === 'CN' && x.ref === invoiceNo); }
  // The GST rate most of an invoice's value is at (a credit note against it starts from this rate)
  function invoiceRate(inv) { const by = new Map(); (inv.items || []).forEach(it => { if (!it.desc && !num(it.rate)) return; const k = String(num(it.gst)); by.set(k, (by.get(k) || 0) + num(it.qty) * num(it.rate)); }); let best = '0', top = -1; by.forEach((v, k) => { if (v > top) { top = v; best = k; } }); return best; }
  /* Credit invoices and what is still due on each as at a date (today when none is given): the invoice total less
     the receipts recorded against that invoice number and the credit notes adjusted against it on account. A
     receipt that names no invoice (or not a credit one) is money on account of the customer and is reported as
     such, so it still shows in the party balance but does not clear a particular invoice. days = age of the
     invoice, bucket = 0: up to 30 days, 1: 31-60, 2: 61-90, 3: over 90. */
  function outstanding(asAt) {
    const at = asAt == null ? Date.now() : asAt, key = (s) => String(s || '').trim().toLowerCase();
    const amountOf = (v) => (v.lines || []).filter(l => l.side === 'Dr').reduce((s, l) => s + num(l.amount), 0);
    const receipts = Store.list('journal').filter(j => j.vtype === 'receipt' && Books.inRange(j.date, null, at));
    // A receipt knocked off against several invoices carries its allocations; an older one names one invoice
    const allocs = (v) => Array.isArray(v.alloc) && v.alloc.length ? v.alloc : (key(v.ref) ? [{ no: v.ref, amount: amountOf(v) }] : []);
    const byRef = new Map(); receipts.forEach(v => allocs(v).forEach(a => { const k = key(a.no); if (k) byRef.set(k, (byRef.get(k) || 0) + num(a.amount)); }));
    const credited = new Map(); Store.list('notes').forEach(n => { if (n.kind === 'CN' && n.settle === 'Credit' && Books.inRange(n.date, null, at)) { const k = key(n.ref); credited.set(k, (credited.get(k) || 0) + num(n.total)); } });
    const all = [];
    invoices().forEach(i => {
      if (i.payment !== 'Credit' || !Books.inRange(i.date, null, at)) return;
      const total = num(i.totals.rounded) || num(i.totals.grand), received = byRef.get(key(i.no)) || 0, cn = credited.get(key(i.no)) || 0;
      const days = Math.max(0, Math.floor((at - U.dateMs(i.date)) / 86400000));
      all.push({ id: i.id, no: i.no, date: i.date, party: Books.partyName(i.buyer.name) || '(cash sale)', total, received, credited: cn, balance: U.round2(total - received - cn), days, bucket: days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3 });
    });
    // What a receipt does not knock off against a credit invoice stays on account of the party
    const nos = new Set(all.map(r => key(r.no))), onAccount = new Map();
    receipts.forEach(v => {
      const used = allocs(v).filter(a => nos.has(key(a.no))).reduce((s, a) => s + num(a.amount), 0), rest = U.round2(amountOf(v) - used);
      if (rest <= 0.005) return;
      const k = key(v.party); if (k) onAccount.set(k, { party: v.party, amount: (onAccount.get(k) || { amount: 0 }).amount + rest });
    });
    return { all, open: all.filter(r => r.balance > 0.005), onAccount: Array.from(onAccount.values()) };
  }
  // What is still due on one credit invoice, null when it is not a credit invoice
  function invoiceBalance(no) { const r = outstanding().all.find(x => x.no === String(no || '').trim()); return r ? r : null; }
  // On an invoice pack a saved invoice or note is not deleted (it used one invoice of the pack): say so and stop.
  // It can be opened, changed and saved again, which uses no further invoice of the pack.
  function packLocked(what) { if (Sub.isTimeActive() || !Sub.invoiceQuota()) return false; UI.alert('Invoice pack', 'On an invoice pack a saved ' + what + ' cannot be deleted. Open it, choose Edit, change it and Save; or issue a credit or debit note to cancel it.'); return true; }
  // Whether one more invoice / note may be saved on the pack; opens the subscription dialog when the pack is used up
  function packAllows() { if (Sub.canAddInvoice()) return true; UI.toast('Your invoice pack is used up. Buy another pack or a plan to continue.', 6000); Subscription.dialog(false); return false; }
  // An invoice with credit notes against it stays until those are deleted
  function deleteInvoice(inv, then) {
    if (packLocked('invoice')) return;
    const cns = creditNotesFor(inv.no);
    if (cns.length) { UI.alert('Cannot Delete Invoice', 'Credit note' + (cns.length > 1 ? 's ' : ' ') + cns.join(', ') + ' ' + (cns.length > 1 ? 'were' : 'was') + ' issued against invoice ' + inv.no + '. Delete ' + (cns.length > 1 ? 'them' : 'it') + ' first.'); return; }
    UI.confirm('Delete Invoice', 'Delete invoice ' + inv.no + '? This cannot be undone.', () => {
      Store.delete('invoices', inv.id);
      // A challan that was turned into this invoice is open again
      Store.list('challans').forEach(dc => { if (dc.invoiceNo === inv.no) { dc.invoiceNo = ''; Store.update('challans', dc); } });
      UI.toast('Invoice ' + inv.no + ' deleted'); then();
    }, 'Delete');
  }
  function deleteChallan(dc, then) {
    if (dc.invoiceNo) { UI.alert('Cannot Delete Challan', 'Delivery challan ' + dc.no + ' was turned into invoice ' + dc.invoiceNo + '. Delete that invoice first if the challan has to go.'); return; }
    UI.confirm('Delete Delivery Challan', 'Delete delivery challan ' + dc.no + '? This cannot be undone.', () => { Store.delete('challans', dc.id); UI.toast('Delivery challan ' + dc.no + ' deleted'); then(); }, 'Delete');
  }
  // What a saved document leaves behind: its items join the item master (an item already there keeps its
  // customised price and category) and a new buyer becomes a customer contact
  function absorb(inv) {
    inv.items.forEach(it => { const name = String(it.desc).trim(); if (!name || it.staff || it.auto) return; if (findMaster(name)) upsertMaster(name, { hsn: String(it.hsn).trim(), gst: String(it.gst), hidden: false }); else upsertMaster(name, Object.assign({ hsn: String(it.hsn).trim(), gst: String(it.gst) }, num(it.rate) > 0 ? { rate: inclPrice(it.rate, it.gst) } : {})); });
    const bn = inv.buyer.name.trim();
    if (bn) { const first = bn.split('\n')[0].trim(); const contacts = Store.list('contacts'); if (!contacts.find(x => x.name.toLowerCase() === first.toLowerCase())) { contacts.push({ id: U.uid(), createdAt: Date.now(), type: 'Customer', name: first, address: bn.split('\n').slice(1).join('\n').trim().toUpperCase(), phone: inv.buyer.phone, email: inv.buyer.email.toLowerCase(), gstin: inv.buyer.gstin, state: inv.buyer.state, tds: false }); Store.saveList('contacts', contacts); } }
  }
  function newInvoice() {
    const c = Store.company();
    return { id: null, kind: 'invoice', no: nextInvoiceNo(), date: U.today(), payment: 'Cash', rcm: false, buyer: blankParty(), sameShip: true, consignee: blankParty(),
      other: { destination: '', vehicleType: '', vehicleNo: '', transporter: '', deliveryNote: '', orderNo: '', orderDate: '', reference: '', info: '', lrNo: '', lrDate: '', origin: '', goods: '' }, items: [blankItem(1)], totals: {},
      // Payment due date (set for Credit invoices from the company's credit period) and whether the company's
      // terms & conditions print on this invoice
      dueDate: '', termsOn: c.termsOn !== false && !!c.terms, terms: c.terms || '' };
  }
  // A manpower and staffing agency starts every invoice on the staff sheet
  function newSalesInvoice() { const inv = newInvoice(); if (isStaffing()) { inv.staff = staffHeader(); inv.items = [blankStaff(1, inv.staff)]; } return inv; }
  // dd/mm/yyyy a number of days after a dd/mm/yyyy date
  function plusDays(date, days) { const ms = U.dateMs(date); if (!ms) return ''; const d = new Date(ms + Math.round(num(days)) * 86400000); return U.pad(d.getDate()) + '/' + U.pad(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function dueDateFor(inv) { return inv.payment === 'Credit' ? plusDays(inv.date, Store.company().creditDays) : ''; }
  // Row maths, as in ItemRow.updateAmounts()
  function newChallan() { return Object.assign(newInvoice(), { kind: 'challan', no: nextChallanNo(), payment: 'Credit', invoiceNo: '' }); }
  // The invoice for a delivery challan: the same parties and goods, the challan number under Delivery Note
  function invoiceFromChallan(dc) {
    const copy = (v) => JSON.parse(JSON.stringify(v));
    return Object.assign(newInvoice(), { payment: 'Credit', buyer: copy(dc.buyer), sameShip: dc.sameShip, consignee: copy(dc.consignee), items: copy(dc.items).map((it, n) => Object.assign(it, { sl: n + 1 })),
      other: Object.assign({}, dc.other, { deliveryNote: dc.no }), fromChallan: dc.id });
  }
  // A copy of a saved invoice as a new one: the same buyer, consignee, goods, payment mode and terms under the next
  // number and today's date. What belongs to the original consignment (delivery note, order, e-way bill / reference,
  // vehicle and LR) is left blank; the due date follows the new date.
  function duplicateInvoice(src) {
    const copy = JSON.parse(JSON.stringify(src));
    ['id', 'createdAt', 'updatedAt', 'fromChallan', 'totals'].forEach(k => delete copy[k]);
    const inv = Object.assign(newInvoice(), copy, { id: null, no: nextInvoiceNo(), date: U.today(), duplicateOf: src.no,
      other: Object.assign({}, copy.other, { deliveryNote: '', orderNo: '', orderDate: '', reference: '', vehicleNo: '', lrNo: '', lrDate: '' }) });
    inv.items = (inv.items.length ? inv.items : [blankItem(1)]).map((it, n) => Object.assign(it, { sl: n + 1 }));
    // A staff sheet copied for the next bill: the same people, rates and charges, the period of the new date, no advances
    if (inv.staff) { Object.assign(inv.staff, staffPeriod(inv.date)); inv.items.forEach(it => { if (it.staff) it.staff.advance = ''; }); }
    inv.dueDate = dueDateFor(inv);
    return inv;
  }
  function computeItem(it) {
    const q = num(it.qty), g = chargesGst() ? num(it.gst) : 0;
    // A person on a staff sheet: days or hours worked x rate, plus the overtime hours at their rate
    if (it.staff) { it.inc = false; it.taxable = U.round2(q * num(it.rate) + num(it.staff.ot) * num(it.staff.otRate)); it.totalIncl = U.round2(it.taxable * (1 + g / 100)); return; }
    if (!it.inc) { const r = num(it.rate); it.taxable = U.round2(q * r); it.totalIncl = U.round2(q * r * (1 + g / 100)); }
    else { const tot = num(it.totalIncl); it.taxable = U.round2(tot / (1 + g / 100)); it.rate = q > 0 ? U.round2(it.taxable / q) : 0; }
  }
  function isIntra(inv) { return String(inv.buyer.state || '').includes('(' + sellerStateCode() + ')'); }
  function computeTotals(inv) {
    staffSync(inv);
    const intra = isIntra(inv); let taxable = 0, c = 0, s = 0, i = 0;
    inv.items.forEach(it => { computeItem(it); const tx = it.taxable, g = chargesGst() ? num(it.gst) : 0; taxable += tx; if (intra) { c += tx * (g / 2) / 100; s += tx * (g / 2) / 100; } else i += tx * g / 100; });
    const rcm = inv.rcm && rcmAllowed();
    const grand = rcm ? taxable : taxable + c + s + i, rounded = Math.round(grand);
    inv.totals = { intra, taxable: U.round2(taxable), cgst: U.round2(c), sgst: U.round2(s), igst: U.round2(i), grand: U.round2(grand), rounded, words: U.toIndianWords(rounded) };
    return inv.totals;
  }

  // ------------------------------------------------------------ manpower and staffing invoices
  // A Services company of the type Manpower and Staffing Services (Company Profile) bills staff-wise. inv.staff is the
  // sheet: the billing period, the work site, the SAC and GST rate of every line and the charges on top of the wages.
  // Every person is an invoice line (desc = the name, qty = the days / hours / months worked, uqc = DAY / HRS / MON,
  // rate) with it.staff = { empId, designation, ot, otRate, advance }, so the books, the reports and the GST returns
  // read it like any invoice. The employer's PF and ESI and the service charge are lines worked out here (it.auto).
  // GST is on the full value; the advances come off the invoice total afterwards (U.staffAdvance).
  const STAFF_BASIS = [['DAY', 'Days'], ['HRS', 'Hours'], ['MON', 'Months']];
  const STAFF_SAC = [['998519', 'Other employment and labour supply services'], ['998513', 'Contract staffing services'], ['998514', 'Temporary staffing services'], ['998515', 'Long-term staffing (payroll) services'], ['998516', 'Temporary staffing to permanent placement'], ['998512', 'Permanent placement services'], ['998525', 'Guard / security services'], ['998533', 'General cleaning / housekeeping services']];
  function isStaffing() { return U.isStaffingCo(Store.company()); }
  // The month a bill raised on this date is usually for: the month just ended up to the 10th, else the month running
  function staffPeriod(date) { const d = new Date(U.dateMs(date) || Date.now()), m = new Date(d.getFullYear(), d.getMonth() - (d.getDate() <= 10 ? 1 : 0), 1); return { from: U.dmy(m), to: U.dmy(new Date(m.getFullYear(), m.getMonth() + 1, 0)) }; }
  // A new sheet takes the SAC, the GST rate and the charges of the last staff invoice
  function staffHeader() {
    const last = invoices().find(i => i.staff), h = (last && last.staff) || {};
    return Object.assign({ site: '', sac: h.sac || '998519', gst: h.gst == null || h.gst === '' ? '18' : String(h.gst), pfPct: h.pfPct || '', esiPct: h.esiPct || '', chargePct: h.chargePct || '', chargeOn: h.chargeOn === 'all' ? 'all' : 'wages' }, staffPeriod(U.today()));
  }
  function staffFields(s) { return Object.assign({ empId: '', designation: '', ot: '', otRate: '', advance: '' }, s); }
  function blankStaff(sl, h) { return Object.assign(blankItem(sl), { hsn: h.sac, gst: h.gst, uqc: 'DAY', staff: staffFields() }); }
  const staffRows = (inv) => inv.items.filter(it => !it.auto);
  // Brings the lines of a staff invoice in step with its sheet: every person carries the sheet's SAC and GST rate, and
  // the employer PF, employer ESI and service charge lines follow the wages
  function staffSync(inv) {
    if (!inv.staff || inv.kind === 'challan') return;
    const h = inv.staff, base = staffRows(inv);
    base.forEach(it => { it.staff = staffFields(it.staff); if (!STAFF_BASIS.some(b => b[0] === it.uqc)) it.uqc = 'DAY'; it.hsn = h.sac; it.gst = h.gst; computeItem(it); });
    const wages = base.reduce((t, it) => t + it.taxable, 0), pf = U.round2(wages * num(h.pfPct) / 100), esi = U.round2(wages * num(h.esiPct) / 100);
    const all = h.chargeOn === 'all', charge = U.round2((all ? wages + pf + esi : wages) * num(h.chargePct) / 100);
    const line = (auto, desc, amt) => amt > 0 ? Object.assign(blankItem(0), { auto, desc, hsn: h.sac, gst: h.gst, qty: 1, uqc: 'OTH', rate: amt }) : null;
    inv.items = base.concat([line('pf', 'Employer PF contribution @ ' + num(h.pfPct) + '% of wages', pf), line('esi', 'Employer ESI contribution @ ' + num(h.esiPct) + '% of wages', esi),
      line('charge', 'Service charge @ ' + num(h.chargePct) + '% of wages' + (all && pf + esi > 0 ? ' and employer PF / ESI' : ''), charge)].filter(Boolean));
    inv.items.forEach((x, n) => { x.sl = n + 1; });
  }
  // The people billed before and the employees under HR, by name: what a name typed on the sheet fills in (the
  // employee ID and designation, and from the last bill the unit and the rates). The salary under HR is never the rate.
  const roster = () => global.Manpower ? Manpower.billing() : [];
  function staffKnown() {
    const m = new Map();
    invoices().forEach(i => { if (i.staff) i.items.forEach(it => { const k = String(it.desc || '').trim().toLowerCase(); if (it.staff && k && !m.has(k)) m.set(k, { name: String(it.desc).trim(), empId: it.staff.empId || '', designation: it.staff.designation || '', uqc: it.uqc, rate: it.rate, otRate: it.staff.otRate || '' }); }); });
    // The Manpower roster (manpower.js) is where the code, the trade and the bill rate are kept up: they win over the last bill
    roster().forEach(r => { const k = r.name.toLowerCase(), x = m.get(k) || { name: r.name, empId: '', designation: '' }; if (r.empId) x.empId = r.empId; if (r.designation) x.designation = r.designation; if (num(r.rate) > 0) { x.rate = r.rate; x.uqc = r.uqc; x.otRate = r.otRate; } m.set(k, x); });
    (global.HR && HR.employees ? HR.employees() : []).forEach(e => { const k = String(e.name || '').trim().toLowerCase(); if (!k) return; const x = m.get(k); if (!x) m.set(k, { name: String(e.name).trim(), empId: e.code || '', designation: e.designation || '' }); else { if (!x.empId) x.empId = e.code || ''; if (!x.designation) x.designation = e.designation || ''; } });
    return m;
  }

  // ------------------------------------------------------------ item master helpers (shared with the Item Master screen)
  // Names are matched without regard to case: "Tea" and "tea" are the same item on every device
  function findMaster(name) { const k = String(name || '').trim().toLowerCase(); return k ? Store.list('items').find(x => String(x.name).trim().toLowerCase() === k) || null : null; }
  // Inserts or updates one item by name without dropping its other details
  function upsertMaster(name, fields) {
    const list = Store.list('items'), k = name.trim().toLowerCase();
    const at = list.findIndex(x => String(x.name).trim().toLowerCase() === k);
    if (at >= 0) Object.assign(list[at], fields, { updatedAt: Date.now() });
    else list.push(Object.assign({ id: U.uid(), createdAt: Date.now(), name: name.trim(), code: '', category: '', hsn: '', gst: '18', rate: '', hidden: false }, fields));
    Store.saveList('items', list);
  }
  function hideMaster(name) { upsertMaster(name, { hidden: true }); }
  function categories() { return Array.from(new Set(Store.items().map(i => i.category).filter(Boolean))).sort(); }
  // Suggestions for an item name box: every item, "Name - CODE" for items with a code, and the well-known HSN names
  function itemLabels() {
    const out = new Set();
    Store.items().slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(i => { out.add(i.name); if (i.code) out.add(i.name + ' - ' + i.code); });
    Object.keys(U.HSN_MAP).forEach(n => out.add(n));
    return Array.from(out);
  }
  // The master item a typed name or "Name - CODE" suggestion stands for
  function itemFromLabel(text) {
    const t = String(text || '').trim().toLowerCase(); if (!t) return null;
    return Store.items().find(x => x.name.toLowerCase() === t || (x.code && (x.name + ' - ' + x.code).toLowerCase() === t)) || null;
  }

  // ------------------------------------------------------------ quick items (POS style picker)
  // Starter items per line of activity. A saved item with the same name replaces the sample; removing a sample
  // leaves a hidden item behind so it does not come back.
  const SAMPLES = {
    food: [['Tea / Chai', '2101', 'Beverages', '5', 20], ['Coffee', '2101', 'Beverages', '5', 30], ['Masala Chai', '2101', 'Beverages', '5', 25], ['Mineral Water 1L', '2201', 'Beverages', '18', 20], ['Soft Drink 300ml', '2202', 'Beverages', '40', 40],
      ['Veg Sandwich', '2106', 'Snacks', '5', 60], ['Cheese Burger', '2106', 'Snacks', '5', 100], ['Veg Pizza', '2106', 'Snacks', '5', 200], ['French Fries', '2106', 'Snacks', '5', 80], ['Masala Dosa', '2106', 'Snacks', '5', 90],
      ['Special Veg Thali', '2106', 'Meals', '5', 150], ['Special Non-Veg Thali', '2106', 'Meals', '5', 220], ['Red Sauce Pasta', '2106', 'Meals', '5', 120], ['Ice Cream Scoop', '2105', 'Desserts', '18', 50], ['Gulab Jamun (2 pcs)', '2106', 'Desserts', '5', 60]],
    retail: [['Cotton Shirt', '6205', 'Apparel', '5', 850], ['Denim Jeans', '6203', 'Apparel', '12', 1200], ['Leather Wallet', '4202', 'Accessories', '18', 450], ['Stainless Steel Bottle', '7323', 'Accessories', '18', 350], ['A4 Notebook', '4820', 'Stationery', '12', 80], ['Ball Pen Pack', '9608', 'Stationery', '18', 50]],
    service: [['Consulting Service', '9983', 'Professional', '18', 1500], ['Maintenance & Repair', '9987', 'Maintenance', '18', 800], ['Design & Branding', '9983', 'Professional', '18', 2500], ['Delivery & Logistics', '9968', 'Logistics', '18', 200], ['Installation Fee', '9987', 'Maintenance', '18', 500]],
    trade: [['Raw Material Pack', '9999', 'Materials', '18', 5000], ['Finished Goods Unit', '9999', 'Products', '18', 2500], ['Bulk Packaging Box', '4819', 'Packaging', '12', 150], ['Freight Charges', '9965', 'Logistics', '18', 1200]],
    // Goods transport: freight at 5% (reverse charge, or forward charge without ITC) and the usual extras
    transport: [['Freight Charges', '9965', 'Freight', '5', 5000], ['Door Delivery Charges', '9965', 'Freight', '5', 800], ['Detention / Halting Charges', '9965', 'Freight', '5', 1000], ['Loading & Unloading Charges', '9967', 'Handling', '18', 500], ['Toll & Parking Charges', '9965', 'Freight', '5', 300], ['Hamali / Labour Charges', '9967', 'Handling', '18', 400]],
    // Construction: the materials a builder or a building-material dealer bills, and the works contract and labour (SAC 9954)
    construction: [['Cement (50 kg bag)', '2523', 'Building Materials', '18', 380], ['TMT Steel Bar (per kg)', '7214', 'Building Materials', '18', 65], ['River Sand (per tonne)', '2505', 'Building Materials', '5', 1500], ['Aggregate / Jelly 20 mm (per tonne)', '2517', 'Building Materials', '5', 1100], ['Solid Concrete Block', '6810', 'Building Materials', '18', 45], ['Ready Mix Concrete M20 (per cu.m)', '3824', 'Building Materials', '18', 4800],
      ['Vitrified Floor Tiles (per box)', '6907', 'Finishing', '18', 950], ['Wall Putty (40 kg bag)', '3214', 'Finishing', '18', 850], ['Emulsion Paint (20 L)', '3209', 'Finishing', '18', 4200],
      ['PVC Pipe 4 inch (3 m)', '3917', 'Plumbing & Electrical', '18', 520], ['Electrical Wire 1.5 sq mm (90 m coil)', '8544', 'Plumbing & Electrical', '18', 1650],
      ['Civil Works Contract (per sq ft)', '9954', 'Works & Labour', '18', 1800], ['Masonry Labour Charges (per day)', '9954', 'Works & Labour', '18', 900], ['Plastering Work (per sq ft)', '9954', 'Works & Labour', '18', 45], ['Painting Work (per sq ft)', '9954', 'Works & Labour', '18', 22], ['Earthwork Excavation (per hour)', '9954', 'Works & Labour', '18', 1200]],
    // Medical: a pharmacy's medicines and consumables, and the exempt health care services of a clinic or a lab (SAC 9993)
    medical: [['Paracetamol 500 mg (strip of 10)', '3004', 'Medicines', '5', 20], ['Amoxicillin 500 mg (strip of 10)', '3004', 'Medicines', '5', 85], ['Cough Syrup 100 ml', '3004', 'Medicines', '5', 95], ['ORS Sachet', '3004', 'Medicines', '5', 22], ['Pain Relief Gel 30 g', '3004', 'Medicines', '5', 110], ['Antiseptic Liquid 100 ml', '3808', 'Medicines', '18', 75],
      ['Surgical Gloves (pair)', '4015', 'Surgical & Consumables', '5', 25], ['Bandage Roll', '3005', 'Surgical & Consumables', '5', 30], ['Cotton Roll 100 g', '3005', 'Surgical & Consumables', '5', 60], ['Disposable Syringe 5 ml', '9018', 'Surgical & Consumables', '5', 8], ['Face Mask (pack of 10)', '6307', 'Surgical & Consumables', '5', 50],
      ['Digital Thermometer', '9025', 'Devices', '5', 250], ['BP Monitor', '9018', 'Devices', '5', 1800], ['Glucometer Test Strips (50)', '3822', 'Devices', '5', 750],
      ['Doctor Consultation', '9993', 'Health Services', '0', 500], ['Blood Test (CBC)', '9993', 'Health Services', '0', 300], ['X-Ray', '9993', 'Health Services', '0', 400], ['Dressing / Injection Charges', '9993', 'Health Services', '0', 100]],
    general: [['General Goods Item', '9999', 'General', '18', 100], ['Standard Product Unit', '9999', 'General', '18', 250], ['Service Charge', '9987', 'General', '18', 500]]
  };
  const MEDICAL = /medical|pharma|clinic|hospital/;
  function quickLabel(act) { const a = String(act || '').toLowerCase(); return /food|beverage/.test(a) ? 'Food Items' : a.includes('transport') ? 'Freight Services' : a.includes('construct') ? 'Materials & Works' : MEDICAL.test(a) ? 'Medicines & Services' : a.includes('service') ? 'Services' : /retail|wholesale|manufactur/.test(a) ? 'Products' : 'Items'; }
  function quickItems() {
    const a = activity().toLowerCase();
    const set = /food|beverage/.test(a) ? SAMPLES.food : a.includes('retail') ? SAMPLES.retail : a.includes('transport') ? SAMPLES.transport : a.includes('construct') ? SAMPLES.construction : MEDICAL.test(a) ? SAMPLES.medical : a.includes('service') ? SAMPLES.service : /manufactur|wholesale/.test(a) ? SAMPLES.trade : SAMPLES.general;
    const items = set.map(x => ({ name: x[0], hsn: x[1], category: x[2], gst: x[3], rate: x[4], code: '', qty: 0 }));
    Store.list('items').slice().sort((x, y) => String(x.name).localeCompare(String(y.name))).forEach(m => {
      if (!String(m.name || '').trim()) return;
      const at = items.findIndex(q => q.name.toLowerCase() === m.name.trim().toLowerCase()), hasRate = m.rate !== '' && m.rate != null;
      if (m.hidden) { if (at >= 0) items.splice(at, 1); return; }
      if (at < 0) items.push({ name: m.name, hsn: m.hsn || '', category: m.category || 'Catalog', gst: m.gst || '18', rate: hasRate ? num(m.rate) : 100, code: m.code || '', qty: 0 });
      else { const q = items[at]; if (m.hsn) q.hsn = m.hsn; q.gst = m.gst || '18'; if (hasRate) q.rate = num(m.rate); if (m.category) q.category = m.category; q.code = m.code || ''; }
    });
    return items;
  }
  const Quick = {
    grid: false,
    // Add (item == null) or customise an item. Saved to the item master so it persists.
    editItem(item, onSaved) {
      const bg = UI.modal({ title: item ? 'Customise Item' : 'Add Item', body: '<div class="grid2">' + UI.field('Item Name', UI.input('mName', item ? item.name : ''), { req: true, span: true }) +
        UI.field('Item Code', UI.input('mCode', item ? item.code : '', { placeholder: 'e.g. SKU-101', attrs: ' maxlength="20" style="text-transform:uppercase"' })) + UI.field('Category', UI.input('mCat', item ? item.category : '', { placeholder: 'e.g. Beverages', list: 'mCatDl' }) + UI.datalist('mCatDl', categories())) +
        UI.field('HSN / SAC', UI.input('mHsn', item ? item.hsn : '', { attrs: ' inputmode="numeric"' })) + UI.field('GST Rate %', UI.select('mGst', U.GST_RATES, item ? item.gst : '18')) +
        UI.field(priceLabel(), UI.input('mRate', item && item.rate !== '' && item.rate != null ? num(item.rate).toFixed(2) : '', { type: 'number', placeholder: '0.00', attrs: ' step="any" min="0"' }), chargesGst() ? { hint: 'The price the customer pays; the GST is worked back out of it on the invoice' } : {}) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }].concat(item ? [{ label: 'Remove', cls: 'red outline', onClick: () => { hideMaster(item.name); UI.toast(item.name + ' removed from quick items'); onSaved(); } }] : []).concat([{ label: 'Save', cls: 'green', onClick: (bg) => {
          const v = (id) => UI.val(id, bg).trim(), name = U.nameCase(v('mName'));
          if (!name) { UI.mark('mName', true, bg); UI.toast('Item name is required'); return false; }
          if (num(v('mRate')) < 0) { UI.mark('mRate', true, bg); UI.toast('Enter a valid price'); return false; }
          const renamed = item && item.name.toLowerCase() !== name.toLowerCase();
          if ((!item || renamed) && Store.items().some(x => x.name.toLowerCase() === name.toLowerCase())) { UI.toast('An item with this name already exists'); return false; }
          // Renaming leaves the old entry behind as hidden so a built-in sample does not reappear
          if (renamed) hideMaster(item.name);
          upsertMaster(name, { name, hsn: v('mHsn'), code: v('mCode').toUpperCase(), gst: v('mGst'), rate: num(v('mRate')), category: U.nameCase(v('mCat')) || 'Catalog', hidden: false });
          UI.toast('Item saved'); onSaved();
        } }]) });
      return bg;
    },
    // Price (and GST) of a quick item for this invoice only
    price(item, gstOn, reload, redraw) {
      UI.modal({ title: item.name, body: '<div class="grid2 keep2">' + UI.field(priceLabel(), UI.input('qpRate', num(item.rate).toFixed(2), { type: 'number', attrs: ' step="any" min="0"' })) + (gstOn ? UI.field('GST Rate %', UI.select('qpGst', U.GST_RATES, item.gst)) : '') + '</div>' +
        '<div class="hint">Applies to this invoice only. Use "Customise Item" to change the saved name, category, HSN or price.</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Customise Item', cls: 'outline', onClick: () => { Quick.editItem(item, reload); } }, { label: 'Apply', cls: 'green', onClick: (bg) => {
          const p = UI.val('qpRate', bg).trim();
          if (p !== '' && (isNaN(parseFloat(p)) || parseFloat(p) < 0)) { UI.mark('qpRate', true, bg); UI.toast('Enter a valid price'); return false; }
          item.rate = num(p); if (gstOn) item.gst = UI.val('qpGst', bg);
          redraw();
        } }] });
    },
    // Rename a category (every item in it moves to the new name) or remove it (items go to "Catalog")
    category(cat, menu, reload) {
      const move = (to) => { menu.forEach(q => { if (String(q.category).toLowerCase() === cat.toLowerCase()) upsertMaster(q.name, Object.assign({ category: to, hidden: false, gst: q.gst, rate: q.rate }, q.hsn ? { hsn: q.hsn } : {})); }); UI.toast('Category updated'); reload(); };
      UI.menu('Category: ' + cat, ['Rename category', 'Remove category (items move to Catalog)'], (i) => {
        if (i === 1) { move('Catalog'); return; }
        UI.prompt('Rename Category', 'Category', cat, (v) => { const name = U.nameCase(v); if (name && name.toLowerCase() !== cat.toLowerCase()) move(name); }, { okLabel: 'Rename' });
      });
    },
    open(inv, onApply) {
      const label = quickLabel(activity()), gstOn = chargesGst();
      let menu = quickItems(), cat = 'All';
      // Start from what is already on the invoice
      const fromInvoice = () => menu.forEach(q => { const r = inv.items.find(x => String(x.desc).trim().toLowerCase() === q.name.toLowerCase()); if (r) { q.qty = Math.floor(num(r.qty)); if (num(r.rate) > 0) q.rate = num(r.rate); q.gst = String(r.gst); } });
      fromInvoice();
      const bg = UI.modal({ title: '⚡ Quick ' + label, wide: true, focus: false,
        body: '<div class="qbar"><input id="qSearch" placeholder="Search ' + esc(label.toLowerCase()) + '..."><button class="btn sm green" id="qAdd">+ Add</button><button class="btn sm outline" id="qView" title="List / grid view"></button></div>' +
          '<div class="qcats" id="qCats"></div><div class="qsum" id="qSum"></div><div id="qList"></div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Apply to Invoice', cls: 'green', onClick: () => { onApply(menu); } }] });
      const cats = () => ['All'].concat(Array.from(new Set(menu.map(q => q.category).filter(Boolean))));
      const summary = () => { const n = menu.reduce((s, q) => s + q.qty, 0), t = menu.reduce((s, q) => s + q.qty * q.rate, 0); $('#qSum', bg).textContent = n ? 'Selected: ' + n + (n === 1 ? ' item' : ' items') + '   |   Total: ₹ ' + t.toFixed(2) : 'Nothing selected yet. Tap + on an item to add it.'; };
      const sub = (q) => [q.code, q.category, q.hsn && 'HSN ' + q.hsn].filter(Boolean).join(' · ');
      const drawCats = () => {
        const list = cats(); if (!list.includes(cat)) cat = 'All';
        $('#qCats', bg).innerHTML = list.map(c => '<button class="btn sm ' + (c === cat ? '' : 'outline') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>').join('') + (cat !== 'All' ? '<button class="link" id="qCatEdit" title="Rename or remove this category">✎ ' + esc(cat) + '</button>' : '');
        $$('[data-c]', bg).forEach(b => b.onclick = () => { cat = b.dataset.c; drawCats(); draw(); });
        if ($('#qCatEdit', bg)) $('#qCatEdit', bg).onclick = () => Quick.category(cat, menu, reload);
      };
      const draw = () => {
        const q = $('#qSearch', bg).value.trim().toLowerCase();
        const shown = menu.filter(x => (cat === 'All' || String(x.category).toLowerCase() === cat.toLowerCase()) && (!q || x.name.toLowerCase().includes(q) || (x.code && x.code.toLowerCase().includes(q))));
        $('#qView', bg).textContent = Quick.grid ? '☰' : '▦';
        $('#qList', bg).className = 'qlist' + (Quick.grid ? ' grid' : '');
        $('#qList', bg).innerHTML = shown.map(x => '<div class="qitem' + (x.qty > 0 ? ' on' : '') + '" data-n="' + esc(x.name) + '"><div class="qname"><b>' + esc(x.name) + '</b><span>' + esc(sub(x)) + '</span></div>' +
          '<div class="qside"><button class="qprice" data-price>₹ ' + num(x.rate).toFixed(2) + (gstOn ? ' incl. · GST ' + esc(x.gst) + '%' : '') + '  ✎</button>' +
          '<div class="qstep"><button data-d="-1" aria-label="Less">−</button><input type="number" min="0" step="1" value="' + x.qty + '" aria-label="Quantity"><button data-d="1" aria-label="More">+</button></div></div></div>').join('') ||
          '<div class="empty">' + esc(q ? "No matching " + label.toLowerCase() + " found for '" + q + "'." : 'No ' + label.toLowerCase() + ' in this category. Tap "+ Add" to create one.') + '</div>';
        $$('.qitem', bg).forEach(el => {
          const x = menu.find(m => m.name === el.dataset.n), input = $('input', el);
          const set = (n) => { x.qty = Math.max(0, Math.floor(num(n))); input.value = x.qty; el.classList.toggle('on', x.qty > 0); summary(); };
          $$('[data-d]', el).forEach(b => b.onclick = () => set(x.qty + (+b.dataset.d)));
          input.addEventListener('input', () => { x.qty = Math.max(0, Math.floor(num(input.value))); el.classList.toggle('on', x.qty > 0); summary(); });
          input.addEventListener('blur', () => set(input.value));
          $('[data-price]', el).onclick = () => Quick.price(x, gstOn, reload, () => { draw(); summary(); });
        });
      };
      // After an item is added or customised: read the master again, keeping quantities already chosen
      const reload = () => {
        const qty = new Map(menu.filter(x => x.qty > 0).map(x => [x.name.toLowerCase(), x.qty]));
        menu = quickItems(); menu.forEach(x => { if (qty.has(x.name.toLowerCase())) x.qty = qty.get(x.name.toLowerCase()); });
        drawCats(); draw(); summary();
      };
      $('#qSearch', bg).addEventListener('input', draw);
      $('#qAdd', bg).onclick = () => Quick.editItem(null, reload);
      $('#qView', bg).onclick = () => { Quick.grid = !Quick.grid; draw(); };
      drawCats(); draw(); summary();
    },
    // The menu belongs to the invoice it was opened on: it goes when another document is opened
    closeMenu() { $$('#dialogs .modal-bg').forEach(b => { if ($('#mSecs', b)) b.remove(); }); },
    // A restaurant's menu, laid out like a food ordering app: the categories down the side, the dishes of each under
    // its heading. Tapping a dish puts it on the invoice straight away (onChange after every tap); ADD turns into − n +.
    menu(inv, onChange) {
      Quick.closeMenu();
      const gstOn = chargesGst();
      let menu = quickItems(), active = '';
      menu.forEach(q => { const r = inv.items.find(x => String(x.desc).trim().toLowerCase() === q.name.toLowerCase()); if (r) { q.qty = Math.floor(num(r.qty)); if (num(r.rate) > 0) q.rate = inclPrice(r.rate, r.gst); q.gst = String(r.gst); } });
      const bg = UI.modal({ title: '🍽 Menu', wide: true, focus: false,
        body: '<div class="qbar"><input id="mSearch" placeholder="Search the menu..."><button class="btn sm green" id="mAdd">+ Add Dish</button></div>' +
          '<div class="menu2"><div class="mcats" id="mCats"></div><div class="msecs" id="mSecs"></div></div><div class="qsum" id="mSum"></div>',
        buttons: [{ label: 'Go to Invoice →', cls: 'green' }] });
      const secs = $('#mSecs', bg), catOf = (x) => String(x.category || '').trim() || 'Catalog';
      const shown = () => { const q = $('#mSearch', bg).value.trim().toLowerCase(); return menu.filter(x => !q || x.name.toLowerCase().includes(q) || (x.code && x.code.toLowerCase().includes(q))); };
      const groups = () => { const m = new Map(); shown().forEach(x => { const c = catOf(x); if (!m.has(c)) m.set(c, []); m.get(c).push(x); }); return m; };
      const summary = () => { const n = menu.reduce((s, q) => s + q.qty, 0), t = menu.reduce((s, q) => s + q.qty * q.rate, 0); $('#mSum', bg).textContent = n ? n + (n === 1 ? ' item' : ' items') + ' on the invoice   |   ₹ ' + t.toFixed(2) : 'Tap a dish to add it to the invoice.'; };
      const mark = () => $$('#mCats button', bg).forEach(b => b.classList.toggle('on', b.dataset.c === active));
      const drawCats = (g) => {
        if (!g.has(active)) active = g.size ? g.keys().next().value : '';
        $('#mCats', bg).innerHTML = Array.from(g).map(([c, list]) => { const n = list.reduce((s, x) => s + x.qty, 0); return '<button data-c="' + esc(c) + '"><span>' + esc(c) + '</span><i' + (n ? ' class="has"' : '') + '>' + (n || list.length) + '</i></button>'; }).join('');
        $$('#mCats button', bg).forEach(b => b.onclick = () => { active = b.dataset.c; mark(); const sec = $$('.msec', secs).find(s => s.dataset.c === active); if (sec) secs.scrollTop = sec.offsetTop; });
        mark();
      };
      const act = (x) => x.qty > 0 ? '<div class="mstep"><button data-d="-1" aria-label="Less">−</button><b>' + x.qty + '</b><button data-d="1" aria-label="More">+</button></div>' : '<button class="madd" data-d="1">ADD</button>';
      const draw = () => {
        const g = groups(), top = secs.scrollTop, q = $('#mSearch', bg).value.trim();
        secs.innerHTML = Array.from(g).map(([c, list]) => '<div class="msec" data-c="' + esc(c) + '"><h4>' + esc(c) + ' <span>(' + list.length + ')</span><button class="link" data-cat title="Rename or remove this category">✎</button></h4>' +
          list.map(x => '<div class="mitem' + (x.qty > 0 ? ' on' : '') + '" data-n="' + esc(x.name) + '"><div class="qname"><b>' + esc(x.name) + '</b><button class="qprice" data-price title="Change the price">₹ ' + num(x.rate).toFixed(2) + (gstOn ? ' incl. · GST ' + esc(x.gst) + '%' : '') + '  ✎</button></div>' + act(x) + '</div>').join('') + '</div>').join('') ||
          '<div class="empty">' + esc(q ? "No dish found for '" + q + "'." : 'The menu is empty. Tap "+ Add Dish" to create one.') + '</div>';
        secs.scrollTop = top;
        $$('.msec', secs).forEach(sec => { $('[data-cat]', sec).onclick = () => Quick.category(sec.dataset.c, menu, reload); });
        $$('.mitem', secs).forEach(el => {
          const x = menu.find(m => m.name === el.dataset.n);
          const set = (n) => { x.qty = Math.max(0, n); onChange(menu); draw(); summary(); };
          // The whole row adds one; the buttons on it do their own work
          el.onclick = (e) => { const b = e.target.closest('button'); if (!b) set(x.qty + 1); else if (b.dataset.d) set(x.qty + (+b.dataset.d)); else if (b.hasAttribute('data-price')) Quick.price(x, gstOn, reload, () => { if (x.qty > 0) onChange(menu); draw(); summary(); }); };
        });
        drawCats(g);
      };
      const reload = () => {
        const qty = new Map(menu.filter(x => x.qty > 0).map(x => [x.name.toLowerCase(), x.qty]));
        menu = quickItems(); menu.forEach(x => { if (qty.has(x.name.toLowerCase())) x.qty = qty.get(x.name.toLowerCase()); });
        draw(); summary();
      };
      // The category of the dishes in view lights up while the list is scrolled
      secs.addEventListener('scroll', () => { let cur = ''; $$('.msec', secs).forEach(s => { if (s.offsetTop <= secs.scrollTop + 8) cur = s.dataset.c; }); if (cur && cur !== active) { active = cur; mark(); } });
      $('#mSearch', bg).addEventListener('input', draw);
      $('#mAdd', bg).onclick = () => Quick.editItem(null, reload);
      draw(); summary();
      return bg;
    }
  };

  // ------------------------------------------------------------ drafts
  // Save Draft keeps whatever is on the editor, half-filled or not, under its number without touching the books
  // (as in the Android app); Drafts lists them to pick up later. Drafts stay in this browser and are not synced.
  // Saving the real invoice or challan drops its draft.
  const draftKey = (kind, no) => kind + '|' + String(no || '').trim().toLowerCase();
  function drafts() { const a = Store.get('drafts', []); return Array.isArray(a) ? a : []; }
  function storeDrafts(list) { Store.set('drafts', list, true); const b = $('#iDrafts'); if (b) b.textContent = list.length ? 'Drafts (' + list.length + ')' : 'Drafts'; }
  function removeDraft(kind, no) { const k = draftKey(kind, no), list = drafts(); if (list.some(d => d.key === k)) storeDrafts(list.filter(d => d.key !== k)); }
  function draftTime(ms) { const d = new Date(num(ms)); return d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ', ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()); }

  // ------------------------------------------------------------ editor
  const Invoice = {
    inv: null,
    // A saved invoice or challan opens locked so it is not changed by accident; Edit (after a confirmation) unlocks it
    locked: false,
    open(params) {
      params = params || {};
      Quick.closeMenu();
      let inv = null, fromDraft = false;
      if (params.challan) inv = JSON.parse(JSON.stringify(Store.find('challans', params.challan) || {}));
      else if (params.id) inv = JSON.parse(JSON.stringify(Store.find('invoices', params.id) || {}));
      else if (params.fromChallan) { const dc = Store.find('challans', params.fromChallan); if (dc) inv = invoiceFromChallan(dc); }
      // The tax invoice of a hotel stay at check-out (hotel.js): the room nights and the folio's charges, the guest as the buyer
      else if (params.fromStay && global.Hotel) inv = Hotel.invoiceFor(params.fromStay, newInvoice());
      else if (params.duplicate) { const src = Store.find('invoices', params.duplicate); if (src) inv = duplicateInvoice(src); }
      else if (params.draft) { const d = drafts().find(x => x.key === params.draft); if (d && d.inv) { inv = JSON.parse(JSON.stringify(d.inv)); fromDraft = true; } }
      if (!inv || !inv.no) inv = params.kind === 'challan' ? newChallan() : params.quickItem ? newInvoice() : newSalesInvoice();
      // In a restaurant a new invoice names the steward: the employee the login belongs to
      if (!inv.id && isRestaurant() && global.HR && HR.myEmployee) { const me = HR.myEmployee(); if (me && !(inv.other && inv.other.steward)) { inv.other = inv.other || {}; inv.other.steward = me.name; } }
      if (params.quickItem) { const m = findMaster(params.quickItem); Object.assign(inv.items[0], { desc: params.quickItem, hsn: m && !m.hidden ? m.hsn : U.hsnFor(params.quickItem), gst: m && !m.hidden ? m.gst : '18', qty: 1, rate: m && !m.hidden && num(m.rate) > 0 ? exclRate(m.rate, m.gst) : '' }); }
      this.inv = inv;
      // Only an entry that is already in the books is locked; a draft continued over a saved number is being edited on purpose
      this.locked = !!inv.id && !fromDraft && !params.edit;
      this.render();
      if (fromDraft) UI.toast('Draft loaded', 2000, 'ok');
      // A restaurant starts a new invoice from its menu: the dishes tapped there are on the invoice when it closes
      if (!inv.id && !fromDraft && inv.kind !== 'challan' && !params.quickItem && !params.fromChallan && !params.duplicate && !params.fromStay && !params.noMenu && isRestaurant() && $('#quickBtn') && !$('#quickBtn').disabled) Quick.menu(inv, (menu) => this.applyQuick(menu, true));
      if (params.print) this.print(params.print === 'challan' ? 'challan' : 'invoice');
    },
    // Everything on the form disabled while the saved entry is locked; the buttons that do not change it stay
    applyLock() {
      if (!this.locked) return;
      const root = $('#view'); if (!root) return;
      $$('input, select, textarea, .step, .subbtn, .delbtn, #addRow, #quickBtn, #staffPick, #bPick, #cPick', root).forEach(el => { el.disabled = true; });
      if ($('#iSave')) $('#iSave').classList.add('hidden');
    },
    unlock() {
      const inv = this.inv, challan = inv.kind === 'challan';
      UI.modal({ title: challan ? 'Edit saved challan?' : 'Edit saved invoice?',
        body: '<p>' + (challan ? 'Delivery challan ' : 'Invoice ') + '<b>' + esc(inv.no) + '</b> is already in the books. Changing it alters the saved entry, and any PDF already sent to the ' + (challan ? 'party' : 'buyer') + ' will differ from it.</p><p>To correct a sale that has gone out, a credit or debit note is the usual way. Continue only if this ' + (challan ? 'challan' : 'invoice') + ' really has to change.</p>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: challan ? 'Edit challan' : 'Edit invoice', cls: 'blue', onClick: () => { this.locked = false; this.render(); UI.toast((challan ? 'Challan ' : 'Invoice ') + inv.no + ' unlocked for editing. Save when done.', 3500); } }] });
    },
    saveDraft() {
      const inv = this.inv, kind = inv.kind === 'challan' ? 'challan' : 'invoice';
      const no = (($('#iNo') && $('#iNo').value.trim()) || inv.no || '').trim();
      if (!no) { UI.toast('Give the ' + kind + ' a number first'); return; }
      inv.no = no;
      const copy = JSON.parse(JSON.stringify(inv)); computeTotals(copy);
      const d = { key: draftKey(kind, no), kind, no, party: String(inv.buyer.name || '').split('\n')[0].trim(), total: copy.totals.rounded, saved: Date.now(), inv: copy };
      storeDrafts([d].concat(drafts().filter(x => x.key !== d.key)).slice(0, 50));
      UI.toast('Draft saved successfully', 2600, 'ok');
    },
    draftsDialog() {
      const list = drafts();
      const bg = UI.modal({ title: 'Drafts', focus: false,
        body: (list.length ? '' : '<div class="hint">No drafts yet.</div>') +
          (list.length ? '<div class="drafts">' + list.map(d => '<div class="draft"><button class="dload" data-load="' + esc(d.key) + '"><b>' + (d.kind === 'challan' ? 'Challan ' : 'Invoice ') + esc(d.no) + '</b><span>' + esc(d.party ? U.titleCase(d.party) : '(no party yet)') + '  ·  ' + money(d.total) + '  ·  saved ' + esc(draftTime(d.saved)) + '</span></button><button class="delbtn" title="Delete draft" data-x="' + esc(d.key) + '">🗑</button></div>').join('') + '</div>' : ''),
        buttons: [{ label: 'Close', cls: 'outline' }] });
      $$('[data-load]', bg).forEach(b => b.onclick = () => { bg.remove(); Invoice.open({ draft: b.dataset.load }); });
      $$('[data-x]', bg).forEach(b => b.onclick = () => { storeDrafts(drafts().filter(d => d.key !== b.dataset.x)); bg.remove(); this.draftsDialog(); });
    },
    render() {
      const inv = this.inv, c = Store.company(), gst = chargesGst(), challan = inv.kind === 'challan', gta = isTransporter();
      inv.other = Object.assign({ lrNo: '', lrDate: '', origin: '', goods: '', table: '', steward: '', pax: '' }, inv.other);
      const nextNo = () => challan ? nextChallanNo() : nextInvoiceNo(), stepNo = (no, d) => challan ? stepChallanNo(no, d) : stepInvoiceNo(no, d);
      const allContacts = contactsOf(null);
      // Name & address on the left with the contact picker beside it, then phone, email, GSTIN and state in one line
      const partyBlock = (p, pre, label) =>
        '<div class="grid2 party-top">' + UI.field(label, '<textarea id="' + pre + 'Name" placeholder="' + (pre === 'b' ? 'Buyer' : 'Consignee') + ' Name &amp; Address (name on the first line)">' + esc(p.name) + '</textarea>', { req: pre === 'b' }) +
        UI.field('Choose from contacts', UI.select(pre + 'Pick', allContacts.map(x => [x.id, x.name + ' (' + (x.type || 'Customer') + ')']), '', { blank: '— select a saved party —' }), { hint: 'Fills in the name, address, phone, email, GSTIN and state' }) + '</div>' +
        '<div class="grid4 keep2 party-line">' +
        UI.field('Phone', UI.input(pre + 'Phone', p.phone, { type: 'tel', placeholder: 'Phone Number', attrs: ' maxlength="10"' })) + UI.field('Email', UI.input(pre + 'Email', p.email, { type: 'email', placeholder: 'Email Address' })) +
        UI.field('GSTIN', UI.input(pre + 'Gstin', p.gstin, { placeholder: 'GSTIN Number', attrs: ' maxlength="15" style="text-transform:uppercase"' })) +
        UI.field('State', UI.select(pre + 'State', U.STATES, U.matchState(p.state, '') || p.state)) + '</div>';
      // A saved entry opens locked until Edit (on an invoice pack too: saving it again uses no further invoice of the pack)
      const locked = this.locked, nDrafts = drafts().length;
      // A manpower and staffing agency bills on the staff sheet; the tick takes an invoice back to plain lines
      const staffCo = isStaffing() && !challan, staff = !challan && inv.staff ? inv.staff : null;
      const staffTick = staffCo || staff ? '<label class="check" style="padding:0;font-weight:600;text-transform:none;letter-spacing:0"><input type="checkbox" id="iStaffOn"' + (staff ? ' checked' : '') + '> Staff-wise billing</label>' : '';
      const pctIn = (id, v) => UI.input(id, v, { type: 'number', placeholder: '0', attrs: ' min="0" max="100" step="any"' });
      const itemsCard = staff ? '<div class="card" id="staffCard"><div class="hd">Staff Deployed <span class="inline">' + staffTick + '<button class="btn sm green" id="staffPick">+ From ' + (roster().length ? 'Manpower' : 'Employees') + '</button></span></div><div class="bd" style="padding:8px">' +
        '<div class="grid4 keep2" style="padding:4px 6px 12px">' + UI.field('Billing Period From', UI.dateInput('sFrom', staff.from)) + UI.field('Billing Period To', UI.dateInput('sTo', staff.to)) +
        UI.field('Work Site / Location', UI.input('sSite', staff.site, { placeholder: 'Where the staff are deployed' })) +
        UI.field('SAC', UI.input('sSac', staff.sac, { list: 'sacDl', attrs: ' maxlength="8" inputmode="numeric"' }) + '<datalist id="sacDl">' + STAFF_SAC.map(x => '<option value="' + x[0] + '">' + esc(x[1]) + '</option>').join('') + '</datalist>') +
        (gst ? UI.field('GST %', UI.select('sGst', U.GST_RATES.map(r => [r, r + '%']), staff.gst)) : '') + '</div>' +
        '<div class="tablewrap" style="border:0"><table class="items staff"><thead><tr><th class="sl">Sl</th><th class="desc">Name *</th><th class="eid">Employee ID</th><th class="desg">Designation</th><th class="uqc">Per</th><th class="qty">Worked *</th><th class="rate">Rate *</th><th class="ot">OT Hrs</th><th class="otr">OT Rate</th><th class="tax">Amount</th><th class="adv">Advance</th><th class="del"></th></tr></thead><tbody id="rows"></tbody></table></div>' +
        '<datalist id="staffDl"></datalist><datalist id="desgDl"></datalist>' +
        '<div class="btnrow"><button class="btn sm" id="addRow">+ Add Staff</button></div>' +
        '<div class="grid4 keep2" style="padding:4px 6px">' + UI.field('Employer PF % (of wages)', pctIn('sPf', staff.pfPct), { hint: 'Usually 13 (12 + 1 admin and EDLI); blank when not billed' }) + UI.field('Employer ESI % (of wages)', pctIn('sEsi', staff.esiPct), { hint: 'Usually 3.25; blank when not billed' }) +
        UI.field('Service Charge %', pctIn('sChg', staff.chargePct), { hint: 'The agency commission' }) + UI.field('Service Charge On', UI.select('sChgOn', [['wages', 'Wages'], ['all', 'Wages + employer PF & ESI']], staff.chargeOn)) + '</div>' +
        '<div class="hint" style="padding:0 6px 6px">Amount = worked x rate + OT hours x OT rate. GST is charged on the full value (wages, employer PF / ESI and the service charge). Advances already paid come off the invoice total after GST: the tax does not change. Record the advance under Receipts &amp; Payments against this invoice so the outstanding shows the balance.</div></div></div>' : null;
      const root = App.view(App.header(inv.id ? (challan ? 'Delivery Challan ' : 'Invoice ') + inv.no : challan ? 'New Delivery Challan' : 'New Invoice', '<span class="muted">' + esc(c.name || 'My Company Profile') + '</span> <button class="btn sm outline" id="iDrafts" title="Half-done invoices and challans kept outside the books">' + (nDrafts ? 'Drafts (' + nDrafts + ')' : 'Drafts') + '</button>') +
        '<div class="inv-hero"><div><div class="ih-kind">' + (challan ? 'DELIVERY CHALLAN' : c.gstType === 'Composition' ? 'BILL OF SUPPLY' : chargesGst() ? 'TAX INVOICE' : 'INVOICE') + '</div><div class="ih-co">' + esc(c.name || 'My Company Profile') + '</div>' +
        '<div class="chips"><span class="chip">' + (challan ? 'Challan ' : 'Invoice ') + esc(inv.no) + '</span><span class="chip">' + esc(inv.date) + '</span>' + (c.gstin ? '<span class="chip">GSTIN ' + esc(c.gstin) + '</span>' : '') + '</div></div>' +
        '<div class="ih-total"><div class="k">' + (challan ? 'Value of goods' : 'Amount payable') + '</div><div class="v" id="ihTotal">' + money(0) + '</div></div></div>' +
        (locked ? '<div class="lockbar" id="iLock"><span>🔒 Saved ' + (challan ? 'delivery challan ' : 'invoice ') + '<b>' + esc(inv.no) + '</b>. It is locked so it is not changed by accident. Tap Edit to change it.</span><button class="btn sm blue" id="iEdit">Edit</button></div>' : '') +
        // The credit notes issued against this invoice, each a link
        (!challan && inv.id && creditNotesOf(inv.no).length ? '<div class="lockbar" id="iCnBar" style="background:#FFF7ED;border-color:#FDBA74"><span>Credit note' + (creditNotesOf(inv.no).length > 1 ? 's' : '') + ' against this invoice: ' + creditNotesOf(inv.no).map(n => '<b>' + U.noLink(n.no) + '</b> ' + money(n.total) + (n.reason ? ' (' + esc(n.reason) + ')' : '')).join(', ') + '</span></div>' : '') +
        '<div class="card"><div class="hd">' + (challan ? 'Challan Details' : 'Invoice Details') + '</div><div class="bd"><div class="grid3">' +
        UI.field(challan ? 'Challan No' : 'Invoice No', '<div class="inline">' + UI.input('iNo', inv.no) + '<button class="step" id="iUp" title="Next number">▲</button><button class="step" id="iDn" title="Previous number">▼</button></div>', { req: true }) +
        UI.field('Dated', UI.dateInput('iDate', inv.date), { req: true }) +
        (challan ? UI.field('Status', UI.input('iStatus', inv.invoiceNo ? 'Invoiced: ' + inv.invoiceNo : 'Open - not invoiced yet', { disabled: true }), { hint: 'Make Invoice turns the challan into a sales invoice' }) : UI.field('Payment Mode', UI.select('iPay', U.PAYMENT_MODES, inv.payment))) + '</div>' +
        (challan ? '' : '<div class="grid3" style="margin-top:12px">' + UI.field('Payment Due Date', UI.dateInput('iDue', inv.dueDate), { hint: 'Prints on the PDF. A Credit invoice gets ' + (num(c.creditDays) || 0) + ' days from the invoice date (Company Profile)' }) +
          '<div class="field"><label>Terms &amp; Conditions</label>' + UI.check('iTerms', 'Include terms & conditions on the PDF', !!inv.termsOn) + '<div class="hint">' + (c.terms ? esc(c.terms.split('\n')[0]) + (c.terms.includes('\n') ? ' ...' : '') : 'No terms yet: add them under Company Profile') + '</div></div></div>') +
        (rcmAllowed() ? UI.check('iRcm', 'Reverse charge (RCM) - GST payable by the recipient', inv.rcm) : '') + '</div></div>' +
        '<div class="card"><div class="hd">' + (gta ? 'Consignor & Consignee' : 'Buyer & Shipping Details') + '</div><div class="bd">' + partyBlock(inv.buyer, 'b', gta ? 'Consignor (Bill To)' : 'Buyer (Bill To)') +
        UI.check('iSame', gta ? 'Consignee same as Consignor' : 'Shipping same as Billing', inv.sameShip) + '<div id="shipBox" class="' + (inv.sameShip ? 'hidden' : '') + '">' + partyBlock(inv.consignee, 'c', gta ? 'Consignee (Deliver To)' : 'Consignee (Ship To)') + '</div></div></div>' +
        (gta ? '<div class="card"><div class="hd">Consignment Details</div><div class="bd"><div class="grid3">' +
          UI.field('LR / Consignment Note No', UI.input('oLr', inv.other.lrNo, { placeholder: 'LR No' })) + UI.field('LR Date', UI.dateInput('oLrDt', inv.other.lrDate)) + UI.field('Vehicle Number', UI.input('oVNo', inv.other.vehicleNo, { attrs: ' style="text-transform:uppercase"' })) +
          UI.field('From (Origin)', UI.input('oFrom', inv.other.origin, { placeholder: 'Place loaded' })) + UI.field('To (Destination)', UI.input('oDest', inv.other.destination, { placeholder: 'Place delivered' })) + UI.field('Vehicle Type', UI.input('oVType', inv.other.vehicleType, { placeholder: 'e.g. 32 ft container, 10-wheeler' })) + '</div>' +
          UI.field('Goods / Packages / Weight', UI.input('oGoods', inv.other.goods, { placeholder: 'e.g. 120 cartons of ceramic tiles, 8.5 MT' })) +
          UI.check('oMore', 'Show additional details', !!(inv.other.deliveryNote || inv.other.orderNo || inv.other.orderDate || inv.other.reference || inv.other.info)) +
          '<div id="moreBox" class="grid3 hidden">' + UI.field('E-way Bill / Reference No', UI.input('oRef', inv.other.reference)) + UI.field('Delivery Note / Challan', UI.input('oDN', inv.other.deliveryNote)) + UI.field('Order No', UI.input('oOrd', inv.other.orderNo)) +
          UI.field('Order Date', UI.dateInput('oOrdDt', inv.other.orderDate)) + UI.field('Other Info', UI.input('oInfo', inv.other.info), { span: true }) + '</div></div></div>'
        : !challan && vertical() === 'restaurant' ? '<div class="card"><div class="hd">Table &amp; Service</div><div class="bd"><div class="grid3">' +
          UI.field('Table No', UI.input('oTable', inv.other.table, { placeholder: 'e.g. 5' })) + UI.field('PAX (covers)', UI.input('oPax', inv.other.pax, { type: 'number', attrs: ' min="0" step="1"' })) + UI.field('Steward', UI.input('oSteward', inv.other.steward, { list: 'stewardDl', placeholder: 'Who served the table' }) + UI.datalist('stewardDl', stewards())) + UI.field('Other Info', UI.input('oInfo', inv.other.info, { placeholder: 'e.g. Birthday table' })) + '</div></div></div>'
        : !challan && vertical() === 'service' ? '<div class="card"><div class="hd">Other Details</div><div class="bd"><div class="grid3">' +
          UI.field('Reference No', UI.input('oRef', inv.other.reference)) + UI.field('Order / PO No', UI.input('oOrd', inv.other.orderNo)) + UI.field('Order Date', UI.dateInput('oOrdDt', inv.other.orderDate)) + UI.field('Other Info', UI.input('oInfo', inv.other.info), { span: true }) + '</div></div></div>'
        : '<div class="card"><div class="hd">Other Details</div><div class="bd"><div class="grid3">' +
          UI.field('Destination', UI.input('oDest', inv.other.destination)) + UI.field('Vehicle Type', UI.input('oVType', inv.other.vehicleType)) + UI.field('Vehicle Number', UI.input('oVNo', inv.other.vehicleNo)) + '</div>' +
          UI.check('oMore', 'Show additional details', !!(inv.other.transporter || inv.other.deliveryNote || inv.other.orderNo || inv.other.orderDate || inv.other.reference || inv.other.info)) +
          '<div id="moreBox" class="grid3 hidden">' + UI.field('Transporter', UI.input('oTrans', inv.other.transporter)) + UI.field('Delivery Note', UI.input('oDN', inv.other.deliveryNote)) + UI.field('Buyer Order No', UI.input('oOrd', inv.other.orderNo)) +
          UI.field('Buyer Order Date', UI.dateInput('oOrdDt', inv.other.orderDate)) + UI.field('Reference No', UI.input('oRef', inv.other.reference)) + UI.field('Other Info', UI.input('oInfo', inv.other.info)) + '</div></div></div>') +
        (itemsCard || '<div class="card"><div class="hd">' + (gta ? 'Freight & Charges' : 'Goods / Services') + ' <span class="inline">' + staffTick + '<button class="btn sm green" id="quickBtn">' + (isRestaurant() && !challan ? '🍽 Menu' : 'Quick ' + esc(quickLabel(activity()))) + '</button></span></div><div class="bd" style="padding:8px">' +
        '<div class="tablewrap" style="border:0"><table class="items"><thead><tr><th class="sl">Sl</th><th class="desc">Particulars</th><th class="hsn">HSN/SAC</th>' + (gst ? '<th class="gst">GST %</th><th class="inc">Inc?</th>' : '') + '<th class="qty">Qty *</th><th class="uqc">UQC</th><th class="rate">Rate *</th><th class="tax">' + (gst ? 'Taxable' : 'Amount') + '</th>' + (gst ? '<th class="tot">Total Incl.</th>' : '') + '<th class="del"></th></tr></thead><tbody id="rows"></tbody></table></div>' +
        UI.datalist('itemsDl', itemLabels()) +
        '<div class="btnrow"><button class="btn sm" id="addRow">+ Add Particular / Row</button></div></div></div>') +
        '<div class="card"><div class="hd">Totals Summary</div><div class="bd">' + (challan ? '' : '<div class="grid2" id="fxBox" style="margin-bottom:8px">' + UI.field('Invoice currency', UI.select('iFx', [['', '₹ INR (rupees)']].concat(Array.from(new Set(Currency.codes().concat(inv.fx && inv.fx.code ? [inv.fx.code] : []))).map(c => [c, c + ' - ' + Currency.info(c).name])), inv.fx && inv.fx.code ? inv.fx.code : ''), { hint: 'The invoice is entered and booked in rupees; it shows and prints its total in this currency. Currencies are added under Company > Currencies & Rates.' }) + UI.field('Exchange rate (₹ for 1 unit)', UI.input('iFxRate', inv.fx && inv.fx.code ? inv.fx.rate : '', { type: 'number', attrs: ' min="0" step="any"' + (inv.fx && inv.fx.code ? '' : ' disabled') })) + '</div>') + '<div class="totals" id="totals"></div><div class="words" id="words"></div></div></div>' +
        '<div class="btnrow end"><button class="btn red outline" id="iDel" ' + (inv.id ? '' : 'disabled') + '>🗑 Delete</button><button class="btn outline" id="iNew">+ New</button><button class="btn outline" id="iSettings">Print Settings</button><button class="btn outline" id="iDraft" title="Keep this ' + (challan ? 'challan' : 'invoice') + ' as it is, outside the books, to finish later">Save Draft</button>' +
        (challan ? (inv.id && !inv.invoiceNo ? '<button class="btn" id="iMakeInv">Make Invoice</button>' : '') + '<button class="btn blue" id="iSave">Save</button><button class="btn green" id="iPrint">Print Challan</button>'
          : '<button class="btn" id="iChallan">Delivery Challan</button>' + (inv.id ? '<button class="btn" id="iCN" title="Issue a credit note against this invoice: price adjustment, quantity issue, goods returned ...">Credit Note</button><button class="btn" id="iReceipt" title="Record the money received against this invoice and print the receipt">Receipt</button><button class="btn" id="iMail" title="Email this invoice to the buyer">Email</button><button class="btn" id="iDup" title="A new invoice with the same buyer and items, under the next number">Duplicate</button>' : '') + '<button class="btn blue" id="iSave">Save</button><button class="btn green" id="iPrint">Print / PDF</button>') + '</div>');
      App.wireBack(root);
      const bind = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('input', fn), el.addEventListener('change', fn); };
      bind('iNo', e => {
        inv.no = e.target.value.trim();
        const ex = challan ? Store.list('challans').find(x => x.no === inv.no && x.id !== inv.id) : Store.list('invoices').find(x => x.kind === 'invoice' && x.no === inv.no && x.id !== inv.id);
        if (ex && !$('#dialogs').children.length) UI.confirm(challan ? 'Load challan' : 'Load invoice', (challan ? 'Delivery challan ' : 'Invoice ') + ex.no + ' already exists. Open it?', () => Invoice.open(challan ? { challan: ex.id } : { id: ex.id }), 'Open');
      });
      // The running number is never left blank: leaving the field empty restores the next number in sequence
      $('#iNo').addEventListener('blur', e => { if (!e.target.value.trim()) e.target.value = inv.no = nextNo(); });
      $('#iUp').onclick = () => { $('#iNo').value = inv.no = stepNo($('#iNo').value.trim() || nextNo(), 1); $('#iNo').dispatchEvent(new Event('change')); };
      $('#iDn').onclick = () => { $('#iNo').value = inv.no = stepNo($('#iNo').value.trim() || nextNo(), -1); $('#iNo').dispatchEvent(new Event('change')); };
      // Dated and the payment mode keep the due date of a Credit invoice in step until one is typed by hand
      let dueAuto = !inv.dueDate || inv.dueDate === dueDateFor(inv);
      const refreshDue = () => { if (!dueAuto || challan) return; inv.dueDate = dueDateFor(inv); $('#iDue').value = U.toIso(inv.dueDate); };
      if ($('#iFx')) { $('#iFx').addEventListener('change', e => { const c = e.target.value, r = $('#iFxRate'); inv.fx = c ? { code: c, rate: Currency.rate(c) || (inv.fx && inv.fx.code === c ? inv.fx.rate : 0) } : null; r.disabled = !c; r.value = c ? inv.fx.rate || '' : ''; this.updateTotals(); });
        $('#iFxRate').addEventListener('input', e => { if (inv.fx) { inv.fx.rate = num(e.target.value); this.updateTotals(); } }); }
      bind('iDate', e => { inv.date = U.fromIso(e.target.value); refreshDue(); }); bind('iPay', e => { inv.payment = e.target.value; refreshDue(); }); bind('iRcm', e => { inv.rcm = e.target.checked; this.updateTotals(); });
      bind('iDue', e => { inv.dueDate = U.fromIso(e.target.value); dueAuto = !inv.dueDate; }); bind('iTerms', e => inv.termsOn = e.target.checked);
      const wireParty = (pre, p) => {
        p.state = $('#' + pre + 'State').value;
        bind(pre + 'Name', e => p.name = e.target.value); bind(pre + 'State', e => { p.state = e.target.value; this.updateTotals(); });
        bind(pre + 'Phone', e => { p.phone = e.target.value.trim(); e.target.classList.toggle('err', p.phone.length >= 10 && !U.isValidPhone(p.phone)); });
        bind(pre + 'Email', e => p.email = e.target.value.trim());
        bind(pre + 'Gstin', e => { p.gstin = e.target.value.trim().toUpperCase(); e.target.classList.toggle('err', p.gstin.length >= 15 && !U.isValidGstin(p.gstin)); if (p.gstin.length >= 2 && U.stateByCode(p.gstin.slice(0, 2))) { p.state = U.stateByCode(p.gstin.slice(0, 2)); $('#' + pre + 'State').value = p.state; this.updateTotals(); } });
        bind(pre + 'Pick', e => { const ct = Store.find('contacts', e.target.value); if (!ct) return; Object.assign(p, partyFromContact(ct)); $('#' + pre + 'Name').value = p.name; $('#' + pre + 'State').value = p.state; $('#' + pre + 'Phone').value = p.phone; $('#' + pre + 'Email').value = p.email; $('#' + pre + 'Gstin').value = p.gstin; this.updateTotals(); });
      };
      wireParty('b', inv.buyer); wireParty('c', inv.consignee);
      bind('iSame', e => { inv.sameShip = e.target.checked; $('#shipBox').classList.toggle('hidden', inv.sameShip); });
      ['oDest', 'destination', 'oVType', 'vehicleType', 'oVNo', 'vehicleNo', 'oTrans', 'transporter', 'oDN', 'deliveryNote', 'oOrd', 'orderNo', 'oRef', 'reference', 'oInfo', 'info', 'oLr', 'lrNo', 'oFrom', 'origin', 'oGoods', 'goods', 'oTable', 'table', 'oSteward', 'steward', 'oPax', 'pax'].forEach((k, i, a) => { if (i % 2 === 0) bind(k, e => inv.other[a[i + 1]] = e.target.value.trim()); });
      bind('oOrdDt', e => inv.other.orderDate = U.fromIso(e.target.value)); bind('oLrDt', e => inv.other.lrDate = U.fromIso(e.target.value));
      if ($('#iReceipt')) $('#iReceipt').onclick = () => Invoice.receipt(inv, () => Invoice.open({ id: inv.id }));
      if ($('#iMail')) $('#iMail').onclick = () => Mail.dialog(Mail.invoice(inv, Store.company()), { title: 'Email invoice ' + inv.no });
      const more = $('#oMore'); if (more) { const showMore = () => $('#moreBox').classList.toggle('hidden', !more.checked); more.addEventListener('change', showMore); showMore(); }
      // The staff sheet: its settings follow what is typed, the tick turns the sheet on and off
      if ($('#iStaffOn')) $('#iStaffOn').addEventListener('change', e => {
        if (e.target.checked) { inv.staff = staffHeader(); inv.items = inv.items.filter(it => String(it.desc).trim()); inv.items.forEach(it => { it.staff = staffFields(); it.uqc = 'DAY'; it.inc = false; }); if (!inv.items.length) inv.items.push(blankStaff(1, inv.staff)); }
        else { delete inv.staff; inv.items = staffRows(inv).filter(it => String(it.desc).trim()); inv.items.forEach((it, n) => { delete it.staff; it.uqc = 'OTH'; it.sl = n + 1; }); if (!inv.items.length) inv.items.push(blankItem(1)); }
        this.render();
      });
      if (staff) {
        bind('sFrom', e => { staff.from = U.fromIso(e.target.value); }); bind('sTo', e => { staff.to = U.fromIso(e.target.value); }); bind('sSite', e => { staff.site = e.target.value.trim(); });
        const reTotal = () => { this.updateTotals(); };
        bind('sSac', e => { staff.sac = e.target.value.trim(); reTotal(); }); bind('sGst', e => { staff.gst = e.target.value; reTotal(); });
        bind('sPf', e => { staff.pfPct = e.target.value; reTotal(); }); bind('sEsi', e => { staff.esiPct = e.target.value; reTotal(); }); bind('sChg', e => { staff.chargePct = e.target.value; reTotal(); }); bind('sChgOn', e => { staff.chargeOn = e.target.value; reTotal(); });
        $('#staffPick').onclick = () => this.pickStaff();
      }
      $('#addRow').onclick = () => {
        if (staff) {
          const rows = staffRows(inv), end = rows[rows.length - 1];
          if (end && !String(end.desc).trim()) { UI.toast('Enter the name on the current row before adding another.'); return; }
          inv.items = rows.concat([blankStaff(rows.length + 1, staff)]); this.renderRows();
          const trs = $$('#rows tr'), el = $('[data-k=desc]', trs[trs.length - 1]); if (el) el.focus();
          return;
        }
        const last = inv.items[inv.items.length - 1];
        if (last && !String(last.desc).trim()) { UI.toast('Please enter particulars for the current item before adding a new item.'); return; }
        if (last && num(last.qty) <= 0) { UI.toast('Quantity is required for the current item'); return; }
        if (last && num(last.rate) <= 0) { UI.toast('Rate is required for the current item'); return; }
        inv.items.push(blankItem(inv.items.length + 1)); this.renderRows();
        const rows = $$('#rows tr'); const el = $('[data-k=desc]', rows[rows.length - 1]); if (el) el.focus();
      };
      // A restaurant picks from its menu (category > dish), everyone else from the quick items
      if ($('#quickBtn')) $('#quickBtn').onclick = () => isRestaurant() && !challan ? Quick.menu(inv, (menu) => this.applyQuick(menu, true)) : Quick.open(inv, (menu) => this.applyQuick(menu));
      $('#iNew').onclick = () => Invoice.open(challan ? { kind: 'challan' } : {});
      $('#iDel').onclick = () => challan ? deleteChallan(inv, () => Invoice.open({ kind: 'challan' })) : deleteInvoice(inv, () => Invoice.open({}));
      $('#iSave').onclick = () => this.saveOnly();
      $('#iPrint').onclick = () => this.print(challan ? 'challan' : 'invoice');
      $('#iSettings').onclick = () => this.printSettings();
      if ($('#iChallan')) $('#iChallan').onclick = () => this.print('challan');
      if ($('#iMakeInv')) $('#iMakeInv').onclick = () => Invoice.open({ fromChallan: inv.id });
      if ($('#iDup')) $('#iDup').onclick = () => Invoice.open({ duplicate: inv.id });
      if ($('#iCN')) $('#iCN').onclick = () => Notes.forInvoice(Store.find('invoices', inv.id), () => Invoice.open({ id: inv.id }));
      $('#iDraft').onclick = () => this.saveDraft();
      $('#iDrafts').onclick = () => this.draftsDialog();
      if ($('#iEdit')) $('#iEdit').onclick = () => this.unlock();
      this.renderRows();
      if (inv.fromChallan) UI.toast('Invoice prepared from delivery challan ' + inv.other.deliveryNote + '. Check it and Save.', 5000);
      if (inv.duplicateOf) UI.toast('Copy of invoice ' + inv.duplicateOf + ' as ' + inv.no + ' dated today. Check it and Save.', 5000);
      // On an invoice pack a saved invoice is changed (Edit, then Save) but not deleted: it used one invoice of the pack
      if (inv.id && Sub.isLite() && !challan) $('#iDel').classList.add('hidden');
    },
    // The rows of a staff sheet: a person a row. The PF, ESI and service charge lines are not rows: they show in the totals.
    renderStaffRows() {
      const inv = this.inv; staffSync(inv);
      const rows = staffRows(inv), tb = $('#rows'), known = staffKnown();
      $('#staffDl').innerHTML = Array.from(known.values()).map(k => '<option value="' + esc(k.name) + '">' + esc([k.empId, k.designation].filter(Boolean).join(' · ')) + '</option>').join('');
      $('#desgDl').innerHTML = Array.from(new Set(Array.from(known.values()).map(k => k.designation).filter(Boolean))).sort().map(d => '<option value="' + esc(d) + '">').join('');
      const n = (cls, label, attr, v) => '<td class="' + cls + '" data-l="' + label + '"><input class="num" type="number" step="any" min="0" ' + attr + ' value="' + esc(v) + '"></td>';
      tb.innerHTML = rows.map((it, i) => '<tr data-i="' + i + '"><td class="sl" data-l="Sl"><input class="num" value="' + (i + 1) + '" disabled></td>' +
        '<td class="desc" data-l="Name"><input data-k="desc" list="staffDl" autocomplete="off" placeholder="Name of the person" value="' + esc(it.desc) + '"></td>' +
        '<td class="eid" data-l="Employee ID"><input data-s="empId" placeholder="ID" value="' + esc(it.staff.empId) + '"></td>' +
        '<td class="desg" data-l="Designation"><input data-s="designation" list="desgDl" autocomplete="off" placeholder="Designation" value="' + esc(it.staff.designation) + '"></td>' +
        '<td class="uqc" data-l="Per">' + UI.select('', STAFF_BASIS, it.uqc, { attrs: ' data-k="uqc"' }) + '</td>' +
        n('qty', 'Worked', 'data-k="qty"', it.qty) + n('rate', 'Rate', 'data-k="rate"', it.rate) + n('ot', 'OT Hours', 'data-s="ot"', it.staff.ot) + n('otr', 'OT Rate / Hour', 'data-s="otRate"', it.staff.otRate) +
        '<td class="tax" data-l="Amount"><input class="num" data-k="taxable" value="' + indianNumber(it.taxable) + '" disabled></td>' +
        n('adv', 'Advance', 'data-s="advance"', it.staff.advance) +
        '<td class="del"><button class="delbtn" title="Remove row" data-del>🗑</button></td></tr>').join('');
      $$('tr', tb).forEach(tr => {
        const it = rows[+tr.dataset.i], set = (sel, v) => { const el = $(sel, tr); if (el) el.value = v; };
        $$('[data-k], [data-s]', tr).forEach(el => {
          if (el.dataset.k === 'taxable') return;
          const h = () => {
            if (el.dataset.s) it.staff[el.dataset.s] = el.value.trim(); else it[el.dataset.k] = el.dataset.k === 'desc' ? el.value : el.value.trim();
            if (el.dataset.k === 'desc') {
              // A name billed before, or an employee under HR, fills in what is still empty on the row
              const k = known.get(el.value.trim().toLowerCase());
              if (k) {
                if (!it.staff.empId && k.empId) { it.staff.empId = k.empId; set('[data-s=empId]', k.empId); }
                if (!it.staff.designation && k.designation) { it.staff.designation = k.designation; set('[data-s=designation]', k.designation); }
                if (!num(it.rate) && num(k.rate) > 0) { it.rate = k.rate; set('[data-k=rate]', k.rate); if (k.uqc) { it.uqc = k.uqc; set('[data-k=uqc]', k.uqc); } if (!num(it.staff.otRate) && num(k.otRate) > 0) { it.staff.otRate = k.otRate; set('[data-s=otRate]', k.otRate); } }
              }
            }
            this.updateTotals();
            set('[data-k=taxable]', indianNumber(it.taxable));
          };
          el.addEventListener('input', h); el.addEventListener('change', h);
        });
        $('[data-del]', tr).onclick = () => { const left = rows.filter(x => x !== it); inv.items = left.length ? left : [blankStaff(1, inv.staff)]; this.renderRows(); };
      });
      this.updateTotals();
      this.applyLock();
    },
    // + From Manpower / Employees: the members of the Manpower roster (manpower.js) and the employees under HR, ticked,
    // become rows with their code, designation and, from the roster, the bill rate. The members deployed at the
    // buyer of the invoice come first, ticked already.
    pickStaff() {
      const inv = this.inv, on = new Set(staffRows(inv).map(it => String(it.desc).trim().toLowerCase()).filter(Boolean)), low = (v) => String(v || '').trim().toLowerCase();
      const buyerName = String(inv.buyer.name || '').split('\n')[0].trim(), buyer = low(buyerName), members = roster(), named = new Set(members.map(r => r.name.toLowerCase()));
      const hr = (global.HR && HR.employees ? HR.employees() : []).filter(e => String(e.name || '').trim() && !named.has(low(e.name)));
      const everyone = members.map(r => ({ id: 'm:' + r.id, name: r.name, code: r.empId, designation: r.designation, extra: r.status === 'deployed' ? [r.client, r.site].filter(Boolean).join(', ') : r.status === 'leave' ? 'On leave' : 'Available', here: !!buyer && r.status === 'deployed' && low(r.client) === buyer }))
        .concat(hr.map(e => ({ id: 'e:' + e.id, name: String(e.name).trim(), code: e.code || '', designation: e.designation || '', extra: e.department || '', here: false })));
      const emps = everyone.filter(e => !on.has(e.name.toLowerCase())).sort((x, y) => (y.here ? 1 : 0) - (x.here ? 1 : 0));
      const title = 'Add staff from ' + (members.length ? 'Manpower' : 'Employees');
      if (!emps.length) { UI.modal({ title, body: '<p>' + (everyone.length ? 'Everybody on the roster is already on this invoice.' : 'There is nobody on the Manpower roster (Manpower &gt; Members) or under HR &gt; Employees yet. Add them there to pick them here, or type the names on the sheet: a name billed once is remembered with its employee ID, designation and rate.') + '</p>', buttons: [{ label: 'Close', cls: 'outline' }] }); return; }
      const bg = UI.modal({ title, focus: false,
        body: '<div class="qbar"><input id="spFind" placeholder="Search name, code, designation, client or site"><label class="check" style="white-space:nowrap"><input type="checkbox" id="spAll"> All</label></div>' +
          (emps.some(e => e.here) ? '<div class="hint">The members deployed at ' + esc(buyerName) + ' are ticked.</div>' : '') +
          '<div id="spList" style="max-height:52vh;overflow:auto">' + emps.map(e => '<label class="check" data-f="' + esc([e.name, e.code, e.designation, e.extra].join(' ').toLowerCase()) + '" style="border-bottom:1px dashed var(--border)"><input type="checkbox" value="' + esc(e.id) + '"' + (e.here ? ' checked' : '') + '> <span><b>' + esc(e.name) + '</b><span class="muted"> ' + esc([e.code, e.designation, e.extra].filter(Boolean).join(' · ')) + '</span></span></label>').join('') + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Add to invoice', cls: 'green', onClick: (bg) => {
          const ids = new Set($$('#spList input:checked', bg).map(x => x.value)), known = staffKnown();
          if (!ids.size) { UI.toast('Tick the people to add'); return false; }
          const rows = staffRows(inv).filter(it => String(it.desc).trim() || num(it.qty) || num(it.rate));
          emps.filter(e => ids.has(String(e.id))).forEach(e => { const k = known.get(e.name.toLowerCase()) || {}, it = blankStaff(0, inv.staff); it.desc = e.name; it.staff.empId = e.code || k.empId || ''; it.staff.designation = e.designation || k.designation || ''; if (num(k.rate) > 0) { it.rate = k.rate; it.uqc = k.uqc || 'DAY'; it.staff.otRate = k.otRate || ''; } rows.push(it); });
          inv.items = rows; this.renderRows(); UI.toast(ids.size + ' staff added. Enter the days or hours worked' + (rows.every(it => num(it.rate) > 0) ? '.' : ' and the rate.'), 3500, 'ok');
        } }] });
      const shown = () => $$('#spList label', bg).filter(l => l.style.display !== 'none');
      $('#spFind', bg).addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); $$('#spList label', bg).forEach(l => { l.style.display = !q || l.dataset.f.includes(q) ? '' : 'none'; }); });
      $('#spAll', bg).addEventListener('change', e => shown().forEach(l => { $('input', l).checked = e.target.checked; }));
    },
    renderRows() {
      if (this.inv.staff && this.inv.kind !== 'challan') return this.renderStaffRows();
      const inv = this.inv, gst = chargesGst();
      inv.items.forEach(computeItem); // rows added by the quick picker show their amounts straight away
      const tb = $('#rows');
      tb.innerHTML = inv.items.map((it, i) => '<tr data-i="' + i + '"><td class="sl" data-l="Sl"><input class="num" value="' + (i + 1) + '" disabled></td>' +
        '<td class="desc" data-l="Particulars"><div class="descwrap"><input data-k="desc" list="itemsDl" placeholder="Item Name" value="' + esc(it.desc) + '"><button class="subbtn" title="Product sub-details" data-sub>+</button></div>' + (it.subSerial || it.subDesc || it.subInfo ? '<div class="subline">' + esc([it.subSerial && 'S/N: ' + it.subSerial, it.subDesc, it.subInfo && 'Info: ' + it.subInfo].filter(Boolean).join(' · ')) + '</div>' : '') + '</td>' +
        '<td class="hsn" data-l="HSN/SAC"><input class="num" data-k="hsn" value="' + esc(it.hsn) + '"></td>' +
        (gst ? '<td class="gst" data-l="GST %">' + UI.select('', U.GST_RATES.map(r => [r, r + '%']), it.gst, { attrs: ' data-k="gst"' }) + '</td><td class="inc" data-l="Inc. GST?"><input type="checkbox" data-k="inc"' + (it.inc ? ' checked' : '') + '></td>' : '') +
        '<td class="qty" data-l="Qty"><input class="num" type="number" step="any" min="0" data-k="qty" value="' + esc(it.qty) + '"></td>' +
        '<td class="uqc" data-l="UQC">' + UI.select('', U.UQC_CODES, it.uqc, { attrs: ' data-k="uqc"' }) + '</td>' +
        '<td class="rate" data-l="Rate"><input class="num" type="number" step="any" min="0" data-k="rate" value="' + esc(it.rate) + '"' + (it.inc ? ' disabled' : '') + '></td>' +
        '<td class="tax" data-l="' + (gst ? 'Taxable' : 'Amount') + '"><input class="num" data-k="taxable" value="' + indianNumber(it.taxable) + '" disabled></td>' +
        (gst ? '<td class="tot" data-l="Total Incl."><input class="num" type="number" step="any" min="0" data-k="totalIncl" value="' + esc(it.inc ? it.totalIncl : num(it.totalIncl).toFixed(2)) + '"' + (it.inc ? '' : ' disabled') + '></td>' : '') +
        '<td class="del"><button class="delbtn" title="Remove row" data-del>🗑</button></td></tr>').join('');
      $$('tr', tb).forEach(tr => {
        const i = +tr.dataset.i, it = inv.items[i];
        $$('[data-k]', tr).forEach(el => {
          const k = el.dataset.k;
          const h = () => {
            if (k === 'inc') { it.inc = el.checked; $('[data-k=rate]', tr).disabled = it.inc; const t = $('[data-k=totalIncl]', tr); if (t) t.disabled = !it.inc; }
            else it[k] = el.value;
            if (k === 'desc') {
              // A saved item fills HSN, GST and price; otherwise a well-known item name fills the HSN
              const m = itemFromLabel(el.value);
              if (m) { it.desc = m.name; if (el.value !== m.name) el.value = m.name; it.hsn = m.hsn || ''; if (m.gst) it.gst = m.gst; if (num(m.rate) > 0 && !num(it.rate)) it.rate = exclRate(m.rate, it.gst); const g = $('[data-k=gst]', tr); if (g) g.value = it.gst; $('[data-k=rate]', tr).value = it.rate; }
              else { const hsn = U.hsnFor(el.value); if (hsn) it.hsn = hsn; }
              $('[data-k=hsn]', tr).value = it.hsn;
            }
            computeItem(it);
            $('[data-k=taxable]', tr).value = indianNumber(it.taxable);
            if (!it.inc) { const t = $('[data-k=totalIncl]', tr); if (t) t.value = it.totalIncl.toFixed(2); } else $('[data-k=rate]', tr).value = it.rate;
            this.updateTotals();
          };
          el.addEventListener('input', h); el.addEventListener('change', h);
        });
        $('[data-sub]', tr).onclick = () => this.subDetails(i);
        $('[data-del]', tr).onclick = () => { if (inv.items.length <= 1) return; inv.items.splice(i, 1); inv.items.forEach((x, n) => x.sl = n + 1); this.renderRows(); };
      });
      this.updateTotals();
      this.applyLock();
    },
    updateTotals() {
      const t = computeTotals(this.inv), gst = chargesGst(), rcm = this.inv.rcm && rcmAllowed(), sfx = rcm ? ' (RCM, payable by buyer)' : '';
      const row = (k, v, cls) => '<div class="k ' + (cls || '') + '">' + k + '</div><div class="v ' + (cls || '') + '">' + v + '</div>';
      // A staff invoice shows what the value is made of, and what is left to pay after the advances
      const staff = this.inv.staff && this.inv.kind !== 'challan', adv = U.staffAdvance(this.inv);
      const parts = staff ? (() => { const rows = staffRows(this.inv).filter(it => String(it.desc).trim()), auto = this.inv.items.filter(it => it.auto); return auto.length ? row('Wages (' + rows.length + ' staff)', money(rows.reduce((s, it) => s + it.taxable, 0))) + auto.map(it => row(esc(it.desc), money(it.taxable))).join('') : ''; })() : '';
      $('#totals').innerHTML = parts + row(gst ? 'Taxable Value' : 'Total Value', money(t.taxable)) + (gst ? (t.intra ? row('CGST Amount' + sfx, money(t.cgst)) + row('SGST Amount' + sfx, money(t.sgst)) : row('IGST Amount' + sfx, money(t.igst))) : '') + row('Grand Total', money(t.grand), 'grand') + row('Rounded Total', money(t.rounded), 'grand') + (adv > 0 ? row('Less: Advances', '− ' + money(adv)) + row('Net Payable', money(U.round2(t.rounded - adv)), 'grand') : '') +
        (Currency.of(this.inv) && this.inv.kind !== 'challan' ? row('Total in ' + Currency.of(this.inv).code + ' (' + esc(Currency.rateText(Currency.of(this.inv))) + ')', esc(Currency.invText(this.inv, U.round2(t.rounded - adv))), 'grand') : '');
      $('#words').textContent = 'Amount in Words: ' + t.words;
      const ih = $('#ihTotal'); if (ih) ih.textContent = money(U.round2(t.rounded - adv));
    },
    subDetails(i) {
      const it = this.inv.items[i];
      UI.modal({ title: 'Product Sub-Details - Item #' + (i + 1), body: UI.field('Serial No.', UI.input('sS', it.subSerial, { placeholder: 'Serial No. (e.g. SN12345)' })) + UI.field('Description / Details', UI.input('sD', it.subDesc, { placeholder: 'Product Description / Details' })) + UI.field('Other Info', UI.input('sI', it.subInfo, { placeholder: 'Other Product Info / Warranty' })),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Clear', cls: 'outline', onClick: () => { it.subSerial = it.subDesc = it.subInfo = ''; this.renderRows(); } },
          { label: 'Save', cls: 'green', onClick: (bg) => { it.subSerial = UI.val('sS', bg).trim(); it.subDesc = UI.val('sD', bg).trim(); it.subInfo = UI.val('sI', bg).trim(); this.renderRows(); UI.toast('Sub-details saved for Item #' + (i + 1)); } }] });
    },
    // Quantities chosen in the quick picker become invoice rows; an item taken back to zero leaves the invoice
    applyQuick(menu, quiet) {
      const inv = this.inv;
      inv.items = inv.items.filter(x => String(x.desc).trim() || num(x.qty) || num(x.rate) || num(x.totalIncl));
      menu.forEach(q => {
        const at = inv.items.findIndex(x => String(x.desc).trim().toLowerCase() === q.name.toLowerCase());
        if (q.qty > 0) {
          if (at >= 0) Object.assign(inv.items[at], { qty: q.qty, rate: exclRate(q.rate, q.gst), gst: q.gst, inc: false });
          else inv.items.push(Object.assign(blankItem(0), { desc: q.name, hsn: q.hsn || '', gst: q.gst, qty: q.qty, rate: exclRate(q.rate, q.gst) }));
        } else if (at >= 0) inv.items.splice(at, 1);
      });
      if (!inv.items.length) inv.items.push(blankItem(1));
      inv.items.forEach((x, n) => x.sl = n + 1);
      this.renderRows(); if (!quiet) UI.toast('Invoice updated with selected items!');
    },
    validate() {
      const inv = this.inv;
      // Completely blank rows are dropped; any row with an item needs both quantity and rate
      const staff = inv.kind !== 'challan' && inv.staff ? inv.staff : null;
      inv.items = inv.items.filter(it => String(it.desc).trim() || num(it.qty) || num(it.rate) || num(it.totalIncl));
      if (!inv.items.some(it => !it.auto)) inv.items = [staff ? blankStaff(1, staff) : blankItem(1)];
      inv.items.forEach((x, n) => x.sl = n + 1);
      this.renderRows();
      const bad = (msg, id) => { UI.toast(msg); if (id) UI.mark(id, true); return false; };
      const challan = inv.kind === 'challan';
      if (!inv.no.trim()) { inv.no = challan ? nextChallanNo() : nextInvoiceNo(); $('#iNo').value = inv.no; }
      if (!inv.date) return bad((challan ? 'Challan' : 'Invoice') + ' date is required', 'iDate');
      if (U.booksDateError(inv.date)) { UI.toast(U.booksDateError(inv.date), 6000); UI.mark('iDate', true); return false; }
      const buyerName = inv.buyer.name.trim();
      if (challan && !buyerName) return bad('The party the goods go to is required on a delivery challan', 'bName');
      if ((inv.payment === 'Credit' || inv.payment === 'Cheque') && !buyerName) return bad('Buyer details are mandatory for Credit sales', 'bName');
      if (!U.isValidPhone(inv.buyer.phone)) return bad('Enter correct buyer phone number', 'bPhone');
      if (!U.isValidEmail(inv.buyer.email)) return bad('Enter correct buyer email address', 'bEmail');
      if (!inv.sameShip) { if (!U.isValidPhone(inv.consignee.phone)) return bad('Enter correct Ship To phone number', 'cPhone'); if (!U.isValidEmail(inv.consignee.email)) return bad('Enter correct Ship To email address', 'cEmail'); }
      if (!U.isValidGstin(inv.buyer.gstin)) return bad('Enter a valid buyer GSTIN (15 characters, e.g. 37ABCDE1234F1ZZ)', 'bGstin');
      if (!inv.sameShip && !U.isValidGstin(inv.consignee.gstin)) return bad('Enter a valid Ship To GSTIN (15 characters, e.g. 37ABCDE1234F1ZZ)', 'cGstin');
      if (staff) {
        if (staff.from && staff.to && U.dateMs(staff.to) < U.dateMs(staff.from)) return bad('The billing period ends before it begins', 'sTo');
        if (!/^\d{4,8}$/.test(String(staff.sac || '').trim())) return bad('Enter the SAC of the service (for example 998519)', 'sSac');
        const rows = staffRows(inv);
        for (const it of rows) {
          const who = String(it.desc).trim();
          if (!who) return bad(rows.length === 1 && !num(it.qty) && !num(it.rate) ? 'Add at least one person to the staff sheet' : 'The name is required on staff row #' + it.sl);
          if (num(it.qty) <= 0) return bad('Enter the ' + U.staffUnit(it.uqc) + ' worked by ' + who);
          if (num(it.rate) <= 0) return bad('Enter the rate for ' + who);
          if (num(it.staff.ot) > 0 && num(it.staff.otRate) <= 0) return bad('Enter the OT rate for ' + who);
          if (num(it.staff.advance) < 0) return bad('The advance of ' + who + ' cannot be negative');
        }
        computeTotals(inv);
        if (U.staffAdvance(inv) > inv.totals.rounded + 0.005) return bad('The advances (' + money(U.staffAdvance(inv)) + ') are more than the invoice total (' + money(inv.totals.rounded) + ')');
      }
      for (const it of inv.items) {
        if (!String(it.desc).trim()) return bad(inv.items.length === 1 && !num(it.qty) && !num(it.rate) ? 'Please add at least one item' : 'Item Particulars is required for row #' + it.sl);
        if (num(it.qty) <= 0) return bad('Quantity is required for item #' + it.sl);
        if (!challan && num(it.rate) <= 0) return bad('Rate is required for item #' + it.sl);
      }
      computeTotals(inv);
      return true;
    },
    save() {
      const inv = this.inv;
      if (inv.kind === 'challan') return this.saveChallan();
      // Invoice pack: a new invoice needs an invoice left in the pack; a saved one is saved again without using another
      if (!Sub.isTimeActive() && !(inv.id || Store.list('invoices').some(x => x.kind === 'invoice' && x.no === inv.no)) && !packAllows()) return null;
      inv.rcm = !!inv.rcm && rcmAllowed();
      // The terms printed are the company's as they stand when the invoice is saved
      inv.terms = inv.termsOn ? Store.company().terms || '' : ''; inv.termsOn = !!inv.termsOn && !!inv.terms;
      if (inv.sameShip) inv.consignee = JSON.parse(JSON.stringify(inv.buyer));
      const ex = Store.list('invoices').find(x => x.kind === 'invoice' && x.no === inv.no && x.id !== inv.id);
      // A number taken by an invoice this login does not see (a sales person and somebody else's customer) is not used again
      if (!ex && Store.all('invoices').some(x => x.kind === 'invoice' && x.no === inv.no && x.id !== inv.id)) { UI.toast('Invoice number ' + inv.no + ' is already in use. The next free number is ' + nextInvoiceNo() + '.', 6000); UI.mark('iNo', true); return null; }
      if (ex) inv.id = ex.id;
      inv.kind = 'invoice';
      const fresh = !inv.id, from = inv.fromChallan; delete inv.fromChallan; delete inv.duplicateOf;
      const saved = inv.id ? Store.update('invoices', inv) : Store.add('invoices', inv);
      inv.id = saved.id;
      if (fresh) Sub.useInvoice();
      if (from) { const dc = Store.find('challans', from); if (dc) { dc.invoiceNo = inv.no; Store.update('challans', dc); } }
      absorb(inv);
      removeDraft('invoice', inv.no);
      if (inv.hotelStay && global.Hotel) Hotel.invoiced(inv);
      return inv;
    },
    // A delivery challan uses no invoice of a pack; it needs a running subscription or pack like everything else
    saveChallan() {
      const inv = this.inv;
      if (!Sub.isActive()) { UI.toast('Your subscription has ended. Renew to continue.', 6000); Subscription.dialog(false); return null; }
      if (inv.sameShip) inv.consignee = JSON.parse(JSON.stringify(inv.buyer));
      const ex = Store.list('challans').find(x => x.no === inv.no && x.id !== inv.id);
      if (!ex && Store.all('challans').some(x => x.no === inv.no && x.id !== inv.id)) { UI.toast('Challan number ' + inv.no + ' is already in use. The next free number is ' + nextChallanNo() + '.', 6000); UI.mark('iNo', true); return null; }
      if (ex) inv.id = ex.id;
      inv.kind = 'challan'; inv.invoiceNo = inv.invoiceNo || '';
      const saved = inv.id ? Store.update('challans', inv) : Store.add('challans', inv);
      inv.id = saved.id;
      absorb(inv);
      removeDraft('challan', inv.no);
      return inv;
    },
    // Receipt for a saved invoice. Money still due on a credit invoice is recorded as a receipt first (Receipts &
    // Payments), and the receipt comes out as a voucher to print or save as a PDF; an invoice paid at the time of
    // sale, or a credit invoice already settled, gets its receipt printed straight away.
    receipt(inv, then) {
      const c = Store.company(), party = (inv.buyer.name || '').split('\n')[0].trim() || 'Cash sale';
      const total = num(inv.totals.rounded) || num(inv.totals.grand), bal = invoiceBalance(inv.no);
      if (inv.payment === 'Credit' && bal && bal.balance > 0.005 && global.Money) { Money.edit('receipt', { party: bal.party, ref: inv.no, amount: bal.balance }, then); return; }
      const got = Store.list('journal').filter(j => j.vtype === 'receipt' && String(j.ref || '').trim() === inv.no).sort((a, b) => U.dateMs(a.date) - U.dateMs(b.date) || num(a.createdAt) - num(b.createdAt));
      // Paid at the time of sale: the invoice itself is the record, the receipt shows it
      const v = inv.payment !== 'Credit' ? { vtype: 'receipt', no: 'RCT-' + inv.no, date: inv.date, party, mode: inv.payment, ref: inv.no, bankRef: '', narration: 'Received at the time of sale',
        lines: [{ account: inv.payment === 'Cash' ? 'Cash' : 'Bank', side: 'Dr', amount: total }, { account: party, side: 'Cr', amount: total }] } : got[got.length - 1];
      if (!v) { UI.toast('No receipt is recorded against invoice ' + inv.no + ' yet'); return; }
      Print.show(Print.voucher(v, c));
    },
    // Save only: the invoice is kept, nothing is printed, and the editor moves on to the next invoice number
    saveOnly() {
      if (!this.validate()) return;
      const inv = this.save(); if (!inv) return;
      const challan = inv.kind === 'challan';
      Invoice.open(challan ? { kind: 'challan' } : {});
      UI.toast((challan ? 'Delivery challan ' : 'Invoice ') + inv.no + ' saved. Next ' + (challan ? 'challan' : 'invoice') + ': ' + this.inv.no, 3500);
    },
    // Print / PDF: saves, then prints with the layout and paper chosen under Print Settings (A4 unless changed)
    print(kind) {
      if (!this.validate()) return;
      const c = Store.company(), isDoc = this.inv.kind === 'challan', challan = kind === 'challan' || isDoc, layout = Invoice.layoutOf(c), paper = Invoice.paperOf(c, layout);
      const go = () => {
        if (isDoc) {
          // A locked (saved, unchanged) challan is printed as it is
          const dc = this.locked && this.inv.id ? this.inv : this.save(); if (!dc) return;
          $('#iDel').disabled = false;
          Print.open(dc, c, 0, paper);
          UI.modal({ title: 'Delivery Challan ' + dc.no + ' Saved', body: '<p>The print dialog is open: choose "Save as PDF" or a printer.</p><p>Choose an action:</p>', buttons: [
            { label: 'Stay Here', cls: 'outline' }, { label: 'Next Challan', onClick: () => Invoice.open({ kind: 'challan' }) }, { label: 'Print again', cls: 'outline', onClick: () => { Print.open(dc, c, 0, paper); return false; } },
            dc.invoiceNo ? null : { label: 'Make Invoice', cls: 'green', onClick: () => Invoice.open({ fromChallan: dc.id }) }].filter(Boolean) });
          return;
        }
        if (challan) { Print.open(Object.assign(JSON.parse(JSON.stringify(this.inv)), { kind: 'challan', consignee: this.inv.sameShip ? this.inv.buyer : this.inv.consignee }), c, 0, paper); return; }
        // A saved invoice that is still locked is printed as it is, not saved again
        const inv = this.inv.id && this.locked ? this.inv : this.save(); if (!inv) return;
        $('#iDel').disabled = false;
        Print.open(inv, c, layout, paper);
        UI.modal({ title: 'Invoice ' + inv.no + ' Saved', body: '<p>The print dialog is open: choose "Save as PDF" or a printer.</p><p>Choose an action:</p>', buttons: [
          { label: 'Stay Here', cls: 'outline' }, { label: 'Next Invoice', onClick: () => Invoice.open({}) }, { label: 'Print again', cls: 'green', onClick: () => { Print.open(inv, c, layout, paper); return false; } }] });
      };
      const amount = this.inv.totals.rounded, special = ['Maharashtra', 'Delhi', 'Tamil Nadu', 'Bihar'].some(s => sellerStateName().startsWith(s));
      const threshold = special ? 100000 : 50000;
      if (amount > threshold) UI.modal({ title: 'E-Way Bill Warning', body: '<p>Invoice value is ' + money(amount) + '.</p><p>For ' + esc(sellerStateName()) + ', the configured warning threshold is ' + money(threshold) + '. Please generate/verify the E-Way Bill before proceeding.</p>', buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Continue', cls: 'green', onClick: go }] });
      else go();
    },
    // The two layouts shown as they will print, with the one in use marked; also paper size and envelopes
    // The layout a company prints with: a restaurant starts on the thermal receipt until Print Settings says otherwise
    layoutOf(c) { return c.pdfLayoutSet ? (+c.pdfLayout || 0) : isRestaurant() ? 2 : (+c.pdfLayout || 0); },
    paperOf(c, layout) { const p = Print.PAPERS[c.paper]; return +layout === 2 ? (p && p.roll ? c.paper : 'T80') : (p && !p.envelope && !p.roll ? c.paper : 'A4'); },
    printSettings() {
      const c = Store.company(), inv = this.inv;
      computeTotals(inv);
      const sample = Object.assign(JSON.parse(JSON.stringify(inv)), { consignee: inv.sameShip ? inv.buyer : inv.consignee });
      if (!sample.items.some(it => String(it.desc).trim())) sample.items = [Object.assign(blankItem(1), { desc: 'Sample item', hsn: '9999', qty: 1, rate: 100 })];
      if (!sample.buyer.name.trim()) sample.buyer.name = 'Buyer name\nAddress';
      computeTotals(sample);
      const current = Invoice.layoutOf(c);
      const bg = UI.modal({ title: 'Print Settings', wide: true, focus: false,
        body: '<div class="hint">Tap the layout you want to print with. It is used for every invoice until changed.</div><div class="previews">' +
          [0, 1, 2].map(l => '<label class="pv' + (l === current ? ' on' : '') + '"><span class="frame" data-w="' + (l === 2 ? 302 : 794) + '"><iframe sandbox="allow-scripts" title="Layout ' + (l + 1) + '" srcdoc="' + esc(Print.html(sample, c, l, l === 2 ? 'T80' : 'A4')) + '"></iframe></span><span class="pvname">' + esc(Print.LAYOUTS[l].split('  ')[0]) + '</span><span class="pick"><input type="radio" name="pvLayout" value="' + l + '"' + (l === current ? ' checked' : '') + '> ' + (l === current ? 'In use' : 'Use this layout') + '</span></label>').join('') + '</div>' +
          '<div class="grid2 keep2">' + UI.field('Paper size', UI.select('pvPaper', Print.SHEETS.concat(Print.ROLLS).map(p => [p, Print.PAPERS[p].label]), Invoice.paperOf(c, current))) +
          '<div class="field"><label>Envelope (addresses only)</label><div class="btnrow" style="margin:0">' + Object.keys(Print.PAPERS).filter(k => Print.PAPERS[k].envelope).map(k => '<button class="btn sm outline" data-env="' + k + '">' + esc(Print.PAPERS[k].label.split('  ')[0]) + '</button>').join('') + '</div></div></div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const picked = $('input[name=pvLayout]:checked', bg);
          // The layout and paper are this device's choice, not part of the profile only an admin may change
          Store.set('company', Object.assign(Store.company(), { pdfLayout: picked ? +picked.value : current, pdfLayoutSet: true, paper: UI.val('pvPaper', bg) }), !Companies.mayWrite('company'));
          UI.toast('Print settings saved');
        } }] });
      // Each preview is a full A4 page scaled to the width it gets
      const fit = () => $$('.pv .frame', bg).forEach(f => { const w = +f.dataset.w || 794, fr = $('iframe', f); fr.style.width = w + 'px'; fr.style.transform = 'scale(' + (f.clientWidth / w) + ')'; });
      setTimeout(fit, 0); window.addEventListener('resize', fit);
      $$('input[name=pvLayout]', bg).forEach(r => r.addEventListener('change', () => {
        $$('.pv', bg).forEach(p => { const on = $('input', p).checked; p.classList.toggle('on', on); $('.pick', p).lastChild.textContent = ' ' + (on ? 'In use' : 'Use this layout'); });
        // The thermal receipt prints on a roll, the others on a sheet
        const l = +$('input[name=pvLayout]:checked', bg).value, sel = $('#pvPaper', bg), roll = Print.PAPERS[sel.value] && Print.PAPERS[sel.value].roll;
        if (l === 2 && !roll) sel.value = 'T80'; if (l !== 2 && roll) sel.value = 'A4';
      }));
      $$('[data-env]', bg).forEach(b => b.onclick = () => { if (!inv.buyer.name.trim()) { UI.toast('Enter the buyer name & address first'); return; } Print.show(Print.envelope(inv, Store.company(), b.dataset.env)); });
    }
  };
  App.routes.invoice = (p) => Invoice.open(p);

  // ------------------------------------------------------------ sales register
  // Every saved invoice, newest first: open it on the invoice screen, print it again, or delete it
  App.routes.sales = function () {
    const invs = invoices(), due = new Map(outstanding().all.map(r => [r.no, r]));
    // Credit invoices show what is still due on them (receipts mapped to the invoice bring it down)
    const dueCell = (i) => { const r = due.get(i.no); if (!r) return '-'; return r.balance > 0.005 ? '<span class="pill bad">' + money(r.balance) + ' due</span> <span class="small muted">' + r.days + ' d</span>' : '<span class="pill ok">Settled</span>'; };
    // Everything about an invoice that a search may hit: number, date, buyer (every line), phone, email, GSTIN,
    // state, payment mode, total and the item names
    const hay = (i) => [i.no, i.date, i.buyer.name, i.buyer.phone, i.buyer.email, i.buyer.gstin, i.buyer.state, i.payment, String(num(i.totals.rounded) || num(i.totals.grand)), money(num(i.totals.rounded) || num(i.totals.grand))].concat(i.items.map(x => x.desc)).join(' ').toLowerCase();
    const lite = Sub.isLite();
    // The credit notes against each invoice, shown under its number
    const cnBy = new Map(); Store.list('notes').forEach(n => { if (n.kind === 'CN' && n.ref) cnBy.set(n.ref, (cnBy.get(n.ref) || []).concat([n])); });
    const cnCell = (i) => (cnBy.get(i.no) || []).map(n => '<div class="small"><span class="pill warn" title="Credit note' + (n.reason ? ': ' + esc(n.reason) : '') + '">' + U.noLink(n.no) + ' ' + money(n.total) + '</span></div>').join('');
    const root = App.view(App.header('Sales', '<div class="btnrow" style="margin:0"><button class="btn sm green" id="sNew">+ New Invoice</button><button class="btn sm outline" id="sPO">Upload PO</button><button class="btn sm outline" id="sDC">Delivery Challans</button><button class="btn sm outline" id="sCN">Credit Notes</button>' + (lite ? '' : '<button class="btn sm outline" id="sRct">Receipts</button><button class="btn sm outline" id="sOut">Outstanding</button>') + '<button class="btn sm outline" id="sRep">Report</button></div>') +
      (invs.length ? '<div class="btnrow"><input id="sSearch" class="search" placeholder="Search by invoice no, party, phone, GSTIN, item, amount..." autocomplete="off"><span class="hint" id="sCount"></span></div>' : '') +
      '<div class="tablewrap">' + (invs.length ? '<table class="list cards"><thead><tr><th>Invoice</th><th>Date</th><th>Buyer</th><th>Phone</th><th class="num">Total</th><th>Mode</th><th>Due</th><th></th></tr></thead><tbody>' +
        invs.map(i => '<tr data-s="' + esc(hay(i)) + '"><td data-l="Invoice"><b>' + U.noLink(i.no) + '</b>' + cnCell(i) + '</td><td data-l="Date">' + esc(i.date) + '</td><td data-l="Buyer">' + esc(U.titleCase((i.buyer.name || '').split('\n')[0]) || '(cash sale)') + '</td><td data-l="Phone">' + esc(i.buyer.phone || '-') + '</td><td class="num" data-l="Total">' + money(num(i.totals.rounded) || num(i.totals.grand)) + '</td><td data-l="Mode"><span class="pill ' + (i.payment === 'Credit' ? 'warn' : '') + '">' + esc(i.payment) + '</span>' + (i.rcm ? ' <span class="pill">RCM</span>' : '') + '</td><td data-l="Due">' + dueCell(i) + '</td>' +
          '<td class="actions"><button class="btn sm" data-print="' + esc(i.id) + '">Print</button><button class="btn sm outline" data-mail="' + esc(i.id) + '" title="Email this invoice to the buyer">Email</button><button class="btn sm outline" data-dup="' + esc(i.id) + '" title="A new invoice with the same buyer and items">Duplicate</button><button class="btn sm outline" data-dc="' + esc(i.id) + '" title="Print a delivery challan for this invoice">Challan</button><button class="btn sm outline" data-rct="' + esc(i.id) + '" title="' + (i.payment === 'Credit' ? 'Record the money received against this invoice and print the receipt' : 'Print the receipt for this invoice') + '">Receipt</button><button class="btn sm outline" data-cn="' + esc(i.id) + '" title="Issue a credit note against this invoice: price adjustment, quantity issue, goods returned ...">Credit Note</button>' + (lite ? '' : '<button class="btn sm red" data-del="' + esc(i.id) + '">Delete</button>') + '</td></tr>').join('') + '</tbody></table><div class="empty hidden" id="sNone">No invoice matches the search.</div>' : '<div class="empty">No invoices saved yet. Tap "+ New Invoice" to make the first one, or "Upload PO" to make invoices from purchase orders.</div>') + '</div>');
    App.wireBack(root);
    if ($('#sSearch')) {
      // Every word typed has to appear somewhere in the invoice
      const filter = () => {
        const words = $('#sSearch').value.toLowerCase().split(/\s+/).filter(Boolean); let shown = 0;
        $$('tbody tr', root).forEach(tr => { const hit = words.every(w => tr.dataset.s.includes(w)); tr.classList.toggle('hidden', !hit); if (hit) shown++; });
        $('#sNone').classList.toggle('hidden', shown > 0); $('#sCount').textContent = words.length ? shown + ' of ' + invs.length + ' invoices' : invs.length + ' invoices';
      };
      $('#sSearch').addEventListener('input', filter); filter();
    }
    $('#sNew').onclick = () => App.go('invoice'); $('#sCN').onclick = () => App.go('notes', { kind: 'CN' }); $('#sRep').onclick = () => App.go('salesReport');
    $('#sPO').onclick = () => PurchaseOrders.dialog(); $('#sDC').onclick = () => App.go('challans');
    if (!lite) { $('#sRct').onclick = () => App.go('money', { kind: 'receipt' }); $('#sOut').onclick = () => App.go('aging'); }
    $$('[data-open]', root).forEach(b => b.onclick = () => App.go('invoice', { id: b.dataset.open }));
    $$('[data-print]', root).forEach(b => b.onclick = () => App.go('invoice', { id: b.dataset.print, print: true }));
    $$('[data-mail]', root).forEach(b => b.onclick = () => { const i = Store.find('invoices', b.dataset.mail); Mail.dialog(Mail.invoice(i, Store.company()), { title: 'Email invoice ' + i.no }); });
    $$('[data-dc]', root).forEach(b => b.onclick = () => App.go('invoice', { id: b.dataset.dc, print: 'challan' }));
    $$('[data-dup]', root).forEach(b => b.onclick = () => App.go('invoice', { duplicate: b.dataset.dup }));
    $$('[data-rct]', root).forEach(b => b.onclick = () => Invoice.receipt(Store.find('invoices', b.dataset.rct), () => App.go('sales')));
    $$('[data-cn]', root).forEach(b => b.onclick = () => Notes.forInvoice(Store.find('invoices', b.dataset.cn), () => App.go('sales')));
    $$('[data-del]', root).forEach(b => b.onclick = () => deleteInvoice(Store.find('invoices', b.dataset.del), () => App.go('sales')));
  };

  // ------------------------------------------------------------ delivery challans
  // Goods sent out before (or without) an invoice: numbered DC-0001 onwards, printed as a challan, and turned
  // into a sales invoice with one tap. The invoice carries the challan number under Delivery Note.
  App.routes.challans = function () {
    const list = challans();
    const qty = (d) => U.fmtQty(d.items.reduce((s, i) => s + num(i.qty), 0));
    const hay = (d) => [d.no, d.date, d.buyer.name, d.buyer.phone, d.buyer.gstin, d.invoiceNo].concat(d.items.map(x => x.desc)).join(' ').toLowerCase();
    const root = App.view(App.header('Delivery Challans', '<div class="btnrow" style="margin:0"><button class="btn sm green" id="dNew">+ New Challan</button><button class="btn sm outline" id="dSales">Sales</button></div>') +
      (list.length ? '<div class="btnrow"><input id="dSearch" class="search" placeholder="Search by challan no, party, item, invoice no..." autocomplete="off"><span class="hint" id="dCount"></span></div>' : '') +
      '<div class="tablewrap">' + (list.length ? '<table class="list cards"><thead><tr><th>Challan</th><th>Date</th><th>Party</th><th>Phone</th><th class="num">Qty</th><th class="num">Items</th><th>Status</th><th></th></tr></thead><tbody>' +
        list.map(d => '<tr data-s="' + esc(hay(d)) + '"><td data-l="Challan"><b>' + U.noLink(d.no) + '</b></td><td data-l="Date">' + esc(d.date) + '</td><td data-l="Party">' + esc(U.titleCase((d.buyer.name || '').split('\n')[0])) + '</td><td data-l="Phone">' + esc(d.buyer.phone || '-') + '</td><td class="num" data-l="Qty">' + qty(d) + '</td><td class="num" data-l="Items">' + d.items.length + '</td>' +
          '<td data-l="Status">' + (d.invoiceNo ? '<span class="pill ok">Invoice ' + U.noLink(d.invoiceNo) + '</span>' : '<span class="pill warn">Open</span>') + '</td>' +
          '<td class="actions"><button class="btn sm" data-print="' + esc(d.id) + '">Print</button>' + (d.invoiceNo ? '<button class="btn sm outline" data-inv="' + esc(d.invoiceNo) + '">View Invoice</button>' : '<button class="btn sm green" data-conv="' + esc(d.id) + '">Make Invoice</button>') + '<button class="btn sm red" data-del="' + esc(d.id) + '">Delete</button></td></tr>').join('') +
        '</tbody></table><div class="empty hidden" id="dNone">No challan matches the search.</div>' : '<div class="empty">No delivery challans yet. Tap "+ New Challan" to send goods out before the invoice, or print a challan for any saved invoice from Sales.</div>') + '</div>');
    App.wireBack(root);
    if ($('#dSearch')) {
      const filter = () => {
        const words = $('#dSearch').value.toLowerCase().split(/\s+/).filter(Boolean); let shown = 0;
        $$('tbody tr', root).forEach(tr => { const hit = words.every(w => tr.dataset.s.includes(w)); tr.classList.toggle('hidden', !hit); if (hit) shown++; });
        $('#dNone').classList.toggle('hidden', shown > 0); $('#dCount').textContent = words.length ? shown + ' of ' + list.length + ' challans' : list.length + ' challans';
      };
      $('#dSearch').addEventListener('input', filter); filter();
    }
    $('#dNew').onclick = () => App.go('invoice', { kind: 'challan' }); $('#dSales').onclick = () => App.go('sales');
    $$('[data-open]', root).forEach(b => b.onclick = () => App.go('invoice', { challan: b.dataset.open }));
    $$('[data-print]', root).forEach(b => b.onclick = () => App.go('invoice', { challan: b.dataset.print, print: 'challan' }));
    $$('[data-conv]', root).forEach(b => b.onclick = () => App.go('invoice', { fromChallan: b.dataset.conv }));
    $$('[data-inv]', root).forEach(b => b.onclick = () => { const inv = invoices().find(i => i.no === b.dataset.inv); if (inv) App.go('invoice', { id: inv.id }); else UI.toast('Invoice ' + b.dataset.inv + ' is not on this device'); });
    $$('[data-del]', root).forEach(b => b.onclick = () => deleteChallan(Store.find('challans', b.dataset.del), () => App.go('challans')));
  };

  // ------------------------------------------------------------ purchase orders -> sales invoices
  // A CSV / Excel file in the BlitzBook template, one row per line of a purchase order, with the PO number on
  // every row (a blank PO number continues the row above). Each PO becomes one invoice: a PO number already on an
  // invoice updates that invoice, the rest are inserted. Customers and items are upserted into the masters.
  const PO_TEMPLATE = 'PO Number,PO Date,Customer,GSTIN,Phone,Email,Address,State,Item,HSN,Qty,UQC,Rate,GST%\n' +
    'PO-1001,02/10/2026,Ramesh Traders,37ABCDE1234F1ZZ,9876543210,ramesh@gmail.com,100 Feet Road Vijayawada,Andhra Pradesh,Steel Pipe 2 inch,7306,10,NOS,450,18\n' +
    'PO-1001,,,,,,,,Welding Rods,8311,5,BOX,320,18\n' +
    'PO-1002,02/10/2026,Suresh Enterprises,36XYZAB5678G2ZY,9123456789,suresh@gmail.com,MG Road Hyderabad,Telangana,Office Chair,9401,4,NOS,3200,18\n';
  // dd/mm/yyyy from what a sheet may hold (U.sheetDate: an Excel serial, an ISO date, or d/m/y with any separator)
  const poDate = (v) => U.sheetDate(v);
  // The purchase orders in the uploaded rows: [{no, date, customer, gstin, phone, email, address, state, items: [{desc, hsn, qty, uqc, rate, gst}]}]
  function parsePurchaseOrders(rows) {
    const head = rows.length ? rows[0].map(c => String(c == null ? '' : c).trim().toLowerCase().replace(/[^a-z]/g, '')) : [];
    const at = {};
    ['customer', 'gstin', 'phone', 'email', 'address', 'state', 'item', 'hsn', 'qty', 'uqc', 'rate'].forEach(n => { at[n] = head.findIndex(h => h.startsWith(n)); });
    at.ponumber = head.findIndex(h => h.startsWith('ponum') || h.startsWith('pono') || h === 'po');
    at.podate = head.findIndex(h => h.startsWith('podat'));
    at.gst = head.findIndex(h => h.startsWith('gst') && !h.startsWith('gstin'));
    if (at.ponumber < 0 || at.item < 0 || at.qty < 0) throw new Error('The first row must carry the template headings: PO Number, PO Date, Customer, GSTIN, Phone, Email, Address, State, Item, HSN, Qty, UQC, Rate, GST%. Download the template from Upload PO.');
    const pos = [], byNo = new Map(); let cur = null;
    rows.slice(1).forEach(r => {
      const g = (n) => at[n] >= 0 && r[at[n]] != null ? String(r[at[n]]).trim() : '';
      const no = g('ponumber');
      if (no) { cur = byNo.get(no.toLowerCase()); if (!cur) { cur = { no, date: '', customer: '', gstin: '', phone: '', email: '', address: '', state: '', items: [] }; byNo.set(no.toLowerCase(), cur); pos.push(cur); } }
      if (!cur) return;
      [['date', 'podate'], ['customer', 'customer'], ['gstin', 'gstin'], ['phone', 'phone'], ['email', 'email'], ['address', 'address'], ['state', 'state']].forEach(([k, col]) => { const v = g(col); if (v && !cur[k]) cur[k] = v; });
      const item = g('item'); if (!item) return;
      cur.items.push({ desc: item, hsn: g('hsn'), qty: num(g('qty')), uqc: g('uqc').toUpperCase(), rate: g('rate'), gst: g('gst').replace('%', '').trim() });
    });
    return pos;
  }
  // What each purchase order will do: a new invoice, an update of the invoice that already carries the PO number
  // (upsert) or, with insert only, nothing for those; skipped rows carry the reason. The invoice is built here so
  // the preview can show its total.
  function planPurchaseOrders(pos, mode) {
    const contacts = Store.list('contacts'), existing = invoices();
    return pos.map(po => {
      const p = { po, action: 'new', reason: '', inv: null, contact: null };
      const skip = (reason) => Object.assign(p, { action: 'skip', reason });
      const gstin = po.gstin.toUpperCase();
      if (gstin && !U.isValidGstin(gstin)) return skip('Invalid GSTIN ' + gstin);
      const items = po.items.filter(it => it.desc && it.qty > 0);
      if (!items.length) return skip('No item with a quantity');
      const ct = (gstin && contacts.find(c => String(c.gstin || '').toUpperCase() === gstin)) || (po.customer && contacts.find(c => c.name.toLowerCase() === po.customer.toLowerCase())) || null;
      const name = po.customer || (ct && ct.name) || '';
      if (!name) return skip('No customer name');
      const address = po.address || (ct && ct.address) || '', phone = po.phone || (ct && ct.phone) || '', email = (po.email || (ct && ct.email) || '').toLowerCase();
      const state = U.matchState(po.state, gstin) || (ct && U.matchState(ct.state, ct.gstin)) || U.stateByCode(sellerStateCode()) || U.STATES[0];
      const buyer = { name: name + (address ? '\n' + address : ''), phone: U.isValidPhone(phone) ? phone : '', email: U.isValidEmail(email) ? email : '', gstin: gstin || (ct && ct.gstin) || '', state };
      const ex = existing.find(i => String((i.other || {}).orderNo || '').trim().toLowerCase() === po.no.toLowerCase());
      const inv = ex ? JSON.parse(JSON.stringify(ex)) : newInvoice();
      if (!ex) { inv.payment = 'Credit'; inv.dueDate = dueDateFor(inv); }
      inv.buyer = buyer; inv.sameShip = true; inv.consignee = JSON.parse(JSON.stringify(buyer));
      inv.other.orderNo = po.no; inv.other.orderDate = poDate(po.date) || inv.other.orderDate;
      inv.items = items.map((it, n) => {
        const m = findMaster(it.desc), gst = it.gst !== '' ? String(num(it.gst)) : (m && m.gst) || '18';
        const rate = num(it.rate) > 0 ? num(it.rate) : m && num(m.rate) > 0 ? exclRate(m.rate, gst) : 0;
        return Object.assign(blankItem(n + 1), { desc: m ? m.name : it.desc, hsn: it.hsn || (m && m.hsn) || U.hsnFor(it.desc) || '', gst, qty: it.qty, uqc: U.UQC_CODES.includes(it.uqc) ? it.uqc : 'NOS', rate });
      });
      const noRate = inv.items.find(it => num(it.rate) <= 0);
      if (noRate) return skip('No rate for "' + noRate.desc + '" and no price in the item master');
      computeTotals(inv);
      p.inv = inv; p.contact = { name, address, phone: buyer.phone, email: buyer.email, gstin: buyer.gstin, state };
      if (ex) { p.action = 'update'; if (mode === 'insert') skip('Already on invoice ' + ex.no + ' (insert only)'); }
      return p;
    });
  }
  function applyPurchaseOrders(plan) {
    let created = 0, updated = 0, skipped = 0;
    const contacts = Store.list('contacts'); let touched = false;
    plan.forEach(p => {
      if (p.action === 'new' && !Sub.isTimeActive() && !Sub.canAddInvoice()) { p.action = 'skip'; p.reason = 'Invoice pack used up'; }
      if (p.action === 'skip') { skipped++; return; }
      const inv = p.inv;
      if (p.action === 'new') { inv.no = nextInvoiceNo(); inv.id = null; Store.add('invoices', inv); Sub.useInvoice(); created++; }
      else { Store.update('invoices', inv); updated++; }
      // The customer: a known one takes the PO's details, a new one is added
      const c = p.contact;
      const ct = (c.gstin && contacts.find(x => String(x.gstin || '').toUpperCase() === c.gstin)) || contacts.find(x => x.name.toLowerCase() === c.name.toLowerCase());
      if (ct) Object.assign(ct, { address: c.address || ct.address, phone: c.phone || ct.phone, email: c.email || ct.email, gstin: c.gstin || ct.gstin, state: c.state, updatedAt: Date.now() });
      else contacts.push({ id: U.uid(), createdAt: Date.now(), type: 'Customer', name: c.name, address: c.address.toUpperCase(), phone: c.phone, email: c.email, gstin: c.gstin, state: c.state, tds: false, tdsSection: '', tdsRate: 0 });
      touched = true;
      inv.items.forEach(it => { const name = String(it.desc).trim(); if (findMaster(name)) upsertMaster(name, { hsn: String(it.hsn).trim(), gst: String(it.gst), hidden: false }); else upsertMaster(name, { hsn: String(it.hsn).trim(), gst: String(it.gst), rate: inclPrice(it.rate, it.gst) }); });
    });
    if (touched) Store.saveList('contacts', contacts);
    return { created, updated, skipped };
  }
  const PurchaseOrders = {
    template() { UI.download('BlitzBook_PurchaseOrders_Template.csv', PO_TEMPLATE, 'text/csv'); UI.toast('Template downloaded'); },
    dialog() {
      UI.modal({ title: 'Upload Purchase Orders', body: '<p>Upload a CSV or Excel file of customer purchase orders in the BlitzBook template and every purchase order becomes a sales invoice.</p>' +
        '<ul class="hint"><li>One row per item, with the <b>PO Number</b> on each row (a blank PO Number continues the row above).</li><li><b>Rate</b> is the unit price before GST; left blank, the item master price is used.</li><li>With <b>Upsert</b> a PO number already on an invoice <b>updates</b> that invoice and the others are <b>inserted</b> as new Credit invoices; with <b>Insert only</b> those POs are skipped. The choice is made on the preview.</li><li>New customers and items join the masters; known ones are updated.</li></ul>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Download template', cls: 'outline', onClick: () => { PurchaseOrders.template(); return false; } }, { label: 'Choose file', cls: 'green', onClick: () => PurchaseOrders.upload() }] });
    },
    upload() {
      UI.pickSheet((rows) => {
        let pos; try { pos = parsePurchaseOrders(rows); } catch (e) { UI.alert('Upload Purchase Orders', e.message); return; }
        if (!pos.length) { UI.alert('Upload Purchase Orders', 'No purchase orders found: every row needs a PO Number, an Item and a Qty.'); return; }
        let plan = planPurchaseOrders(pos, Store.get('upload_mode', 'upsert'));
        const label = (p) => p.action === 'new' ? '<span class="pill ok">New invoice</span>' : p.action === 'update' ? '<span class="pill warn">Update ' + esc(p.inv.no) + '</span>' : '<span class="pill bad">Skip</span><div class="small muted">' + esc(p.reason) + '</div>';
        const todo = () => plan.filter(p => p.action !== 'skip').length;
        const table = () => '<table class="list"><thead><tr><th>PO</th><th>Customer</th><th class="num">Items</th><th class="num">Total</th><th>Action</th></tr></thead><tbody>' +
          plan.map(p => '<tr><td>' + esc(p.po.no) + (p.po.date ? '<div class="small muted">' + esc(poDate(p.po.date)) + '</div>' : '') + '</td><td>' + esc(p.contact ? p.contact.name : p.po.customer || '-') + '</td><td class="num">' + p.po.items.length + '</td><td class="num">' + (p.inv ? money(p.inv.totals.rounded) : '-') + '</td><td>' + label(p) + '</td></tr>').join('') + '</tbody></table>';
        const goLabel = () => { const n = todo(); return n ? (n === 1 ? 'Create / update 1 invoice' : 'Create / update ' + n + ' invoices') : 'Nothing to do'; };
        const bg = UI.modal({ title: 'Upload Purchase Orders', wide: true, focus: false, body: '<p>' + plan.length + ' purchase order' + (plan.length === 1 ? '' : 's') + ' in the file.</p>' + UI.modeField('Purchase orders') + '<div class="tablewrap" id="poPlan">' + table() + '</div>',
          buttons: [{ label: 'Cancel', cls: 'outline' }, { label: goLabel(), cls: 'green', onClick: () => {
            if (!todo()) return false;
            const r = applyPurchaseOrders(plan);
            UI.importResult('Purchase orders uploaded', { inserted: r.created, updated: r.updated, skipped: r.skipped, note: r.created + ' new invoice' + (r.created === 1 ? '' : 's') + ' inserted, ' + r.updated + ' existing invoice' + (r.updated === 1 ? '' : 's') + ' updated.', lines: plan.filter(p => p.action === 'skip').map(p => p.po.no + ': ' + p.reason) }, () => App.go('sales'));
          } }] });
        // Switching between upsert and insert only redraws the plan
        $$('input[name=impMode]', bg).forEach(r => r.addEventListener('change', () => { plan = planPurchaseOrders(pos, UI.modeOf(bg)); $('#poPlan', bg).innerHTML = table(); $$('.mf .btn', bg)[1].textContent = goLabel(); }));
      });
    }
  };
  global.PurchaseOrders = PurchaseOrders;

  // ------------------------------------------------------------ credit / debit notes
  function noteTotals(n) {
    const rate = chargesGst() ? num(n.rate) : 0, taxable = num(n.taxable), gst = taxable * rate / 100, inter = isInter(n.partyGstin);
    n.gst = U.round2(gst); n.cgst = inter ? 0 : U.round2(gst / 2); n.sgst = inter ? 0 : U.round2(gst / 2); n.igst = inter ? U.round2(gst) : 0; n.total = U.round2(taxable + gst);
    return n;
  }
  const Notes = {
    open(p) {
      const kind = p.kind || 'CN', isCN = kind === 'CN', label = isCN ? 'Credit Notes' : 'Debit Notes';
      const notes = Store.list('notes').filter(n => n.kind === kind).sort((a, b) => String(b.no).localeCompare(String(a.no), undefined, { numeric: true }));
      const root = App.view(App.header(label, '<button class="btn sm green" id="nNew">+ New ' + (isCN ? 'Credit' : 'Debit') + ' Note</button>') +
        
        '<div class="tablewrap">' + (notes.length ? '<table class="list cards"><thead><tr><th>Note</th><th>Date</th><th>Party</th><th>Reason</th><th>Against</th><th class="num">Taxable</th><th class="num">GST</th><th class="num">Total</th><th>Settlement</th><th></th></tr></thead><tbody>' +
          notes.map(n => '<tr><td data-l="Note"><b>' + U.noLink(n.no) + '</b></td><td data-l="Date">' + esc(n.date) + '</td><td data-l="Party">' + esc(n.party || '-') + '</td><td data-l="Reason">' + esc(n.reason || '-') + '</td><td data-l="Against">' + (U.noLink(n.ref) || '-') + '</td><td class="num" data-l="Taxable">' + money(n.taxable) + '</td><td class="num" data-l="GST">' + money(n.gst) + '</td><td class="num" data-l="Total">' + money(n.total) + '</td><td data-l="Settlement">' + esc(n.settle) + '</td>' +
            '<td class="actions"><button class="btn sm" data-p="' + esc(n.id) + '">Print</button>' + (Sub.isLite() ? '' : '<button class="btn sm red" data-d="' + esc(n.id) + '">Delete</button>') + '</td></tr>').join('') + '</tbody></table>' : '<div class="empty">No ' + label.toLowerCase() + ' yet.</div>') + '</div>');
      App.wireBack(root);
      $('#nNew').onclick = () => Notes.edit(kind, null);
      $$('[data-p]', root).forEach(b => b.onclick = () => Print.show(Print.note(Store.find('notes', b.dataset.p), Store.company())));
      $$('[data-e]', root).forEach(b => b.onclick = () => Notes.edit(kind, Store.find('notes', b.dataset.e)));
      $$('[data-d]', root).forEach(b => b.onclick = () => { const n = Store.find('notes', b.dataset.d); UI.confirm('Delete ' + (isCN ? 'Credit Note' : 'Debit Note'), 'Delete ' + n.no + '?', () => { Store.delete('notes', n.id); Notes.open({ kind }); }, 'Delete'); });
    },
    /* A credit note for one invoice, from the invoice itself or its line on the Sales list: the invoice, the customer,
       the GSTIN and the GST rate are filled in, and what can still be credited is shown. */
    forInvoice(inv, onDone) {
      if (!inv || !inv.id || inv.kind === 'challan') return;
      const cap = noteCap('CN', inv.no);
      if (cap <= 0.005) { UI.alert('Credit Note', 'Invoice ' + inv.no + ' is already credited in full by ' + creditNotesFor(inv.no).join(', ') + '.'); return; }
      Notes.edit('CN', null, { invoice: inv, onDone });
    },
    edit(kind, n, opts) {
      const isCN = kind === 'CN', from = (opts && opts.invoice) || null, onDone = (opts && opts.onDone) || null;
      if (!n) { let max = 0; Store.all('notes').forEach(x => { const m = new RegExp('^' + kind + '-(\\d+)$').exec(x.no || ''); if (m) max = Math.max(max, +m[1]); }); n = { kind, no: kind + '-' + String(max + 1).padStart(4, '0'), date: U.today(), party: '', partyGstin: '', ref: '', reason: '', taxable: '', rate: '0', settle: 'Credit' }; if (from) Object.assign(n, { ref: from.no, party: Books.partyName(from.buyer && from.buyer.name), partyGstin: (from.buyer && from.buyer.gstin) || '', rate: invoiceRate(from), settle: from.payment === 'Credit' ? 'Credit' : n.settle }); }
      const why = splitReason(kind, n.reason), reasons = NOTE_REASONS[kind];
      // What can still be credited on the invoice a credit note is against
      const openOn = (ref) => { const c = noteCap(kind, ref, n.id), inv = isCN ? invoices().find(i => i.no === String(ref || '').trim()) : null; return c < 0 ? '' : (inv ? 'Invoice ' + inv.no + ' of ' + inv.date + ', taxable value ' + money(inv.totals.taxable) + '. ' : '') + 'Still open for a ' + (isCN ? 'credit' : 'debit') + ' note: ' + money(c) + ' (before GST)'; };
      // Reference document numbers come from the sales or purchase register
      const parties = contactsOf(isCN ? null : 'Supplier'), refs = isCN ? invoices().map(i => i.no) : Store.list('purchases').filter(x => x.kind !== 'QTN' && x.kind !== 'STK').map(x => x.no);
      const bg = UI.modal({ title: (n.id ? 'Edit ' : 'New ') + (isCN ? 'Credit Note' : 'Debit Note') + (from ? ' for invoice ' + from.no : ''), body: '<div class="grid2">' +
        UI.field('Note No', UI.input('nNo', n.no)) + UI.field('Date', UI.dateInput('nDate', n.date), { req: true }) +
        UI.field(isCN ? 'Customer' : 'Supplier', UI.input('nParty', n.party, { list: 'nPartyDl' }) + UI.datalist('nPartyDl', parties.map(x => x.name)), { req: true, span: true }) +
        UI.field(isCN ? 'Against Invoice' : 'Against Purchase', UI.input('nRef', n.ref, { list: 'nRefDl', placeholder: isCN ? 'Invoice No' : 'Purchase No' }) + UI.datalist('nRefDl', refs), { req: true, hint: isCN ? 'A credit note cannot exceed the invoice value' : 'A debit note cannot exceed the purchase value' }) +
        UI.field('Party GSTIN', UI.input('nGstin', n.partyGstin, { attrs: ' maxlength="15" style="text-transform:uppercase"' })) +
        '<div class="field span"><div class="hint" id="nOpen"></div></div>' +
        UI.field('Reason', UI.select('nWhy', reasons, why.cat, { blank: '— choose the reason —' }), { req: true }) + UI.field('Remarks', UI.input('nReason', why.remarks, { placeholder: isCN ? 'e.g. rate agreed at 450, 2 pcs short' : 'e.g. 3 bags short, damaged in transit' }), { hint: 'Printed with the reason on the note' }) +
        UI.field('Taxable Value', UI.input('nTax', n.taxable, { type: 'number', placeholder: '0.00', attrs: ' step="any" min="0"' }), { req: true }) + (chargesGst() ? UI.field('GST Rate %', UI.select('nRate', U.GST_RATES, n.rate)) : '') +
        UI.field('Settlement', UI.select('nSettle', ['Credit', 'Cash', 'Online', 'Cheque'], n.settle), { span: true, hint: isCN ? "Credit = adjust customer's account, else refunded" : "Credit = adjust supplier's account, else money received back" }) +
        '<div class="field span"><div id="nTotal" class="bold"></div></div></div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const v = (id) => UI.val(id, bg);
          Object.assign(n, { no: v('nNo').trim(), date: UI.dateVal('nDate', bg), party: (parties.find(x => x.name.toLowerCase() === v('nParty').trim().toLowerCase()) || { name: U.nameCase(v('nParty')) }).name, ref: v('nRef').trim(), partyGstin: v('nGstin').trim().toUpperCase(), reason: joinReason(v('nWhy'), v('nReason')), taxable: num(v('nTax')), rate: chargesGst() ? v('nRate') : '0', settle: v('nSettle') });
          if (!n.date) { UI.toast('Date is required'); return false; } if (U.booksDateError(n.date)) { UI.toast(U.booksDateError(n.date), 6000); return false; } if (!n.party) { UI.mark('nParty', true, bg); UI.toast('Party is required'); return false; }
          if (!v('nWhy')) { UI.mark('nWhy', true, bg); UI.toast('Choose the reason for the ' + (isCN ? 'credit' : 'debit') + ' note'); return false; } if (v('nWhy') === 'Other' && !v('nReason').trim()) { UI.mark('nReason', true, bg); UI.toast('Say in the remarks what the note is for'); return false; }
          if (n.taxable <= 0) { UI.mark('nTax', true, bg); UI.toast('Enter the taxable value'); return false; } if (!U.isValidGstin(n.partyGstin)) { UI.mark('nGstin', true, bg); UI.toast('Enter a valid party GSTIN (15 characters, e.g. 37ABCDE1234F1ZZ)'); return false; }
          const cap = noteCap(kind, n.ref, n.id);
          if (cap < 0) { UI.mark('nRef', true, bg); UI.toast(isCN ? 'Choose the invoice this credit note is against' : 'Choose the purchase this debit note is against'); return false; }
          if (n.taxable > cap + 0.005) { UI.mark('nTax', true, bg); UI.toast('Cannot exceed the remaining value of ' + n.ref + ': ' + money(cap), 4000); return false; }
          if (!n.id && !packAllows()) return false;
          noteTotals(n); if (n.id) Store.update('notes', n); else { Store.add('notes', n); Sub.useInvoice(); } UI.toast((isCN ? 'Credit Note ' : 'Debit Note ') + n.no + ' saved' + (n.ref ? ' against ' + n.ref : '')); if (onDone) onDone(n); else Notes.open({ kind });
        } }] });
      const recalc = () => { const t = noteTotals({ taxable: UI.val('nTax', bg), rate: chargesGst() ? UI.val('nRate', bg) : 0, partyGstin: UI.val('nGstin', bg) }); $('#nTotal', bg).textContent = 'GST ' + money(t.gst) + '   Total ' + money(t.total); };
      ['nTax', 'nRate', 'nGstin'].forEach(id => { const el = $('#' + id, bg); if (el) { el.addEventListener('input', recalc); el.addEventListener('change', recalc); } });
      // The invoice chosen fills in its customer, GSTIN and GST rate (while they are blank) and shows what is open on it
      const refChanged = (fill) => { const ref = UI.val('nRef', bg).trim(); $('#nOpen', bg).textContent = openOn(ref); if (!fill || !isCN) return; const inv = invoices().find(i => i.no === ref); if (!inv) return; if (!UI.val('nParty', bg).trim()) $('#nParty', bg).value = Books.partyName(inv.buyer && inv.buyer.name); if (!UI.val('nGstin', bg).trim() && inv.buyer && inv.buyer.gstin) $('#nGstin', bg).value = inv.buyer.gstin; if ($('#nRate', bg) && !num(UI.val('nTax', bg))) $('#nRate', bg).value = invoiceRate(inv); recalc(); };
      $('#nRef', bg).addEventListener('change', () => refChanged(true)); $('#nRef', bg).addEventListener('input', () => refChanged(false));
      $('#nParty', bg).addEventListener('change', e => { const c = parties.find(x => x.name.toLowerCase() === e.target.value.trim().toLowerCase()); if (c && c.gstin) { $('#nGstin', bg).value = c.gstin; recalc(); } });
      recalc(); refChanged(false);
    }
  };
  App.routes.notes = (p) => Notes.open(p);
  // #open?no=<number>: the link every entry carries (https://blitzbook.co.in/open/#<number>) lands here when the
  // app is not at hand. An invoice or challan opens itself; anything else opens the list it is on.
  App.routes.open = function (p) {
    const no = String((p && p.no) || '').trim(), key = no.toLowerCase();
    const same = (x) => String(x || '').trim().toLowerCase() === key;
    if (!no) { App.go('dashboard'); return; }
    const inv = Store.list('invoices').find(i => same(i.no));
    if (inv) { App.go('invoice', { id: inv.id }); return; }
    const dc = Store.list('challans').find(d => same(d.no));
    if (dc) { App.go('invoice', { challan: dc.id }); return; }
    // The others live in a list: open the list, then the entry's editor over it
    const pur = Store.list('purchases').find(x => same(x.no));
    if (pur) { if (pur.kind === 'STK') { App.go('stock'); return; } App.go('purchases'); if (global.Ledger && Ledger.Purchases) Ledger.Purchases.edit(pur); return; }
    const note = Store.list('notes').find(n => same(n.no));
    if (note) { App.go('notes', { kind: note.kind }); Notes.edit(note.kind, note); return; }
    const j = Store.list('journal').find(x => same(x.no));
    if (j) {
      if (j.vtype === 'receipt' || j.vtype === 'payment') { App.go('money', { kind: j.vtype }); if (global.Money) Money.edit(j.vtype, j, () => App.go('money', { kind: j.vtype })); }
      else { App.go('journal'); if (global.Ledger && Ledger.Journal) Ledger.Journal.edit(j); }
      return;
    }
    const x = Store.list('expenses').find(e => same(e.no));
    if (x) { App.go('expenses'); if (global.Ledger && Ledger.Expenses) Ledger.Expenses.edit(x); return; }
    const ct = Store.list('contacts').find(c => same(c.no));
    if (ct) { const type = ct.type || 'Customer'; App.go('contacts', { type }); Ledger.Contacts.edit(ct, () => App.go('contacts', { type })); return; }
    const emp = Store.list('employees').find(e => same(e.code));
    if (emp && global.HR) { App.go('employees'); if (App.current && App.current.route === 'employees') HR.editEmployee(emp); return; }
    const mp = Store.list('manpower').find(m => same(m.code));
    if (mp && global.Manpower && Companies.mayOpen('manpower')) { App.go('manpower', { tab: 'members' }); if (App.current && App.current.route === 'manpower') Manpower.edit(mp, () => App.go('manpower', { tab: 'members' })); return; }
    const iv = Store.list('inventory').find(d => d.no && same(d.no));
    if (iv && global.Inv) { App.go('inventory', { tab: iv.kind === 'TRF' ? 'transfer' : iv.kind === 'CNT' ? 'count' : 'adjust' }); return; }
    const pr = Store.list('procure').find(d => same(d.no));
    if (pr && global.Procure) { App.go('procurement', { tab: pr.kind === 'REQ' ? 'req' : pr.kind === 'GRN' ? 'grn' : 'po' }); if (pr.kind !== 'GRN') Procure.edit(pr); return; }
    UI.toast('No entry numbered ' + no + ' in these books', 5000);
    App.go('dashboard');
  };

  global.Invoice = Invoice; global.Notes = Notes; global.Quick = Quick;
  global.Biz = { chargesGst, isComposition, sellerStateCode, sellerStateName, isInter, activity, isTransporter, contactsOf, computeTotals, noteTotals, invoices, noteCap, creditNotesFor, creditNotesOf, NOTE_REASONS, splitReason, joinReason, outstanding, invoiceBalance,
    findMaster, upsertMaster, hideMaster, categories, itemLabels, itemFromLabel, exclRate, isRestaurant, isStaffing, staffSync, staffPeriod };
})(window);
