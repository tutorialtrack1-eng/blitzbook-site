/* BlitzBook web portal - send mail. An invoice, a receipt, a reminder of what is due, a purchase order or a
   requisition goes out by email from the Email buttons: the dialog shows the address, the subject and the message
   (all editable), then Send asks the server to send it (the Supabase 'mail' edge function or the sync server's
   /api/mail, both through the SMTP account that sends the OTPs), and when no server can send, the mail app opens
   with the message ready (mailto) - which "Open in mail app" does straight away. The messages carry the document as
   text (and as a small HTML table when sent from the server); the PDF itself is printed from the portal. */
(function (global) {
  'use strict';
  const { esc, num, money } = U;
  const line = (s) => String(s == null ? '' : s);
  const pad = (s, n) => { s = line(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); };
  const rpad = (s, n) => { s = line(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };
  const first = (name) => line(name).split('\n')[0].trim();
  const contactEmail = (name) => { const k = first(name).toLowerCase(); const c = Store.list('contacts').find(x => line(x.name).trim().toLowerCase() === k); return c && c.email ? c.email : ''; };
  const signature = (c) => [c.name, line(c.address).replace(/\n/g, ', '), [c.phone ? 'Phone ' + c.phone : '', c.email].filter(Boolean).join(' · '), c.gstin ? 'GSTIN ' + c.gstin : ''].filter(Boolean).join('\n');
  const bank = (c) => c.bankAccountNo ? 'Bank details: A/c ' + c.bankAccountNo + (c.bankIfsc ? ', IFSC ' + c.bankIfsc : '') + (c.bankName ? ', ' + c.bankName : '') + (c.bankHolder ? ' (' + c.bankHolder + ')' : '') : '';
  // A plain-text table: columns [[heading, width, right?]]
  const table = (cols, rows) => [cols.map(c => c[2] ? rpad(c[0], c[1]) : pad(c[0], c[1])).join('  '), cols.map(c => '-'.repeat(c[1])).join('  ')].concat(rows.map(r => cols.map((c, i) => c[2] ? rpad(r[i], c[1]) : pad(r[i], c[1])).join('  '))).join('\n');
  const htmlTable = (heads, rows, right) => '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:12px 0"><tr>' + heads.map((h, i) => '<th style="border:1px solid #cbd5e1;background:#eef2ff;text-align:' + (right.includes(i) ? 'right' : 'left') + '">' + esc(h) + '</th>').join('') + '</tr>' + rows.map(r => '<tr>' + r.map((v, i) => '<td style="border:1px solid #cbd5e1;text-align:' + (right.includes(i) ? 'right' : 'left') + '">' + esc(v) + '</td>').join('') + '</tr>').join('') + '</table>';
  const wrap = (c, paras) => '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:640px">' + paras.join('') + '<p style="color:#6b7280;font-size:13px;white-space:pre-line">' + esc(signature(c)) + '</p></div>';

  const Mail = {
    // Opens the address in the mail app (replaced in tests)
    open(url) { location.href = url; },
    mailto(m) { this.open('mailto:' + encodeURIComponent(line(m.to).trim()) + '?subject=' + encodeURIComponent(line(m.subject)) + '&body=' + encodeURIComponent(line(m.text))); },
    // Asks the server to send; resolves { sent: true } or { sent: false, reason }
    async send(m) {
      try {
        if (!(await Sync.ready())) return { sent: false, reason: 'no server to send from' };
        const body = { to: line(m.to).trim(), subject: line(m.subject), text: line(m.text), html: line(m.html) };
        if (Sync.isSupabase()) {
          return await Sub.withToken(async (token) => {
            const res = await fetch(Sync.serverUrl().replace(/\/+$/, '') + '/functions/v1/mail', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: Sync.supabaseKey(), Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
            const text = await res.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
            if (res.status === 404 || res.status === 503 || (res.status >= 500 && !(j && j.error))) return { sent: false, reason: 'mail sending is not set up on the server yet' };
            if (res.status === 401) { const e = new Error((j && j.error) || 'Signed out'); e.status = 401; throw e; }
            if (j && j.error) return { sent: false, reason: j.error };
            return j && j.sent ? { sent: true } : { sent: false, reason: 'not sent' };
          });
        }
        const r = await Sync.call('mail', Object.assign({ token: Sync.state().token }, body));
        return r && r.sent ? { sent: true } : { sent: false, reason: (r && r.error) || 'not sent' };
      } catch (e) { return { sent: false, reason: e.message || 'could not reach the server' }; }
    },
    // The dialog: address, subject and message to check, then Send (the server, else the mail app) or the mail app
    dialog(m, opts) {
      opts = opts || {};
      const read = (bg) => ({ to: line(UI.val('mlTo', bg)).trim(), subject: line(UI.val('mlSub', bg)).trim(), text: line(UI.val('mlBody', bg)) });
      const ok = (x, bg) => { if (!U.isValidEmail(x.to) || !x.to) { UI.mark('mlTo', true, bg); UI.toast('Enter the email address to send to'); return false; } if (!x.subject) { UI.toast('Enter a subject'); return false; } return true; };
      const bg = UI.modal({ title: opts.title || 'Send mail', wide: true, focus: false,
        body: '<div class="grid2">' + UI.field('To', UI.input('mlTo', m.to || '', { type: 'email', placeholder: 'email address' }), { req: true }) + UI.field('Subject', UI.input('mlSub', m.subject || '')) + '</div>' +
          UI.field('Message', '<textarea id="mlBody" style="min-height:260px;font-family:Consolas,\'Courier New\',monospace;font-size:13px;white-space:pre">' + esc(m.text || '') + '</textarea>') + '<div class="hint" id="mlNote">Send goes through the server when mail is set up there; otherwise your mail app opens with the message ready.</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Open in mail app', cls: 'outline', onClick: (bg) => { const x = read(bg); if (!ok(x, bg)) return false; Mail.mailto(x); UI.toast('Opened in your mail app', 3000, 'ok'); if (opts.onSent) opts.onSent(x, 'app'); } },
          { label: 'Send', cls: 'green', onClick: async (bg) => {
            const x = read(bg); if (!ok(x, bg)) return false;
            $('#mlNote', bg).textContent = 'Sending…';
            const r = await Mail.send(Object.assign({}, x, { html: x.text === (m.text || '') ? (m.html || '') : '' }));
            if (r.sent) { UI.toast('Mail sent to ' + x.to, 4000, 'ok'); if (opts.onSent) opts.onSent(x, 'server'); return true; }
            Mail.mailto(x); UI.toast('Not sent from the server (' + r.reason + '); opened in your mail app instead.', 7000); if (opts.onSent) opts.onSent(x, 'app'); return true;
          } }] });
      if (!m.to) { const t = $('#mlTo', bg); if (t) t.focus(); }
      return bg;
    },

    // ---- the messages
    invoice(inv, c) {
      const t = inv.totals || {}, gst = Biz.chargesGst(), no = line(inv.no), buyer = first(inv.buyer && inv.buyer.name) || 'Customer';
      const rows = (inv.items || []).filter(it => line(it.desc).trim()).map(it => [it.desc, U.fmtQty(it.qty) + ' ' + line(it.uqc || ''), U.indianNumber(it.rate), U.indianNumber(it.taxable)]);
      const totals = [['Taxable value', U.indianNumber(t.taxable)]].concat(gst ? (t.intra ? [['CGST', U.indianNumber(t.cgst)], ['SGST', U.indianNumber(t.sgst)]] : [['IGST', U.indianNumber(t.igst)]]) : []).concat([['Total', money(t.rounded)]]);
      const pay = 'Payment: ' + line(inv.payment || 'Cash') + (inv.dueDate ? ', due by ' + inv.dueDate : '');
      const text = ['Dear ' + buyer + ',', '', 'Please find below the details of invoice ' + no + ' dated ' + inv.date + ' from ' + c.name + '.', '',
        table([['Item', 28], ['Qty', 10, true], ['Rate', 12, true], ['Amount', 12, true]], rows), '', totals.map(x => pad(x[0], 16) + rpad(x[1], 14)).join('\n'), '(' + line(t.words) + ')', '', pay, bank(c), '', 'Thank you for your business.', '', signature(c)].filter(x => x !== null).join('\n');
      const html = wrap(c, ['<p>Dear ' + esc(buyer) + ',</p><p>Please find below the details of invoice <b>' + esc(no) + '</b> dated ' + esc(inv.date) + ' from <b>' + esc(c.name) + '</b>.</p>', htmlTable(['Item', 'Qty', 'Rate', 'Amount'], rows, [1, 2, 3]), '<p>' + totals.map(x => esc(x[0]) + ': <b>' + esc(x[1]) + '</b>').join('<br>') + '<br><i>' + esc(line(t.words)) + '</i></p>', '<p>' + esc(pay) + (bank(c) ? '<br>' + esc(bank(c)) : '') + '</p><p>Thank you for your business.</p>']);
      return { to: line(inv.buyer && inv.buyer.email) || contactEmail(buyer), subject: 'Invoice ' + no + ' from ' + c.name + ' - ' + money(t.rounded), text, html };
    },
    // What a customer still owes: rows {no, date, days, balance}
    reminder(party, rows, c, asAt) {
      const total = rows.reduce((s, r) => s + num(r.balance), 0), lines = rows.map(r => [r.no, r.date, String(r.days), U.indianNumber(r.balance)]);
      const text = ['Dear ' + party + ',', '', 'A gentle reminder that the following invoice' + (rows.length === 1 ? ' is' : 's are') + ' due for payment to ' + c.name + ' as at ' + asAt + ':', '',
        table([['Invoice', 14], ['Date', 12], ['Days', 6, true], ['Balance due', 14, true]], lines), '', pad('Total due', 34) + rpad(money(total), 14), '', 'Kindly arrange the payment at your earliest convenience.', bank(c), '', 'If the payment has already been made, please ignore this reminder.', '', signature(c)].filter(x => x !== '' || true).join('\n');
      const html = wrap(c, ['<p>Dear ' + esc(party) + ',</p><p>A gentle reminder that the following invoice' + (rows.length === 1 ? ' is' : 's are') + ' due for payment to <b>' + esc(c.name) + '</b> as at ' + esc(asAt) + ':</p>', htmlTable(['Invoice', 'Date', 'Days', 'Balance due'], lines, [2, 3]), '<p><b>Total due: ' + esc(money(total)) + '</b></p><p>Kindly arrange the payment at your earliest convenience.' + (bank(c) ? '<br>' + esc(bank(c)) : '') + '</p><p>If the payment has already been made, please ignore this reminder.</p>']);
      return { to: contactEmail(party), subject: 'Payment reminder: ' + money(total) + ' due to ' + c.name, text, html };
    },
    receipt(v, c) {
      const amt = (v.lines || []).filter(l => l.side === 'Dr').reduce((s, l) => s + num(l.amount), 0) || num(v.amount), against = Array.isArray(v.alloc) && v.alloc.length ? v.alloc.map(a => a.no).join(', ') : line(v.ref);
      const text = ['Dear ' + v.party + ',', '', 'We acknowledge with thanks the receipt of ' + money(amt) + ' on ' + v.date + (v.mode ? ' by ' + v.mode : '') + (v.bankRef ? ' (ref ' + v.bankRef + ')' : '') + (against ? ' against invoice ' + against : '') + '.', 'Receipt no: ' + line(v.no), '', 'Thank you for your business.', '', signature(c)].join('\n');
      const html = wrap(c, ['<p>Dear ' + esc(v.party) + ',</p><p>We acknowledge with thanks the receipt of <b>' + esc(money(amt)) + '</b> on ' + esc(v.date) + (v.mode ? ' by ' + esc(v.mode) : '') + (v.bankRef ? ' (ref ' + esc(v.bankRef) + ')' : '') + (against ? ' against invoice ' + esc(against) : '') + '.<br>Receipt no: <b>' + esc(line(v.no)) + '</b></p><p>Thank you for your business.</p>']);
      return { to: contactEmail(v.party), subject: 'Receipt ' + line(v.no) + ' from ' + c.name + ' - ' + money(amt), text, html };
    },
    po(po, c) {
      const rows = (po.items || []).map(it => [it.name, U.fmtQty(it.qty) + ' ' + line(it.uqc || ''), U.indianNumber(it.rate), line(it.gst) + '%', U.indianNumber(it.amount)]);
      const text = ['Dear ' + (po.supplier || 'Supplier') + ',', '', 'Please supply the following against our purchase order ' + po.no + ' dated ' + po.date + (po.expected ? ', to be delivered by ' + po.expected : '') + ':', '',
        table([['Item', 26], ['Qty', 10, true], ['Rate', 10, true], ['GST', 5, true], ['Amount', 12, true]], rows), '', pad('Taxable value', 30) + rpad(U.indianNumber(po.taxable), 14), pad('GST', 30) + rpad(U.indianNumber(po.gst), 14), pad('Order value', 30) + rpad(money(po.total), 14), '',
        po.terms ? 'Terms:\n' + po.terms + '\n' : '', po.notes ? 'Notes: ' + po.notes + '\n' : '', 'Please confirm the order and the delivery date.', '', signature(c)].join('\n');
      const html = wrap(c, ['<p>Dear ' + esc(po.supplier || 'Supplier') + ',</p><p>Please supply the following against our purchase order <b>' + esc(po.no) + '</b> dated ' + esc(po.date) + (po.expected ? ', to be delivered by <b>' + esc(po.expected) + '</b>' : '') + ':</p>', htmlTable(['Item', 'Qty', 'Rate', 'GST', 'Amount'], rows, [1, 2, 3, 4]), '<p>Taxable value: ' + esc(U.indianNumber(po.taxable)) + '<br>GST: ' + esc(U.indianNumber(po.gst)) + '<br><b>Order value: ' + esc(money(po.total)) + '</b></p>' + (po.terms ? '<p><b>Terms</b><br>' + esc(po.terms).replace(/\n/g, '<br>') + '</p>' : '') + (po.notes ? '<p>' + esc(po.notes) + '</p>' : '') + '<p>Please confirm the order and the delivery date.</p>']);
      return { to: contactEmail(po.supplier), subject: 'Purchase Order ' + po.no + ' from ' + c.name, text, html };
    },
    requisition(r, c) {
      const rows = (r.items || []).map(it => [it.name, U.fmtQty(it.qty) + ' ' + line(it.uqc || '')]);
      const text = ['Requisition ' + r.no + ' dated ' + r.date + (r.needBy ? ', needed by ' + r.needBy : '') + (r.requestedBy ? ', requested by ' + r.requestedBy : '') + '.', '', table([['Item', 36], ['Qty', 12, true]], rows), '', r.notes ? 'Notes: ' + r.notes + '\n' : '', 'Please arrange the purchase.', '', signature(c)].join('\n');
      const html = wrap(c, ['<p>Requisition <b>' + esc(r.no) + '</b> dated ' + esc(r.date) + (r.needBy ? ', needed by <b>' + esc(r.needBy) + '</b>' : '') + (r.requestedBy ? ', requested by ' + esc(r.requestedBy) : '') + '.</p>', htmlTable(['Item', 'Qty'], rows, [1]), (r.notes ? '<p>' + esc(r.notes) + '</p>' : '') + '<p>Please arrange the purchase.</p>']);
      return { to: line(c.email), subject: 'Requisition ' + r.no + (r.needBy ? ' - needed by ' + r.needBy : ''), text, html };
    }
  };
  global.Mail = Mail;
})(window);
