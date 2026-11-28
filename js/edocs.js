/* BlitzBook web portal - e-Invoice (IRN) and e-Way Bill, India (Settings > E-Invoice & E-Way Bill).

   An invoice above the limit set in Settings (Rs 50,000 unless changed) needs an e-invoice when the buyer is
   registered (B2B), and an e-way bill when goods move. BlitzBook has no login to the government portals: their APIs
   are given only through a GST Suvidha Provider (GSP) with API credentials, so the documents are made the way the
   portals' own offline tools make them, as JSON files the portal takes in bulk:
     - e-Invoice: the IRP's JSON schema, version 1.1 (an array of documents), uploaded on https://einvoice1.gst.gov.in
       (e-Invoice > Bulk Upload). The IRP answers with the IRN, the acknowledgement number and date and the signed QR code.
     - e-Way Bill: the bulk JSON of the e-way bill system ({version, billLists}), uploaded on https://ewaybillgst.gov.in
       (e-Waybill > Generate Bulk). The portal answers with the e-way bill number and its validity.
   What the portal gives back is typed or pasted into the invoice, or its result file (JSON, Excel or CSV) is uploaded
   here and matched to the invoices by number. The IRN, the acknowledgement and the e-way bill then print on the
   invoice, the signed QR code as a QR image (drawn with qrcodejs, fetched from cdnjs the first time it is needed).

   Kept on the invoice (synced as the edocs column, see appformat.js):
     einv {irn, ackNo, ackDt, qr, at}   ewb {no, date, validUpto, at}   trans {mode, vehType, distance, transId, transName, docNo, docDt}
     skip {einv, ewb}                   a reason when one of them is not needed for this invoice
   The settings are settings.edocs of the company's settings record. */
