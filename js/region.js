/* BlitzBook web portal - the country of a company's books (India, United Arab Emirates, United States, Australia).

   util.js (REGIONS) holds what a country decides: the name of the tax and how it is worked out, the tax number of a
   business, the currency, the states, the rates. This file does the rest:
     - the words. The screens were written for India (GST, GSTIN, HSN, IFSC, the rupee sign). For a company of
       another country they are put into that country's words as they are drawn: VAT and TRN in the UAE, Sales Tax and
       Tax ID in the US, GST and ABN in Australia, with the country's currency sign. Only what is shown changes, never
       what is kept; what a user types into a box is left alone. An Indian company sees every screen as before.
     - what is printed (Region.html, called by print.js) goes through the same words.
     - the tax return of a country other than India: a summary of the tax on sales and on purchases for a period,
       laid out the way that country's return asks for it (the boxes of the UAE's VAT 201, the labels of an
       Australian BAS, sales tax by state in the US). India keeps its GSTR-1 and GSTR-3B (gst.js). */
(function (global) {
  'use strict';
  const { esc, num } = U;
  const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ------------------------------------------------------------ the words of a country
  const PAY = {
    AE: [['Provident fund', 'Pension (GPSSA)'], ['UAN (PF)', 'Pension (GPSSA) No'], ['UAN', 'Pension No'], ['PF', 'Pension'], ['Income tax (TDS)', 'Tax'], ['TDS', 'Tax'], ['PAN', 'Emirates ID'], ['Aadhaar', 'Passport No']],
    US: [['Provident fund', 'Social Security'], ['UAN (PF)', 'Employee No'], ['UAN', 'Employee No'], ['PF', 'Soc. Sec.'], ['ESI number', 'Medicare No'], ['ESI No', 'Medicare No'], ['ESI', 'Medicare'], ['Income tax (TDS)', 'Income tax withheld'], ['TDS', 'Income tax'], ['PAN', 'SSN'], ['Aadhaar', 'ID No']],
    AU: [['Provident fund', 'Superannuation'], ['UAN (PF)', 'Super member No'], ['UAN', 'Super member No'], ['PF', 'Super'], ['Income tax (TDS)', 'PAYG withholding'], ['TDS', 'PAYG'], ['PAN', 'TFN'], ['Aadhaar', 'ID No']]
  };
  const built = {};
  function words(r) {
    if (r.code === 'IN') return null;
    if (built[r.code]) return built[r.code];
    const map = [
      ['(15 characters, e.g. 37ABCDE1234F1ZZ)', '(' + r.taxIdHint + ')'], ['15 characters, e.g. 37ABCDE1234F1ZZ', r.taxIdHint], ['(15 characters)', '(' + r.taxIdHint + ')'],
      [' (CGST + SGST + IGST)', ''], ['optional, decides IGST vs CGST/SGST', 'optional'],
      ['GSTIN/UIN', r.taxId], ['GSTIN Number', r.taxId], ['GSTIN No.', r.taxId + ' No.'], ['GSTIN', r.taxId], ['IGST', r.tax],
      ['HSN / SAC', r.itemCode], ['HSN/SAC', r.itemCode], ['HSN', r.itemCode],
      ['IFSC Code', r.bankCode], ['IFSC', r.bankCode],
      ['₹', r.symbol], ['Rupees', cap(r.coin)], ['rupees', r.coin], ['chartered accountant', r.adviser]
    ];
    if (r.tax !== 'GST') map.push(['GST', r.tax]);
    // Payroll (hr.js SCHEMES): the country's contributions where India has PF and ESI, its tax where India has TDS
    (PAY[r.code] || []).forEach(p => map.push(p));
    // The US has no reverse charge: sales tax a supplier did not charge is use tax, owed by the buyer
    if (r.code === 'US') [['Reverse charge (RCM) - GST payable by us, not to the supplier', 'Use tax - sales tax the supplier did not charge, payable by us'], ['Reverse charge (RCM) - GST payable by us, not to the vendor', 'Use tax - sales tax the vendor did not charge, payable by us'],
      ['GST payable under reverse charge', 'Use tax payable'], ['payable under reverse charge by', 'payable as use tax by'], ['RCM IGST (paid by us)', 'Use tax (paid by us)'], ['Reverse Charge:', 'Use Tax:'], [', reverse charge', ', use tax'], ['RCM', 'Use tax']].forEach(p => map.push(p));
    const by = new Map(map), edge = (t, at) => /\w/.test(at ? t[t.length - 1] : t[0]) ? '\\b' : '';
    const re = new RegExp(map.map(m => m[0]).sort((a, b) => b.length - a.length).map(t => edge(t, 0) + t.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + edge(t, 1)).join('|'), 'g');
    // A quick look before the real work: most text has none of these in it
    return (built[r.code] = { re, by, hint: /GST|HSN|IFSC|₹|upees|chartered|37ABCDE|15 characters|PF|ESI|TDS|PAN|UAN|Aadhaar|Provident|RCM|everse [Cc]harge/ });
  }
  const Region = {
    now() { return U.region(); },
    // A piece of text in the words of the open company's country
    text(s) { const w = words(U.region()); if (!w || !s || !w.hint.test(s)) return s; w.re.lastIndex = 0; return s.replace(w.re, m => w.by.get(m)); },
    // A whole document (what is printed): the text between its tags, the styles left alone
    html(src) {
      const w = words(U.region()); if (!w || !src) return src;
      return String(src).split(/(<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>)/i).map((part, i) => i % 2 ? part : part.replace(/>([^<]+)</g, (m, t) => '>' + this.text(t) + '<')).join('');
    },
    ATTRS: ['placeholder', 'title', 'data-l', 'aria-label'],
    // What was drawn, put into the country's words: text, the hints inside boxes, the headings of cards on a phone
    node(n) {
      // Left as written: what is inside a box, and anything marked data-asis (the terms, which name every country's tax)
      if (n.nodeType === 3) { const p = n.parentNode; if (p && (/^(TEXTAREA|SCRIPT|STYLE)$/.test(p.nodeName) || (p.closest && p.closest('[data-asis]')))) return; const t = this.text(n.nodeValue); if (t !== n.nodeValue) { if (p && p.nodeName === 'OPTION' && !p.hasAttribute('value')) p.setAttribute('value', n.nodeValue); n.nodeValue = t; } return; }
      if (n.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.nodeName)) { if (n.nodeType === 1 && n.nodeName === 'TEXTAREA') this.attrs(n); return; }
      if (n.closest('[data-asis]')) return;
      const walk = document.createTreeWalker(n, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (x) => x.nodeType === 1 && x.hasAttribute('data-asis') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      let x = n;
      while (x) { if (x.nodeType === 3) this.node(x); else this.attrs(x); x = walk.nextNode(); }
    },
    attrs(el) {
      this.ATTRS.forEach(a => { const v = el.getAttribute(a); if (v) { const t = this.text(v); if (t !== v) el.setAttribute(a, t); } });
      // A phone number is not ten digits everywhere
      if (el.nodeName === 'INPUT' && el.type === 'tel' && el.getAttribute('maxlength') === '10') el.setAttribute('maxlength', '17');
    },
    init() {
      new MutationObserver((list) => {
        if (!words(U.region())) return;
        list.forEach(m => { if (m.type === 'characterData') this.node(m.target); else m.addedNodes.forEach(n => this.node(n)); });
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    },
    // The country changed (Company Profile) or another company was opened: the screen is drawn again in its words
    redraw() { U.regionReset(); if (global.Currency) Currency.apply(); if (App.user && $('#view')) { App.refreshNav(); App.refresh(); App.refreshBar(); } }
  };
  if (document.body) Region.init(); else document.addEventListener('DOMContentLoaded', () => Region.init());

  // ------------------------------------------------------------ the tax return of a country other than India
  const MONTHS = U.MONTHS;
  const span = (a, b, label) => ({ from: a.getTime(), to: b.getTime(), label, key: U.dmy(a) + '-' + U.dmy(b) });
  // The months and quarters gone by and the financial years around today, newest first
  function periods() {
    const out = [], n = new Date(), fm = U.fyMonth() - 1;
    for (let i = 0; i < 18; i++) { const a = new Date(n.getFullYear(), n.getMonth() - i, 1); out.push(span(a, new Date(a.getFullYear(), a.getMonth() + 1, 0), MONTHS[a.getMonth()] + ' ' + a.getFullYear())); }
    // Quarters counted from the first month of the company's financial year
    const q0 = new Date(n.getFullYear(), n.getMonth() - ((n.getMonth() - fm + 12) % 3), 1);
    for (let i = 0; i < 8; i++) { const a = new Date(q0.getFullYear(), q0.getMonth() - 3 * i, 1), b = new Date(a.getFullYear(), a.getMonth() + 3, 0); out.push(span(a, b, 'Quarter ' + MONTHS[a.getMonth()].slice(0, 3) + ' - ' + MONTHS[b.getMonth()].slice(0, 3) + ' ' + b.getFullYear())); }
    const y = U.fyFirstYear();
    [y, y - 1].forEach(v => out.push(span(U.fyStartDate(v), U.fyEndDate(v), 'Financial year ' + U.fyLabel(v))));
    return out;
  }
  function figures(p) {
    const inRange = (d) => Books.inRange(d, p.from, p.to), add = (m, k, o) => { const e = m.get(k) || { taxable: 0, tax: 0, n: 0 }; e.taxable = r2(e.taxable + o.taxable); e.tax = r2(e.tax + o.tax); e.n += o.n || 0; m.set(k, e); };
    const byRate = new Map(), byState = new Map(), f = { rcmSales: 0, rcmTaxable: 0, rcmTax: 0, sales: 0, taxable: 0, zero: 0, out: 0, cnTaxable: 0, cnTax: 0, purTaxable: 0, purTax: 0, expTaxable: 0, expTax: 0, dnTaxable: 0, dnTax: 0, invoices: 0 };
    Biz.invoices().filter(i => inRange(i.date)).forEach(i => {
      const t = i.totals || {}, tax = r2(num(t.cgst) + num(t.sgst) + num(t.igst)), state = U.stateName(i.buyer && i.buyer.state) || 'Not stated';
      f.invoices++; f.sales = r2(f.sales + (num(t.rounded) || num(t.grand)));
      // Under reverse charge the recipient accounts for the tax: the sale is counted apart, with no tax of ours
      if (i.rcm) { f.rcmSales = r2(f.rcmSales + num(t.taxable)); add(byState, state, { taxable: num(t.taxable), tax: 0, n: 1 }); return; }
      (i.items || []).forEach(it => { const tx = r2(it.taxable), rt = Biz.chargesGst() ? num(it.gst) : 0; if (tx <= 0) return; const o = { taxable: tx, tax: r2(tx * rt / 100) }; add(byRate, String(rt), o); if (rt === 0) f.zero = r2(f.zero + tx); else f.taxable = r2(f.taxable + tx); });
      add(byState, state, { taxable: num(t.taxable), tax, n: 1 }); f.out = r2(f.out + tax);
    });
    const taxOf = (x) => r2(num(x.cgst) + num(x.sgst) + num(x.igst)) || r2(num(x.gst));
    Store.list('notes').filter(n => inRange(n.date)).forEach(n => { if (n.kind === 'CN') { f.cnTaxable = r2(f.cnTaxable + num(n.taxable)); f.cnTax = r2(f.cnTax + taxOf(n)); } else { f.dnTaxable = r2(f.dnTaxable + num(n.taxable)); f.dnTax = r2(f.dnTax + taxOf(n)); } });
    // A purchase or an expense under reverse charge (in the US: use tax): the tax is ours to pay, and counts as input tax like any other
    const rc = (x, taxable) => { if (x.rcm) { f.rcmTaxable = r2(f.rcmTaxable + taxable); f.rcmTax = r2(f.rcmTax + taxOf(x)); } };
    Store.list('purchases').filter(x => x.kind === 'PUR' && inRange(x.date)).forEach(x => { f.purTaxable = r2(f.purTaxable + num(x.taxable)); f.purTax = r2(f.purTax + taxOf(x)); rc(x, num(x.taxable)); });
    Store.list('expenses').filter(x => inRange(x.date)).forEach(x => { const tb = num(x.taxable) || num(x.amount); f.expTaxable = r2(f.expTaxable + tb); f.expTax = r2(f.expTax + taxOf(x)); rc(x, tb); });
    f.outNet = r2(f.out - f.cnTax + f.rcmTax); f.inNet = r2(f.purTax + f.expTax - f.dnTax); f.net = r2(f.outNet - f.inNet);
    f.byRate = Array.from(byRate.entries()).sort((a, b) => num(a[0]) - num(b[0])); f.byState = Array.from(byState.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return f;
  }
  // The lines of the return, in the order and under the names the country's own form uses: [label, amount, tax ('' when the line has none), bold]
  function lines(r, f) {
    const m = U.inr, standard = r2(f.taxable - f.cnTaxable), inputs = r2(f.purTaxable + f.expTaxable - f.dnTaxable), own = r2(f.outNet - f.rcmTax), rcSale = f.rcmSales > 0;
    if (r.code === 'AE') return [
      ['Box 1 - Standard rated supplies (after credit notes)', m(standard), m(own)],
      ['Box 3 - Supplies subject to the reverse charge provisions (purchases on which the VAT is ours to pay)', m(f.rcmTaxable), m(f.rcmTax)],
      ['Box 4 - Zero rated supplies', m(f.zero), '']]
      .concat(rcSale ? [['Sales under reverse charge (the VAT is accounted for by the recipient; not in the boxes above)', m(f.rcmSales), '']] : []).concat([
      ['Box 8 - Total sales and output VAT', m(r2(standard + f.rcmTaxable + f.zero)), m(f.outNet), true],
      ['Box 9 - Standard rated expenses (purchases and expenses, after debit notes)', m(r2(inputs - f.rcmTaxable)), m(r2(f.inNet - f.rcmTax))],
      ['Box 10 - Supplies subject to the reverse charge provisions', m(f.rcmTaxable), m(f.rcmTax)],
      ['Box 11 - Total expenses and recoverable VAT', m(inputs), m(f.inNet), true],
      ['Box 12 - Total VAT due for the period', '', m(f.outNet)], ['Box 13 - Total recoverable VAT for the period', '', m(f.inNet)],
      [f.net >= 0 ? 'Box 14 - VAT payable to the FTA' : 'Box 14 - VAT refundable', '', m(Math.abs(f.net)), true]]);
    if (r.code === 'AU') return [
      ['G1 - Total sales (including GST)', m(r2(f.sales - f.cnTaxable - f.cnTax)), ''], ['G3 - GST-free sales', m(f.zero), '']]
      .concat(rcSale ? [['Sales under reverse charge (the GST is paid by the recipient; in G1, no GST in 1A)', m(f.rcmSales), '']] : [])
      .concat(f.rcmTax > 0 ? [['GST on reverse-charged purchases (in 1A, and in 1B as far as it is creditable)', m(f.rcmTaxable), m(f.rcmTax)]] : []).concat([
      ['1A - GST on sales', '', m(f.outNet), true],
      ['G11 - Non-capital purchases (including GST)', m(r2(inputs + f.inNet)), ''],
      ['1B - GST on purchases', '', m(f.inNet), true],
      [f.net >= 0 ? 'Amount you owe the ATO (1A less 1B)' : 'Refund due from the ATO (1B less 1A)', '', m(Math.abs(f.net)), true]]);
    return [
      ['Gross sales (including sales tax)', m(r2(f.sales - f.cnTaxable - f.cnTax)), ''], ['Taxable sales (after credit notes)', m(standard), ''], ['Exempt and non-taxable sales', m(f.zero), ''],
      ['Sales tax collected', '', m(own), true],
      ['Use tax on purchases where the supplier charged no sales tax', m(f.rcmTaxable), m(f.rcmTax)],
      ['Sales tax paid to suppliers on purchases and expenses (a cost of the business, not a credit)', m(r2(inputs - f.rcmTaxable)), m(r2(f.inNet - f.rcmTax))],
      ['Sales and use tax to remit', '', m(Math.max(0, f.outNet)), true]];
  }
  const NOTES = {
    AE: 'Laid out like the VAT 201 return. Sales are shown by emirate below (boxes 1a to 1g). Purchases ticked as reverse charge go into boxes 3 and 10. Imports through customs, exempt supplies and adjustments are not worked out here: add them on the FTA portal (EmaraTax).',
    AU: 'Laid out like a Business Activity Statement on a non-cash (accruals) basis. Capital purchases (G10), PAYG and other BAS labels are not worked out here: add them when you lodge with the ATO.',
    US: 'Sales tax is set and filed state by state (and often by county and city). The table below gives the taxable sales and the tax collected for each state, which is what each state\'s return asks for. Tax paid on purchases is a cost, not a credit; a purchase ticked as use tax (the supplier charged none) is added to what is remitted.'
  };
  const TaxReturn = {
    screen(params) {
      const r = U.region(), all = periods(), p = all.find(x => x.key === params.period) || all[1] || all[0], f = figures(p), L = lines(r, f), co = Store.company();
      const picker = '<select id="trPeriod" style="min-height:36px">' + all.map(x => '<option value="' + esc(x.key) + '"' + (x.key === p.key ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('') + '</select>';
      const stateHead = r.stateWord, rateRows = f.byRate.map(e => [e[0] + '%', U.inr(e[1].taxable), U.inr(e[1].tax)]), stateRows = f.byState.map(e => [e[0], String(e[1].n), U.inr(e[1].taxable), U.inr(e[1].tax)]);
      const table = (id, heads, rows, empty) => rows.length ? '<div class="tablewrap"><table class="list" id="' + id + '"><thead><tr>' + heads.map((h, i) => '<th' + (i ? ' class="num"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map((c, i) => '<td' + (i ? ' class="num"' : ' class="left"') + '>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '<div class="empty">' + esc(empty) + '</div>';
      const root = App.view(App.header(r.returns, '<div class="btnrow" style="margin:0">' + picker + '<button class="btn sm green" id="trXls">Excel</button><button class="btn sm blue" id="trPdf">PDF</button></div>') +
        '<div class="hint" style="margin-bottom:10px">' + esc(r.name) + ' · ' + esc(r.tax) + (co.gstin ? ' · ' + esc(r.taxId) + ' ' + esc(co.gstin) : ' · no ' + esc(r.taxId) + ' in the Company Profile') + ' · ' + esc(p.label) + ' · ' + f.invoices + ' invoice' + (f.invoices === 1 ? '' : 's') + '. ' + esc(NOTES[r.code] || '') + '</div>' +
        (Biz.chargesGst() ? '' : '<div class="hint red" style="margin-bottom:10px">This company is marked as not registered for ' + esc(r.tax) + ' (Company Profile), so no tax is charged on its invoices.</div>') +
        '<div class="card white"><div class="hd">' + esc(r.tax) + ' summary</div><div class="bd"><div class="tablewrap"><table class="list stmt" id="trMain"><thead><tr><th>Line</th><th class="num">Amount</th><th class="num">' + esc(r.tax) + '</th></tr></thead><tbody>' +
          L.map(l => '<tr' + (l[3] ? ' class="total"' : '') + '><td class="left">' + esc(l[0]) + '</td><td class="num">' + esc(l[1]) + '</td><td class="num">' + esc(l[2]) + '</td></tr>').join('') + '</tbody></table></div></div></div>' +
        '<div class="card white"><div class="hd">Sales by ' + esc(r.tax) + ' rate</div><div class="bd">' + table('trRate', ['Rate', 'Taxable value', r.tax], rateRows, 'No sales in this period.') + '</div></div>' +
        '<div class="card white"><div class="hd">Sales by ' + esc(stateHead.toLowerCase()) + '</div><div class="bd">' + table('trState', [stateHead, 'Invoices', 'Taxable value', r.tax], stateRows, 'No sales in this period.') + '</div></div>' +
        '<div class="hint">These figures come from the invoices, notes, purchases and expenses entered in the books. They are a working paper, not a filed return: check them with your ' + esc(r.adviser) + ' before filing.</div>');
      App.wireBack(root);
      $('#trPeriod').onchange = (e) => App.go('gst', { period: e.target.value });
      const sheet = () => [['Line', 'Amount', r.tax]].concat(L.map(l => [l[0], l[1], l[2]])).concat([['', '', ''], ['Rate', 'Taxable value', r.tax]]).concat(rateRows).concat([['', '', ''], [stateHead, 'Taxable value', r.tax]]).concat(stateRows.map(x => [x[0], x[2], x[3]]));
      $('#trXls').onclick = () => { const s = sheet(); UI.xls(r.tax.replace(/\s+/g, '') + '_Return', s[0], s.slice(1)); };
      $('#trPdf').onclick = () => UI.pdf(r.returns + ' - ' + r.name, p.label + (co.gstin ? ' · ' + r.taxId + ' ' + co.gstin : ''), ['Line', 'Amount', r.tax], sheet().slice(1));
    }
  };
  // India keeps its own returns screen (gst.js); every other country gets the summary
  const india = App.routes.gst;
  App.routes.gst = (params) => U.isIndia() && india ? india(params) : TaxReturn.screen(params || {});

  global.Region = Region; global.TaxReturn = TaxReturn;
})(window);
