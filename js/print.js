/* BlitzBook web portal - printable documents. Two invoice layouts, matching the Android app's PDF output:
   0 = Standard (BlitzBook layout), 1 = Classic boxed (Tally style). Also delivery challan, envelopes, purchase
   records / quotations and credit / debit notes.
   Documents are rendered as HTML in a hidden iframe and sent to the browser's print dialog (Save as PDF). */
(function (global) {
  'use strict';
  const { esc, nl2br, money, indianNumber, fmtQty, pct, formatState, stateNameCode, titleCase, num, rupeesPaiseWords } = U;

  // w / h in mm: the sheet an invoice is laid out on page by page (see paged())
  const PAPERS = {
    A4: { label: 'A4  (210 x 297 mm)', css: 'A4 portrait', scale: 1, w: 210, h: 297 },
    A5: { label: 'A5  (148 x 210 mm)', css: 'A5 portrait', scale: 0.72, w: 148, h: 210 },
    Letter: { label: 'Letter  (8.5 x 11 in)', css: 'letter portrait', scale: 1, w: 215.9, h: 279.4 },
    Legal: { label: 'Legal  (8.5 x 14 in)', css: 'legal portrait', scale: 1, w: 215.9, h: 355.6 },
    // Envelopes print the addresses only
    EnvDL: { label: 'Envelope DL  (220 x 110 mm)', css: '220mm 110mm', envelope: true },
    EnvC5: { label: 'Envelope C5  (229 x 162 mm)', css: '229mm 162mm', envelope: true },
    Env10: { label: 'Envelope #10  (9.5 x 4.125 in)', css: '9.5in 4.125in', envelope: true }
  };
  const SHEETS = ['A4', 'A5', 'Letter', 'Legal'];
  const LAYOUTS = ['Standard  (BlitzBook layout)', 'Classic boxed  (Tally style)'];

  function docTitle(inv, company) {
    if (inv.kind === 'challan') return 'DELIVERY CHALLAN';
    if (inv.kind === 'quotation') return 'QUOTATION';
    if (company.gstType === 'Composition') return 'BILL OF SUPPLY';
    if (company.gstType !== 'Regular') return 'INVOICE';
    return 'TAX INVOICE';
  }
  function chargesGst(company) { return company.gstType === 'Regular'; }
  // A goods transport agency: its invoices carry consignment details instead of dispatch details
  function isTransporter(company) { return String(company.activity || '').toLowerCase().includes('transport'); }
  function subText(it) {
    const p = [];
    if (it.subSerial) p.push('S/N: ' + it.subSerial);
    if (it.subDesc) p.push(it.subDesc);
    if (it.subInfo) p.push('Info: ' + it.subInfo);
    return p.join(' ');
  }
  // The footer of every document links to the portal; the browser's PDF keeps the link
  const SITE = 'https://blitzbook.co.in';
  const POWERED = '<div class="pw"><a href="' + SITE + '">Powered by BlitzBook</a></div>';
  function partyLines(p) { return String(p.name || '').split('\n').concat(String(p.address || '').split('\n')).map(s => s.trim()).filter(Boolean); }
  // The terms & conditions block of an invoice that asked for them (one numbered line per term)
  function termsBlock(inv, cls) {
    if (inv.kind !== 'invoice' || !inv.termsOn || !String(inv.terms || '').trim()) return '';
    const lines = String(inv.terms).split('\n').map(s => s.trim()).filter(Boolean);
    return '<div class="' + cls + '"><div class="th">Terms &amp; Conditions</div><ol>' + lines.map(l => '<li>' + esc(l.replace(/^\d+[.)]\s*/, '')) + '</li>').join('') + '</ol></div>';
  }
  function dueDate(inv) { return inv.kind === 'invoice' && inv.dueDate ? inv.dueDate : ''; }

  // HSN-wise groups: key hsn|rate -> {hsn, rate, taxable}
  function hsnGroups(inv) {
    const g = new Map();
    inv.items.forEach(it => {
      const a = num(it.taxable); if (a <= 0) return;
      const k = (it.hsn || '') + '|' + it.gst;
      if (!g.has(k)) g.set(k, { hsn: it.hsn || '', rate: num(it.gst), taxable: 0 });
      g.get(k).taxable += a;
    });
    return Array.from(g.values());
  }
  function rateGroups(inv) {
    const g = new Map();
    inv.items.forEach(it => { const a = num(it.taxable); if (a <= 0) return; g.set(it.gst, (g.get(it.gst) || 0) + a); });
    return Array.from(g.entries()).sort((a, b) => num(a[0]) - num(b[0]));
  }

  // ------------------------------------------------------------ Standard layout
  function standard(inv, company) {
    const noGst = !chargesGst(company), intra = inv.totals.intra, t = inv.totals;
    const title = docTitle(inv, company);
    const gstLine = company.gstType === 'Composition' ? 'GSTIN: ' + esc(company.gstin) + '  (Composition Dealer)'
      : noGst ? 'GSTIN: Not Registered under GST' : 'GSTIN: ' + esc(company.gstin);
    const o = inv.other, gta = isTransporter(company);
    const other = (gta ? [
      ['LR No:', o.lrNo], ['LR Dt:', o.lrDate], ['From:', titleCase(o.origin)], ['To:', titleCase(o.destination)], ['Veh No:', (o.vehicleNo || '').toUpperCase()], ['Vehicle:', titleCase(o.vehicleType)], ['Goods:', o.goods],
      ['E-way/Ref:', o.reference], ['Challan:', o.deliveryNote], ['Ord No:', o.orderNo], ['Ord Dt:', o.orderDate], ['Info:', titleCase(o.info)]
    ] : [
      ['Dest:', titleCase(o.destination)], ['Veh No:', (o.vehicleNo || '').toUpperCase()], ['Trnsp:', titleCase(o.transporter)], ['LR No:', o.lrNo], ['From:', titleCase(o.origin)],
      ['Challan:', o.deliveryNote], ['Ord No:', o.orderNo], ['Ord Dt:', o.orderDate], ['Ref:', o.reference], ['Info:', titleCase(o.info)]
    ]).filter(x => x[1]);
    const party = (p) => {
      const l = partyLines(p);
      return '<div class="pname">' + esc((l[0] || '').toUpperCase()) + '</div>' + l.slice(1, 3).map(s => '<div>' + esc(s.toUpperCase()) + '</div>').join('') +
        '<div>State: ' + esc(formatState(p.state)) + '</div>' + (p.gstin ? '<div><b>GSTIN: ' + esc(p.gstin.toUpperCase()) + '</b></div>' : '') +
        (p.email ? '<div>Email: ' + esc(p.email.toLowerCase()) + '</div>' : '') + (p.phone ? '<div>Ph: ' + esc(p.phone) + '</div>' : '');
    };
    const cols = noGst ? ['Sl', 'PARTICULARS', 'HSN/SAC', 'Qty', 'Rate', 'Amount'] : ['Sl', 'PARTICULARS', 'HSN/SAC', 'GST RATE', 'Qty', 'Rate', 'Amount'];
    const rows = inv.items.map(it => '<tr><td class="c">' + it.sl + '</td><td>' + esc(titleCase(it.desc)) + (subText(it) ? '<div class="sub">' + esc(subText(it)) + '</div>' : '') + '</td>' +
      '<td class="c">' + esc(it.hsn) + '</td>' + (noGst ? '' : '<td class="c">' + esc(it.gst) + '%</td>') +
      '<td class="c">' + esc(fmtQty(it.qty)) + ' ' + esc(it.uqc) + '</td><td class="r">' + indianNumber(it.rate) + '</td><td class="r">' + indianNumber(it.taxable) + '</td></tr>').join('');

    let breakdown = '';
    if (!noGst && inv.kind !== 'challan') {
      const hdr = intra ? ['GST Rate', 'TAXABLE', 'CGST%', 'CGST AMT', 'SGST%', 'SGST AMT', 'Total Tax Amount'] : ['GST Rate', 'TAXABLE', 'IGST%', 'IGST AMT', 'Total Tax Amount'];
      breakdown = '<div class="sect">GST Breakdown:</div><table class="grid small"><thead><tr>' + hdr.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
        rateGroups(inv).map(([rt, tx]) => {
          const r = num(rt);
          if (intra) { const h = tx * (r / 2) / 100; return '<tr><td class="c">' + rt + '%</td><td class="c">' + indianNumber(tx) + '</td><td class="c">' + (r / 2).toFixed(1) + '%</td><td class="c">' + indianNumber(h) + '</td><td class="c">' + (r / 2).toFixed(1) + '%</td><td class="c">' + indianNumber(h) + '</td><td class="c">' + indianNumber(h * 2) + '</td></tr>'; }
          const f = tx * r / 100; return '<tr><td class="c">' + rt + '%</td><td class="c">' + indianNumber(tx) + '</td><td class="c">' + r.toFixed(1) + '%</td><td class="c">' + indianNumber(f) + '</td><td class="c">' + indianNumber(f) + '</td></tr>';
        }).join('') + '</tbody></table>';
    } else if (noGst && inv.kind !== 'challan') {
      breakdown = '<div class="sect">Declaration: ' + (company.gstType === 'Composition' ? 'Composition taxable person, not eligible to collect tax on supplies.' : 'Supplier not registered under GST. No GST charged on this invoice.') + '</div>';
    }
    const bank = [['Account Number', company.bankAccountNo], ['Account Holder Name', (company.bankHolder || company.name).toUpperCase()], ['IFSC Code', (company.bankIfsc || '').toUpperCase()], ['Bank Name', company.bankName], ['Branch Name', company.bankBranch]];
    const totals = inv.kind === 'challan' ? '' :
      '<div class="totals"><div><span>' + (noGst ? 'Total Value:' : 'Taxable Value:') + '</span><b>' + money(t.taxable) + '</b></div>' +
      (noGst ? '' : intra ? '<div><span>CGST Amount:</span><span>' + money(t.cgst) + '</span></div><div><span>SGST Amount:</span><span>' + money(t.sgst) + '</span></div>' : '<div><span>IGST Amount:</span><span>' + money(t.igst) + '</span></div>') +
      '<div class="line"><span>Grand Total:</span><b>' + money(t.grand) + '</b></div><div><span>Rounding:</span><b>' + money(t.rounded) + '</b></div></div>';

    // Three parts, so that paginate() can lay the document out page by page: the header (first page only),
    // the item rows (as many per page as fit, the column headings repeated) and the closing block (last page)
    return '<div class="doc std"' + docInfo(inv, title, company) + '>' +
      '<div class="part top"><div class="title">' + title + '</div>' +
      '<div class="head"><div class="seller"><div class="sname">' + esc(company.name) + '</div><div class="addr">' + nl2br(company.address) + '</div>' +
      '<div><b>' + gstLine + '</b></div><div><b>Phone: ' + esc(company.phone) + ' | Email: ' + esc(company.email) + '</b></div></div>' +
      '<div class="meta"><div><b>' + noLabel(inv) + ':</b><b>' + esc(inv.no) + '</b></div><div><b>Date:</b><b>' + esc(inv.date) + '</b></div>' +
      (inv.kind === 'invoice' ? '<div><b>Payment:</b><span>' + esc(inv.payment) + '</span></div>' + (dueDate(inv) ? '<div><b>Due Date:</b><b>' + esc(dueDate(inv)) + '</b></div>' : '') + (noGst ? '' : '<div><b>Reverse Charge:</b><span>' + (inv.rcm ? 'Yes' : 'No') + '</span></div>') : '') + '</div></div>' +
      '<table class="grid parties"><tr><th>' + (gta ? 'CONSIGNOR (BILL TO)' : 'BILL TO') + '</th><th>' + (gta ? 'CONSIGNEE' : 'SHIP TO') + '</th><th>' + (gta ? 'CONSIGNMENT DETAILS' : 'OTHER DETAILS') + '</th></tr><tr><td>' + party(inv.buyer) + '</td><td>' + party(inv.consignee.name ? inv.consignee : inv.buyer) + '</td><td>' +
      other.map(o => '<div><b>' + o[0] + '</b> ' + esc(o[1]) + '</div>').join('') + '</td></tr></table></div>' +
      '<table class="grid items"><thead><tr>' + cols.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="part tail">' + (totals ? '<div class="foot tot"><div></div>' + totals + '</div>' : '') + breakdown +
      (inv.kind === 'challan' ? '<div class="sect">Goods sent for delivery. Not for sale. Total quantity: ' + fmtQty(inv.items.reduce((s, i) => s + num(i.qty), 0)) + '</div>' :
        '<div class="sect words">Amount in Words: ' + esc(t.words) + '</div>' +
        (inv.rcm ? '<div class="note">Tax payable under reverse charge by the recipient (Sec 9(3)/9(4) CGST Act). GST shown above is not included in the total.</div>' : '') +
        (inv.kind === 'quotation' ? '<div class="note">This quotation is valid for 30 days from the date above unless stated otherwise.</div>' : '')) +
      '<div class="foot"><div class="bank"><div class="bt">BANK DETAILS</div>' + bank.map(b => '<div><span>' + b[0] + '</span><span>:</span><span>' + esc(b[1]) + '</span></div>').join('') + '</div>' +
      '<div class="sign"><div>For ' + esc(company.name) + '</div>' + (company.signature ? '<img src="' + company.signature + '" alt="">' : '<div class="sp"></div>') + '<div>Authorised Signatory</div></div></div>' +
      termsBlock(inv, 'terms') +
      (company.signature ? '' : '<div class="cg">Computer-generated document. No signature required.</div>') +
      '</div></div>';
  }
  function noLabel(inv) { return inv.kind === 'challan' ? 'Challan No' : inv.kind === 'quotation' ? 'Quotation No' : 'Invoice No'; }
  // What the "(Continued)" strip at the top of the second page onwards shows
  function docInfo(inv, title, company) {
    return ' data-title="' + esc(title) + '" data-nolabel="' + esc(noLabel(inv).replace(' No', ' #')) + '" data-no="' + esc(inv.no) + '" data-date="' + esc(inv.date) + '" data-seller="' + esc(company.name) + '"';
  }

  // ------------------------------------------------------------ Classic boxed (Tally style)
  function classic(inv, company) {
    const noGst = !chargesGst(company), intra = inv.totals.intra, t = inv.totals;
    const title = docTitle(inv, company);
    const party = (caption, p, gstin, state, email, phone) => {
      const l = partyLines(p);
      return '<div class="party">' + (caption ? '<div class="cap">' + caption + '</div>' : '') + '<div class="pname">' + esc(l[0] || '') + '</div>' +
        l.slice(1).map(s => '<div>' + esc(s) + '</div>').join('') +
        (gstin ? '<div><b>GSTIN/UIN : ' + esc(gstin) + '</b></div>' : '') + (state ? '<div>State Name : ' + esc(state) + '</div>' : '') +
        (email ? '<div>E-Mail : ' + esc(email) + '</div>' : '') + (phone ? '<div>Phone : ' + esc(phone) + '</div>' : '') + '</div>';
    };
    const sellerGst = company.gstType === 'Composition' ? company.gstin + ' (Composition Dealer)' : noGst ? '' : company.gstin;
    const sellerState = U.stateByCode((company.gstin || '').slice(0, 2)) || '';
    const o = inv.other, gta = isTransporter(company), payCell = inv.kind === 'invoice' ? inv.payment + (dueDate(inv) ? ', due ' + dueDate(inv) : '') : '';
    const rcmCell = noGst || inv.kind !== 'invoice' ? ['', ''] : ['Reverse Charge', inv.rcm ? 'Yes' : 'No'];
    const cells = gta ? [
      [inv.kind === 'challan' ? 'Challan No.' : inv.kind === 'quotation' ? 'Quotation No.' : 'Invoice No.', inv.no, 'Dated', inv.date],
      ['LR / Consignment Note No.', o.lrNo, 'LR Date', o.lrDate],
      ['From', titleCase(o.origin), 'To', titleCase(o.destination)],
      ['Motor Vehicle No.', (o.vehicleNo || '').toUpperCase(), 'Vehicle Type', titleCase(o.vehicleType)],
      ['Goods / Packages / Weight', o.goods, 'Mode/Terms of Payment', payCell],
      ['E-way Bill / Reference No.', o.reference, rcmCell[0], rcmCell[1]]
    ] : [
      [inv.kind === 'challan' ? 'Challan No.' : inv.kind === 'quotation' ? 'Quotation No.' : 'Invoice No.', inv.no, 'Dated', inv.date],
      ['Delivery Note', o.deliveryNote, 'Mode/Terms of Payment', payCell],
      ['Reference No. & Date', o.reference, 'Other References', titleCase(o.info)],
      ["Buyer's Order No.", o.orderNo, 'Dated', o.orderDate],
      ['Dispatched through', titleCase(o.transporter), 'Destination', titleCase(o.destination)],
      ['Motor Vehicle No.', (o.vehicleNo || '').toUpperCase(), rcmCell[0], rcmCell[1]]
    ];
    const descHdr = gta ? 'Description of Services' : 'Description of Goods';
    const cols = noGst ? [descHdr, 'HSN/SAC', 'Quantity', 'Rate', 'per', 'Amount'] : [descHdr, 'HSN/SAC', 'GST Rate', 'Quantity', 'Rate', 'per', 'Amount'];
    const span = cols.length + 1;
    const rows = inv.items.map(it => '<tr><td class="c">' + it.sl + '</td><td><b>' + esc(titleCase(it.desc)) + '</b>' + (subText(it) ? '<div class="sub">' + esc(subText(it)) + '</div>' : '') + '</td>' +
      '<td class="c">' + esc(it.hsn) + '</td>' + (noGst ? '' : '<td class="c">' + esc(it.gst) + '%</td>') +
      '<td class="r">' + esc(fmtQty(it.qty)) + ' ' + esc(it.uqc) + '</td><td class="r">' + indianNumber(it.rate) + '</td><td class="c">' + esc(it.uqc) + '</td><td class="r">' + indianNumber(it.taxable) + '</td></tr>').join('');
    const tot = [];
    if (inv.kind !== 'challan') {
      if (!noGst) {
        tot.push(['Taxable Value', indianNumber(t.taxable)]);
        if (intra) { tot.push(['CGST', indianNumber(t.cgst)]); tot.push(['SGST', indianNumber(t.sgst)]); } else tot.push(['IGST', indianNumber(t.igst)]);
      }
      if (Math.abs(t.rounded - t.grand) >= 0.005) tot.push(['Round Off', indianNumber(t.rounded - t.grand)]);
    }
    const units = new Set(inv.items.filter(i => num(i.qty) > 0).map(i => i.uqc));
    const qsum = inv.items.reduce((s, i) => s + num(i.qty), 0);
    const totRows = tot.map((x, i) => '<tr class="tot' + (i ? '' : ' first') + '"><td colspan="' + (span - 3) + '" class="blank"></td><td colspan="2" class="r"><b>' + x[0] + '</b></td><td class="r">' + x[1] + '</td></tr>').join('') +
      '<tr class="tot total"><td colspan="' + (span - 4) + '" class="r"><b>Total</b></td><td class="r"><b>' + fmtQty(qsum) + (units.size === 1 ? ' ' + esc([...units][0]) : '') + '</b></td><td colspan="2"></td><td class="r"><b>' + (inv.kind === 'challan' ? '' : money(t.rounded)) + '</b></td></tr>';

    let hsn = '';
    if (!noGst && inv.kind !== 'challan') {
      const g = hsnGroups(inv); let sT = 0, sA = 0, sTax = 0;
      const body = g.map(x => { const half = x.taxable * x.rate / 200, full = x.taxable * x.rate / 100; sT += x.taxable; sA += intra ? half : full; sTax += full;
        return '<tr><td>' + esc(x.hsn) + '</td><td class="r">' + indianNumber(x.taxable) + '</td>' + (intra ? '<td class="c">' + pct(x.rate / 2) + '</td><td class="r">' + indianNumber(half) + '</td><td class="c">' + pct(x.rate / 2) + '</td><td class="r">' + indianNumber(half) + '</td>' : '<td class="c">' + pct(x.rate) + '</td><td class="r">' + indianNumber(full) + '</td>') + '<td class="r">' + indianNumber(full) + '</td></tr>'; }).join('');
      hsn = '<table class="grid hsn"><thead><tr><th rowspan="2">HSN/SAC</th><th rowspan="2">Taxable Value</th>' + (intra ? '<th colspan="2">CGST</th><th colspan="2">SGST</th>' : '<th colspan="2">IGST</th>') + '<th rowspan="2">Total Tax Amount</th></tr>' +
        '<tr><th>Rate</th><th>Amount</th>' + (intra ? '<th>Rate</th><th>Amount</th>' : '') + '</tr></thead><tbody>' + body +
        '<tr class="total"><td><b>Total</b></td><td class="r"><b>' + indianNumber(sT) + '</b></td><td></td><td class="r"><b>' + indianNumber(sA) + '</b></td>' + (intra ? '<td></td><td class="r"><b>' + indianNumber(sA) + '</b></td>' : '') + '<td class="r"><b>' + indianNumber(sTax) + '</b></td></tr></tbody></table>' +
        '<div class="row"><b>Tax Amount (in words) : ' + esc(rupeesPaiseWords(sTax)) + '</b></div>';
    }
    const bank = [['Bank Name', company.bankName], ["A/c Holder's Name", (company.bankHolder || company.name).toUpperCase()], ['A/c No.', company.bankAccountNo], ['IFSC Code', (company.bankIfsc || '').toUpperCase()], ['Branch', company.bankBranch]];

    // The same three parts as the standard layout (see there); the "after" part is the note under the frame.
    // The Buyer box and the Terms of Delivery cell stretch to the item table, so neither column leaves a gap above it.
    return '<div class="doc classic"' + docInfo(inv, title, company) + '><div class="frame">' +
      '<div class="part top"><div class="title">' + title + '</div>' +
      '<div class="head"><div class="left">' +
      party(null, { name: company.name, address: company.address }, sellerGst, sellerState ? stateNameCode(sellerState) : '', company.email, company.phone) +
      (inv.consignee.name ? party(gta ? 'Consignee' : 'Consignee (Ship to)', inv.consignee, (inv.consignee.gstin || '').toUpperCase(), stateNameCode(inv.consignee.state), (inv.consignee.email || '').toLowerCase(), inv.consignee.phone) : '') +
      party(gta ? 'Consignor (Bill to)' : 'Buyer (Bill to)', inv.buyer, (inv.buyer.gstin || '').toUpperCase(), stateNameCode(inv.buyer.state), (inv.buyer.email || '').toLowerCase(), inv.buyer.phone) +
      '</div><div class="right">' + cells.map(c => '<div class="cell"><div class="lb">' + c[0] + '</div><div class="vl">' + esc(c[1]) + '</div></div><div class="cell"><div class="lb">' + c[2] + '</div><div class="vl">' + esc(c[3]) + '</div></div>').join('') +
      '<div class="cell terms"><div class="lb">Terms of Delivery</div><div class="vl"></div></div></div></div></div>' +
      '<table class="grid items"><thead><tr><th>Sl<br>No.</th>' + cols.map(h => '<th>' + (h === 'GST Rate' ? 'GST<br>Rate' : h) + '</th>').join('') + '</tr></thead><tbody>' + rows + totRows + '</tbody></table>' +
      '<div class="part tail">' +
      (inv.kind === 'challan' ? '<div class="row">Goods sent for delivery. Not for sale.</div>' :
        '<div class="row words"><div class="two"><span>Amount Chargeable (in words)</span><span>E. &amp; O.E</span></div><b>' + esc(t.words) + '</b></div>' +
        (inv.rcm ? '<div class="row"><b>Tax payable under reverse charge by the recipient (Sec 9(3)/9(4) CGST Act). GST shown above is not included in the total.</b></div>' : '') +
        (noGst ? '<div class="row"><b>Declaration: ' + (company.gstType === 'Composition' ? 'Composition taxable person, not eligible to collect tax on supplies.' : 'Supplier not registered under GST. No GST charged on this invoice.') + '</b></div>' : '') +
        (inv.kind === 'quotation' ? '<div class="row">This quotation is valid for 30 days from the date above unless stated otherwise.</div>' : '')) +
      hsn + termsBlock(inv, 'row terms') +
      '<div class="foot"><div class="bank"><b>Company\'s Bank Details</b>' + bank.map(b => '<div><span>' + b[0] + '</span><span>:</span><b>' + esc(b[1]) + '</b></div>').join('') + '</div>' +
      '<div class="decl"><div class="dh">Declaration</div><b>for ' + esc(company.name) + '</b><div class="dt">We declare that this ' + (inv.kind === 'invoice' ? 'invoice' : 'document') + ' shows the actual price of the goods described and that all particulars are true and correct.</div>' +
      (company.signature ? '<img src="' + company.signature + '" alt="">' : '') + '<div class="as">Authorised Signatory</div></div></div>' +
      '</div></div><div class="part after"><div class="cg">This is a Computer Generated ' + (inv.kind === 'invoice' ? 'Invoice' : 'Document') + (company.signature ? '' : '. No signature required.') + '</div></div></div>';
  }

  const CSS = `
    * { box-sizing: border-box; }
    html, body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Calibri, Carlito, "Segoe UI", Arial, sans-serif; color: #000; font-size: 9.5pt; background: #fff; }
    .sheet { width: 100%; border-collapse: collapse; } .sheet > thead > tr > td, .sheet > tbody > tr > td, .sheet > tfoot > tr > td { padding: 0; border: 0; vertical-align: top; }
    .doc { width: 100%; }
    table { border-collapse: collapse; width: 100%; }
    thead { display: table-header-group; } tfoot { display: table-footer-group; }
    /* A row, a party box or a closing block is never cut in two by a page break; long item lists break between rows */
    .grid tr, .parties, .sect, .words, .note, .foot, .sign, .cg, .pw, .terms, .classic .head, .classic .row, .classic .hsn, .classic .foot, .std .small { break-inside: avoid; page-break-inside: avoid; }
    /* Terms & conditions, when the invoice asks for them */
    .terms .th { font-weight: bold; } .terms ol { margin: 2px 0 0 14pt; padding: 0; font-size: 8pt; line-height: 1.3; }
    .std .terms { margin-top: 8px; border: 1px solid #000; padding: 4px 8px; font-size: 8.5pt; } .std .terms .th { text-decoration: underline; font-size: 9pt; }
    .classic .row.terms .th { font-size: 9pt; }
    .grid thead { break-after: avoid; page-break-after: avoid; }
    .grid th, .grid td { border: 1px solid #000; padding: 3px 4px; vertical-align: top; }
    .grid th { background: #e0e0e0; font-weight: bold; text-align: center; font-size: 9pt; }
    .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
    .sub { font-size: 8pt; margin-top: 2px; }
    .cg { text-align: center; font-size: 8pt; margin-top: 6px; }
    .pw { text-align: center; font-size: 7.5pt; color: #555; margin-top: 10px; letter-spacing: .3px; }
    .pw a { color: #1565C0; text-decoration: underline; }
    .env .env-pw { position: absolute; right: 0; bottom: 0; margin: 0; }
    img { max-width: 120px; max-height: 40px; display: block; margin-left: auto; }
    /* Standard */
    .std .title { text-align: center; font-size: 15pt; font-weight: bold; text-decoration: underline; padding-bottom: 6px; border-bottom: 1.5px solid #000; margin-bottom: 8px; }
    .std .head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .std .sname { font-size: 12pt; font-weight: bold; } .std .addr { font-size: 8.5pt; max-width: 240pt; }
    .std .meta { min-width: 170pt; } .std .meta > div { display: flex; justify-content: space-between; gap: 10px; }
    .std .parties td { width: 33.3%; font-size: 8.5pt; height: 80pt; } .std .pname { font-weight: bold; font-size: 9.5pt; }
    .std .items { margin-top: 8px; } .std .items th { font-size: 10pt; }
    .std .sect { margin-top: 12px; font-weight: bold; } .std .small th { font-size: 7.5pt; } .std .small td { font-size: 8pt; }
    .std .note { font-size: 8.5pt; font-weight: bold; margin-top: 4px; }
    .rep .sub2 { font-size: 9pt; margin: 2px 0 6px; } .rep .items th, .rep .items td { font-size: 8.5pt; } .rep .items .l { text-align: left; } .rep .items th.l { text-align: left; }
    .rep tr.b td { font-weight: bold; } .rep tr.tot td { border-top: 2px solid #000; background: #f3f3f3; }
    .std .foot { display: flex; justify-content: space-between; gap: 20px; margin-top: 10px; }
    .std .bank { border: 1px solid #000; padding: 6px 8px; width: 300pt; font-size: 9pt; } .std .bt { text-decoration: underline; font-weight: bold; font-size: 10pt; margin-bottom: 6px; }
    .std .bank > div { display: grid; grid-template-columns: 105pt 10pt 1fr; }
    .std .totals { flex: 1; font-size: 10.5pt; } .std .totals > div { display: flex; justify-content: space-between; padding: 2px 0; } .std .totals .line { border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; } .std .totals > div:first-child { border-top: 1px solid #000; padding-top: 4px; }
    .std .sign { text-align: right; margin-top: 16px; font-size: 10.5pt; } .std .sign .sp { height: 40px; } .std .sign img { margin: 4px 0 4px auto; }
    /* The totals sit right under the items (above the GST breakdown); the signature block stands beside the bank details */
    .std .foot.tot { margin-top: 4px; } .std .foot .sign { flex: 1; margin-top: 0; padding-top: 2px; }
    /* Classic */
    .classic .frame { border: 1px solid #000; }
    .classic .title { text-align: center; font-weight: bold; font-size: 12pt; padding: 4px; border-bottom: 1px solid #000; }
    .classic .head { display: flex; border-bottom: 1px solid #000; }
    /* Both columns of the head run down to the item table: the last party box and the Terms cell take up whatever is left */
    .classic .left { width: 49%; border-right: 1px solid #000; display: flex; flex-direction: column; } .classic .right { width: 51%; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(6, auto) minmax(0, 1fr); }
    .classic .party { padding: 5px 5px 4px; border-bottom: 1px solid #000; font-size: 8.5pt; line-height: 1.25; } .classic .party:last-child { border-bottom: 0; flex: 1; }
    .classic .cap { margin-bottom: 2px; } .classic .pname { font-weight: bold; font-size: 9.5pt; }
    .classic .cell { border-bottom: 1px solid #000; border-right: 1px solid #000; padding: 3px 4px; min-height: 26pt; font-size: 9pt; overflow: hidden; }
    .classic .cell:nth-child(even) { border-right: 0; } .classic .lb { font-weight: bold; font-size: 8.5pt; } .classic .vl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .classic .cell.terms { grid-column: 1 / -1; border-right: 0; border-bottom: 0; min-height: 20pt; }
    .classic .items th, .classic .items td { border-top: 0; } .classic .items tr:first-child th { border-top: 0; } .classic .items { border-bottom: 1px solid #000; }
    .classic .items th { background: #fff; font-size: 8.5pt; }
    .classic .items td:first-child, .classic .items th:first-child { border-left: 0; } .classic .items td:last-child, .classic .items th:last-child { border-right: 0; }
    /* The totals rows: a rule closes the item grid, then only the label and the amount are boxed, the columns to their left stay blank */
    .classic .tot td { border-top: 0; border-bottom: 0; padding-top: 2px; padding-bottom: 2px; } .classic .tot td.blank { border-right: 0; } .classic .tot.first td { border-top: 1px solid #000; } .classic .total td { border-top: 1px solid #000; border-bottom: 1px solid #000; font-size: 10pt; }
    .classic .row { padding: 4px 5px; border-bottom: 1px solid #000; font-size: 9pt; } .classic .two { display: flex; justify-content: space-between; font-size: 8.5pt; }
    .classic .hsn th, .classic .hsn td { font-size: 8pt; } .classic .hsn th { background: #fff; } .classic .hsn { border-bottom: 1px solid #000; }
    .classic .hsn td:first-child, .classic .hsn th:first-child { border-left: 0; } .classic .hsn td:last-child, .classic .hsn th:last-child { border-right: 0; }
    .classic .foot { display: flex; min-height: 110pt; }
    .classic .bank { width: 52%; border-right: 1px solid #000; padding: 6px; font-size: 8.5pt; } .classic .bank > div { display: grid; grid-template-columns: 90pt 8pt 1fr; margin-top: 3px; }
    .classic .decl { flex: 1; padding: 6px; font-size: 8.5pt; position: relative; } .classic .dh { text-align: right; font-weight: bold; } .classic .dt { font-size: 8pt; margin-top: 4px; }
    /* Envelope */
    .env { position: relative; font-size: 9pt; }
    .env .from { max-width: 45%; font-size: 8pt; } .env .from b { font-size: 9.5pt; }
    .env .to { position: absolute; left: 42%; top: 44%; font-size: 10pt; } .env .to .nm { font-size: 12pt; font-weight: bold; }
    .env .ref { position: absolute; left: 0; bottom: 0; font-size: 8pt; }
    .classic .as { position: absolute; right: 6px; bottom: 6px; font-weight: bold; } .classic .decl img { position: absolute; right: 6px; bottom: 22px; }
    /* Pages made by paginate(): a fixed-size sheet each, the item rows split across them */
    .page { position: relative; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; background: #fff; break-after: page; page-break-after: always; }
    .page.last { break-after: auto; page-break-after: auto; }
    .page .pbody { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
    .page .zoom { flex: 1 1 auto; display: flex; flex-direction: column; }
    .page .doc.classic { flex: 0 0 auto; }
    .page .pfoot { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 8pt; padding-top: 5px; }
    .page .pw { margin-top: 2px; }
    .cont { text-align: right; font-size: 8.5pt; font-style: italic; padding: 5px 6px 0; }
    .contbar { display: grid; grid-template-columns: 1fr auto; gap: 1px 16px; background: #F0F4F8; font-size: 9pt; line-height: 1.3; }
    .contbar .t { font-weight: bold; font-size: 10pt; } .contbar .r { text-align: right; }
    .std .contbar { border: 1px solid #000; padding: 4px 8px; margin-bottom: 8px; }
    .classic .contbar { border-bottom: 1px solid #000; padding: 4px 6px; }
    @media screen { body.paged { background: #d9dce3; padding: 10px 0; } body.paged .page { margin: 0 auto 10px; box-shadow: 0 2px 8px rgba(0,0,0,.25); } }
  `;

  /* Lays the document out page by page, inside the printed document itself (it runs from a <script> at the end
     of the page, see paged()). Browsers can repeat a table heading on every page but cannot say "Page 2 of 3",
     "(Continued)" or "Continued on next page...", so the pages are built here: the first carries the header,
     every page the column headings and as many item rows as fit, the last the totals, the words, the bank
     details and the signature. Each page ends with its page number; every page but the last says that the
     items continue, and every page after the first opens with a strip naming the document, its number, its
     date and the seller. The same wording as the Android app's PDF. Without JavaScript the document simply
     flows as before. */
  const PAGINATE = function () {
    var flow = document.getElementById('flow'), doc = flow && flow.querySelector('.doc');
    if (!doc) return;
    var classic = doc.classList.contains('classic'), root = classic ? doc.querySelector('.frame') : doc;
    var head = root.querySelector('.part.top'), table = root.querySelector('table.items'), tail = root.querySelector('.part.tail'), after = doc.querySelector('.part.after');
    if (!head || !table) return;
    var thead = table.querySelector('thead'), rows = [].slice.call(table.querySelectorAll('tbody > tr'));
    var items = rows.filter(function (r) { return !r.classList.contains('tot'); }), tots = rows.filter(function (r) { return r.classList.contains('tot'); });
    var tailParts = tail ? [].slice.call(tail.children) : [], info = doc.dataset, pages = [];
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function strip() {
      var d = el('div', 'contbar');
      d.appendChild(el('div', 't', info.title + ' (Continued)'));
      d.appendChild(el('div', 't r', (info.nolabel ? info.nolabel + ' ' + info.no + '  |  ' : '') + 'Date: ' + info.date));
      d.appendChild(el('div', '', 'Seller: ' + info.seller));
      d.appendChild(el('div', 'r pno', ''));
      return d;
    }
    function newPage() {
      var pg = el('div', 'page'), body = el('div', 'pbody'), zoom = el('div', 'zoom'), d = el('div', doc.className), inner = d;
      if (classic) { inner = el('div', 'frame'); d.appendChild(inner); }
      zoom.appendChild(d); body.appendChild(zoom); pg.appendChild(body);
      // The footer gets its text now so that it has its height from the start (it is filled in at the end)
      var foot = el('div', 'pfoot'); foot.appendChild(el('span', 'cont', ' ')); foot.appendChild(el('span', 'pno', 'Page 1 of 1')); pg.appendChild(foot);
      // PAGINATE runs inside the print frame, so the footer is spelt out here (the same as POWERED above)
      pg.insertAdjacentHTML('beforeend', '<div class="pw"><a href="https://blitzbook.co.in">Powered by BlitzBook</a></div>');
      inner.appendChild(pages.length ? strip() : head);
      var t = el('table', table.className), tb = el('tbody'); t.appendChild(thead.cloneNode(true)); t.appendChild(tb); inner.appendChild(t);
      document.body.appendChild(pg);
      var P = { el: pg, body: body, doc: d, inner: inner, tbody: tb };
      pages.push(P);
      return P;
    }
    function over(P) { return P.body.scrollHeight > P.body.clientHeight + 1; }
    // The page is full: say so under its table and move on; if even that line does not fit, the last row goes too
    function closePage(P) {
      var c = el('div', 'cont', 'Continued on next page...'), carry = [];
      P.inner.appendChild(c);
      if (over(P) && P.tbody.children.length > 1) carry.push(P.tbody.removeChild(P.tbody.lastElementChild));
      return carry;
    }
    var P = newPage();
    items.forEach(function (r) {
      P.tbody.appendChild(r);
      if (!over(P) || P.tbody.children.length <= 1) return;
      P.tbody.removeChild(r);
      var carry = closePage(P).concat([r]);
      P = newPage();
      carry.forEach(function (x) { P.tbody.appendChild(x); });
    });
    // Totals and the closing block stay together: on this page if they fit, else on a fresh one.
    // A closing block taller than a page (very long HSN summary) is split block by block.
    function place(P, x) { if (x.tagName === 'TR') P.tbody.appendChild(x); else if (x.classList.contains('cg')) P.doc.appendChild(x); else P.inner.appendChild(x); }
    var rest = tots.concat(tailParts, after ? [].slice.call(after.children) : []);
    rest.forEach(function (x) { place(P, x); });
    if (over(P)) {
      rest.forEach(function (x) { x.parentNode.removeChild(x); });
      if (P.tbody.children.length) { closePage(P); P = newPage(); }
      rest.forEach(function (x) { place(P, x); });
      if (over(P)) {
        rest.forEach(function (x) { x.parentNode.removeChild(x); });
        var n = 0;
        rest.forEach(function (x) { place(P, x); n++; if (over(P) && n > 1) { x.parentNode.removeChild(x); closePage(P); P = newPage(); place(P, x); n = 1; } });
      }
    }
    pages[pages.length - 1].el.classList.add('last');
    pages.forEach(function (pg, i) { [].forEach.call(pg.el.querySelectorAll('.pno'), function (e) { e.textContent = 'Page ' + (i + 1) + ' of ' + pages.length; }); });
    flow.parentNode.removeChild(flow);
    document.body.classList.add('paged');
  };

  function html(inv, company, layout, paper) {
    const p = PAPERS[paper] && !PAPERS[paper].envelope ? PAPERS[paper] : PAPERS.A4;
    return paged(fileName(company, inv.kind === 'challan' ? 'DC' : inv.kind === 'quotation' ? 'QTN' : '', inv.no), p, '12mm 10mm', layout === 1 ? classic(inv, company) : standard(inv, company));
  }
  // "Company Name_INV-0001": the company, then the document number (a kind such as DC or Envelope in between for the others);
  // the browser offers this as the PDF's file name
  function fileName(company, kind, no) {
    const co = String(company.name || '').replace(/[^A-Za-z0-9 ._-]/g, '').replace(/\s+/g, ' ').trim();
    return (co || 'BlitzBook') + '_' + (kind ? kind + '_' : '') + String(no || '').replace(/[^A-Za-z0-9._-]/g, '_');
  }

  /* An invoice document: the sheet size with no @page margin (so browsers add no header or footer of their
     own), the margins inside each .page, and the script that cuts the flow into pages (PAGINATE). */
  function paged(title, paper, margin, body) {
    const m = String(margin).trim().split(/\s+/), top = m[0], side = m[1] || m[0], bottom = m[2] || m[0];
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>@page { size: ' + paper.w + 'mm ' + paper.h + 'mm; margin: 0; } body { margin: 0; }' + CSS +
      ' #flow { padding: ' + top + ' ' + side + ' ' + bottom + '; } .page { width: ' + paper.w + 'mm; height: ' + (paper.h - 0.5) + 'mm; padding: ' + top + ' ' + side + ' ' + bottom + '; }' +
      (paper.scale && paper.scale !== 1 ? ' .zoom { zoom: ' + paper.scale + '; }' : '') + '</style></head><body><div id="flow">' + body + '</div><script>(' + PAGINATE.toString() + ')();</script></body></html>';
  }

  // ------------------------------------------------------------ a report as a table (Excel's twin as a PDF)
  // headers / rows are text; opts.right = indexes of right-aligned (number) columns, opts.bold = row indexes in bold,
  // opts.total = one closing row, opts.widths = column widths. Laid out page by page like an invoice.
  function table(title, subtitle, headers, rows, company, opts) {
    opts = opts || {};
    const right = new Set(opts.right || []), bold = new Set(opts.bold || []), widths = opts.widths || [];
    const d = new Date(), today = U.pad(d.getDate()) + '/' + U.pad(d.getMonth() + 1) + '/' + d.getFullYear();
    const cell = (v, i, tag) => '<' + tag + ' class="' + (right.has(i) ? 'r' : 'l') + '"' + (widths[i] ? ' style="width:' + widths[i] + '"' : '') + '>' + esc(v == null ? '' : String(v)) + '</' + tag + '>';
    const body = '<div class="doc std rep" data-title="' + esc(title.toUpperCase()) + '" data-nolabel="" data-no="" data-date="' + esc(today) + '" data-seller="' + esc(company.name) + '">' +
      '<div class="part top"><div class="title">' + esc(title.toUpperCase()) + '</div><div class="head"><div class="seller"><div class="sname">' + esc(company.name) + '</div><div class="addr">' + nl2br(company.address) + '</div>' +
      (company.gstin ? '<div><b>GSTIN: ' + esc(company.gstin) + '</b></div>' : '') + '</div><div class="meta"><div><b>Date:</b><b>' + esc(today) + '</b></div></div></div>' +
      (subtitle ? '<div class="sub2">' + esc(subtitle) + '</div>' : '') + '</div>' +
      '<table class="grid items"><thead><tr>' + headers.map((h, i) => cell(h, i, 'th')).join('') + '</tr></thead><tbody>' +
      rows.map((r, n) => '<tr' + (bold.has(n) ? ' class="b"' : '') + '>' + r.map((v, i) => cell(v, i, 'td')).join('') + '</tr>').join('') +
      (opts.total ? '<tr class="tot b">' + opts.total.map((v, i) => cell(v, i, 'td')).join('') + '</tr>' : '') + '</tbody></table>' +
      '<div class="part tail"><div class="cg">' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + '. Generated by BlitzBook on ' + esc(today) + '.</div></div></div>';
    return paged(fileName(company, '', title.replace(/\s+/g, '_')), PAPERS.A4, '12mm 10mm', body);
  }

  // ------------------------------------------------------------ envelope: sender top-left, buyer's postal address lower right
  function envelope(inv, company, paper) {
    const p = PAPERS[paper] || PAPERS.EnvDL, b = inv.buyer, lines = String(b.name || '').toUpperCase().split('\n').map(x => x.trim()).filter(Boolean);
    return page(fileName(company, 'Envelope', inv.no), p.css, '8mm 10mm', '<div class="env"><div class="from"><b>From: ' + esc(String(company.name || '').toUpperCase()) + '</b><div>' + nl2br(company.address) + '</div><div>Ph: ' + esc(company.phone) + (company.gstin ? '   GSTIN: ' + esc(company.gstin) : '') + '</div></div>' +
      '<div class="to"><div>To,</div><div class="nm">' + esc(lines[0] || '') + '</div>' + lines.slice(1).map(l => '<div>' + esc(l) + '</div>').join('') + '<div>' + esc(formatState(b.state)) + '</div>' +
      (b.phone ? '<div>Ph: ' + esc(b.phone) + '</div>' : '') + (b.gstin ? '<div>GSTIN: ' + esc(String(b.gstin).toUpperCase()) + '</div>' : '') + '</div>' +
      '<div class="ref">Ref: Invoice ' + esc(inv.no) + ' dated ' + esc(inv.date) + '</div><div class="pw env-pw"><a href="' + SITE + '">Powered by BlitzBook</a></div></div>');
  }

  // ------------------------------------------------------------ purchase record / quotation, in the invoice style
  function head(title, company, meta) {
    return '<div class="title">' + title + '</div><div class="head"><div class="seller"><div class="sname">' + esc(company.name) + '</div><div class="addr">' + nl2br(company.address) + '</div>' +
      '<div><b>' + (company.gstin ? 'GSTIN: ' + esc(company.gstin) + '   ' : '') + 'Phone: ' + esc(company.phone) + '</b></div></div><div class="meta">' + meta.filter(Boolean).map(m => '<div><b>' + m[0] + '</b><' + (m[2] ? 'b' : 'span') + '>' + esc(m[1]) + '</' + (m[2] ? 'b' : 'span') + '></div>').join('') + '</div></div>';
  }
  function signBlock(company) { return '<div class="sign"><div><b>For ' + esc(company.name) + '</b></div>' + (company.signature ? '<img src="' + company.signature + '" alt="">' : '<div class="sp"></div>') + '<div>Authorised Signatory</div></div>'; }
  function purchase(p, company, paper) {
    const sheet = PAPERS[paper] || PAPERS.A4, quotation = p.kind === 'QTN', inter = num(p.igst) > 0;
    const body = '<div class="doc std">' + head(quotation ? 'QUOTATION' : 'PURCHASE RECORD', company, [[quotation ? 'Quotation No:' : 'Purchase No:', p.no, 1], ['Date:', p.date, 1], quotation ? null : ['Payment:', p.paidBy], p.rcm ? ['Reverse Charge:', 'Yes'] : null]) +
      '<table class="grid parties"><tr><th style="text-align:left">' + (quotation ? 'QUOTATION FROM / PARTY' : 'SUPPLIER') + '</th></tr><tr><td style="height:auto"><div class="pname">' + esc(String(p.supplier || '-').toUpperCase()) + '</div>' +
      (p.supplierGstin ? '<div>GSTIN: ' + esc(p.supplierGstin) + '</div>' : '') + (p.notes ? '<div>Notes: ' + esc(p.notes) + '</div>' : '') + '</td></tr></table>' +
      '<table class="grid items"><thead><tr>' + ['Sl', 'DESCRIPTION', 'HSN/SAC', 'Qty', 'Rate', 'GST%', 'Amount'].map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
      p.items.map((it, n) => '<tr><td class="c">' + (n + 1) + '</td><td>' + esc(it.name) + (it.stock ? '  (stock)' : '') + '</td><td class="c">' + esc(it.hsn) + '</td><td class="c">' + esc(fmtQty(it.qty)) + ' ' + esc(it.uqc || 'NOS') + '</td><td class="c">' + indianNumber(it.rate) + '</td><td class="c">' + esc(it.gst) + '%</td><td class="c">' + indianNumber(it.amount) + '</td></tr>').join('') + '</tbody></table>' +
      '<div class="foot"><div></div><div class="totals" style="flex:0 0 230pt"><div><span><b>Taxable Value:</b></span><b>' + money(p.taxable) + '</b></div>' +
      (inter ? '<div><span><b>IGST:</b></span><span>' + money(p.igst) + '</span></div>' : '<div><span><b>CGST:</b></span><span>' + money(p.cgst) + '</span></div><div><span><b>SGST:</b></span><span>' + money(p.sgst) + '</span></div>') +
      '<div class="line"><span><b>' + (p.rcm ? 'Payable to Supplier:' : 'Total:') + '</b></span><b>' + money(p.total) + '</b></div></div></div>' +
      (p.rcm ? '<div class="note">GST of ' + money(p.gst) + ' payable under reverse charge by ' + esc(company.name) + '.</div>' : '') +
      '<div class="sect words">Amount in Words: ' + esc(U.toIndianWords(Math.round(num(p.total)))) + '</div>' +
      (quotation ? '<div class="note" style="font-weight:normal">This quotation is valid for 30 days from the date above unless stated otherwise.</div>' : '') + signBlock(company) + POWERED + '</div>';
    return page(fileName(company, '', p.no), sheet.css, '12mm 10mm', body, sheet.scale);
  }

  // ------------------------------------------------------------ credit / debit note on A4
  function note(n, company) {
    const credit = n.kind !== 'DN', rows = [[credit ? 'Value of goods / services credited' : 'Value of goods / services debited', n.rate, n.taxable]].concat(num(n.igst) > 0 ? [['IGST', '', n.igst]] : [['CGST', '', n.cgst], ['SGST', '', n.sgst]]);
    const body = '<div class="doc std">' + head(credit ? 'CREDIT NOTE' : 'DEBIT NOTE', company, [['Note No:', n.no, 1], ['Date:', n.date, 1], [credit ? 'Against Invoice:' : 'Against Purchase:', n.ref || '-']]) +
      '<table class="grid parties"><tr><th style="text-align:left">' + (credit ? 'ISSUED TO (CUSTOMER)' : 'ISSUED TO (SUPPLIER)') + '</th></tr><tr><td style="height:auto"><div class="pname">' + esc(String(n.party || '').toUpperCase()) + '</div>' +
      (n.partyGstin ? '<div>GSTIN: ' + esc(n.partyGstin) + '</div>' : '') + (n.reason ? '<div>Reason: ' + esc(n.reason) + '</div>' : '') + '</td></tr></table>' +
      '<table class="grid items"><thead><tr><th>PARTICULARS</th><th style="width:80pt">GST %</th><th style="width:125pt">AMOUNT</th></tr></thead><tbody>' +
      rows.map(r => '<tr><td>' + r[0] + '</td><td class="c">' + (r[1] === '' ? '' : esc(r[1]) + '%') + '</td><td class="r">' + indianNumber(r[2]) + '</td></tr>').join('') +
      '<tr><td colspan="2" class="r"><b>TOTAL</b></td><td class="r"><b>' + money(n.total) + '</b></td></tr></tbody></table>' +
      '<div class="sect words">Amount in Words: ' + esc(U.toIndianWords(Math.round(num(n.total)))) + '</div>' +
      '<div>Settlement: ' + (n.settle === 'Credit' ? (credit ? "Adjusted against the customer's account" : "Adjusted against the supplier's account") : (credit ? 'Refunded by ' : 'Received back by ') + esc(n.settle)) + '</div>' + signBlock(company) + POWERED + '</div>';
    return page(fileName(company, '', n.no), PAPERS.A4.css, '12mm 10mm', body);
  }

  /* One printable page set. The sheet has no @page margin, which is what stops browsers printing their own
     header and footer (title, date, "about:srcdoc", page numbers) on the PDF; the margins come from the
     sheet table instead, whose header and footer rows repeat on every printed page. The title is what
     "Save as PDF" suggests as the file name. */
  function page(title, size, margin, body, scale) {
    const m = String(margin).trim().split(/\s+/), top = m[0], side = m[1] || m[0], bottom = m[2] || m[0];
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>@page { size: ' + size + '; margin: 0; } body { padding: 0 ' + side + '; }' + CSS +
      ' .sheet .mt { height: ' + top + '; } .sheet .mb { height: ' + bottom + '; } .env { height: calc(100vh - ' + top + ' - ' + bottom + '); }' + (scale && scale !== 1 ? ' .sheet .doc, .sheet .env { zoom: ' + scale + '; }' : '') + '</style></head><body>' +
      '<table class="sheet"><thead><tr><td><div class="mt"></div></td></tr></thead><tbody><tr><td>' + body + '</td></tr></tbody><tfoot><tr><td><div class="mb"></div></td></tr></tfoot></table></body></html>';
  }

  /* What the browser prints as the page title when its own header is switched on (and what a PDF viewer shows as
     the document title): the document number and date, e.g. "Invoice 0001 - 03/10/2026", read from the
     document's data attributes, never the portal's own title line. */
  function printLabel(src) {
    const un = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const at = (n) => { const m = new RegExp(' data-' + n + '="([^"]*)"').exec(src); return m ? un(m[1]) : ''; };
    const no = at('no'), date = at('date'), label = at('nolabel').replace(/\s*#$/, '');
    if (no) return (label ? label + ' ' : '') + no + ' - ' + date;
    if (at('title')) return titleCase(at('title')) + (date ? ' - ' + date : '');
    const t = /<title>([^<]*)<\/title>/.exec(src); return t ? un(t[1]) : 'Document';
  }
  // Sends a finished document to the browser's print dialog (inside the iOS app: to the app, which shares it as a PDF)
  function show(src) {
    if (global.Native && Native.ios) { const m = /<title>([^<]*)<\/title>/.exec(src); if (Native.post('print', { title: m ? m[1] : 'Document', html: src })) return; }
    let f = document.getElementById('printFrame');
    if (!f) { f = document.createElement('iframe'); f.id = 'printFrame'; f.title = 'Print'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'; document.body.appendChild(f); }
    f.onload = () => {
      // Fonts and images must be in before the preview is built, or the first print comes out with the fallback font.
      // While the print dialog is up the portal's title is the document number and date (the browser's header line).
      const w = f.contentWindow, was = document.title, label = printLabel(src);
      const go = () => { document.title = label; try { w.focus(); w.print(); } catch (e) { const t = window.open('', '_blank'); t.document.write(src); t.document.close(); t.print(); } document.title = was; };
      if (w.document.fonts && w.document.fonts.ready) w.document.fonts.ready.then(go, go); else go();
    };
    f.srcdoc = src;
  }
  function open(inv, company, layout, paper) { show(html(inv, company, layout, paper)); }
  function preview(inv, company, layout, paper) { return html(inv, company, layout, paper); }

  // ------------------------------------------------------------ receipt / payment voucher on A4
  function voucher(v, company) {
    const receipt = v.vtype !== 'payment', amount = v.lines.filter(l => l.side === 'Dr').reduce((s, l) => s + num(l.amount), 0);
    // The invoices the money is knocked off against (one for an older receipt), and the customer's details from the first
    const alloc = receipt && Array.isArray(v.alloc) && v.alloc.length ? v.alloc : (receipt && v.ref ? [{ no: String(v.ref).trim(), amount }] : []);
    const firstNo = alloc.length ? alloc[0].no : '';
    const inv = firstNo && global.Store ? Store.list('invoices').find(i => i.kind === 'invoice' && i.no === firstNo) : null;
    const dues = global.Biz && alloc.length > 1 ? new Map(Biz.outstanding().all.map(r => [r.no, r])) : null;
    const allocRows = alloc.length > 1 ? alloc.map(a => { const r = dues.get(a.no); return '<tr><td>Invoice ' + esc(a.no) + (r ? ' dated ' + esc(r.date) + ', total ' + money(r.total) + ', balance due ' + money(r.balance) : '') + '</td><td class="r">' + indianNumber(num(a.amount)) + '</td></tr>'; }).join('') : '';
    const onAccount = U.round2(amount - alloc.reduce((s, a) => s + num(a.amount), 0));
    const total = inv ? num(inv.totals.rounded) || num(inv.totals.grand) : 0;
    const got = inv && inv.payment === 'Credit' && global.Store ? Store.list('journal').filter(j => j.vtype === 'receipt' && String(j.ref || '').trim() === inv.no && j.id !== v.id).reduce((s, j) => s + (j.lines || []).filter(l => l.side === 'Dr').reduce((t, l) => t + num(l.amount), 0), 0) + amount : total;
    const cn = inv && global.Store ? Store.list('notes').filter(n => n.kind === 'CN' && n.settle === 'Credit' && String(n.ref || '').trim() === inv.no).reduce((s, n) => s + num(n.total), 0) : 0;
    const due = inv ? Math.max(0, U.round2(total - got - cn)) : 0;
    const who = inv ? partyLines(inv.buyer) : [];
    const body = '<div class="doc std">' + head(receipt ? 'RECEIPT' : 'PAYMENT VOUCHER', company, [[(receipt ? 'Receipt' : 'Voucher') + ' No:', v.no || '-', 1], ['Date:', v.date, 1], [receipt ? (alloc.length > 1 ? 'Against Invoices:' : 'Against Invoice:') : 'Against Bill:', alloc.length ? alloc.map(a => a.no).join(', ') : (v.ref || '-')], ['Mode:', v.mode || 'Bank Transfer']]) +
      '<table class="grid parties"><tr><th style="text-align:left">' + (receipt ? 'RECEIVED FROM' : 'PAID TO') + '</th></tr><tr><td style="height:auto"><div class="pname">' + esc(String(v.party || '').toUpperCase()) + '</div>' +
      who.slice(1, 3).map(s => '<div>' + esc(s.toUpperCase()) + '</div>').join('') + (inv && inv.buyer.gstin ? '<div><b>GSTIN: ' + esc(inv.buyer.gstin.toUpperCase()) + '</b></div>' : '') + (inv && inv.buyer.phone ? '<div>Ph: ' + esc(inv.buyer.phone) + '</div>' : '') +
      (v.narration ? '<div>' + esc(v.narration) + '</div>' : '') + '</td></tr></table>' +
      '<table class="grid items"><thead><tr><th>PARTICULARS</th><th style="width:125pt">AMOUNT</th></tr></thead><tbody><tr><td>' + (receipt ? 'Amount received' : 'Amount paid') + ' by ' + esc(v.mode || 'Bank Transfer') + (v.bankRef ? ' (ref ' + esc(v.bankRef) + ')' : '') + (alloc.length === 1 ? ' against ' + esc(alloc[0].no) : alloc.length ? ', knocked off against the invoices below' : v.ref ? ' against ' + esc(v.ref) : '') + '</td><td class="r">' + indianNumber(amount) + '</td></tr>' + allocRows +
      (alloc.length > 1 && onAccount > 0.005 ? '<tr><td>Kept on account of ' + esc(v.party) + '</td><td class="r">' + indianNumber(onAccount) + '</td></tr>' : '') +
      '<tr><td class="r"><b>TOTAL</b></td><td class="r"><b>' + money(amount) + '</b></td></tr></tbody></table>' +
      '<div class="sect words">Amount in Words: ' + esc(rupeesPaiseWords(amount)) + '</div>' +
      (inv && alloc.length === 1 ? '<div class="sect">Invoice ' + esc(inv.no) + ' dated ' + esc(inv.date) + ': total ' + money(total) + (inv.payment === 'Credit' ? ', received ' + money(got) + (cn ? ', credit notes ' + money(cn) : '') + ', <b>balance due ' + money(due) + '</b>' : ', paid in full at the time of sale') + '</div>' : '') +
      (receipt ? '<div class="note" style="font-weight:normal">Received with thanks. Subject to realisation of cheque / transfer where applicable.</div>' : '') + signBlock(company) + POWERED + '</div>';
    return page(fileName(company, '', v.no || ''), PAPERS.A4.css, '12mm 10mm', body);
  }

  global.Print = { PAPERS, SHEETS, LAYOUTS, SITE, html, open, show, preview, docTitle, envelope, purchase, note, voucher, table, page, head, signBlock, POWERED };
})(window);