(function (global) {
  'use strict';
  const { esc, num } = U;
  const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
  const r3 = (v) => Math.round((num(v) + Number.EPSILON) * 1000) / 1000;
  const money = (v) => U.inr(v);
  const PORTAL = { einv: 'https://einvoice1.gst.gov.in/', ewb: 'https://ewaybillgst.gov.in/' };
  const UQC = ['BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN', 'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS', 'NOS', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS', 'OTH'];
  const uqc = (u) => { const x = String(u || 'NOS').toUpperCase().split(/[-\s]/)[0]; return UQC.includes(x) ? x : x === 'KG' ? 'KGS' : x === 'PC' ? 'PCS' : x === 'LT' || x === 'L' ? 'LTR' : x === 'MT' ? 'MTS' : 'OTH'; };
  const SPECIAL = ['Maharashtra', 'Delhi', 'Tamil Nadu', 'Bihar'];
  const MODES = [['1', 'Road'], ['2', 'Rail'], ['3', 'Air'], ['4', 'Ship']];
  const DEFAULTS = { einvOn: true, einvRule: 'above', einvLimit: 50000, ewbOn: true, ewbLimit: 50000, ewbStates: false, mode: '1', vehType: 'R', distance: 0, transId: '', transName: '', pin: '', place: '' };
  const isService = (hsn) => /^99/.test(String(hsn || '').trim());
  const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
  const lines = (p) => String(p.name || '').split('\n').concat(String(p.address || '').split('\n')).map(s => s.trim()).filter(Boolean);
  const pinOf = (text) => { const m = String(text || '').match(/\b\d{6}\b/g); return m ? m[m.length - 1] : ''; };
  // The place: the address line that holds the PIN (without it), else the last line with letters in it
  const placeOf = (ls) => { const withPin = ls.find(l => /\b\d{6}\b/.test(l)); const p = withPin ? withPin.replace(/\b\d{6}\b/, '').replace(/[-,\s]+$/, '').replace(/^[-,\s]+/, '') : ''; return clip(p.length >= 3 ? p : (ls.slice().reverse().find(l => /[A-Za-z]{3}/.test(l)) || ''), 50); };
  const stcd = (state, gstin) => { const s = U.stateCode(state); if (s) return s; const g = String(gstin || '').trim(); return /^\d{2}/.test(g) ? g.slice(0, 2) : ''; };
  const validGstin = (g) => { g = String(g || '').trim().toUpperCase(); return g.length === 15 && U.isValidGstin(g) ? g : ''; };
  const docDate = (d) => /^\d{2}\/\d{2}\/\d{4}$/.test(d || '') ? d : U.dmy(new Date(U.dateMs(d) || Date.now()));

  const ED = {
    PORTAL, MODES,
    applies() { return U.isIndia() && Biz.chargesGst(); },
    settings() { const d = global.Settings ? Settings.doc().edocs : null; return Object.assign({}, DEFAULTS, d && typeof d === 'object' ? d : {}); },
    total(inv) { const t = inv.totals || {}; return num(t.rounded) || num(t.grand); },
    goods(inv) { return (inv.items || []).some(it => num(it.taxable) > 0 && !isService(it.hsn)); },
    b2b(inv) { const g = validGstin(inv.buyer && inv.buyer.gstin); return !!g && g !== String(Store.company().gstin || '').trim().toUpperCase(); },
    ewbLimit(inv) { const s = this.settings(); if (s.ewbStates && SPECIAL.some(x => Biz.sellerStateName().startsWith(x)) && inv && inv.totals && inv.totals.intra) return Math.max(num(s.ewbLimit), 100000); return num(s.ewbLimit); },
    // What this invoice needs: {einv, ewb} true / false, whatever is done already
    needs(inv) {
      if (!inv || inv.kind !== 'invoice' || !this.applies()) return { einv: false, ewb: false };
      const s = this.settings(), v = this.total(inv), skip = inv.skip || {};
      return {
        einv: !!s.einvOn && !skip.einv && this.b2b(inv) && (s.einvRule === 'all' || v > num(s.einvLimit)),
        ewb: !!s.ewbOn && !skip.ewb && this.goods(inv) && v > this.ewbLimit(inv)
      };
    },
    // What is still to be done: {einv, ewb, any}
    pending(inv) { const n = this.needs(inv), e = n.einv && !(inv.einv && inv.einv.irn), w = n.ewb && !(inv.ewb && inv.ewb.no); return { einv: e, ewb: w, any: e || w }; },
    pendingList() { return Biz.invoices().filter(i => this.pending(i).any).sort((a, b) => U.dateMs(b.date) - U.dateMs(a.date)); },

    // ------------------------------------------------------------ the parties as the schemas want them
    seller() {
      const c = Store.company(), s = this.settings(), ls = String(c.address || '').split('\n').map(x => x.trim()).filter(Boolean), gstin = String(c.gstin || '').trim().toUpperCase();
      return { gstin, name: clip(c.name, 100), addr1: clip(ls[0] || c.name, 100), addr2: clip(ls.slice(1).join(', '), 100), place: clip(s.place, 50) || placeOf(ls), pin: String(s.pin || '').trim() || pinOf(c.address), stcd: gstin.slice(0, 2) || Biz.sellerStateCode(), phone: String(c.phone || '').replace(/\D/g, '').slice(-12), email: clip(c.email, 100) };
    },
    party(p) {
      const ls = lines(p), gstin = validGstin(p.gstin);
      return { gstin, name: clip(ls[0] || 'Cash', 100), addr1: clip(ls[1] || ls[0] || '', 100), addr2: clip(ls.slice(2).join(', '), 100), place: placeOf(ls.slice(1)) || placeOf(ls), pin: pinOf(ls.slice(1).join(' ')) || pinOf(p.name), stcd: stcd(p.state, gstin), phone: String(p.phone || '').replace(/\D/g, '').slice(-12), email: clip(p.email, 100) };
    },
    // The problems the portal would refuse the document for, in plain words
    problems(inv, which) {
      const out = [], s = this.seller(), b = this.party(inv.buyer || {});
      if (!validGstin(s.gstin)) out.push('The company GSTIN (Company Profile) is missing or not valid.');
      if (!/^[1-9]\d{5}$/.test(s.pin)) out.push('The PIN code of the company is not in its address: add it to the address in the Company Profile, or under Settings > E-Invoice & E-Way Bill.');
      if (s.place.length < 3) out.push('The place (city) of the company is not in its address.');
      if (which === 'einv' && !b.gstin) out.push('An e-invoice needs a buyer with a valid GSTIN.');
      if (!/^[1-9]\d{5}$/.test(b.pin)) out.push('The buyer PIN code is not in the buyer address (6 digits, e.g. "Bengaluru 560001").');
      if (!b.stcd) out.push('The buyer state is not chosen.');
      (inv.items || []).forEach(it => { if (num(it.taxable) <= 0) return; const h = String(it.hsn || '').replace(/\D/g, ''); if (h.length < 4) out.push('Item "' + clip(it.desc, 40) + '": the HSN / SAC code needs at least 4 digits.'); });
      if (which === 'ewb') { const t = this.trans(inv); if (t.mode === '1' && !t.vehicleNo && !t.transId) out.push('Road transport needs the vehicle number (or a transporter ID, for Part A only).'); if (t.transId && !validGstin(t.transId) && !/^\d{2}[A-Z0-9]{13}$/.test(t.transId)) out.push('The transporter ID is a GSTIN or the 15-character TRANSIN.'); }
      return out;
    },
    trans(inv) {
      const s = this.settings(), t = Object.assign({}, inv.trans || {}), o = inv.other || {};
      return { mode: t.mode || s.mode || '1', vehType: t.vehType || s.vehType || 'R', distance: t.distance != null && t.distance !== '' ? num(t.distance) : num(s.distance), transId: String(t.transId != null ? t.transId : s.transId || '').trim().toUpperCase(), transName: clip(t.transName != null ? t.transName : o.transporter || s.transName, 100), docNo: clip(t.docNo || o.lrNo, 15), docDt: t.docDt || o.lrDate || '', vehicleNo: String(o.vehicleNo || '').replace(/[\s-]/g, '').toUpperCase() };
    },
    lines(inv) {
      const intra = !!(inv.totals || {}).intra;
      return (inv.items || []).filter(it => num(it.taxable) > 0).map(it => { const rt = num(it.gst), tx = r2(it.taxable), half = r2(tx * rt / 200), ig = intra ? 0 : r2(tx * rt / 100); return { it, rt, tx, cg: intra ? half : 0, sg: intra ? half : 0, ig, hsn: String(it.hsn || '').replace(/\D/g, ''), svc: isService(it.hsn) }; });
    },

    // ------------------------------------------------------------ e-Invoice, IRP schema 1.1
    einvoice(inv) {
      const s = this.seller(), b = this.party(inv.buyer || {}), L = this.lines(inv), t = inv.totals || {}, intra = !!t.intra;
      const ship = !inv.sameShip && inv.consignee && String(inv.consignee.name || '').trim() ? this.party(inv.consignee) : null;
      const party = (p, pos) => Object.assign({ Gstin: p.gstin || 'URP', LglNm: p.name, TrdNm: p.name }, pos ? { Pos: pos } : {}, { Addr1: p.addr1 || p.name, Addr2: p.addr2 || null, Loc: p.place || p.name.slice(0, 50), Pin: num(p.pin) || null, Stcd: p.stcd, Ph: p.phone && p.phone.length >= 6 ? p.phone : null, Em: p.email || null });
      const items = L.map((l, n) => {
        const unitPrice = num(l.it.qty) ? r3(l.tx / num(l.it.qty)) : r3(l.it.rate);
        return { SlNo: String(n + 1), PrdDesc: clip(l.it.desc, 300) || 'Item', IsServc: l.svc ? 'Y' : 'N', HsnCd: l.hsn, Barcde: null, Qty: r3(l.it.qty) || null, FreeQty: 0, Unit: l.svc ? 'OTH' : uqc(l.it.uqc), UnitPrice: unitPrice, TotAmt: l.tx, Discount: 0, PreTaxVal: 0, AssAmt: l.tx, GstRt: l.rt,
          IgstAmt: l.ig, CgstAmt: l.cg, SgstAmt: l.sg, CesRt: 0, CesAmt: 0, CesNonAdvlAmt: 0, StateCesRt: 0, StateCesAmt: 0, StateCesNonAdvlAmt: 0, OthChrg: 0, TotItemVal: r2(l.tx + l.ig + l.cg + l.sg) };
      });
      const sum = (k) => r2(items.reduce((a, x) => a + num(x[k]), 0)), itemsVal = sum('TotItemVal'), total = r2(this.total(inv));
      const doc = { Version: '1.1',
        TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: inv.rcm ? 'Y' : 'N', EcmGstin: null, IgstOnIntra: 'N' },
        DocDtls: { Typ: 'INV', No: clip(inv.no, 16), Dt: docDate(inv.date) },
        SellerDtls: party(s), BuyerDtls: party(b, stcd(inv.buyer.state, b.gstin) || b.stcd) };
      if (ship) doc.ShipDtls = { Gstin: ship.gstin || 'URP', LglNm: ship.name, TrdNm: ship.name, Addr1: ship.addr1 || ship.name, Addr2: ship.addr2 || null, Loc: ship.place || ship.name.slice(0, 50), Pin: num(ship.pin) || null, Stcd: ship.stcd };
      doc.ItemList = items;
      doc.ValDtls = { AssVal: sum('AssAmt'), CgstVal: sum('CgstAmt'), SgstVal: sum('SgstAmt'), IgstVal: sum('IgstAmt'), CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: r2(total - itemsVal), TotInvVal: total };
      if (inv.payment && inv.payment !== 'Credit') doc.PayDtls = { Nm: clip(b.name, 100), Mode: /cash/i.test(inv.payment) ? 'Cash' : /upi/i.test(inv.payment) ? 'UPI' : /card/i.test(inv.payment) ? 'Credit Card' : /cheque|check/i.test(inv.payment) ? 'Cheque' : 'Direct Transfer', PaidAmt: total, PaymtDue: 0 };
      if (intra && items.some(x => x.IgstAmt)) doc.TranDtls.IgstOnIntra = 'Y';
      // The e-way bill can be asked for with the IRN (EwbDtls): when it is needed, the transport details go with it
      if (this.needs(inv).ewb && !(inv.ewb && inv.ewb.no)) {
        const tr = this.trans(inv);
        if (tr.vehicleNo || tr.transId) doc.EwbDtls = Object.assign({}, tr.transId ? { TransId: tr.transId } : {}, tr.transName ? { TransName: tr.transName } : {}, { Distance: Math.round(tr.distance) }, tr.docNo ? { TransDocNo: tr.docNo, TransDocDt: docDate(tr.docDt || inv.date) } : {}, tr.vehicleNo ? { VehNo: tr.vehicleNo, VehType: tr.vehType } : {}, { TransMode: tr.mode });
      }
      return doc;
    },
    // ------------------------------------------------------------ e-Way Bill, the bulk JSON of the e-way bill system
    ewaybill(inv) {
      const s = this.seller(), b = this.party(inv.buyer || {}), L = this.lines(inv).filter(l => !l.svc), tr = this.trans(inv), t = inv.totals || {}, intra = !!t.intra;
      const ship = !inv.sameShip && inv.consignee && String(inv.consignee.name || '').trim() ? this.party(inv.consignee) : null, to = ship || b;
      const sum = (k) => r2(L.reduce((a, x) => a + num(x[k]), 0));
      const main = L.slice().sort((a, c) => c.tx - a.tx)[0];
      const value = sum('tx'), tax = r2(sum('cg') + sum('sg') + sum('ig')), total = r2(this.total(inv));
      return {
        userGstin: s.gstin, supplyType: 'O', subSupplyType: 1, subSupplyDesc: '', docType: Store.company().gstType === 'Composition' ? 'BIL' : 'INV', docNo: clip(inv.no, 16), docDate: docDate(inv.date),
        transType: ship ? 2 : 1,
        fromGstin: s.gstin, fromTrdName: s.name, fromAddr1: s.addr1, fromAddr2: s.addr2, fromPlace: s.place, fromPincode: num(s.pin), fromStateCode: num(s.stcd), actualFromStateCode: num(s.stcd),
        toGstin: b.gstin || 'URP', toTrdName: b.name, toAddr1: to.addr1 || to.name, toAddr2: to.addr2, toPlace: to.place || to.name.slice(0, 50), toPincode: num(to.pin), toStateCode: num(stcd(inv.buyer.state, b.gstin) || b.stcd), actualToStateCode: num(to.stcd || b.stcd),
        totalValue: value, cgstValue: sum('cg'), sgstValue: sum('sg'), igstValue: sum('ig'), cessValue: 0, cessNonAdvolValue: 0, OthValue: r2(total - value - tax > 0 && L.length === this.lines(inv).length ? total - value - tax : 0), totInvValue: L.length === this.lines(inv).length ? total : r2(value + tax),
        transMode: num(tr.mode), transDistance: String(Math.round(tr.distance)), transporterName: tr.transName, transporterId: tr.transId, transDocNo: tr.docNo, transDocDate: tr.docNo ? docDate(tr.docDt || inv.date) : '', vehicleNo: tr.vehicleNo, vehicleType: tr.vehType,
        mainHsnCode: main ? num(main.hsn) : 0,
        itemList: L.map((l, n) => ({ itemNo: n + 1, productName: clip(l.it.desc, 100), productDesc: clip(l.it.desc, 100), hsnCode: num(l.hsn), quantity: r3(l.it.qty), qtyUnit: uqc(l.it.uqc), taxableAmount: l.tx, sgstRate: intra ? l.rt / 2 : 0, cgstRate: intra ? l.rt / 2 : 0, igstRate: intra ? 0 : l.rt, cessRate: 0, cessNonAdvol: 0 }))
      };
    },
    fileName(kind, list) { const g = String(Store.company().gstin || 'GSTIN').trim(); return (kind === 'einv' ? 'eInvoice_' : 'EWayBill_') + g + '_' + (list.length === 1 ? String(list[0].no).replace(/[^\w-]+/g, '-') : list.length + '_invoices_' + U.dmy(new Date()).replace(/\//g, '')) + '.json'; },
    download(kind, list) {
      list = list.filter(Boolean); if (!list.length) return UI.toast('Nothing to download');
      const bad = list.map(i => ({ i, p: this.problems(i, kind) })).filter(x => x.p.length);
      const go = () => {
        const body = kind === 'einv' ? JSON.stringify(list.map(i => this.einvoice(i)), null, 2) : JSON.stringify({ version: '1.0.0621', billLists: list.map(i => this.ewaybill(i)) }, null, 2);
        UI.download(this.fileName(kind, list), body, 'application/json');
        UI.toast((kind === 'einv' ? 'e-Invoice' : 'E-way bill') + ' JSON for ' + list.length + ' invoice' + (list.length === 1 ? '' : 's') + ' downloaded. Upload it on the portal.', 4500, 'ok');
      };
      if (!bad.length) return go();
      UI.modal({ title: 'Check before uploading', wide: true, body: '<p>The portal is likely to refuse ' + (bad.length === 1 ? 'this invoice' : 'these invoices') + ':</p>' + bad.map(x => '<p><b>' + esc(x.i.no) + '</b></p><ul>' + x.p.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>').join('') + '<p class="hint">Correct them and download again, or download as it is and correct it in the portal\'s offline tool.</p>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Download anyway', cls: 'blue', onClick: go }] });
    },

    // ------------------------------------------------------------ what the portal gave back
    // The payload of the signed QR code (a JWT): {SellerGstin, BuyerGstin, DocNo, DocTyp, DocDt, TotInvVal, ItemCnt, MainHsnCode, Irn, IrnDt}
    qrData(qr) { try { const p = String(qr || '').split('.')[1]; if (!p) return null; const j = JSON.parse(decodeURIComponent(escape(atob(p.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((p.length + 3) % 4))))); return typeof j.data === 'string' ? JSON.parse(j.data) : j.data || j; } catch (e) { return null; } },
    record(inv, patch) {
      const fresh = Store.find('invoices', inv.id) || inv;
      if (patch.einv) fresh.einv = Object.assign({}, fresh.einv || {}, patch.einv, { at: Date.now() });
      if (patch.ewb) fresh.ewb = Object.assign({}, fresh.ewb || {}, patch.ewb, { at: Date.now() });
      if (patch.trans) fresh.trans = Object.assign({}, fresh.trans || {}, patch.trans);
      if ('skip' in patch) { if (patch.skip && (patch.skip.einv || patch.skip.ewb)) fresh.skip = patch.skip; else delete fresh.skip; }
      ['einv', 'ewb'].forEach(k => { if (fresh[k] && !Object.keys(fresh[k]).some(x => x !== 'at' && fresh[k][x])) delete fresh[k]; });
      Store.update('invoices', fresh);
      if (global.Invoice && Invoice.inv && Invoice.inv.id === fresh.id) ['einv', 'ewb', 'trans', 'skip'].forEach(k => { if (fresh[k]) Invoice.inv[k] = fresh[k]; else delete Invoice.inv[k]; });
      if (fresh.einv && fresh.einv.qr) this.qrImage(fresh.einv.qr);
      return fresh;
    },
    // A result file of either portal: rows (or JSON objects) matched to the invoices by document number
    importResult(onDone) {
      const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,.csv,.xlsx,application/json,text/csv';
      i.onchange = async () => {
        const f = i.files[0]; if (!f) return;
        try {
          const buf = await f.arrayBuffer(), b = new Uint8Array(buf); let recs = [];
          if (b[0] === 0x50 && b[1] === 0x4B) recs = this.fromRows(await U.xlsxRows(buf));
          else { const text = new TextDecoder().decode(b).replace(/^﻿/, ''); if (/^\s*[\[{]/.test(text)) recs = this.fromJson(JSON.parse(text)); else recs = this.fromRows(UI.parseCsv(text)); }
          const norm = (s) => String(s || '').trim().toUpperCase(), invs = Biz.invoices(), byNo = new Map(invs.map(x => [norm(x.no), x]));
          let n = 0; const miss = [];
          recs.forEach(r => { const inv = byNo.get(norm(r.docNo)); if (!inv) { if (r.docNo) miss.push(r.docNo); return; } const patch = {}; if (r.irn) patch.einv = { irn: r.irn, ackNo: r.ackNo || '', ackDt: r.ackDt || '', qr: r.qr || '' }; if (r.ewbNo) patch.ewb = { no: r.ewbNo, date: r.ewbDt || '', validUpto: r.ewbValid || '' }; if (patch.einv || patch.ewb) { this.record(inv, patch); n++; } });
          UI.alert('Portal results', n + ' invoice' + (n === 1 ? '' : 's') + ' updated from ' + f.name + '.' + (miss.length ? '\nNot found in the books: ' + miss.slice(0, 15).join(', ') + (miss.length > 15 ? ' ...' : '') : '') + (!recs.length ? '\nNo IRN or e-way bill number was found in the file.' : ''), onDone);
        } catch (e) { UI.alert('Upload failed', e.message); }
      };
      i.click();
    },
    fromJson(j) {
      const out = [], pick = (o, keys) => { for (const k of Object.keys(o)) if (keys.includes(k.toLowerCase().replace(/[\s_]/g, ''))) return o[k]; return ''; };
      const walk = (o) => {
        if (Array.isArray(o)) return o.forEach(walk); if (!o || typeof o !== 'object') return;
        const irn = pick(o, ['irn']), ewb = pick(o, ['ewbno', 'ewaybillno', 'ewaybillnumber', 'ewbnumber']);
        if (irn || ewb) {
          const qr = pick(o, ['signedqrcode', 'qrcode']), q = qr ? this.qrData(qr) : null, dd = o.DocDtls || o.docDtls || {};
          const docNo = pick(o, ['docno', 'documentno', 'documentnumber', 'invoiceno', 'invno']) || dd.No || dd.no || (q && q.DocNo) || '';
          out.push({ docNo, irn: String(irn || ''), ackNo: String(pick(o, ['ackno', 'acknowledgementno']) || ''), ackDt: String(pick(o, ['ackdt', 'ackdate', 'acknowledgementdate']) || ''), qr: String(qr || ''), ewbNo: String(ewb || ''), ewbDt: String(pick(o, ['ewbdt', 'ewaybilldate', 'ewbdate']) || ''), ewbValid: String(pick(o, ['ewbvalidtill', 'validupto', 'validtill', 'validuptodate']) || '') });
        }
        Object.keys(o).forEach(k => { if (o[k] && typeof o[k] === 'object') walk(o[k]); });
      };
      walk(j);
      return out;
    },
    fromRows(rows) {
      const at = rows.findIndex(r => r.some(c => /irn|e-?way ?bill|ewb/i.test(String(c)))); if (at < 0) return [];
      const head = rows[at].map(c => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '')), col = (...keys) => head.findIndex(h => keys.some(k => h === k || h.includes(k)));
      const c = { no: col('docno', 'documentno', 'documentnumber', 'invoiceno', 'billno', 'docnumber'), irn: col('irn'), ack: col('ackno', 'acknowledgementno', 'acknowledgementnumber'), ackDt: col('ackdate', 'ackdt', 'acknowledgementdate'), qr: col('signedqr', 'qrcode'), ewb: col('ewbno', 'ewaybillno', 'ewaybillnumber', 'ewbnumber'), ewbDt: col('ewbdate', 'ewaybilldate', 'ewbdt', 'generateddate'), valid: col('validupto', 'validtill', 'validuntil') };
      const g = (r, k) => c[k] >= 0 ? String(r[c[k]] == null ? '' : r[c[k]]).trim() : '';
      return rows.slice(at + 1).map(r => ({ docNo: g(r, 'no'), irn: c.irn >= 0 && c.irn !== c.qr ? g(r, 'irn') : '', ackNo: g(r, 'ack'), ackDt: g(r, 'ackDt'), qr: g(r, 'qr'), ewbNo: g(r, 'ewb').replace(/\.0$/, ''), ewbDt: g(r, 'ewbDt'), ewbValid: g(r, 'valid') })).filter(r => r.docNo && (r.irn || r.ewbNo));
    },

    // ------------------------------------------------------------ the QR code of the signed QR (printed on the invoice)
    qrs: new Map(),
    lib: null,
    loadLib() {
      if (global.QRCode) return Promise.resolve(global.QRCode);
      if (this.lib) return this.lib;
      this.lib = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = () => global.QRCode ? ok(global.QRCode) : no(new Error('QR library missing')); s.onerror = () => { this.lib = null; no(new Error('The QR library could not be loaded (no connection?)')); }; document.head.appendChild(s); });
      return this.lib;
    },
    qrImage(text) {
      if (!text) return Promise.resolve('');
      if (this.qrs.has(text)) return Promise.resolve(this.qrs.get(text));
      return this.loadLib().then(Q => new Promise((ok) => {
        const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(box);
        try { new Q(box, { text, width: 360, height: 360, correctLevel: Q.CorrectLevel.L }); } catch (e) { box.remove(); ok(''); return; }
        setTimeout(() => { const cv = box.querySelector('canvas'), im = box.querySelector('img'); let url = ''; try { url = cv ? cv.toDataURL('image/png') : im ? im.src : ''; } catch (e) { url = ''; } box.remove(); if (url) this.qrs.set(text, url); ok(url); }, 30);
      })).catch(() => '');
    },
    // The box printed at the top of an invoice that has an IRN or an e-way bill
    printBlock(inv) {
      if (!inv || inv.kind !== 'invoice' || !((inv.einv && inv.einv.irn) || (inv.ewb && inv.ewb.no))) return '';
      const e = inv.einv || {}, w = inv.ewb || {}, img = e.qr ? this.qrs.get(e.qr) : '';
      const row = (k, v) => v ? '<tr><td style="padding:1px 6px 1px 0;white-space:nowrap;color:#444">' + esc(k) + '</td><td style="padding:1px 0;word-break:break-all"><b>' + esc(v) + '</b></td></tr>' : '';
      return '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;border:1px solid #999;padding:6px 8px;margin:0 0 6px;font-size:10px;page-break-inside:avoid">' +
        '<table style="border-collapse:collapse;font-size:10px;flex:1">' + (e.irn ? row('e-Invoice IRN', e.irn) + row('Ack No.', e.ackNo) + row('Ack Date', e.ackDt) : '') + (w.no ? row('E-Way Bill No.', w.no) + row('E-Way Bill Date', w.date) + row('Valid Upto', w.validUpto) : '') + '</table>' +
        (img ? '<img src="' + img + '" alt="e-Invoice QR" style="width:30mm;height:30mm;flex:none">' : e.qr ? '<div style="width:30mm;flex:none;text-align:center;color:#666">Signed QR on the e-invoice portal</div>' : '') + '</div>';
    },

    // ------------------------------------------------------------ the dialog of one invoice
    status(inv) {
      const n = this.needs(inv), e = inv.einv || {}, w = inv.ewb || {}, skip = inv.skip || {};
      const one = (need, done, label, sk) => done ? '<span class="pill ok">' + label + ' ✓</span>' : sk ? '<span class="pill">' + label + ': not needed</span>' : need ? '<span class="pill bad">' + label + ' pending</span>' : '';
      return [one(n.einv, !!e.irn, 'e-Invoice', skip.einv), one(n.ewb, !!w.no, 'E-Way Bill', skip.ewb)].filter(Boolean).join(' ');
    },
    dialog(inv, onClose) {
      if (!inv || !inv.id) return;
      inv = Store.find('invoices', inv.id) || inv;
      const n = this.needs(inv), s = this.settings(), e = inv.einv || {}, w = inv.ewb || {}, tr = this.trans(inv), skip = inv.skip || {}, v = this.total(inv);
      const why = (k) => k === 'einv' ? (!this.b2b(inv) ? 'The buyer has no GSTIN (B2C): no e-invoice is made for it.' : s.einvRule === 'all' ? 'Every B2B invoice gets an e-invoice (Settings).' : v > num(s.einvLimit) ? 'Value ' + money(v) + ' is above ' + money(s.einvLimit) + '.' : 'Value ' + money(v) + ' is not above ' + money(s.einvLimit) + '.')
        : (!this.goods(inv) ? 'Only services on this invoice: no goods move.' : v > this.ewbLimit(inv) ? 'Value ' + money(v) + ' is above ' + money(this.ewbLimit(inv)) + '.' : 'Value ' + money(v) + ' is not above ' + money(this.ewbLimit(inv)) + '.');
      const pill = (need, done, sk) => done ? '<span class="pill ok">done</span>' : sk ? '<span class="pill">not needed</span>' : need ? '<span class="pill bad">pending</span>' : '<span class="pill">not required</span>';
      const probs = (k) => { const p = this.problems(inv, k); return p.length ? '<ul class="hint red" style="margin:6px 0">' + p.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : ''; };
      const bg = UI.modal({ title: 'e-Invoice & E-Way Bill · ' + inv.no, wide: true, body:
        '<p class="hint" style="margin-top:0">Download the JSON, upload it on the portal (log in there with your own GST login), then type what the portal gives back here, or upload its result file. BlitzBook never sees your portal password.</p>' +
        '<div class="card white"><div class="hd">e-Invoice (IRN) ' + pill(n.einv, !!e.irn, skip.einv) + '</div><div class="bd">' +
          '<div class="hint">' + esc(why('einv')) + '</div>' + (n.einv || e.irn ? probs('einv') : '') +
          '<div class="btnrow"><button class="btn blue" id="edEinv"' + (this.b2b(inv) ? '' : ' disabled') + '>Download e-Invoice JSON</button><a class="btn outline" href="' + PORTAL.einv + '" target="_blank" rel="noopener">Open e-Invoice portal</a></div>' +
          '<div class="grid3">' + UI.field('IRN', UI.input('edIrn', e.irn, { placeholder: '64 characters', attrs: ' maxlength="64" style="font-family:monospace"' })) + UI.field('Ack No', UI.input('edAck', e.ackNo)) + UI.field('Ack Date', UI.input('edAckDt', e.ackDt, { placeholder: 'as on the portal' })) + '</div>' +
          UI.field('Signed QR code (optional, prints as the QR image)', '<textarea id="edQr" rows="2" style="font-family:monospace;font-size:11px" placeholder="eyJhbGciOi...">' + esc(e.qr || '') + '</textarea>') +
          UI.check('edSkipE', 'Not needed for this invoice', !!skip.einv) + '</div></div>' +
        '<div class="card white"><div class="hd">E-Way Bill ' + pill(n.ewb, !!w.no, skip.ewb) + '</div><div class="bd">' +
          '<div class="hint">' + esc(why('ewb')) + '</div>' + (n.ewb || w.no ? probs('ewb') : '') +
          '<div class="grid3">' + UI.field('Mode', UI.select('edMode', MODES, tr.mode)) + UI.field('Vehicle No', UI.input('edVeh', tr.vehicleNo, { attrs: ' style="text-transform:uppercase"' }), { hint: 'From Vehicle Number on the invoice' }) + UI.field('Vehicle Type', UI.select('edVT', [['R', 'Regular'], ['O', 'Over-dimensional cargo']], tr.vehType)) +
            UI.field('Distance (km)', UI.input('edKm', tr.distance, { type: 'number', attrs: ' min="0" max="4000"' }), { hint: '0 = the portal works it out from the PIN codes' }) + UI.field('Transporter ID', UI.input('edTid', tr.transId, { placeholder: 'GSTIN / TRANSIN', attrs: ' maxlength="15" style="text-transform:uppercase"' })) + UI.field('Transporter Name', UI.input('edTnm', tr.transName)) +
            UI.field('Transport Doc No (LR / RR / AWB)', UI.input('edTdn', tr.docNo, { attrs: ' maxlength="15"' })) + UI.field('Transport Doc Date', UI.dateInput('edTdd', tr.docDt)) + '</div>' +
          '<div class="btnrow"><button class="btn blue" id="edEwb"' + (this.goods(inv) ? '' : ' disabled') + '>Download E-Way Bill JSON</button><a class="btn outline" href="' + PORTAL.ewb + '" target="_blank" rel="noopener">Open E-Way Bill portal</a></div>' +
          '<div class="grid3">' + UI.field('E-Way Bill No', UI.input('edEwbNo', w.no, { placeholder: '12 digits', attrs: ' maxlength="12" inputmode="numeric"' })) + UI.field('E-Way Bill Date', UI.input('edEwbDt', w.date)) + UI.field('Valid Upto', UI.input('edEwbV', w.validUpto)) + '</div>' +
          UI.check('edSkipW', 'Not needed for this invoice (e.g. goods not moved, exempt goods, handed over at the counter)', !!skip.ewb) + '</div></div>' +
        '<div class="hint">An IRN can be cancelled on the portal within 24 hours of being made; after that the invoice is corrected with a credit note. Change an invoice that has an IRN only if the portal has it cancelled.</div>',
        buttons: [{ label: 'Close', cls: 'outline' }, { label: 'Upload portal result', cls: 'outline', onClick: () => { this.importResult(() => { if (onClose) onClose(); }); } }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const irn = UI.val('edIrn', bg).trim(), ewbNo = UI.val('edEwbNo', bg).replace(/\D/g, '');
          if (irn && !/^[0-9a-f]{64}$/i.test(irn)) { UI.mark('edIrn', true, bg); UI.toast('The IRN is 64 characters (letters a-f and digits)'); return false; }
          if (ewbNo && ewbNo.length !== 12) { UI.mark('edEwbNo', true, bg); UI.toast('The e-way bill number has 12 digits'); return false; }
          this.record(inv, { einv: { irn: irn.toLowerCase(), ackNo: UI.val('edAck', bg).trim(), ackDt: UI.val('edAckDt', bg).trim(), qr: UI.val('edQr', bg).trim() }, ewb: { no: ewbNo, date: UI.val('edEwbDt', bg).trim(), validUpto: UI.val('edEwbV', bg).trim() }, trans: readTrans(bg),
            skip: { einv: UI.val('edSkipE', bg) ? 'not needed' : '', ewb: UI.val('edSkipW', bg) ? 'not needed' : '' } });
          UI.toast('Saved on invoice ' + inv.no, 2500, 'ok'); if (onClose) onClose();
        } }] });
      // The vehicle number lives on the invoice (Other Details); the rest of Part B with the e-documents
      const readTrans = (bg) => ({ mode: UI.val('edMode', bg), vehType: UI.val('edVT', bg), distance: UI.val('edKm', bg), transId: UI.val('edTid', bg).trim().toUpperCase(), transName: UI.val('edTnm', bg).trim(), docNo: UI.val('edTdn', bg).trim(), docDt: UI.dateVal('edTdd', bg) });
      const keepTrans = () => { const cur = Store.find('invoices', inv.id) || inv, veh = UI.val('edVeh', bg).replace(/[\s-]/g, '').toUpperCase(); cur.trans = readTrans(bg); cur.other = Object.assign({}, cur.other || {}, { vehicleNo: veh }); Store.update('invoices', cur); inv = cur; return cur; };
      $('#edEinv', bg).onclick = () => this.download('einv', [keepTrans()]);
      $('#edEwb', bg).onclick = () => this.download('ewb', [keepTrans()]);
      // A signed QR pasted in brings the IRN and the document details with it
      $('#edQr', bg).addEventListener('change', () => { const q = this.qrData(UI.val('edQr', bg)); if (q && q.Irn && !UI.val('edIrn', bg)) $('#edIrn', bg).value = q.Irn; if (q && q.DocNo && String(q.DocNo).trim().toUpperCase() !== String(inv.no).trim().toUpperCase()) UI.toast('This QR code is of document ' + q.DocNo + ', not ' + inv.no, 5000); });
      return bg;
    },
    // After an invoice is saved: the dialog when something is still to be made
    afterSave(inv) { if (!inv || !inv.id) return; const p = this.pending(inv); if (!p.any) return; setTimeout(() => this.dialog(inv), 50); },
    // Before printing an invoice: what is needed and not made yet is said first
    gate(editor, go) {
      const inv = editor.inv, p = this.pending(inv); if (!p.any) return go();
      const what = [p.einv ? 'an e-invoice (IRN)' : '', p.ewb ? 'an e-way bill' : ''].filter(Boolean).join(' and ');
      UI.modal({ title: 'e-Invoice / E-Way Bill needed', body: '<p>Invoice value is ' + money(this.total(inv)) + '. This invoice needs ' + what + ' (Settings &gt; E-Invoice &amp; E-Way Bill).</p><p>Save it and make ' + (p.einv && p.ewb ? 'them' : 'it') + ' first, so the IRN' + (p.ewb ? ' and the e-way bill number' : '') + ' print on the invoice, or print it now and add ' + (p.einv && p.ewb ? 'them' : 'it') + ' later.</p>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Print now', cls: 'outline', onClick: go }, { label: 'Save & make them', cls: 'green', onClick: () => {
          const saved = editor.inv.id && editor.locked ? editor.inv : editor.save(); if (!saved) return;
          Invoice.open({ id: saved.id }); this.dialog(saved, () => Invoice.open({ id: saved.id }));
        } }] });
    },
    // The invoices waiting for one, with the JSON of all of them at once
    pendingDialog(onClose) {
      const list = this.pendingList();
      const bg = UI.modal({ title: 'e-Invoices & E-Way Bills to make', wide: true, body: list.length ? '<div class="tablewrap"><table class="list"><thead><tr><th><input type="checkbox" id="edAll" checked></th><th>Invoice</th><th>Date</th><th>Buyer</th><th class="num">Value</th><th>Needs</th><th></th></tr></thead><tbody>' +
          list.map(i => { const p = this.pending(i); return '<tr><td><input type="checkbox" class="edSel" data-id="' + esc(i.id) + '" checked></td><td><b>' + esc(i.no) + '</b></td><td>' + esc(i.date) + '</td><td>' + esc(U.titleCase(lines(i.buyer || {})[0] || '')) + '</td><td class="num">' + money(this.total(i)) + '</td><td>' + [p.einv ? '<span class="pill bad">e-Invoice</span>' : '', p.ewb ? '<span class="pill warn">E-Way Bill</span>' : ''].join(' ') + '</td><td><button class="btn sm" data-ed="' + esc(i.id) + '">Open</button></td></tr>'; }).join('') + '</tbody></table></div>'
          : '<div class="empty">Nothing pending: every invoice that needs an e-invoice or an e-way bill has one.</div>',
        buttons: [{ label: 'Close', cls: 'outline' }].concat(list.length ? [{ label: 'Upload portal result', cls: 'outline', onClick: () => { this.importResult(onClose); } }, { label: 'E-Way Bill JSON', cls: 'blue', onClick: (bg) => { this.download('ewb', sel(bg).filter(i => this.pending(i).ewb)); return false; } }, { label: 'e-Invoice JSON', cls: 'green', onClick: (bg) => { this.download('einv', sel(bg).filter(i => this.pending(i).einv)); return false; } }] : []) });
      const sel = (bg) => $$('.edSel', bg).filter(c => c.checked).map(c => Store.find('invoices', c.dataset.id)).filter(Boolean);
      if ($('#edAll', bg)) $('#edAll', bg).onchange = (e) => $$('.edSel', bg).forEach(c => { c.checked = e.target.checked; });
      $$('[data-ed]', bg).forEach(b => b.onclick = () => { bg.remove(); this.dialog(Store.find('invoices', b.dataset.ed), onClose); });
      return bg;
    },

    // ------------------------------------------------------------ Settings > E-Invoice & E-Way Bill
    tab() {
      const s = this.settings(), edit = Settings.mayEdit(), india = U.isIndia(), list = india ? this.pendingList() : [], seller = this.seller();
      if (!india) return { html: '<div class="card white"><div class="hd">e-Invoicing</div><div class="bd"><p class="hint" style="margin-top:0">The e-invoice (IRN) and the e-way bill are rules of Indian GST. The books of <b>' + esc(Store.company().name || 'this company') + '</b> are kept for ' + esc(U.region().name) + ', where neither applies. ' +
        (U.region().code === 'AE' ? 'The UAE\'s own e-invoicing (through accredited service providers on the PINT AE format) is being brought in in phases; BlitzBook\'s tax invoices carry the TRN and the VAT the FTA asks for.' : U.region().code === 'AU' ? 'In Australia e-invoicing runs on the Peppol network and is optional between businesses; a tax invoice from $1,000 shows the buyer\'s identity or ABN.' : 'In the United States there is no national e-invoice; each state sets its own sales tax.') + '</p></div></div>' };
      const dis = edit ? '' : ' disabled';
      return { html: '<div class="card white"><div class="hd">e-Invoice &amp; E-Way Bill</div><div class="bd">' +
          '<p class="hint" style="margin-top:0">When an invoice is above the limit, BlitzBook makes the e-invoice and the e-way bill as JSON files the government portals take (the same files their offline tools make). You upload them with your own GST login and bring back the IRN and the e-way bill number: no API, no GSP subscription and no portal password in BlitzBook. Direct generation needs API credentials from the IRP through a GST Suvidha Provider; ask us when you have them.</p>' +
          '<div class="grid2">' +
          '<div class="field"><label>e-Invoice (IRN)</label>' + UI.check('esEinv', 'Make e-invoices for B2B invoices', s.einvOn).replace('<input', '<input' + dis) +
            UI.select('esRule', [['above', 'When the invoice value is above the limit'], ['all', 'For every B2B invoice (turnover above ₹5 crore)']], s.einvRule, { attrs: dis }) + '</div>' +
          UI.field('e-Invoice limit (₹)', UI.input('esELim', s.einvLimit, { type: 'number', attrs: ' min="0" step="1"' + dis }), { hint: 'An invoice of more than this needs an e-invoice' }) +
          '<div class="field"><label>E-Way Bill</label>' + UI.check('esEwb', 'Make e-way bills when goods move', s.ewbOn).replace('<input', '<input' + dis) + UI.check('esStates', 'Use ₹1,00,000 for movement within Maharashtra, Delhi, Tamil Nadu and Bihar', s.ewbStates).replace('<input', '<input' + dis) + '</div>' +
          UI.field('E-Way Bill limit (₹)', UI.input('esWLim', s.ewbLimit, { type: 'number', attrs: ' min="0" step="1"' + dis }), { hint: 'The value of the consignment, tax included' }) + '</div>' +
          '<div class="section-title">Part B: the usual transport</div><div class="grid3">' + UI.field('Mode', UI.select('esMode', MODES, s.mode, { attrs: dis })) + UI.field('Vehicle Type', UI.select('esVT', [['R', 'Regular'], ['O', 'Over-dimensional cargo']], s.vehType, { attrs: dis })) +
            UI.field('Distance (km)', UI.input('esKm', s.distance, { type: 'number', attrs: ' min="0" max="4000"' + dis }), { hint: '0 = worked out by the portal from the PIN codes' }) + UI.field('Transporter ID', UI.input('esTid', s.transId, { placeholder: 'GSTIN / TRANSIN', attrs: ' maxlength="15" style="text-transform:uppercase"' + dis })) + UI.field('Transporter Name', UI.input('esTnm', s.transName, { attrs: dis })) + '</div>' +
          '<div class="section-title">Dispatch from</div><div class="grid3">' + UI.field('PIN code', UI.input('esPin', s.pin, { placeholder: seller.pin || 'from the address', attrs: ' maxlength="6" inputmode="numeric"' + dis }), { hint: seller.pin && !s.pin ? 'Found in the address: ' + seller.pin : 'Blank = the PIN in the Company Profile address' }) + UI.field('Place', UI.input('esPlace', s.place, { placeholder: seller.place || 'City', attrs: dis })) + '</div>' +
          (edit ? '<div class="btnrow"><button class="btn green" id="esSave">Save</button><button class="btn outline" id="esStd">Defaults</button></div>' : '<div class="hint">Only the owner or an admin changes this.</div>') + '</div></div>' +
          '<div class="card white"><div class="hd">Waiting for an IRN or an e-way bill <span class="pill ' + (list.length ? 'bad' : 'ok') + '">' + list.length + '</span></div><div class="bd">' +
          (list.length ? '<p class="hint" style="margin-top:0">' + list.slice(0, 8).map(i => esc(i.no)).join(', ') + (list.length > 8 ? ' ...' : '') + '</p>' : '<div class="hint">Nothing pending.</div>') +
          '<div class="btnrow"><button class="btn blue" id="esPend"' + (list.length ? '' : ' disabled') + '>Make them</button><button class="btn outline" id="esRes">Upload portal result</button></div>' +
          '<ol class="hint"><li>Download the JSON (one invoice from its screen, or all of them here).</li><li>e-Invoice: log in at einvoice1.gst.gov.in > e-Invoice > Bulk Upload, upload the file. E-way bill: ewaybillgst.gov.in > e-Waybill > Generate Bulk.</li><li>Download the result (Excel or JSON) from the portal and upload it here with <b>Upload portal result</b>, or type the IRN and the e-way bill number into the invoice.</li><li>Print: the IRN, the acknowledgement, the QR code and the e-way bill number come on the invoice.</li></ol></div></div>',
        wire: (root, again) => {
          $('#esPend').onclick = () => this.pendingDialog(again);
          $('#esRes').onclick = () => this.importResult(again);
          if (!edit) return;
          $('#esSave').onclick = () => {
            const pin = UI.val('esPin', root).trim(); if (pin && !/^[1-9]\d{5}$/.test(pin)) { UI.mark('esPin', true, root); UI.toast('The PIN code has 6 digits'); return; }
            const v = { einvOn: !!UI.val('esEinv', root), einvRule: UI.val('esRule', root), einvLimit: Math.max(0, num(UI.val('esELim', root))), ewbOn: !!UI.val('esEwb', root), ewbLimit: Math.max(0, num(UI.val('esWLim', root))), ewbStates: !!UI.val('esStates', root), mode: UI.val('esMode', root), vehType: UI.val('esVT', root), distance: Math.max(0, num(UI.val('esKm', root))), transId: UI.val('esTid', root).trim().toUpperCase(), transName: UI.val('esTnm', root).trim(), pin, place: UI.val('esPlace', root).trim() };
            if (Settings.save({ edocs: v }) === false) return; UI.toast('E-Invoice & E-Way Bill settings saved', 3000, 'ok'); again();
          };
          $('#esStd').onclick = () => { if (Settings.save({ edocs: undefined }) === false) return; UI.toast('Back to the defaults: both on, above ₹50,000'); again(); };
        } };
    }
  };

  // ------------------------------------------------------------ the invoice editor and the sales list (invoice.js)
  if (global.Invoice) {
    Invoice.eway = function (go) { if (ED.applies()) return ED.gate(this, go); go(); };
    const print = Invoice.print;
    // The QR image is drawn before the invoice prints, so it is on the first print too
    Invoice.print = function (kind) { const inv = this.inv, qr = inv && inv.einv && inv.einv.qr; if (qr && !ED.qrs.has(qr)) { ED.qrImage(qr).then(() => print.call(this, kind)); return; } return print.call(this, kind); };
    const render = Invoice.render;
    Invoice.render = function () {
      const r = render.apply(this, arguments), inv = this.inv;
      if (!inv || inv.kind === 'challan' || !inv.id || !ED.applies()) return r;
      const n = ED.needs(inv), has = (inv.einv && inv.einv.irn) || (inv.ewb && inv.ewb.no);
      if (!n.einv && !n.ewb && !has && !inv.skip) return r;
      const hero = $('#view .inv-hero'); if (!hero) return r;
      const p = ED.pending(inv), e = inv.einv || {}, w = inv.ewb || {};
      hero.insertAdjacentHTML('afterend', '<div class="lockbar ' + (p.any ? 'edpend' : 'eddone') + '" id="iEdBar"><span>' + ED.status(inv) + (e.irn ? ' <span class="small muted">IRN ' + esc(e.irn.slice(0, 12)) + '…</span>' : '') + (w.no ? ' <span class="small muted">EWB ' + esc(w.no) + '</span>' : '') + '</span><button class="btn sm blue" id="iEdocs">' + (p.any ? 'Make e-Invoice / E-Way Bill' : 'e-Invoice / E-Way Bill') + '</button></div>');
      $('#iEdocs').onclick = () => ED.dialog(inv, () => Invoice.open({ id: inv.id }));
      if (e.qr) ED.qrImage(e.qr);
      return r;
    };
  }
  if (App.routes.sales) {
    const sales = App.routes.sales;
    App.routes.sales = function () {
      const r = sales.apply(this, arguments);
      if (!ED.applies()) return r;
      const n = ED.pendingList().length, row = $('#view .page-h .btnrow');
      if (row) { row.insertAdjacentHTML('beforeend', '<button class="btn sm ' + (n ? 'red' : 'outline') + '" id="sEdocs" title="Invoices waiting for an IRN or an e-way bill">e-Invoice / E-Way' + (n ? ' (' + n + ')' : '') + '</button>'); $('#sEdocs').onclick = () => ED.pendingDialog(() => App.go('sales')); }
      return r;
    };
  }
  global.EDocs = ED;
})(window);
