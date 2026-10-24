/* BlitzBook web portal - GST returns. Fetches the sales invoices, credit notes, purchases and expenses of a return
   period from the books and writes the two JSON files the GST portal takes (Returns > Upload JSON), in the layout of
   its own offline tools:
     - GSTR-1, the outward supplies: B2B (registered buyers, invoice by invoice), B2CL (inter-state invoices above
       Rs 1,00,000 to unregistered buyers), B2CS (every other sale, summed by state and rate), credit notes (CDNR for
       registered buyers, CDNUR for B2CL invoices, the rest netted into B2CS as the rules say), nil-rated supplies,
       the HSN summary (table 12, B2B and B2C lines apart since April 2025) and the documents issued;
     - GSTR-3B, the monthly summary: outward taxable supplies (3.1 a), nil-rated (3.1 c), inward supplies under
       reverse charge (3.1 d), inter-state supplies to unregistered persons by state (3.2) and the input tax credit
       (4 A: reverse charge and all other ITC, net of debit notes).
   The GST entry in the top bar is shown to everyone; the screen works on a yearly plan or longer and during the
   30-day trial (Sub.isYearly), otherwise it says so and offers the plan. Always check the files in the offline tool before filing. */
(function (global) {
  'use strict';
  const { esc, num, money } = U;
  const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // An inter-state invoice to an unregistered buyer above this is reported invoice by invoice (B2CL), Rs 1,00,000 since 1 August 2024
  const B2CL_LIMIT = 100000;
  // The unit codes the GST portal's JSON carries (the code alone, "PCS", not the "PCS-PIECES" label of the Excel template);
  // services (SAC, 99...) go with "NA" and no quantity
  const UQC = ['BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN', 'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS', 'NOS', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS', 'OTH'];
  const uqcOf = (hsn, uqc) => /^99/.test(hsn) ? 'NA' : UQC.includes(String(uqc || 'NOS').toUpperCase()) ? String(uqc || 'NOS').toUpperCase() : 'OTH';

  // ------------------------------------------------------------ return periods
  // {fp: 'MMYYYY' (the month, or the last month of a quarter), from / to in ms, label, q}
  function monthPeriod(m, y) { const a = new Date(y, m, 1), b = new Date(y, m + 1, 0); return { fp: U.pad(a.getMonth() + 1) + a.getFullYear(), from: a.getTime(), to: b.getTime(), label: MONTHS[a.getMonth()] + ' ' + a.getFullYear(), q: false }; }
  function quarterPeriod(mEnd, y) {
    const b = new Date(y, mEnd + 1, 0), a = new Date(b.getFullYear(), b.getMonth() - 2, 1);
    return { fp: U.pad(b.getMonth() + 1) + b.getFullYear(), from: a.getTime(), to: b.getTime(), label: 'Quarter ' + MONTHS[a.getMonth()].slice(0, 3) + ' - ' + MONTHS[b.getMonth()].slice(0, 3) + ' ' + b.getFullYear(), q: true };
  }
  const keyOf = (p) => (p.q ? 'Q' : 'M') + p.fp;
  function periodOf(key) { const m = /^([MQ])(\d{2})(\d{4})$/.exec(key || ''); if (!m) return null; return m[1] === 'Q' ? quarterPeriod(+m[2] - 1, +m[3]) : monthPeriod(+m[2] - 1, +m[3]); }
  // The last 24 months and the last 8 quarters, newest first
  function periods() {
    const out = [], n = new Date();
    for (let i = 0; i < 24; i++) { const d = new Date(n.getFullYear(), n.getMonth() - i, 1); out.push(monthPeriod(d.getMonth(), d.getFullYear())); }
    for (let i = 0; i < 8; i++) { const d = new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3 + 2 - 3 * i, 1); out.push(quarterPeriod(d.getMonth(), d.getFullYear())); }
    return out;
  }
  // Returns are filed for the month gone by
  function defaultPeriod() { const n = new Date(), d = new Date(n.getFullYear(), n.getMonth() - 1, 1); return monthPeriod(d.getMonth(), d.getFullYear()); }

  // ------------------------------------------------------------ the figures of a period
  function dt(d) { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || ''); return m ? m[1] + '-' + m[2] + '-' + m[3] : String(d || ''); }
  function valid(g) { g = String(g || '').trim().toUpperCase(); return g.length === 15 && U.isValidGstin(g) ? g : ''; }
  // Place of supply: the party's state, else the state in its GSTIN, else our own
  function posOf(party, seller) { return U.stateCode(party.state) || (valid(party.gstin) ? valid(party.gstin).slice(0, 2) : '') || seller; }
  const byNo = (a, b) => U.dateMs(a.date) - U.dateMs(b.date) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true });
  const tax = (txval, rt, intra) => intra ? { iamt: 0, camt: r2(txval * rt / 200), samt: r2(txval * rt / 200) } : { iamt: r2(txval * rt / 100), camt: 0, samt: 0 };
  // An invoice / note line as the offline tool's itm_det: CGST + SGST on an intra-state line, IGST on an inter-state one
  const det = (txval, rt, intra) => { const t = tax(txval, rt, intra); return Object.assign({ txval: r2(txval), rt }, intra ? { camt: t.camt, samt: t.samt } : { iamt: t.iamt }, { csamt: 0 }); };
  const addTo = (o, d, sign) => { ['txval', 'iamt', 'camt', 'samt'].forEach(k => { o[k] = r2(o[k] + (sign || 1) * num(d[k])); }); };
  const zero = () => ({ txval: 0, iamt: 0, camt: 0, samt: 0 });
  // First-to-last document numbers of a series, for table 13
  function series(list) { const nos = list.map(x => String(x.no || '')).filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); return nos.length ? { from: nos[0], to: nos[nos.length - 1], totnum: nos.length } : null; }

  function collect(p) {
    const seller = Biz.sellerStateCode(), warn = [], rows = [];
    const inRange = (d) => Books.inRange(d, p.from, p.to);
    const invs = Biz.invoices().filter(i => inRange(i.date)).sort(byNo);
    const notes = Store.list('notes').filter(n => inRange(n.date)).sort(byNo), cns = notes.filter(n => n.kind === 'CN'), dns = notes.filter(n => n.kind === 'DN');
    const purchases = Store.list('purchases').filter(x => x.kind === 'PUR' && inRange(x.date)), expenses = Store.list('expenses').filter(x => inRange(x.date)), challans = Store.list('challans').filter(d => inRange(d.date));
    const b2b = new Map(), b2cl = new Map(), b2cs = new Map(), cdnr = new Map(), cdnur = [], hsn = { b2b: new Map(), b2c: new Map() };
    const nil = { INTRB2B: 0, INTRB2C: 0, INTRAB2B: 0, INTRAB2C: 0 };
    const out = zero(), rcm = zero(), cn = zero(), count = { b2b: 0, b2cl: 0, b2cs: 0, nil: 0, cn: 0, noHsn: 0 };
    const b2csKey = (intra, pos, rt) => (intra ? 'INTRA' : 'INTER') + '|' + pos + '|' + rt;
    const b2csEntry = (intra, pos, rt) => { const k = b2csKey(intra, pos, rt); let e = b2cs.get(k); if (!e) { e = Object.assign({ sply_ty: intra ? 'INTRA' : 'INTER', rt, typ: 'OE', pos }, zero()); b2cs.set(k, e); } return e; };

    invs.forEach(inv => {
      const ctin = valid(inv.buyer.gstin), pos = posOf(inv.buyer, seller), intra = pos === seller, val = r2(num(inv.totals.rounded) || num(inv.totals.grand));
      if (String(inv.buyer.gstin || '').trim() && !ctin) warn.push('Invoice ' + inv.no + ': buyer GSTIN "' + inv.buyer.gstin + '" is not valid, so it is reported as a B2C sale');
      const byRate = new Map(); let nilAmt = 0;
      inv.items.forEach(it => {
        const txval = r2(it.taxable), rt = num(it.gst); if (txval <= 0) return;
        if (!String(it.hsn || '').trim()) count.noHsn++;
        if (rt === 0) nilAmt = r2(nilAmt + txval); else { const k = String(rt); byRate.set(k, r2((byRate.get(k) || 0) + txval)); }
        // Table 12, HSN-wise, by HSN, rate and unit (nil-rated lines included), registered buyers apart from the rest
        const hsn_sc = String(it.hsn || '').trim(), uqc = uqcOf(hsn_sc, it.uqc), hk = hsn_sc + '|' + rt + '|' + uqc, hm = ctin ? hsn.b2b : hsn.b2c;
        let h = hm.get(hk); if (!h) { h = Object.assign({ hsn_sc, desc: String(it.desc || '').trim().slice(0, 30), uqc, qty: 0, rt }, zero()); hm.set(hk, h); }
        if (uqc !== 'NA') h.qty = r2(h.qty + num(it.qty)); addTo(h, det(txval, rt, intra));
      });
      if (nilAmt > 0) { const k = (intra ? 'INTRA' : 'INTR') + (ctin ? 'B2B' : 'B2C'); nil[k] = r2(nil[k] + nilAmt); count.nil++; }
      const itms = Array.from(byRate.entries()).sort((a, b) => num(a[0]) - num(b[0])).map(([k, txval], n) => ({ num: n + 1, itm_det: det(txval, num(k), intra) }));
      const sum = zero(); itms.forEach(x => addTo(sum, x.itm_det));
      let table = nilAmt > 0 && !itms.length ? 'Nil-rated' : 'No value';
      if (itms.length) {
        if (inv.rcm) addTo(rcm, sum); else addTo(out, sum);
        if (ctin) {
          table = 'B2B'; count.b2b++;
          if (!b2b.has(ctin)) b2b.set(ctin, { ctin, inv: [] });
          b2b.get(ctin).inv.push({ inum: String(inv.no), idt: dt(inv.date), val, pos, rchrg: inv.rcm ? 'Y' : 'N', inv_typ: 'R', itms });
        } else if (!intra && val > B2CL_LIMIT) {
          table = 'B2CL'; count.b2cl++;
          if (!b2cl.has(pos)) b2cl.set(pos, { pos, inv: [] });
          b2cl.get(pos).inv.push({ inum: String(inv.no), idt: dt(inv.date), val, itms });
        } else {
          table = 'B2CS'; count.b2cs++;
          itms.forEach(x => addTo(b2csEntry(intra, pos, x.itm_det.rt), x.itm_det));
        }
      }
      rows.push({ kind: 'Invoice', no: inv.no, date: inv.date, party: Books.partyName(inv.buyer.name) || '(cash sale)', gstin: ctin, pos, table: table + (inv.rcm ? ' (RCM)' : ''), txval: r2(sum.txval + nilAmt), tax: r2(sum.iamt + sum.camt + sum.samt), val });
    });

    // Credit notes: table 9B for registered buyers, CDNUR for the B2CL kind, the rest come off B2CS (table 7)
    const allInvs = Biz.invoices();
    cns.forEach(n => {
      const ctin = valid(n.partyGstin), ref = allInvs.find(i => i.no === String(n.ref || '').trim()) || null;
      const pos = ref ? posOf(ref.buyer, seller) : ctin ? ctin.slice(0, 2) : seller;
      const intra = num(n.igst) > 0 ? false : num(n.cgst) > 0 || num(n.sgst) > 0 ? true : pos === seller;
      const rt = num(n.rate), txval = r2(n.taxable), val = r2(n.total);
      const d = Object.assign({ txval, rt }, intra ? { camt: r2(n.cgst), samt: r2(n.sgst) } : { iamt: r2(n.igst) }, { csamt: 0 });
      addTo(cn, d); count.cn++;
      let table;
      if (ctin) {
        table = 'CDNR';
        if (!cdnr.has(ctin)) cdnr.set(ctin, { ctin, nt: [] });
        cdnr.get(ctin).nt.push({ nt_num: String(n.no), nt_dt: dt(n.date), ntty: 'C', val, pos, rchrg: 'N', inv_typ: 'R', itms: [{ num: 1, itm_det: d }] });
      } else if (!intra && ref && (num(ref.totals.rounded) || num(ref.totals.grand)) > B2CL_LIMIT) {
        table = 'CDNUR';
        cdnur.push({ typ: 'B2CL', ntty: 'C', nt_num: String(n.no), nt_dt: dt(n.date), val, pos, itms: [{ num: 1, itm_det: d }] });
      } else {
        table = 'B2CS (netted)';
        if (rt > 0) addTo(b2csEntry(intra, pos, rt), d, -1);
      }
      rows.push({ kind: 'Credit note', no: n.no, date: n.date, party: n.party, gstin: ctin, pos, table, txval: -txval, tax: -r2(num(n.igst) + num(n.cgst) + num(n.sgst)), val: -val });
    });
    b2cs.forEach((e, k) => { if (e.txval < -0.005) { warn.push('B2C sales in state ' + e.pos + ' at ' + e.rt + '% come to less than the credit notes against them (' + money(e.txval) + '): reported as nil; adjust it on the portal'); ['txval', 'iamt', 'camt', 'samt'].forEach(x => { e[x] = Math.max(0, e[x]); }); } if (e.txval <= 0) b2cs.delete(k); });
    if (count.noHsn) warn.push(count.noHsn + ' invoice line' + (count.noHsn === 1 ? ' has' : 's have') + ' no HSN / SAC: fill them in before uploading the HSN summary');

    // Inward side (GSTR-3B): tax payable under reverse charge, and the input tax credit
    const inRcm = zero(), itc = zero(), itcRcm = zero();
    purchases.forEach(x => { const s = Books.gstSplit(x), d = { txval: num(x.taxable), camt: s[0], samt: s[1], iamt: s[2] }; if (x.rcm) { addTo(inRcm, d); addTo(itcRcm, d); } else addTo(itc, d); });
    expenses.forEach(x => { const e = Books.expenseAmounts(x), d = { txval: e.taxable, camt: e.cgst, samt: e.sgst, iamt: e.igst }; if (x.rcm) { addTo(inRcm, d); addTo(itcRcm, d); } else addTo(itc, d); });
    dns.forEach(n => addTo(itc, { txval: num(n.taxable), camt: num(n.cgst), samt: num(n.sgst), iamt: num(n.igst) }, -1));
    // Outward figures net of credit notes, as GSTR-3B 3.1(a) wants them
    const net = zero(); addTo(net, out); addTo(net, cn, -1);
    // Inter-state supplies to unregistered persons by place of supply (3.2), from B2CL and B2CS
    const unreg = new Map();
    const addUnreg = (pos, d) => { if (!unreg.has(pos)) unreg.set(pos, { pos, txval: 0, iamt: 0 }); const u = unreg.get(pos); u.txval = r2(u.txval + num(d.txval)); u.iamt = r2(u.iamt + num(d.iamt)); };
    b2cl.forEach(g => g.inv.forEach(i => i.itms.forEach(x => addUnreg(g.pos, x.itm_det))));
    cdnur.forEach(n => n.itms.forEach(x => addUnreg(n.pos, { txval: -x.itm_det.txval, iamt: -num(x.itm_det.iamt) })));
    b2cs.forEach(e => { if (e.sply_ty === 'INTER') addUnreg(e.pos, e); });
    const nilTotal = r2(nil.INTRB2B + nil.INTRB2C + nil.INTRAB2B + nil.INTRAB2C);
    return { p, invs, cns, dns, purchases, expenses, challans, b2b: Array.from(b2b.values()), b2cl: Array.from(b2cl.values()), b2cs: Array.from(b2cs.values()), cdnr: Array.from(cdnr.values()), cdnur, nil, nilTotal, hsn: { b2b: Array.from(hsn.b2b.values()), b2c: Array.from(hsn.b2c.values()) },
      out, rcm, cn, net, inRcm, itc, itcRcm, unreg: Array.from(unreg.values()).filter(u => u.txval > 0), count, warn, rows };
  }

  // ------------------------------------------------------------ the two files
  /* The file the GST portal's Upload JSON takes is the one its own Returns Offline Tool (V3.2.4) generates, and the
     portal rejects anything else ("File could not be uploaded! Download the latest version of Offline tool").
     Read from the tool's code (utility/common.js, utility/returnStructure.js): gstin, fp, version "GST3.2.4" and
     hash "hash" (literal), then only the sections with data; no filing type, file date, turnover (asked only for
     2017-18), flags or checksums (those are the portal's own, in the file it lets you download). Lines carry CGST +
     SGST or IGST, never both. Since May 2025 the HSN summary is hsn_b2b / hsn_b2c with the unit code alone (NA
     for services). Table 13 lists only the document types issued, each with its name. */
  const DOC_TYPES = ['Invoices for outward supply', 'Invoices for inward supply from unregistered person', 'Revised Invoice', 'Debit Note', 'Credit Note', 'Receipt Voucher', 'Payment Voucher', 'Refund Voucher',
    'Delivery Challan for job work', 'Delivery Challan for supply on approval', 'Delivery Challan in case of liquid gas', 'Delivery Challan in case other than by way of supply (excluding at S no. 9 to 11)'];
  const GSTR1_VERSION = 'GST3.2.4';
  function gstr1(d, gstin) {
    const j = { gstin, fp: d.p.fp, version: GSTR1_VERSION, hash: 'hash' };
    if (d.b2b.length) j.b2b = d.b2b;
    if (d.b2cl.length) j.b2cl = d.b2cl;
    if (d.b2cs.length) j.b2cs = d.b2cs.map(e => Object.assign({ sply_ty: e.sply_ty, rt: e.rt, typ: 'OE', pos: e.pos, txval: e.txval }, e.sply_ty === 'INTRA' ? { camt: e.camt, samt: e.samt } : { iamt: e.iamt }, { csamt: 0 }));
    if (d.cdnr.length) j.cdnr = d.cdnr;
    if (d.cdnur.length) j.cdnur = d.cdnur;
    if (d.nilTotal > 0) j.nil = { inv: ['INTRB2B', 'INTRB2C', 'INTRAB2B', 'INTRAB2C'].filter(k => d.nil[k] > 0).map(sply_ty => ({ sply_ty, expt_amt: 0, nil_amt: d.nil[sply_ty], ngsup_amt: 0 })) };
    const hsnRows = (list) => list.map((h, n) => ({ num: n + 1, hsn_sc: h.hsn_sc, desc: h.desc, uqc: h.uqc, qty: h.qty, rt: h.rt, txval: h.txval, iamt: h.iamt, samt: h.samt, camt: h.camt, csamt: 0 }));
    if (d.hsn.b2b.length || d.hsn.b2c.length) { j.hsn = {}; if (d.hsn.b2b.length) j.hsn.hsn_b2b = hsnRows(d.hsn.b2b); if (d.hsn.b2c.length) j.hsn.hsn_b2c = hsnRows(d.hsn.b2c); }
    // Table 13: the document types issued (1 invoices, 5 credit notes, 12 delivery challans), each one series
    const issued = [[1, d.invs], [5, d.cns], [12, d.challans]].map(([n, list]) => [n, series(list)]).filter(([, s]) => s);
    if (issued.length) j.doc_issue = { doc_det: issued.map(([n, s]) => ({ doc_num: n, doc_typ: DOC_TYPES[n - 1], docs: [Object.assign({ num: 1 }, s, { cancel: 0, net_issue: s.totnum })] })) };
    return j;
  }
  function gstr3b(d, gstin) {
    const amt = (o) => ({ iamt: r2(o.iamt), camt: r2(o.camt), samt: r2(o.samt), csamt: 0 });
    const itcNet = { iamt: r2(d.itc.iamt + d.itcRcm.iamt), camt: r2(d.itc.camt + d.itcRcm.camt), samt: r2(d.itc.samt + d.itcRcm.samt), csamt: 0 };
    const none = { iamt: 0, camt: 0, samt: 0, csamt: 0 };
    return {
      gstin, ret_period: d.p.fp,
      sup_details: {
        osup_det: Object.assign({ txval: r2(Math.max(0, d.net.txval)) }, amt(d.net)),
        osup_zero: { txval: 0, iamt: 0, csamt: 0 },
        osup_nil_exmp: { txval: d.nilTotal },
        isup_rev: Object.assign({ txval: r2(d.inRcm.txval) }, amt(d.inRcm)),
        osup_nongst: { txval: 0 }
      },
      inter_sup: { unreg_details: d.unreg.map(u => ({ pos: u.pos, txval: u.txval, iamt: u.iamt })), comp_details: [], uin_details: [] },
      itc_elg: {
        itc_avl: [Object.assign({ ty: 'IMPG' }, none), Object.assign({ ty: 'IMPS' }, none), Object.assign({ ty: 'ISRC' }, amt(d.itcRcm)), Object.assign({ ty: 'ISD' }, none), Object.assign({ ty: 'OTH' }, amt(d.itc))],
        itc_rev: [Object.assign({ ty: 'RUL' }, none), Object.assign({ ty: 'OTH' }, none)],
        itc_net: itcNet,
        itc_inelg: [Object.assign({ ty: 'RUL' }, none), Object.assign({ ty: 'OTH' }, none)]
      },
      inward_sup: { isup_details: [{ ty: 'GST', inter: 0, intra: 0 }, { ty: 'NONGST', inter: 0, intra: 0 }] },
      intr_ltfee: { intr_details: none }
    };
  }

  // ------------------------------------------------------------ the screen
  const GST = {
    // Everyone sees the GST entry; this is what those not on a yearly plan get when they open it
    locked() {
      return UI.modal({ title: 'Yearly subscription required', body: '<p>GSTR-1 and GSTR-3B JSON files are part of the <b>yearly plan</b> (and the 2 years and 5 years plans). ' + esc(Sub.statusText()) + '.</p>' +
        '<p>On a yearly plan this screen fetches the sales, credit notes, purchases and expenses of a return period from your books and writes the JSON files that upload to the GST portal through its offline tool.</p>',
        buttons: [{ label: 'Close', cls: 'outline' }, { label: 'Buy yearly plan', cls: 'blue', onClick: () => { Subscription.plans(); return false; } }] });
    },
    // Named as the GST offline tool names its own files: returns_<ddmmyyyy>_R1_<gstin>_offline.json, GSTR3B_<gstin>_<period>.json
    fileName(which, d, gstin) { const t = new Date(), today = U.pad(t.getDate()) + U.pad(t.getMonth() + 1) + t.getFullYear(); return which === '3B' ? 'GSTR3B_' + gstin + '_' + d.p.fp + '.json' : 'returns_' + today + '_R1_' + gstin + '_offline.json'; },
    // The files written this session, by return and period, so the filing guide knows the upload step has its file
    downloaded: {},
    download(which, d, gstin) {
      const j = which === '3B' ? gstr3b(d, gstin) : gstr1(d, gstin), name = GST.fileName(which, d, gstin);
      UI.download(name, JSON.stringify(j, null, 2), 'application/json');
      GST.downloaded[which + d.p.fp] = name;
      UI.toast('GSTR-' + which + ' JSON for ' + d.p.label + ' downloaded. Check it in the GST offline tool before filing.', 5000, 'ok');
      return j;
    },

    /* ---- filing on the GST portal, guided
       The GST portal has no free API for a taxpayer's login or for filing: the return APIs are open only to licensed
       GST Suvidha Providers (paid), and the login captcha is there precisely so that nothing logs in on a taxpayer's
       behalf. So BlitzBook does not try: it writes the file, opens the portal's login page in a new tab, and walks
       beside the user step by step, with a review table of what the portal's summary has to match before Submit and
       File. The username, password, captcha and the filing OTP are typed on the portal alone; BlitzBook never sees them. */
    PORTAL_LOGIN: 'https://services.gst.gov.in/services/login',
    PORTAL_RETURNS: 'https://return.gst.gov.in/returns/auth/dashboard',
    // The financial year a return period belongs to, as the portal's dropdown names it ("2026-27")
    fyOf(fp) { const m = +fp.slice(0, 2), y = +fp.slice(2); const a = m >= 4 ? y : y - 1; return a + '-' + String(a + 1).slice(2); },
    guideKey(which, fp, gstin) { return gstin + '.' + fp + '.' + which; },
    guideState(which, fp, gstin) { const all = Store.get('gstfile', {}) || {}; return all[GST.guideKey(which, fp, gstin)] || { steps: {}, review: {} }; },
    saveGuide(which, fp, gstin, st) { const all = Store.get('gstfile', {}) || {}; all[GST.guideKey(which, fp, gstin)] = st; Store.set('gstfile', all, true); },
    // What the portal shows after the upload (GSTR-1) or in the 3B form, figure by figure, from the same numbers the file carries
    reviewRows(which, d) {
      const sum = (list, f) => r2(list.reduce((s, x) => s + f(x), 0)), taxOf = (i) => num(i.iamt) + num(i.camt) + num(i.samt);
      const invs = (groups) => groups.reduce((a, g) => a.concat(g.inv || g.nt || []), []);
      const itms = (list) => list.reduce((a, i) => a.concat(i.itms || []), []).map(x => x.itm_det);
      if (which === '3B') {
        const outTax = r2(taxOf(d.net)), rcmTax = r2(taxOf(d.inRcm)), itcRcm = r2(taxOf(d.itcRcm)), itcOth = r2(taxOf(d.itc));
        return [
          { key: 'a', label: '3.1(a) Outward taxable supplies (net of credit notes)', value: 'Taxable ' + money(Math.max(0, d.net.txval)) + ', IGST ' + money(d.net.iamt) + ', CGST ' + money(d.net.camt) + ', SGST ' + money(d.net.samt) + ' (tax ' + money(outTax) + ')' },
          { key: 'c', label: '3.1(c) Nil-rated / exempt supplies', value: money(d.nilTotal) },
          { key: 'd', label: '3.1(d) Inward supplies liable to reverse charge', value: 'Taxable ' + money(d.inRcm.txval) + ', tax ' + money(rcmTax) },
          { key: 'u', label: '3.2 Inter-state supplies to unregistered persons', value: d.unreg.length ? d.unreg.map(u => 'POS ' + u.pos + ': ' + money(u.txval) + ' (IGST ' + money(u.iamt) + ')').join('; ') : 'none' },
          { key: 'i3', label: '4(A)(3) ITC on inward supplies under reverse charge', value: money(itcRcm) },
          { key: 'i5', label: '4(A)(5) All other ITC', value: money(itcOth) },
          { key: 'net', label: 'Tax payable in cash after ITC (before credit brought forward)', value: money(Math.max(0, r2(outTax + rcmTax - itcRcm - itcOth))) }
        ];
      }
      const b2b = invs(d.b2b), b2cl = invs(d.b2cl), cdnr = invs(d.cdnr), hsnAll = d.hsn.b2b.concat(d.hsn.b2c);
      const line = (list) => { const it = itms(list); return 'taxable ' + money(sum(it, x => x.txval)) + ', tax ' + money(sum(it, taxOf)); };
      const rows = [
        { key: 'b2b', label: 'Table 4 B2B: invoices to registered buyers', value: b2b.length + ' invoice' + (b2b.length === 1 ? '' : 's') + ' to ' + d.b2b.length + ' GSTIN' + (d.b2b.length === 1 ? '' : 's') + ', ' + line(b2b) + ', invoice value ' + money(sum(b2b, i => i.val)) },
        { key: 'b2cl', label: 'Table 5 B2CL: inter-state invoices above ' + money(B2CL_LIMIT) + ' to unregistered buyers', value: b2cl.length ? b2cl.length + ' invoice' + (b2cl.length === 1 ? '' : 's') + ', ' + line(b2cl) : 'none' },
        { key: 'b2cs', label: 'Table 7 B2CS: other sales, summed by state and rate', value: d.b2cs.length ? d.b2cs.length + ' line' + (d.b2cs.length === 1 ? '' : 's') + ', taxable ' + money(sum(d.b2cs, e => e.txval)) + ', tax ' + money(sum(d.b2cs, taxOf)) : 'none' },
        { key: 'cdn', label: 'Tables 9B CDNR / CDNUR: credit notes', value: (cdnr.length || d.cdnur.length) ? cdnr.length + ' to registered buyers (value ' + money(sum(cdnr, n => n.val)) + '), ' + d.cdnur.length + ' CDNUR (value ' + money(sum(d.cdnur, n => n.val)) + ')' : 'none' },
        { key: 'nil', label: 'Table 8 Nil-rated / exempt', value: d.nilTotal > 0 ? money(d.nilTotal) : 'none' },
        { key: 'hsn', label: 'Table 12 HSN summary', value: hsnAll.length + ' line' + (hsnAll.length === 1 ? '' : 's') + ' (' + d.hsn.b2b.length + ' B2B, ' + d.hsn.b2c.length + ' B2C), qty ' + U.fmtQty(sum(hsnAll, h => h.qty)) + ', taxable ' + money(sum(hsnAll, h => h.txval)) + ', tax ' + money(sum(hsnAll, taxOf)) }
      ];
      const issued = [[1, 'Invoices', d.invs], [5, 'Credit notes', d.cns], [12, 'Delivery challans', d.challans]].map(([n, l, list]) => [n, l, series(list)]).filter(x => x[2]);
      rows.push({ key: 'doc', label: 'Table 13 Documents issued', value: issued.length ? issued.map(x => x[1] + ' ' + x[2].from + ' to ' + x[2].to + ' (' + x[2].totnum + ', none cancelled)').join('; ') : 'none' });
      rows.push({ key: 'tot', label: 'Totals of the return (before credit notes)', value: 'Taxable ' + money(d.out.txval) + ', IGST ' + money(d.out.iamt) + ', CGST ' + money(d.out.camt) + ', SGST ' + money(d.out.samt) + ', tax ' + money(r2(taxOf(d.out))) });
      return rows;
    },
    openPortal(url) {
      let w = null; try { w = window.open(url || GST.PORTAL_LOGIN, '_blank', 'noopener'); } catch (e) { w = null; }
      if (!w) UI.toast('The browser blocked the new tab. Allow pop-ups for blitzbook.co.in, or open ' + (url || GST.PORTAL_LOGIN) + ' yourself.', 7000);
      return !!w;
    },
    // The guided filing panel for a return of a period
    guide(which, d, gstin) {
      const is3b = which === '3B', name = 'GSTR-' + which, fp = d.p.fp, st = GST.guideState(which, fp, gstin), rows = GST.reviewRows(which, d);
      const file = () => GST.downloaded[which + fp] || GST.fileName(which, d, gstin);
      const save = () => GST.saveGuide(which, fp, gstin, st);
      const tick = (k, label, body) => '<li class="gstep' + (st.steps[k] ? ' done' : '') + '" data-k="' + k + '"><label class="check"><input type="checkbox" data-step="' + k + '"' + (st.steps[k] ? ' checked' : '') + '> <b>' + label + '</b></label><div class="gbody">' + body + '</div></li>';
      const reviewTable = '<table class="list review"><thead><tr><th>What the portal shows</th><th>BlitzBook has</th><th>Matches</th></tr></thead><tbody>' +
        rows.map(r => '<tr><td style="text-align:left">' + esc(r.label) + '</td><td style="text-align:left">' + esc(r.value) + '</td><td><input type="checkbox" data-rev="' + r.key + '"' + (st.review[r.key] ? ' checked' : '') + ' aria-label="matches the portal"></td></tr>').join('') + '</tbody></table>';
      const allChecked = () => rows.every(r => st.review[r.key]);
      const body = '<div class="gstguide">' +
        '<div class="hint" style="line-height:1.6;margin-bottom:10px">BlitzBook cannot log into the GST portal or file for you: the portal has no free API for a taxpayer\'s login or for filing (those go only through licensed GST Suvidha Providers, which charge for it), and the login captcha is there to stop exactly that. So this panel does the next best thing: it writes the file, opens the portal, and lists what to check before the return is filed. <b>Your portal username, password, captcha and the filing OTP are typed on the portal alone; BlitzBook never sees them.</b>' + (st.filed ? ' <span class="pill ok">Marked as filed on ' + esc(st.filed) + '</span>' : '') + '</div>' +
        (d.warn.length ? '<div class="card white" style="margin-bottom:10px"><div class="hd">Check before uploading</div><div class="bd"><ul style="margin:0 0 0 18px;padding:0;line-height:1.7">' + d.warn.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></div></div>' : '') +
        '<ol class="gsteps">' +
        tick('download', '1. Download the ' + name + ' JSON', '<div>File: <code id="gFileName">' + esc(file()) + '</code>' + (GST.downloaded[which + fp] ? ' <span class="pill ok">downloaded</span>' : '') + ' <button class="btn sm outline" id="gDl">Download' + (GST.downloaded[which + fp] ? ' again' : '') + '</button></div><div class="hint">The file is in the layout of the portal\'s own Returns Offline Tool' + (is3b ? '' : ' (version ' + esc(GSTR1_VERSION) + ')') + ', so it uploads straight to the portal; the tool itself is not needed.</div>') +
        tick('login', '2. Log in to the GST portal', '<div><button class="btn sm blue" id="gOpen">Open GST portal login</button> <span class="hint">opens in a new tab (allow pop-ups if nothing opens)</span></div><div class="hint">Type your portal username and password, type the captcha shown there, and Login. Nothing of this passes through BlitzBook.</div>') +
        tick('dash', '3. Open the return', '<div class="hint">Services &gt; Returns &gt; <b>Returns Dashboard</b> &gt; Financial Year <b>' + esc(GST.fyOf(fp)) + '</b>, ' + (d.p.q ? 'Quarter and Period' : 'Period') + ' <b>' + esc(d.p.label) + '</b> &gt; Search &gt; on the <b>' + name + '</b> tile choose <b>Prepare Offline</b>' + (is3b ? ' (or Prepare Online to key the figures in from the review table below)' : '') + '.</div>') +
        tick('upload', '4. Upload the file', '<div class="hint">Under <b>Upload</b> choose the file <code>' + esc(file()) + '</code> from your Downloads and press Upload. The status shows "In progress"; refresh after a minute until it says <b>Processed</b>. If it says "Processed with error", download the error report, fix the entry in BlitzBook, write the file again and upload again (the portal replaces the earlier data).</div>') +
        '<li class="gstep rev"><b>5. Check before filing</b><div class="gbody"><div class="hint" style="margin-bottom:6px">Back on the Returns Dashboard open ' + name + ' &gt; <b>Prepare Online</b> and compare each table\'s summary with the figures below. Tick each line that matches; the filing step opens when every line is ticked.</div><div class="tablewrap">' + reviewTable + '</div></div></li>' +
        '<li class="gstep final' + (allChecked() ? '' : ' locked') + '" id="gFinal"><b>6. Submit and file ' + name + '</b><div class="gbody"><div class="hint lockedhint">' + (allChecked() ? '' : 'Tick every line of step 5 first.') + '</div><div class="finalbody' + (allChecked() ? '' : ' hidden') + '"><div class="hint" style="line-height:1.7">' +
          (is3b ? 'Press <b>Save GSTR-3B</b>, then <b>Preview Draft GSTR-3B</b> (a PDF) and compare it with the review table once more. Pay any tax due under <b>Payment of Tax</b> (Create Challan if the cash ledger is short). Then <b>Proceed to File</b>, tick the declaration, choose the authorised signatory and <b>File GSTR-3B with DSC</b> or <b>with EVC</b> (the OTP goes to the signatory\'s registered mobile and email).'
            : 'Press <b>Generate GSTR-1 Summary</b>, wait a minute and refresh, then <b>Preview</b> (a PDF) and compare it with the review table once more. Tick the declaration, press <b>Submit</b> (this freezes the return), then <b>File GSTR-1</b>, choose the authorised signatory and file <b>with DSC</b> or <b>with EVC</b> (the OTP goes to the signatory\'s registered mobile and email).') +
          ' The portal shows "Filing successful" with an ARN; keep it.</div><div class="hint red" style="margin-top:6px"><b>Filing is final.</b> A filed return cannot be revised; a mistake is corrected in the next period\'s return.</div>' +
          '<div class="btnrow" style="margin:10px 0 0"><button class="btn sm green" id="gFiled">Mark ' + name + ' for ' + esc(d.p.label) + ' as filed</button></div></div></div></li>' +
        '</ol></div>';
      const bg = UI.modal({ title: 'File ' + name + ' for ' + d.p.label, wide: true, focus: false, body, buttons: [{ label: 'Close', cls: 'outline' }] });
      const refreshFinal = () => { const ok = allChecked(); $('#gFinal', bg).classList.toggle('locked', !ok); $('#gFinal .finalbody', bg).classList.toggle('hidden', !ok); $('#gFinal .lockedhint', bg).textContent = ok ? '' : 'Tick every line of step 5 first.'; };
      $('#gDl', bg).onclick = () => { GST.download(which, d, gstin); st.steps.download = true; save(); $('[data-step=download]', bg).checked = true; $('[data-step=download]', bg).closest('.gstep').classList.add('done'); $('#gFileName', bg).textContent = file(); $$('code', bg).forEach(c => { if (c.id !== 'gFileName' && /\.json$/.test(c.textContent)) c.textContent = file(); }); };
      $('#gOpen', bg).onclick = () => { if (GST.openPortal(GST.PORTAL_LOGIN)) { st.steps.login = true; save(); $('[data-step=login]', bg).checked = true; $('[data-step=login]', bg).closest('.gstep').classList.add('done'); } };
      $$('input[data-step]', bg).forEach(c => c.addEventListener('change', () => { st.steps[c.dataset.step] = c.checked; save(); c.closest('.gstep').classList.toggle('done', c.checked); }));
      $$('input[data-rev]', bg).forEach(c => c.addEventListener('change', () => { st.review[c.dataset.rev] = c.checked; save(); refreshFinal(); }));
      $('#gFiled', bg).onclick = () => { st.filed = U.today(); save(); UI.toast(name + ' for ' + d.p.label + ' marked as filed', 3500, 'ok'); bg.remove(); if (App.current && App.current.route === 'gst') App.refresh(); };
      return bg;
    },
    collect, gstr1, gstr3b, periodOf, keyOf, periods, defaultPeriod, UQC, B2CL_LIMIT
  };

  App.routes.gst = function (params) {
    const p = periodOf(params.period) || defaultPeriod(), co = Store.company(), gstin = valid(co.gstin), yearly = Sub.isYearly();
    const picker = UI.select('gstPeriod', periods().map(x => [keyOf(x), x.label]), keyOf(p), { attrs: ' style="min-height:36px;width:auto"' });
    const head = App.header('GST Returns', '<div class="btnrow" style="margin:0">' + picker + '<button class="btn sm green" id="g1">GSTR-1 JSON</button><button class="btn sm blue" id="g3">GSTR-3B JSON</button><button class="btn sm outline" id="gFile">File on GST portal</button></div>');
    const wirePeriod = () => { $('#gstPeriod').onchange = e => App.go('gst', { period: e.target.value }); };
    if (!yearly) {
      const root = App.view(head + '<div class="card white"><div class="bd gstlock"><div class="big">🔒</div><div><h3>Yearly subscription required</h3><p class="muted">GSTR-1 and GSTR-3B JSON files for the GST portal come with the yearly plan and longer. ' + esc(Sub.statusText()) + '.</p><button class="btn blue" id="gBuy">Buy yearly plan</button></div></div></div>');
      App.wireBack(root); wirePeriod();
      $('#gBuy').onclick = () => Subscription.plans(); $('#g1').onclick = $('#g3').onclick = $('#gFile').onclick = () => GST.locked();
      GST.locked();
      return;
    }
    if (co.gstType !== 'Regular' || !gstin) {
      const root = App.view(head + '<div class="card white"><div class="bd"><p>GSTR-1 and GSTR-3B are the returns of a <b>regular</b> GST registration. ' + (co.gstType === 'Composition' ? 'This company is a composition dealer, which files CMP-08 and GSTR-4 instead.' : !gstin ? 'Enter a valid GSTIN under Company Profile first.' : 'This company is not registered under GST.') + '</p></div></div>');
      App.wireBack(root); wirePeriod(); $('#g1').onclick = $('#g3').onclick = $('#gFile').onclick = () => UI.toast('Only a regular GST registration files these returns');
      return;
    }
    const d = collect(p), k = (key, v, cls) => '<div class="' + (cls || '') + '">' + key + '</div><div class="v ' + (cls || '') + '">' + v + '</div>';
    const outTax = r2(d.net.iamt + d.net.camt + d.net.samt), rcmTax = r2(d.inRcm.iamt + d.inRcm.camt + d.inRcm.samt), itcTax = r2(d.itc.iamt + d.itc.camt + d.itc.samt + d.itcRcm.iamt + d.itcRcm.camt + d.itcRcm.samt);
    const payable = r2(outTax + rcmTax - itcTax);
    const filed1 = GST.guideState('1', d.p.fp, gstin).filed, filed3 = GST.guideState('3B', d.p.fp, gstin).filed;
    const root = App.view(head +
      '<div class="hint" style="margin-bottom:12px">Fetched from the books for <b>' + esc(d.p.label) + '</b> (return period ' + esc(d.p.fp) + ', GSTIN ' + esc(gstin) + '): ' + d.invs.length + ' invoice' + (d.invs.length === 1 ? '' : 's') + ', ' + d.cns.length + ' credit note' + (d.cns.length === 1 ? '' : 's') + ', ' + d.purchases.length + ' purchase' + (d.purchases.length === 1 ? '' : 's') + ', ' + d.expenses.length + ' expense' + (d.expenses.length === 1 ? '' : 's') + '. <b>File on GST portal</b> writes the JSON, opens the portal and walks through the upload, the checks and the filing step by step (the portal login stays yours: BlitzBook has no way to log in or file for you).' +
      (filed1 ? ' <span class="pill ok">GSTR-1 filed ' + esc(filed1) + '</span>' : '') + (filed3 ? ' <span class="pill ok">GSTR-3B filed ' + esc(filed3) + '</span>' : '') + '</div>' +
      '<div class="grid2"><div class="card white"><div class="hd">GSTR-1 - Outward supplies</div><div class="bd"><div class="kv">' +
      k('B2B invoices (registered buyers, table 4)', d.count.b2b) + k('B2CL invoices (inter-state above ' + money(B2CL_LIMIT) + ', table 5)', d.count.b2cl) + k('B2CS sales (summed by state and rate, table 7)', d.count.b2cs) + k('Credit notes (tables 9B / 7)', d.count.cn) +
      k('Nil-rated supplies (table 8)', money(d.nilTotal)) + k('HSN lines (table 12)', d.hsn.b2b.length + d.hsn.b2c.length) + k('Taxable value (before credit notes)', money(d.out.txval)) + (d.rcm.txval ? k('Of which under reverse charge (tax paid by buyers)', money(d.rcm.txval)) : '') +
      k('IGST', money(d.out.iamt)) + k('CGST', money(d.out.camt)) + k('SGST', money(d.out.samt)) + '</div></div></div>' +
      '<div class="card white"><div class="hd">GSTR-3B - Summary</div><div class="bd"><div class="kv">' +
      k('3.1(a) Outward taxable supplies, net of credit notes', money(d.net.txval)) + k('      Tax on them', money(outTax)) + k('3.1(c) Nil-rated / exempt', money(d.nilTotal)) + k('3.1(d) Inward supplies under reverse charge', money(d.inRcm.txval)) + k('      Tax payable on them', money(rcmTax)) +
      k('3.2 Inter-state supplies to unregistered persons', d.unreg.length + ' state' + (d.unreg.length === 1 ? '' : 's')) + k('4(A)(3) ITC on reverse charge', money(d.itcRcm.iamt + d.itcRcm.camt + d.itcRcm.samt)) + k('4(A)(5) All other ITC (purchases and expenses, less debit notes)', money(d.itc.iamt + d.itc.camt + d.itc.samt)) +
      k(payable >= 0 ? 'Net tax payable in cash (before credit carried forward)' : 'Input credit exceeds the tax', money(Math.abs(payable)), 'tot') + '</div></div></div></div>' +
      (d.warn.length ? '<div class="card white"><div class="hd">Check before filing</div><div class="bd"><ul style="margin:0 0 0 18px;padding:0;line-height:1.7">' + d.warn.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></div></div>' : '') +
      '<div class="tablewrap">' + (d.rows.length ? '<table class="list cards"><thead><tr><th>Document</th><th>Date</th><th>Party</th><th>GSTIN</th><th>POS</th><th>GSTR-1 table</th><th class="num">Taxable</th><th class="num">Tax</th><th class="num">Value</th></tr></thead><tbody>' +
        d.rows.map(r => '<tr><td data-l="Document"><b>' + U.noLink(r.no) + '</b><div class="small muted">' + r.kind + '</div></td><td data-l="Date">' + esc(r.date) + '</td><td data-l="Party">' + esc(U.titleCase(r.party)) + '</td><td data-l="GSTIN">' + (r.gstin ? esc(r.gstin) : '<span class="muted">unregistered</span>') + '</td><td data-l="POS">' + esc(r.pos) + '</td><td data-l="Table"><span class="pill">' + esc(r.table) + '</span></td><td class="num" data-l="Taxable">' + money(r.txval) + '</td><td class="num" data-l="Tax">' + money(r.tax) + '</td><td class="num" data-l="Value">' + money(r.val) + '</td></tr>').join('') +
        '</tbody></table>' : '<div class="empty">No invoices or credit notes dated in ' + esc(d.p.label) + '.</div>') + '</div>');
    App.wireBack(root); wirePeriod();
    $('#g1').onclick = () => GST.download('1', d, gstin);
    $('#g3').onclick = () => GST.download('3B', d, gstin);
    // File on GST portal: GSTR-1 (the outward supplies, filed first) or GSTR-3B; the file is written if it is not yet, the portal opens
    $('#gFile').onclick = () => UI.menu('File on GST portal', ['GSTR-1 for ' + d.p.label + (filed1 ? '  (filed ' + filed1 + ')' : ''), 'GSTR-3B for ' + d.p.label + (filed3 ? '  (filed ' + filed3 + ')' : '')], (i) => {
      const which = i === 0 ? '1' : '3B';
      if (!GST.downloaded[which + d.p.fp]) GST.download(which, d, gstin);
      GST.openPortal(GST.PORTAL_LOGIN);
      const st = GST.guideState(which, d.p.fp, gstin); st.steps.download = true; GST.saveGuide(which, d.p.fp, gstin, st);
      GST.guide(which, d, gstin);
    });
  };

  global.GST = GST;
})(window);
