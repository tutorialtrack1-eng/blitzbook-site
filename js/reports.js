/* BlitzBook web portal - Sales Report, Profit & Loss, Balance Sheet with a shared period picker. The figures
   come from Books (ledger.js), so they match the app's statements line for line. */
(function (global) {
  'use strict';
  const { esc, num, money } = U;
  const PERIODS = ['This Month', 'Last Month', 'This Quarter', 'This Financial Year', 'Financial Year (Apr-Mar)', 'Custom Range'];

  function fmt(d) { return U.pad(d.getDate()) + '/' + U.pad(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function range(a, b, label) { return { from: fmt(a), to: fmt(b), a: a.getTime(), b: b.getTime(), label }; }
  function periodRange(kind) {
    const n = new Date();
    if (kind === 0) return range(new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth() + 1, 0), PERIODS[0]);
    if (kind === 1) return range(new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0), PERIODS[1]);
    if (kind === 2) { const q = Math.floor(n.getMonth() / 3) * 3; return range(new Date(n.getFullYear(), q, 1), new Date(n.getFullYear(), q + 3, 0), PERIODS[2]); }
    const y = n.getMonth() < 3 ? n.getFullYear() - 1 : n.getFullYear();
    return range(new Date(y, 3, 1), new Date(y + 1, 2, 31), PERIODS[3]);
  }
  // Period chooser shared by the sales report and profit & loss
  function pickPeriod(title, current, onPick) {
    UI.menu(title, PERIODS, (i) => {
      if (i === 4) { const y = new Date().getFullYear(), years = [y - 1, y, y + 1]; UI.menu('Select FY', years.map(v => v + '-' + (v + 1)), (n) => onPick(range(new Date(years[n], 3, 1), new Date(years[n] + 1, 2, 31), 'FY ' + years[n] + '-' + String(years[n] + 1).slice(2)))); }
      else if (i === 5) UI.modal({ title: 'Custom Range', body: '<div class="grid2 keep2">' + UI.field('From', UI.input('rFrom', U.toIso(current.from), { type: 'date' })) + UI.field('To', UI.input('rTo', U.toIso(current.to), { type: 'date' })) + '</div>', buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Generate', cls: 'green', onClick: (bg) => {
        const f = UI.val('rFrom', bg), t = UI.val('rTo', bg); if (!f || !t) { UI.toast('Select both dates'); return false; }
        onPick(range(new Date(f + 'T00:00:00'), new Date(t + 'T00:00:00'), PERIODS[5]));
      } }] });
      else onPick(periodRange(i));
    });
  }

  // ------------------------------------------------------------ sales report, invoice wise
  // Further columns the report can carry (Columns button); the choice is kept in this browser. Text columns sit
  // before the amounts, the status after them. Excel, PDF and CSV carry the same columns as the table.
  const REPORT_TEXT_COLS = ['GSTIN', 'State', 'Phone', 'Payment Mode', 'PO No', 'Due Date', 'Items'];
  const REPORT_NUM_COLS = ['CGST', 'SGST', 'IGST', 'Received', 'Outstanding', 'Status'];
  const reportColumns = () => (Store.get('sales_report_cols', []) || []).filter(c => REPORT_TEXT_COLS.includes(c) || REPORT_NUM_COLS.includes(c));
  function chooseReportColumns(onDone) {
    const chosen = reportColumns(), all = REPORT_TEXT_COLS.concat(REPORT_NUM_COLS);
    UI.modal({ title: 'Report Columns', body: '<div class="hint" style="margin-bottom:8px">Further columns for the invoice-wise sales report. Excel, PDF and CSV carry the same columns.</div><div class="grid2 keep2">' + all.map((c, i) => '<div>' + UI.check('rc' + i, c, chosen.includes(c)) + '</div>').join('') + '</div>',
      buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Apply', cls: 'green', onClick: (bg) => { Store.set('sales_report_cols', all.filter((c, i) => UI.val('rc' + i, bg)), true); onDone(); } }] });
  }
  App.routes.salesReport = function (p) {
    const r = p.range || periodRange(0);
    const invs = Store.list('invoices').filter(i => i.kind === 'invoice' && Books.inRange(i.date, r.a, r.b)).sort((a, b) => U.dateMs(a.date) - U.dateMs(b.date) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
    const chosen = reportColumns(), has = (c) => chosen.includes(c);
    // What is still due on each credit invoice, when a column needs it
    const due = has('Received') || has('Outstanding') || has('Status') ? new Map(Biz.outstanding().all.map(x => [x.no, x])) : new Map();
    const now = Date.now();
    // Under reverse charge no GST is collected, so the register shows none
    const rows = invs.map(i => {
      const total = num(i.totals.rounded) || num(i.totals.grand), o = due.get(i.no), outstanding = o ? o.balance : 0;
      const cgst = i.rcm ? 0 : num(i.totals.cgst), sgst = i.rcm ? 0 : num(i.totals.sgst), igst = i.rcm ? 0 : num(i.totals.igst);
      const days = Math.max(0, Math.floor((now - U.dateMs(i.date)) / 86400000)), overdue = i.dueDate && U.dateMs(i.dueDate) ? U.dateMs(i.dueDate) < now : days > 30;
      return { no: i.no, date: i.date, buyer: Books.partyName(i.buyer.name), gstin: i.buyer.gstin || '', state: U.stateName(i.buyer.state || '') || '', phone: i.buyer.phone || '', mode: (i.payment || '') + (i.rcm ? ' (RCM)' : ''), po: (i.other && i.other.orderNo) || '', dueDate: i.dueDate || '', items: i.items.map(x => String(x.desc || '').trim()).filter(Boolean).join(', '),
        taxable: num(i.totals.taxable), cgst, sgst, igst, gst: cgst + sgst + igst, grand: num(i.totals.grand), received: U.round2(total - outstanding), outstanding, status: !o || outstanding <= 0.005 ? 'Paid' : (overdue ? 'Overdue ' : 'Due ') + days + ' days' };
    });
    // The columns in order: the fixed three, the chosen text columns, the amounts (with the chosen GST parts and dues), the status
    const cols = [['Invoice No', 'no'], ['Date', 'date'], ['Buyer Name', 'buyer', 'title']];
    const TEXT = { GSTIN: 'gstin', State: 'state', Phone: 'phone', 'Payment Mode': 'mode', 'PO No': 'po', 'Due Date': 'dueDate', Items: 'items' };
    REPORT_TEXT_COLS.forEach(c => { if (has(c)) cols.push([c, TEXT[c]]); });
    cols.push(['Taxable Value', 'taxable', 'num']);
    ['CGST', 'SGST', 'IGST'].forEach(c => { if (has(c)) cols.push([c, c.toLowerCase(), 'num']); });
    cols.push(['GST Amount', 'gst', 'num'], ['Grand Total', 'grand', 'num']);
    if (has('Received')) cols.push(['Received', 'received', 'num']);
    if (has('Outstanding')) cols.push(['Outstanding', 'outstanding', 'num']);
    if (has('Status')) cols.push(['Status', 'status']);
    const sum = (k) => rows.reduce((s, x) => s + x[k], 0);
    const headers = cols.map(c => c[0]), right = cols.map((c, n) => c[2] === 'num' ? n : -1).filter(n => n >= 0);
    const cell = (x, c) => c[2] === 'num' ? money(x[c[1]]) : esc(c[2] === 'title' ? U.titleCase(x[c[1]]) : x[c[1]]);
    const root = App.view(App.header('Sales Report - Invoice Wise', '<div class="btnrow" style="margin:0"><button class="btn sm outline" id="rPeriod">' + esc(r.label) + '</button><button class="btn sm outline" id="rCols">Columns' + (chosen.length ? ' (' + chosen.length + ')' : '') + '</button><button class="btn sm green" id="rXls">Export Excel</button><button class="btn sm blue" id="rPdf">PDF</button><button class="btn sm outline" id="rCsv">CSV</button></div>') +
      '<div class="card white"><div class="bd"><div class="kv">' + kv('Period', esc(r.from + ' to ' + r.to)) + kv('Invoices', rows.length) + kv('Taxable', money(sum('taxable'))) + kv('GST', money(sum('gst'))) + kv('Grand Total', money(sum('grand')), 'tot') + (has('Outstanding') ? kv('Outstanding', money(sum('outstanding'))) : '') + '</div></div></div>' +
      '<div class="tablewrap">' + (rows.length ? '<table class="list cards"><thead><tr>' + cols.map((c, n) => '<th class="' + (c[2] === 'num' ? 'num' : '') + '">' + esc(c[0]) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map(x => '<tr>' + cols.map((c, n) => '<td class="' + (c[2] === 'num' ? 'num' : '') + '" data-l="' + esc(c[0]) + '">' + (n === 0 ? '<b>' + U.noLink(x.no) + '</b>' : cell(x, c)) + '</td>').join('') + '</tr>').join('') + '</tbody></table>' : '<div class="empty">No invoices in this period.</div>') + '</div>');
    App.wireBack(root);
    $('#rPeriod').onclick = () => pickPeriod('Sales Report', r, (rg) => App.go('salesReport', { range: rg }));
    $('#rCols').onclick = () => chooseReportColumns(() => App.go('salesReport', { range: r }));
    const flat = () => rows.map(x => cols.map(c => c[2] === 'num' ? U.indianNumber(x[c[1]]) : x[c[1]]));
    const totals = cols.map((c, n) => n === 0 ? 'Total' : c[2] === 'num' && c[1] !== 'status' ? U.indianNumber(sum(c[1])) : '');
    $('#rXls').onclick = () => UI.xls('Sales_Report', headers, flat());
    $('#rPdf').onclick = () => UI.pdf('Sales Report - Invoice Wise', 'Period: ' + r.from + ' to ' + r.to + '   ·   ' + rows.length + ' invoices', headers, flat(), { right, total: totals });
    $('#rCsv').onclick = () => UI.download('BlitzBook_Sales_Report_' + U.stamp() + '.csv', UI.csv([headers].concat(rows.map(x => cols.map(c => c[2] === 'num' ? x[c[1]].toFixed(2) : x[c[1]])))), 'text/csv');
  };

  // ------------------------------------------------------------ outstanding & ageing, customer wise
  // Every credit invoice with something still due on it (Biz.outstanding), grouped by customer, with its age and
  // the age bucket totals. A receipt can be recorded straight from a line; it is mapped to that invoice.
  const BUCKETS = ['0 - 30 days', '31 - 60 days', '61 - 90 days', 'Over 90 days'];
  App.routes.aging = function (p) {
    const asAt = p.asAt || U.today(), o = Biz.outstanding(U.dateMs(asAt)), open = o.open.slice().sort((a, b) => a.party.localeCompare(b.party) || U.dateMs(a.date) - U.dateMs(b.date));
    const sums = [0, 0, 0, 0]; open.forEach(r => sums[r.bucket] += r.balance);
    const total = sums.reduce((s, v) => s + v, 0);
    const groups = new Map(); open.forEach(r => { const k = r.party.toLowerCase(); if (!groups.has(k)) groups.set(k, { party: r.party, rows: [], total: 0 }); groups.get(k).rows.push(r); groups.get(k).total += r.balance; });
    const onAccount = new Map(o.onAccount.map(x => [x.party.toLowerCase(), x.amount]));
    const headers = ['Customer', 'Invoice', 'Date', 'Days', 'Age', 'Total', 'Received', 'Balance Due'];
    const body = [];
    groups.forEach(g => {
      body.push('<tr class="grp"><td colspan="7" data-l="Customer"><b>' + esc(g.party) + '</b>' + (onAccount.has(g.party.toLowerCase()) ? '<span class="small muted">   ·   ' + money(onAccount.get(g.party.toLowerCase())) + ' received on account, not mapped to an invoice</span>' : '') + '</td><td class="num" data-l="Due"><b>' + money(g.total) + '</b></td><td></td></tr>');
      g.rows.forEach(r => body.push('<tr><td></td><td data-l="Invoice"><b>' + U.noLink(r.no) + '</b></td><td data-l="Date">' + esc(r.date) + '</td><td class="num" data-l="Days">' + r.days + '</td><td data-l="Age"><span class="pill ' + (r.bucket === 0 ? 'ok' : r.bucket === 1 ? '' : r.bucket === 2 ? 'warn' : 'bad') + '">' + BUCKETS[r.bucket] + '</span></td><td class="num" data-l="Total">' + money(r.total) + '</td><td class="num" data-l="Received">' + money(r.received + r.credited) + (r.credited ? '<div class="small muted">incl. credit notes ' + money(r.credited) + '</div>' : '') + '</td><td class="num" data-l="Balance"><b>' + money(r.balance) + '</b></td>' +
        '<td class="actions"><button class="btn sm green" data-rct="' + esc(r.id) + '">+ Receipt</button><button class="btn sm outline" data-open="' + esc(r.id) + '">Open</button></td></tr>'));
    });
    const root = App.view(App.header('Outstanding & Ageing', '<div class="btnrow" style="margin:0"><div class="inline"><label class="muted small" for="agDate">as at</label>' + UI.input('agDate', U.toIso(asAt), { type: 'date', attrs: ' style="width:170px;min-height:36px"' }) + '</div><button class="btn sm outline" id="agMoney">Receipts</button><button class="btn sm green" id="agXls">Export Excel</button><button class="btn sm blue" id="agPdf">PDF</button></div>') +
      '<div class="buckets">' + BUCKETS.map((b, i) => '<div class="bucket b' + i + '"><div class="k">' + b + '</div><div class="v">' + money(sums[i]) + '</div><div class="s">' + open.filter(r => r.bucket === i).length + ' invoice' + (open.filter(r => r.bucket === i).length === 1 ? '' : 's') + '</div></div>').join('') +
      '<div class="bucket tot"><div class="k">Total outstanding</div><div class="v">' + money(total) + '</div><div class="s">' + open.length + ' open credit invoice' + (open.length === 1 ? '' : 's') + ', ' + groups.size + ' customer' + (groups.size === 1 ? '' : 's') + '</div></div></div>' +
      '<div class="hint" style="margin-bottom:10px">A receipt recorded against an invoice number clears that invoice; a receipt without one stays on account of the customer and is shown under the customer. Age counts from the invoice date to the date chosen.</div>' +
      '<div class="tablewrap">' + (open.length ? '<table class="list cards aging"><thead><tr>' + headers.map((h, n) => '<th class="' + (n >= 3 && n !== 4 ? 'num' : '') + '">' + h + '</th>').join('') + '<th></th></tr></thead><tbody>' + body.join('') + '</tbody></table>' : '<div class="empty">Nothing is due on credit invoices' + (o.all.length ? ' as at ' + esc(asAt) : '') + '.</div>') + '</div>');
    App.wireBack(root);
    $('#agDate').onchange = e => { if (e.target.value) App.go('aging', { asAt: U.fromIso(e.target.value) }); };
    $('#agMoney').onclick = () => App.go('money', { kind: 'receipt' });
    const agRows = () => open.map(r => [r.party, r.no, r.date, r.days, BUCKETS[r.bucket], U.indianNumber(r.total), U.indianNumber(r.received + r.credited), U.indianNumber(r.balance)]);
    $('#agXls').onclick = () => UI.xls('Outstanding_Ageing', headers, agRows());
    $('#agPdf').onclick = () => UI.pdf('Outstanding & Ageing', 'As at ' + asAt + '   ·   ' + BUCKETS.map((b, i) => b + ': ' + money(sums[i])).join('   ·   '), headers, agRows(), { right: [3, 5, 6, 7], total: ['Total outstanding', '', '', '', '', '', '', U.indianNumber(total)] });
    $$('[data-rct]', root).forEach(b => b.onclick = () => { const r = open.find(x => x.id === b.dataset.rct); Money.edit('receipt', { party: r.party, ref: r.no, amount: r.balance }, () => App.go('aging', { asAt })); });
    $$('[data-open]', root).forEach(b => b.onclick = () => App.go('invoice', { id: b.dataset.open }));
  };

  // ------------------------------------------------------------ supplier outstanding & ageing
  // Every credit purchase bill with something still owed on it (Books.payables), grouped by supplier, with its age
  // and the age bucket totals; a payment can be recorded straight from a line. The mirror of the customer screen.
  App.routes.payables = function (p) {
    const asAt = p.asAt || U.today(), o = Books.payables(U.dateMs(asAt)), open = o.open.slice().sort((a, b) => a.party.localeCompare(b.party) || U.dateMs(a.date) - U.dateMs(b.date));
    const sums = [0, 0, 0, 0]; open.forEach(r => sums[r.bucket] += r.balance);
    const total = sums.reduce((s, v) => s + v, 0);
    const groups = new Map(); open.forEach(r => { const k = r.party.toLowerCase(); if (!groups.has(k)) groups.set(k, { party: r.party, rows: [], total: 0 }); groups.get(k).rows.push(r); groups.get(k).total += r.balance; });
    const onAccount = new Map(o.onAccount.map(x => [x.party.toLowerCase(), x.amount]));
    const headers = ['Supplier', 'Bill', 'Date', 'Days', 'Age', 'Bill Amount', 'Paid', 'Balance Due'];
    const body = [];
    groups.forEach(g => {
      body.push('<tr class="grp"><td colspan="7" data-l="Supplier"><b>' + esc(g.party) + '</b>' + (onAccount.has(g.party.toLowerCase()) ? '<span class="small muted">   ·   ' + money(onAccount.get(g.party.toLowerCase())) + ' paid on account, not mapped to a bill</span>' : '') + '</td><td class="num" data-l="Due"><b>' + money(g.total) + '</b></td><td></td></tr>');
      g.rows.forEach(r => body.push('<tr><td></td><td data-l="Bill"><b>' + U.noLink(r.no) + '</b></td><td data-l="Date">' + esc(r.date) + '</td><td class="num" data-l="Days">' + r.days + '</td><td data-l="Age"><span class="pill ' + (r.bucket === 0 ? 'ok' : r.bucket === 1 ? '' : r.bucket === 2 ? 'warn' : 'bad') + '">' + BUCKETS[r.bucket] + '</span></td><td class="num" data-l="Bill Amount">' + money(r.total) + '</td><td class="num" data-l="Paid">' + money(r.paid + r.noted) + (r.noted ? '<div class="small muted">incl. debit notes ' + money(r.noted) + '</div>' : '') + '</td><td class="num" data-l="Balance"><b>' + money(r.balance) + '</b></td>' +
        '<td class="actions"><button class="btn sm green" data-pay="' + esc(r.id) + '">+ Payment</button></td></tr>'));
    });
    const root = App.view(App.header('Supplier Outstanding & Ageing', '<div class="btnrow" style="margin:0"><div class="inline"><label class="muted small" for="pyDate">as at</label>' + UI.input('pyDate', U.toIso(asAt), { type: 'date', attrs: ' style="width:170px;min-height:36px"' }) + '</div><button class="btn sm outline" id="pyMoney">Payments</button><button class="btn sm outline" id="pyBills">Purchases</button><button class="btn sm green" id="pyXls">Export Excel</button><button class="btn sm blue" id="pyPdf">PDF</button></div>') +
      '<div class="buckets">' + BUCKETS.map((b, i) => '<div class="bucket b' + i + '"><div class="k">' + b + '</div><div class="v">' + money(sums[i]) + '</div><div class="s">' + open.filter(r => r.bucket === i).length + ' bill' + (open.filter(r => r.bucket === i).length === 1 ? '' : 's') + '</div></div>').join('') +
      '<div class="bucket tot"><div class="k">Total payable</div><div class="v">' + money(total) + '</div><div class="s">' + open.length + ' open credit bill' + (open.length === 1 ? '' : 's') + ', ' + groups.size + ' supplier' + (groups.size === 1 ? '' : 's') + '</div></div></div>' +
      '<div class="hint" style="margin-bottom:10px">A payment recorded against a bill number clears that bill; a payment without one stays on account of the supplier and is shown under the supplier. Age counts from the bill date to the date chosen; a bill over 30 days old is overdue.</div>' +
      '<div class="tablewrap">' + (open.length ? '<table class="list cards aging"><thead><tr>' + headers.map((h, n) => '<th class="' + (n >= 3 && n !== 4 ? 'num' : '') + '">' + h + '</th>').join('') + '<th></th></tr></thead><tbody>' + body.join('') + '</tbody></table>' : '<div class="empty">Nothing is owed on credit purchase bills' + (o.all.length ? ' as at ' + esc(asAt) : '') + '.</div>') + '</div>');
    App.wireBack(root);
    $('#pyDate').onchange = e => { if (e.target.value) App.go('payables', { asAt: U.fromIso(e.target.value) }); };
    $('#pyMoney').onclick = () => App.go('money', { kind: 'payment' });
    $('#pyBills').onclick = () => App.go('purchases');
    const pyRows = () => open.map(r => [r.party, r.no, r.date, r.days, BUCKETS[r.bucket], U.indianNumber(r.total), U.indianNumber(r.paid + r.noted), U.indianNumber(r.balance)]);
    $('#pyXls').onclick = () => UI.xls('Supplier_Outstanding', headers, pyRows());
    $('#pyPdf').onclick = () => UI.pdf('Supplier Outstanding & Ageing', 'As at ' + asAt + '   ·   ' + BUCKETS.map((b, i) => b + ': ' + money(sums[i])).join('   ·   '), headers, pyRows(), { right: [3, 5, 6, 7], total: ['Total payable', '', '', '', '', '', '', U.indianNumber(total)] });
    $$('[data-pay]', root).forEach(b => b.onclick = () => { const r = open.find(x => x.id === b.dataset.pay); Money.edit('payment', { party: r.party, ref: r.no, amount: r.balance }, () => App.go('payables', { asAt })); });
  };

  // ------------------------------------------------------------ party ledger (supplier / customer reconciliation)
  // Books.partyLedger for one party over a period (all dates unless chosen): opening balance, every entry with
  // a running balance, closing balance, Excel export. Dr = the party owes us, Cr = we owe the party.
  App.routes.ledger = function (p) {
    const names = new Set();
    Store.list('contacts').forEach(c => { if (!p.type || (c.type || 'Customer') === p.type) names.add(String(c.name || '').trim()); });
    if (!p.type || p.type === 'Supplier') Store.list('purchases').forEach(x => { if (x.kind === 'PUR' && x.supplier) names.add(String(x.supplier).trim()); });
    if (!p.type || p.type === 'Customer') Biz.invoices().forEach(i => { const n = Books.partyName(i.buyer.name); if (n) names.add(n); });
    const parties = Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const party = p.party || (parties.length === 1 ? parties[0] : ''), r = p.range || null;
    const L = party ? Books.partyLedger(party, r ? r.a : null, r ? r.b : null) : null;
    const side = (v) => Math.abs(v) < 0.005 ? money(0) : money(Math.abs(v)) + (v > 0 ? ' Dr' : ' Cr');
    const who = (v) => Math.abs(v) < 0.005 ? 'settled' : v > 0 ? 'owed to you' : 'owed by you';
    const pill = (t) => t === 'Receipt' ? 'ok' : t === 'Payment' ? 'warn' : t === 'Credit Note' || t === 'Debit Note' ? 'bad' : '';
    const headers = ['Date', 'Voucher', 'No', 'Particulars', 'Debit', 'Credit', 'Balance'];
    const root = App.view(App.header('Party Ledger', '<div class="btnrow" style="margin:0">' + UI.select('lgParty', parties, party, { blank: parties.length ? '— choose a ' + (p.type ? p.type.toLowerCase() : 'party') + ' —' : 'No parties yet' }) +
        '<button class="btn sm outline" id="lgPeriod">' + esc(r ? r.label : 'All dates') + '</button>' + (r ? '<button class="btn sm outline" id="lgAll">All dates</button>' : '') + (party && L.entries.length ? '<button class="btn sm green" id="lgXls">Export Excel</button><button class="btn sm blue" id="lgPdf">PDF</button>' : '') + '</div>') +
      '<div class="hint" style="margin-bottom:10px">Every bill, note, receipt and payment with the party in date order with a running balance, to reconcile with the party\'s own statement. Dr = the party owes you, Cr = you owe the party. A bill paid at once is shown as billed and settled on the same day.</div>' +
      (!party ? '<div class="empty">Choose a supplier or customer to see the ledger.</div>' :
        '<div class="card white"><div class="bd"><div class="kv">' + kv('Party', esc(party)) + kv('Period', esc(r ? r.from + ' to ' + r.to : 'All dates')) + kv('Opening balance', esc(side(L.opening))) + kv('Debits in the period', money(L.totalDr)) + kv('Credits in the period', money(L.totalCr)) + kv('Closing balance (' + who(L.closing) + ')', esc(side(L.closing)), 'tot') + '</div></div></div>' +
        '<div class="tablewrap">' + (L.entries.length ? '<table class="list cards"><thead><tr>' + headers.map((h, n) => '<th class="' + (n >= 4 ? 'num' : '') + '">' + h + '</th>').join('') + '</tr></thead><tbody>' +
          '<tr><td data-l="Date">' + esc(r ? r.from : '') + '</td><td></td><td></td><td class="left" data-l="Particulars"><i>Opening balance</i></td><td></td><td></td><td class="num" data-l="Balance"><b>' + esc(side(L.opening)) + '</b></td></tr>' +
          L.entries.map(e => '<tr><td data-l="Date">' + esc(e.date) + '</td><td data-l="Voucher"><span class="pill ' + pill(e.type) + '">' + esc(e.type) + '</span></td><td data-l="No"><b>' + U.noLink(e.no) + '</b></td><td class="left" data-l="Particulars">' + esc(e.particulars) + '</td><td class="num" data-l="Debit">' + (e.dr ? money(e.dr) : '') + '</td><td class="num" data-l="Credit">' + (e.cr ? money(e.cr) : '') + '</td><td class="num" data-l="Balance"><b>' + esc(side(e.bal)) + '</b></td></tr>').join('') +
          '<tr class="total"><td colspan="4" class="left" data-l="">Closing balance</td><td class="num" data-l="Debit">' + money(L.totalDr) + '</td><td class="num" data-l="Credit">' + money(L.totalCr) + '</td><td class="num" data-l="Balance">' + esc(side(L.closing)) + '</td></tr></tbody></table>' :
          '<div class="empty">No dealings with ' + esc(party) + (r ? ' in this period' : '') + '.</div>') + '</div>'));
    App.wireBack(root);
    $('#lgParty').onchange = e => App.go('ledger', { party: e.target.value, range: r, type: p.type });
    $('#lgPeriod').onclick = () => pickPeriod('Party Ledger', r || periodRange(3), (rg) => App.go('ledger', { party, range: rg, type: p.type }));
    if ($('#lgAll')) $('#lgAll').onclick = () => App.go('ledger', { party, type: p.type });
    const lgRows = () => [[r ? r.from : '', '', '', 'Opening balance', '', '', side(L.opening)]].concat(L.entries.map(e => [e.date, e.type, e.no, e.particulars, e.dr ? U.indianNumber(e.dr) : '', e.cr ? U.indianNumber(e.cr) : '', side(e.bal)]));
    if ($('#lgXls')) $('#lgXls').onclick = () => UI.xls('Ledger_' + party.replace(/[^A-Za-z0-9]+/g, '_'), headers, lgRows().concat([['', '', '', 'Closing balance', U.indianNumber(L.totalDr), U.indianNumber(L.totalCr), side(L.closing)]]));
    if ($('#lgPdf')) $('#lgPdf').onclick = () => UI.pdf('Ledger of ' + party, (r ? 'Period: ' + r.from + ' to ' + r.to : 'All dates') + '   ·   Dr = owed to us, Cr = owed by us', headers, lgRows(), { right: [4, 5, 6], total: ['Closing balance (' + who(L.closing) + ')', '', '', '', U.indianNumber(L.totalDr), U.indianNumber(L.totalCr), side(L.closing)] });
  };

  // ------------------------------------------------------------ statements
  const kv = (k, v, cls) => '<div class="' + (cls || '') + '">' + k + '</div><div class="v ' + (cls || '') + '">' + v + '</div>';
  // One line of a financial statement: [label, value, style] with style 0 = normal, 1 = bold total, 2 = section heading
  function statement(title, subtitle, lines, fileTag, controls) {
    const root = App.view(App.header(title, '<div class="btnrow" style="margin:0">' + controls + '<button class="btn sm green" id="stXls">Export Excel</button><button class="btn sm blue" id="stPdf">PDF</button></div>') +
      '<div class="card white"><div class="bd"><div class="muted small" style="white-space:pre-line">' + esc(subtitle) + '</div><div class="kv">' +
      lines.map(l => l[2] === 2 ? '<div class="h">' + esc(l[0]) + '</div>' : kv(esc(l[0]).replace(/^ {6}/, '<span class="sub"></span>'), esc(l[1]), l[2] === 1 ? 'tot' : '')).join('') + '</div></div></div>');
    App.wireBack(root);
    $('#stXls').onclick = () => UI.xls(fileTag, ['Particulars', 'Amount'], lines.map(l => [l[0], l[1].replace('₹ ', '')]));
    $('#stPdf').onclick = () => UI.pdf(title, subtitle.replace(/\n/g, '   ·   '), ['Particulars', 'Amount'], lines.map(l => [l[0].trim(), l[1]]), { right: [1], bold: lines.map((l, i) => l[2] ? i : -1).filter(i => i >= 0), widths: ['', '140pt'] });
    return root;
  }

  // Ratios under the statements: "1.85 : 1" and "23.4%", n/a when there is nothing to divide by
  const ratio = (a, b) => b > 0.005 ? (a / b).toFixed(2) + ' : 1' : 'n/a';
  const pct = (a, b) => b > 0.005 ? (a / b * 100).toFixed(1) + '%' : 'n/a';

  App.routes.pnl = function (p) {
    const r = p.range || periodRange(3), pl = Books.profitLoss(r.a, r.b), L = [];
    L.push(['INCOME', '', 2]);
    L.push(['Sales (' + pl.invoices + ' invoices, before GST)', money(pl.sales), 0]);
    if (pl.creditNotes > 0) L.push(['Less: Credit notes (' + pl.creditNotes + ')', money(pl.salesReturns), 0]);
    if (pl.otherIncome !== 0) L.push(['Other income (journal)', money(pl.otherIncome), 0]);
    L.push(['COST OF GOODS', '', 2]);
    L.push(['Purchases (' + pl.purchases + ' bills, before GST)', money(pl.purchasesValue), 0]);
    if (pl.debitNotes > 0) L.push(['Less: Debit notes (' + pl.debitNotes + ')', money(pl.purchaseReturns), 0]);
    L.push(['Gross Profit', money(pl.grossProfit), 1]);
    L.push(['EXPENSES', '', 2]);
    if (!pl.expensesByCategory.size) L.push(['No expenses recorded', money(0), 0]);
    pl.expensesByCategory.forEach((v, k) => L.push([k, money(v), 0]));
    L.push(['Total Expenses', money(pl.expenses), 1]);
    L.push([pl.netProfit >= 0 ? 'NET PROFIT' : 'NET LOSS', money(Math.abs(pl.netProfit)), 1]);
    const netSales = pl.sales - pl.salesReturns;
    L.push(['RATIOS (on sales less credit notes)', '', 2]);
    L.push(['Gross profit margin', pct(pl.grossProfit, netSales), 0]);
    L.push(['Net profit margin', pct(pl.netProfit, netSales), 0]);
    L.push(['Cost of goods to sales', pct(pl.purchasesValue - pl.purchaseReturns, netSales), 0]);
    L.push(['Expenses to sales', pct(pl.expenses, netSales), 0]);
    if (Biz.chargesGst()) {
      L.push(['GST (not part of profit)', '', 2]);
      L.push(['Output CGST', money(pl.outCgst), 0]); L.push(['Output SGST', money(pl.outSgst), 0]); L.push(['Output IGST', money(pl.outIgst), 0]);
      L.push(['Total output GST on sales' + (pl.rcmInvoices > 0 ? ' (' + pl.rcmInvoices + ' RCM sales excluded)' : ''), money(pl.outputGst), 1]);
      L.push(['Input CGST', money(pl.inCgst), 0]); L.push(['Input SGST', money(pl.inSgst), 0]); L.push(['Input IGST', money(pl.inIgst), 0]);
      L.push(['Total input GST on purchases', money(pl.inputGst), 1]);
      if (pl.rcmGst > 0) L.push(['GST payable under reverse charge (' + pl.rcmPurchases + ' purchases, pay in cash)', money(pl.rcmGst), 0]);
      const due = pl.outputGst - pl.inputGst + pl.rcmGst;
      L.push([due >= 0 ? 'Net GST payable' : 'Net GST credit', money(Math.abs(due)), 1]);
    }
    statement('Profit & Loss', 'Period: ' + r.from + ' to ' + r.to, L, 'Profit_Loss', '<button class="btn sm outline" id="rPeriod">' + esc(r.label) + '</button>');
    $('#rPeriod').onclick = () => pickPeriod('Profit & Loss', r, (rg) => App.go('pnl', { range: rg }));
  };

  App.routes.balance = function (p) {
    const asAt = p.asAt || U.today(), bs = Books.balanceSheet(U.dateMs(asAt)), gst = Biz.chargesGst(), L = [];
    L.push(['ASSETS', '', 2]);
    L.push(['Cash in hand', money(bs.cash), 0]);
    L.push(['Bank (online & cheque)', money(bs.bank), 0]);
    L.push(['Receivables (credit sales & parties)', money(bs.receivables), 0]);
    bs.parties.forEach(x => { if (x[1] > 0) L.push(['      ' + x[0], money(x[1]), 0]); });
    L.push(['Stock in hand', money(bs.stockValue), 0]);
    bs.assets.forEach(x => L.push([x[0], money(x[1]), 0]));
    if (gst) { L.push(['Input CGST', money(bs.inCgst), 0]); L.push(['Input SGST', money(bs.inSgst), 0]); L.push(['Input IGST', money(bs.inIgst), 0]); }
    L.push(['Total Assets', money(bs.totalAssets), 1]);
    L.push(['LIABILITIES & CAPITAL', '', 2]);
    L.push(['Payables (credit purchases, expenses & parties)', money(bs.payables), 0]);
    bs.parties.forEach(x => { if (x[1] < 0) L.push(['      ' + x[0], money(-x[1]), 0]); });
    bs.liabilities.forEach(x => L.push([x[0], money(x[1]), 0]));
    if (gst) {
      L.push(['Output CGST', money(bs.outCgst), 0]); L.push(['Output SGST', money(bs.outSgst), 0]); L.push(['Output IGST', money(bs.outIgst), 0]);
      const net = bs.outCgst + bs.outSgst + bs.outIgst - bs.inCgst - bs.inSgst - bs.inIgst;
      L.push([net >= 0 ? '      Net GST payable (output less input)' : '      Net GST credit (input exceeds output)', money(Math.abs(net)), 0]);
    }
    if (bs.rcmPayable > 0) L.push(['GST payable under reverse charge', money(bs.rcmPayable), 0]);
    if (bs.tdsPayable !== 0) L.push(['TDS payable (deducted from suppliers)', money(bs.tdsPayable), 0]);
    L.push([bs.capital >= 0 ? "Owner's capital (accumulated profit)" : "Owner's capital (accumulated loss)", money(bs.capital), 0]);
    L.push(['Total Liabilities & Capital', money(bs.totalLiabilities + bs.capital), 1]);
    // Current assets: cash, bank, receivables, stock and a net GST credit; current liabilities: payables, net GST
    // payable, reverse-charge GST and TDS. Other named accounts (fixed assets, loans) are left out of both.
    const netGst = bs.outCgst + bs.outSgst + bs.outIgst - bs.inCgst - bs.inSgst - bs.inIgst;
    const curAssets = bs.cash + bs.bank + bs.receivables + bs.stockValue + Math.max(0, -netGst), curLiab = bs.payables + Math.max(0, netGst) + bs.rcmPayable + bs.tdsPayable;
    L.push(['RATIOS', '', 2]);
    L.push(['Current ratio (current assets : current liabilities)', ratio(curAssets, curLiab), 0]);
    L.push(['Quick ratio (current assets without stock)', ratio(curAssets - bs.stockValue, curLiab), 0]);
    L.push(['Working capital (current assets less current liabilities)', money(curAssets - curLiab), 0]);
    L.push(["Debt to equity (liabilities : owner's capital)", ratio(bs.totalLiabilities, bs.capital), 0]);
    statement('Balance Sheet', 'As at ' + asAt + '\nFrom invoices, purchases, expenses and journal entries; stock at last purchase rate.', L, 'Balance_Sheet',
      '<div class="inline"><label class="muted small" for="bsDate">as at</label>' + UI.input('bsDate', U.toIso(asAt), { type: 'date', attrs: ' style="width:170px;min-height:36px"' }) + '</div>');
    $('#bsDate').onchange = e => { if (e.target.value) App.go('balance', { asAt: U.fromIso(e.target.value) }); };
  };

  // A period from dd/mm/yyyy strings (the form it takes in the address bar)
  function rangeOf(from, to, label) { const a = U.dateMs(from), b = U.dateMs(to); return a && b ? range(new Date(a), new Date(b), label || PERIODS[5]) : periodRange(0); }
  global.Reports = { periodRange, pickPeriod, rangeOf };
})(window);
