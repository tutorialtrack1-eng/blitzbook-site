/* BlitzBook web portal - Migrate to BlitzBook from Tally, SAP, Zoho Books, Vyapar, Busy, Marg, QuickBooks or any
   spreadsheet. Two roads in, both entirely in the browser (nothing is uploaded anywhere):
     - a Tally XML export (masters and / or vouchers): ledgers under Sundry Debtors / Creditors become customers and
       suppliers, stock items become items (HSN, GST rate, unit, opening stock), Sales vouchers become invoices and
       Purchase vouchers purchase bills; opening balances of the parties go in as one journal voucher;
     - a CSV / Excel sheet of customers, suppliers, items, sales invoices or purchase bills from any software: the
       header row is matched to BlitzBook's fields by name (SAP field names such as KUNNR, STCD3, VBELN, FKDAT,
       MAKTX included), the user corrects the mapping, previews what will happen and imports.
   Records already in the books (by name or document number) are updated or left alone, as every upload here does
   (Upsert / Insert only); a document number already in the books is never overwritten. Everything goes through
   Store, so a synced account sends the migrated books to the app and the other devices by itself. */
(function (global) {
  'use strict';
  const { esc, num, money } = U;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
  const lower = (s) => String(s == null ? '' : s).trim().toLowerCase();
  // GST slabs a derived rate is snapped to (what the books carry as the line's rate)
  const SLABS = [0, 0.25, 3, 5, 12, 18, 28, 40];
  const snapRate = (r) => { r = num(r); let best = SLABS[0]; SLABS.forEach(s => { if (Math.abs(s - r) < Math.abs(best - r)) best = s; }); return String(best); };
  // Tally's unit names to the GST unit codes the books use
  const UNITS = { nos: 'NOS', no: 'NOS', num: 'NOS', numbers: 'NOS', pcs: 'PCS', pc: 'PCS', piece: 'PCS', pieces: 'PCS', kg: 'KGS', kgs: 'KGS', kilogram: 'KGS', kilograms: 'KGS', gm: 'GMS', gms: 'GMS', grams: 'GMS', ltr: 'LTR', lt: 'LTR', litre: 'LTR', litres: 'LTR', liter: 'LTR', ml: 'MLT', mtr: 'MTR', mtrs: 'MTR', meter: 'MTR', metre: 'MTR', meters: 'MTR', box: 'BOX', boxes: 'BOX', bag: 'BAG', bags: 'BAG', set: 'SET', sets: 'SET', pair: 'PRS', pairs: 'PRS', doz: 'DOZ', dozen: 'DOZ', bdl: 'BDL', bundle: 'BDL', bundles: 'BDL', btl: 'BTL', bottle: 'BTL', bottles: 'BTL', can: 'CAN', cans: 'CAN', ctn: 'CTN', carton: 'CTN', cartons: 'CTN', drm: 'DRM', drum: 'DRM', pac: 'PAC', pack: 'PAC', packs: 'PAC', packet: 'PAC', packets: 'PAC', roll: 'ROL', rolls: 'ROL', sqf: 'SQF', sqft: 'SQF', sqm: 'SQM', sqmt: 'SQM', ton: 'TON', tons: 'TON', tonne: 'TON', tub: 'TUB', unt: 'UNT', unit: 'UNT', units: 'UNT', ea: 'NOS', each: 'NOS', st: 'PCS', pce: 'PCS' };
  function uqcOf(u) { const k = lower(u).replace(/[^a-z]/g, ''); if (!k) return 'NOS'; if (UNITS[k]) return UNITS[k]; const up = k.toUpperCase(); return U.UQC_CODES.includes(up) ? up : 'OTH'; }
  const paymentOf = (v) => { const s = lower(v); if (!s) return 'Credit'; if (/cash/.test(s)) return 'Cash'; if (/credit|due|unpaid|net\s*\d|days|pending|receivable|payable/.test(s)) return 'Credit'; if (/cheque|check|chq/.test(s)) return 'Cheque'; if (/online|upi|neft|rtgs|imps|bank|card|transfer|paid/.test(s)) return 'Online'; const m = U.PAYMENT_MODES.find(p => p.toLowerCase() === s); return m || 'Credit'; };
  const sellerCode = () => { const g = (Store.company().gstin || '').trim(); return /^\d{2}/.test(g) ? g.slice(0, 2) : '37'; };
  const sellerState = () => U.stateByCode(sellerCode()) || U.STATES[0];
  const stateOf = (state, gstin) => U.matchState(state, gstin) || '';
  const digits = (s) => { const d = String(s || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };
  const cleanGstin = (g) => { g = String(g || '').trim().toUpperCase(); return g && U.isValidGstin(g) ? g : ''; };
  // 1 April of the running financial year: the date opening balances and opening stock are booked on
  function fyStart() { const d = new Date(), y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return '01/04/' + y; }
  function dateOf(v) {
    v = String(v == null ? '' : v).trim(); if (!v) return '';
    const t = /^(\d{4})(\d{2})(\d{2})$/.exec(v); if (t) return t[3] + '/' + t[2] + '/' + t[1];               // Tally: 20260915
    const d = U.sheetDate(v); if (/^\d{2}\/\d{2}\/\d{4}$/.test(d) && U.dateMs(d)) return d;
    const m = /^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ,]+(\d{2,4})$/.exec(v);                           // 15-Sep-2026, 15 Sep 26
    if (m) { const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase().slice(0, 3)); if (mo >= 0) return U.pad(+m[1]) + '/' + U.pad(mo + 1) + '/' + (m[3].length === 2 ? '20' + m[3] : m[3]); }
    const dt = new Date(v); return isNaN(dt) ? '' : U.pad(dt.getDate()) + '/' + U.pad(dt.getMonth() + 1) + '/' + dt.getFullYear();
  }
  // "100.00/Nos" -> 100, " 10 Nos" -> 10, "-1,180.00" -> -1180 (Tally writes debits as negatives)
  const amt = (s) => { const m = /-?[\d,]*\.?\d+/.exec(String(s == null ? '' : s).replace(/\s/g, '')); return m ? num(m[0].replace(/,/g, '')) : 0; };
  const unitIn = (s) => { const m = /[\d.,]+\s*([A-Za-z]+)/.exec(String(s || '')); return m ? m[1] : ''; };

  // ------------------------------------------------------------ a tolerant XML reader
  // Tally files are large, flat and often carry a bare "&" in a party name, which DOMParser refuses; this reader
  // takes them as they come and works in Node too (tools/migrate.js). Nodes: {tag, attrs, kids, text}.
  const unesc = (t) => String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&');
  function parseXml(src) {
    const root = { tag: '#ROOT', attrs: {}, kids: [], text: '' }, stack = [root];
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(String(src || '')))) {
      const cur = stack[stack.length - 1];
      if (m[1] != null) cur.text += m[1];
      else if (m[2]) { const t = m[2].toUpperCase(); for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === t) { stack.length = i; break; } }
      else if (m[3]) {
        const node = { tag: m[3].toUpperCase(), attrs: {}, kids: [], text: '' };
        String(m[4] || '').replace(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g, (a, k, v1, v2, v3) => { node.attrs[k.toUpperCase()] = unesc(v1 != null ? v1 : v2 != null ? v2 : v3); return a; });
        cur.kids.push(node);
        if (!m[5]) stack.push(node);
      } else if (m[6] != null) cur.text += unesc(m[6]);
    }
    return root;
  }
  const kids = (n, tag) => n ? n.kids.filter(k => k.tag === tag) : [];
  const kid = (n, tag) => kids(n, tag)[0] || null;
  const text = (n) => n ? n.text.trim() : '';
  const txt = (n, tag) => text(kid(n, tag));
  // First non-empty text among several tag names, looked for among the children then anywhere below
  function first(n, tags, deep) { for (const t of tags) { const v = txt(n, t); if (v) return v; } if (deep) for (const t of tags) { const v = find(n, t).map(text).find(Boolean); if (v) return v; } return ''; }
  function find(n, tag, out) { out = out || []; if (!n) return out; n.kids.forEach(k => { if (k.tag === tag) out.push(k); find(k, tag, out); }); return out; }
  const listText = (n, listTag, itemTag) => kids(n, listTag).map(l => kids(l, itemTag).map(text).filter(Boolean).join('\n')).filter(Boolean).join('\n');

  // ------------------------------------------------------------ Tally XML
  // GST rate out of a GSTDETAILS / RATEDETAILS block: the IGST head, else twice the CGST head
  function tallyRate(n) {
    let igst = '', cgst = '';
    find(n, 'RATEDETAILS.LIST').forEach(r => { const head = lower(txt(r, 'GSTRATEDUTYHEAD')), rate = txt(r, 'GSTRATE'); if (!rate) return; if (/igst|integrated/.test(head) && !igst) igst = rate; if (/cgst|central/.test(head) && !cgst) cgst = rate; });
    if (igst) return String(num(igst)); if (cgst) return String(num(cgst) * 2);
    const flat = first(n, ['GSTRATE', 'IGSTRATE'], true); return flat ? String(num(flat)) : '';
  }
  const partyKind = (parent) => /debtor|customer|receivable/.test(lower(parent)) ? 'Customer' : /creditor|supplier|vendor|payable/.test(lower(parent)) ? 'Supplier' : '';
  const nameOf = (n) => n.attrs.NAME || text(kid(kid(kid(n, 'LANGUAGENAME.LIST'), 'NAME.LIST'), 'NAME')) || txt(n, 'NAME');
  /** A Tally XML export (Masters, Vouchers or both) as BlitzBook records: {contacts, items, invoices, purchases, skipped, warn}. */
  function parseTallyXml(xml) {
    const root = parseXml(xml);
    const out = { source: 'Tally', contacts: [], items: [], invoices: [], purchases: [], skipped: { ledgers: 0, vouchers: 0 }, warn: [] };
    if (!find(root, 'TALLYMESSAGE').length && !find(root, 'LEDGER').length && !find(root, 'STOCKITEM').length && !find(root, 'VOUCHER').length) throw new Error('This is not a Tally XML export (no TALLYMESSAGE, LEDGER, STOCKITEM or VOUCHER in it). In Tally: Gateway of Tally > Display More Reports > List of Accounts (or Day Book) > Export, format XML.');
    const ledgerNames = new Map();
    find(root, 'LEDGER').forEach(n => {
      if (lower(n.attrs.ACTION) === 'delete') return;
      const name = nameOf(n); if (!name) return;
      const type = partyKind(txt(n, 'PARENT'));
      ledgerNames.set(lower(name), type || 'other');
      if (!type) { out.skipped.ledgers++; return; }
      const gstinRaw = first(n, ['PARTYGSTIN', 'GSTIN'], true), gstin = cleanGstin(gstinRaw);
      if (gstinRaw && !gstin) out.warn.push(name + ': GSTIN "' + gstinRaw + '" is not valid and was left out');
      const address = listText(n, 'ADDRESS.LIST', 'ADDRESS') || listText(n, 'MAILINGNAME.LIST', 'MAILINGNAME');
      // Tally writes debit balances as negative numbers: a customer owing 5,000 exports as -5000.00
      const opening = -amt(txt(n, 'OPENINGBALANCE'));
      out.contacts.push({ type, name, phone: digits(first(n, ['LEDGERMOBILE', 'LEDGERPHONE', 'LEDGERCONTACT'])), email: lower(first(n, ['EMAIL', 'EMAILCC'])), gstin, address, state: stateOf(first(n, ['LEDSTATENAME', 'STATENAME', 'PRIORSTATENAME'], true), gstin), opening: r2(opening) });
    });
    const itemRate = new Map(), itemHsn = new Map();
    find(root, 'STOCKITEM').forEach(n => {
      if (lower(n.attrs.ACTION) === 'delete') return;
      const name = nameOf(n); if (!name) return;
      const hsn = first(n, ['HSNCODE', 'HSN', 'GSTHSNCODE'], true).replace(/\D/g, ''), gst = tallyRate(n), parent = txt(n, 'PARENT');
      const qtyText = txt(n, 'OPENINGBALANCE'), qty = Math.abs(amt(qtyText)), rate = Math.abs(amt(txt(n, 'OPENINGRATE'))) || (qty ? Math.abs(amt(txt(n, 'OPENINGVALUE'))) / qty : 0);
      itemRate.set(lower(name), gst); itemHsn.set(lower(name), hsn);
      out.items.push({ name, code: txt(n, 'ALIAS') || text(kids(kid(kid(n, 'LANGUAGENAME.LIST'), 'NAME.LIST'), 'NAME')[1]) || '', category: parent && !/^primary$/i.test(parent) ? parent : '', hsn, gst, rate: '', uqc: uqcOf(txt(n, 'BASEUNITS') || unitIn(qtyText)), qty: r2(qty), cost: r2(rate) });
    });
    const taxOf = (v) => {
      const t = { cgst: 0, sgst: 0, igst: 0, cash: false, party: '' };
      ['LEDGERENTRIES.LIST', 'ALLLEDGERENTRIES.LIST'].forEach(tag => kids(v, tag).forEach(l => {
        const ln = lower(txt(l, 'LEDGERNAME')), a = Math.abs(amt(txt(l, 'AMOUNT')));
        if (/\bcgst\b|central tax/.test(ln)) t.cgst += a; else if (/\bsgst\b|\butgst\b|state tax/.test(ln)) t.sgst += a; else if (/\bigst\b|integrated tax/.test(ln)) t.igst += a;
        else if (/^cash/.test(ln)) t.cash = true;
        else if (lower(txt(l, 'ISPARTYLEDGER')) === 'yes' && !t.party) t.party = txt(l, 'LEDGERNAME');
      }));
      return t;
    };
    find(root, 'VOUCHER').forEach(v => {
      if (lower(v.attrs.ACTION) === 'delete' || lower(txt(v, 'ISCANCELLED')) === 'yes' || lower(txt(v, 'ISOPTIONAL')) === 'yes') return;
      const type = lower(v.attrs.VCHTYPE || txt(v, 'VOUCHERTYPENAME') || txt(v, 'PERSISTEDVIEW'));
      const sale = /sales|sale/.test(type) && !/return|credit/.test(type), purchase = /purchase/.test(type) && !/return|debit|order/.test(type);
      if (!sale && !purchase) { out.skipped.vouchers++; return; }
      const no = first(v, ['VOUCHERNUMBER', 'REFERENCE']), date = dateOf(first(v, ['DATE', 'EFFECTIVEDATE'])), tax = taxOf(v);
      const party = first(v, ['PARTYLEDGERNAME', 'PARTYNAME', 'BASICBUYERNAME']) || tax.party;
      if (!date) { out.warn.push((sale ? 'Sales' : 'Purchase') + ' voucher ' + (no || '(no number)') + ' has no readable date and was skipped'); out.skipped.vouchers++; return; }
      const gstin = cleanGstin(first(v, ['PARTYGSTIN', 'CONSIGNEEGSTIN', 'GSTIN'], true));
      const lines = [];
      ['ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST', 'INVENTORYENTRIESIN.LIST'].forEach(tag => kids(v, tag).forEach(e => {
        const name = txt(e, 'STOCKITEMNAME'); if (!name) return;
        const qtyText = txt(e, 'ACTUALQTY') || txt(e, 'BILLEDQTY'), qty = Math.abs(amt(qtyText)), amount = Math.abs(amt(txt(e, 'AMOUNT'))), rate = Math.abs(amt(txt(e, 'RATE'))) || (qty ? amount / qty : 0);
        lines.push({ desc: name, hsn: (first(e, ['GSTHSNCODE', 'HSNCODE'], true) || itemHsn.get(lower(name)) || '').replace(/\D/g, ''), qty: r2(qty), uqc: uqcOf(unitIn(qtyText) || unitIn(txt(e, 'RATE'))), rate: r2(rate), gst: tallyRate(e) || itemRate.get(lower(name)) || '', amount: r2(amount) });
      }));
      // An accounting-only voucher (no stock items): the sales / purchase ledgers are the lines, one unit each
      if (!lines.length) ['LEDGERENTRIES.LIST', 'ALLLEDGERENTRIES.LIST'].forEach(tag => kids(v, tag).forEach(l => {
        const ln = txt(l, 'LEDGERNAME'), k = lower(ln), a = Math.abs(amt(txt(l, 'AMOUNT')));
        if (!ln || !a || k === lower(party) || /gst|cess|round|cash|bank|tds|tcs|discount/.test(k) || lower(txt(l, 'ISPARTYLEDGER')) === 'yes') return;
        if (ledgerNames.get(k) === 'Customer' || ledgerNames.get(k) === 'Supplier') return;
        lines.push({ desc: ln, hsn: '', qty: 1, uqc: 'NOS', rate: r2(a), gst: tallyRate(l) || '', amount: r2(a) });
      }));
      if (!lines.length) { out.warn.push((sale ? 'Sales' : 'Purchase') + ' voucher ' + (no || date) + ' has no items and was skipped'); out.skipped.vouchers++; return; }
      const taxable = lines.reduce((s, l) => s + l.amount, 0), totalTax = tax.cgst + tax.sgst + tax.igst;
      const derived = taxable > 0 && totalTax > 0 ? snapRate(totalTax / taxable * 100) : '0';
      lines.forEach(l => { l.gst = l.gst !== '' ? snapRate(l.gst) : derived; });
      const state = stateOf(first(v, ['PLACEOFSUPPLY', 'STATENAME', 'CONSIGNEESTATENAME', 'PARTYSTATENAME'], true), gstin) || (tax.igst > 0 ? '' : sellerState());
      const address = listText(v, 'BASICBUYERADDRESS.LIST', 'BASICBUYERADDRESS') || listText(v, 'ADDRESS.LIST', 'ADDRESS');
      const payment = tax.cash ? 'Cash' : 'Credit';
      if (sale) out.invoices.push({ no, date, party: { name: party, gstin, phone: '', email: '', address, state }, payment, orderNo: txt(v, 'BASICORDERREF') || '', items: lines });
      else out.purchases.push({ no, date, party: party, gstin, payment, items: lines.map(l => ({ name: l.desc, hsn: l.hsn, qty: l.qty, uqc: l.uqc, rate: l.rate, gst: l.gst })) });
    });
    return out;
  }

  // ------------------------------------------------------------ spreadsheets from any software
  // The BlitzBook fields of each kind of file, with the column headings they are recognised by (lower case, letters
  // and digits only). SAP's field names (KUNNR, STCD3, VBELN, FKDAT, MAKTX, MATNR, MEINS, NETWR ...) are in the lists,
  // so a plain SE16 / VF05 / FBL5N / MB52 download maps without renaming its columns.
  const SYN = {
    name: ['name', 'customername', 'suppliername', 'partyname', 'party', 'ledgername', 'ledger', 'companyname', 'billto', 'vendorname', 'vendor', 'contactname', 'displayname', 'customer', 'supplier', 'name1', 'kunnr', 'lifnr', 'accountname', 'customerdisplayname', 'vendordisplayname', 'client', 'clientname', 'firm', 'firmname', 'nameofcustomer', 'nameofsupplier', 'partyname1'],
    phone: ['phone', 'mobile', 'mobileno', 'mobilenumber', 'phoneno', 'phonenumber', 'contactno', 'contactnumber', 'telephone', 'telf1', 'telf2', 'mobilephone', 'workphone', 'contact', 'cellphone', 'whatsapp', 'whatsappno'],
    email: ['email', 'emailid', 'emailaddress', 'mail', 'mailid', 'smtpaddr', 'emailid1', 'emailaddress1'],
    gstin: ['gstin', 'gstno', 'gstnumber', 'gstinuin', 'gstinno', 'taxid', 'stcd3', 'taxnumber', 'gstregistrationnumber', 'gstidentificationnumber', 'taxregno', 'vatno', 'gstinnumber', 'gstregno', 'customergstin', 'suppliergstin', 'partygstin', 'gsttin', 'tin', 'vattin', 'taxregistrationnumber', 'gstinofcustomer'],
    address: ['address', 'billingaddress', 'addressline1', 'address1', 'street', 'stras', 'city', 'ort01', 'location', 'billingstreet', 'fulladdress', 'mailingaddress', 'addressline', 'add1', 'addr', 'addressline2', 'address2', 'area'],
    state: ['state', 'statename', 'placeofsupply', 'region', 'regio', 'billingstate', 'pos', 'statecode', 'customerstate', 'supplierstate', 'province', 'stateprovince'],
    opening: ['openingbalance', 'opening', 'balance', 'closingbalance', 'outstanding', 'amountdue', 'openingbal', 'openingamount', 'balancedue', 'dueamount', 'receivable', 'payable', 'currentbalance'],
    // "Material Description" before "Material": on an SAP sheet with both, the bare Material column is the code
    item: ['itemname', 'productname', 'materialdescription', 'maktx', 'itemdescription', 'arktx', 'stockitemname', 'stockitem', 'item', 'product', 'material', 'description', 'goods', 'service', 'servicename', 'particulars', 'details', 'name', 'nameofitem', 'productservice', 'itemservice', 'stockname'],
    code: ['code', 'itemcode', 'sku', 'skucode', 'productcode', 'matnr', 'materialno', 'materialnumber', 'partno', 'partnumber', 'alias', 'itemid', 'productid', 'barcode', 'itemno', 'productno', 'material'],
    category: ['category', 'group', 'stockgroup', 'productgroup', 'matkl', 'materialgroup', 'itemgroup', 'itemcategory', 'productcategory', 'type', 'producttype', 'itemtype', 'brand'],
    hsn: ['hsn', 'hsnsac', 'hsncode', 'saccode', 'sac', 'steuc', 'hsnsaccode', 'hsncodes', 'hsnno', 'hsnsacno', 'controlcode', 'hsnsaccodes', 'hsnorsac'],
    gst: ['gst', 'gstrate', 'gstpercent', 'taxrate', 'tax', 'taxpercent', 'igstrate', 'gstpct', 'taxpct', 'gstper', 'gstpercentage', 'rateofgst', 'taxpercentage', 'gstslab', 'igst', 'taxratepercent', 'gsttaxrate', 'intrastatetaxrate', 'interstatetaxrate', 'gstpercentage1', 'itemtax', 'itemtaxpercent', 'itemtaxrate', 'taxname', 'gsttax', 'vat', 'vatrate'],
    rate: ['rate', 'price', 'unitprice', 'sellingprice', 'saleprice', 'netpr', 'kbetr', 'unitrate', 'priceperunit', 'salesrate', 'rateperunit', 'listprice', 'mrp', 'basicrate', 'rateexcltax', 'rateexclgst', 'unitcost', 'pricebeforetax', 'rateperqty', 'salesprice', 'sellprice', 'standardrate'],
    uqc: ['unit', 'units', 'uqc', 'uom', 'meins', 'vrkme', 'baseunit', 'measure', 'unitofmeasure', 'unitofmeasurement', 'per', 'unitname', 'primaryunit', 'usageunit', 'unitcode', 'itemunit', 'qtyunit', 'baseunitofmeasure', 'salesunit'],
    qty: ['qty', 'quantity', 'fkimg', 'menge', 'kwmeng', 'openingstock', 'openingqty', 'stock', 'qtyinhand', 'closingstock', 'billedqty', 'actualqty', 'noofunits', 'quantityinhand', 'stockqty', 'stockquantity', 'nos', 'currentstock', 'qtysold', 'quantitysold', 'labst', 'openingquantity', 'unrestrictedstock', 'unrestricted', 'stockonhand', 'onhand', 'availablestock'],
    cost: ['purchaserate', 'costprice', 'cost', 'purchaseprice', 'buyingprice', 'landedcost', 'purchasecost', 'costperunit', 'stdprice', 'verpr', 'stprs', 'avgcost', 'averagecost'],
    no: ['invoiceno', 'invoicenumber', 'invoice', 'billno', 'billnumber', 'bill', 'vbeln', 'documentno', 'documentnumber', 'document', 'voucherno', 'vouchernumber', 'refno', 'referenceno', 'invno', 'belnr', 'xblnr', 'number', 'no', 'salesinvoiceno', 'purchaseinvoiceno', 'transactionno', 'invoiceid', 'billid', 'docno', 'vchno', 'txnno', 'serialno', 'invoicenumber1', 'purchaseno', 'orderid', 'receiptno'],
    date: ['date', 'invoicedate', 'billdate', 'fkdat', 'voucherdate', 'documentdate', 'bldat', 'budat', 'transactiondate', 'dateofinvoice', 'postingdate', 'txndate', 'docdate', 'vchdate', 'purchasedate', 'saledate', 'dateofbill', 'invdate', 'billingdate', 'erdat'],
    party: ['customer', 'customername', 'party', 'partyname', 'buyer', 'buyername', 'billto', 'client', 'clientname', 'kunnr', 'soldto', 'soldtoparty', 'ledger', 'customerdisplayname', 'name', 'name1', 'supplier', 'suppliername', 'vendor', 'vendorname', 'lifnr', 'seller', 'from', 'vendordisplayname', 'payee', 'billedto', 'customeraccount', 'account', 'companyname', 'consignee', 'partyledger', 'nameofparty'],
    amount: ['amount', 'lineamount', 'taxableamount', 'taxablevalue', 'netamount', 'netwr', 'value', 'subtotal', 'linetotal', 'basicamount', 'assessablevalue', 'taxable', 'amountbeforetax', 'amountexcltax', 'itemtotal', 'baseamount', 'netvalue', 'itemamount', 'total', 'grandtotal', 'invoiceamount', 'invoicevalue', 'billamount', 'totalamount'],
    payment: ['payment', 'paymentmode', 'modeofpayment', 'paymenttype', 'paidby', 'paymentterms', 'zterm', 'mode', 'paymentstatus', 'status', 'paidthrough', 'paymentmethod', 'terms'],
    orderNo: ['pono', 'ponumber', 'orderno', 'ordernumber', 'purchaseorderno', 'bstkd', 'custpono', 'customerpono', 'po', 'customerorderno', 'buyerorderno', 'purchaseordernumber', 'poref', 'orderref']
  };
  // field key, label, required, which synonyms (when not its own key)
  const CONTACT_FIELDS = [['name', 'Name', 1], ['phone', 'Phone'], ['email', 'Email'], ['gstin', 'GSTIN'], ['address', 'Address'], ['state', 'State'], ['opening', 'Opening balance']];
  const FIELDS = {
    customers: CONTACT_FIELDS, suppliers: CONTACT_FIELDS,
    items: [['name', 'Item name', 1, 'item'], ['code', 'Item code / SKU'], ['category', 'Category'], ['hsn', 'HSN / SAC'], ['gst', 'GST %'], ['rate', 'Selling price'], ['uqc', 'Unit'], ['qty', 'Opening stock qty'], ['cost', 'Purchase rate']],
    sales: [['no', 'Invoice no', 1], ['date', 'Invoice date', 1], ['party', 'Customer', 1], ['gstin', 'Customer GSTIN'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['state', 'State / place of supply'], ['item', 'Item', 1], ['hsn', 'HSN / SAC'], ['qty', 'Qty'], ['uqc', 'Unit'], ['rate', 'Rate (before GST)'], ['gst', 'GST %'], ['amount', 'Line amount (before GST)'], ['payment', 'Payment mode'], ['orderNo', 'PO / order no']],
    purchases: [['no', 'Bill no'], ['date', 'Bill date', 1], ['party', 'Supplier', 1], ['gstin', 'Supplier GSTIN'], ['item', 'Item', 1], ['hsn', 'HSN / SAC'], ['qty', 'Qty'], ['uqc', 'Unit'], ['rate', 'Rate (before GST)'], ['gst', 'GST %'], ['amount', 'Line amount (before GST)'], ['payment', 'Payment mode']]
  };
  const TYPE_LABEL = { customers: 'Customers', suppliers: 'Suppliers', items: 'Items / products', sales: 'Sales invoices', purchases: 'Purchase bills' };
  const norm = (h) => lower(h).replace(/[^a-z0-9]/g, '');
  /** Which column (index) of the header row holds each BlitzBook field of this kind of file: {field: index}. Exact
      names first, then names that start with or contain the field's word; a column is used once. */
  function mapHeaders(headers, type) {
    const fields = FIELDS[type] || [], hs = (headers || []).map(h => norm(h)), used = new Set(), map = {};
    const syns = (f) => (SYN[f[3] || f[0]] || []).map(norm);
    const take = (f, i) => { map[f[0]] = i; used.add(i); };
    // 1. exact
    fields.forEach(f => { for (const s of syns(f)) { const i = hs.findIndex((h, n) => h === s && !used.has(n)); if (i >= 0) { take(f, i); return; } } });
    // 2. the heading starts with the name, or the name with the heading ("Invoice No." / "invoiceno", "Qty (Nos)")
    fields.forEach(f => { if (map[f[0]] != null) return; for (const s of syns(f)) { if (s.length < 3) continue; const i = hs.findIndex((h, n) => !used.has(n) && h.length >= 3 && (h.startsWith(s) || s.startsWith(h))); if (i >= 0) { take(f, i); return; } } });
    // 3. the heading contains the name (names of four letters or more, so "rate" does not grab "GST Rate")
    fields.forEach(f => { if (map[f[0]] != null) return; for (const s of syns(f)) { if (s.length < 4) continue; const i = hs.findIndex((h, n) => !used.has(n) && h.includes(s)); if (i >= 0) { take(f, i); return; } } });
    return map;
  }
  /** The rows of a sheet (header row first) as records of the given kind, with the mapping from mapHeaders (or the
      user's corrected one). Sales and purchase rows are grouped into documents by their number: a blank number
      continues the document above, and rows without any number at all group by party and date. */
  function parseSheet(rows, type, map) {
    map = map || mapHeaders(rows[0] || [], type);
    const body = (rows || []).slice(1), g = (r, f) => map[f] != null && r[map[f]] != null ? String(r[map[f]]).trim() : '';
    if (type === 'customers' || type === 'suppliers') return body.map(r => ({ type: type === 'customers' ? 'Customer' : 'Supplier', name: g(r, 'name'), phone: digits(g(r, 'phone')), email: lower(g(r, 'email')), gstin: g(r, 'gstin').toUpperCase(), address: g(r, 'address'), state: g(r, 'state'), opening: r2(amt(g(r, 'opening'))) })).filter(c => c.name);
    if (type === 'items') return body.map(r => ({ name: g(r, 'name'), code: g(r, 'code'), category: g(r, 'category'), hsn: g(r, 'hsn').replace(/\D/g, ''), gst: g(r, 'gst') === '' ? '' : snapRate(amt(g(r, 'gst'))), rate: r2(amt(g(r, 'rate'))), uqc: uqcOf(g(r, 'uqc')), qty: r2(amt(g(r, 'qty'))), cost: r2(amt(g(r, 'cost'))) })).filter(i => i.name);
    const docs = [], byKey = new Map(); let cur = null;
    body.forEach(r => {
      const no = g(r, 'no'), party = g(r, 'party'), date = dateOf(g(r, 'date'));
      const key = no ? 'n|' + lower(no) : party || date ? 'p|' + lower(party) + '|' + date : '';
      if (key) { cur = byKey.get(key); if (!cur) { cur = { no, date: '', party: { name: '', gstin: '', phone: '', email: '', address: '', state: '' }, payment: '', orderNo: '', items: [] }; byKey.set(key, cur); docs.push(cur); } }
      if (!cur) return;
      if (date && !cur.date) cur.date = date;
      if (party && !cur.party.name) cur.party.name = party;
      ['gstin', 'phone', 'email', 'address', 'state'].forEach(k => { const v = g(r, k); if (v && !cur.party[k]) cur.party[k] = k === 'gstin' ? v.toUpperCase() : k === 'phone' ? digits(v) : k === 'email' ? lower(v) : v; });
      if (!cur.payment) cur.payment = g(r, 'payment'); if (!cur.orderNo) cur.orderNo = g(r, 'orderNo');
      const item = g(r, 'item'); if (!item) return;
      const qty = amt(g(r, 'qty')) || 1, amount = r2(amt(g(r, 'amount'))), rate = amt(g(r, 'rate')) || (qty ? amount / qty : 0);
      cur.items.push({ desc: item, hsn: g(r, 'hsn').replace(/\D/g, ''), qty: r2(qty), uqc: uqcOf(g(r, 'uqc')), rate: r2(rate), gst: g(r, 'gst') === '' ? '' : snapRate(amt(g(r, 'gst'))), amount: amount || r2(qty * rate) });
    });
    docs.forEach(d => { d.payment = paymentOf(d.payment); d.items.forEach(l => { if (l.gst === '') { const m = findMaster(l.desc); l.gst = m ? String(m.gst) : '18'; } }); });
    if (type === 'sales') return docs;
    return docs.map(d => ({ no: d.no, date: d.date, party: d.party.name, gstin: d.party.gstin, payment: d.payment, items: d.items.map(l => ({ name: l.desc, hsn: l.hsn, qty: l.qty, uqc: l.uqc, rate: l.rate, gst: l.gst })) }));
  }

  // ------------------------------------------------------------ into the books
  const findMaster = (name) => { const k = lower(name); return k ? Store.list('items').find(x => lower(x.name) === k) || null : null; };
  const findContact = (list, name, gstin) => (gstin && list.find(c => String(c.gstin || '').toUpperCase() === gstin)) || list.find(c => lower(c.name) === lower(name)) || null;
  function nextDocNo(kind) { let max = 0; Store.list('purchases').forEach(x => { const m = new RegExp('^' + kind + '-\\s*(\\d+)\\s*$').exec(x.no || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); }); return kind + '-' + String(max + 1).padStart(4, '0'); }
  // The same arithmetic as the invoice editor (Biz.computeTotals) and the purchase editor (purchaseTotals)
  function invoiceTotals(inv) {
    const c = Store.company(), charges = c.gstType === 'Regular', intra = String(inv.buyer.state || '').includes('(' + sellerCode() + ')');
    let taxable = 0, cg = 0, sg = 0, ig = 0;
    inv.items.forEach(it => { const q = num(it.qty), r = num(it.rate), g = charges ? num(it.gst) : 0; it.taxable = r2(q * r); it.totalIncl = r2(q * r * (1 + g / 100)); taxable += it.taxable; if (intra) { cg += it.taxable * g / 200; sg += it.taxable * g / 200; } else ig += it.taxable * g / 100; });
    const grand = taxable + cg + sg + ig, rounded = Math.round(grand);
    inv.totals = { intra, taxable: r2(taxable), cgst: r2(cg), sgst: r2(sg), igst: r2(ig), grand: r2(grand), rounded, words: U.toIndianWords(rounded) };
    return inv;
  }
  function purchaseTotals(p) {
    let taxable = 0, gst = 0;
    p.items.forEach(it => { const g = num(it.gst), a = num(it.qty) * num(it.rate); it.amount = a; it.gstAmt = a * g / 100; taxable += a; gst += it.gstAmt; });
    const gs = String(p.supplierGstin || ''), inter = /^\d{2}/.test(gs) && gs.slice(0, 2) !== sellerCode();
    p.taxable = taxable; p.gst = gst; p.cgst = inter ? 0 : gst / 2; p.sgst = inter ? 0 : gst / 2; p.igst = inter ? gst : 0;
    p.total = p.rcm ? taxable : taxable + gst; p.tds = 0; p.payable = p.total;
    return p;
  }
  const blankOther = () => ({ destination: '', vehicleType: '', vehicleNo: '', transporter: '', deliveryNote: '', orderNo: '', orderDate: '', reference: '', info: '', lrNo: '', lrDate: '', origin: '', goods: '' });

  /** What importing these records would do, record by record: {action: 'new' | 'update' | 'skip', reason, rec, ...}.
      mode 'insert' leaves records already in the books alone; a document number already in the books is always kept. */
  function plan(type, recs, mode) {
    mode = mode || 'upsert';
    const contacts = Store.list('contacts'), items = Store.list('items'), invoices = Store.list('invoices'), purchases = Store.list('purchases'), seen = new Set();
    const skip = (p, reason) => Object.assign(p, { action: 'skip', reason });
    if (type === 'customers' || type === 'suppliers' || type === 'contacts') return recs.map(rec => {
      const p = { rec, action: 'new', reason: '', warn: [] }, k = lower(rec.name);
      if (!rec.name) return skip(p, 'No name');
      if (seen.has('c|' + k)) return skip(p, 'Repeated in the file'); seen.add('c|' + k);
      if (rec.gstin && !U.isValidGstin(rec.gstin)) { p.warn.push('GSTIN ' + rec.gstin + ' is not valid, left out'); rec.gstin = ''; }
      if (rec.phone && !U.isValidPhone(rec.phone)) { p.warn.push('phone ' + rec.phone + ' is not a 10-digit mobile, left out'); rec.phone = ''; }
      if (rec.email && !U.isValidEmail(rec.email)) { p.warn.push('email ' + rec.email + ' is not valid, left out'); rec.email = ''; }
      rec.state = stateOf(rec.state, rec.gstin);
      const ex = findContact(contacts, rec.name, rec.gstin);
      if (ex) { p.existing = ex; p.action = 'update'; if (mode === 'insert') skip(p, 'Already in the books as ' + ex.name); }
      return p;
    });
    if (type === 'items') return recs.map(rec => {
      const p = { rec, action: 'new', reason: '', warn: [] }, k = lower(rec.name);
      if (!rec.name) return skip(p, 'No item name');
      if (seen.has('i|' + k)) return skip(p, 'Repeated in the file'); seen.add('i|' + k);
      const ex = items.find(x => lower(x.name) === k);
      if (ex) { p.existing = ex; p.action = 'update'; if (mode === 'insert') skip(p, 'Already in the item master'); }
      return p;
    });
    if (type === 'sales') return recs.map(rec => {
      const p = { rec, action: 'new', reason: '', warn: [], inv: null };
      if (!rec.date || !U.dateMs(rec.date)) return skip(p, 'No readable date');
      if (!rec.no) return skip(p, 'No invoice number');
      if (seen.has('s|' + lower(rec.no))) return skip(p, 'Repeated in the file'); seen.add('s|' + lower(rec.no));
      if (invoices.some(i => lower(i.no) === lower(rec.no))) return skip(p, 'Invoice ' + rec.no + ' is already in the books');
      const lines = rec.items.filter(l => l.desc && num(l.qty) > 0);
      if (!lines.length) return skip(p, 'No item with a quantity');
      const noRate = lines.find(l => num(l.rate) <= 0); if (noRate) return skip(p, 'No rate for "' + noRate.desc + '"');
      const gstin = cleanGstin(rec.party.gstin); if (rec.party.gstin && !gstin) p.warn.push('GSTIN ' + rec.party.gstin + ' is not valid, left out');
      const ct = findContact(contacts, rec.party.name, gstin);
      const name = rec.party.name || (ct && ct.name) || ''; if (!name) return skip(p, 'No customer name');
      const address = rec.party.address || (ct && ct.address) || '', phone = U.isValidPhone(rec.party.phone) ? rec.party.phone : (ct && ct.phone) || '', email = U.isValidEmail(rec.party.email) ? rec.party.email : (ct && ct.email) || '';
      const state = stateOf(rec.party.state, gstin) || (ct && stateOf(ct.state, ct.gstin)) || sellerState();
      const buyer = { name: name + (address ? '\n' + address : ''), phone, email, gstin: gstin || (ct && ct.gstin) || '', state };
      const c = Store.company();
      const inv = { id: null, kind: 'invoice', no: rec.no, date: rec.date, payment: paymentOf(rec.payment), rcm: false, buyer, sameShip: true, consignee: JSON.parse(JSON.stringify(buyer)), other: Object.assign(blankOther(), { orderNo: rec.orderNo || '' }), totals: {}, dueDate: '', termsOn: false, terms: c.terms || '',
        items: lines.map((l, n) => { const m = findMaster(l.desc); return { sl: n + 1, desc: m ? m.name : l.desc, hsn: l.hsn || (m && m.hsn) || U.hsnFor(l.desc) || '', gst: l.gst !== '' ? String(num(l.gst)) : (m && m.gst) || '18', inc: false, qty: num(l.qty), uqc: U.UQC_CODES.includes(l.uqc) ? l.uqc : 'NOS', rate: num(l.rate), taxable: 0, totalIncl: 0, subSerial: '', subDesc: '', subInfo: '' }; }) };
      p.inv = invoiceTotals(inv); p.contact = { type: 'Customer', name, address, phone, email, gstin: buyer.gstin, state };
      return p;
    });
    if (type === 'purchases') return recs.map(rec => {
      const p = { rec, action: 'new', reason: '', warn: [], pur: null };
      if (!rec.date || !U.dateMs(rec.date)) return skip(p, 'No readable date');
      if (!rec.party) return skip(p, 'No supplier name');
      if (rec.no) { if (seen.has('p|' + lower(rec.no))) return skip(p, 'Repeated in the file'); seen.add('p|' + lower(rec.no)); if (purchases.some(x => lower(x.no) === lower(rec.no))) return skip(p, 'Bill ' + rec.no + ' is already in the books'); }
      const lines = rec.items.filter(l => l.name && num(l.qty) > 0);
      if (!lines.length) return skip(p, 'No item with a quantity');
      const noRate = lines.find(l => num(l.rate) <= 0); if (noRate) return skip(p, 'No rate for "' + noRate.name + '"');
      const gstin = cleanGstin(rec.gstin); if (rec.gstin && !gstin) p.warn.push('GSTIN ' + rec.gstin + ' is not valid, left out');
      const ct = findContact(contacts, rec.party, gstin);
      p.pur = purchaseTotals({ id: null, kind: 'PUR', no: rec.no || '', date: rec.date, paidBy: paymentOf(rec.payment), supplier: (ct && ct.name) || rec.party, supplierGstin: gstin || (ct && ct.gstin) || '', rcm: false, inclusive: false, tdsRate: 0, tdsSection: '', notes: 'Migrated', items: lines.map(l => { const m = findMaster(l.name); return { name: m ? m.name : l.name, hsn: l.hsn || (m && m.hsn) || '', qty: num(l.qty), uqc: U.UQC_CODES.includes(l.uqc) ? l.uqc : 'NOS', rate: num(l.rate), gst: l.gst !== '' ? String(num(l.gst)) : (m && m.gst) || '18', stock: true }; }) });
      return p;
    });
    return [];
  }
  // Contacts and items touched by the documents being imported join the masters (known ones are brought up to date)
  function absorbContact(list, c) {
    const ex = findContact(list, c.name, c.gstin);
    if (ex) { Object.assign(ex, { address: c.address || ex.address, phone: c.phone || ex.phone, email: c.email || ex.email, gstin: c.gstin || ex.gstin, state: c.state || ex.state, updatedAt: Date.now() }); return false; }
    list.push({ id: U.uid(), createdAt: Date.now(), type: c.type, name: c.name, address: String(c.address || '').toUpperCase(), phone: c.phone || '', email: c.email || '', gstin: c.gstin || '', state: c.state || '', tds: false, tdsSection: '', tdsRate: 0 });
    return true;
  }
  function absorbItem(list, name, fields) {
    const k = lower(name), at = list.findIndex(x => lower(x.name) === k);
    if (at >= 0) { Object.assign(list[at], fields, { hidden: false, updatedAt: Date.now() }); return false; }
    list.push(Object.assign({ id: U.uid(), createdAt: Date.now(), name: String(name).trim(), code: '', category: '', hsn: '', gst: '18', rate: '', hidden: false }, fields));
    return true;
  }
  /** Carries out a plan: {inserted, updated, skipped, lines}. opts.asOf: the date opening balances and opening stock
      are booked on (1 April of the financial year unless given); opts.source: named in the narrations. */
  function apply(type, planned, opts) {
    opts = opts || {};
    const r = { inserted: 0, updated: 0, skipped: 0, lines: [] }, asOf = opts.asOf || fyStart(), source = opts.source || 'the old software';
    planned.forEach(p => { if (p.action === 'skip') { r.skipped++; r.lines.push((p.rec.no || p.rec.name || p.rec.party && (p.rec.party.name || p.rec.party) || '?') + ': ' + p.reason); } p.warn.forEach(w => r.lines.push((p.rec.no || p.rec.name || '?') + ': ' + w)); });
    const todo = planned.filter(p => p.action !== 'skip');
    if (!todo.length) return r;
    if (type === 'customers' || type === 'suppliers' || type === 'contacts') {
      const list = Store.list('contacts'), openings = [];
      todo.forEach(p => {
        const c = p.rec;
        if (p.existing) { Object.assign(p.existing, { type: c.type || p.existing.type, phone: c.phone || p.existing.phone, email: c.email || p.existing.email, gstin: c.gstin || p.existing.gstin, address: c.address ? c.address.toUpperCase() : p.existing.address, state: c.state || p.existing.state, updatedAt: Date.now() }); r.updated++; }
        else { list.push({ id: U.uid(), createdAt: Date.now(), type: c.type, name: c.name, phone: c.phone, email: c.email, gstin: c.gstin, address: String(c.address || '').toUpperCase(), state: c.state, tds: false, tdsSection: '', tdsRate: 0 }); r.inserted++; }
        if (Math.abs(num(c.opening)) >= 0.005) openings.push({ name: (p.existing || list[list.length - 1]).name, dr: num(c.opening) });
      });
      Store.saveList('contacts', list);
      // Opening balances: one voucher, a party owing us is debited (receivable), one we owe credited (payable), against Capital
      if (openings.length) {
        const lines = [];
        openings.forEach(o => { const a = r2(Math.abs(o.dr)); if (o.dr > 0) { lines.push({ account: o.name, side: 'Dr', amount: a }); lines.push({ account: 'Capital', side: 'Cr', amount: a }); } else { lines.push({ account: 'Capital', side: 'Dr', amount: a }); lines.push({ account: o.name, side: 'Cr', amount: a }); } });
        Store.add('journal', { date: asOf, narration: 'Opening balances of ' + openings.length + ' part' + (openings.length === 1 ? 'y' : 'ies') + ' migrated from ' + source, lines });
        r.lines.push(openings.length + ' opening balance' + (openings.length === 1 ? '' : 's') + ' booked as a journal entry dated ' + asOf);
      }
      return r;
    }
    if (type === 'items') {
      const list = Store.list('items'), stock = [];
      todo.forEach(p => {
        const i = p.rec, f = { code: i.code || undefined, category: i.category || undefined, hsn: i.hsn || undefined, gst: i.gst !== '' ? i.gst : undefined, rate: num(i.rate) > 0 ? r2(num(i.rate) * (1 + num(i.gst !== '' ? i.gst : (p.existing && p.existing.gst) || 18) / 100)) : undefined, uqc: i.uqc || undefined };
        Object.keys(f).forEach(k => { if (f[k] === undefined) delete f[k]; });
        if (absorbItem(list, i.name, f)) r.inserted++; else r.updated++;
        if (num(i.qty) > 0) stock.push({ name: i.name, hsn: i.hsn, qty: num(i.qty), uqc: i.uqc, rate: num(i.cost) > 0 ? num(i.cost) : num(i.rate), gst: i.gst !== '' ? i.gst : '18', stock: true });
      });
      Store.saveList('items', list);
      // Opening stock: one stock document (the same as Stock in Hand's upload), so the quantities count in hand
      if (stock.length) { const stkNo = nextDocNo('STK'); Store.add('purchases', purchaseTotals({ kind: 'STK', no: stkNo, date: asOf, supplier: 'Opening stock migrated from ' + source, supplierGstin: '', paidBy: 'Credit', rcm: false, inclusive: false, tdsRate: 0, tdsSection: '', items: stock, notes: 'Opening stock' })); r.lines.push(stock.length + ' item' + (stock.length === 1 ? '' : 's') + ' with opening stock, booked as ' + stkNo + ' dated ' + asOf); }
      return r;
    }
    if (type === 'sales') {
      if (!Sub.isTimeActive()) { r.skipped += todo.length; r.lines.unshift('Invoices migrate on a time plan (monthly, yearly or the trial); an invoice pack keeps to new invoices'); return r; }
      const invoices = Store.list('invoices'), contacts = Store.list('contacts'), items = Store.list('items');
      todo.forEach(p => {
        const inv = p.inv; inv.id = U.uid(); inv.createdAt = Date.now(); invoices.push(inv); r.inserted++;
        absorbContact(contacts, p.contact);
        inv.items.forEach(it => absorbItem(items, it.desc, Object.assign({ hsn: String(it.hsn).trim(), gst: String(it.gst) }, findMaster(it.desc) ? {} : { rate: r2(num(it.rate) * (1 + num(it.gst) / 100)) })));
      });
      Store.saveList('invoices', invoices); Store.saveList('contacts', contacts); Store.saveList('items', items);
      return r;
    }
    if (type === 'purchases') {
      const purchases = Store.list('purchases'), contacts = Store.list('contacts'), items = Store.list('items');
      todo.forEach(p => {
        const pur = p.pur; pur.id = U.uid(); pur.createdAt = Date.now();
        // A bill without a number gets the next free PUR- number, counting the bills added just before it
        if (!pur.no) { let max = 0; purchases.forEach(x => { const m = /^PUR-\s*(\d+)\s*$/.exec(x.no || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); }); pur.no = 'PUR-' + String(max + 1).padStart(4, '0'); }
        purchases.push(pur); r.inserted++;
        absorbContact(contacts, { type: 'Supplier', name: pur.supplier, gstin: pur.supplierGstin, state: stateOf('', pur.supplierGstin) });
        pur.items.forEach(it => absorbItem(items, it.name, Object.assign({ gst: String(it.gst) }, it.hsn ? { hsn: it.hsn } : {})));
      });
      Store.saveList('purchases', purchases); Store.saveList('contacts', contacts); Store.saveList('items', items);
      return r;
    }
    return r;
  }
  /** Everything a Tally export holds, in the order the books need it: contacts, items, then invoices and bills. */
  function importAll(parsed, opts) {
    opts = Object.assign({ mode: 'upsert', source: parsed.source || 'Tally' }, opts || {});
    const out = {};
    [['contacts', parsed.contacts], ['items', parsed.items], ['sales', parsed.invoices], ['purchases', parsed.purchases]].forEach(([type, recs]) => { out[type] = apply(type, plan(type, recs || [], opts.mode), opts); });
    return out;
  }

  // ------------------------------------------------------------ templates and help
  const TEMPLATES = {
    customers: 'Name,Phone,Email,GSTIN,Address,State,Opening Balance\nRamesh Traders,9876543210,ramesh@gmail.com,37ABCDE1234F1ZZ,100 Feet Road Vijayawada,Andhra Pradesh,15000\n"Suresh, Sons",9123456789,,,MG Road Hyderabad,Telangana,0\n',
    suppliers: 'Name,Phone,Email,GSTIN,Address,State,Opening Balance\nSteel Mart,9000000001,sales@steelmart.in,36AABCU9603R1ZM,Balanagar Hyderabad,Telangana,-42000\n',
    items: 'Item Name,Item Code,Category,HSN,GST %,Selling Price,Unit,Opening Stock Qty,Purchase Rate\nSteel Pipe 2 inch,SP2,Pipes,7306,18,531,NOS,120,400\nWelding Rods,WR1,Consumables,8311,18,377.6,BOX,15,280\n',
    sales: 'Invoice No,Invoice Date,Customer,GSTIN,Phone,Email,Address,State,Item,HSN,Qty,Unit,Rate,GST %,Payment\nINV-1001,02/09/2026,Ramesh Traders,37ABCDE1234F1ZZ,9876543210,ramesh@gmail.com,100 Feet Road Vijayawada,Andhra Pradesh,Steel Pipe 2 inch,7306,10,NOS,450,18,Credit\nINV-1001,,,,,,,,Welding Rods,8311,5,BOX,320,18,\nINV-1002,03/09/2026,Suresh Enterprises,,9123456789,,MG Road Hyderabad,Telangana,Office Chair,9401,4,NOS,3200,18,Cash\n',
    purchases: 'Bill No,Bill Date,Supplier,GSTIN,Item,HSN,Qty,Unit,Rate,GST %,Payment\nSM/2026/221,01/09/2026,Steel Mart,36AABCU9603R1ZM,Steel Pipe 2 inch,7306,100,NOS,400,18,Credit\nSM/2026/221,,,,Welding Rods,8311,20,BOX,280,18,\n'
  };
  const SOURCES = [
    { key: 'tally', name: 'Tally (Prime / ERP 9)', how: '<b>Masters:</b> Gateway of Tally > Display More Reports > List of Accounts > Alt+E (Export) > format <b>XML</b> (ledgers with addresses, GSTIN, opening balances; Stock Items with HSN and GST rates). <b>Vouchers:</b> Display More Reports > Day Book > choose the period (F2) > Alt+E (Export) > XML. Upload the XML file(s) here; one file may carry both. Tally\'s Excel exports of the same reports go through the spreadsheet road below.' },
    { key: 'sap', name: 'SAP (ECC / S/4HANA / Business One)', how: 'Download the lists to a spreadsheet and upload them here: customers from <b>XD03 / SE16 on KNA1 + KNVV</b> (KUNNR, NAME1, STRAS, ORT01, REGIO, TELF1, SMTP_ADDR, STCD3 = GSTIN), vendors from <b>LFA1</b>, materials from <b>MM60 / MARA + MAKT</b> (MATNR, MAKTX, MEINS, STEUC = HSN), billing documents from <b>VF05 / VBRK + VBRP</b> (VBELN, FKDAT, KUNRG, MATNR, FKIMG, NETWR), purchase invoices from <b>MIR5 / RBKP + RSEG</b>, open items from <b>FBL5N / FBL1N</b>. Business One: Business Partners and Items exported with the grid\'s Excel button. The SAP field names are recognised as they are.' },
    { key: 'zoho', name: 'Zoho Books', how: 'Zoho Books > Settings > Data Backup, or on each list (Customers, Vendors, Items, Invoices, Bills) the <b>⋯ > Export</b> menu, format CSV / XLS. Export invoices and bills <b>with line items</b> (one row per item).' },
    { key: 'vyapar', name: 'Vyapar', how: 'Vyapar > Reports > <b>Party Report</b>, <b>Item Report</b>, <b>Sale Report</b> and <b>Purchase Report</b> > Excel; or Utilities > Export Items / Export Parties. Upload each Excel file here with its kind picked below.' },
    { key: 'busy', name: 'Busy', how: 'Busy > Display > Masters > <b>Account List</b> / <b>Item List</b> and Display > Transactions > <b>Sales / Purchase Register</b> (Item-wise) > Export to Excel.' },
    { key: 'marg', name: 'Marg ERP', how: 'Marg > Reports > <b>Ledger List</b>, <b>Item List</b>, <b>Sale Register</b> / <b>Purchase Register</b> > Export (Excel). Pick the item-wise register so each row carries an item.' },
    { key: 'quickbooks', name: 'QuickBooks', how: 'QuickBooks > Settings (gear) > <b>Export Data</b>, or Reports > Customer Contact List, Vendor Contact List, Product/Service List, <b>Sales by Product/Service Detail</b> and Bills > Export to Excel.' },
    { key: 'other', name: 'Any other software or spreadsheet', how: 'Export the customers, suppliers, items, sales invoices and purchase bills as CSV or Excel from the software\'s Export / Reports menu, or fill BlitzBook\'s templates (buttons below). Column names are matched for you; you can correct the mapping before anything is imported.' }
  ];

  // ------------------------------------------------------------ the screen
  const Migrate = {
    parseXml, parseTallyXml, mapHeaders, parseSheet, plan, apply, importAll, FIELDS, SYN, TYPE_LABEL, TEMPLATES, SOURCES, dateOf, uqcOf, snapRate,
    template(type) { UI.download('BlitzBook_Migrate_' + TYPE_LABEL[type].replace(/[^A-Za-z]+/g, '_') + '_Template.csv', TEMPLATES[type], 'text/csv'); UI.toast('Template downloaded'); },
    // A chosen file: XML goes the Tally road, CSV / Excel the mapping road
    pick(type) {
      const i = document.createElement('input'); i.type = 'file'; i.accept = '.xml,.csv,.xlsx,text/xml,application/xml,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      i.onchange = async () => {
        const f = i.files[0]; if (!f) return;
        try {
          const buf = await f.arrayBuffer(), b = new Uint8Array(buf);
          if (b[0] === 0xD0 && b[1] === 0xCF) { UI.alert('Migrate', 'Old Excel (.xls) format is not supported. Save the file as .xlsx or .csv and try again.'); return; }
          if (b[0] === 0x50 && b[1] === 0x4B) { Migrate.sheet(await U.xlsxRows(buf), type, f.name); return; }
          const textOf = new TextDecoder().decode(b), head = textOf.slice(0, 2000);
          if (/^﻿?\s*<(\?xml|ENVELOPE|TALLYMESSAGE)/i.test(head) || /<TALLYMESSAGE|<ENVELOPE/i.test(head)) { Migrate.tally(textOf, f.name); return; }
          Migrate.sheet(UI.parseCsv(textOf), type, f.name);
        } catch (e) { UI.alert('Migrate', e.message); }
      };
      i.click();
    },
    asOf() { return UI.dateVal('mgAsOf') || fyStart(); },
    // The Tally preview: what the file holds, the warnings, then Import
    tally(xml, fileName) {
      let parsed; try { parsed = parseTallyXml(xml); } catch (e) { UI.alert('Tally XML', e.message); return; }
      const n = parsed.contacts.length + parsed.items.length + parsed.invoices.length + parsed.purchases.length;
      if (!n) { UI.alert('Tally XML', 'Nothing to migrate in ' + fileName + ': no party ledgers (Sundry Debtors / Creditors), stock items, sales or purchase vouchers. ' + (parsed.skipped.ledgers ? parsed.skipped.ledgers + ' other ledgers and ' : '') + parsed.skipped.vouchers + ' other vouchers were in it.'); return; }
      const plans = () => { const mode = UI.modeOf(bg); return { contacts: plan('contacts', parsed.contacts, mode), items: plan('items', parsed.items, mode), sales: plan('sales', parsed.invoices, mode), purchases: plan('purchases', parsed.purchases, mode) }; };
      const stat = (k, v, cls) => '<div class="istat ' + (cls || '') + '"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
      const summary = (pl) => { const c = (l) => l.filter(p => p.action !== 'skip').length; return '<div class="istats">' + stat('Customers / suppliers', c(pl.contacts) + ' of ' + parsed.contacts.length, 'ok') + stat('Items', c(pl.items) + ' of ' + parsed.items.length, 'ok') + stat('Sales invoices', c(pl.sales) + ' of ' + parsed.invoices.length, 'warn') + stat('Purchase bills', c(pl.purchases) + ' of ' + parsed.purchases.length, 'warn') + '</div>'; };
      const skips = (pl) => { const l = [].concat(pl.contacts, pl.items, pl.sales, pl.purchases).filter(p => p.action === 'skip').map(p => (p.rec.no || p.rec.name || (p.rec.party && (p.rec.party.name || p.rec.party)) || '?') + ': ' + p.reason).concat(parsed.warn); return l.length ? '<div class="field"><label>Left out or noted</label><ul class="hint" style="margin:0 0 0 18px;padding:0;line-height:1.6">' + l.slice(0, 15).map(x => '<li>' + esc(x) + '</li>').join('') + (l.length > 15 ? '<li>and ' + (l.length - 15) + ' more</li>' : '') + '</ul></div>' : ''; };
      const sample = parsed.invoices.slice(0, 5).map(i => '<tr><td>' + esc(i.no) + '</td><td>' + esc(i.date) + '</td><td>' + esc(i.party.name) + '</td><td class="num">' + i.items.length + '</td><td class="num">' + money(i.items.reduce((s, l) => s + l.amount, 0)) + '</td></tr>').join('');
      const bg = UI.modal({ title: 'Migrate from Tally', wide: true, focus: false, body: '<p><b>' + esc(fileName) + '</b>: ' + parsed.contacts.length + ' part' + (parsed.contacts.length === 1 ? 'y' : 'ies') + ', ' + parsed.items.length + ' stock item' + (parsed.items.length === 1 ? '' : 's') + ', ' + parsed.invoices.length + ' sales voucher' + (parsed.invoices.length === 1 ? '' : 's') + ', ' + parsed.purchases.length + ' purchase voucher' + (parsed.purchases.length === 1 ? '' : 's') + (parsed.skipped.ledgers || parsed.skipped.vouchers ? ' (' + parsed.skipped.ledgers + ' other ledgers and ' + parsed.skipped.vouchers + ' other vouchers left out)' : '') + '.</p>' +
        UI.modeField('Parties and items') + '<div id="mgSum">' + summary(plans()) + skips(plans()) + '</div>' +
        (sample ? '<div class="field"><label>First sales vouchers</label><div class="tablewrap"><table class="list"><thead><tr><th>No</th><th>Date</th><th>Party</th><th class="num">Items</th><th class="num">Before GST</th></tr></thead><tbody>' + sample + '</tbody></table></div></div>' : '') +
        '<div class="hint" style="margin-top:8px">Opening balances of the parties are booked as one journal entry and opening stock as one stock document, both dated ' + esc(Migrate.asOf()) + ' (change the date on the Migrate screen). Vouchers already in the books (same number) are never overwritten.</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Import', cls: 'green', onClick: () => {
          const out = importAll(parsed, { mode: UI.modeOf(bg), asOf: Migrate.asOf(), source: 'Tally' });
          const sum = (k) => Object.values(out).reduce((s, r) => s + r[k], 0), lines = Object.values(out).reduce((l, r) => l.concat(r.lines), []);
          UI.importResult('Migrated from Tally', { inserted: sum('inserted'), updated: sum('updated'), skipped: sum('skipped'), note: out.contacts.inserted + out.contacts.updated + ' parties, ' + (out.items.inserted + out.items.updated) + ' items, ' + out.sales.inserted + ' invoices and ' + out.purchases.inserted + ' purchase bills are in the books.', lines }, () => App.go('migrate'));
        } }] });
      $$('input[name=impMode]', bg).forEach(rd => rd.addEventListener('change', () => { $('#mgSum', bg).innerHTML = summary(plans()) + skips(plans()); }));
    },
    // A sheet: the mapping step (BlitzBook field -> column, auto-matched, each with a sample), then the preview
    sheet(rows, type, fileName) {
      if (!rows || rows.length < 2) { UI.alert('Migrate', 'The file needs a header row and at least one row of data.'); return; }
      type = type || 'customers';
      const headers = rows[0].map(h => String(h == null ? '' : h).trim()), sample = rows[1] || [];
      let map = mapHeaders(headers, type);
      const fields = FIELDS[type];
      const body = () => '<p><b>' + esc(fileName) + '</b>: ' + (rows.length - 1) + ' rows, ' + headers.length + ' columns. Check which column holds each BlitzBook field; <b>*</b> marks the ones that are needed.</p>' +
        '<div class="field"><label>The file holds</label>' + UI.select('mgKind', Object.keys(TYPE_LABEL).map(k => [k, TYPE_LABEL[k]]), type) + '</div>' +
        '<div class="tablewrap" style="margin-top:8px"><table class="list mgmap"><thead><tr><th>BlitzBook field</th><th>Column in the file</th><th>First row</th></tr></thead><tbody>' +
        fields.map(f => '<tr><td style="text-align:left">' + esc(f[1]) + (f[2] ? ' <b class="red">*</b>' : '') + '</td><td>' + UI.select('', headers.map((h, i) => [i, h || 'Column ' + (i + 1)]), map[f[0]] != null ? map[f[0]] : '', { blank: '- not in the file -', attrs: ' data-f="' + f[0] + '" style="min-height:34px;padding:4px 8px"' }) + '</td><td class="small muted" data-s="' + f[0] + '">' + esc(map[f[0]] != null ? sample[map[f[0]]] : '') + '</td></tr>').join('') + '</tbody></table></div>';
      const bg = UI.modal({ title: 'Migrate: match the columns', wide: true, focus: false, body: body(), buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Preview', cls: 'green', onClick: () => {
        const miss = fields.filter(f => f[2] && map[f[0]] == null).map(f => f[1]);
        if (miss.length) { UI.toast('Choose the column for: ' + miss.join(', '), 4000); return false; }
        let recs; try { recs = parseSheet(rows, type, map); } catch (e) { UI.alert('Migrate', e.message); return false; }
        if (!recs.length) { UI.toast('No ' + TYPE_LABEL[type].toLowerCase() + ' found in the rows'); return false; }
        Migrate.preview(type, recs, fileName);
      } }] });
      const wire = () => {
        $$('select[data-f]', bg).forEach(s => s.onchange = () => { const f = s.dataset.f; if (s.value === '') delete map[f]; else map[f] = +s.value; $('[data-s="' + f + '"]', bg).textContent = s.value === '' ? '' : String(sample[+s.value] == null ? '' : sample[+s.value]); });
        $('#mgKind', bg).onchange = (e) => { bg.remove(); Migrate.sheet(rows, e.target.value, fileName); };
      };
      wire();
    },
    preview(type, recs, fileName) {
      let planned = plan(type, recs, Store.get('upload_mode', 'upsert'));
      const label = (p) => p.action === 'new' ? '<span class="pill ok">New</span>' : p.action === 'update' ? '<span class="pill warn">Update</span>' : '<span class="pill bad">Skip</span><div class="small muted">' + esc(p.reason) + '</div>';
      const rowOf = (p) => {
        const r = p.rec;
        if (type === 'customers' || type === 'suppliers') return '<td style="text-align:left">' + esc(r.name) + (r.gstin ? '<div class="small muted">' + esc(r.gstin) + '</div>' : '') + '</td><td>' + esc(r.phone || '-') + '</td><td>' + esc(U.stateName(r.state) || '-') + '</td><td class="num">' + (num(r.opening) ? money(r.opening) : '-') + '</td>';
        if (type === 'items') return '<td style="text-align:left">' + esc(r.name) + '</td><td>' + esc(r.hsn || '-') + '</td><td>' + (r.gst !== '' ? esc(r.gst) + '%' : '-') + '</td><td class="num">' + (num(r.rate) ? money(r.rate) : '-') + (num(r.qty) ? '<div class="small muted">' + U.fmtQty(r.qty) + ' ' + esc(r.uqc) + ' in stock</div>' : '') + '</td>';
        if (type === 'sales') return '<td style="text-align:left">' + esc(r.no) + '<div class="small muted">' + esc(r.date) + '</div></td><td>' + esc(r.party.name || '-') + '</td><td class="num">' + r.items.length + '</td><td class="num">' + (p.inv ? money(p.inv.totals.rounded) : '-') + '</td>';
        return '<td style="text-align:left">' + esc(r.no || '(next PUR- number)') + '<div class="small muted">' + esc(r.date) + '</div></td><td>' + esc(r.party || '-') + '</td><td class="num">' + r.items.length + '</td><td class="num">' + (p.pur ? money(p.pur.total) : '-') + '</td>';
      };
      const heads = type === 'customers' || type === 'suppliers' ? ['Name', 'Phone', 'State', 'Opening'] : type === 'items' ? ['Item', 'HSN', 'GST', 'Price'] : type === 'sales' ? ['Invoice', 'Customer', 'Items', 'Total'] : ['Bill', 'Supplier', 'Items', 'Total'];
      const warns = () => { const l = []; planned.forEach(p => p.warn.forEach(w => l.push((p.rec.no || p.rec.name || '?') + ': ' + w))); return l.length ? '<ul class="hint" style="margin:6px 0 0 18px;padding:0;line-height:1.6">' + l.slice(0, 10).map(x => '<li>' + esc(x) + '</li>').join('') + (l.length > 10 ? '<li>and ' + (l.length - 10) + ' more</li>' : '') + '</ul>' : ''; };
      const todo = () => planned.filter(p => p.action !== 'skip').length;
      const numCols = type === 'sales' || type === 'purchases' ? [2, 3] : [3];
      const table = () => '<table class="list"><thead><tr>' + heads.map((h, i) => '<th' + (numCols.includes(i) ? ' class="num"' : '') + '>' + h + '</th>').join('') + '<th>Action</th></tr></thead><tbody>' + planned.slice(0, 200).map(p => '<tr>' + rowOf(p) + '<td>' + label(p) + '</td></tr>').join('') + '</tbody></table>' + (planned.length > 200 ? '<div class="hint" style="padding:8px">and ' + (planned.length - 200) + ' more rows</div>' : '');
      const goLabel = () => { const n = todo(); return n ? 'Import ' + n + ' ' + TYPE_LABEL[type].toLowerCase() : 'Nothing to import'; };
      const bg = UI.modal({ title: 'Migrate: ' + TYPE_LABEL[type], wide: true, focus: false, body: '<p>' + planned.length + ' ' + TYPE_LABEL[type].toLowerCase() + ' in <b>' + esc(fileName) + '</b>.</p>' + (type === 'sales' || type === 'purchases' ? '<div class="hint">A document number already in the books is kept as it is; those rows are skipped.</div>' : UI.modeField(TYPE_LABEL[type])) + '<div id="mgWarn">' + warns() + '</div><div class="tablewrap" id="mgPlan" style="margin-top:8px">' + table() + '</div>',
        buttons: [{ label: 'Back', cls: 'outline' }, { label: goLabel(), cls: 'green', onClick: () => {
          if (!todo()) return false;
          const r = apply(type, planned, { asOf: Migrate.asOf(), source: $('#mgSource') ? $('#mgSource option:checked').textContent : 'the old software' });
          UI.importResult('Migrated: ' + TYPE_LABEL[type], { inserted: r.inserted, updated: r.updated, skipped: r.skipped, note: r.inserted + ' inserted, ' + r.updated + ' updated' + (r.skipped ? ', ' + r.skipped + ' skipped' : '') + '.', lines: r.lines }, () => App.go(type === 'customers' ? 'contacts' : type === 'suppliers' ? 'contacts' : type === 'items' ? 'items' : type === 'sales' ? 'sales' : 'purchases', type === 'customers' ? { type: 'Customer' } : type === 'suppliers' ? { type: 'Supplier' } : undefined));
        } }] });
      $$('input[name=impMode]', bg).forEach(rd => rd.addEventListener('change', () => { planned = plan(type, recs, UI.modeOf(bg)); $('#mgPlan', bg).innerHTML = table(); $('#mgWarn', bg).innerHTML = warns(); $$('.mf .btn', bg)[1].textContent = goLabel(); }));
    },
    screen() {
      const src = Store.get('migrate_source', 'tally'), s = SOURCES.find(x => x.key === src) || SOURCES[0];
      const counts = { contacts: Store.list('contacts').length, items: Store.items().length, invoices: Store.list('invoices').filter(i => i.kind === 'invoice').length, purchases: Store.list('purchases').filter(p => p.kind === 'PUR').length };
      const root = App.view(App.header('Migrate to BlitzBook', '<div class="btnrow" style="margin:0"><button class="btn sm green" id="mgFile">Upload file</button></div>') +
        '<div class="hint" style="margin-bottom:12px">Bring the books over from Tally, SAP, Zoho Books, Vyapar, Busy, Marg, QuickBooks or any spreadsheet: customers and suppliers with their opening balances, items with HSN, GST rate and opening stock, sales invoices and purchase bills. The file is read in this browser and nothing in it leaves this device; what is imported goes into the books like anything typed here (and to the app, when sync is on). Records already in the books are updated or left alone, as you choose; a document number already in the books is never overwritten.</div>' +
        '<div class="grid2"><div class="card white"><div class="hd">1. Where the books are coming from</div><div class="bd">' +
        '<div class="field"><label>Software</label>' + UI.select('mgSource', SOURCES.map(x => [x.key, x.name]), s.key) + '</div><div class="hint mghow" id="mgHow" style="margin-top:10px;line-height:1.6">' + s.how + '</div></div></div>' +
        '<div class="card white"><div class="hd">2. Upload</div><div class="bd">' +
        '<div class="field"><label>The file holds</label>' + UI.select('mgType', Object.keys(TYPE_LABEL).map(k => [k, TYPE_LABEL[k]]), Store.get('migrate_type', 'customers')) + '<div class="hint">A Tally XML file is recognised on its own and may hold everything at once.</div></div>' +
        '<div class="field" style="margin-top:10px"><label>Opening balances and opening stock dated</label>' + UI.dateInput('mgAsOf', Store.get('migrate_asof', fyStart())) + '<div class="hint">Normally the first day of the financial year you start BlitzBook from. A customer owing you shows as a positive opening balance, a supplier you owe as a negative one (Tally\'s signs are read for you).</div></div>' +
        '<div class="btnrow"><button class="btn green" id="mgFile2">Choose file (XML, CSV or Excel)</button></div>' +
        '<div class="field"><label>Templates (CSV, with a sample row)</label><div class="btnrow" style="margin:0">' + Object.keys(TYPE_LABEL).map(k => '<button class="btn sm outline" data-t="' + k + '">' + esc(TYPE_LABEL[k]) + '</button>').join('') + '</div></div></div></div></div>' +
        '<div class="card white"><div class="hd">3. In the books now</div><div class="bd"><div class="istats">' + [['Customers & suppliers', counts.contacts, 'contacts'], ['Items', counts.items, 'items'], ['Sales invoices', counts.invoices, 'sales'], ['Purchase bills', counts.purchases, 'purchases']].map(x => '<div class="istat ok" data-go="' + x[2] + '" role="button" tabindex="0" style="cursor:pointer"><div class="v">' + x[1] + '</div><div class="k">' + x[0] + '</div></div>').join('') + '</div>' +
        '<div class="hint" style="line-height:1.7"><b>After migrating:</b> check the customers and suppliers (GSTIN and state decide CGST / SGST or IGST), the item master (HSN and GST rate), and the Sales and Purchases lists. Opening balances of the parties are one journal entry under Journal; opening stock is a stock document under Stock in Hand. The opening balances of cash, bank, capital, loans and fixed assets go in as one more journal entry (Journal > Add Journal Entry, e.g. Dr Bank, Dr Cash, Cr Capital). GST and TDS balances carried forward are best entered as a journal entry on the same date.</div></div></div>');
      App.wireBack(root);
      const start = () => { Store.set('migrate_type', UI.val('mgType'), true); Store.set('migrate_asof', Migrate.asOf(), true); Migrate.pick(UI.val('mgType')); };
      $('#mgFile', root).onclick = start; $('#mgFile2', root).onclick = start;
      $('#mgSource', root).onchange = (e) => { Store.set('migrate_source', e.target.value, true); const x = SOURCES.find(y => y.key === e.target.value); $('#mgHow', root).innerHTML = x ? x.how : ''; };
      $$('[data-t]', root).forEach(b => b.onclick = () => Migrate.template(b.dataset.t));
      $$('.istat[data-go]', root).forEach(el => el.onclick = () => App.go(el.dataset.go === 'contacts' ? 'contacts' : el.dataset.go, el.dataset.go === 'contacts' ? { type: 'Customer' } : undefined));
    }
  };
  if (global.App && App.routes) App.routes.migrate = () => Migrate.screen();
  global.Migrate = Migrate;
})(typeof window !== 'undefined' ? window : globalThis);
