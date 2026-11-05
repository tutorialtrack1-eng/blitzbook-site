/* BlitzBook web portal - procurement: what to buy, from whom, and what came in.
     Requisitions (REQ-)  what is needed, by when and who asked; Low stock fills one from the item master's reorder
                          levels; a requisition becomes a purchase order with one tap
     Purchase orders (PO-) to a supplier, with the expected delivery, the items and rates, terms and notes; printed
                          as a PURCHASE ORDER; Draft > Sent > Partly received > Received > Closed / Cancelled
     Goods receipts (GRN-) what arrived against an order, line by line and in parts; the order's status follows;
                          a receipt becomes the purchase bill (Purchases, with the items counted as stock)
     Compare quotes        the quotations recorded under Purchases, item by item and supplier by supplier, the
                          cheapest marked; a purchase order from the cheapest with one tap
   The documents live in the 'procure' collection (prc:<id> on the server) and sync between portal devices; the
   Android app leaves the prefix alone. Nothing here touches the books until a receipt is turned into a bill. */
(function (global) {
  'use strict';
  const { esc, num, money } = U;
  const KINDS = { REQ: 'Requisition', PO: 'Purchase Order', GRN: 'Goods Receipt' };
  const STATUS = { open: 'Open', ordered: 'Ordered', closed: 'Closed', draft: 'Draft', sent: 'Sent', partly: 'Partly received', received: 'Received', cancelled: 'Cancelled' };
  const PILL = { open: 'warn', ordered: 'ok', closed: '', draft: '', sent: 'ok', partly: 'warn', received: 'ok', cancelled: 'bad' };
  const all = () => Store.list('procure');
  const of = (kind) => all().filter(d => d.kind === kind).sort((a, b) => U.dateMs(b.date) - U.dateMs(a.date) || String(b.no).localeCompare(String(a.no), undefined, { numeric: true }));
  const nextNo = (kind) => { let max = 0; all().forEach(d => { const m = new RegExp('^' + kind + '-(\\d+)$').exec(d.no || ''); if (m) max = Math.max(max, +m[1]); }); return kind + '-' + String(max + 1).padStart(4, '0'); };
  const byNo = (no) => all().find(d => String(d.no).toLowerCase() === String(no || '').toLowerCase()) || null;
  const blankLine = () => ({ name: '', hsn: '', qty: '', uqc: 'NOS', rate: '', gst: '18' });
  const totals = (d) => Ledger.purchaseTotals(Object.assign(d, { rcm: false, inclusive: !!d.inclusive, tdsRate: 0, tdsSection: '' }));
  const save = (d) => { if (d.id && Store.find('procure', d.id)) Store.update('procure', d); else Store.add('procure', d); return d; };
  const itemsText = (d) => (d.items || []).map(it => esc(it.name) + ' × ' + U.fmtQty(it.qty)).join(', ');
  const pill = (st) => '<span class="pill ' + (PILL[st] || '') + '">' + esc(STATUS[st] || st) + '</span>';
  const link = (no) => '<b>' + U.noLink(no) + '</b>';
  // What a purchase order has received so far, per line (by item name) and in all
  function received(po) {
    const got = {}; of('GRN').filter(g => g.poNo === po.no).forEach(g => (g.items || []).forEach(it => { const k = String(it.name).toLowerCase(); got[k] = (got[k] || 0) + num(it.qty); }));
    const ordered = (po.items || []).reduce((s, it) => s + num(it.qty), 0), recd = (po.items || []).reduce((s, it) => s + Math.min(num(it.qty), got[String(it.name).toLowerCase()] || 0), 0);
    return { got, ordered, recd, pct: ordered ? Math.round(recd / ordered * 100) : 0 };
  }
  function poStatus(po) {
    if (po.status === 'cancelled' || po.status === 'closed') return po.status;
    const r = received(po);
    return r.recd <= 0 ? (po.status === 'sent' ? 'sent' : 'draft') : r.recd + 0.0001 >= r.ordered ? 'received' : 'partly';
  }
  // The purchase bill made from a receipt, if any (the bill notes name the receipt)
  const billOf = (grn) => Store.list('purchases').find(p => p.kind === 'PUR' && String(p.notes || '').includes(grn.no)) || null;

  const Procure = {
    KINDS, STATUS, nextNo, byNo, received, poStatus,
    screen(p) {
      const tab = ['req', 'po', 'grn', 'low', 'quotes'].includes(p.tab) ? p.tab : 'po';
      const tabs = [['po', 'Purchase Orders'], ['req', 'Requisitions'], ['grn', 'Goods Receipts'], ['low', 'Low Stock'], ['quotes', 'Compare Quotes']];
      const root = App.view(App.header('Procurement', '<div class="btnrow" style="margin:0"><button class="btn sm green" id="prNewPo">+ Purchase Order</button><button class="btn sm blue" id="prNewReq">+ Requisition</button><button class="btn sm outline" id="prPur">Purchases</button><button class="btn sm outline" id="prSuppliers">Suppliers</button></div>') +
        '<div class="btnrow" style="margin-bottom:12px">' + tabs.map(t => '<button class="btn sm ' + (t[0] === tab ? 'blue' : 'outline') + '" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' +
        (tab === 'po' ? this.poList() : tab === 'req' ? this.reqList() : tab === 'grn' ? this.grnList() : tab === 'low' ? this.lowStock() : this.quotes()));
      App.wireBack(root);
      const again = () => this.screen({ tab });
      $$('[data-tab]', root).forEach(b => b.onclick = () => App.go('procurement', { tab: b.dataset.tab }));
      $('#prNewPo').onclick = () => this.edit({ kind: 'PO' }); $('#prNewReq').onclick = () => this.edit({ kind: 'REQ' });
      $('#prPur').onclick = () => App.go('purchases'); $("#prSuppliers").onclick = () => App.go("contacts", { type: "Supplier" });
      $$('[data-print]', root).forEach(b => b.onclick = () => { const d = Store.find('procure', b.dataset.print); UI.menu('Print ' + d.no, Print.SHEETS.map(k => Print.PAPERS[k].label), (i) => Print.show(Print.po(d, Store.company(), Print.SHEETS[i]))); });
      $$('[data-mail]', root).forEach(b => b.onclick = () => { const d = Store.find('procure', b.dataset.mail); Mail.dialog(d.kind === 'PO' ? Mail.po(d, Store.company()) : Mail.requisition(d, Store.company()), { title: 'Email ' + d.no }); });
      $$('[data-del]', root).forEach(b => b.onclick = () => { const d = Store.find('procure', b.dataset.del); UI.confirm('Delete ' + KINDS[d.kind], 'Delete ' + d.no + '?' + (d.kind === 'PO' && of('GRN').some(g => g.poNo === d.no) ? ' Its goods receipts stay.' : ''), () => { Store.delete('procure', d.id); again(); }, 'Delete'); });
      $$('[data-status]', root).forEach(b => b.onclick = () => { const d = Store.find('procure', b.dataset.status.split(':')[0]); d.status = b.dataset.status.split(':')[1]; save(d); UI.toast(d.no + ': ' + STATUS[d.status]); again(); });
      $$('[data-recv]', root).forEach(b => b.onclick = () => this.receive(Store.find('procure', b.dataset.recv), again));
      $$('[data-topo]', root).forEach(b => b.onclick = () => this.reqToPo(Store.find('procure', b.dataset.topo)));
      $$('[data-bill]', root).forEach(b => b.onclick = () => this.bill(Store.find('procure', b.dataset.bill)));
      $$('[data-lowreq]', root).forEach(b => b.onclick = () => this.lowToReq(root));
      $$('input[data-min]', root).forEach(i => i.onchange = () => { const list = Store.list('items'), it = list.find(x => x.id === i.dataset.min); if (it) { it.minStock = num(i.value); Store.saveList('items', list); if (global.Inv) Inv.setAttr(it.name, { minStock: num(i.value) }); UI.toast('Reorder level saved'); } });
      $$('[data-quotepo]', root).forEach(b => b.onclick = () => this.quotesToPo(b.dataset.quotepo));
    },
    poList() {
      const list = of('PO');
      return Ledger.listTable(['No', 'Date', 'Supplier', 'Expected', 'Items', '#Total', 'Received', 'Status', ''], list.map(po => { const st = poStatus(po), r = received(po); return '<tr>' + Ledger.td('No', link(po.no)) + Ledger.td('Date', esc(po.date)) + Ledger.td('Supplier', esc(po.supplier || '-')) + Ledger.td('Expected', esc(po.expected || '-')) + Ledger.td('Items', itemsText(po)) + Ledger.td('Total', money(po.total), 'num') + Ledger.td('Received', r.ordered ? r.pct + '%' : '-') + Ledger.td('Status', pill(st)) +
        '<td class="actions"><button class="btn sm" data-print="' + esc(po.id) + '">Print</button><button class="btn sm outline" data-mail="' + esc(po.id) + '" title="Email the order to the supplier">Email</button>' + (st === 'draft' ? '<button class="btn sm outline" data-status="' + esc(po.id) + ':sent">Mark sent</button>' : '') + (st === 'draft' || st === 'sent' || st === 'partly' ? '<button class="btn sm green" data-recv="' + esc(po.id) + '">Receive</button>' : '') + (st === 'received' || st === 'partly' ? '<button class="btn sm outline" data-status="' + esc(po.id) + ':closed">Close</button>' : '') + (st === 'draft' || st === 'sent' ? '<button class="btn sm outline" data-status="' + esc(po.id) + ':cancelled">Cancel</button>' : '') + '<button class="btn sm red" data-del="' + esc(po.id) + '">Delete</button></td></tr>'; }),
        'No purchase orders yet. Make one with + Purchase Order, from a requisition, or from Compare Quotes.');
    },
    reqList() {
      const list = of('REQ');
      return Ledger.listTable(['No', 'Date', 'Needed by', 'Requested by', 'Items', 'Order', 'Status', ''], list.map(r => '<tr>' + Ledger.td('No', link(r.no)) + Ledger.td('Date', esc(r.date)) + Ledger.td('Needed by', esc(r.needBy || '-')) + Ledger.td('Requested by', esc(r.requestedBy || '-')) + Ledger.td('Items', itemsText(r)) + Ledger.td('Order', r.poNo ? U.noLink(r.poNo) : '-') + Ledger.td('Status', pill(r.status || 'open')) +
        '<td class="actions"><button class="btn sm outline" data-mail="' + esc(r.id) + '" title="Email the requisition">Email</button>' + (r.status === 'open' || !r.status ? '<button class="btn sm green" data-topo="' + esc(r.id) + '">Make PO</button><button class="btn sm outline" data-status="' + esc(r.id) + ':closed">Close</button>' : '') + '<button class="btn sm red" data-del="' + esc(r.id) + '">Delete</button></td></tr>'),
        'No requisitions yet. A requisition lists what is needed and by when; Low Stock fills one from the reorder levels.');
    },
    grnList() {
      const list = of('GRN');
      return Ledger.listTable(['No', 'Date', 'Order', 'Supplier', 'Received', 'Supplier invoice', 'Bill', ''], list.map(g => { const bill = billOf(g); return '<tr>' + Ledger.td('No', link(g.no)) + Ledger.td('Date', esc(g.date)) + Ledger.td('Order', U.noLink(g.poNo)) + Ledger.td('Supplier', esc(g.supplier || '-')) + Ledger.td('Received', itemsText(g)) + Ledger.td('Supplier invoice', esc(g.supplierInv || '-')) + Ledger.td('Bill', bill ? U.noLink(bill.no) : '<span class="pill warn">Not yet</span>') +
        '<td class="actions">' + (bill ? '' : '<button class="btn sm green" data-bill="' + esc(g.id) + '">Make bill</button>') + '<button class="btn sm red" data-del="' + esc(g.id) + '">Delete</button></td></tr>'; }),
        'No goods receipts yet. Receive against a purchase order; a receipt becomes the purchase bill.');
    },
    // Items at or under their reorder level (the item master's Reorder level, 0 = out of stock), with the open orders for them
    lowStock() {
      const stock = Books.stock(null), onOrder = {}; of('PO').forEach(po => { const st = poStatus(po); if (st === 'draft' || st === 'sent' || st === 'partly') (po.items || []).forEach(it => { onOrder[String(it.name).toLowerCase()] = (onOrder[String(it.name).toLowerCase()] || 0) + num(it.qty); }); });
      const rows = Store.items().map(i => { const s = stock.find(r => String(r.name).toLowerCase() === String(i.name).toLowerCase()), hand = s ? s.onHand : 0, min = global.Inv ? num(Inv.attr(i.name).minStock) : num(i.minStock); return { i, hand, min, low: hand <= min, order: onOrder[String(i.name).toLowerCase()] || 0 }; });
      const low = rows.filter(r => r.low);
      return '<div class="btnrow"><button class="btn sm green" data-lowreq="1"' + (low.length ? '' : ' disabled') + '>Requisition for the ' + low.length + ' low item' + (low.length === 1 ? '' : 's') + '</button><span class="hint">Reorder level per item below; an item at or under it is low</span></div>' +
        Ledger.listTable(['Item', '#In hand', '#Reorder level', '#On order', 'Status'], rows.sort((a, b) => (b.low - a.low) || a.i.name.localeCompare(b.i.name)).map(r => '<tr data-low="' + (r.low ? 1 : 0) + '" data-name="' + esc(r.i.name) + '" data-short="' + Math.max(0, r.min - r.hand + (r.min ? r.min : 1)) + '">' + Ledger.td('Item', '<b>' + esc(r.i.name) + '</b>') + Ledger.td('In hand', U.fmtQty(r.hand), 'num') + Ledger.td('Reorder level', '<input type="number" min="0" step="any" data-min="' + esc(r.i.id) + '" value="' + (r.min || '') + '" style="width:90px;min-height:32px;text-align:right">', 'num') + Ledger.td('On order', r.order ? U.fmtQty(r.order) : '-', 'num') + Ledger.td('Status', r.low ? '<span class="pill bad">Low</span>' : '<span class="pill ok">OK</span>') + '</tr>'),
          'No items in the item master yet.');
    },
    lowToReq(root) {
      const items = $$('tr[data-low="1"]', root).map(tr => Object.assign(blankLine(), { name: tr.dataset.name, qty: num(tr.dataset.short) || 1 }));
      if (!items.length) return UI.toast('Nothing is low');
      this.edit({ kind: 'REQ', items, notes: 'Low stock on ' + U.today() });
    },
    // The quotations under Purchases, item by item: each supplier's rate, the cheapest marked
    quotes() {
      const qs = Store.list('purchases').filter(p => p.kind === 'QTN'), items = {};
      qs.forEach(q => (q.items || []).forEach(it => { const k = String(it.name).trim().toLowerCase(); if (!k) return; items[k] = items[k] || { name: it.name, offers: [] }; items[k].offers.push({ supplier: q.supplier || '(no supplier)', gstin: q.supplierGstin, rate: num(it.rate), gst: it.gst, hsn: it.hsn, uqc: it.uqc, qty: num(it.qty), no: q.no, date: q.date }); }));
      const list = Object.values(items).sort((a, b) => a.name.localeCompare(b.name));
      if (!list.length) return '<div class="empty">No quotations to compare. Record each supplier\'s quotation under Purchases (+ Quotation); every item quoted shows up here with the rates side by side.</div>';
      const suppliers = Array.from(new Set(list.flatMap(x => x.offers.map(o => o.supplier))));
      return '<div class="btnrow"><button class="btn sm green" data-quotepo="best">Purchase orders from the cheapest</button><span class="hint">One order per supplier, each item at its lowest quoted rate</span></div>' +
        Ledger.listTable(['Item'].concat(suppliers.map(s => '#' + s)).concat(['Cheapest']), list.map(x => { const best = x.offers.reduce((m, o) => o.rate > 0 && (!m || o.rate < m.rate) ? o : m, null); return '<tr>' + Ledger.td('Item', '<b>' + esc(x.name) + '</b>') + suppliers.map(s => { const o = x.offers.filter(f => f.supplier === s).sort((a, b) => U.dateMs(b.date) - U.dateMs(a.date))[0]; return Ledger.td(s, o ? (best && o === best ? '<b class="green">' : '<span>') + U.indianNumber(o.rate) + (best && o === best ? '</b>' : '</span>') + '<div class="small muted">' + U.noLink(o.no) + '</div>' : '-', 'num'); }).join('') + Ledger.td('Cheapest', best ? esc(best.supplier) : '-') + '</tr>'; }));
    },
    quotesToPo() {
      const qs = Store.list('purchases').filter(p => p.kind === 'QTN'), best = {};
      qs.forEach(q => (q.items || []).forEach(it => { const k = String(it.name).trim().toLowerCase(), r = num(it.rate); if (!k || r <= 0) return; if (!best[k] || r < best[k].rate) best[k] = { name: it.name, rate: r, gst: it.gst, hsn: it.hsn, uqc: it.uqc, qty: num(it.qty) || 1, supplier: q.supplier || '', gstin: q.supplierGstin || '' }; }));
      const bySup = {}; Object.values(best).forEach(b => { (bySup[b.supplier] = bySup[b.supplier] || []).push(b); });
      const sups = Object.keys(bySup); if (!sups.length) return UI.toast('No quoted rates to order from');
      UI.confirm('Purchase orders from the quotes', sups.length + ' purchase order' + (sups.length === 1 ? '' : 's') + ' (' + sups.join(', ') + ') with every item at its cheapest quoted rate. Make them as drafts?', () => {
        sups.forEach(sname => { const d = totals({ kind: 'PO', no: nextNo('PO'), date: U.today(), status: 'draft', supplier: sname, supplierGstin: bySup[sname][0].gstin, expected: '', terms: '', notes: 'From the quotations compared on ' + U.today(), items: bySup[sname].map(b => ({ name: b.name, hsn: b.hsn || '', qty: b.qty, uqc: b.uqc || 'NOS', rate: b.rate, gst: String(b.gst || '18') })) }); save(d); });
        UI.toast(sups.length + ' purchase order' + (sups.length === 1 ? '' : 's') + ' made as drafts'); App.go('procurement', { tab: 'po' });
      }, 'Make orders');
    },
    reqToPo(req) {
      this.edit({ kind: 'PO', reqNo: req.no, items: JSON.parse(JSON.stringify(req.items || [])), expected: req.needBy || '', notes: 'Against requisition ' + req.no }, (po) => { req.status = 'ordered'; req.poNo = po.no; save(req); });
    },
    // The editor of a requisition or a purchase order (a receipt is made through Receive)
    edit(d, onSaved) {
      const fresh = !d.id, isPo = d.kind === 'PO';
      d = Object.assign({ kind: 'PO', no: '', date: U.today(), status: isPo ? 'draft' : 'open', supplier: '', supplierGstin: '', expected: '', needBy: '', requestedBy: '', terms: '', notes: '', items: [], inclusive: false }, JSON.parse(JSON.stringify(d)));
      if (fresh && !d.no) d.no = nextNo(d.kind);
      if (!d.items.length) d.items.push(blankLine());
      const suppliers = Biz.contactsOf('Supplier'), emps = global.HR ? HR.employees() : [];
      const rowsHtml = () => d.items.map((it, i) => '<tr data-i="' + i + '">' + Ledger.td('Item', '<input data-k="name" list="prItemsDl" placeholder="Item name" value="' + esc(it.name) + '">', 'desc') + Ledger.td('HSN', '<input data-k="hsn" class="num" value="' + esc(it.hsn) + '">', 'hsn') + Ledger.td('Qty', '<input data-k="qty" class="num" type="number" step="any" min="0" value="' + esc(it.qty) + '">', 'qty') + Ledger.td('Unit', UI.select('', U.UQC_CODES, it.uqc, { attrs: ' data-k="uqc"' }), 'uqc') + (isPo ? Ledger.td('Rate', '<input data-k="rate" class="num" type="number" step="any" min="0" value="' + esc(it.rate) + '">', 'rate') + Ledger.td('GST %', UI.select('', U.GST_RATES.map(r => [r, r + '%']), it.gst, { attrs: ' data-k="gst"' }), 'gst') : '') + '<td class="del"><button class="delbtn" title="Remove" data-del>🗑</button></td></tr>').join('');
      const bg = UI.modal({ title: (fresh ? 'New ' : 'Edit ') + KINDS[d.kind], wide: true, body: '<div class="grid3">' +
        UI.field(KINDS[d.kind] + ' No', UI.input('prNo', d.no)) + UI.field('Date', UI.dateInput('prDate', d.date), { req: true }) +
        (isPo ? UI.field('Expected delivery', UI.dateInput('prExp', d.expected)) + UI.field('Supplier', UI.input('prSup', d.supplier, { list: 'prSupDl', placeholder: 'Supplier name' }) + UI.datalist('prSupDl', suppliers.map(s => s.name)), { req: true }) + UI.field('Supplier GSTIN', UI.input('prGstin', d.supplierGstin, { attrs: ' maxlength="15" style="text-transform:uppercase"' })) + UI.field('Status', UI.select('prStatus', [['draft', 'Draft'], ['sent', 'Sent to supplier']], d.status === 'sent' ? 'sent' : 'draft'))
          : UI.field('Needed by', UI.dateInput('prNeed', d.needBy)) + UI.field('Requested by', UI.input('prReq', d.requestedBy, { list: 'prEmpDl' }) + UI.datalist('prEmpDl', emps.map(e => e.name))) + UI.field('Status', UI.select('prStatus', [['open', 'Open'], ['closed', 'Closed']], d.status || 'open'))) + '</div>' +
        '<div class="tablewrap" style="margin-top:8px"><table class="items"><thead><tr><th>Item</th><th class="hsn">HSN</th><th class="qty">Qty</th><th class="uqc">Unit</th>' + (isPo ? '<th class="rate">Rate</th><th class="gst">GST %</th>' : '') + '<th class="del"></th></tr></thead><tbody id="prRows">' + rowsHtml() + '</tbody></table></div>' + UI.datalist('prItemsDl', Biz.itemLabels()) +
        '<div class="btnrow"><button class="btn sm" id="prAdd">+ Add Item</button></div>' + (isPo ? '<div class="totals" id="prTot"></div>' + UI.field('Terms (delivery, payment, warranty)', '<textarea id="prTerms" placeholder="e.g. Delivery within 7 days. Payment 30 days from receipt. Goods to be replaced if damaged.">' + esc(d.terms) + '</textarea>') : '') + UI.field('Notes', '<textarea id="prNotes">' + esc(d.notes) + '</textarea>'),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const v = (id) => UI.val(id, bg);
          if (!UI.dateVal('prDate', bg)) { UI.toast('Date is required'); return false; }
          const items = [];
          for (const it of d.items) {
            const m = Biz.findMaster(it.name), name = m && !m.hidden ? m.name : U.nameCase(it.name);
            if (!name && !num(it.qty)) continue;
            if (!name) { UI.toast('Item name is required'); return false; }
            if (num(it.qty) <= 0) { UI.toast('Enter the quantity for ' + name); return false; }
            if (isPo && num(it.rate) < 0) { UI.toast('Enter the rate for ' + name); return false; }
            items.push({ name, hsn: String(it.hsn || '').trim() || (m ? m.hsn || '' : ''), qty: num(it.qty), uqc: it.uqc || 'NOS', rate: isPo ? num(it.rate) : 0, gst: String(it.gst || '18') });
          }
          if (!items.length) { UI.toast('Add at least one item'); return false; }
          if (isPo) {
            if (!v('prSup').trim()) { UI.mark('prSup', true, bg); UI.toast('Supplier is required on a purchase order'); return false; }
            if (!U.isValidGstin(v('prGstin'))) { UI.mark('prGstin', true, bg); UI.toast('Enter a valid supplier GSTIN (15 characters)'); return false; }
            Object.assign(d, { no: v('prNo').trim() || nextNo('PO'), date: UI.dateVal('prDate', bg), expected: UI.dateVal('prExp', bg), supplier: (suppliers.find(x => x.name.toLowerCase() === v('prSup').trim().toLowerCase()) || { name: U.nameCase(v('prSup')) }).name, supplierGstin: v('prGstin').trim().toUpperCase(), status: v('prStatus'), terms: v('prTerms').trim(), notes: v('prNotes').trim(), items });
            totals(d);
          } else Object.assign(d, { no: v('prNo').trim() || nextNo('REQ'), date: UI.dateVal('prDate', bg), needBy: UI.dateVal('prNeed', bg), requestedBy: v('prReq').trim(), status: v('prStatus'), notes: v('prNotes').trim(), items });
          save(d); UI.toast(KINDS[d.kind] + ' ' + d.no + ' saved');
          if (onSaved) onSaved(d);
          App.go('procurement', { tab: isPo ? 'po' : 'req' });
        } }] });
      const tot = () => { if (!isPo) return; totals(d); $('#prTot', bg).innerHTML = '<div><span>Taxable</span><b>' + money(d.taxable) + '</b></div><div><span>GST</span><span>' + money(d.gst) + '</span></div><div class="line"><span>Order value</span><b>' + money(d.total) + '</b></div>'; };
      const wire = () => {
        $$('#prRows tr', bg).forEach(tr => { const i = +tr.dataset.i; $$('[data-k]', tr).forEach(el => { const on = () => { d.items[i][el.dataset.k] = el.value; if (el.dataset.k === 'name') { const m = Biz.findMaster(el.value); if (m && !m.hidden) { if (!d.items[i].hsn) { d.items[i].hsn = m.hsn || ''; $('[data-k=hsn]', tr).value = d.items[i].hsn; } if (isPo && !num(d.items[i].rate) && num(m.rate) > 0) { d.items[i].rate = m.rate; $('[data-k=rate]', tr).value = m.rate; } if (m.gst != null && isPo) { d.items[i].gst = String(m.gst); $('[data-k=gst]', tr).value = String(m.gst); } } } tot(); }; el.addEventListener('input', on); el.addEventListener('change', on); });
          $('[data-del]', tr).onclick = () => { d.items.splice(i, 1); if (!d.items.length) d.items.push(blankLine()); $('#prRows', bg).innerHTML = rowsHtml(); wire(); tot(); }; });
      };
      wire(); tot();
      $('#prAdd', bg).onclick = () => { d.items.push(blankLine()); $('#prRows', bg).innerHTML = rowsHtml(); wire(); const last = $$('#prRows tr', bg).pop(); if (last) $('[data-k=name]', last).focus(); };
      if (isPo) $('#prSup', bg).addEventListener('change', () => { const s = suppliers.find(x => x.name.toLowerCase() === $('#prSup', bg).value.trim().toLowerCase()); if (s && s.gstin && !$('#prGstin', bg).value) $('#prGstin', bg).value = s.gstin; });
      return bg;
    },
    // Goods received against an order: how much of each line came now (the rest stays open), the date and the supplier's invoice number
    receive(po, done) {
      const r = received(po), lines = (po.items || []).map(it => { const got = r.got[String(it.name).toLowerCase()] || 0; return { it, got, left: Math.max(0, num(it.qty) - got) }; });
      const bg = UI.modal({ title: 'Receive against ' + po.no, wide: true, body: '<div class="grid3">' + UI.field('Receipt date', UI.dateInput('gDate', U.today()), { req: true }) + UI.field('Supplier invoice / challan no', UI.input('gInv', '')) + UI.field('Received by', UI.input('gBy', (App.user && App.user.name) || '')) + '</div>' +
        '<div class="tablewrap" style="margin-top:8px"><table class="list"><thead><tr><th class="left">Item</th><th class="num">Ordered</th><th class="num">Received so far</th><th class="num">Receive now</th></tr></thead><tbody>' +
        lines.map((l, i) => '<tr><td class="left"><b>' + esc(l.it.name) + '</b></td><td class="num">' + U.fmtQty(l.it.qty) + ' ' + esc(l.it.uqc || '') + '</td><td class="num">' + U.fmtQty(l.got) + '</td><td class="num"><input type="number" min="0" step="any" data-now="' + i + '" value="' + (l.left || '') + '" style="width:100px;min-height:32px;text-align:right"' + (l.left ? '' : ' disabled') + '></td></tr>').join('') + '</tbody></table></div>' + UI.field('Notes', '<textarea id="gNotes" placeholder="Damaged, short, rejected ..."></textarea>'),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Receive', cls: 'green', onClick: (bg) => {
          const date = UI.dateVal('gDate', bg); if (!date) { UI.toast('Enter the receipt date'); return false; }
          const items = lines.map((l, i) => ({ l, q: num(($('[data-now="' + i + '"]', bg) || {}).value) })).filter(x => x.q > 0).map(x => ({ name: x.l.it.name, hsn: x.l.it.hsn || '', qty: Math.min(x.q, x.l.left), uqc: x.l.it.uqc || 'NOS', rate: num(x.l.it.rate), gst: String(x.l.it.gst || '18') }));
          if (!items.length) { UI.toast('Enter what was received'); return false; }
          const g = save({ kind: 'GRN', no: nextNo('GRN'), date, poNo: po.no, supplier: po.supplier, supplierGstin: po.supplierGstin, supplierInv: UI.val('gInv', bg).trim(), receivedBy: UI.val('gBy', bg).trim(), notes: UI.val('gNotes', bg).trim(), items });
          const st = poStatus(po); if (po.status !== st) { po.status = st; save(po); }
          UI.toast(g.no + ' saved: ' + po.no + ' is ' + STATUS[poStatus(po)].toLowerCase(), 4000);
          if (done) done();
        } }] });
      return bg;
    },
    // The purchase bill of a receipt: the purchase editor opens with the received items as stock, the order and receipt named in the notes
    bill(g) {
      const po = byNo(g.poNo) || {};
      Ledger.Purchases.edit({ kind: 'PUR', date: g.date || U.today(), supplier: g.supplier || po.supplier || '', supplierGstin: g.supplierGstin || po.supplierGstin || '', paidBy: 'Credit', notes: ('Against ' + (g.poNo || '') + ' / ' + g.no + (g.supplierInv ? ' · supplier invoice ' + g.supplierInv : '')).trim(), items: (g.items || []).map(it => ({ name: it.name, hsn: it.hsn || '', qty: num(it.qty), uqc: it.uqc || 'NOS', rate: num(it.rate), gst: String(it.gst || '18'), stock: true })) });
    }
  };
  App.routes.procurement = (p) => Procure.screen(p || {});
  global.Procure = Procure;
})(window);
