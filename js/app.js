/* BlitzBook web portal - shell: routing, dialogs, login / register, dashboard, top navigation, company profile,
   backup, subscription and the sync status. Screens register themselves in App.routes from invoice.js, ledger.js, reports.js. */
(function (global) {
  'use strict';
  const { esc } = U;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // ------------------------------------------------------------ UI helpers
  const UI = {
    // A short note at the bottom that fades out; cls "ok" makes it green (good news such as an activation)
    toast(msg, ms, cls) {
      // A refusal (a role that may not save, Store.set) stays on screen over the "saved" note that follows it
      if (UI.hold && Date.now() < UI.hold) return;
      $$('.toast').forEach(t => t.remove());
      const t = document.createElement('div'); t.className = 'toast' + (cls ? ' ' + cls : ''); t.textContent = msg; document.body.appendChild(t);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 700); }, ms || 2600);
    },
    modal(opt) {
      const bg = document.createElement('div'); bg.className = 'modal-bg';
      const btns = (opt.buttons || []).map((b, i) => '<button class="btn ' + (b.cls || '') + '" data-i="' + i + '">' + esc(b.label) + '</button>').join('');
      bg.innerHTML = '<div class="modal ' + (opt.wide ? 'wide' : '') + '">' + (opt.title ? '<div class="mh">' + esc(opt.title) + '</div>' : '') +
        '<div class="mb">' + (opt.body || '') + '</div>' + (btns ? '<div class="mf">' + btns + '</div>' : '') + '</div>';
      // Records that arrived from another device while a dialog was open are shown once the last one closes
      const close = () => { bg.remove(); if (App.stale && !$('#dialogs').children.length) App.refresh(); };
      $$('.mf .btn', bg).forEach(el => el.addEventListener('click', () => {
        const b = opt.buttons[+el.dataset.i];
        if (b.onClick) { const r = b.onClick(bg, close); if (r === false) return; if (r && r.then) { r.then(k => { if (k !== false) close(); }); return; } }
        close();
      }));
      if (opt.cancelable !== false) bg.addEventListener('click', e => { if (e.target === bg) close(); });
      $('#dialogs').appendChild(bg);
      const first = $('input, select, textarea', bg); if (first && opt.focus !== false) first.focus();
      return bg;
    },
    menu(title, items, onPick, selected) {
      const bg = UI.modal({ title, body: '<div class="menu-list">' + items.map((it, i) => '<button data-i="' + i + '" class="' + (i === selected ? 'sel' : '') + '">' + esc(it) + '</button>').join('') + '</div>', buttons: [{ label: 'Cancel', cls: 'outline' }] });
      $$('.menu-list button', bg).forEach(b => b.addEventListener('click', () => { bg.remove(); onPick(+b.dataset.i, items[+b.dataset.i]); }));
      return bg;
    },
    confirm(title, msg, onYes, yesLabel) {
      return UI.modal({ title, body: '<p>' + esc(msg).replace(/\n/g, '<br>') + '</p>', buttons: [{ label: 'Cancel', cls: 'outline' }, { label: yesLabel || 'Yes', cls: 'red', onClick: onYes }] });
    },
    alert(title, msg, onOk) { return UI.modal({ title, body: '<p>' + esc(msg).replace(/\n/g, '<br>') + '</p>', buttons: [{ label: 'OK', onClick: onOk }] }); },
    prompt(title, label, value, onOk, opts) {
      opts = opts || {};
      return UI.modal({ title, body: '<div class="field"><label>' + esc(label) + '</label>' + (opts.multiline ? '<textarea id="pv">' + esc(value || '') + '</textarea>' : '<input id="pv" type="' + (opts.type || 'text') + '" value="' + esc(value || '') + '" placeholder="' + esc(opts.placeholder || '') + '"' + (opts.list ? ' list="pvDl" autocomplete="off"' : '') + '>') + (opts.list ? UI.datalist('pvDl', opts.list) : '') + '</div>' + (opts.hint ? '<div class="hint">' + esc(opts.hint) + '</div>' : ''),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: opts.okLabel || 'OK', onClick: (bg) => onOk($('#pv', bg).value) }] });
    },
    field(label, inner, opts) { opts = opts || {}; return '<div class="field ' + (opts.span ? 'span' : '') + '"><label>' + esc(label) + (opts.req ? ' <b>*</b>' : '') + '</label>' + inner + (opts.hint ? '<div class="hint">' + esc(opts.hint) + '</div>' : '') + '</div>'; },
    input(id, value, opts) { opts = opts || {}; return '<input id="' + id + '" type="' + (opts.type || 'text') + '" value="' + esc(value == null ? '' : value) + '"' + (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + (opts.list ? ' list="' + opts.list + '" autocomplete="off"' : '') + (opts.attrs || '') + (opts.disabled ? ' disabled' : '') + '>'; },
    select(id, options, value, opts) { opts = opts || {}; return '<select id="' + id + '"' + (opts.attrs || '') + '>' + (opts.blank ? '<option value="">' + esc(opts.blank) + '</option>' : '') + options.map(o => { const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') + '</select>'; },
    datalist(id, values) { return '<datalist id="' + id + '">' + values.map(v => '<option value="' + esc(v) + '">').join('') + '</datalist>'; },
    check(id, label, checked) { return '<label class="check"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '> ' + esc(label) + '</label>'; },
    dateInput(id, ddmmyyyy, opts) { return UI.input(id, U.toIso(ddmmyyyy), Object.assign({ type: 'date' }, opts || {})); },
    val(id, root) { const el = (root || document).getElementById ? (root || document).getElementById(id) : $('#' + id, root); return el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; },
    dateVal(id, root) { return U.fromIso(UI.val(id, root)); },
    mark(id, bad, root) { const el = $('#' + id, root); if (el) el.classList.toggle('err', !!bad); if (bad && el) el.focus(); return !bad; },
    download(name, content, type) {
      // Inside the iOS app the file goes to the share sheet (Save to Files, Mail, WhatsApp ...)
      if (global.Native && Native.ios && typeof content === 'string' && Native.post('download', { name, content, type: type || 'application/octet-stream' })) return;
      const blob = new Blob([content], { type: type || 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
    csv(rows) { return rows.map(r => r.map(c => { const s = String(c == null ? '' : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n'); },
    // The same table as a PDF: laid out on pages by the print module and handed to the print dialog (Save as PDF)
    pdf(title, subtitle, headers, rows, opts) { Print.show(Print.table(title, subtitle, headers, rows, Store.company(), opts)); },
    // Excel-readable .xls (an HTML table), the same file the app writes from its reports
    xls(tag, headers, rows) {
      const cell = (t, c) => '<' + t + '>' + esc(c == null ? '' : c) + '</' + t + '>';
      UI.download('BlitzBook_' + tag + '_' + U.stamp() + '.xls', "<html><head><meta charset='UTF-8'></head><body><table border='1'><tr>" + headers.map(h => cell('th', h)).join('') + '</tr>' +
        rows.map(r => '<tr>' + r.map(c => cell('td', c)).join('') + '</tr>').join('') + '</table></body></html>', 'application/vnd.ms-excel');
      UI.toast('Excel file downloaded');
    },
    parseCsv(text) {
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const rows = []; let row = [], cell = '', q = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
        else if (c === '"') q = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += c;
      }
      if (cell || row.length) { row.push(cell); rows.push(row); }
      return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x !== ''));
    },
    pickFile(accept, onText, asDataUrl) {
      const i = document.createElement('input'); i.type = 'file'; i.accept = accept || '';
      i.onchange = () => { const f = i.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => onText(r.result, f); if (asDataUrl) r.readAsDataURL(f); else r.readAsText(f); };
      i.click();
    },
    /* Every upload offers the same choice for rows that are already in the books: Upsert (new rows are added and
       the ones already here are brought up to date) or Insert only (new rows are added, the ones already here
       are left as they are). The choice is remembered for the next upload. */
    modeField(what, mode) {
      mode = mode || Store.get('upload_mode', 'upsert');
      return '<div class="field"><label>' + esc(what) + ' already in the books</label><div class="modes">' +
        '<label class="check"><input type="radio" name="impMode" value="upsert"' + (mode !== 'insert' ? ' checked' : '') + '> <span><b>Upsert</b> - add the new ' + esc(what) + ' and update the ones already here with the values in the file</span></label>' +
        '<label class="check"><input type="radio" name="impMode" value="insert"' + (mode === 'insert' ? ' checked' : '') + '> <span><b>Insert only</b> - add the new ' + esc(what) + ', leave the ones already here as they are</span></label></div></div>';
    },
    modeOf(bg) { const r = $('input[name=impMode]:checked', bg); const m = r ? r.value : 'upsert'; Store.set('upload_mode', m, true); return m; },
    // What an upload did: how many rows were inserted, updated, left unchanged (already identical) or skipped
    importResult(title, r, onClose) {
      const stat = (k, v, cls) => '<div class="istat ' + (cls || '') + '"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
      const body = '<div class="istats">' + stat('Inserted', r.inserted || 0, 'ok') + stat('Updated', r.updated || 0, 'warn') + (r.unchanged != null ? stat('Unchanged', r.unchanged) : '') + (r.skipped != null ? stat('Skipped', r.skipped, 'bad') : '') + '</div>' +
        (r.note ? '<p class="hint">' + esc(r.note) + '</p>' : '') + (r.lines && r.lines.length ? '<ul class="hint" style="margin:0 0 6px 18px;padding:0">' + r.lines.slice(0, 12).map(l => '<li>' + esc(l) + '</li>').join('') + (r.lines.length > 12 ? '<li>and ' + (r.lines.length - 12) + ' more</li>' : '') + '</ul>' : '');
      return UI.modal({ title, body, buttons: [{ label: 'OK', onClick: onClose }] });
    },
    // A CSV or Excel .xlsx file as rows of cells, like the app's uploads
    pickSheet(onRows) {
      const i = document.createElement('input'); i.type = 'file'; i.accept = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      i.onchange = async () => {
        const f = i.files[0]; if (!f) return;
        try {
          const buf = await f.arrayBuffer(), b = new Uint8Array(buf);
          if (b[0] === 0xD0 && b[1] === 0xCF) { UI.alert('Upload', 'Old Excel (.xls) format is not supported. Save the file as .xlsx or .csv and try again.'); return; }
          onRows(b[0] === 0x50 && b[1] === 0x4B ? await U.xlsxRows(buf) : UI.parseCsv(new TextDecoder().decode(b)));
        } catch (e) { UI.alert('Upload failed', e.message); }
      };
      i.click();
    }
  };

  // ------------------------------------------------------------ app
  // Line icons (24px grid, drawn with the current text colour)
  const ICONS = {
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    receipt: '<path d="M6 2h12a1 1 0 0 1 1 1v19l-3-2-2 2-2-2-2 2-2-2-3 2V3a1 1 0 0 1 1-1z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
    rupee: '<path d="M6 4h12M6 9h12M6 4h3.5a4.5 4.5 0 0 1 0 9H6l8 7"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M17.9 17.9A10.9 10.9 0 0 1 12 19c-7 0-11-7-11-7a18 18 0 0 1 5.1-5.9M9.9 4.2A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-2.2 3.2"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M1 1l22 22"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.9 2.1z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/>',
    truck: '<path d="M2 6h11v10H2zM13 9h4l4 4v3h-8z"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h9.3a1 1 0 0 0 1-.8L20.5 7H6"/>',
    wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><path d="M16.5 14.5h.01"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M9 7h6"/>',
    chart: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V7M18 17v-8"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    pie: '<path d="M21 12a9 9 0 1 1-9-9v9z"/><path d="M15.5 3.6a9 9 0 0 1 4.9 4.9h-4.9z"/>',
    scale: '<path d="M12 3v18M7 21h10M5 7h14"/><path d="m5 7-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
    box: '<path d="m21 8-9-5-9 5v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    star: '<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    shield: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>',
    sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>',
    bank: '<path d="M3 10h18L12 4z"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 21h18M4 18h16"/>',
    payout: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h8"/><path d="M3 9h17a1 1 0 0 1 1 1v3"/><path d="M14 18h7M18 15l3 3-3 3"/>',
    ledger: '<path d="M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 8h8M8 12h8M8 16h5"/><path d="M12 3v18"/>',
    android: '<path d="M5 15a7 7 0 0 1 14 0v4H5z"/><path d="M8 9.5 6.5 7M16 9.5 17.5 7"/><path d="M9.5 13h.01M14.5 13h.01"/><path d="M8 19v2.5M16 19v2.5M3 12v4M21 12v4"/>',
    apple: '<path d="M15.5 6.5c-1.6 0-2.3.9-3.5.9s-2.1-.9-3.5-.9C6.3 6.5 4 8.6 4 12.4c0 3.4 2.6 8.1 4.6 8.1 1.1 0 1.7-.8 3.4-.8s2.1.8 3.4.8c2 0 4.1-4 4.6-5.8-2.2-.8-3-3-3-3.5 0-1.7 1-2.9 2.5-3.6-1-1.2-2.4-1.1-4-1.1z"/><path d="M12.5 6c0-1.9 1.4-3.6 3.3-3.8.2 2-1.5 3.8-3.3 3.8z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16.5 6.5l3 3M13.5 9.5l2 2"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5a5 5 0 0 1 6 4.5"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
  };
  function icon(name) { return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>'; }

  // The dashboard tiles in their standard order. Each account may drag them into its own order, kept as tile_order.
  const TILES = [
    { key: 'invoice', t: 'New Invoice', ic: 'receipt', a: '#4F46E5', b: '#6366F1' },
    { key: 'purchases', t: 'Purchases', ic: 'cart', a: '#B45309', b: '#F59E0B' },
    { key: 'sales', t: 'Sales', ic: 'rupee', a: '#0F766E', b: '#14B8A6' },
    { key: 'items', t: 'Stock', ic: 'box', a: '#15803D', b: '#22C55E' },
    { key: 'expenses', t: 'Expense', ic: 'wallet', a: '#BE123C', b: '#F43F5E' },
    { key: 'receipts', t: 'Receipts', ic: 'bank', a: '#0E7490', b: '#06B6D4' },
    { key: 'payments', t: 'Payments', ic: 'payout', a: '#9D174D', b: '#EC4899' },
    { key: 'journal', t: 'Journal', ic: 'book', a: '#6D28D9', b: '#8B5CF6' },
    { key: 'customers', t: 'Customer', ic: 'user', a: '#7E22CE', b: '#A855F7' },
    { key: 'suppliers', t: 'Supplier', ic: 'truck', a: '#C2410C', b: '#F97316' },
    { key: 'reports', t: 'Reports', ic: 'chart', a: '#0369A1', b: '#0EA5E9' },
    { key: 'hr', t: 'HR & Payroll', ic: 'users', a: '#4D7C0F', b: '#84CC16' },
    // Bringing the books over from Tally, SAP and the rest (migrate.js)
    { key: 'migrate', t: 'Migrate', ic: 'download', a: '#1D4ED8', b: '#60A5FA' }
  ];
  // The tiles in this account's order; tiles added since are appended, tiles that no longer exist are dropped
  function tileList() {
    const all = Sub.isLite() ? LITE_TILES : TILES;
    const byKey = new Map(all.map(t => [t.key, t])), out = (Store.get('tile_order', []) || []).map(k => byKey.get(k)).filter(Boolean);
    all.forEach(t => { if (!out.includes(t)) out.push(t); });
    return out.filter(t => Companies.tileAllowed(t.key));
  }
  /* Tiles can be dragged into a new order. With a mouse a tile is dragged straight away; on a touch screen the
     page has to keep scrolling, so dragging there happens in "Arrange" mode (the link beside the heading), which
     the user leaves with Done. The dragged tile takes the place of the tile it is held over; the order is saved
     when it is dropped. A click right after a drag is swallowed so the tile does not open. */
  function arrangeTiles(grid, onOrder) {
    let drag = null, start = null, moved = false;
    const tiles = () => Array.from(grid.children);
    const begin = (tile, e) => { drag = tile; moved = false; tile.classList.add('dragging'); try { tile.setPointerCapture(e.pointerId); } catch (x) { /* not needed */ } };
    const place = (x, y) => {
      const over = document.elementFromPoint(x, y), t = over && over.closest('.tile');
      if (!t || t === drag || t.parentNode !== grid) return;
      const kids = tiles();
      if (kids.indexOf(drag) < kids.indexOf(t)) t.after(drag); else t.before(drag);
      moved = true;
    };
    grid.addEventListener('pointerdown', e => {
      const tile = e.target.closest('.tile'); if (!tile || e.button) return;
      start = { x: e.clientX, y: e.clientY, tile };
      if (grid.classList.contains('arrange')) { begin(tile, e); e.preventDefault(); }
    });
    grid.addEventListener('pointermove', e => {
      if (!start) return;
      if (!drag) { if (e.pointerType === 'mouse' && Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 8) begin(start.tile, e); return; }
      place(e.clientX, e.clientY); e.preventDefault();
    });
    const end = () => {
      if (drag) {
        const was = drag; drag.classList.remove('dragging'); drag = null;
        if (moved) { onOrder(tiles().map(t => t.dataset.go)); was.dataset.dragged = '1'; setTimeout(() => delete was.dataset.dragged, 50); }
      }
      start = null;
    };
    grid.addEventListener('pointerup', end); grid.addEventListener('pointercancel', end);
    grid.addEventListener('click', e => { const t = e.target.closest('.tile'); if (t && (t.dataset.dragged || grid.classList.contains('arrange'))) { e.stopPropagation(); e.preventDefault(); } }, true);
  }
  /* Top navigation: Dashboard, then groups that drop down on hover (or a tap on a touch screen). Every item is a
     screen; some carry parameters (Credit Notes is the notes screen for CN). The company profile is also reached
     through the company chip on the right of the bar. */
  const NAV = [
    { key: 'dashboard', t: 'Dashboard', ic: 'home' },
    { t: 'Sales', ic: 'rupee', items: [
      { key: 'invoice', t: 'New Invoice' }, { key: 'sales', t: 'Sales' }, { key: 'challans', t: 'Delivery Challans' },
      { key: 'notes', t: 'Credit Notes', params: { kind: 'CN' } }, { key: 'notes', t: 'Debit Notes', params: { kind: 'DN' } },
      { key: 'contacts', t: 'Customers', params: { type: 'Customer' } }, { key: 'salesReport', t: 'Sales Report' }, { key: 'aging', t: 'Outstanding & Ageing' }] },
    { t: 'Purchases', ic: 'cart', items: [
      { key: 'purchases', t: 'Purchases & Quotations' }, { key: 'contacts', t: 'Suppliers', params: { type: 'Supplier' } }, { key: 'expenses', t: 'Expenses' }] },
    { t: 'Stock', ic: 'box', items: [
      { key: 'items', t: 'Stock & Items' }, { key: 'stock', t: 'Stock in Hand' }] },
    { t: 'Records', ic: 'book', items: [
      { key: 'money', t: 'Receipts & Payments' }, { key: 'journal', t: 'Journal' }, { key: 'ledger', t: 'Party Ledger' },
      { key: 'pnl', t: 'Profit & Loss' }, { key: 'balance', t: 'Balance Sheet' }, { key: 'group', t: 'Group Statements' }] },
    { t: 'HR', ic: 'users', items: [
      { key: 'employees', t: 'Employees' }, { key: 'clock', t: 'Web Clock' }, { key: 'attendance', t: 'Attendance' }, { key: 'timesheets', t: 'Timesheets' }, { key: 'reimbursements', t: 'Reimbursements' }, { key: 'payroll', t: 'Payroll' }, { key: 'hrsettings', t: 'HR Settings' }] },
    { t: 'Company', ic: 'building', items: [
      { key: 'company', t: 'Company Profile' }, { key: 'companies', t: 'Companies' }, { key: 'gst', t: 'GST Returns' }, { key: 'backup', t: 'Export / Import' }, { key: 'migrate', t: 'Migrate to BlitzBook' },
      // API keys for the MCP server: an AI assistant working with these books (server/supabase/functions/mcp)
      { key: 'ai', t: 'AI Access' }, { key: 'subscription', t: 'Subscription' }] }
  ];
  // Routes that open a dialog over the current screen: they never become the active link or the screen to redraw
  const DIALOGS = ['company', 'subscription', 'sync'];
  // What an account on an invoice pack gets: invoicing only (Sub.isLite)
  const LITE_KEYS = ['dashboard', 'invoice', 'sales', 'notes', 'contacts', 'salesReport', 'company', 'gst', 'backup', 'ai', 'subscription'];
  const LITE_TILES = [
    { key: 'invoice', t: 'New Invoice', ic: 'receipt', a: '#4F46E5', b: '#6366F1' },
    { key: 'sales', t: 'Sales', ic: 'rupee', a: '#0F766E', b: '#14B8A6' },
    { key: 'cnotes', t: 'Credit Notes', ic: 'ledger', a: '#BE123C', b: '#F43F5E' },
    { key: 'dnotes', t: 'Debit Notes', ic: 'ledger', a: '#B45309', b: '#F59E0B' },
    { key: 'customers', t: 'Customer', ic: 'user', a: '#7E22CE', b: '#A855F7' },
    { key: 'suppliers', t: 'Supplier', ic: 'truck', a: '#C2410C', b: '#F97316' },
    { key: 'reports', t: 'Sales Report', ic: 'chart', a: '#0369A1', b: '#0EA5E9' }
  ];
  // Screens that belong to the account rather than to a company: not offered while another company's books are open
  const ACCOUNT_NAV = ['ai'];
  // The groups and items this account gets right now: the plan (invoice pack = invoicing only), the role in the company
  function navItems() {
    const ok = (n) => (!Sub.isLite() || LITE_KEYS.includes(n.key)) && Companies.mayOpen(n.key) && !(Store.cid && ACCOUNT_NAV.includes(n.key));
    return NAV.map(g => g.items ? Object.assign({}, g, { items: g.items.filter(ok) }) : g).filter(g => g.items ? g.items.length > 0 : ok(g));
  }
  const navKeys = () => navItems().map(g => g.items ? g.t + ':' + g.items.map(i => i.key + (i.params ? JSON.stringify(i.params) : '')).join('|') : g.key).join();
  function navHtml() {
    return navItems().map(n => n.items
      ? '<div class="navgrp"><button class="navlink grp" aria-haspopup="true" aria-expanded="false">' + icon(n.ic) + '<span>' + esc(n.t) + '</span><i class="caret"></i></button><div class="navmenu" role="menu">' +
        n.items.map(it => '<button class="navitem" role="menuitem" data-go="' + it.key + '"' + (it.params ? ' data-params="' + esc(JSON.stringify(it.params)) + '"' : '') + '>' + esc(it.t) + '</button>').join('') + '</div></div>'
      : '<button class="navlink" data-go="' + n.key + '">' + icon(n.ic) + '<span>' + esc(n.t) + '</span></button>').join('');
  }
  // The Android app, served next to the portal as BlitzBook-<version>.apk; app-version.json names the current file,
  // so the download is saved with the version in its name. The iPhone / iPad app: the App Store link once it is
  // published (ios/README.md); until then the portal itself is installed from Safari as a web app.
  const APP_VERSION_URL = 'app-version.json';
  const IOS_APP_URL = '';
  const PORTAL_URL = 'https://blitzbook.co.in';
  // A login lasts 24 hours; after that the portal returns to the login page (the Android app keeps the same rule)
  const SESSION_MS = 24 * 60 * 60 * 1000;
  const BRAND = '<span class="logo">' + icon('bolt') + '</span><span>Blitz<b>Book</b></span>';

  const App = {
    routes: {}, user: null, subTimer: null, current: null, stale: false,
    start() {
      Sync.onApplied = (keys) => this.synced(keys);
      Sync.onAuthLost = (msg) => { this.logout(); UI.alert('Sign in again', msg + '. Log in with the new password.'); };
      Sync.ready(); // find out early whether a sync server is there
      window.addEventListener('hashchange', () => this.onHashChange());
      const s = Store.session();
      if (s && s.uid && this.sessionOver(s)) { Store.setSession(null); Auth.login(); UI.toast('Your 24-hour session is over. Please log in again.', 6000); return; }
      if (s && s.uid) { const u = Store.users().find(x => x.id === s.uid); if (u) { this.login(u); return; } }
      Auth.login();
    },
    sessionOver(s) { return !!(s && s.at) && Date.now() - s.at > SESSION_MS; },
    login(u, token) {
      if (!Terms.accepted(u.id)) {
        if (!$('.auth')) Auth.login();
        Terms.show(u.id, () => this.login(u, token), () => { Store.setSession(null); UI.toast('The terms have to be accepted to use BlitzBook.', 5000); });
        return;
      }
      // The session keeps the time of the login; a reload within the 24 hours keeps the clock, a fresh login restarts it
      const was = Store.session(), at = was && was.uid === u.id && was.at ? was.at : Date.now();
      this.user = u; Store.open(u.id, ''); Store.setSession({ uid: u.id, at });
      clearInterval(this.sessionTimer);
      this.sessionTimer = setInterval(() => { const s = Store.session(); if (s && this.sessionOver(s)) { this.logout(); UI.toast('Your 24-hour session is over. Please log in again.', 6000); } }, 60000);
      if (token) Sync.setToken(token);
      Sub.markRegistered();
      // The company this browser last had open for the account (companies.js); the list itself is refreshed in the background
      const last = Companies.lastCid();
      if (last && Companies.find(last)) Companies.enter(u, last);
      Companies.refresh();
      this.shell();
      // A reload or a bookmark opens the screen in the address; otherwise the dashboard
      const t = this.fromHash();
      this.go(t ? t.route : 'dashboard', t ? t.params : undefined);
      const settle = () => {
        if (this.user !== u) return;
        if (!Store.company().name) Company.edit(true);
        this.checkSubscription();
        // Back from Cashfree's payment page (#subscription?link=...), or payments made elsewhere: collect what was bought
        const m = /^#subscription\?link=([^&]+)/.exec(location.hash || '');
        if (m) Payments.finish(decodeURIComponent(m[1])); else if (Sub.pendingLinks().length) Payments.collect(); else Sub.claimGrants().then(g => { if (g.length) Payments.granted(g); });
      };
      // On a browser that has never met the server the books may be on their way: wait for them before
      // asking for a company profile that already exists
      const fresh = !Sync.state().epoch, first = Sync.start(u);
      if (fresh) first.then(() => { if (this.user === u) { this.refresh(); settle(); } }); else settle();
    },
    logout() { clearTimeout(this.subTimer); clearInterval(this.sessionTimer); Sync.stop(); Store.setSession(null); this.user = null; Store.uid = null; Store.cid = ''; Store.account = null; this.current = null; $('#dialogs').innerHTML = ''; this.lastHash = ''; try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* fine */ } Auth.login(); },
    identity() { return this.user.phone || this.user.email || ''; },
    shell() {
      $('#root').innerHTML =
        '<header class="appbar"><button class="brandmark" id="homeBtn" title="Dashboard">' + BRAND + '</button>' +
        '<nav class="nav" id="nav" aria-label="Main">' + navHtml() + '</nav>' +
        '<div class="bar-right">' + (Native.ios ? '' : '<span class="dlgroup" id="dlApp"><button class="navlink dl" id="dlAndroid" title="Download the BlitzBook Android app (APK)">' + icon('android') + '<span>Android App</span></button>' +
          '<button class="navlink dl" id="dlIos" title="BlitzBook on iPhone / iPad">' + icon('apple') + '<span>iOS App</span></button></span>') +
        '<button class="cochip" id="barCo" title="Switch company / Company Profile"><span class="avatar" id="barAv"></span><span class="nm" id="barSub"></span></button>' +
        '<button class="navlink theme" id="themeBtn" title="Dark / light mode"></button>' +
        '<button class="navlink logout" id="logoutBtn" title="Logout">' + icon('logout') + '<span>Logout</span></button></div></header>' +
        '<main class="main" id="view"></main>';
      $('#homeBtn').onclick = () => this.go('dashboard');
      if ($('#dlAndroid')) { $('#dlAndroid').onclick = () => GetApp.android(); $('#dlIos').onclick = () => GetApp.ios(); }
      $('#themeBtn').onclick = () => Theme.toggle();
      Theme.apply();
      $('#barCo').onclick = () => Companies.switcher();
      $('#logoutBtn').onclick = () => UI.confirm('Logout', 'Do you want to logout?', () => this.logout(), 'Logout');
      $('#nav').dataset.keys = navKeys();
      this.wireNav();
      this.refreshBar();
    },
    // The drop-down groups: open on hover with a mouse, on a tap otherwise; a click elsewhere, Escape, a resize
    // or a scroll closes them. The menu is positioned on the page so the scrolling bar on a phone does not clip it.
    wireNav() {
      const nav = $('#nav');
      $$('[data-go]', nav).forEach(el => el.onclick = (e) => { e.stopPropagation(); this.closeMenus(); this.go(el.dataset.go, el.dataset.params ? JSON.parse(el.dataset.params) : undefined); });
      $$('.navgrp', nav).forEach(g => {
        const btn = $('.grp', g);
        // A click on a group opened by the mouse hovering over it leaves it open; a tap (no hover) toggles it
        btn.onclick = (e) => { e.stopPropagation(); const open = g.classList.contains('open'); if (open && g.hovered) return; this.closeMenus(); if (!open) this.openMenu(g); };
        g.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse') return; g.hovered = true; clearTimeout(this.menuTimer); if (!g.classList.contains('open')) { this.closeMenus(); this.openMenu(g); } });
        g.addEventListener('pointerleave', e => { if (e.pointerType !== 'mouse') return; g.hovered = false; clearTimeout(this.menuTimer); this.menuTimer = setTimeout(() => this.closeMenus(), 180); });
      });
      if (!this.menusWired) {
        this.menusWired = true;
        document.addEventListener('click', () => this.closeMenus());
        document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeMenus(); });
        window.addEventListener('resize', () => this.closeMenus());
        nav.addEventListener('scroll', () => $$('#nav .navgrp.open').forEach(g => this.openMenu(g))); // the bar scrolled: the menu follows its group
      }
    },
    openMenu(g) {
      g.classList.add('open'); $('.grp', g).setAttribute('aria-expanded', 'true');
      const m = $('.navmenu', g), r = g.getBoundingClientRect();
      m.style.top = r.bottom + 'px';
      m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
    },
    closeMenus() { $$('#nav .navgrp.open').forEach(g => { g.classList.remove('open'); $('.grp', g).setAttribute('aria-expanded', 'false'); }); },
    refreshBar() {
      if (!this.user || !$('#barSub')) return;
      const c = Store.company(), name = c.name || Companies.currentName() || '';
      $('#barSub').textContent = (name || 'Set up company') + (Store.cid ? ' · ' + Companies.roleLabel() : '');
      $('#barAv').textContent = ((name || this.user.name || 'B').trim()[0] || 'B').toUpperCase();
    },
    // The top navigation follows the subscription kind (every screen, or invoicing only on an invoice pack)
    refreshNav() {
      const nav = $('#nav'); if (!nav) return;
      const want = navKeys();
      if (nav.dataset.keys === want) return;
      nav.dataset.keys = want;
      nav.innerHTML = navHtml();
      this.wireNav();
      if (this.current) this.markNav(this.current.route, this.current.params);
    },
    // Highlights the current screen in the top navigation (the item and its group) and scrolls the group into
    // view on narrow screens. An item with parameters (Credit Notes) is the one open when those parameters match.
    markNav(route, params) {
      const nav = $('#nav'); if (!nav) return;
      params = params || {};
      const hit = (el) => { if (el.dataset.go !== route) return false; if (!el.dataset.params) return true; const p = JSON.parse(el.dataset.params); return Object.keys(p).every(k => String(params[k]) === String(p[k])); };
      let on = null;
      $$('[data-go]', nav).forEach(el => { const h = hit(el); el.classList.toggle('active', h); if (h) { el.setAttribute('aria-current', 'page'); on = el; } else el.removeAttribute('aria-current'); });
      $$('.navgrp', nav).forEach(g => $('.grp', g).classList.toggle('active', !!$('.navitem.active', g)));
      const top = on && on.closest('.navgrp') ? $('.grp', on.closest('.navgrp')) : on;
      if (top) nav.scrollLeft = top.offsetLeft - (nav.clientWidth - top.offsetWidth) / 2;
    },
    go(route, params) {
      const fn = this.routes[route];
      if (!fn) { UI.toast('Screen not available: ' + route); return; }
      if (!Companies.mayOpen(route)) { UI.hold = 0; UI.toast('Your role in this company (' + Companies.roleLabel() + ') does not open this screen', 4000); if (!this.current) route = 'dashboard'; else return; }
      if (!DIALOGS.includes(route)) { window.scrollTo(0, 0); this.markNav(route, params); this.current = { route, params: params || {} }; this.stale = false; $('#view').classList.remove('still'); this.setHash(route, params || {}); }
      fn(params || {});
      this.refreshBar();
    },
    /* Every screen has its own address: #sales, #invoice?id=..., #contacts?type=Supplier, #salesReport?from=..&to=..
       so the back button, a reload and a bookmark land on the screen itself. Only plain values travel in the
       address; a report period goes as from / to / label and comes back as a range. Dialogs leave the address alone. */
    hashOf(route, params) {
      const q = new URLSearchParams();
      Object.keys(params || {}).forEach(k => {
        const v = params[k];
        if (k === 'print' || v == null || v === '') return;
        if (k === 'range' && v && v.from) { q.set('from', v.from); q.set('to', v.to); if (v.label) q.set('label', v.label); return; }
        if (typeof v === 'object') return;
        q.set(k, String(v));
      });
      const s = q.toString();
      return '#' + route + (s ? '?' + s : '');
    },
    setHash(route, params) {
      const h = this.hashOf(route, params);
      if (location.hash === h) return;
      this.lastHash = h;
      try { location.hash = h; } catch (e) { /* no history available */ }
    },
    // {route, params} behind the current address, null when there is none
    fromHash() {
      const h = String(location.hash || '').replace(/^#/, '');
      if (!h) return null;
      const at = h.indexOf('?'), route = at < 0 ? h : h.slice(0, at), params = {};
      if (!this.routes[route] || DIALOGS.includes(route)) return null;
      new URLSearchParams(at < 0 ? '' : h.slice(at + 1)).forEach((v, k) => { params[k] = v; });
      if (params.from && params.to && global.Reports && Reports.rangeOf) { params.range = Reports.rangeOf(params.from, params.to, params.label); delete params.from; delete params.to; delete params.label; }
      return { route, params };
    },
    // The address changed by itself (back / forward, a typed address): open that screen
    onHashChange() {
      if (!this.user) return;
      if (location.hash === this.lastHash) return;
      this.lastHash = location.hash;
      const t = this.fromHash();
      if (t) this.go(t.route, t.params); else if (!location.hash || location.hash === '#') this.go('dashboard');
    },
    // Draws the current screen again in place, after records arrived from another device
    refresh() {
      this.stale = false;
      if (!this.user || !this.current) return;
      const y = window.scrollY;
      $('#view').classList.add('still');
      this.routes[this.current.route](this.current.params);
      this.refreshBar();
      window.scrollTo(0, y);
    },
    synced(keys) {
      if (!this.user) return;
      if (keys.includes('sub')) this.checkSubscription();
      this.refreshBar();
      // Never redraw under a dialog or over an invoice being typed; those screens pick the data up when next opened
      if ($('#dialogs').children.length) { this.stale = true; return; }
      if (this.current && this.current.route === 'invoice') return;
      this.refresh();
    },
    view(html) { $('#view').innerHTML = html; return $('#view'); },
    header(title, extraHtml) { return '<div class="page-h"><button class="back" data-back>‹ Back to Dashboard</button></div><div class="page-h"><h2>' + esc(title) + '</h2>' + (extraHtml || '') + '</div>'; },
    wireBack(root) { $$('[data-back]', root).forEach(b => b.onclick = () => this.go('dashboard')); },
    checkSubscription() {
      clearTimeout(this.subTimer);
      this.refreshNav();
      if (Sub.isActive()) {
        // A time plan runs out at a known moment; an invoice pack only when its invoices are used, which the saves report
        if (Sub.isTimeActive()) { const left = Sub.expiresAt() - Date.now(); this.subTimer = setTimeout(() => this.checkSubscription(), Math.max(1000, Math.min(left + 500, 6 * 3600 * 1000))); }
        if ($('#subDlg.locked')) { $('#subDlg').remove(); this.go('dashboard'); }
        return;
      }
      Subscription.dialog(true);
    },
    // Invoice-pack accounts only make invoices and notes: saved documents are not changed or deleted
    lite() { return Sub.isLite(); }
  };

  // ------------------------------------------------------------ dark / light mode
  // The choice is kept in this browser (not per account). Until a choice is made the system setting decides;
  // index.html applies the same rule before the first paint so the page never flashes the other colour.
  const Theme = {
    KEY: 'blitzbook.theme',
    chosen() { try { return localStorage.getItem(this.KEY) || ''; } catch (e) { return ''; } },
    current() { return this.chosen() || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); },
    isDark() { return this.current() === 'dark'; },
    apply() {
      document.documentElement.setAttribute('data-theme', this.current());
      const meta = $('meta[name=theme-color]'); if (meta) meta.content = this.isDark() ? '#0B1020' : '#1E1B4B';
      $$('#themeBtn, .theme-fab').forEach(b => { b.innerHTML = icon(this.isDark() ? 'sun' : 'moon') + '<span>' + (this.isDark() ? 'Light mode' : 'Dark mode') + '</span>'; b.title = this.isDark() ? 'Switch to light mode' : 'Switch to dark mode'; });
    },
    toggle() {
      const next = this.isDark() ? 'light' : 'dark';
      try { localStorage.setItem(this.KEY, next); } catch (e) { /* kept for this page only */ }
      this.apply(); UI.toast(next === 'dark' ? 'Dark mode on' : 'Light mode on', 1500);
    }
  };
  if (window.matchMedia) { try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!Theme.chosen()) Theme.apply(); }); } catch (e) { /* older browser */ } }

  // ------------------------------------------------------------ get the app
  // Two buttons in the top bar. Android: the APK served next to the portal. iPhone / iPad: the App Store app when
  // published, otherwise the portal installed from Safari (Add to Home Screen), which runs full screen with the
  // same login and books.
  const GetApp = {
    android() {
      fetch(APP_VERSION_URL, { cache: 'no-store' }).then(r => r.json()).then(v => {
        // The file next to the portal (the last part of the URL in the version file), saved as BlitzBook-<version>.apk
        const file = String(v.apk || '').split('/').pop() || 'BlitzBook.apk', name = 'BlitzBook-' + (v.versionName || '') + '.apk';
        const a = document.createElement('a'); a.href = file; a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
        UI.alert('Android app', name + ' is downloading. Open it on the phone to install (allow installing from this source if Android asks). Log in with the same mobile number or email and the books come down by sync.');
      }).catch(() => UI.toast('Could not reach the app\'s version file. Check the connection and try again.'));
    },
    ios() {
      const here = Native.installed && Native.isApple;
      const body = (IOS_APP_URL ? '<p>BlitzBook for iPhone and iPad is on the App Store.</p><p><a class="btn blue" href="' + esc(IOS_APP_URL) + '" target="_blank" rel="noopener">Open in App Store</a></p><p>Or install the web app:</p>' : '<p>On iPhone and iPad BlitzBook installs from Safari as an app: it opens full screen from the home screen, keeps your login and books, and stays in step with the Android app and this portal by sync.</p>') +
        (here ? '<p class="bold green">BlitzBook is already installed on this device.</p>' :
          '<ol style="margin:6px 0 0 18px;padding:0;line-height:1.7"><li>Open <b>' + esc(PORTAL_URL.replace(/^https?:\/\//, '')) + '</b> in <b>Safari</b> (not Chrome).</li><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>' +
          '<p class="hint">On Android or a computer, Chrome offers "Install app" from its menu for the same result.</p>');
      UI.modal({ title: 'iPhone / iPad', body, buttons: [{ label: 'Close', cls: 'outline' }, { label: 'Copy link', onClick: () => { try { navigator.clipboard.writeText(PORTAL_URL); UI.toast('Link copied'); } catch (e) { UI.toast(PORTAL_URL); } return false; } }] });
    }
  };

  // ------------------------------------------------------------ auth
  // The password never leaves this browser as typed: this hash is what is kept here and what the sync server receives
  function hash(s) { return U.sha256Hex('bb|' + s); }
  function otp() { return String(Math.floor(100000 + Math.random() * 900000)); }

  // Terms & Conditions: read and accepted once after registering, and by any account that has not accepted them
  // yet (also one made in the app). The gist: the books are the user's own, nothing in them belongs to blitzbook.co.in.
  const TERMS_VERSION = '2026-10';
  const TERMS = [
    ['1. What BlitzBook is', 'BlitzBook (blitzbook.co.in, the Android app and the web portal) is a software tool for GST invoicing, accounts, stock, payroll and reports. It is provided by its developer "as is" for you to run your own business records.'],
    ['2. Your data belongs to you', 'Everything you enter or create - company profile, customers, suppliers, items, invoices, challans, purchases, receipts, payments, journal entries, employees, payslips and reports - is your property. blitzbook.co.in claims no ownership of it, and nothing in these books belongs to blitzbook.co.in or its developer.'],
    ['3. Documents are issued by you, not by blitzbook.co.in', 'Every invoice, bill, voucher, note, payslip or report produced here is issued by you, in your business\'s name, under your GSTIN and your signature. blitzbook.co.in is not a party to any sale, purchase, payment or employment recorded here and does not stand behind, guarantee or endorse any of them.'],
    ['4. You are responsible for what you record', 'You alone are responsible for the accuracy of the figures, GST numbers, HSN codes, tax rates, amounts, due dates and returns prepared with BlitzBook, and for filing them with the authorities on time. BlitzBook does not provide tax, legal or accounting advice; check anything you are unsure of with your chartered accountant.'],
    ['5. Keep your own backups', 'Your books live in this browser and, with sync, on the account\'s server space. Use Export / Import regularly. blitzbook.co.in is not liable for any loss of data, lost profit, penalty, interest or other loss arising from the use of, or inability to use, the software.'],
    ['6. Your account', 'Keep your password safe. You are responsible for everything done under your login and for the people you give a role in your company. One person, one account; do not share accounts.'],
    ['7. Subscription', 'The trial and paid plans give access to the software for their term. Fees are not refundable once a plan has started, except where the law says otherwise. Features may be added, changed or withdrawn as the software develops.'],
    ['8. Privacy', 'Your books are not sold or passed to anyone. Account details (name, mobile, email) are used only to run your account, send OTPs and activation codes, and to tell you about BlitzBook itself.'],
    ['9. Acceptable use', 'Do not use BlitzBook to issue false invoices, evade tax, or record transactions that are not real. Such use is entirely your own responsibility and may lead to the account being closed.'],
    ['10. Changes and law', 'These terms may be updated; you will be asked to accept a new version when that happens. They are governed by the laws of India.']
  ];
  const Terms = {
    accepted(uid) { return Store.peek(uid, 'terms', '') === TERMS_VERSION; },
    show(uid, onAccept, onDecline) {
      const bg = UI.modal({ title: 'Terms & Conditions', cancelable: false, focus: false,
        body: '<p class="terms-intro">Please read and accept these terms before you start. In short: the books you keep here are yours; nothing in them belongs to blitzbook.co.in, which only supplies the software.</p>' +
          '<div class="terms-body">' + TERMS.map(t => '<h4>' + esc(t[0]) + '</h4><p>' + esc(t[1]) + '</p>').join('') + '<div class="terms-ver">Version ' + TERMS_VERSION + ' &middot; blitzbook.co.in</div></div>' +
          '<div class="terms-agree">' + UI.check('tAgree', 'I have read and accept the Terms & Conditions', false) + '</div>',
        buttons: [{ label: 'Decline', cls: 'outline', onClick: () => { if (onDecline) onDecline(); } },
                  { label: 'Accept & Continue', onClick: (bg) => { if (!UI.val('tAgree', bg)) return false; Store.poke(uid, 'terms', TERMS_VERSION); if (onAccept) onAccept(); } }] });
      const ok = $$('.mf .btn', bg)[1]; ok.disabled = true;
      $('#tAgree', bg).addEventListener('change', e => { ok.disabled = !e.target.checked; });
      return bg;
    }
  };
  const FEATURES = [['receipt', 'GST invoices with CGST, SGST and IGST worked out for you'], ['box', 'Sales, purchases, expenses, journal and stock in one place'], ['pie', 'Profit & Loss and Balance Sheet whenever you need them'], ['sync', 'The same books in the BlitzBook app and here, kept in step']];
  const Auth = {
    // Login / register page: brand showcase on the left (wide screens), the form box on the right
    frame(inner, tagline) {
      $('#root').innerHTML = '<div class="auth"><section class="auth-art"><span class="orb o1"></span><span class="orb o2"></span><div class="brandline">' + BRAND + '</div>' +
        '<h1>Billing is<br><em>beautifully simple.</em></h1><p>Raise invoices in seconds, keep every purchase and expense in order, and see where your business stands.</p>' +
        '<ul class="feats">' + FEATURES.map(f => '<li><span class="fi">' + icon(f[0]) + '</span>' + esc(f[1]) + '</li>').join('') + '</ul></section>' +
        '<section class="auth-pane"><span class="orb o3"></span><span class="orb o4"></span><div class="auth-brand"><span class="logo big">' + icon('bolt') + '</span><div class="name">Blitz<b>Book</b></div><div class="line">' + esc(tagline || 'GST invoices, accounts, stock & payroll - in a blitz') + '</div></div>' +
        '<div class="box">' + inner + '</div><div class="chips"><span>GST Invoices</span><span>Accounts &amp; Stock</span><span>Payroll</span></div><div class="foot">blitzbook.co.in</div></section>' +
        '<button class="theme-fab" id="themeFab" title="Dark / light mode"></button></div>';
      $('#themeFab').onclick = () => Theme.toggle();
      // The eye beside a password field shows or hides what is typed
      $$('.ifield .eye').forEach(b => b.onclick = () => { const i = $('#' + b.dataset.eye); const shown = i.type === 'text'; i.type = shown ? 'password' : 'text'; b.innerHTML = icon(shown ? 'eye' : 'eyeoff'); b.title = shown ? 'Show password' : 'Hide password'; i.focus(); });
      Theme.apply();
    },
    // A pill input with a leading icon (and an eye for a password)
    ifield(id, ic, placeholder, opts) {
      opts = opts || {};
      return '<div class="ifield' + (opts.type === 'password' ? ' pw' : '') + '"><span class="ii">' + icon(ic) + '</span>' + UI.input(id, '', Object.assign({ placeholder }, opts)) +
        (opts.type === 'password' ? '<button type="button" class="eye" data-eye="' + id + '" title="Show password">' + icon('eye') + '</button>' : '') + '</div>';
    },
    // The account as this browser knows it, created or brought up to date from the server's answer
    keep(su, pwHash, u) {
      const users = Store.users();
      let rec = u ? users.find(x => x.id === u.id) : null;
      if (!rec) { rec = { id: users.reduce((m, x) => Math.max(m, x.id), 0) + 1, createdAt: su.createdAt || Date.now() }; users.push(rec); }
      Object.assign(rec, { name: su.name || rec.name || '', phone: su.phone || rec.phone || '', email: su.email || rec.email || '', password: pwHash });
      Store.saveUsers(users);
      return rec;
    },
    login() {
      Auth.frame('<div class="ghead">Welcome back</div><div class="tag">Sign in to open your books</div>' +
        Auth.ifield('lId', 'user', 'Mobile number or email', { attrs: ' autocomplete="username"' }) + Auth.ifield('lPw', 'lock', 'Password', { type: 'password', attrs: ' autocomplete="current-password"' }) +
        '<div class="links right"><button class="link" id="lReset">Forgot password?</button></div>' +
        '<button class="btn block" id="lGo">Login</button>' +
        '<div class="divider"><span>new here?</span></div><button class="btn block outline" id="lReg">Create a free account</button><div class="note">30 days free &middot; no card needed</div>');
      let busy = false;
      const go = async () => {
        if (busy) return;
        const id = UI.val('lId').trim(), pw = UI.val('lPw');
        if (!id || !pw) { UI.toast('Please fill all fields'); return; }
        busy = true;
        try {
          const h = await hash(pw);
          let u = Store.findUser(id), token = '';
          const local = !!u && u.password === h;
          // With a sync server the account lives there, so an account made in the app can sign in here and a
          // password changed elsewhere stops working here. Without one (or offline) this browser's copy decides.
          if (await Sync.ready()) {
            try { const r = await Sync.call('login', { identity: id, pw: h }); u = Auth.keep(r.user, h, u); token = r.token; }
            catch (e) {
              if (e.status === 401) { UI.toast('Invalid login or password'); return; }
              if (e.status === 429) { UI.toast(e.message); return; }
              if (!local) { UI.toast(e.status || u ? 'Invalid login or password' : 'Cannot reach the server to sign in. Check the connection and try again.'); return; }
            }
          } else if (!local) { UI.toast('Invalid login or password'); return; }
          App.login(u, token);
        } finally { busy = false; }
      };
      $('#lGo').onclick = go; $('#lPw').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      $('#lReg').onclick = () => Auth.register();
      $('#lReset').onclick = () => Auth.reset();
    },
    validPassword(p) { return p.length >= 6 && /[A-Za-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p); },
    // Where an OTP went, for the message shown after sending it
    otpSentText(r, phone) {
      if (r.test) return 'OTP for ' + phone + '\n\n(Test mode) Your 6-digit OTP is: ' + r.otp + '\n\nThe server has no SMS or email sender set up, so the OTP is shown here instead of being sent. See server/README.md.';
      const to = [r.to && r.to.phone ? '+91 ' + r.to.phone : '', r.to && r.to.email ? r.to.email : ''].filter(Boolean).join(' and ');
      return 'A 6-digit OTP was sent to ' + to + '. It is valid for 10 minutes.' + (r.to && r.to.email ? '\n\nNot in the inbox? Check the spam folder.' : '');
    },
    register() {
      Auth.frame('<div class="ghead">Create Account</div><div class="tag">Register and use BlitzBook free for 30 days</div>' +
        Auth.ifield('rName', 'user', 'Full name', { attrs: ' autocomplete="name"' }) + Auth.ifield('rPhone', 'phone', 'Mobile number (10 digits)', { type: 'tel', attrs: ' maxlength="10" inputmode="numeric" autocomplete="tel"' }) +
        Auth.ifield('rEmail', 'mail', 'Email address (optional)', { type: 'email', attrs: ' autocomplete="email"' }) + Auth.ifield('rPw', 'lock', 'Password', { type: 'password', attrs: ' autocomplete="new-password"' }) +
        '<div class="hint">6+ characters with a letter, a number and a special character. The OTP and your activation codes go to the mobile number and the email.</div>' +
        '<div id="otpBox" class="hidden">' + Auth.ifield('rOtp', 'key', 'Enter the 6-digit OTP', { attrs: ' maxlength="6" inputmode="numeric"' }) + '</div>' +
        '<button class="btn block" id="rSend">Send OTP</button><div class="links"><button class="link hidden" id="rResend">Resend OTP</button></div>' +
        '<div class="note">By registering you will be asked to accept the Terms &amp; Conditions: the books you keep are yours; nothing in them belongs to blitzbook.co.in.</div>' +
        '<div class="links"><button class="link" id="rBack">Already registered? Login</button></div>', 'Create your account - 30 days free');
      // viaServer: the OTP was issued by the sync server, which also checks it. Otherwise (no server, or the
      // server could not be reached) the browser makes a test OTP and the account is created here.
      let code = '', otpPhone = '', otpEmail = '', busy = false, viaServer = false;
      const step2 = () => { $('#otpBox').classList.remove('hidden'); $('#rResend').classList.remove('hidden'); $('#rSend').textContent = 'Verify & Register'; $('#rSend').onclick = verify; $('#rOtp').value = ''; $('#rOtp').focus(); };
      const localOtp = (phone) => { viaServer = false; code = otp(); UI.alert('OTP Sent', 'OTP sent to +91 ' + phone + '\n\n(Test mode) Your 6-digit OTP is: ' + code); step2(); };
      const send = async () => {
        if (busy) return;
        const name = UI.val('rName').trim(), phone = UI.val('rPhone').trim(), email = UI.val('rEmail').trim().toLowerCase(), pw = UI.val('rPw');
        if (!name) return UI.toast('Enter your name');
        if (!Auth.validPassword(pw)) return UI.toast('Password needs 6+ characters with a letter, digit and special character');
        if (!/^[6-9][0-9]{9}$/.test(phone)) return UI.toast('Enter a valid 10-digit mobile number');
        if (email && !U.isValidEmail(email)) return UI.toast('Enter a valid email');
        if (Store.findUser(phone) || (email && Store.findUser(email))) return UI.toast('This mobile number or email is already registered');
        busy = true; $('#rSend').disabled = true;
        try {
          otpPhone = phone; otpEmail = email;
          if (!(await Sync.ready())) { localOtp(phone); return; }
          try {
            const r = await Sync.call('otp', { purpose: 'register', phone, email });
            viaServer = true; code = '';
            UI.alert('OTP Sent', Auth.otpSentText(r, '+91 ' + phone));
            step2();
          } catch (e) {
            if (e.status === 409) { UI.toast('This mobile number or email already has an account. Please login.', 5000); return; }
            if (e.status) { UI.toast(e.message, 6000); return; }
            localOtp(phone); // server set but unreachable: the account is created here and joins the server later
          }
        } finally { busy = false; $('#rSend').disabled = false; }
      };
      const verify = async () => {
        if (busy) return;
        const name = UI.val('rName').trim(), phone = UI.val('rPhone').trim(), email = UI.val('rEmail').trim().toLowerCase(), entered = UI.val('rOtp').trim();
        if (phone !== otpPhone || email !== otpEmail) return UI.toast('Mobile number or email changed. Please request a new OTP.');
        if (!/^\d{6}$/.test(entered)) return UI.toast('Enter the 6-digit OTP');
        if (!viaServer && entered !== code) return UI.toast('Invalid OTP');
        busy = true; $('#rSend').disabled = true;
        try {
          const h = await hash(UI.val('rPw'));
          let token = '', createdAt = Date.now();
          if (viaServer || await Sync.ready()) {
            try { const r = await Sync.call('register', Object.assign({ name, phone, email, pw: h }, viaServer ? { otp: entered } : {})); token = r.token; createdAt = r.user.createdAt; }
            catch (e) {
              if (e.status === 409) { UI.toast('This mobile number or email already has an account. Please login.'); Auth.login(); return; }
              if (e.status) { UI.toast(e.message, 5000); return; }
              if (viaServer) { UI.toast('Cannot reach the server to check the OTP. Check the connection and try again.', 5000); return; }
            }
          }
          const users = Store.users();
          const u = { id: (users.reduce((m, x) => Math.max(m, x.id), 0) + 1), name, phone, email, password: h, createdAt };
          users.push(u); Store.saveUsers(users);
          Terms.show(u.id, () => { UI.toast('Welcome, ' + u.name + '! BlitzBook is activated for 30 days.', 6000, 'ok'); App.login(u, token); },
            () => UI.toast('The terms have to be accepted to use BlitzBook. You can accept them when you log in.', 6000));
        } finally { busy = false; const b = $('#rSend'); if (b) b.disabled = false; }
      };
      $('#rSend').onclick = send; $('#rResend').onclick = send; $('#rBack').onclick = () => Auth.login();
    },
    reset() {
      // viaServer: the sync server sent the OTP to the account's mobile / email and checks it, so the password
      // can be reset from any device. Without a server the browser's own copy of the account is reset.
      let code = '', user = null, identity = '', viaServer = false;
      const bg = UI.modal({ title: 'Reset Password', body: UI.field('Registered Mobile / Email', UI.input('xId', '')) + '<div id="xStep2" class="hidden">' + UI.field('OTP', UI.input('xOtp', '', { placeholder: 'Enter 6-digit OTP', attrs: ' maxlength="6" inputmode="numeric"' })) + UI.field('New Password', UI.input('xPw', '', { type: 'password', placeholder: 'min 6 chars, letters, numbers & a special character' })) + UI.field('Confirm New Password', UI.input('xPw2', '', { type: 'password' })) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Send Reset OTP', onClick: async (bg) => {
          const btn = $$('.mf .btn', bg)[1];
          const toStep2 = () => { $('#xId', bg).disabled = true; $('#xStep2', bg).classList.remove('hidden'); btn.textContent = 'Reset Password'; $('#xOtp', bg).focus(); };
          if (!$('#xStep2', bg).classList.contains('hidden')) {
            // Step 2: check the OTP and set the password
            const entered = UI.val('xOtp', bg).trim();
            if (!/^\d{6}$/.test(entered)) { UI.toast('Enter the 6-digit OTP'); return false; }
            if (!viaServer && entered !== code) { UI.toast('Invalid OTP'); return false; }
            const p = UI.val('xPw', bg); if (!Auth.validPassword(p)) { UI.toast('Password needs 6+ characters with a letter, digit and special character'); return false; }
            if (p !== UI.val('xPw2', bg)) { UI.toast('Passwords do not match'); return false; }
            const h = await hash(p);
            btn.disabled = true;
            try {
              if (viaServer) {
                let r;
                try { r = await Sync.call('reset', { identity, otp: entered, pw: h }); }
                catch (e) { UI.toast(e.status ? e.message : 'Cannot reach the server. Connect to the internet to reset the password.', 5000); return false; }
                const u = Auth.keep(r.user, h, user);
                Store.poke(u.id, 'sync', Object.assign(Store.peek(u.id, 'sync', {}), { token: r.token }));
              } else if (await Sync.ready()) {
                // The account on the sync server can only be changed by a device that is signed in to it
                const st = Store.peek(user.id, 'sync', {});
                let done = false;
                try {
                  if (st.token) { try { const r = await Sync.call('password', { token: st.token, pw: h }); st.token = r.token; Store.poke(user.id, 'sync', st); done = true; } catch (e) { if (e.status !== 401) throw e; } }
                  if (!done && (await Sync.call('exists', { identity: user.phone || user.email })).exists) { UI.toast('This browser is signed out of the account. Log in with the current password, or reset it on a device that is signed in.', 6000); return false; }
                } catch (e) { UI.toast('Cannot reach the server. Connect to the internet to reset the password.', 5000); return false; }
                const users = Store.users(); users.find(x => x.id === user.id).password = h; Store.saveUsers(users);
              } else { const users = Store.users(); users.find(x => x.id === user.id).password = h; Store.saveUsers(users); }
            } finally { btn.disabled = false; }
            UI.toast('Password reset successfully! Please log in.'); return true;
          }
          // Step 1: find the account and send the OTP
          identity = UI.val('xId', bg).trim();
          if (!identity) { UI.toast('Enter the registered mobile number or email'); return false; }
          user = Store.findUser(identity);
          btn.disabled = true;
          try {
            if (await Sync.ready()) {
              try {
                const r = await Sync.call('otp', { purpose: 'reset', identity });
                viaServer = true; code = '';
                UI.alert('OTP Sent', Auth.otpSentText(r, identity)); toStep2(); return false;
              } catch (e) {
                if (e.status === 404 && !user) { UI.toast('Account not found with this mobile / email', 5000); return false; }
                if (e.status && e.status !== 404) { UI.toast(e.message, 6000); return false; }
                if (!user) { UI.toast('Cannot reach the server. Connect to the internet to reset the password.', 5000); return false; }
              }
            }
            if (!user) { UI.toast('Account not found with this mobile / email', 5000); return false; }
            viaServer = false; code = otp(); UI.alert('OTP Sent', 'Reset OTP sent to ' + identity + '\n\n(Test mode) Your 6-digit OTP is: ' + code);
            toStep2(); return false;
          } finally { btn.disabled = false; }
        } }] });
      return bg;
    }
  };

  // ------------------------------------------------------------ dashboard
  // Rolls a stat from zero up to its value. The element already holds the final text, so this is decoration only.
  function countUp(el, to, fmt) {
    if (!to || !window.requestAnimationFrame || window.matchMedia('(prefers-reduced-motion: reduce)').matches || $('#view').classList.contains('still')) return;
    const t0 = performance.now(), dur = 700;
    const step = (t) => { const p = Math.min(1, (t - t0) / dur); el.textContent = fmt(p < 1 ? to * (1 - Math.pow(1 - p, 3)) : to); if (p < 1 && el.isConnected) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  App.routes.dashboard = function () {
    const c = Store.company(), invs = Biz.invoices(), co = Companies.current();
    const now = new Date(), h = now.getHours();
    const greet = (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + ' · ' + now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const total = (i) => U.num(i.totals.rounded) || U.num(i.totals.grand);
    const month = invs.filter(i => U.dateMs(i.date) >= monthStart);
    const salesMonth = month.reduce((s, i) => s + total(i), 0);
    // What customers still owe on credit invoices, after the receipts mapped to them
    const open = Biz.outstanding().open, credit = open.reduce((s, r) => s + r.balance, 0);
    // What is still owed to suppliers on credit purchase bills, after the payments against them
    const bills = Books.payables().open, payable = bills.reduce((s, r) => s + r.balance, 0), overdueBills = bills.filter(r => r.days > 30).length;
    const recent = []; invs.forEach(i => i.items.forEach(it => { const d = String(it.desc || '').trim(); if (d && recent.length < 8 && !recent.some(r => r.toLowerCase() === d.toLowerCase())) recent.push(d); }));
    const stat = (id, ic, a, b, k, v, s, go) => '<div class="stat' + (go ? ' tap' : '') + '" style="--a:' + a + ';--b:' + b + '"' + (go ? ' data-go="' + go + '" role="button" tabindex="0" title="Tap for ageing"' : '') + '><div class="ic-badge">' + icon(ic) + '</div><div class="meta"><div class="k">' + k + '</div><div class="v" id="' + id + '">' + v + '</div><div class="s">' + esc(s) + '</div></div></div>';
    const root = App.view(
      '<section class="hero"><span class="orb o1"></span><span class="orb o2"></span>' +
      '<div class="art" aria-hidden="true"><div class="sheet s1"><i></i><i></i><i></i><i></i><u></u></div><div class="sheet s2"><i></i><i></i><i></i><i></i><u></u></div><div class="coin">₹</div></div>' +
      '<div class="greet">' + esc(greet) + '</div><h1 class="co">' + esc(c.name || 'Set up your Company Profile') + '</h1>' +
      '<div class="chips"><span class="chip">' + (c.gstin ? 'GSTIN ' + esc(c.gstin) : 'No GSTIN') + '</span><span class="chip">' + esc(c.activity || 'General') + '</span>' +
      // Which company of the account is open, with the group and the role there; the chip switches companies
      (co && co.group_name ? '<span class="chip">' + esc(co.group_name) + '</span>' : '') + (Store.cid ? '<span class="chip">' + esc(Companies.roleLabel()) + (co && co.owner_name ? ' · ' + esc(co.owner_name) : '') + '</span>' : '') +
      (Companies.list().length > 1 || Store.cid ? '<button class="chip tap" id="coSwitch" title="Switch company">Switch company ▾</button>' : '') + '</div>' +
      '<div class="cta"><button class="btn light" data-go="invoice">' + icon('plus') + 'New Invoice</button><button class="btn ghost" data-go="sales">View Sales' + icon('arrow') + '</button></div></section>' +
      (recent.length ? '<div class="section-title">Recent products</div><div class="recent">' + recent.map(r => '<button data-item="' + esc(r) + '">' + esc(r) + '</button>').join('') + '</div>' : '') +
      '<div class="section-title">What would you like to do?<span class="tilehint"><button class="link small" id="tileArrange">Arrange</button>' + ((Store.get('tile_order', []) || []).length ? ' · <button class="link small" id="tileReset">Reset order</button>' : '') + '</span></div><div class="tiles dash" id="tiles">' +
      tileList().map(t => '<button class="tile" data-go="' + t.key + '" style="--a:' + t.a + ';--b:' + t.b + '"><span class="badge">' + icon(t.ic) + '</span><span class="tx"><span class="t">' + esc(t.t) + '</span></span><span class="go">' + icon('arrow') + '</span></button>').join('') + '</div>' +
      // The month's figures close the page (not for an HR member, who sees nothing of the books)
      (Companies.role() === 'hr' || Companies.role() === 'manager' ? '' : '<div class="section-title">At a glance</div><div class="stats">' + stat('stSales', 'rupee', '#4F46E5', '#818CF8', 'Sales this month', U.money(salesMonth), now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })) +
      stat('stCount', 'receipt', '#059669', '#34D399', 'Invoices', month.length, 'Raised this month') +
      (Sub.isLite() ? stat('stPack', 'star', '#B45309', '#F59E0B', 'Invoices left', Sub.invoicesLeft() + ' of ' + Sub.invoiceQuota(), (Sub.packUntil() ? 'Use by ' + U.pad(new Date(Sub.packUntil()).getDate()) + '/' + U.pad(new Date(Sub.packUntil()).getMonth() + 1) + '/' + new Date(Sub.packUntil()).getFullYear() : 'In your invoice pack') + ' · credit and debit notes count · tap to buy more', 'subscription')
        : stat('stCredit', 'wallet', '#EA580C', '#FBBF24', 'Credit outstanding', U.money(credit), open.length ? 'Due on ' + open.length + ' invoice' + (open.length === 1 ? '' : 's') + ' · tap for ageing' : 'Nothing due on credit invoices', 'aging')) +
      (Sub.isLite() || Companies.role() === 'sales' ? '' : stat('stPayable', 'cart', '#BE123C', '#F43F5E', 'Payable to suppliers', U.money(payable), bills.length ? 'Owed on ' + bills.length + ' bill' + (bills.length === 1 ? '' : 's') + (overdueBills ? ', ' + overdueBills + ' overdue' : '') + ' · tap for ageing' : 'Nothing owed on credit purchases', 'payables')) + '</div>'));
    countUp($('#stSales'), salesMonth, U.money); countUp($('#stCount'), month.length, v => String(Math.round(v))); countUp($('#stCredit'), credit, U.money); if ($('#stPayable')) countUp($('#stPayable'), payable, U.money);
    if ($('#coSwitch')) $('#coSwitch').onclick = () => Companies.switcher();
    $$('[data-go]', root).forEach(el => el.onclick = () => {
      const k = el.dataset.go;
      if (k === 'reports') {
        // Only the reports the role may open (a sales member gets the sales side)
        const all = [['Sales Report', 'salesReport'], ['Outstanding & Ageing', 'aging'], ['Supplier Outstanding', 'payables'], ['Party Ledger', 'ledger'], ['Profit & Loss', 'pnl'], ['Balance Sheet', 'balance'], ['Stock in Hand', 'stock'], ['Group Statements', 'group']].filter(r => Companies.mayOpen(r[1]));
        if (Sub.isLite()) App.go('salesReport'); else UI.menu('Reports', all.map(r => r[0]), (i) => App.go(all[i][1]));
      }
      else if (k === 'cnotes') App.go('notes', { kind: 'CN' });
      else if (k === 'dnotes') App.go('notes', { kind: 'DN' });
      else if (k === 'customers') App.go('contacts', { type: 'Customer' });
      else if (k === 'suppliers') App.go('contacts', { type: 'Supplier' });
      else if (k === 'receipts') App.go('money', { kind: 'receipt' });
      else if (k === 'payments') App.go('money', { kind: 'payment' });
      else if (k === 'hr' && !HR.allowed()) HR.lock();
      else if (k === 'hr') UI.menu('HR & Payroll', ['Employees', 'Web Clock', 'Attendance', 'Timesheets', 'Reimbursements', 'Payroll', 'HR Settings'], (i) => App.go(['employees', 'clock', 'attendance', 'timesheets', 'reimbursements', 'payroll', 'hrsettings'][i]));
      else App.go(k);
    });
    // Dragging the tiles into another order; the order belongs to this account on this device
    arrangeTiles($('#tiles', root), (keys) => { Store.set('tile_order', keys, true); if (!$('#tileReset')) UI.toast('Tile order saved'); });
    $('#tileArrange').onclick = () => { const g = $('#tiles', root), on = g.classList.toggle('arrange'); $('#tileArrange').textContent = on ? 'Done' : 'Arrange'; if (on) UI.toast('Drag the tiles into the order you want, then tap Done', 3500); };
    if ($('#tileReset')) $('#tileReset').onclick = () => { Store.set('tile_order', [], true); App.go('dashboard'); UI.toast('Standard order restored'); };
    $$('[data-item]', root).forEach(el => el.onclick = () => App.go('invoice', { quickItem: el.dataset.item }));
  };

  // ------------------------------------------------------------ company profile
  const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  const Company = {
    edit(firstTime) {
      const c = Store.company();
      const body = '<div class="grid2">' +
        UI.field('Company Name', UI.input('cName', c.name), { req: true, span: true }) +
        UI.field('GSTIN', UI.input('cGstin', c.gstin, { placeholder: '15 characters, e.g. 37ABCDE1234F1ZZ', attrs: ' maxlength="15" style="text-transform:uppercase"' }), { req: true }) +
        UI.field('GST Registration Type', UI.select('cType', U.GST_REG_TYPES, c.gstType), { req: true }) +
        UI.field('Line of Activity (Optional)', UI.select('cAct', U.LINE_OF_ACTIVITIES, c.activity, { blank: 'Select Line of Activity' })) +
        UI.field('Invoice Number Format', UI.input('cFmt', c.invoiceFormat, { placeholder: '####' }), { hint: '# = digits, {FY} = financial year, e.g. INV/{FY}/####' }) +
        UI.field('Address', '<textarea id="cAddr">' + esc(c.address) + '</textarea>', { req: true, span: true }) +
        // A profile without a phone or email starts with the ones the account was registered with
        UI.field('Phone (10 digits)', UI.input('cPhone', c.phone || (App.user && App.user.phone) || '', { type: 'tel', attrs: ' maxlength="10"' }), { req: true }) + UI.field('Email', UI.input('cEmail', c.email || (App.user && App.user.email) || '', { type: 'email' }), { req: true }) +
        '<div class="field span"><label>Bank Account Details</label></div>' +
        UI.field('Account Number', UI.input('cAcc', c.bankAccountNo, { attrs: ' inputmode="numeric"' })) + UI.field('Account Holder Name', UI.input('cHolder', (c.bankHolder || c.name).toUpperCase(), { attrs: ' style="text-transform:uppercase"' })) +
        '<div class="field">' + '<label>IFSC Code</label>' + UI.input('cIfsc', (c.bankIfsc || '').toUpperCase(), { placeholder: 'e.g. UTIB0001234', attrs: ' maxlength="11" style="text-transform:uppercase"' }) + '<div class="hint" id="cIfscMsg">Bank and branch fill in automatically from the IFSC</div></div>' +
        UI.field('Bank Name', UI.input('cBank', c.bankName, { placeholder: 'Filled automatically from IFSC' })) + UI.field('Branch Name', UI.input('cBranch', c.bankBranch, { placeholder: 'Filled automatically from IFSC' })) +
        '<div class="field span"><label>Authorised Signature</label><div class="hint" id="cSigMsg"></div><div class="btnrow" style="margin:4px 0"><img id="cSigImg" src="' + (c.signature || '') + '" alt="" style="max-height:48px;max-width:160px;' + (c.signature ? '' : 'display:none') + '"><button class="btn sm outline" id="cSigAdd">Attach Signature</button><button class="btn sm red" id="cSigDel" ' + (c.signature ? '' : 'disabled') + '>Remove</button></div></div>' +
        '<div class="field span"><label>Invoice Terms &amp; Payment</label></div>' +
        UI.field('Terms & Conditions', '<textarea id="cTerms" placeholder="e.g. Goods once sold will not be taken back.&#10;Interest @ 18% p.a. is charged on overdue bills.&#10;Subject to local jurisdiction.">' + esc(c.terms) + '</textarea>', { span: true, hint: 'One term per line. Each invoice has a tick "Include terms & conditions" that prints these at the foot of the PDF.' }) +
        UI.field('Credit Period (days)', UI.input('cCredit', c.creditDays, { type: 'number', attrs: ' min="0" max="365" step="1"' }), { hint: 'A Credit invoice gets a payment due date this many days after its date; the due date prints on the PDF' }) +
        '<div class="field">' + UI.check('cTermsOn', 'Include terms & conditions on new invoices', c.termsOn !== false) + '</div>' +
        '<div class="field span subleft"><label>Activation</label><div class="' + (Sub.isActive() ? 'green' : 'red') + ' bold" id="cSubLeft">' + esc(Sub.statusText()) + (Sub.isActive() ? '   ·   ' + Sub.daysLeft() + ' day' + (Sub.daysLeft() === 1 ? '' : 's') + ' remaining' : '') + '</div><div class="hint">Activation codes are entered under Subscription in the top bar.</div></div>' +
        '</div>';
      let signature = c.signature;
      const bg = UI.modal({ title: 'Company Master Profile', body, wide: true, cancelable: !firstTime, buttons: [{ label: firstTime ? 'Later' : 'Cancel', cls: 'outline' }, { label: 'Save Profile', cls: 'green', onClick: (bg) => {
        const v = (id) => UI.val(id, bg).trim();
        const o = Object.assign({}, c, { name: v('cName'), gstin: v('cGstin').toUpperCase(), gstType: v('cType'), activity: v('cAct') || 'General', invoiceFormat: v('cFmt').includes('#') ? v('cFmt') : U.DEFAULT_INVOICE_FORMAT, address: v('cAddr').toUpperCase(), phone: v('cPhone'), email: v('cEmail').toLowerCase(),
          bankAccountNo: v('cAcc'), bankHolder: v('cHolder').toUpperCase(), bankIfsc: v('cIfsc').toUpperCase(), bankName: v('cBank'), bankBranch: v('cBranch'), signature,
          terms: UI.val('cTerms', bg).replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean).join('\n'), creditDays: Math.max(0, Math.min(365, Math.round(U.num(v('cCredit'))))), termsOn: UI.val('cTermsOn', bg) });
        if (!UI.mark('cName', !o.name, bg)) { UI.toast('Company Name is required'); return false; }
        if (!UI.mark('cAddr', !o.address, bg)) { UI.toast('Address is required'); return false; }
        if (!UI.mark('cPhone', !/^[6-9][0-9]{9}$/.test(o.phone), bg)) { UI.toast('Enter correct phone number'); return false; }
        if (!UI.mark('cEmail', !o.email || !U.isValidEmail(o.email), bg)) { UI.toast('Invalid email address'); return false; }
        if (!UI.mark('cGstin', !U.isValidGstin(o.gstin), bg)) { UI.toast('Enter a valid company GSTIN (15 characters, e.g. 37ABCDE1234F1ZZ)'); return false; }
        if (o.gstin && o.gstType === 'Unregistered') { UI.toast('GSTIN given: select Regular or Composition'); return false; }
        if (!o.gstin && o.gstType !== 'Unregistered') { UI.mark('cGstin', true, bg); UI.toast('GSTIN is required for ' + o.gstType + ' dealer'); return false; }
        if (o.bankIfsc && !IFSC.test(o.bankIfsc)) { UI.mark('cIfsc', true, bg); UI.toast('Invalid IFSC Code format (e.g. UTIB0001234)'); return false; }
        Store.saveCompany(o); App.refreshBar(); UI.toast('Company Profile Saved Successfully!'); App.go('dashboard');
      } }] });
      $('#cGstin', bg).addEventListener('input', e => { const g = e.target.value.trim(); e.target.classList.toggle('err', g.length >= 15 && !U.isValidGstin(g)); if (g && $('#cType', bg).value === 'Unregistered') $('#cType', bg).value = 'Regular'; if (!g) $('#cType', bg).value = 'Unregistered'; });
      // Bank name comes from the IFSC prefix straight away; bank and branch are then confirmed online
      const msg = (text, cls) => { const m = $('#cIfscMsg', bg); m.textContent = text; m.className = 'hint ' + (cls || ''); };
      $('#cIfsc', bg).addEventListener('input', async e => {
        const code = e.target.value.trim().toUpperCase();
        e.target.classList.remove('err');
        if (code.length < 11) { msg('Bank and branch fill in automatically from the IFSC'); return; }
        if (!IFSC.test(code)) { e.target.classList.add('err'); msg('Invalid IFSC code format (e.g. UTIB0001234)', 'red'); return; }
        if (code === (c.bankIfsc || '').toUpperCase() && c.bankBranch) return;
        if (U.BANK_IFSC[code.slice(0, 4)]) $('#cBank', bg).value = U.BANK_IFSC[code.slice(0, 4)];
        msg('Looking up bank & branch…');
        let found = null, reached = true;
        try { const r = await fetch('https://ifsc.razorpay.com/' + code); if (r.ok) found = await r.json(); else if (r.status !== 404) reached = false; } catch (err) { reached = false; }
        if (!bg.isConnected || $('#cIfsc', bg).value.trim().toUpperCase() !== code) return; // a late reply after the code was changed
        if (!found) { msg(reached ? 'IFSC not found. Please check the code.' : 'Could not reach IFSC lookup. Enter bank & branch manually.', 'red'); return; }
        if (found.BANK) $('#cBank', bg).value = found.BANK.trim();
        $('#cBranch', bg).value = U.nameCase(found.BRANCH || '');
        msg('✓ Bank & branch filled from IFSC', 'green');
      });
      const sigMsg = () => { $('#cSigMsg', bg).textContent = signature ? 'Signature will print above "Authorised Signatory"' : 'No signature attached'; };
      sigMsg();
      $('#cSigAdd', bg).onclick = () => UI.pickFile('image/*', (dataUrl) => {
        const img = new Image();
        img.onload = () => { const cv = document.createElement('canvas'); const w = Math.min(600, img.width), h = Math.round(img.height * w / img.width); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h); signature = cv.toDataURL('image/png'); $('#cSigImg', bg).src = signature; $('#cSigImg', bg).style.display = ''; $('#cSigDel', bg).disabled = false; sigMsg(); UI.toast('Signature attached'); };
        img.onerror = () => UI.toast('Could not read that image');
        img.src = dataUrl;
      }, true);
      $('#cSigDel', bg).onclick = () => { signature = ''; $('#cSigImg', bg).style.display = 'none'; $('#cSigDel', bg).disabled = true; sigMsg(); UI.toast('Signature removed'); };
    }
  };
  App.routes.company = () => Company.edit(false);

  // ------------------------------------------------------------ backup
  App.routes.backup = function () {
    const root = App.view(App.header('Export / Import Data') +
      '<div class="card white"><div class="hd">Backup</div><div class="bd"><p>Export saves your company profile, items, contacts, invoices, purchases, expenses, journal and notes as one backup file. Import restores a backup file and replaces the data currently here.</p>' +
      '<p>The file is the same one the BlitzBook app writes and reads: a backup taken here restores in the app (Export / Import &rsaquo; Import Backup), and a backup taken in the app restores here.</p>' +
      '<div class="btnrow"><button class="btn green" id="bExp">Export Backup</button><button class="btn red" id="bImp">Import Backup</button></div>' +
      '<div class="hint">' + (Sync.status === 'idle' || Sync.status === 'syncing' ? 'These books are also kept in your account and in the app. A backup file is still worth keeping.' : 'Data is stored in this browser only. Export regularly and keep the file safe, or import it on another device to move your books.') + '</div></div></div>');
    App.wireBack(root);
    $('#bExp').onclick = () => { UI.download('BlitzBook_Backup_' + U.stamp() + '.json', JSON.stringify(Store.exportAll()), 'application/json'); UI.toast('Backup downloaded. Keep this file safe.'); };
    $('#bImp').onclick = () => UI.confirm('Import Backup', 'Importing replaces all invoices, items, contacts and the company profile here with the data from the backup file' + (Sync.status === 'idle' ? ', and in the app once it syncs' : '') + '. This cannot be undone.\n\nTip: take an Export first if you want to keep the current data.', () => {
      UI.pickFile('.json,application/json,text/plain', (text) => {
        let obj; try { obj = JSON.parse(text); } catch (e) { UI.alert('Import failed', 'That is not a BlitzBook backup file'); return; }
        try {
          const n = Store.importAll(obj);
          App.go('dashboard');
          UI.alert('Data Imported', 'Restored ' + n.invoices + ' invoices, ' + n.items + ' items and ' + n.contacts + ' contacts' + (n.company ? ' along with the company profile.' : '.'));
        } catch (e) { UI.alert('Import failed', e.message); }
      });
    }, 'Choose Backup File');
  };

  // ------------------------------------------------------------ subscription
  const Subscription = {
    dialog(locked) {
      if ($('#subDlg')) { if (!locked || $('#subDlg.locked')) return; $('#subDlg').remove(); }
      // Another company's books run on the owner's subscription: nothing to buy or activate from here
      if (Store.cid) {
        const co = Companies.current(), own = co && co.role === 'owner';
        const bg = UI.modal({ title: locked ? 'Subscription Required' : 'Subscription', cancelable: !locked,
          body: '<p style="white-space:pre-line">' + esc(Sub.statusText() + '.\n\n' + (own ? 'This company runs on your own subscription: renew it from your first company (switch company, then Subscription).' : 'This company runs on the subscription of its owner' + (co && co.owner_name ? ', ' + co.owner_name : '') + '. Ask them to renew it.')) + '</p>',
          buttons: [{ label: locked ? 'Logout' : 'Close', cls: 'outline', onClick: () => { if (locked) App.logout(); } }, { label: 'Switch company', cls: 'blue', onClick: () => { Companies.switcher(); return false; } }] });
        bg.id = 'subDlg'; if (locked) bg.classList.add('locked');
        return;
      }
      const pending = Sub.pendingRequest();
      const msg = (locked ? (Sub.isOnTrial() && !Sub.invoiceQuota() ? 'Your free ' + Sub.TRIAL_LABEL + ' activation has ended.' : Sub.statusText() + '.') + '\n\nA subscription is needed to continue.' : Sub.statusText() + '.') +
        (Sub.isLite() ? '\n\nOn an invoice pack only invoicing is offered: invoices, credit and debit notes, customers and suppliers, the sales report. Every saved invoice or note uses one invoice of the pack and cannot be changed or deleted afterwards. A monthly or longer plan opens every feature.' : '') +
        '\n\nTap "Buy / Renew" to choose a plan or an invoice pack and pay by UPI. The activation code is then sent to your mobile' + (App.user.email ? ' and email' : '') + '. Enter it below.' + (pending ? '\n\n' + pending : '');
      const bg = UI.modal({ title: locked ? 'Subscription Required' : 'Subscription', cancelable: !locked,
        body: '<p style="white-space:pre-line">' + esc(msg) + '</p>' + UI.field('Activation Code', UI.input('sCode', '', { placeholder: 'XXXX-XXXX-XXXX-XXXX', attrs: ' maxlength="19" style="text-transform:uppercase;letter-spacing:1px"' })),
        buttons: [{ label: locked ? 'Logout' : 'Close', cls: 'outline', onClick: () => { if (locked) App.logout(); } }, { label: 'Buy / Renew', cls: 'blue', onClick: () => { Subscription.plans(); return false; } },
          { label: 'Activate', cls: 'green', onClick: async (bg) => {
            const r = await Sub.activate(App.identity(), UI.val('sCode', bg));
            if (r === -2) { UI.toast('This code has already been used'); return false; }
            if (r === -3) { UI.toast('The code could not be checked: the portal is not signed in to the server right now. Check the connection and try again.', 7000); return false; }
            if (typeof r !== 'object') { UI.toast('Invalid activation code'); return false; }
            Subscription.activated(); return true;
          } }] });
      bg.id = 'subDlg'; if (locked) bg.classList.add('locked');
    },
    activated() { Sub.clearPendingRequest(); UI.toast('Activated: ' + Sub.statusText(), 4000); App.checkSubscription(); App.go('dashboard'); },
    plans() {
      UI.menu('Choose a Plan', Sub.PLANS.map((p, i) => Sub.planLabel(i)), (i) => Subscription.pay(Sub.PLANS[i]));
    },
    // Pay through Cashfree when the payment function is there (card, UPI, net banking on Cashfree's page); the UPI deep
    // link with the vendor's manual code remains the fallback
    async pay(plan) {
      if (Sub.paymentsAvailable()) {
        const wait = UI.modal({ title: 'Pay Rs ' + plan.price, body: '<p>Opening the secure payment page for <b>' + esc(plan.name) + '</b>…</p><p class="hint">You pay on Cashfree (UPI, card or net banking) and come straight back here; BlitzBook activates by itself.</p>', buttons: [], cancelable: false });
        try {
          const r = await Sub.createPaymentLink(Sub.PLANS.indexOf(plan));
          location.href = r.link_url;
          return;
        } catch (e) {
          wait.remove();
          if (e.status !== 404) { UI.toast(e.message || 'Could not start the payment', 6000); return; }
          UI.toast('Online payment is not set up yet; paying by UPI instead', 4000);
        }
      }
      Subscription.payByUpi(plan);
    },
    payByUpi(plan) {
      const amount = plan.price, phone = App.identity(), email = App.user.email || '', uri = Sub.upiUri(phone, plan, amount);
      const what = Sub.planWhat(plan), tag = plan.invoices ? plan.invoices + 'inv' : plan.days + 'd';
      UI.modal({ title: 'Pay Rs ' + amount + ' by UPI', body: '<p>Plan: <b>' + esc(plan.name) + '</b> (' + what + ') for <b>Rs ' + amount + '</b>.</p>' + (plan.invoices ? '<p class="hint">An invoice pack offers the invoicing features only; every saved invoice, credit note or debit note uses one invoice, and invoices not used within ' + esc(Sub.packValidity(plan.packDays)) + ' lapse.</p>' : '') + '<p>Pay to <b>' + esc(Sub.VENDOR_UPI_ID) + '</b> (' + esc(Sub.VENDOR_NAME) + ') with the note <b>' + esc(Sub.VENDOR_NAME + ' ' + tag + ' ' + phone) + '</b>. On a phone the button below opens your UPI app (Google Pay, PhonePe, Paytm or your bank\'s app).</p>' +
        '<p><a class="btn blue" href="' + esc(uri) + '">Open UPI app</a></p>' + UI.field('Transaction Reference', UI.input('sRef', '', { placeholder: 'UPI transaction ID / UTR' })),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'I have paid', cls: 'green', onClick: async (bg) => {
          const ref = UI.val('sRef', bg).trim();
          const summary = plan.name + ' (' + what + '), Rs ' + amount + ', UPI ref ' + (ref || '-') + ', paid on ' + U.today();
          Sub.savePendingRequest('Payment recorded: ' + summary + '. Waiting for the activation code on ' + phone + (email ? ' / ' + email : '') + '.');
          UI.toast('Sending activation request...');
          const code = await Sub.requestActivation(phone, email, plan, amount, ref, 'REPORTED');
          if (code && typeof (await Sub.activate(phone, code)) === 'object') {
            if ($('#subDlg')) $('#subDlg').remove();
            Subscription.activated();
            UI.alert('Subscription Activated', Sub.statusText() + '.\n\nThe activation code has also been sent to ' + phone + (email ? ' and ' + email : '') + '.');
            return true;
          }
          if (code != null) { UI.alert('Payment Received', 'Thank you. Your activation code is being sent to ' + phone + (email ? ' and ' + email : '') + '. Enter it under Subscription > Activate.'); return true; }
          // Manual flow: hand the request to the vendor
          const text = encodeURIComponent('BlitzBook activation request\nMobile: ' + phone + (email ? '\nEmail: ' + email : '') + '\n' + summary + '\nPlease send my activation code.');
          UI.modal({ title: 'Payment Recorded', body: '<p>Send this request so your activation code can be issued. It will be sent to ' + esc(phone) + (email ? ' and ' + esc(email) : '') + '.</p><p>' + esc(summary) + '</p>' +
            '<div class="btnrow"><a class="btn green" target="_blank" rel="noopener" href="https://wa.me/91' + Sub.VENDOR_PHONE + '?text=' + text + '">Send on WhatsApp</a><a class="btn blue" href="sms:' + Sub.VENDOR_PHONE + '?body=' + text + '">Send by SMS</a></div>', buttons: [{ label: 'Later', cls: 'outline' }] });
          return true;
        } }] });
    }
  };
  App.routes.subscription = () => Subscription.dialog(false);

  // ------------------------------------------------------------ payments coming back from Cashfree
  const Payments = {
    // The customer is back from the payment page: ask whether the link is paid, collect the grant, say so
    async finish(linkId) {
      try { history.replaceState(null, '', location.pathname + location.search + '#dashboard'); } catch (e) { /* fine */ }
      const bg = UI.modal({ title: 'Checking payment', body: '<p>Confirming your payment with Cashfree…</p>', buttons: [], cancelable: false });
      let r = null;
      try { r = await Sub.checkPayment(linkId); } catch (e) { r = { paid: false, status: 'UNKNOWN', error: e.message }; }
      const grants = await Sub.claimGrants();
      bg.remove();
      if (r.paid || grants.length) { Payments.granted(grants); return; }
      UI.modal({ title: 'Payment not completed', body: '<p>Cashfree has not reported this payment as paid yet' + (r.error ? ' (' + esc(r.error) + ')' : '') + '. If you did pay, it is usually confirmed within a minute: use Check again. If not, nothing was charged.</p>',
        buttons: [{ label: 'Close', cls: 'outline' }, { label: 'Check again', cls: 'green', onClick: () => { Payments.finish(linkId); } }] });
    },
    // Payments started earlier (another tab, the app) whose outcome was still open
    async collect() { const g = await Sub.settlePending(); if (g.length) Payments.granted(g); },
    granted(grants) {
      Sub.clearPendingRequest();
      App.checkSubscription();
      const what = grants.map(g => g.days > 0 ? g.days + ' days' + (g.full ? ' of Full access' : '') : g.invoices + ' invoices').join(', ');
      UI.alert('Payment received', 'Thank you! ' + (what ? 'Added: ' + what + '. ' : '') + Sub.statusText() + '.');
      if (App.current) App.go(App.current.route, App.current.params); else App.go('dashboard');
    }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && App.user && Sub.pendingLinks().length) Payments.collect(); });

  // ------------------------------------------------------------ sync with the app
  const SyncUI = {
    dialog() {
      const signedIn = !!App.user;
      const when = (t) => { const d = new Date(t); return U.pad(d.getDate()) + '/' + U.pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()); };
      const text = () => {
        const url = Sync.serverUrl();
        const what = Sync.isSupabase() ? 'Supabase project' : 'BlitzBook sync server';
        if (!signedIn) return Sync.online ? 'A ' + what + ' answers at ' + url + '. Log in with the account you use in the app and your books appear here.' : url ? 'No ' + what + ' answers at ' + url + (Supabase.looksLike(url) && !Sync.supabaseKey() ? ' (enter the anon key below)' : '') + '. Without one the portal keeps its data in this browser only.' : 'No sync server is set. The portal keeps its data in this browser only.';
        const st = Sync.state();
        if (Sync.status === 'idle' || Sync.status === 'syncing') return 'Whatever is entered here appears in the BlitzBook app, and whatever is entered in the app appears here, within a few seconds while both are online.\n\nAccount: ' + App.identity() + '\nServer: ' + url + (st.last ? '\nLast exchange: ' + when(st.last) : '');
        if (Sync.status === 'offline') return (Sync.lastError || 'Cannot reach the sync server') + '.\n\nYou can keep working: everything entered here is sent as soon as the server is reachable again.' + (st.last ? '\nLast exchange: ' + when(st.last) : '') + '\nServer: ' + url;
        if (Sync.status === 'auth') return Sync.lastError + '.';
        return 'This browser is not connected to a sync server, so the books stay on this device only.\n\nEnter your Supabase project URL and anon key below and in the app (Sync), or run the BlitzBook sync server (server/server.js) and enter its address, and both will show the same data.';
      };
      const bg = UI.modal({ title: 'Sync with the BlitzBook app', focus: false,
        body: '<p id="syText" style="white-space:pre-line"></p>' + UI.field('Sync server address or Supabase project URL', UI.input('syUrl', Sync.customUrl(), { placeholder: Sync.serverUrl() || 'https://xxxx.supabase.co' }), { hint: 'Leave blank to use the server this page was opened from. The app must use the same address.' }) +
          UI.field('Supabase anon key (Supabase projects only)', UI.input('syKey', Sync.customSupabaseKey(), { placeholder: 'eyJ... or sb_publishable_...' }), { hint: 'From the Supabase dashboard, Project Settings > API. The app needs the same key.' }),
        buttons: [{ label: 'Close', cls: 'outline' }, { label: signedIn ? 'Sync now' : 'Check', cls: 'green', onClick: async () => {
          const url = UI.val('syUrl', bg).trim(), key = UI.val('syKey', bg).trim();
          if (url !== Sync.customUrl()) Sync.setServerUrl(url);
          if (key !== Sync.customSupabaseKey()) Sync.setSupabaseKey(key);
          $('#syText', bg).textContent = 'Contacting the server…';
          await Sync.recheck();
          if (signedIn) await Sync.run();
          if (bg.isConnected) $('#syText', bg).textContent = text();
          return false;
        } }] });
      $('#syText', bg).textContent = text();
    }
  };
  App.routes.sync = () => SyncUI.dialog();

  // ------------------------------------------------------------ AI access: API keys for the MCP server
  /* Any AI assistant that speaks MCP (ChatGPT, Claude, Gemini, Copilot ...) reaches these books through the Supabase Edge Function
     server/supabase/functions/mcp with an API key made here (server/supabase/mcp.sql). A key is shown once, when it
     is made; Supabase keeps only its hash. A read-only key looks; a read & write key can also save invoices,
     contacts and items. Revoking a key deletes it. */
  const AiAccess = {
    url() { return Sync.serverUrl().replace(/\/+$/, '') + '/functions/v1/mcp'; },
    list() { return Sub.withToken((token) => Supabase.http('GET', '/rest/v1/api_keys?select=id,name,prefix,scope,created_at,last_used_at&order=created_at.desc', undefined, token)); },
    make(name, scope) { return Sub.withToken((token) => Supabase.http('POST', '/rest/v1/rpc/create_api_key', { name_in: name, scope_in: scope }, token)); },
    revoke(id) { return Sub.withToken((token) => Supabase.http('DELETE', '/rest/v1/api_keys?id=eq.' + encodeURIComponent(id), undefined, token)); },
    when(t) { const d = new Date(t); return isNaN(d) ? '' : U.pad(d.getDate()) + '/' + U.pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()); },
    copy(text, what) { try { navigator.clipboard.writeText(text).then(() => UI.toast(what + ' copied'), () => UI.toast('Select the text and copy it')); } catch (e) { UI.toast('Select the text and copy it'); } },
    async screen() {
      const here = () => App.current && App.current.route === 'ai' && !!$('#aiKeys');
      const root = App.view(App.header('AI Access') +
        '<div class="card white"><div class="hd">Connect an AI assistant</div><div class="bd"><p>Let any AI assistant work with your books: ChatGPT, Claude, Gemini, Copilot or any other app that connects to MCP servers. Ask it for this month\'s sales, who still owes you money or what a customer bought, or have it make an invoice for you. One universal API key made here works with every assistant.</p>' +
        UI.field('MCP server address', '<input id="aiUrl" readonly value="' + esc(this.url()) + '">', { hint: 'The same address for every assistant and every key; the key decides whose books are opened and what may be done with them.' }) +
        '<div class="btnrow"><button class="btn outline" id="aiCopyUrl">Copy address</button><button class="btn green" id="aiNew">' + icon('plus') + ' New API key</button></div></div></div>' +
        '<div class="card white"><div class="hd">API keys</div><div class="bd" id="aiKeys"><div class="hint">Loading…</div></div></div>');
      App.wireBack(root);
      $('#aiCopyUrl').onclick = () => this.copy(this.url(), 'Address');
      $('#aiNew').onclick = () => this.create();
      if (!Sub.paymentsAvailable()) { $('#aiNew').disabled = true; $('#aiKeys').innerHTML = '<div class="empty">AI access works on books kept in your BlitzBook account. This browser is not signed in to the server right now (Export / Import shows whether the books are synced).</div>'; return; }
      let keys;
      try { keys = await this.list(); }
      catch (e) { if (here()) { $('#aiNew').disabled = true; $('#aiKeys').innerHTML = '<div class="empty">' + esc(e.status === 404 ? 'AI access is not set up on the server yet.' : 'The keys could not be loaded: ' + (e.message || 'no connection') + '.') + '</div>'; } return; }
      if (!here()) return;
      keys = Array.isArray(keys) ? keys : [];
      $('#aiKeys').innerHTML = keys.length ? '<table class="list"><thead><tr><th>Name</th><th>Key</th><th>Access</th><th>Made</th><th>Last used</th><th></th></tr></thead><tbody>' + keys.map(k =>
        '<tr><td>' + esc(k.name) + '</td><td><code>' + esc(k.prefix) + '…</code></td><td><span class="pill ' + (k.scope === 'write' ? 'warn' : 'ok') + '" style="white-space:nowrap">' + (k.scope === 'write' ? 'Read &amp; write' : 'Read only') + '</span></td><td>' + esc(this.when(k.created_at)) + '</td><td>' + esc(k.last_used_at ? this.when(k.last_used_at) : 'Never') + '</td>' +
        '<td class="actions"><button class="btn sm red" data-revoke="' + esc(k.id) + '">Revoke</button></td></tr>').join('') + '</tbody></table>' +
        '<div class="hint">A key is shown only once, when it is made. Revoke a key you no longer use, or one that may have been seen by someone else: whatever was using it stops working at once.</div>'
        : '<div class="empty">No API keys yet. Make one to connect an assistant.</div>';
      $$('[data-revoke]', root).forEach(b => b.onclick = () => { const k = keys.find(x => x.id === b.dataset.revoke); UI.confirm('Revoke API Key', 'Revoke "' + k.name + '" (' + k.prefix + '…)? Any assistant using this key loses access to your books at once.', async () => {
        try { await this.revoke(k.id); UI.toast('Key revoked'); } catch (e) { UI.toast(e.message || 'The key could not be revoked', 6000); }
        if (App.current && App.current.route === 'ai') this.screen();
      }, 'Revoke'); });
    },
    create() {
      UI.modal({ title: 'New API Key',
        body: UI.field('Name', UI.input('akName', '', { placeholder: 'e.g. Office laptop', attrs: ' maxlength="60"' }), { hint: 'Where or by whom the key is used, to tell your keys apart later.' }) +
          UI.field('Access', UI.select('akScope', [['read', 'Read only - look at the books'], ['write', 'Read & write - also save invoices, contacts and items']], 'read'), { hint: 'Choose read only unless the assistant has to enter things for you. An invoice saved by an assistant counts like any other invoice.' }),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Make key', cls: 'green', onClick: async (bg) => {
          let r;
          try { r = await this.make(UI.val('akName', bg).trim(), UI.val('akScope', bg)); }
          catch (e) { UI.toast(e.status === 404 ? 'AI access is not set up on the server yet' : e.message || 'The key could not be made', 6000); return false; }
          if (!r || !r.key) { UI.toast((r && r.error) || 'The key could not be made', 6000); return false; }
          this.show(r);
          return true;
        } }] });
    },
    // The one time the key itself is on screen, with what to paste into the assistant. The same key and address
    // serve every assistant; nothing here is specific to one of them.
    show(k) {
      const url = this.url();
      const box = (id, text, rows) => '<textarea id="' + id + '" readonly rows="' + rows + '" style="min-height:0;font-family:monospace;font-size:12.5px;word-break:break-all">' + esc(text) + '</textarea>';
      const bg = UI.modal({ title: 'API Key: ' + k.name, wide: true, cancelable: false, focus: false,
        body: '<p><b>Copy the key now.</b> It is not shown again; if it is lost, revoke it and make a new one. Anyone who has it can ' + (k.scope === 'write' ? 'read and add to' : 'read') + ' your books, so treat it like a password.</p>' +
          UI.field('API key (' + (k.scope === 'write' ? 'read & write' : 'read only') + ')', box('akKey', k.key, 2)) + '<div class="btnrow"><button class="btn sm" data-copy="akKey">Copy key</button></div>' +
          UI.field('MCP server address', box('akUrl', url, 2), { hint: 'In your assistant add BlitzBook as a custom connector / MCP server: this address, with the header "Authorization: Bearer <key>" when the assistant asks for headers or a token.' }) + '<div class="btnrow"><button class="btn sm outline" data-copy="akUrl">Copy address</button></div>' +
          UI.field('Address with the key', box('akAny', url + '?key=' + k.key, 3), { hint: 'For an assistant that only takes a URL and no headers: this address carries the key, so no login is needed.' }) + '<div class="btnrow"><button class="btn sm outline" data-copy="akAny">Copy address with key</button></div>',
        buttons: [{ label: 'I have copied the key', cls: 'green', onClick: () => { if (App.current && App.current.route === 'ai') this.screen(); } }] });
      $$('[data-copy]', bg).forEach(b => b.onclick = () => this.copy($('#' + b.dataset.copy, bg).value, b.textContent.replace(/^Copy /, '').replace(/^./, c => c.toUpperCase())));
    }
  };
  App.routes.ai = () => AiAccess.screen();

  global.App = App; global.UI = UI; global.$ = $; global.$$ = $$; global.Company = Company; global.Subscription = Subscription; global.GetApp = GetApp; global.icon = icon; global.Theme = Theme;
})(window);
