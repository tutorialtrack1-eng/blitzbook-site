/* BlitzBook web portal - shell: routing, dialogs, login / register, dashboard, top navigation, company profile,
   backup, subscription and the sync status. Screens register themselves in App.routes from invoice.js, ledger.js, reports.js. */
(function (global) {
  'use strict';
  const { esc } = U;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // ------------------------------------------------------------ UI helpers
  const UI = {
    /* A button that is an icon alone (the actions of a list's row, the tools of a screen): its name shows on hover and
       on keyboard focus (Tip, below) and is what a screen reader says. ic = a key of ICONS, tip = the name, attrs = the
       data- attribute the screen wires it by, cls = 'primary' (filled), 'danger' (red) or nothing (outlined). */
    ibtn(ic, tip, attrs, cls) { return '<button type="button" class="ibtn' + (cls ? ' ' + cls : '') + '"' + (attrs ? ' ' + attrs : '') + ' data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '">' + icon(ic) + '</button>'; },
    // A short note at the bottom that fades out; cls "ok" makes it green (good news such as an activation)
    toast(msg, ms, cls) {
      // A refusal (a role that may not save, Store.set) stays on screen over the "saved" note that follows it
      if (UI.hold && Date.now() < UI.hold) return;
      $$('.toast').forEach(t => t.remove());
      const t = document.createElement('div'); t.className = 'toast' + (cls ? ' ' + cls : ''); t.textContent = msg; document.body.appendChild(t);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 700); }, ms || 2600);
    },
    /* A wide table scrolls sideways inside its frame, and the frame's own scroll bar sits at the foot of the table,
       which is often below the window (and many systems hide scroll bars until they are used): one had to go to the
       end of the list to move it. Every such frame gets a bar of its own right under it (.hrail) that stays at the
       foot of the window while the table is on screen. It is drawn by the page, so it shows everywhere: drag the
       handle, or click the track, to move the table; it hides itself when the table fits. */
    rails(root) {
      $$('.tablewrap', root || document).forEach(w => {
        if (w.dataset.rail || w.closest('.modal')) return; w.dataset.rail = '1';
        const rail = document.createElement('div'); rail.className = 'hrail hidden'; rail.innerHTML = '<div class="hthumb"></div>'; rail.title = 'Drag to move the table sideways';
        w.insertAdjacentElement('afterend', rail);
        const thumb = rail.firstChild, span = () => Math.max(1, w.scrollWidth - w.clientWidth);
        const fit = () => {
          const over = w.scrollWidth > w.clientWidth + 2; rail.classList.toggle('hidden', !over); if (!over) return;
          const track = rail.clientWidth, size = Math.max(48, Math.round(track * w.clientWidth / w.scrollWidth));
          thumb.style.width = size + 'px'; thumb.style.transform = 'translateX(' + Math.round((track - size) * w.scrollLeft / span()) + 'px)';
        };
        w.addEventListener('scroll', fit, { passive: true });
        // Dragging the handle moves the table in proportion; a click on the track brings the handle there
        let grab = null;
        thumb.addEventListener('pointerdown', e => { grab = { x: e.clientX, left: w.scrollLeft }; thumb.setPointerCapture(e.pointerId); rail.classList.add('drag'); e.preventDefault(); e.stopPropagation(); });
        thumb.addEventListener('pointermove', e => { if (!grab) return; const free = rail.clientWidth - thumb.offsetWidth; if (free > 0) w.scrollLeft = grab.left + (e.clientX - grab.x) * span() / free; });
        const drop = () => { grab = null; rail.classList.remove('drag'); };
        thumb.addEventListener('pointerup', drop); thumb.addEventListener('pointercancel', drop);
        rail.addEventListener('pointerdown', e => { if (e.target !== rail) return; const r = rail.getBoundingClientRect(), free = r.width - thumb.offsetWidth; if (free > 0) w.scrollLeft = (e.clientX - r.left - thumb.offsetWidth / 2) * span() / free; });
        fit(); setTimeout(fit, 60);
        if (global.ResizeObserver) { const ro = new ResizeObserver(fit); ro.observe(w); if (w.firstElementChild) ro.observe(w.firstElementChild); } else global.addEventListener('resize', fit);
      });
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
      // Inside the Android app (an HR screen opened from a tile) the app writes it to Downloads/BlitzBook
      if (global.Native && Native.android && Native.save(name, content, type)) return;
      const blob = new Blob([content], { type: type || 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
    csv(rows) { return rows.map(r => r.map(c => { const s = String(c == null ? '' : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n'); },
    // The same table as a PDF: laid out on pages by the print module and handed to the print dialog (Save as PDF)
    pdf(title, subtitle, headers, rows, opts) { Print.show(Print.table(title, subtitle, headers, rows, Store.company(), opts)); },
    // Excel-readable .xls (an HTML table), the same file the app writes from its reports
    xls(tag, headers, rows) {
      // The headings in the words of the open company's country (region.js); what is in the rows is left as it is
      if (global.Region) headers = headers.map(h => Region.text(h));
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
  /* BlitzBook's own icons: two-tone, on a 24px grid, drawn with the current text colour. Each has a soft body (T, a
     fifth of the colour) under a 1.8px line with round ends, and here and there a solid dot (D). The same drawings
     are the Android app's (tools/make-icons.js writes app/src/main/res/drawable/ic_*.xml from this list). */
  const T = ' fill="currentColor" fill-opacity=".2" stroke="none"', D = ' fill="currentColor" stroke="none"';
  const ICONS = {
    clock: '<circle cx="12" cy="12" r="9"' + T + '/><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"' + T + '/><path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    home: '<path d="M5.5 9.8 12 4l6.5 5.8V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19z"' + T + '/><path d="M3.5 11.3 12 3.8l8.5 7.5"/><path d="M5.5 9.8V19A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9.8"/><path d="M10 20.5v-4.8a2 2 0 0 1 4 0v4.8"/>',
    receipt: '<path d="M7.5 3h9A1.5 1.5 0 0 1 18 4.5v16l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3v-16A1.5 1.5 0 0 1 7.5 3z"' + T + '/><path d="M7.5 3h9A1.5 1.5 0 0 1 18 4.5v16l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3v-16A1.5 1.5 0 0 1 7.5 3z"/><path d="M9.2 8h5.6M9.2 12h2.6"/><circle cx="14.6" cy="12" r="1.1"' + D + '/>',
    rupee: '<circle cx="12" cy="12" r="10"' + T + '/><path d="M8 6h8.5M8 9.8h8.5M8 6h2.8a3.8 3.8 0 0 1 0 7.6H8l6.2 5.4"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"' + T + '/><circle cx="17" cy="17" r="3.5"' + T + '/><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><circle cx="17" cy="17" r="3.5"/>',
    user: '<path d="M4.5 20.5a7.5 7.5 0 0 1 15 0z"' + T + '/><circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"' + T + '/><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.7" r="1.4"' + D + '/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"' + T + '/><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.9"/>',
    eyeoff: '<path d="M6.3 6.9C3.5 8.7 2 12 2 12s3.6 6.5 10 6.5c1.7 0 3.2-.4 4.5-1.1M10 5.7A10.3 10.3 0 0 1 12 5.5C18.4 5.5 22 12 22 12a17 17 0 0 1-2.4 3.2"/><path d="M14.1 14.1a2.9 2.9 0 0 1-4.1-4.1"/><path d="M3.5 3.5l17 17"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.9 2.2z"' + T + '/><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.9 2.2z"/>',
    mail: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"' + T + '/><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M3.2 7.5l8.8 6 8.8-6"/>',
    truck: '<path d="M2.5 6.5h11V16h-11z"' + T + '/><path d="M2.5 15.5V8A1.5 1.5 0 0 1 4 6.5h8.5a1 1 0 0 1 1 1v9.5"/><path d="M13.5 9.5h3.4a1 1 0 0 1 .8.4l3.6 4.4v2.2a1 1 0 0 1-1 1H19.3"/><path d="M9.3 17.5h5.4M2.5 15.5v1a1 1 0 0 0 1 1h1.2"/><circle cx="7" cy="17.7" r="2.2"/><circle cx="17" cy="17.7" r="2.2"/>',
    cart: '<path d="M6.2 7h14.3l-1.7 8.2a1 1 0 0 1-1 .8H8.6a1 1 0 0 1-1-.8z"' + T + '/><path d="M2.5 3.5h2.2a1 1 0 0 1 1 .8l1.9 10.9a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20.5 7H6.2"/><circle cx="9.5" cy="19.8" r="1.5"' + D + '/><circle cx="17.5" cy="19.8" r="1.5"' + D + '/>',
    wallet: '<path d="M3 7.5h17A1.5 1.5 0 0 1 21.5 9v9.5A1.5 1.5 0 0 1 20 20H5.5A2.5 2.5 0 0 1 3 17.5z"' + T + '/><path d="M18.5 7.5V6A1.5 1.5 0 0 0 17 4.5H5.5a2.5 2.5 0 0 0 0 3H20A1.5 1.5 0 0 1 21.5 9v9.5A1.5 1.5 0 0 1 20 20H5.5A2.5 2.5 0 0 1 3 17.5V6.8"/><circle cx="17" cy="13.8" r="1.4"' + D + '/>',
    book: '<path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v15H7.5A2.5 2.5 0 0 0 5 19.5z"' + T + '/><path d="M5 19.5v-15A2.5 2.5 0 0 1 7.5 2H19v15H7.5a2.5 2.5 0 0 0 0 5H19"/><path d="M9.5 7h5.5"/>',
    chart: '<rect x="3.5" y="12" width="4.5" height="8.5" rx="1.3"' + T + '/><rect x="9.75" y="4" width="4.5" height="16.5" rx="1.3"' + T + '/><rect x="16" y="8.5" width="4.5" height="12" rx="1.3"' + T + '/><rect x="3.5" y="12" width="4.5" height="8.5" rx="1.3"/><rect x="9.75" y="4" width="4.5" height="16.5" rx="1.3"/><rect x="16" y="8.5" width="4.5" height="12" rx="1.3"/>',
    building: '<rect x="5" y="3" width="14" height="18" rx="2"' + T + '/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/><path d="M3 21h18M10 21v-3.5h4V21"/><circle cx="9.5" cy="7.5" r="1"' + D + '/><circle cx="14.5" cy="7.5" r="1"' + D + '/><circle cx="9.5" cy="12" r="1"' + D + '/><circle cx="14.5" cy="12" r="1"' + D + '/>',
    trend: '<path d="M3 16.5l5.5-5.5 4 4L21 6.5V20H3z"' + T + '/><path d="M3 16.5l5.5-5.5 4 4L21 6.5"/><path d="M15.5 6.5H21V12"/>',
    pie: '<circle cx="11.5" cy="12.5" r="8.5"' + T + '/><path d="M11.5 4a8.5 8.5 0 1 0 8.5 8.5h-8.5z"/><path d="M15 3.3A7.5 7.5 0 0 1 20.7 9H15z"/>',
    scale: '<path d="M2 14l3-7 3 7a3 3 0 0 1-6 0z"' + T + '/><path d="M16 14l3-7 3 7a3 3 0 0 1-6 0z"' + T + '/><path d="M12 3.5v17M7.5 20.5h9M5 7h14"/><path d="M2 14l3-7 3 7a3 3 0 0 1-6 0zM16 14l3-7 3 7a3 3 0 0 1-6 0z"/>',
    box: '<path d="M3 8l9-5 9 5-9 5z"' + T + '/><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    download: '<path d="M4 16.5h16v2a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5z"' + T + '/><path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4 16.5v2A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-2"/>',
    star: '<path d="M12 2.5l2.9 6 6.6.900-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.900z"' + T + '/><path d="M12 2.5l2.9 6 6.6.900-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.900z"/>',
    logout: '<path d="M3.5 5a2 2 0 0 1 2-2H10v18H5.5a2 2 0 0 1-2-2z"' + T + '/><path d="M10 21H5.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2H10"/><path d="M15.5 16.5L20 12l-4.5-4.5M20 12H9.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    shield: '<path d="M12 2.5L4.5 5.3V11c0 4.7 3.2 8.9 7.5 10.5 4.3-1.6 7.5-5.8 7.5-10.5V5.3z"' + T + '/><path d="M12 2.5L4.5 5.3V11c0 4.7 3.2 8.9 7.5 10.5 4.3-1.6 7.5-5.8 7.5-10.5V5.3z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
    sync: '<circle cx="12" cy="12" r="4.5"' + T + '/><path d="M20.5 12a8.5 8.5 0 0 1-14.8 5.7L3.5 15.5"/><path d="M3.5 20.5v-5h5"/><path d="M3.5 12a8.5 8.5 0 0 1 14.8-5.7l2.2 2.2"/><path d="M20.5 3.5v5h-5"/>',
    bank: '<path d="M3 9.5L12 4l9 5.5z"' + T + '/><path d="M3 9.5L12 4l9 5.5z"/><path d="M6 12.5v5M10 12.5v5M14 12.5v5M18 12.5v5M3.5 20.5h17"/>',
    payout: '<path d="M3 7.5h17A1.5 1.5 0 0 1 21.5 9v4H13v7H5.5A2.5 2.5 0 0 1 3 17.5z"' + T + '/><path d="M18.5 7.5V6A1.5 1.5 0 0 0 17 4.5H5.5a2.5 2.5 0 0 0 0 3H20A1.5 1.5 0 0 1 21.5 9v3.5"/><path d="M3 6.8v10.7A2.5 2.5 0 0 0 5.5 20H12"/><path d="M14.5 18h7M18.5 15l3 3-3 3"/>',
    ledger: '<path d="M6 3h6v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"' + T + '/><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 3v18M6.8 8h2.4M6.8 12h2.4M14.8 8h2.4M14.8 12h2.4M14.8 16h2.4"/>',
    android: '<path d="M5 15a7 7 0 0 1 14 0v4H5z"' + T + '/><path d="M5 15a7 7 0 0 1 14 0v4H5z"/><path d="M8 9.5L6.5 7M16 9.5L17.5 7"/><path d="M8 19v2.5M16 19v2.5M3 12v4M21 12v4"/><circle cx="9.5" cy="13.5" r="1"' + D + '/><circle cx="14.5" cy="13.5" r="1"' + D + '/>',
    apple: '<path d="M15.5 6.5c-1.6 0-2.3.9-3.5.9s-2.1-.9-3.5-.9C6.3 6.5 4 8.6 4 12.4c0 3.4 2.6 8.1 4.6 8.1 1.1 0 1.7-.8 3.4-.8s2.1.8 3.4.8c2 0 4.1-4 4.6-5.8-2.2-.8-3-3-3-3.5 0-1.7 1-2.9 2.5-3.6-1-1.2-2.4-1.1-4-1.1z"' + T + '/><path d="M15.5 6.5c-1.6 0-2.3.9-3.5.9s-2.1-.9-3.5-.9C6.3 6.5 4 8.6 4 12.4c0 3.4 2.6 8.1 4.6 8.1 1.1 0 1.7-.8 3.4-.8s2.1.8 3.4.8c2 0 4.1-4 4.6-5.8-2.2-.8-3-3-3-3.5 0-1.7 1-2.9 2.5-3.6-1-1.2-2.4-1.1-4-1.1z"/><path d="M12.5 6c0-1.9 1.4-3.6 3.3-3.8.2 2-1.5 3.8-3.3 3.8z"/>',
    file: '<path d="M6.5 2.5H14L19.5 8v11.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z"' + T + '/><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h4.5"/>',
    key: '<circle cx="8" cy="15.5" r="4.5"' + T + '/><circle cx="8" cy="15.5" r="4.5"/><path d="M11.2 12.3L20 3.5M16.5 7l3 3M13.8 9.7l2 2"/>',
    moon: '<path d="M20.5 13.3A8.5 8.5 0 1 1 10.7 3.5a6.8 6.8 0 0 0 9.8 9.8z"' + T + '/><path d="M20.5 13.3A8.5 8.5 0 1 1 10.7 3.5a6.8 6.8 0 0 0 9.8 9.8z"/>',
    users: '<path d="M2.5 20.5a6.5 6.5 0 0 1 13 0z"' + T + '/><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20.5a6.5 6.5 0 0 1 13 0"/><path d="M16 4.8a3.2 3.2 0 0 1 0 6.2M18 14.6a5.5 5.5 0 0 1 3.5 5.1"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"' + T + '/><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.3l9 5 9-5M3 16.5l9 5 9-5"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"' + T + '/><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>',
    // Settings (the top bar) as sliders, and the actions of a row of a list, each a button with its name on hover (UI.ibtn)
    gear: '<circle cx="15" cy="6.5" r="2.3"' + T + '/><circle cx="9" cy="12" r="2.3"' + T + '/><circle cx="15.5" cy="17.5" r="2.3"' + T + '/><path d="M3.5 6.5h9.2M17.3 6.5h3.2M3.5 12h3.2M11.3 12h9.2M3.5 17.5h9.7M17.8 17.5h2.7"/><circle cx="15" cy="6.5" r="2.3"/><circle cx="9" cy="12" r="2.3"/><circle cx="15.5" cy="17.5" r="2.3"/>',
    printer: '<rect x="2.5" y="9" width="19" height="9" rx="2"' + T + '/><path d="M6.5 9V3.5h11V9"/><path d="M6.5 18H4.5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6.5 14.5h11v6h-11z"/><circle cx="17.5" cy="11.8" r="1"' + D + '/>',
    copy: '<rect x="3" y="3" width="12" height="12" rx="2.5"' + T + '/><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5"/>',
    trash: '<path d="M5.5 6.5h13l-.900 12.7a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8z"' + T + '/><path d="M3.5 6.5h17M9 6.5V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5v2"/><path d="M18.5 6.5l-.900 12.7a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8L5.5 6.5"/><path d="M10 11v5.5M14 11v5.5"/>',
    edit: '<path d="M16.3 3.7a2.1 2.1 0 0 1 3 3L7.5 18.5l-4 1 1-4z"' + T + '/><path d="M16.3 3.7a2.1 2.1 0 0 1 3 3L7.5 18.5l-4 1 1-4z"/><path d="M14.5 5.5l3 3M13 20.5h7.5"/>',
    creditnote: '<path d="M6.5 2.5H14L19.5 8v11.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z"' + T + '/><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5M9 15h6"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"' + T + '/><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><circle cx="6.3" cy="12" r="1"' + D + '/><circle cx="17.7" cy="12" r="1"' + D + '/>',
    bed: '<path d="M3 15v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3z"' + T + '/><path d="M3 18.5V12a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6.5"/><path d="M3 15h18M5 10V7.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2V10M3 18.5V20M21 18.5V20"/>',
    sun: '<circle cx="12" cy="12" r="4.2"' + T + '/><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    // What used to be emoji on buttons: the menu of a restaurant, list view, a warning; and for the Android app a magnifier, the menu and an update
    dish: '<path d="M4 17a8 8 0 0 1 16 0z"' + T + '/><path d="M4 17a8 8 0 0 1 16 0z"/><path d="M2.5 20h19M12 9V6.5M10.5 6.5h3"/>',
    list: '<path d="M9 6.5h11.5M9 12h11.5M9 17.5h11.5"/><circle cx="4.7" cy="6.5" r="1.3"' + D + '/><circle cx="4.7" cy="12" r="1.3"' + D + '/><circle cx="4.7" cy="17.5" r="1.3"' + D + '/>',
    alert: '<path d="M10.7 4.2 2.7 18.4a1.5 1.5 0 0 0 1.3 2.2h16a1.5 1.5 0 0 0 1.3-2.2l-8-14.2a1.5 1.5 0 0 0-2.6 0z"' + T + '/><path d="M10.7 4.2 2.7 18.4a1.5 1.5 0 0 0 1.3 2.2h16a1.5 1.5 0 0 0 1.3-2.2l-8-14.2a1.5 1.5 0 0 0-2.6 0z"/><path d="M12 9.5v4.3"/><circle cx="12" cy="17.2" r="1.1"' + D + '/>',
    search: '<circle cx="11" cy="11" r="6.5"' + T + '/><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    menu: '<path d="M4 6.5h16M4 12h10.5M4 17.5h16"/>',
    upload: '<path d="M4 16.5h16v2a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5z"' + T + '/><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 16.5v2A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-2"/>',
    // Drawn for the menu of the Android app (make-icons.js): a link, and the spark of AI Access
    link: '<path d="M9.5 14.5l5-5"/><path d="M11 6.5l1.3-1.3a4.6 4.6 0 0 1 6.5 6.5L17.5 13"/><path d="M13 17.5l-1.3 1.3a4.6 4.6 0 0 1-6.5-6.5L6.5 11"/>',
    spark: '<path d="M11 3.5l1.9 5.1a2 2 0 0 0 1.2 1.2l5.1 1.9-5.1 1.9a2 2 0 0 0-1.2 1.2L11 19.9l-1.9-5.1a2 2 0 0 0-1.2-1.2l-5.1-1.9 5.1-1.9a2 2 0 0 0 1.2-1.2z"' + T + '/><path d="M11 3.5l1.9 5.1a2 2 0 0 0 1.2 1.2l5.1 1.9-5.1 1.9a2 2 0 0 0-1.2 1.2L11 19.9l-1.9-5.1a2 2 0 0 0-1.2-1.2l-5.1-1.9 5.1-1.9a2 2 0 0 0 1.2-1.2z"/><path d="M19 3v4M17 5h4"/>'
  };
  function icon(name) { return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>'; }

  // The dashboard tiles in their standard order. Each account may drag them into its own order, kept as tile_order.
  const TILES = [
    { key: 'invoice', t: 'New Invoice', ic: 'receipt', a: '#4F46E5', b: '#6366F1' },
    { key: 'purchases', t: 'Purchases', ic: 'cart', a: '#B45309', b: '#F59E0B' },
    { key: 'sales', t: 'Sales', ic: 'rupee', a: '#0F766E', b: '#14B8A6' },
    // The roster of a manpower and staffing agency (manpower.js): shown to such a company only
    { key: 'manpower', t: 'Manpower', ic: 'users', a: '#1D4ED8', b: '#38BDF8' },
    // The front desk of a hotel or other accommodation (hotel.js)
    { key: 'hotel', t: 'Front Desk', ic: 'building', a: '#9A3412', b: '#FB923C' },
    // Property let by the month: buildings, rooms, beds, furniture and the tenants (rental.js)
    { key: 'rental', t: 'Rentals', ic: 'key', a: '#0F766E', b: '#2DD4BF' },
    { key: 'items', t: 'Inventory', ic: 'box', a: '#15803D', b: '#22C55E' },
    { key: 'expenses', t: 'Expense', ic: 'wallet', a: '#BE123C', b: '#F43F5E' },
    { key: 'receipts', t: 'Receipts', ic: 'bank', a: '#0E7490', b: '#06B6D4' },
    { key: 'payments', t: 'Payments', ic: 'payout', a: '#9D174D', b: '#EC4899' },
    { key: 'journal', t: 'Journal', ic: 'book', a: '#6D28D9', b: '#8B5CF6' },
    { key: 'customers', t: 'Customer', ic: 'user', a: '#7E22CE', b: '#A855F7' },
    { key: 'suppliers', t: 'Supplier', ic: 'truck', a: '#C2410C', b: '#F97316' },
    { key: 'reports', t: 'Reports', ic: 'chart', a: '#0369A1', b: '#0EA5E9' },
    { key: 'hr', t: 'HR & Payroll', ic: 'users', a: '#4D7C0F', b: '#84CC16' },
    { key: 'clock', t: 'Web Clock', ic: 'clock', a: '#0E7490', b: '#22D3EE' },
    // Bringing the books over from Tally, SAP and the rest (migrate.js)
    { key: 'migrate', t: 'Migrate', ic: 'download', a: '#1D4ED8', b: '#60A5FA' }
  ];
  // The tiles in this account's order; tiles added since are appended, tiles that no longer exist are dropped
  // An employee login's dashboard: the clock, their timesheet and their claims
  const EMP_TILES = [
    { key: 'clock', t: 'Web Clock', ic: 'clock', a: '#0E7490', b: '#22D3EE' },
    { key: 'timesheets', t: 'My Timesheet', ic: 'book', a: '#4F46E5', b: '#6366F1' },
    { key: 'reimbursements', t: 'My Claims', ic: 'wallet', a: '#B45309', b: '#F59E0B' },
    { key: 'leave', t: 'My Leave', ic: 'sun', a: '#BE123C', b: '#F43F5E' },
    { key: 'payslips', t: 'My Payslips', ic: 'receipt', a: '#0F766E', b: '#14B8A6' }
  ];
  /* The order of a dashboard section or of a menu, kept for this account on this device: nothing = the standard
     order, a list of keys = the order they were dragged into, 'az' = by name, 'used' = the most used (or most sold)
     first. o = { key(x), name(x), count(x), newFirst }: newFirst puts what the dragged order does not know in front. */
  function ordered(list, saved, o) {
    if (saved === 'az') return list.slice().sort((a, b) => o.name(a).localeCompare(o.name(b), undefined, { sensitivity: 'base' }));
    if (saved === 'used') return list.map((x, i) => [x, i]).sort((a, b) => o.count(b[0]) - o.count(a[0]) || a[1] - b[1]).map(x => x[0]);
    if (!Array.isArray(saved) || !saved.length) return list;
    const by = new Map(list.map(x => [o.key(x), x])), out = saved.map(k => by.get(k)).filter(Boolean), rest = list.filter(x => !out.includes(x));
    return o.newFirst ? rest.concat(out) : out.concat(rest);
  }
  const orderSet = (v) => typeof v === 'string' ? !!v : Array.isArray(v) && v.length > 0;
  // How often a tile or a menu entry was opened here: what "Most used first" goes by
  const uses = () => Store.get('use_count', {}) || {};
  function used(id) { const u = uses(); u[id] = (u[id] || 0) + 1; Store.set('use_count', u, true); }
  const SORTS = [['', 'Standard order'], ['az', 'A to Z'], ['used', 'Most used first']];
  function tileList() {
    const all = Companies.selfService() ? EMP_TILES : Sub.isLite() ? LITE_TILES : TILES, u = uses();
    const out = ordered(all, Store.get('tile_order', []), { key: t => t.key, name: t => t.t, count: t => u['tile:' + t.key] || 0 });
    // The groups the company's businesses take away (business.js) take their tiles with them
    return out.filter(t => Companies.tileAllowed(t.key) && !Business.tileOff(t.key) && !appOff(t.key));
  }
  /* Tiles can be dragged into a new order. With a mouse a tile is dragged straight away; on a touch screen the
     page has to keep scrolling, so dragging there happens in "Arrange" mode (the link beside the heading), which
     the user leaves with Done. The dragged tile takes the place of the tile it is held over; the order is saved
     when it is dropped. A click right after a drag is swallowed so the tile does not open. */
  function arrangeTiles(grid, onOrder, sel, keyOf) {
    sel = sel || '.tile'; keyOf = keyOf || ((t) => t.dataset.go);
    let drag = null, start = null, moved = false;
    const tiles = () => Array.from(grid.children);
    const begin = (tile, e) => { drag = tile; moved = false; tile.classList.add('dragging'); try { tile.setPointerCapture(e.pointerId); } catch (x) { /* not needed */ } };
    const place = (x, y) => {
      const over = document.elementFromPoint(x, y), t = over && over.closest(sel);
      if (!t || t === drag || t.parentNode !== grid) return;
      const kids = tiles();
      if (kids.indexOf(drag) < kids.indexOf(t)) t.after(drag); else t.before(drag);
      moved = true;
    };
    grid.addEventListener('pointerdown', e => {
      const tile = e.target.closest(sel); if (!tile || e.button) return;
      start = { x: e.clientX, y: e.clientY, tile };
      // In Arrange mode, or held by its grip (the menu arranger), a thing is dragged at once, by touch too
      if (grid.classList.contains('arrange') || e.target.closest('.grip')) { begin(tile, e); e.preventDefault(); }
    });
    grid.addEventListener('pointermove', e => {
      if (!start) return;
      if (!drag) { if (e.pointerType === 'mouse' && Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 8) begin(start.tile, e); return; }
      place(e.clientX, e.clientY); e.preventDefault();
    });
    const end = () => {
      if (drag) {
        const was = drag; drag.classList.remove('dragging'); drag = null;
        if (moved) { onOrder(tiles().map(keyOf)); was.dataset.dragged = '1'; setTimeout(() => delete was.dataset.dragged, 50); }
      }
      start = null;
    };
    grid.addEventListener('pointerup', end); grid.addEventListener('pointercancel', end);
    grid.addEventListener('click', e => { const t = e.target.closest(sel); if (t && (t.dataset.dragged || grid.classList.contains('arrange'))) { e.stopPropagation(); e.preventDefault(); } }, true);
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
      { key: 'purchases', t: 'Purchases & Quotations' }, { key: 'procurement', t: 'Procurement' }, { key: 'contacts', t: 'Suppliers', params: { type: 'Supplier' } }, { key: 'expenses', t: 'Expenses' }] },
    // A hotel, resort, guest house or homestay (hotel.js): shown when one of the company's businesses is accommodation (business.js)
    { t: 'Hotel', ic: 'building', items: [
      { key: 'hotel', t: 'Front Desk', params: { tab: 'desk' } }, { key: 'hotel', t: 'Room Chart', params: { tab: 'chart' } }, { key: 'hotel', t: 'Reservations', params: { tab: 'stays' } }, { key: 'hotel', t: 'Rooms & Housekeeping', params: { tab: 'rooms' } },
      { key: 'hotel', t: 'Guest Register', params: { tab: 'register' } }, { key: 'hotel', t: 'Occupancy Reports', params: { tab: 'reports' } }, { key: 'hotel', t: 'Hotel Settings', params: { tab: 'settings' } }] },
    // Property let by the month (rental.js): shown when one of the company's businesses is Rental Services (business.js)
    { t: 'Rental', ic: 'key', items: [
      { key: 'rental', t: 'Overview', params: { tab: 'overview' } }, { key: 'rental', t: 'Buildings & Rooms', params: { tab: 'units' } }, { key: 'rental', t: 'Tenants', params: { tab: 'tenants' } }, { key: 'rental', t: 'Rent & Collections', params: { tab: 'rent' } },
      { key: 'rental', t: 'Furniture & Assets', params: { tab: 'assets' } }, { key: 'rental', t: 'Rental Reports', params: { tab: 'reports' } }, { key: 'rental', t: 'Rental Settings', params: { tab: 'settings' } }] },
    // A manpower and staffing agency (Services > Manpower and Staffing Services) keeps people rather than stock: its roster (manpower.js)
    { t: 'Manpower', ic: 'users', items: [
      { key: 'manpower', t: 'Members', params: { tab: 'members' } }, { key: 'manpower', t: 'Deployment', params: { tab: 'deploy' } }, { key: 'manpower', t: 'Skills', params: { tab: 'skills' } }, { key: 'manpower', t: 'Papers', params: { tab: 'papers' } }, { key: 'hrpolicy', t: 'Leave Policy', params: { g: 'manpower' } }] },
    { t: 'Inventory', ic: 'box', items: [
      { key: 'inventory', t: 'Overview', params: { tab: 'overview' } }, { key: 'items', t: 'Items' }, { key: 'stock', t: 'Stock in Hand' }, { key: 'inventory', t: 'Stock Ledger', params: { tab: 'ledger' } }, { key: 'inventory', t: 'Stores', params: { tab: 'stores' } },
      { key: 'inventory', t: 'Adjustments & Wastage', params: { tab: 'adjust' } }, { key: 'inventory', t: 'Stock Count', params: { tab: 'count' } }, { key: 'inventory', t: 'Transfers', params: { tab: 'transfer' } },
      { key: 'inventory', t: 'Recipes / BoM', params: { tab: 'recipes' } }, { key: 'inventory', t: 'Movements', params: { tab: 'moves' } }, { key: 'inventory', t: 'Reports', params: { tab: 'reports' } }] },
    { t: 'Records', ic: 'book', items: [
      { key: 'daybook', t: 'Day Transactions' }, { key: 'money', t: 'Receipts & Payments' }, { key: 'bankstmt', t: 'Bank Statement' }, { key: 'journal', t: 'Journal' }, { key: 'ledger', t: 'Party Ledger' },
      { key: 'pnl', t: 'Profit & Loss' }, { key: 'balance', t: 'Balance Sheet' }, { key: 'group', t: 'Group Statements' }] },
    { t: 'HR', ic: 'users', items: [
      { key: 'employees', t: 'Employees' }, { key: 'clock', t: 'Web Clock' }, { key: 'attendance', t: 'Attendance' }, { key: 'leave', t: 'Leave' }, { key: 'timesheets', t: 'Timesheets' }, { key: 'reimbursements', t: 'Reimbursements' }, { key: 'payroll', t: 'Payroll' }, { key: 'hrpolicy', t: 'HR Policy' }, { key: 'hrsettings', t: 'HR Settings' }, { key: 'payslips', t: 'My Payslips' }] },
    // The project report an accountant or a tax professional prepares for a bank loan (professional.js)
    { t: 'Professionals', ic: 'chart', items: [
      { key: 'pro', t: 'Project details', params: { tab: 'project' } }, { key: 'pro', t: 'Cost & means of finance', params: { tab: 'cost' } }, { key: 'pro', t: 'Profitability statement', params: { tab: 'profit' } }, { key: 'pro', t: 'Projected balance sheet', params: { tab: 'balance' } }, { key: 'pro', t: 'Funds flow', params: { tab: 'funds' } }, { key: 'pro', t: 'Cash flow statement', params: { tab: 'cashflow' } },
      { key: 'pro', t: 'Depreciation', params: { tab: 'depreciation' } }, { key: 'pro', t: 'Repayment schedule', params: { tab: 'repayment' } }, { key: 'pro', t: 'DSCR', params: { tab: 'dscr' } }, { key: 'pro', t: 'Break-even point', params: { tab: 'bep' } }, { key: 'pro', t: 'Working capital', params: { tab: 'wc' } }, { key: 'pro', t: 'Ratios', params: { tab: 'ratios' } }] },
    { t: 'Company', ic: 'building', items: [
      { key: 'company', t: 'Company Profile' }, { key: 'companies', t: 'Companies' }, { key: 'split', t: 'Split by Financial Year' }, { key: 'currency', t: 'Currencies & Rates' }, { key: 'gst', t: 'GST Returns' }, { key: 'recon', t: 'Tax Reconciliation' }, { key: 'backup', t: 'Export / Import' }, { key: 'migrate', t: 'Migrate to BlitzBook' },
      { key: 'licences', t: 'Licences' }, { key: 'subscription', t: 'Subscription' }] },
    /* Settings: how the portal is set up for this company and this login. Not a group of the bar: it is the gear at the
       top right, which opens the Settings screen (settings.js) with these as its sections. They are listed here so that
       a shortcut can open each of them and Tab Access knows them. */
    { t: 'Settings', ic: 'gear', bar: false, items: [
      { key: 'settings', t: 'All Settings', params: { tab: 'general' } }, { key: 'settings', t: 'Invoice Fields', params: { tab: 'invoice' } }, { key: 'settings', t: 'Custom Fields', params: { tab: 'fields' } }, { key: 'settings', t: 'E-Invoice & E-Way Bill', params: { tab: 'edocs' } }, { key: 'settings', t: 'Reconciliation', params: { tab: 'recon' } }, { key: 'settings', t: 'Shortcuts', params: { tab: 'shortcuts' } }, { key: 'settings', t: 'Users & Roles', params: { tab: 'users' } },
      { key: 'tabaccess', t: 'Tab Access' }, { key: 'business', t: 'Businesses & Tabs' },
      // API keys for the MCP server: an AI assistant working with these books (server/supabase/functions/mcp)
      { key: 'ai', t: 'AI Access' }] }
  ];
  // Routes that open a dialog over the current screen: they never become the active link or the screen to redraw
  const DIALOGS = ['company', 'subscription', 'sync', 'shortcuts'];
  // What an account on an invoice pack gets: invoicing only (Sub.isLite)
  const LITE_KEYS = ['dashboard', 'invoice', 'sales', 'notes', 'contacts', 'salesReport', 'company', 'gst', 'settings', 'shortcuts', 'backup', 'ai', 'licences', 'subscription'];
  const LITE_TILES = [
    { key: 'invoice', t: 'New Invoice', ic: 'receipt', a: '#4F46E5', b: '#6366F1' },
    { key: 'sales', t: 'Sales', ic: 'rupee', a: '#0F766E', b: '#14B8A6' },
    { key: 'cnotes', t: 'Credit Notes', ic: 'ledger', a: '#BE123C', b: '#F43F5E' },
    { key: 'dnotes', t: 'Debit Notes', ic: 'ledger', a: '#B45309', b: '#F59E0B' },
    { key: 'customers', t: 'Customer', ic: 'user', a: '#7E22CE', b: '#A855F7' },
    { key: 'suppliers', t: 'Supplier', ic: 'truck', a: '#C2410C', b: '#F97316' },
    { key: 'reports', t: 'Sales Report', ic: 'chart', a: '#0369A1', b: '#0EA5E9' }
  ];
  /* What the Android app does not offer (Tab Access, Currencies & Rates, Settings, Split by Financial Year, Migrate): the
     portal shown inside the app (PortalActivity) leaves them out of its menu and its dashboard too. They are the
     browser's, on a computer. */
  const APP_OFF = ['tabaccess', 'currency', 'settings', 'split', 'migrate'];
  const appOff = (key) => Native.android && APP_OFF.includes(key);
  // Screens that belong to the account rather than to a company: not offered while another company's books are open
  const ACCOUNT_NAV = ['ai'];
  // The groups and items this account gets right now: the plan (invoice pack = invoicing only), the role in the company
  function navItems() {
    const ok = (n) => (!Sub.isLite() || LITE_KEYS.includes(n.key)) && Companies.mayOpen(n.key) && !Companies.tabOff(n) && !Business.tabOff(n) && !(Store.cid && ACCOUNT_NAV.includes(n.key)) && !appOff(n.key);
    return NAV.map(g => g.items ? Object.assign({}, g, { items: g.items.filter(ok) }) : g).filter(g => g.items ? g.items.length > 0 : ok(g));
  }
  // (with the country of the open company: the menu is drawn again in its words when that changes, region.js)
  const navKeys = () => U.region().code + '@' + navItems().map(g => g.items ? g.t + ':' + g.items.map(i => i.key + (i.params ? JSON.stringify(i.params) : '')).join('|') : g.key).join();
  /* An entry of the menu, a tile of the dashboard and the mark at the top left are links (<a href="#sales">): a click
     opens the screen here, and everything a browser does with a link is the browser's own - a right click offers its
     Open link in new tab / new window and Copy link address, Ctrl or Cmd with a click and the middle button open a
     tab. An entry that opens a dialog over the screen (Company Profile, Subscription) has no address and stays a button. */
  const hrefOf = (key, params) => App.routes[key] && !DIALOGS.includes(key) ? App.hashOf(key, params) : '';
  function link(cls, it, inner) {
    const h = hrefOf(it.key, it.params), at = ' class="' + cls + '" data-go="' + it.key + '"' + (it.params ? ' data-params="' + esc(JSON.stringify(it.params)) + '"' : '');
    return h ? '<a href="' + esc(h) + '" draggable="false"' + at + '>' + inner + '</a>' : '<button' + at + '>' + inner + '</button>';
  }
  // A click that is the browser's to handle: with Ctrl / Cmd / Shift / Alt, or not the main button
  const ownClick = (e, el) => el.tagName === 'A' && (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button > 0);
  // The screen a tile opens at once, as an address ('' when it asks first: Reports and HR & Payroll open a chooser)
  function tileHref(k) {
    if (k === 'hr' || (k === 'reports' && !Sub.isLite())) return '';
    const to = { reports: ['salesReport'], cnotes: ['notes', { kind: 'CN' }], dnotes: ['notes', { kind: 'DN' }], customers: ['contacts', { type: 'Customer' }], suppliers: ['contacts', { type: 'Supplier' }], receipts: ['money', { kind: 'receipt' }], payments: ['money', { kind: 'payment' }],
      items: global.Inv && Companies.mayOpen('inventory') ? ['inventory', { tab: 'overview' }] : ['items'] }[k] || [k];
    return hrefOf(to[0], to[1]);
  }
  function navHtml() {
    return navItems().filter(n => n.bar !== false).map(n => n.items
      ? '<div class="navgrp"><button class="navlink grp" aria-haspopup="true" aria-expanded="false">' + icon(n.ic) + '<span>' + esc(n.t) + '</span><i class="caret"></i></button><div class="navmenu" role="menu">' +
        n.items.map(it => link('navitem" role="menuitem', it, esc(it.t))).join('') + '</div></div>'
      : link('navlink', n, icon(n.ic) + '<span>' + esc(n.t) + '</span>')).join('');
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
    // Every group and entry of the menu this kind of company has, whatever the login may open (Tab Access, companies.js)
    nav() { return NAV; },
    // Whether a screen is in the menu this login gets right now (the plan, the role, the company's tabs): shortcuts.js
    menuHas(key, params) { const want = params ? JSON.stringify(params) : ''; return navItems().some(g => (g.items || [g]).some(it => it.key === key && (!want || !it.params || JSON.stringify(it.params) === want))); },
    start() {
      Sync.onApplied = (keys) => this.synced(keys);
      Sync.onAuthLost = (msg) => { this.logout(); UI.alert('Sign in again', msg + '. Log in with the new password.'); };
      Sync.ready(); // find out early whether a sync server is there
      window.addEventListener('hashchange', () => this.onHashChange());
      const s = Store.session();
      // An invitation link (#join?...): remembered, then Login or Register with the details filled in; a login already on goes on and switches
      const j = Auth.joinFromHash();
      if (j) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* fine */ } Auth.rememberJoin(j); if (!(s && s.uid && !this.sessionOver(s))) { Auth.start(j); return; } }
      if (s && s.uid && this.sessionOver(s)) { Store.setSession(null); Auth.login(); UI.toast('Your 24-hour session is over. Please log in again.', 6000); return; }
      if (s && s.uid) { const u = Store.users().find(x => x.id === s.uid); if (u) { this.login(u); return; } }
      Auth.login();
    },
    sessionOver(s) { return !!(s && s.at) && Date.now() - s.at > SESSION_MS; },
    // Signed in from an invitation link: open the company it named (the membership arrives with the company list)
    joined(u, j) {
      Auth.rememberJoin(null);
      const want = String(j.c || '').trim().toLowerCase();
      const others = Companies.list().filter(x => !(x.primary && x.role === 'owner'));
      // By name; else the one company the account was given a role in; else by the role of the invitation
      const c = others.find(x => want && String(x.name || '').trim().toLowerCase() === want) || (others.length === 1 ? others[0] : null) || others.find(x => j.r && x.role === j.r) || null;
      if (!c && !j.again) { j.again = true; Auth.rememberJoin(j); setTimeout(() => { if (this.user === u) Companies.load().then(() => this.joined(u, j), () => this.joined(u, j)); }, 4000); return; }
      if (!c) { UI.toast('The invitation to ' + (j.c || 'the company') + ' was for ' + (j.e || j.p) + ': it opens once that account logs in and the company list has refreshed (Company > Companies).', 9000); return; }
      if ((Store.cid || '') !== c.id) Companies.switchTo(c.id); else UI.toast('You are in ' + (c.name || 'the company'), 3000);
    },
    login(u, token, checked) {
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
      // A login the owner removed from the members list is refused before anything is shown (companies.js)
      if (!checked) { Companies.gate(u).then(st => { if (this.user !== u) return; if (st && st.active === false) Companies.deactivated(st); else this.login(u, token, true); }); return; }
      Sub.markRegistered();
      // The company this browser last had open for the account (companies.js); the list itself is refreshed in the background
      const last = Companies.lastCid();
      if (last && Companies.find(last)) Companies.enter(u, last);
      Companies.refresh().then(list => {
        // An employee (or any member) who has no company of their own and was given exactly one: open it
        if (this.user !== u || Store.cid || Auth.pendingJoin() || !Array.isArray(list)) return;
        const own = list.find(x => x.primary && x.role === 'owner'), others = list.filter(x => !(x.primary && x.role === 'owner'));
        if (others.length === 1 && !(own && own.name) && !Store.company().name && !Store.list('invoices').length) Companies.switchTo(others[0].id);
      });
      this.shell();
      // A reload or a bookmark opens the screen in the address; otherwise the dashboard
      const t = this.fromHash();
      this.go(t ? t.route : 'dashboard', t ? t.params : undefined);
      const settle = () => {
        if (this.user !== u) return;
        // A company profile is asked for in the account's own books only, and not while an invitation is being followed
        if (!Store.company().name && !Store.cid && !Auth.pendingJoin()) Company.edit(true);
        this.checkSubscription();
        // Back from Cashfree's payment page (#subscription?link=...), or payments made elsewhere: collect what was bought
        const m = /^#subscription\?link=([^&]+)/.exec(location.hash || '');
        if (m) Payments.finish(decodeURIComponent(m[1])); else if (Sub.pendingLinks().length) Payments.collect(); else Sub.claimGrants().then(g => { if (g.length) Payments.granted(g); });
      };
      // On a browser that has never met the server the books may be on their way: wait for them before
      // asking for a company profile that already exists
      const fresh = !Sync.state().epoch, first = Sync.start(u);
      // Signed in from an invitation link: once sync is up (the company list needs the login on the server), fetch the
      // companies - the first look turns the invitation into the membership - and open the one named
      const join = Auth.pendingJoin();
      if (join) first.then(() => { if (this.user === u) Companies.load().then(() => this.joined(u, join), () => this.joined(u, join)); });
      if (fresh) first.then(() => { if (this.user === u) { this.refresh(); settle(); } }); else settle();
    },
    logout() { clearTimeout(this.subTimer); clearInterval(this.sessionTimer); Sync.stop(); if (global.Aside) Aside.unmount(); Store.setSession(null); this.user = null; Store.uid = null; Store.cid = ''; Store.account = null; this.current = null; $('#dialogs').innerHTML = ''; this.lastHash = ''; try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* fine */ } Auth.login(); },
    // Logout chosen by the user. Inside the Android app the portal is one of the app's screens, signed in by the app:
    // the app is told, logs out too and shows its login screen (PortalActivity, BlitzNative.logout)
    signOut() { this.logout(); Native.appLogout(); },
    identity() { return this.user.phone || this.user.email || ''; },
    shell() {
      $('#root').innerHTML =
        '<header class="appbar"><a class="brandmark" id="homeBtn" href="#dashboard" draggable="false" title="Dashboard">' + BRAND + '</a>' +
        '<nav class="nav" id="nav" aria-label="Main">' + navHtml() + '</nav>' +
        '<div class="bar-right">' + (Native.shell ? '' : '<span class="dlgroup" id="dlApp"><button class="navlink dl" id="dlAndroid" title="Download the BlitzBook Android app (APK)">' + icon('android') + '</button>' +
          '<button class="navlink dl" id="dlIos" title="BlitzBook on iPhone / iPad">' + icon('apple') + '</button></span>') +
        // What waits for this login: requests to approve, one's own that were decided, the policy to read (hr.js)
 '<button class="navlink fxb" id="fxBtn" title="Show amounts in another currency"></button>' +
        '<button class="navlink bell" id="bellBtn" title="Notifications">' + icon('bell') + '<span class="belln hidden" id="bellN"></span></button>' +
        '<button class="cochip" id="barCo" title="Switch company / Company Profile"><span class="avatar" id="barAv"></span><span class="nm" id="barSub"></span></button>' +
        // Whose login this is
        '<span class="userchip" id="barUser">' + icon('user') + '<span class="nm" id="barUserNm"></span></span>' +
        '<button class="navlink theme" id="themeBtn" title="Dark / light mode"></button>' +
        // Settings: the invoice's fields, shortcuts, users and roles, tab access, the businesses and their tabs, AI access (settings.js)
        (appOff('settings') ? '' : '<button class="navlink gear" id="gearBtn" data-tip="Settings" aria-label="Settings">' + icon('gear') + '</button>') +
        '<button class="navlink logout" id="logoutBtn" title="Logout">' + icon('logout') + '<span>Logout</span></button></div></header>' +
        '<main class="main" id="view"></main>';
      $('#homeBtn').onclick = (e) => { if (ownClick(e, e.currentTarget)) return; e.preventDefault(); this.go('dashboard'); };
      if ($('#dlAndroid')) { $('#dlAndroid').onclick = () => GetApp.android(); $('#dlIos').onclick = () => GetApp.ios(); }
      $('#themeBtn').onclick = () => Theme.toggle();
      if ($('#gearBtn')) $('#gearBtn').onclick = () => this.go('settings');
      $('#fxBtn').onclick = () => Currency.pick();
      $('#bellBtn').onclick = () => { if (global.HR && HR.bell) HR.bell(); };
      this.bellIds = null;
      Theme.apply();
      $('#barCo').onclick = () => { if (Companies.canSwitch()) Companies.switcher(); else Company.edit(false); };
      $('#logoutBtn').onclick = () => UI.confirm('Logout', 'Do you want to logout?', () => this.signOut(), 'Logout');
      $('#nav').dataset.keys = navKeys();
      this.wireNav();
      this.refreshBar();
      if (global.Aside) Aside.mount();
    },
    // The drop-down groups: open on hover with a mouse, on a tap otherwise; a click elsewhere, Escape, a resize
    // or a scroll closes them. The menu is positioned on the page so the scrolling bar on a phone does not clip it.
    wireNav() {
      const nav = $('#nav');
      $$('[data-go]', nav).forEach(el => el.onclick = (e) => { e.stopPropagation(); this.closeMenus(); if (ownClick(e, el)) return; e.preventDefault(); this.go(el.dataset.go, el.dataset.params ? JSON.parse(el.dataset.params) : undefined); });
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
      $('#barSub').textContent = (name || 'Set up company') + (Store.cid ? ' · ' + Companies.memberLabel() : '');
      $('#barAv').textContent = ((name || this.user.name || 'B').trim()[0] || 'B').toUpperCase();
      $('#barCo').title = Companies.canSwitch() ? 'Switch company / Company Profile' : 'Company Profile';
      // The currency the amounts are shown in, with its rate
      if ($('#fxBtn') && global.Currency) { Currency.apply(); const f = U.fx, b = $('#fxBtn'); b.textContent = f ? f.code : '₹'; b.classList.toggle('on', !!f); b.title = f ? 'Amounts are shown in ' + f.code + ' at 1 ' + f.code + ' = ' + U.inr(f.rate) + '. Tap to change.' : 'Show amounts in another currency'; }
      // The bell: how many notices wait; a toast when one arrives while the portal is open
      if ($('#bellN') && global.HR && HR.notices) {
        let l = []; try { l = HR.notices(); } catch (e) { l = []; }
        const n = $('#bellN'), ids = l.map(x => x.id), key = (Store.cid || 'own');
        n.textContent = l.length > 99 ? '99+' : String(l.length); n.classList.toggle('hidden', !l.length); $('#bellBtn').classList.toggle('on', l.length > 0);
        $('#bellBtn').title = l.length ? l.length + ' notification' + (l.length === 1 ? '' : 's') : 'Notifications';
        if (this.bellIds && this.bellIds.key === key) { const fresh = l.filter(x => !this.bellIds.ids.includes(x.id)); if (fresh.length) UI.toast(fresh.length === 1 ? fresh[0].title : fresh.length + ' new notifications', 6000); }
        this.bellIds = { key, ids };
      }
      const who = String(this.user.name || '').trim() || this.identity();
      $('#barUserNm').textContent = who; $('#barUser').title = 'Logged in as ' + who + (this.identity() && this.identity() !== who ? ' (' + this.identity() + ')' : '');
      // The company's own logo takes the place of the BlitzBook mark
      const mark = c.logo ? '<img class="cologo" src="' + esc(c.logo) + '" alt="' + esc(name || 'Dashboard') + '">' : BRAND, home = $('#homeBtn');
      if (home && home.dataset.logo !== (c.logo || '')) { home.dataset.logo = c.logo || ''; home.innerHTML = mark; }
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
      if ($('#gearBtn')) $('#gearBtn').classList.toggle('active', !!global.Settings && Settings.has(route));
      const top = on && on.closest('.navgrp') ? $('.grp', on.closest('.navgrp')) : on;
      if (top) nav.scrollLeft = top.offsetLeft - (nav.clientWidth - top.offsetWidth) / 2;
    },
    go(route, params) {
      const fn = this.routes[route];
      if (!fn || appOff(route)) { UI.toast('Screen not available: ' + route); if (!this.current && fn) this.go('dashboard'); return; }
      if (global.Currency) Currency.apply();
      if (global.Business && Business.routeOff(route, params)) { UI.hold = 0; UI.toast('This tab is turned off for this company (Settings > Businesses & Tabs)', 4000); if (!this.current) route = 'dashboard'; else return; }
      if (!Companies.mayOpen(route) || Companies.routeOff(route, params)) { UI.hold = 0; UI.toast('Your role in this company (' + Companies.roleLabel() + ') does not open this screen', 4000); if (!this.current) route = 'dashboard'; else return; }
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
      if (global.Currency) Currency.apply();
      this.refreshBar();
      if (keys.includes('company') || keys.includes('biz') || keys.includes('roles')) this.refreshNav(); // the Manpower tab follows the type of services business
      // Never redraw under a dialog or over an invoice being typed; those screens pick the data up when next opened
      if (this.current && this.current.route === 'invoice') return;
      if ($('#dialogs').children.length) { this.stale = true; return; }
      this.refresh();
    },
    // Every screen draws through here; the Recent panel beside it follows the screen (js/aside.js)
    view(html) { $('#view').innerHTML = html; if (global.Settings && this.current) Settings.strip($('#view'), this.current.route, this.current.params); if (global.Aside) Aside.render(this.current ? this.current.route : 'dashboard'); UI.rails($('#view')); return $('#view'); },
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

  /* The name of whatever carries data-tip, shown beside it while the mouse is over it or the keyboard is on it. Drawn on
     the page rather than with a ::after of the button: a list's frame scrolls sideways and would cut such a label off.
     Above the button when there is room, below it otherwise; gone on a click, a scroll, or when the pointer leaves. */
  const Tip = {
    el: null, on: null,
    show(t) {
      const text = t.getAttribute('data-tip'); if (!text) return;
      if (!this.el) { this.el = document.createElement('div'); this.el.className = 'tip'; this.el.setAttribute('role', 'tooltip'); }
      const el = this.el; el.textContent = text; el.classList.remove('show'); document.body.appendChild(el); this.on = t;
      const r = t.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, above = r.top - h - 8 >= 4;
      el.style.left = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 6)) + 'px';
      el.style.top = (above ? r.top - h - 8 : r.bottom + 8) + 'px';
      el.classList.toggle('below', !above); el.classList.add('show');
    },
    hide() { if (this.el) this.el.remove(); this.on = null; },
    init() {
      document.addEventListener('pointerover', e => { if (e.pointerType === 'touch') return; const t = e.target.closest && e.target.closest('[data-tip]'); if (t === this.on) return; if (t) this.show(t); else this.hide(); });
      document.addEventListener('pointerdown', () => this.hide(), true);
      document.addEventListener('focusin', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t && t.matches(':focus-visible')) this.show(t); });
      document.addEventListener('focusout', () => this.hide());
      window.addEventListener('scroll', () => this.hide(), true);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') this.hide(); });
    }
  };
  Tip.init();

  /* A small menu drawn on the page beside what opened it (a row's Actions button):
     items = [{ ic, svg, t, cls, disabled, run }]. Under the opener when there is room, above it otherwise; a click
     elsewhere, Escape, a scroll or a resize shuts it. Arrow keys move through it. */
  const Pop = {
    el: null, from: null,
    open(at, items) {
      this.close(); Tip.hide();
      const el = document.createElement('div'); el.className = 'popmenu'; el.setAttribute('role', 'menu');
      el.innerHTML = items.map((it, i) => it.sep ? '<div class="popsep"></div>' : '<button type="button" role="menuitem" class="popitem' + (it.cls ? ' ' + it.cls : '') + '" data-i="' + i + '"' + (it.disabled ? ' disabled' : '') + '>' + (it.svg || (it.ic ? icon(it.ic) : '<span class="ic"></span>')) + '<span>' + esc(it.t) + '</span></button>').join('');
      document.body.appendChild(el); this.el = el; this.from = at && at.nodeType ? at : null;
      const r = this.from ? this.from.getBoundingClientRect() : { left: at.x, right: at.x, top: at.y, bottom: at.y }, w = el.offsetWidth, h = el.offsetHeight;
      el.style.left = Math.max(6, Math.min(this.from ? r.right - w : r.left, window.innerWidth - w - 6)) + 'px';
      el.style.top = (r.bottom + 4 + h <= window.innerHeight - 6 ? r.bottom + 4 : Math.max(6, r.top - h - 4)) + 'px';
      if (this.from) this.from.setAttribute('aria-expanded', 'true');
      $$('.popitem', el).forEach(b => b.onclick = (e) => { e.stopPropagation(); const it = items[+b.dataset.i]; this.close(); if (it && it.run) it.run(); });
      el.addEventListener('keydown', e => { const l = $$('.popitem:not(:disabled)', el), i = l.indexOf(document.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); (l[i + 1] || l[0]).focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); (l[i - 1] || l[l.length - 1]).focus(); } });
    },
    close() { if (this.from) this.from.setAttribute('aria-expanded', 'false'); if (this.el) this.el.remove(); this.el = null; this.from = null; },
    init() {
      document.addEventListener('click', () => this.close());
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.el) { const f = this.from; this.close(); if (f) f.focus(); } });
      window.addEventListener('scroll', (e) => { if (this.el && !(e.target && e.target.closest && e.target.closest('.popmenu'))) this.close(); }, true);
      window.addEventListener('resize', () => this.close());
    }
  };
  Pop.init();

  /* The actions of a row are one drop-down: every list that puts icon buttons (UI.ibtn) in its last cell gets an
     "Actions" button there instead, and the buttons become the entries of its menu, each with its icon and name
     (choosing one presses the button, so the list's own wiring stays as it is). A row that carries the number of
     its entry as a link also gets Open (the number itself is a link: a right click on it is the browser's). Lists are drawn at many moments (a screen, a search, a
     reply from the server), so the cells are found as they appear. */
  const RowMenu = {
    queued: false,
    scan() {
      this.queued = false;
      $$('td.actions').forEach(td => {
        if (td.querySelector('.rmbtn') || !td.querySelector('.ibtn')) return;
        td.classList.add('has-menu');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm outline rmbtn'; b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); b.innerHTML = '<span>Actions</span><i class="caret"></i>';
        td.appendChild(b);
        b.onclick = (e) => { e.stopPropagation(); if (Pop.from === b) return Pop.close(); Pop.open(b, this.items(td)); const f = $('.popitem:not(:disabled)', Pop.el); if (f && e.detail === 0) f.focus(); };
      });
    },
    items(td) {
      const tr = td.closest('tr'), a = tr && $('a.nolink', tr);
      const own = $$('.ibtn', td).map(x => ({ svg: x.innerHTML, t: x.dataset.tip || x.getAttribute('aria-label') || '', cls: x.classList.contains('danger') ? 'danger' : '', disabled: x.disabled, run: () => x.click() }));
      return (a ? [{ ic: 'arrow', t: 'Open ' + a.textContent.trim(), run: () => a.click() }, { sep: true }] : []).concat(own);
    },
    init() { new MutationObserver(() => { if (this.queued) return; this.queued = true; Promise.resolve().then(() => this.scan()); }).observe(document.body, { childList: true, subtree: true }); }
  };
  if (document.body) RowMenu.init(); else document.addEventListener('DOMContentLoaded', () => RowMenu.init());

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
  const TERMS_VERSION = '2026-11';
  const TERMS = [
    ['1. What BlitzBook is', 'BlitzBook (blitzbook.co.in, the Android app and the web portal) is a software tool for tax invoicing, accounts, stock, payroll and reports. It can be set up for a business in India (GST), the United Arab Emirates (VAT), the United States (sales tax) or Australia (GST). It is provided by its developer "as is" for you to run your own business records.'],
    ['2. Your data belongs to you', 'Everything you enter or create - company profile, customers, suppliers, items, invoices, challans, purchases, receipts, payments, journal entries, employees, payslips and reports - is your property. blitzbook.co.in claims no ownership of it, and nothing in these books belongs to blitzbook.co.in or its developer.'],
    ['3. Documents are issued by you, not by blitzbook.co.in', 'Every invoice, bill, voucher, note, payslip or report produced here is issued by you, in your business\'s name, under your own tax registration (GSTIN, TRN, ABN, EIN or sales tax permit) and your signature. blitzbook.co.in is not a party to any sale, purchase, payment or employment recorded here and does not stand behind, guarantee or endorse any of them.'],
    ['4. Country and taxes', 'The country you choose in the Company Profile sets what the tax is called, how it is worked out, the currency of the books and the tax rates offered. These are a starting point only. Tax rates, rules, thresholds, forms and filing dates differ by country, state and kind of business and change over time; BlitzBook may not reflect the latest ones. You choose the rate on every line, and you must make sure it is the right one.'],
    ['5. You are responsible for what you record', 'You alone are responsible for the accuracy of the figures, tax numbers, item codes, tax rates, amounts, due dates and returns prepared with BlitzBook, and for filing them with the tax authority of your country (for example the GST portal, the FTA, the IRS and state revenue departments, or the ATO) on time. The return summaries are working papers, not filed returns. BlitzBook does not provide tax, legal or accounting advice; check anything you are unsure of with a qualified accountant or tax adviser in your country.'],
    ['6. Currencies and exchange rates', 'The books are kept in the currency of the country chosen. Exchange rates are typed by you or fetched from a public source, are indicative only and may differ from the rate your bank or tax authority uses.'],
    ['7. Keep your own backups', 'Your books live in this browser and, with sync, on the account\'s server space. Use Export / Import regularly. blitzbook.co.in is not liable for any loss of data, lost profit, penalty, interest or other loss arising from the use of, or inability to use, the software, to the extent the law allows.'],
    ['8. Your account', 'Keep your password safe. You are responsible for everything done under your login and for the people you give a role in your company. One person, one account; do not share accounts.'],
    ['9. AI assistants and connectors', 'Under AI Access you can make API keys that let an AI assistant or other tool (for example ChatGPT, Claude, Gemini or Copilot) read your books, or read and write them. Those tools are run by other companies under their own terms and privacy policies; what you send them leaves BlitzBook. Anyone who holds a key can use it, so keep it like a password and revoke it when it is no longer needed. Whatever an assistant reads, says or enters with your key is your responsibility: check its answers and every entry it makes.'],
    ['10. Subscription', 'The trial and paid plans give access to the software for their term. Fees are not refundable once a plan has started, except where the law of your country says otherwise. Features may be added, changed or withdrawn as the software develops.'],
    ['11. Privacy', 'Your books are not sold or passed to anyone. Account details (name, mobile, email) are used only to run your account, send OTPs and activation codes, and to tell you about BlitzBook itself. Shortcuts, column widths and similar settings are kept on your own device.'],
    ['12. Acceptable use', 'Do not use BlitzBook to issue false invoices, evade tax, or record transactions that are not real. Such use is entirely your own responsibility and may lead to the account being closed.'],
    ['13. Changes and law', 'These terms may be updated; you will be asked to accept a new version when that happens. They are governed by the laws of India, where blitzbook.co.in is based. Rights that the consumer or tax law of your own country gives you and that cannot be set aside by agreement are not affected.']
  ];
  const Terms = {
    accepted(uid) { return Store.peek(uid, 'terms', '') === TERMS_VERSION; },
    show(uid, onAccept, onDecline) {
      const bg = UI.modal({ title: 'Terms & Conditions', cancelable: false, focus: false,
        body: '<p class="terms-intro">Please read and accept these terms before you start. In short: the books you keep here are yours; nothing in them belongs to blitzbook.co.in, which only supplies the software.</p>' +
          '<div class="terms-body" data-asis>' + TERMS.map(t => '<h4>' + esc(t[0]) + '</h4><p>' + esc(t[1]) + '</p>').join('') + '<div class="terms-ver">Version ' + TERMS_VERSION + ' &middot; blitzbook.co.in</div></div>' +
          '<div class="terms-agree">' + UI.check('tAgree', 'I have read and accept the Terms & Conditions', false) + '</div>',
        buttons: [{ label: 'Decline', cls: 'outline', onClick: () => { if (onDecline) onDecline(); } },
                  { label: 'Accept & Continue', onClick: (bg) => { if (!UI.val('tAgree', bg)) return false; Store.poke(uid, 'terms', TERMS_VERSION); if (onAccept) onAccept(); } }] });
      const ok = $$('.mf .btn', bg)[1]; ok.disabled = true;
      $('#tAgree', bg).addEventListener('change', e => { ok.disabled = !e.target.checked; });
      return bg;
    }
  };
  const FEATURES = [['receipt', 'Tax invoices worked out for you: GST in India and Australia, VAT in the UAE, sales tax in the US'], ['box', 'Sales, purchases, expenses, journal and stock in one place'], ['pie', 'Profit & Loss and Balance Sheet whenever you need them'], ['sync', 'The same books in the BlitzBook app and here, kept in step']];
  const Auth = {
    // Login / register page: brand showcase on the left (wide screens), the form box on the right
    frame(inner, tagline) {
      $('#root').innerHTML = '<div class="auth"><section class="auth-art"><span class="orb o1"></span><span class="orb o2"></span><div class="brandline">' + BRAND + '</div>' +
        '<h1>Billing is<br><em>beautifully simple.</em></h1><p>Raise invoices in seconds, keep every purchase and expense in order, and see where your business stands.</p>' +
        '<ul class="feats">' + FEATURES.map(f => '<li><span class="fi">' + icon(f[0]) + '</span>' + esc(f[1]) + '</li>').join('') + '</ul></section>' +
        '<section class="auth-pane"><span class="orb o3"></span><span class="orb o4"></span><div class="auth-brand"><span class="logo big">' + icon('bolt') + '</span><div class="name">Blitz<b>Book</b></div><div class="line">' + esc(tagline || 'Tax invoices, accounts, stock & payroll - in a blitz') + '</div></div>' +
        '<div class="box">' + inner + '</div><div class="chips"><span>GST · VAT · Sales Tax</span><span>Accounts &amp; Stock</span><span>Payroll</span></div><div class="contact">Contact : <a href="mailto:info@blitzbook.co.in">info@blitzbook.co.in</a></div><div class="foot">blitzbook.co.in</div></section>' +
        '<button class="theme-fab" id="themeFab" title="Dark / light mode"></button></div>';
      $('#themeFab').onclick = () => Theme.toggle();
      // The eye beside a password field shows or hides what is typed
      $$('.ifield .eye').forEach(b => b.onclick = () => { const i = $('#' + b.dataset.eye); const shown = i.type === 'text'; i.type = shown ? 'password' : 'text'; b.innerHTML = icon(shown ? 'eye' : 'eyeoff'); b.title = shown ? 'Show password' : 'Hide password'; i.focus(); });
      Theme.apply();
    },
    // A pill input with a leading icon (and an eye for a password)
    // #join?e=..&p=..&n=..&c=..&r=..: the invitation link (Companies.joinLink)
    joinFromHash() { const m = /^#join\?(.*)$/.exec(location.hash || ''); if (!m) return null; const q = new URLSearchParams(m[1]), j = {}; ['e', 'p', 'n', 'c', 'r'].forEach(k => { j[k] = String(q.get(k) || '').trim(); }); j.e = j.e.toLowerCase(); return j.e || j.p ? j : null; },
    pendingJoin() { try { return JSON.parse(localStorage.getItem('blitzbook.join') || 'null'); } catch (e) { return null; } },
    rememberJoin(j) { try { if (j) localStorage.setItem('blitzbook.join', JSON.stringify(j)); else localStorage.removeItem('blitzbook.join'); } catch (e) { /* storage blocked */ } },
    joinBanner() { const j = this.pendingJoin(); return j ? '<div class="joinnote">' + icon('users') + '<span><b>' + esc(j.c || 'A company') + '</b> added you' + (j.r ? ' as ' + esc(Companies.ROLE_LABEL[j.r] || j.r) : '') + '. ' + (j.hasAccount ? 'Log in' : 'Register') + ' with <b>' + esc(j.e || j.p) + '</b> to open it.</span></div>' : ''; },
    // Where an invitation link lands: Login when the identity has an account, Register with the details filled in otherwise
    async start(j) {
      // The server says whether the identity has an account; this browser's own list only when it cannot be asked
      let has = !!Store.findUser(j.e || j.p);
      try { if (await Sync.ready()) { const r = await Sync.call('exists', { identity: j.e || j.p }); has = !!(r && r.exists); } } catch (e) { /* no server to ask: this browser's list */ }
      j.hasAccount = has; this.rememberJoin(j);
      if (has) { this.login(); $('#lId').value = j.e || j.p; $('#lPw').focus(); }
      else { this.register(); if (j.n) $('#rName').value = j.n; if (j.p) { const sp = U.splitPhone(j.p); $('#rCc').value = sp.country; $('#rCc').onchange(); $('#rPhone').value = sp.national; } if (j.e) $('#rEmail').value = j.e; $(j.n && j.p ? '#rPw' : j.n ? '#rPhone' : '#rName').focus(); }
    },
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
      Auth.frame(Auth.joinBanner() + '<div class="ghead">Welcome back</div><div class="tag">Sign in to open your books</div>' +
        Auth.ifield('lId', 'user', 'Mobile number or email', { attrs: ' autocomplete="username" title="Outside India: the mobile number with its country code (+971 ...), or the email"' }) + Auth.ifield('lPw', 'lock', 'Password', { type: 'password', attrs: ' autocomplete="current-password"' }) +
        '<div class="links right"><button class="link" id="lReset">Forgot password?</button></div>' +
        '<button class="btn block" id="lGo">Login</button>' +
        '<div class="divider"><span>new here?</span></div><button class="btn block outline" id="lReg">Create a free account</button><div class="note">30 days free &middot; no card needed</div>');
      let busy = false;
      const go = async () => {
        if (busy) return;
        const id = U.identity(UI.val('lId')), pw = UI.val('lPw');
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
      const to = [r.to && r.to.phone ? (String(r.to.phone).startsWith('+') ? r.to.phone : '+91 ' + r.to.phone) : '', r.to && r.to.email ? r.to.email : ''].filter(Boolean).join(' and ');
      return 'A 6-digit OTP was sent to ' + to + '. It is valid for 10 minutes.' + (r.to && r.to.email ? '\n\nThe mail comes from info@blitzbook.co.in. Not in the inbox? Check the spam folder.' : '');
    },
    // With the hosted server (Supabase) an OTP is always a real one, mailed from info@blitzbook.co.in. When that server
    // cannot be reached nothing is made up here: the person is told, and how to get through. (A test OTP shown on
    // screen is only for a portal without a server, or with a sync server of one's own that is not answering.)
    hosted() { return !!(Sync.isSupabase && Sync.isSupabase()); },
    unreachable() {
      UI.alert('Cannot reach the BlitzBook server', 'The OTP could not be sent because this device cannot reach the BlitzBook server.\n\n' +
        '1. Check the internet connection and try again.\n' +
        '2. Some internet providers block the server. In Chrome or Edge switch on Settings > Privacy and security > Security > Use secure DNS (choose Cloudflare 1.1.1.1), then reload this page. Mobile data or another network also works.\n\n' +
        'The OTP is mailed from info@blitzbook.co.in once the server is reached.');
    },
    register() {
      Auth.frame(Auth.joinBanner() + '<div class="ghead">Create Account</div><div class="tag">Register and use BlitzBook free for 30 days</div>' +
        Auth.ifield('rName', 'user', 'Full name', { attrs: ' autocomplete="name"' }) +
        // The country of the mobile number: an Indian number is ten digits, any other is kept with its country code.
        // It is also the country the books start in (Company Profile, where it can be changed).
        '<div class="ccrow"><select id="rCc" title="Country" aria-label="Country">' + U.DIAL.map(d => '<option value="' + d[0] + '">' + esc(d[1]) + (d[2] ? ' (+' + d[2] + ')' : '') + '</option>').join('') + '</select>' +
        Auth.ifield('rPhone', 'phone', 'Mobile number (10 digits)', { type: 'tel', attrs: ' maxlength="10" inputmode="tel" autocomplete="tel"' }) + '</div>' +
        Auth.ifield('rEmail', 'mail', 'Email address', { type: 'email', attrs: ' autocomplete="email"' }) + Auth.ifield('rPw', 'lock', 'Password', { type: 'password', attrs: ' autocomplete="new-password"' }) +
        '<div class="hint" id="rHint">6+ characters with a letter, a number and a special character. The OTP and your activation codes go to the mobile number and the email.</div>' +
        '<div id="otpBox" class="hidden">' + Auth.ifield('rOtp', 'key', 'Enter the 6-digit OTP', { attrs: ' maxlength="6" inputmode="numeric"' }) + '</div>' +
        '<button class="btn block" id="rSend">Send OTP</button><div class="links"><button class="link hidden" id="rResend">Resend OTP</button></div>' +
        '<div class="note">By registering you will be asked to accept the Terms &amp; Conditions: the books you keep are yours; nothing in them belongs to blitzbook.co.in.</div>' +
        '<div class="links"><button class="link" id="rBack">Already registered? Login</button></div>', 'Create your account - 30 days free');
      // viaServer: the OTP was issued by the sync server, which also checks it. Otherwise (no server, or the
      // server could not be reached) the browser makes a test OTP and the account is created here.
      let code = '', otpPhone = '', otpEmail = '', busy = false, viaServer = false;
      // The mobile box follows the country: ten digits for India, the number without its country code for the others,
      // the whole number with + and the code for a country that is not in the list
      const HINT = $('#rHint').textContent;
      const ccShow = () => { const cc = $('#rCc').value, home = cc === 'IN', p = $('#rPhone'); p.placeholder = home ? 'Mobile number (10 digits)' : cc ? 'Mobile number, without +' + U.REGIONS[cc].dial : 'Mobile number with + and the country code'; p.maxLength = home ? 10 : 18; $('#rHint').textContent = home ? HINT : '6+ characters with a letter, a number and a special character. Outside India the OTP comes by email, and you log in with the email or the mobile number with its country code.'; };
      $('#rCc').onchange = ccShow; ccShow();
      // The number as it is kept for the account: '' while what is typed cannot be one
      const phoneOf = () => U.accountPhone($('#rCc').value, UI.val('rPhone'));
      const step2 = () => { $('#otpBox').classList.remove('hidden'); $('#rResend').classList.remove('hidden'); $('#rSend').textContent = 'Verify & Register'; $('#rSend').onclick = verify; $('#rOtp').value = ''; $('#rOtp').focus(); };
      const localOtp = (phone) => { viaServer = false; code = otp(); UI.alert('OTP Sent', 'OTP sent to ' + U.showPhone(phone) + '\n\n(Test mode) Your 6-digit OTP is: ' + code); step2(); };
      const send = async () => {
        if (busy) return;
        const name = UI.val('rName').trim(), phone = phoneOf(), email = UI.val('rEmail').trim().toLowerCase(), pw = UI.val('rPw');
        if (!name) return UI.toast('Enter your name');
        if (!Auth.validPassword(pw)) return UI.toast('Password needs 6+ characters with a letter, digit and special character');
        if (!phone) return UI.toast($('#rCc').value === 'IN' ? 'Enter a valid 10-digit mobile number' : $('#rCc').value ? 'Enter a valid mobile number for ' + U.REGIONS[$('#rCc').value].name + ', without the country code' : 'Enter the mobile number with + and its country code, for example +44 7700 900123', 5000);
        if (!email) return UI.toast('Enter your email: the OTP is sent to it');
        if (!U.isValidEmail(email)) return UI.toast('Enter a valid email');
        // The server decides whether the number / email has an account: the copy this browser kept of an account that
        // was removed there must not stand in the way. Only without a server does this browser's own list decide.
        const known = !!(Store.findUser(phone) || Store.findUser(email)), taken = () => UI.toast('This mobile number or email is already registered on this browser. Please login.', 5000);
        busy = true; $('#rSend').disabled = true;
        try {
          otpPhone = phone; otpEmail = email;
          // A ping that failed earlier (the page was opened offline) is asked again before giving up
          if (!(await Sync.ready()) && !(Auth.hosted() && await Sync.recheck())) { if (Auth.hosted()) Auth.unreachable(); else if (known) taken(); else localOtp(phone); return; }
          try {
            const r = await Sync.call('otp', { purpose: 'register', phone, email });
            viaServer = true; code = '';
            UI.alert('OTP Sent', Auth.otpSentText(r, U.showPhone(phone)));
            step2();
          } catch (e) {
            if (e.status === 409) { UI.toast('This mobile number or email already has an account. Please login.', 5000); return; }
            if (e.status) { UI.toast(e.message, 6000); return; }
            if (Auth.hosted()) { Sync.pinged = null; Auth.unreachable(); }
            else if (known) taken(); else localOtp(phone); // a sync server of one's own, unreachable: the account is created here and joins the server later
          }
        } finally { busy = false; $('#rSend').disabled = false; }
      };
      const verify = async () => {
        if (busy) return;
        const name = UI.val('rName').trim(), phone = phoneOf(), email = UI.val('rEmail').trim().toLowerCase(), entered = UI.val('rOtp').trim();
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
          const users = Store.users(), same = (x) => x.phone === phone || (x.email || '').toLowerCase() === email;
          // A copy this browser kept of the same number / email (its account was removed on the server and is now
          // registered again): that record carries on with the new details, and its books meet the server afresh
          let u = users.find(same);
          if (u) {
            if (!token) { UI.toast('This mobile number or email is already registered on this browser. Please login.', 5000); return; }
            Object.assign(u, { name, phone, email, password: h, createdAt });
            users.forEach(x => { if (x !== u && same(x)) { if (x.phone === phone) x.phone = ''; if ((x.email || '').toLowerCase() === email) x.email = ''; } });
            Store.poke(u.id, 'sync', {});
          } else { u = { id: (users.reduce((m, x) => Math.max(m, x.id), 0) + 1), name, phone, email, password: h, createdAt }; users.push(u); }
          Store.saveUsers(users);
          // The books of a new account start in the country it registered from (Company Profile asks for the rest)
          { const cc = $('#rCc') ? $('#rCc').value : 'IN'; if (cc && cc !== 'IN' && U.REGIONS[cc] && !Store.peek(u.id, 'company', null)) Store.poke(u.id, 'company', { country: cc, fyMonth: U.fyMonthFor(cc) }); }
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
          identity = U.identity(UI.val('xId', bg));
          if (!identity) { UI.toast('Enter the registered mobile number or email'); return false; }
          user = Store.findUser(identity);
          btn.disabled = true;
          try {
            if (await Sync.ready() || (Auth.hosted() && await Sync.recheck())) {
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
            if (Auth.hosted()) { Sync.pinged = null; Auth.unreachable(); return false; }
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
    // The cards of At a glance in the order chosen for them; each card is its HTML, known by its data-key and data-name
    const glance = (cards) => ordered(cards.filter(Boolean), Store.get('glance_order', []), { key: h => (/data-key="([^"]*)"/.exec(h) || [])[1], name: h => (/data-name="([^"]*)"/.exec(h) || [])[1] || '', count: () => 0 }).join('');
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
    const latest = [], sold = new Map(); invs.forEach(i => i.items.forEach(it => { const d = String(it.desc || '').trim(); if (!d) return; sold.set(d.toLowerCase(), (sold.get(d.toLowerCase()) || 0) + 1); if (latest.length < 8 && !latest.some(r => r.toLowerCase() === d.toLowerCase())) latest.push(d); }));
    // The last eight products sold, in the order chosen for them (a product sold since goes in front of a dragged order)
    const recent = ordered(latest, Store.get('recent_order', []), { key: r => r.toLowerCase(), name: r => r, count: r => sold.get(r.toLowerCase()) || 0, newFirst: true });
    // Arrange, Sort and (once an order was chosen) Reset order beside a heading
    const tools = (pre, key) => '<span class="tilehint"><button class="link small" id="' + pre + 'Arrange">Arrange</button> · <button class="link small" id="' + pre + 'Sort">Sort</button>' + (orderSet(Store.get(key, [])) ? ' · <button class="link small" id="' + pre + 'Reset">Reset order</button>' : '') + '</span>';
    const stat = (id, ic, a, b, k, v, s, go) => '<div class="stat' + (go ? ' tap' : '') + '" data-key="' + id + '" data-name="' + esc(k) + '" style="--a:' + a + ';--b:' + b + '"' + (go ? ' data-go="' + go + '" role="button" tabindex="0" title="Tap for ageing"' : '') + '><div class="ic-badge">' + icon(ic) + '</div><div class="meta"><div class="k">' + k + '</div><div class="v" id="' + id + '">' + v + '</div><div class="s">' + esc(s) + '</div></div></div>';
    const root = App.view(
      '<section class="hero"><span class="orb o1"></span><span class="orb o2"></span>' +
      '<div class="art" aria-hidden="true"><div class="sheet s1"><i></i><i></i><i></i><i></i><u></u></div><div class="sheet s2"><i></i><i></i><i></i><i></i><u></u></div><div class="coin">₹</div></div>' +
      '<div class="greet">' + esc(greet) + '</div><h1 class="co">' + esc(c.name || 'Set up your Company Profile') + '</h1>' +
      '<div class="chips"><span class="chip">' + (c.gstin ? 'GSTIN ' + esc(c.gstin) : 'No GSTIN') + '</span><span class="chip">' + esc(U.activityText(c)) + '</span>' +
      // Whose login this is (the top bar says it too; on a phone there is no room for the name there)
      '<span class="chip" id="heroUser">Logged in: ' + esc(String(App.user.name || '').trim() || App.identity()) + '</span>' +
      // Which company of the account is open, with the group and the role there; the chip switches companies
      (co && co.group_name ? '<span class="chip">' + esc(co.group_name) + '</span>' : '') + (Store.cid ? '<span class="chip">' + esc(Companies.memberLabel()) + (co && co.owner_name ? ' · ' + esc(co.owner_name) : '') + '</span>' : '') +
      (Companies.canSwitch() ? '<button class="chip tap" id="coSwitch" title="Switch company">Switch company ▾</button>' : '') + '</div>' +
      (Companies.mayOpen('invoice') ? '<div class="cta"><button class="btn light" data-go="invoice">' + icon('plus') + 'New Invoice</button><button class="btn ghost" data-go="sales">View Sales' + icon('arrow') + '</button></div>' : '<div class="cta"><button class="btn light" data-go="clock">' + icon('clock') + 'Web Clock</button></div>') + '</section>' +
      (recent.length ? '<div class="section-title">Recent products' + (recent.length > 1 ? tools('rec', 'recent_order') : '') + '</div><div class="recent" id="recentRow">' + recent.map(r => '<button data-item="' + esc(r) + '">' + esc(r) + '</button>').join('') + '</div>' : '') +
      '<div class="section-title">What would you like to do?' + tools('tile', 'tile_order') + '</div><div class="tiles dash" id="tiles">' +
      tileList().map(t => { const h = tileHref(t.key), tag = h ? 'a' : 'button'; return '<' + tag + (h ? ' href="' + esc(h) + '" draggable="false"' : '') + ' class="tile" data-go="' + t.key + '" style="--a:' + t.a + ';--b:' + t.b + '"><span class="badge">' + icon(t.ic) + '</span><span class="tx"><span class="t">' + esc(t.t) + '</span></span><span class="go">' + icon('arrow') + '</span></' + tag + '>'; }).join('') + '</div>' +
      // The month's figures close the page (not for an HR member, who sees nothing of the books)
      (['hr', 'manager', 'employee'].includes(Companies.role()) ? '' : '<div class="section-title">At a glance' + tools('gl', 'glance_order') + '</div><div class="stats" id="glance">' + glance([stat('stSales', 'rupee', '#4F46E5', '#818CF8', 'Sales this month', U.money(salesMonth), now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })),
      stat('stCount', 'receipt', '#059669', '#34D399', 'Invoices', month.length, 'Raised this month'),
      (Sub.isLite() ? stat('stPack', 'star', '#B45309', '#F59E0B', 'Invoices left', Sub.invoicesLeft() + ' of ' + Sub.invoiceQuota(), (Sub.packUntil() ? 'Use by ' + U.pad(new Date(Sub.packUntil()).getDate()) + '/' + U.pad(new Date(Sub.packUntil()).getMonth() + 1) + '/' + new Date(Sub.packUntil()).getFullYear() : 'In your invoice pack') + ' · credit and debit notes count · tap to buy more or upgrade', 'subscription')
        : stat('stCredit', 'wallet', '#EA580C', '#FBBF24', 'Credit outstanding', U.money(credit), open.length ? 'Due on ' + open.length + ' invoice' + (open.length === 1 ? '' : 's') + ' · tap for ageing' : 'Nothing due on credit invoices', 'aging')),
      (Sub.isLite() || Companies.role() === 'sales' ? '' : stat('stPayable', 'cart', '#BE123C', '#F43F5E', 'Payable to suppliers', U.money(payable), bills.length ? 'Owed on ' + bills.length + ' bill' + (bills.length === 1 ? '' : 's') + (overdueBills ? ', ' + overdueBills + ' overdue' : '') + ' · tap for ageing' : 'Nothing owed on credit purchases', 'payables'))]) + '</div>'));
    countUp($('#stSales'), salesMonth, U.money); countUp($('#stCount'), month.length, v => String(Math.round(v))); countUp($('#stCredit'), credit, U.money); if ($('#stPayable')) countUp($('#stPayable'), payable, U.money);
    if ($('#coSwitch')) $('#coSwitch').onclick = () => Companies.switcher();
    $$('[data-go]', root).forEach(el => el.onclick = (e) => {
      const k = el.dataset.go;
      if (ownClick(e, el)) return;   // a new tab or window: the browser opens the tile's address
      e.preventDefault();
      if (el.classList.contains('tile')) used('tile:' + k);
      if (k === 'reports') {
        // Only the reports the role may open (a sales member gets the sales side)
        const all = [['Day Transactions', 'daybook'], ['Sales Report', 'salesReport'], ['Outstanding & Ageing', 'aging'], ['Supplier Outstanding', 'payables'], ['Party Ledger', 'ledger'], ['Bank Statement', 'bankstmt'], ['Profit & Loss', 'pnl'], ['Balance Sheet', 'balance'], ['Stock in Hand', 'stock'], ['Group Statements', 'group']].filter(r => Companies.mayOpen(r[1]));
        if (Sub.isLite()) App.go('salesReport'); else UI.menu('Reports', all.map(r => r[0]), (i) => App.go(all[i][1]));
      }
      else if (k === 'items') { if (global.Inv && Companies.mayOpen('inventory')) App.go('inventory', { tab: 'overview' }); else App.go('items'); }
      else if (k === 'cnotes') App.go('notes', { kind: 'CN' });
      else if (k === 'dnotes') App.go('notes', { kind: 'DN' });
      else if (k === 'customers') App.go('contacts', { type: 'Customer' });
      else if (k === 'suppliers') App.go('contacts', { type: 'Supplier' });
      else if (k === 'receipts') App.go('money', { kind: 'receipt' });
      else if (k === 'payments') App.go('money', { kind: 'payment' });
      else if (k === 'hr' && !HR.allowed()) HR.lock();
      else if (k === 'hr') UI.menu('HR & Payroll', ['Employees', 'Web Clock', 'Attendance', 'Leave', 'Timesheets', 'Reimbursements', 'Payroll', 'HR Settings'], (i) => App.go(['employees', 'clock', 'attendance', 'leave', 'timesheets', 'reimbursements', 'payroll', 'hrsettings'][i]));
      else App.go(k);
    });
    // Dragging the tiles into another order; the order belongs to this account on this device
    /* Every heading of the dashboard has the same three: Arrange (drag into an order of one's own; with a mouse a
       thing can be dragged straight away), Sort (a ready order) and Reset order. The order belongs to this account on
       this device. pre = the id prefix of its buttons, key = where the order is kept. */
    const section = (pre, key, grid, sel, keyOf, sorts, what) => {
      if (!grid || !$('#' + pre + 'Arrange')) return;
      /* In Arrange mode every thing has a × that takes it off the dashboard (kept in <section>_hidden, like the
         order); "Removed (n)" beside the heading brings one or all of them back. */
      const hideKey = key.replace('_order', '_hidden'), hidden = (Store.get(hideKey, []) || []).slice(), gone = [];
      const nameOf = (el) => el.dataset.name || el.dataset.item || ($('.t', el) || el).textContent.trim();
      const removedLink = () => {
        let b = $('#' + pre + 'Hidden');
        if (!gone.length) { if (b) { b.previousSibling.remove(); b.remove(); } return; }
        if (!b) { $('#' + pre + 'Arrange').parentNode.insertAdjacentHTML('beforeend', ' · <button class="link small" id="' + pre + 'Hidden" title="Bring back what was removed"></button>'); b = $('#' + pre + 'Hidden'); }
        b.textContent = 'Removed (' + gone.length + ')';
        b.onclick = () => UI.menu('Bring back to the dashboard', gone.map(g => g[1]).concat(gone.length > 1 ? ['Bring back all'] : []), (i) => {
          const back = i < gone.length ? [gone[i][0]] : gone.map(g => g[0]);
          Store.set(hideKey, hidden.filter(k => !back.includes(k)), true); App.go('dashboard'); UI.toast(back.length > 1 ? 'All brought back' : gone[i][1] + ' is back');
        });
      };
      Array.from(grid.children).forEach(el => {
        const k = keyOf(el);
        if (hidden.includes(k)) { gone.push([k, nameOf(el)]); el.remove(); }
        else el.insertAdjacentHTML('beforeend', '<span class="dash-x" role="button" aria-label="Remove" title="Remove from the dashboard">×</span>');
      });
      removedLink();
      grid.addEventListener('pointerdown', e => { if (e.target.closest('.dash-x')) e.stopImmediatePropagation(); }, true);
      grid.addEventListener('click', e => {
        const x = e.target.closest('.dash-x'); if (!x) return;
        e.stopImmediatePropagation(); e.preventDefault();
        const el = x.closest(sel), k = keyOf(el);
        hidden.push(k); gone.push([k, nameOf(el)]); Store.set(hideKey, hidden, true); el.remove(); removedLink();
        UI.toast(nameOf(el) + ' removed · "Removed" beside the heading brings it back', 3500);
      }, true);
      arrangeTiles(grid, (keys) => { Store.set(key, keys, true); if (!$('#' + pre + 'Reset')) UI.toast(what.charAt(0).toUpperCase() + what.slice(1, -1) + ' order saved'); }, sel, keyOf);
      $('#' + pre + 'Arrange').onclick = () => { const on = grid.classList.toggle('arrange'); $('#' + pre + 'Arrange').textContent = on ? 'Done' : 'Arrange'; if (on) UI.toast('Drag the ' + what + ' into the order you want or tap × to remove one, then tap Done', 4000); };
      $('#' + pre + 'Sort').onclick = () => { const cur = Store.get(key, []); UI.menu('Sort the ' + what, sorts.map(s => s[1]), (i) => { Store.set(key, sorts[i][0], true); App.go('dashboard'); UI.toast(sorts[i][1]); }, typeof cur === 'string' ? sorts.findIndex(s => s[0] === cur) : orderSet(cur) ? -1 : 0); };
      if ($('#' + pre + 'Reset')) $('#' + pre + 'Reset').onclick = () => { Store.set(key, [], true); App.go('dashboard'); UI.toast('Standard order restored'); };
    };
    section('tile', 'tile_order', $('#tiles', root), '.tile', (t) => t.dataset.go, SORTS, 'tiles');
    section('rec', 'recent_order', $('#recentRow', root), 'button', (b) => b.dataset.item.toLowerCase(), [['', 'Latest first'], ['az', 'A to Z'], ['used', 'Most sold first']], 'products');
    section('gl', 'glance_order', $('#glance', root), '.stat', (s) => s.dataset.key, SORTS.slice(0, 2), 'cards');
    $$('[data-item]', root).forEach(el => el.onclick = () => App.go('invoice', { quickItem: el.dataset.item }));
  };

  // ------------------------------------------------------------ company profile
  const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  const Company = {
    // draft: what was typed before the country was changed (the form is drawn again in the new country's words)
    edit(firstTime, draft) {
      const c = Object.assign(Store.company(), draft || {}), R = U.region(), home = R.code === 'IN';
      const body = '<div class="grid2">' +
        UI.field('Country', UI.select('cCountry', U.COUNTRIES, R.code), { req: true, span: true, hint: 'The country the books are kept in. It sets the name of the tax and how it is worked out, the tax number, the currency, the states and the usual tax rates. Choosing another country draws this form again.' }) +
        UI.field('Company Name', UI.input('cName', c.name), { req: true, span: true }) +
        UI.field('GSTIN', UI.input('cGstin', c.gstin, { placeholder: '15 characters, e.g. 37ABCDE1234F1ZZ', attrs: ' maxlength="15" style="text-transform:uppercase"' }), { req: true }) +
        UI.field('GST Registration Type', UI.select('cType', U.GST_REG_TYPES, c.gstType === 'Composition' && !home ? 'Regular' : c.gstType), { req: true }) +
        // Outside India: where the business is, and the tax rates to choose from on an invoice
        (home ? '' : UI.field(R.stateWord, UI.select('cHome', U.STATES, U.matchState(c.homeState, '') || U.STATES[0]), { hint: 'Where the business is. A new customer starts in it.' }) +
          UI.field('Tax Rates Offered (%)', UI.input('cRates', c.taxRates || R.rates.join(', '), { placeholder: R.rates.join(', ') }), { hint: 'The rates to choose from on an invoice, separated by commas. The first one that is the usual rate of the country is put on a new line.' })) +
        UI.field('Line of Activity (Optional)', UI.select('cAct', U.LINE_OF_ACTIVITIES, c.activity, { blank: 'Select Line of Activity' }), { hint: 'The main business: it decides how the invoice looks. Tick every other business of the company under Other Lines of Activity below.' }) +
        // A Food and Beverages business says what it does: only a restaurant bills by table and steward
        '<div class="field" id="cSubBox"' + (c.activity === U.FNB_ACTIVITY ? '' : ' style="display:none"') + '><label>Type of Food &amp; Beverages Business</label>' + UI.select('cSub', U.FNB_TYPES, c.activitySub || 'Restaurant') + '<div class="hint">A restaurant gets the table, steward and thermal receipt; trading and distribution get the dispatch details</div></div>' +
        // A Services business says what it does: a manpower and staffing agency bills staff-wise
        '<div class="field" id="cSvcBox"' + (c.activity === U.SERVICE_ACTIVITY ? '' : ' style="display:none"') + '><label>Type of Services Business</label>' + UI.select('cSvc', U.SERVICE_TYPES, c.serviceType || U.SERVICE_TYPES[0]) + '<div class="hint">Manpower and staffing: the invoice lists the staff deployed with employee ID, designation, days or hours worked, rate, amount and advances</div></div>' +
        // A company in more than one business (a hotel with a restaurant, a shop that also repairs): the others are ticked here
        // and kept with the businesses record (business.js), which also decides the menu groups shown
        '<div class="field span" id="cLinesBox"><label>Other Lines of Activity (tick all that apply)</label><div class="grid3" id="cLines">' +
        Business.LINES.map(l => '<label class="check"><input type="checkbox" class="cLine" value="' + esc(l) + '"' + (Business.doc().lines.includes(l) ? ' checked' : '') + '> ' + esc(l) + '</label>').join('') +
        '</div><div class="hint">The main line above is left out of this list. The menu groups follow what is ticked (Hotel for accommodation, Manpower for staffing); which groups to show: Settings (the gear) &gt; Businesses &amp; Tabs.</div></div>' +
        UI.field('Invoice Number Format', UI.input('cFmt', c.invoiceFormat, { placeholder: '####' }), { hint: '# = digits, {FY} = financial year, e.g. INV/{FY}/####' }) +
        Company.fyFields('cFy', c.fyStart, c.fyMonth, 'Usually April to March; January to December works too. Whatever is dated before a financial year shows in it as opening balances.') +
        '<div class="field"><label>Books Start From</label>' + UI.dateInput('cBooks', U.booksStart() ? U.dmy(U.booksStart()) : '') + '<div class="hint">The day your books begin: entries dated before it are refused, and opening balances are entered on it (Journal &gt; Opening Balances). To enter bills of an earlier year, set an earlier day here: they then come into this financial year as opening balances.</div></div>' +
        UI.field('Address', '<textarea id="cAddr">' + esc(c.address) + '</textarea>', { req: true, span: true }) +
        // A profile without a phone or email starts with the ones the account was registered with
        UI.field(home ? 'Phone (10 digits)' : 'Phone', UI.input('cPhone', c.phone || (App.user && App.user.phone) || '', { type: 'tel', attrs: home ? ' maxlength="10"' : ' maxlength="17"' }), { req: true }) + UI.field('Email', UI.input('cEmail', c.email || (App.user && App.user.email) || '', { type: 'email' }), { req: true }) +
        '<div class="field span"><label>Bank Account Details</label></div>' +
        UI.field('Account Number', UI.input('cAcc', c.bankAccountNo, { attrs: ' inputmode="numeric"' })) + UI.field('Account Holder Name', UI.input('cHolder', (c.bankHolder || c.name).toUpperCase(), { attrs: ' style="text-transform:uppercase"' })) +
        '<div class="field">' + '<label>IFSC Code</label>' + UI.input('cIfsc', (c.bankIfsc || '').toUpperCase(), { placeholder: home ? 'e.g. UTIB0001234' : '', attrs: ' maxlength="' + (home ? 11 : 34) + '" style="text-transform:uppercase"' }) + '<div class="hint" id="cIfscMsg">' + (home ? 'Bank and branch fill in automatically from the IFSC' : '') + '</div></div>' +
        UI.field('Bank Name', UI.input('cBank', c.bankName, { placeholder: home ? 'Filled automatically from IFSC' : '' })) + UI.field('Branch Name', UI.input('cBranch', c.bankBranch, { placeholder: home ? 'Filled automatically from IFSC' : '' })) +
        // Further bank accounts: each has an account of its own in the books (drawBanks below)
        '<div class="field span" id="cBanksBox"><label>Other Bank Accounts</label><div class="hint">The account above is the main one: "Bank" in the books, and the one printed on an invoice unless another is chosen there. Every further account gets an account of its own in the books; receipts, payments and the bank statement say which account the money moved through.</div><div id="cBanks"></div><div class="btnrow" style="margin:8px 0 0"><button class="btn sm outline" id="cBankAdd" type="button">+ Add another bank account</button></div></div>' +
        '<div class="field span"><label>Company Logo</label><div class="hint" id="cLogoMsg"></div><div class="btnrow" style="margin:4px 0"><img id="cLogoImg" src="' + (c.logo || '') + '" alt="" style="max-height:56px;max-width:180px;' + (c.logo ? '' : 'display:none') + '"><button class="btn sm outline" id="cLogoAdd">Attach Logo</button><button class="btn sm red" id="cLogoDel" ' + (c.logo ? '' : 'disabled') + '>Remove</button></div></div>' +
        '<div class="field span"><label>Authorised Signature</label><div class="hint" id="cSigMsg"></div><div class="btnrow" style="margin:4px 0"><img id="cSigImg" src="' + (c.signature || '') + '" alt="" style="max-height:48px;max-width:160px;' + (c.signature ? '' : 'display:none') + '"><button class="btn sm outline" id="cSigAdd">Attach Signature</button><button class="btn sm red" id="cSigDel" ' + (c.signature ? '' : 'disabled') + '>Remove</button></div></div>' +
        '<div class="field span"><label>Invoice Terms &amp; Payment</label></div>' +
        UI.field('Terms & Conditions', '<textarea id="cTerms" placeholder="e.g. Goods once sold will not be taken back.&#10;Interest @ 18% p.a. is charged on overdue bills.&#10;Subject to local jurisdiction.">' + esc(c.terms) + '</textarea>', { span: true, hint: 'One term per line. Each invoice has a tick "Include terms & conditions" that prints these at the foot of the PDF.' }) +
        UI.field('Credit Period (days)', UI.input('cCredit', c.creditDays, { type: 'number', attrs: ' min="0" max="365" step="1"' }), { hint: 'A Credit invoice gets a payment due date this many days after its date; the due date prints on the PDF' }) +
        '<div class="field">' + UI.check('cTermsOn', 'Include terms & conditions on new invoices', c.termsOn !== false) + '</div>' +
        '<div class="field span subleft"><label>Activation</label><div class="' + (Sub.isActive() ? 'green' : 'red') + ' bold" id="cSubLeft">' + esc(Sub.statusText()) + (Sub.isActive() ? '   ·   ' + Sub.daysLeft() + ' day' + (Sub.daysLeft() === 1 ? '' : 's') + ' remaining' : '') + '</div><div class="hint">Activation codes are entered under Subscription in the top bar.</div></div>' +
        '</div>';
      let signature = c.signature, logo = c.logo || '';
      let banks = (Array.isArray(c.banks) ? c.banks : []).map(b => Object.assign({}, b, { kept: !!String(b.ledger || '').trim() }));
      // Only the owner or an admin changes the profile: everyone else reads it
      const readOnly = !Companies.mayWrite('company');
      const bg = UI.modal({ title: 'Company Master Profile', body: (readOnly ? '<div class="hint" id="cRo" style="margin-bottom:10px">' + esc(Companies.readOnlyText('company')) + '.</div>' : '') + body, wide: true, cancelable: !firstTime, buttons: readOnly ? [{ label: 'Close', cls: 'outline' }] : [{ label: firstTime ? 'Later' : 'Cancel', cls: 'outline' }, { label: 'Save Profile', cls: 'green', onClick: (bg) => {
        const v = (id) => UI.val(id, bg).trim(), fy = Company.fyValue('cFy', bg);
        if (fy.bad) { UI.mark('cFyY', true, bg); UI.toast('Enter the year the financial year starts in (for example ' + U.fyFirstYear() + ')'); return false; }
        // The day the books begin: kept only when it is not the first day of the financial year, which is what an empty one means
        const booksDay = UI.dateVal('cBooks', bg), booksMs = U.dateMs(booksDay), fyYear = fy.year || (booksMs ? U.fyFirstYear(new Date(booksMs), fy.month) : U.validFyYear(c.fyStart));
        if (booksMs && fyYear && booksMs > U.fyEndDate(fyYear, fy.month).getTime()) { UI.mark('cBooks', true, bg); UI.toast('Books Start From cannot be after the financial year ends (' + U.dmy(U.fyEndDate(fyYear, fy.month)) + ')', 6000); return false; }
        const booksFrom = booksMs && fyYear && booksMs !== U.fyStartDate(fyYear, fy.month).getTime() ? booksDay : '';
        const rates = home ? '' : v('cRates').split(/[,\s;]+/).map(x => x.replace(/%$/, '')).filter(x => x !== '' && isFinite(+x) && +x >= 0 && +x <= 100).map(x => String(+x)).join(', ');
        const o = Object.assign({}, c, { country: R.code, homeState: home ? '' : v('cHome'), taxRates: rates === R.rates.join(', ') ? '' : rates, booksFrom, name: v('cName'), gstin: v('cGstin').toUpperCase(), gstType: v('cType'), activity: v('cAct') || 'General', activitySub: v('cAct') === U.FNB_ACTIVITY ? (v('cSub') || 'Restaurant') : '', serviceType: v('cAct') === U.SERVICE_ACTIVITY && v('cSvc') !== U.SERVICE_TYPES[0] ? v('cSvc') : '', fyStart: fyYear ? String(fyYear) : '', fyMonth: fy.month, logo, invoiceFormat: v('cFmt').includes('#') ? v('cFmt') : U.DEFAULT_INVOICE_FORMAT, address: v('cAddr').toUpperCase(), phone: v('cPhone'), email: v('cEmail').toLowerCase(),
          bankAccountNo: v('cAcc'), bankHolder: v('cHolder').toUpperCase(), bankIfsc: v('cIfsc').toUpperCase(), bankName: v('cBank'), bankBranch: v('cBranch'), signature,
          terms: UI.val('cTerms', bg).replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean).join('\n'), creditDays: Math.max(0, Math.min(365, Math.round(U.num(v('cCredit'))))), termsOn: UI.val('cTermsOn', bg) });
        if (!UI.mark('cName', !o.name, bg)) { UI.toast('Company Name is required'); return false; }
        if (!UI.mark('cAddr', !o.address, bg)) { UI.toast('Address is required'); return false; }
        if (!UI.mark('cPhone', !o.phone || !U.isValidPhone(o.phone), bg)) { UI.toast('Enter correct phone number'); return false; }
        if (!UI.mark('cEmail', !o.email || !U.isValidEmail(o.email), bg)) { UI.toast('Invalid email address'); return false; }
        if (!UI.mark('cGstin', !U.isValidGstin(o.gstin), bg)) { UI.toast(U.taxIdError('company')); return false; }
        if (o.gstin && o.gstType === 'Unregistered') { UI.toast('GSTIN given: select Regular or Composition'); return false; }
        if (!o.gstin && o.gstType !== 'Unregistered') { UI.mark('cGstin', true, bg); UI.toast('GSTIN is required for ' + o.gstType + ' dealer'); return false; }
        if (home && o.bankIfsc && !IFSC.test(o.bankIfsc)) { UI.mark('cIfsc', true, bg); UI.toast('Invalid IFSC Code format (e.g. UTIB0001234)'); return false; }
        // The further bank accounts: each needs its number, and a name in the books that nothing else has
        const more = readBanks().filter(b => b.accountNo || b.bankName || b.ifsc), taken = new Set(['bank', 'cash']);
        for (const b of more) {
          const at = banks.indexOf(b) + 1, row = $('.bankrow[data-i="' + (at - 1) + '"]', bg), bad = (k, msg) => { const el = $('[data-b=' + k + ']', row); if (el) { el.classList.add('err'); el.focus(); } UI.toast(msg, 5000); return false; };
          if (!b.accountNo) return bad('accountNo', 'Enter the account number of bank account ' + (at + 1));
          if (b.accountNo === o.bankAccountNo || more.some(x => x !== b && x.accountNo === b.accountNo)) return bad('accountNo', 'Account number ' + b.accountNo + ' is entered twice');
          if (home && b.ifsc && !IFSC.test(b.ifsc)) return bad('ifsc', 'Invalid IFSC Code format (e.g. UTIB0001234)');
          if (!b.ledger) b.ledger = U.bankLedgerName(b);
          if (taken.has(b.ledger.toLowerCase())) return bad('ledger', '"' + b.ledger + '" is already the name of another account: give this bank account a name of its own in the books');
          if (!b.kept && Books.accounts().some(a => a.name.toLowerCase() === b.ledger.toLowerCase() && a.nature !== Books.N.BANK)) return bad('ledger', '"' + b.ledger + '" is already an account in the books: give this bank account another name');
          taken.add(b.ledger.toLowerCase());
        }
        o.banks = more.map(b => ({ ledger: b.ledger, accountNo: b.accountNo, holder: b.holder, ifsc: b.ifsc, bankName: b.bankName, branch: b.branch }));
        // Books that hold earlier entries (migrated from Tally, SAP or other software) begin with the earliest of them: nothing is refused
        const begins = U.booksStartOf(o), first = Store.earliestEntry(), moved = !!(begins && first && first.ms < begins.getTime());
        if (moved) o.booksFrom = fyYear && first.ms === U.fyStartDate(fyYear, fy.month).getTime() ? '' : U.dmy(new Date(first.ms));
        if (Store.saveCompany(o) === false) return false;
        // Each further bank account is an account of the books, of the nature Bank
        o.banks.forEach(b => { if (!Books.accounts().some(a => a.name.toLowerCase() === b.ledger.toLowerCase())) Store.add('accounts', { name: b.ledger, nature: Books.N.BANK }); });
        // The other lines ticked, without the main one; the choices made for the menu groups stay as they are
        Business.save({ lines: $$('.cLine', bg).filter(x => x.checked).map(x => x.value), tabs: Business.doc().tabs });
        App.refreshBar(); App.refreshNav(); UI.toast('Company Profile Saved Successfully!' + (moved ? ' Books Start From is ' + U.dmy(new Date(first.ms)) + ', the earliest entry in the books.' : ''), moved ? 6000 : undefined); App.go('dashboard');
        // A later financial year chosen while the books hold entries of earlier years: the proper way is to split the
        // company there (split.js), the earlier years to a company of their own and this one opening with their balances
        const newYear = moved ? U.fyFirstYear(begins, fy.month) : 0;
        if (newYear && newYear > U.fyFirstYear(new Date(first.ms), fy.month) && global.Split && !Split.why() && Split.choices().includes(newYear))
          UI.confirm('Split the books at ' + U.dmy(U.fyStartDate(newYear, fy.month)) + '?', 'The books hold entries from before ' + U.dmy(U.fyStartDate(newYear, fy.month)) + ', so they still begin on ' + U.dmy(new Date(first.ms)) + '.\n\nSplit the company there: ' + (o.name || 'this company') + ' begins the ' + U.fyLabel(newYear, fy.month) + ' year with the closing balances of the earlier years as opening balances, and the earlier years move to a company of their own.', () => App.go('split', { year: newYear }), 'Split…');
      } }] });
      Company.wireFy('cFy', bg);
      /* Another country: kept with the profile at once and the form drawn again in its words, with what was typed so
         far. A company that has no financial year yet gets the month that country's year usually starts in. */
      $('#cCountry', bg).addEventListener('change', e => {
        const to = e.target.value, name = (U.REGIONS[to] || R).name;
        const typed = { name: UI.val('cName', bg).trim(), address: UI.val('cAddr', bg), phone: UI.val('cPhone', bg).trim(), email: UI.val('cEmail', bg).trim() };
        const swap = () => {
          const cur = Store.company();
          if (Store.saveCompany(Object.assign({}, cur, { country: to, homeState: '', taxRates: '' }, cur.fyStart ? {} : { fyMonth: U.fyMonthFor(to) })) === false) { e.target.value = R.code; return; }
          bg.remove(); Region.redraw(); Company.edit(firstTime, typed);
          UI.toast('Books set to ' + name + ': ' + U.region().tax + ', ' + U.region().currency, 4000, 'ok');
        };
        const n = Store.list('invoices').length + Store.list('purchases').length;
        if (!n) return swap();
        const dlg = UI.confirm('Change Country', 'These books already hold ' + n + ' invoices and purchases entered for ' + R.name + '. Changing the country to ' + name + ' shows every amount in ' + (U.REGIONS[to] || R).currency + ' and works out the tax of new entries the ' + name + ' way; the entries already made keep their figures. Change it?', swap, 'Change country');
        $$('.mf .btn', dlg)[0].addEventListener('click', () => { e.target.value = R.code; });
      });
      // The further bank accounts, a block each; what is typed is read back before the list is drawn again
      const bankField = (i, k, label, v, attrs, hint) => '<div class="field"><label>' + label + '</label><input data-b="' + k + '" value="' + esc(v || '') + '"' + (attrs || '') + '>' + (hint ? '<div class="hint" data-msg="' + k + '">' + hint + '</div>' : '') + '</div>';
      const readBanks = () => { $$('.bankrow', bg).forEach(row => { const b = banks[+row.dataset.i]; if (!b) return; const g = (k) => String(($('[data-b=' + k + ']', row) || {}).value || '').trim(); b.accountNo = g('accountNo'); b.holder = g('holder').toUpperCase(); b.ifsc = g('ifsc').toUpperCase(); b.bankName = g('bankName'); b.branch = g('branch'); if (!b.kept) b.ledger = g('ledger'); }); return banks; };
      const drawBanks = () => {
        $('#cBanks', bg).innerHTML = banks.map((b, i) => '<div class="bankrow" data-i="' + i + '"><div class="bankhd"><b>Bank account ' + (i + 2) + '</b><button class="btn sm red outline" type="button" data-rm="' + i + '">Remove</button></div><div class="grid2">' +
          bankField(i, 'accountNo', 'Account Number', b.accountNo, ' inputmode="numeric"') + bankField(i, 'holder', 'Account Holder Name', b.holder || $('#cHolder', bg).value, ' style="text-transform:uppercase"') +
          bankField(i, 'ifsc', 'IFSC Code', b.ifsc, home ? ' maxlength="11" placeholder="e.g. HDFC0001234" style="text-transform:uppercase"' : ' maxlength="34" style="text-transform:uppercase"', home ? 'Bank and branch fill in automatically from the IFSC' : ' ') + bankField(i, 'bankName', 'Bank Name', b.bankName, home ? ' placeholder="Filled automatically from IFSC"' : '') +
          bankField(i, 'branch', 'Branch Name', b.branch, home ? ' placeholder="Filled automatically from IFSC"' : '') + bankField(i, 'ledger', 'Name in the Books', b.ledger, b.kept ? ' disabled' : ' placeholder="e.g. HDFC Bank A/c 4321 (filled in when left blank)"', b.kept ? 'The account of the books this bank account is kept in' : 'The account of the books this bank account is kept in: it shows in the balance sheet and the journal') + '</div></div>').join('');
        $$('[data-rm]', bg).forEach(x => x.onclick = () => { readBanks(); const b = banks[+x.dataset.rm]; banks.splice(+x.dataset.rm, 1); drawBanks(); if (b && b.kept) UI.toast('Removed from the profile. Its account "' + b.ledger + '" stays in the books with its entries.', 6000); });
        $$('.bankrow [data-b=ifsc]', bg).forEach(el => el.addEventListener('input', async () => {
          const row = el.closest('.bankrow'), code = el.value.trim().toUpperCase(), say = (text, cls) => { const m = $('[data-msg=ifsc]', row); m.textContent = text; m.className = 'hint ' + (cls || ''); };
          el.classList.remove('err');
          if (!home) return; // the bank code of another country is typed as it is
          if (code.length < 11) { say('Bank and branch fill in automatically from the IFSC'); return; }
          if (!IFSC.test(code)) { el.classList.add('err'); say('Invalid IFSC code format (e.g. HDFC0001234)', 'red'); return; }
          if (U.BANK_IFSC[code.slice(0, 4)]) $('[data-b=bankName]', row).value = U.BANK_IFSC[code.slice(0, 4)];
          say('Looking up bank & branch…');
          let found = null, reached = true;
          try { const r = await fetch('https://ifsc.razorpay.com/' + code); if (r.ok) found = await r.json(); else if (r.status !== 404) reached = false; } catch (err) { reached = false; }
          if (!row.isConnected || el.value.trim().toUpperCase() !== code) return;
          if (!found) { say(reached ? 'IFSC not found. Please check the code.' : 'Could not reach IFSC lookup. Enter bank & branch manually.', 'red'); return; }
          if (found.BANK) $('[data-b=bankName]', row).value = found.BANK.trim();
          $('[data-b=branch]', row).value = U.nameCase(found.BRANCH || '');
          say('✓ Bank & branch filled from IFSC', 'green');
        }));
      };
      drawBanks();
      $('#cBankAdd', bg).onclick = () => { readBanks(); banks.push({ ledger: '', accountNo: '', holder: '', ifsc: '', bankName: '', branch: '', kept: false }); drawBanks(); const last = $$('.bankrow', bg).pop(); if (last) $('[data-b=accountNo]', last).focus(); };
      if (readOnly) { $('#cBankAdd', bg).style.display = 'none'; $$('[data-rm]', bg).forEach(x => x.style.display = 'none'); }
      // Books Start From follows the financial year until a day of its own is typed
      { const fyDay = () => { const f = Company.fyValue('cFy', bg); return f.year ? U.toIso(U.dmy(U.fyStartDate(f.year, f.month))) : ''; };
        let was = fyDay();
        const follow = () => { const el = $('#cBooks', bg), now = fyDay(); if (now && (!el.value || el.value === was)) el.value = now; was = now; };
        $('#cFyM', bg).addEventListener('change', follow); $('#cFyY', bg).addEventListener('input', follow); }
      // The main line is not offered among the others (a Services company of the staffing type is a staffing agency)
      const otherLines = () => { const a = $('#cAct', bg).value, main = a === U.SERVICE_ACTIVITY && $('#cSvc', bg).value === U.STAFFING_SERVICE ? U.STAFFING_SERVICE : a; $$('.cLine', bg).forEach(x => { const off = x.value === main; x.parentNode.style.display = off ? 'none' : ''; if (off) x.checked = false; x.disabled = readOnly; }); };
      otherLines();
      $('#cSvc', bg).addEventListener('change', otherLines);
      $('#cAct', bg).addEventListener('change', e => { $('#cSubBox', bg).style.display = e.target.value === U.FNB_ACTIVITY ? '' : 'none'; $('#cSvcBox', bg).style.display = e.target.value === U.SERVICE_ACTIVITY ? '' : 'none'; otherLines(); });
      $('#cGstin', bg).addEventListener('input', e => { const g = e.target.value.trim(); e.target.classList.toggle('err', g.length >= 15 && !U.isValidGstin(g)); if (g && $('#cType', bg).value === 'Unregistered') $('#cType', bg).value = 'Regular'; if (!g) $('#cType', bg).value = 'Unregistered'; });
      // Bank name comes from the IFSC prefix straight away; bank and branch are then confirmed online
      const msg = (text, cls) => { const m = $('#cIfscMsg', bg); m.textContent = text; m.className = 'hint ' + (cls || ''); };
      $('#cIfsc', bg).addEventListener('input', async e => {
        const code = e.target.value.trim().toUpperCase();
        e.target.classList.remove('err');
        if (!home) return;
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
      // The company's own logo: shown in the top bar in place of BlitzBook and printed at the head of its documents
      const logoMsg = () => { $('#cLogoMsg', bg).textContent = logo ? 'Your logo shows in the top bar in place of BlitzBook and prints at the head of invoices and other documents' : 'No logo attached: the top bar shows BlitzBook and documents print without a logo'; };
      logoMsg();
      $('#cLogoAdd', bg).onclick = () => UI.pickFile('image/*', (dataUrl) => {
        const img = new Image();
        img.onload = () => { const k = Math.min(1, 320 / Math.max(img.width, img.height)), cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k)); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); logo = cv.toDataURL('image/png'); $('#cLogoImg', bg).src = logo; $('#cLogoImg', bg).style.display = ''; $('#cLogoDel', bg).disabled = false; logoMsg(); UI.toast('Logo attached: Save Profile to keep it'); };
        img.onerror = () => UI.toast('Could not read that image');
        img.src = dataUrl;
      }, true);
      $('#cLogoDel', bg).onclick = () => { logo = ''; $('#cLogoImg', bg).style.display = 'none'; $('#cLogoDel', bg).disabled = true; logoMsg(); UI.toast('Logo removed: Save Profile to keep it so'); };
      // A role that may not change the profile sees it with every field closed
      if (readOnly) $$('.modal input, .modal select, .modal textarea, #cLogoAdd, #cLogoDel, #cSigAdd, #cSigDel', bg).forEach(el => { el.disabled = true; });
    },
    /* The financial year, asked for as the month and year it starts from with the day it ends shown beside it: nothing
       is picked from a fixed list of years. id + 'M' is the month, id + 'Y' the year, id + 'End' the closing date. */
    fyFields(id, year, month, hint) {
      const m = U.fyMonthOf(month), y = U.validFyYear(year);
      return '<div class="field"><label>Financial Year Starts From</label><div class="btnrow" style="margin:0;flex-wrap:nowrap">' + UI.select(id + 'M', U.MONTHS.map((n, i) => [String(i + 1), '1 ' + n]), String(m)) +
        '<input id="' + id + 'Y" type="number" inputmode="numeric" min="1990" max="2100" step="1" placeholder="Year, e.g. ' + U.fyFirstYear(new Date(), m) + '" value="' + (y || '') + '" style="max-width:130px"></div>' + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>' +
        '<div class="field"><label>Financial Year Ends On</label><input id="' + id + 'End" readonly tabindex="-1" value=""><div class="hint" id="' + id + 'Lbl"></div></div>';
    },
    // { year (0 while not typed), month, bad (a year that cannot be) }
    fyValue(id, bg) { const raw = String(UI.val(id + 'Y', bg)).trim(), y = U.validFyYear(raw); return { year: y, month: U.fyMonthOf(UI.val(id + 'M', bg)), bad: !!raw && !y }; },
    wireFy(id, bg) {
      const show = () => { const f = Company.fyValue(id, bg); $('#' + id + 'End', bg).value = f.year ? U.dmy(U.fyEndDate(f.year, f.month)) : ''; $('#' + id + 'Lbl', bg).textContent = f.year ? 'Financial year ' + U.fyLabel(f.year, f.month) + ': ' + U.fyRangeText(f.year, f.month) : 'Type the year to see the closing date'; };
      $('#' + id + 'M', bg).addEventListener('change', show); $('#' + id + 'Y', bg).addEventListener('input', show); show();
    }
  };
  App.routes.company = () => Company.edit(false);

  // ------------------------------------------------------------ backup
  App.routes.backup = function () {
    const root = App.view(App.header('Export / Import Data') +
      '<div class="card white"><div class="hd">Backup</div><div class="bd"><p>Export saves your company profile, items, contacts, invoices, purchases, expenses, journal and notes as one backup file. Import restores a backup file and replaces the data currently here.</p>' +
      '<p>The file is the same one the BlitzBook app writes and reads: a backup taken here restores in the app (Export / Import &rsaquo; Import Backup), and a backup taken in the app restores here.</p>' +
      '<div class="btnrow"><button class="btn green" id="bExp">Export Backup</button><button class="btn red" id="bImp">Import Backup</button></div>' +
      (Sync.status === 'idle' || Sync.status === 'syncing' ? '' : '<div class="hint">Data is stored in this browser only.</div>') + '</div></div>');
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
          body: '<p style="white-space:pre-line">' + esc(Sub.statusText() + '.\n\n' + (own ? (global.Lic && Lic.companyUnpaid() ? 'Every company after your first needs an Additional company licence. Switch to your first company and buy one under Company > Licences; this company opens again at once.' : 'This company runs on your own subscription: renew it from your first company (switch company, then Subscription).') : (global.Lic && Lic.missing() ? 'Every member needs a licence of their own. Ask the owner' + (co && co.owner_name ? ', ' + co.owner_name + ',' : '') + ' or an admin to assign you one (Company > Licences).' : 'This company runs on the subscription of its owner' + (co && co.owner_name ? ', ' + co.owner_name : '') + '. Ask them to renew it.'))) + '</p>',
          buttons: [{ label: locked ? 'Logout' : 'Close', cls: 'outline', onClick: () => { if (locked) App.signOut(); } }].concat(Companies.canSwitch() ? [{ label: 'Switch company', cls: 'blue', onClick: () => { Companies.switcher(); return false; } }] : []) });
        bg.id = 'subDlg'; if (locked) bg.classList.add('locked');
        return;
      }
      const pending = Sub.pendingRequest();
      // An account that has paid for something (an invoice pack of Rs 99, a monthly plan...) is offered the way up
      const paidPlan = Sub.subscriptionUntil() > 0 || Sub.invoiceQuota() > 0, buyLabel = paidPlan ? 'Upgrade / Renew' : 'Buy / Renew';
      const msg = (locked ? (Sub.isOnTrial() && !Sub.invoiceQuota() ? 'Your free ' + Sub.TRIAL_LABEL + ' activation has ended.' : Sub.statusText() + '.') + '\n\nA subscription is needed to continue.' : Sub.statusText() + '.') +
        (Sub.isLite() ? '\n\nOn an invoice pack only invoicing is offered: invoices, credit and debit notes, customers and suppliers, the sales report. Every saved invoice or note uses one invoice of the pack; it can be changed and saved again afterwards (that uses no further invoice), not deleted. A monthly or longer plan opens every feature: upgrade at any time, and the invoices left in the pack stay for later.' : paidPlan ? '\n\nYou can move up at any time: a longer plan, Full access (accounts + HR & payroll), or licences for your users. The days you buy are added after the ones you have.' : '') +
        (Native.noSales ? '\n\nPlans and invoice packs cannot be bought in this app. If you have an activation code, enter it below.' : '\n\nTap "' + buyLabel + '" to choose a plan or an invoice pack and pay by UPI. The activation code is then sent to your mobile' + (App.user.email ? ' and email' : '') + '. Enter it below.' + (pending ? '\n\n' + pending : ''));
      const bg = UI.modal({ title: locked ? 'Subscription Required' : 'Subscription', cancelable: !locked,
        body: '<p style="white-space:pre-line">' + esc(msg) + '</p>' + UI.field('Activation Code', UI.input('sCode', '', { placeholder: 'XXXX-XXXX-XXXX-XXXX', attrs: ' maxlength="19" style="text-transform:uppercase;letter-spacing:1px"' })),
        buttons: [{ label: locked ? 'Logout' : 'Close', cls: 'outline', onClick: () => { if (locked) App.signOut(); } }].concat(Native.noSales ? [] : [{ label: buyLabel, cls: 'blue', onClick: () => { Subscription.plans(); return false; } }]).concat(!locked && Sub.paymentsAvailable() ? [{ label: 'Licences', cls: 'outline', onClick: () => { App.go('licences'); } }] : []).concat([
          { label: 'Activate', cls: 'green', onClick: async (bg) => {
            const r = await Sub.activate(App.identity(), UI.val('sCode', bg));
            if (r === -2) { UI.toast('This code has already been used'); return false; }
            if (r === -3) { UI.toast('The code could not be checked: the portal is not signed in to the server right now. Check the connection and try again.', 7000); return false; }
            if (typeof r !== 'object') {
              // Not a plan or pack code: a licence code (seats for the users) is taken here too
              const l = await Sub.redeemLicence(UI.val('sCode', bg));
              if (l === -2) { UI.toast('This code has already been used'); return false; }
              if (l && typeof l === 'object') {
                UI.toast(l.seats + ' ' + (global.Lic ? Lic.name(l.kind) : l.kind) + ' seat' + (l.seats === 1 ? '' : 's') + ' added, valid till ' + new Date(l.until).toLocaleDateString('en-GB') + '. ' + (l.kind === 'pro' ? 'The Professionals tab is open in full now: nothing to assign.' : l.kind === 'co' ? 'It covers one more company: nothing to assign.' : 'Assign it under Company > Licences.'), 8000, 'ok');
                if (global.Companies) Companies.load().catch(() => null);
                return !locked;
              }
              UI.toast('Invalid activation code'); return false;
            }
            Subscription.activated(); return true;
          } }]) });
      bg.id = 'subDlg'; if (locked) bg.classList.add('locked');
    },
    activated() { Sub.clearPendingRequest(); UI.toast('Activated: ' + Sub.statusText(), 4000); App.checkSubscription(); App.go('dashboard'); },
    plans() {
      // Every "Buy ..." button of the portal comes through here: the Play Store edition of the app sells nothing
      if (Native.noSales) return UI.toast('Plans and invoice packs cannot be bought in this app.', 5000);
      UI.menu('Choose a Plan', Sub.PLANS.map((p, i) => Sub.planLabel(i)), (i) => Subscription.pay(Sub.PLANS[i]));
    },
    // Pay through Cashfree when the payment function is there (card, UPI, net banking on Cashfree's page); the UPI deep
    // link with the vendor's manual code remains the fallback
    async pay(plan) {
      if (Native.noSales) return;
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
      UI.modal({ title: 'Pay Rs ' + amount + ' by UPI', body: '<p>Plan: <b>' + esc(plan.name) + '</b> (' + what + ') for <b>Rs ' + amount + '</b>.</p>' + '<p>Pay to <b>' + esc(Sub.VENDOR_UPI_ID) + '</b> (' + esc(Sub.VENDOR_NAME) + ') with the note <b>' + esc(Sub.VENDOR_NAME + ' ' + tag + ' ' + phone) + '</b>. On a phone the button below opens your UPI app (Google Pay, PhonePe, Paytm or your bank\'s app).</p>' +
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
  /* How each assistant is connected. Every one of them takes the same two things, the MCP server address and an API
     key; they differ in where these are typed. a = { url, key ('YOUR_API_KEY' until a key is on screen), withKey }.
     steps = what to do, snippets = [label, text to copy]. The menus of these apps change now and then: the words to
     look for are "connectors", "MCP servers" or "tools". */
  const json = (o) => JSON.stringify(o, null, 2);
  const CONNECTORS = [
    { id: 'chatgpt', name: 'ChatGPT', by: 'OpenAI',
      steps: () => ['Open ChatGPT > Settings > Apps & Connectors (on some plans: Connectors).', 'Under Advanced settings switch on Developer mode, then choose Create (Add custom connector).', 'Name it BlitzBook, paste the address with the key below as the MCP server URL and choose "No authentication".', 'In a chat, pick BlitzBook from the tools (+) menu and ask about your books.'],
      snippets: (a) => [['MCP server URL (address with the key)', a.withKey]] },
    { id: 'claude', name: 'Claude', by: 'Anthropic',
      steps: () => ['Claude on the web or the desktop app: Settings > Connectors > Add custom connector. Name it BlitzBook and paste the address with the key below.', 'Claude Code (terminal): run the command below once.', 'Claude Desktop with a config file: add the block below to claude_desktop_config.json and restart the app.'],
      snippets: (a) => [['Custom connector URL (address with the key)', a.withKey], ['Claude Code command', 'claude mcp add --transport http blitzbook ' + a.url + ' --header "Authorization: Bearer ' + a.key + '"'],
        ['claude_desktop_config.json', json({ mcpServers: { blitzbook: { command: 'npx', args: ['-y', 'mcp-remote', a.url, '--header', 'Authorization: Bearer ' + a.key] } } })]] },
    { id: 'gemini', name: 'Gemini', by: 'Google',
      steps: () => ['Gemini CLI: open the file ~/.gemini/settings.json (create it if it is not there).', 'Add the block below, save, and start gemini again. /mcp lists BlitzBook and its tools.', 'Other Google tools that take an MCP server (for example an agent built with the Gemini API) use the same address and header.'],
      snippets: (a) => [['~/.gemini/settings.json', json({ mcpServers: { blitzbook: { httpUrl: a.url, headers: { Authorization: 'Bearer ' + a.key } } } })]] },
    { id: 'copilot', name: 'Copilot', by: 'Microsoft',
      steps: () => ['Microsoft Copilot Studio: open your agent > Tools > Add a tool > New tool > Model Context Protocol.', 'Server name BlitzBook, server URL the address below, authentication "API key" sent as the header Authorization with the value below.', 'GitHub Copilot in VS Code: add the block below to .vscode/mcp.json in your folder, then pick BlitzBook in the chat\'s tools.'],
      snippets: (a) => [['Server URL', a.url], ['Authorization header value', 'Bearer ' + a.key], ['.vscode/mcp.json', json({ servers: { blitzbook: { type: 'http', url: a.url, headers: { Authorization: 'Bearer ' + a.key } } } })]] },
    { id: 'cursor', name: 'Cursor & code editors', by: 'Cursor, Windsurf, VS Code',
      steps: () => ['Cursor: Settings > MCP > Add new MCP server, or put the block below in ~/.cursor/mcp.json.', 'Windsurf, Cline and other editors read the same block from their own MCP settings file.', 'Restart the editor; BlitzBook shows among the MCP tools.'],
      snippets: (a) => [['mcp.json', json({ mcpServers: { blitzbook: { url: a.url, headers: { Authorization: 'Bearer ' + a.key } } } })]] },
    { id: 'other', name: 'Any other tool', by: 'Perplexity, Le Chat, n8n, Zapier, your own agent ...',
      steps: () => ['Look for "Connectors", "MCP servers", "Tools" or "Integrations" in the app and add a remote (HTTP) MCP server.', 'If it asks for an address and a header or token: give the server address, and the key as a Bearer token.', 'If it only takes an address: use the address with the key.', 'To check a connection from a terminal, the curl command below lists the tools.'],
      snippets: (a) => [['MCP server address', a.url], ['Authorization header', 'Authorization: Bearer ' + a.key], ['Address with the key', a.withKey],
        ['Test with curl', 'curl -s -X POST "' + a.url + '" -H "Authorization: Bearer ' + a.key + '" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d \'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\'']] }
  ];
  /* What a key may be allowed to use: the tools of the MCP server (server/supabase/functions/mcp, TOOLS; the same names),
     in the groups they are ticked by. A key is read only or read & write, and within that it can be narrowed to the
     tools ticked for it (api_keys.tools; none kept = everything its access allows): an assistant that only answers
     "who owes me money" needs Outstanding and the customers, not the purchases and the expenses. w = a tool that saves. */
  const AI_TOOLS = [
    { g: 'Company', n: 'get_company', t: 'Company profile and subscription' },
    { g: 'Sales', n: 'list_invoices', t: 'Sales invoices (list)' }, { g: 'Sales', n: 'get_invoice', t: 'An invoice in full' }, { g: 'Sales', n: 'list_challans', t: 'Delivery challans' }, { g: 'Sales', n: 'list_notes', t: 'Credit and debit notes' },
    { g: 'Sales', n: 'sales_summary', t: 'Sales summary (by month, customer, item)' }, { g: 'Sales', n: 'outstanding', t: 'Outstanding receivables' }, { g: 'Sales', n: 'create_invoice', t: 'Make a sales invoice', w: true },
    { g: 'Parties & items', n: 'list_contacts', t: 'Customers and suppliers' }, { g: 'Parties & items', n: 'list_items', t: 'Item master' }, { g: 'Parties & items', n: 'save_contact', t: 'Add or update a contact', w: true }, { g: 'Parties & items', n: 'save_item', t: 'Add or update an item', w: true },
    { g: 'Purchases & accounts', n: 'list_purchases', t: 'Purchases' }, { g: 'Purchases & accounts', n: 'list_expenses', t: 'Expenses' }, { g: 'Purchases & accounts', n: 'list_vouchers', t: 'Receipts, payments and journal' }
  ];
  const AiAccess = {
    TOOLS: AI_TOOLS,
    // The tools a key gets: those its access allows, narrowed to the ones kept for it
    toolsOf(k) { return AI_TOOLS.filter(t => (!t.w || k.scope === 'write') && (!Array.isArray(k.tools) || k.tools.includes(t.n))); },
    accessText(k) { const all = AI_TOOLS.filter(t => !t.w || k.scope === 'write').length, n = this.toolsOf(k).length; return n === all ? 'Everything it allows' : n + ' of ' + all + ' tools'; },
    // The ticks of the dialog: every tool by group; a tool that saves is shut while the access is read only
    ticksHtml(k) {
      const groups = Array.from(new Set(AI_TOOLS.map(t => t.g))), on = (t) => !Array.isArray(k.tools) || k.tools.includes(t.n);
      return '<div class="field"><label>What this key may use <span class="tilehint"><button type="button" class="link small" id="akAll">All</button> · <button type="button" class="link small" id="akNone">None</button></span></label>' +
        groups.map(g => '<div class="small bold" style="margin:8px 0 2px">' + esc(g) + '</div><div class="grid2">' + AI_TOOLS.filter(t => t.g === g).map(t => '<label class="check"><input type="checkbox" class="akTool" value="' + t.n + '"' + (t.w ? ' data-w="1"' : '') + (on(t) ? ' checked' : '') + '> ' + esc(t.t) + (t.w ? ' <span class="pill warn">saves</span>' : '') + '</label>').join('') + '</div>').join('') +
        '<div class="hint">The assistant is shown only the tools ticked here, and the server refuses the rest. It can be changed later with Customize, without making a new key.</div></div>';
    },
    wireTicks(bg) {
      const scope = () => UI.val('akScope', bg), ticks = () => $$('.akTool', bg);
      const sync = () => ticks().forEach(c => { if (c.dataset.w) { c.disabled = scope() !== 'write'; c.closest('label').style.opacity = c.disabled ? '.5' : ''; } });
      $('#akScope', bg).addEventListener('change', () => { ticks().forEach(c => { if (c.dataset.w && scope() === 'write') c.checked = true; }); sync(); }); sync();
      $('#akAll', bg).onclick = () => ticks().forEach(c => { if (!c.disabled) c.checked = true; });
      $('#akNone', bg).onclick = () => ticks().forEach(c => { c.checked = false; });
    },
    // null when everything the access allows is ticked (nothing to narrow), else the names ticked
    ticked(bg) { const scope = UI.val('akScope', bg), can = $$('.akTool', bg).filter(c => !c.dataset.w || scope === 'write'), on = can.filter(c => c.checked).map(c => c.value); return on.length === can.length ? null : on; },
    url() { return Sync.serverUrl().replace(/\/+$/, '') + '/functions/v1/mcp'; },
    // A server that has not been given the tools column yet (server/supabase/mcp.sql run before it) answers without it:
    // the keys then work as before, everything their access allows, and narrowing is refused with a note saying why
    list() { const get = (cols) => Sub.withToken((token) => Supabase.http('GET', '/rest/v1/api_keys?select=' + cols + '&order=created_at.desc', undefined, token)); return get('id,name,prefix,scope,tools,created_at,last_used_at').catch(e => { if (e && e.status === 401) throw e; this.noTools = true; return get('id,name,prefix,scope,created_at,last_used_at'); }); },
    make(name, scope, tools) { return Sub.withToken((token) => Supabase.http('POST', '/rest/v1/rpc/create_api_key', tools ? { name_in: name, scope_in: scope, tools_in: tools } : { name_in: name, scope_in: scope }, token)); },
    update(id, scope, tools) { return Sub.withToken((token) => Supabase.http('POST', '/rest/v1/rpc/update_api_key', { id_in: id, scope_in: scope, tools_in: tools }, token)); },
    NEEDS_SQL: 'Choosing the tools of a key needs the newer AI access set-up on the server (server/supabase/mcp.sql run again in the SQL Editor). Until then a key gets everything its access allows.',
    revoke(id) { return Sub.withToken((token) => Supabase.http('DELETE', '/rest/v1/api_keys?id=eq.' + encodeURIComponent(id), undefined, token)); },
    when(t) { const d = new Date(t); return isNaN(d) ? '' : U.pad(d.getDate()) + '/' + U.pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()); },
    copy(text, what) { try { navigator.clipboard.writeText(text).then(() => UI.toast(what + ' copied'), () => UI.toast('Select the text and copy it')); } catch (e) { UI.toast('Select the text and copy it'); } },
    // The assistant last chosen on this device
    chosen() { let id = ''; try { id = localStorage.getItem('blitzbook.connector') || ''; } catch (e) { id = ''; } return CONNECTORS.some(c => c.id === id) ? id : CONNECTORS[0].id; },
    choose(id) { try { localStorage.setItem('blitzbook.connector', id); } catch (e) { /* kept for this page only */ } },
    /* The assistants as a row of buttons with the steps of the one chosen under it. pre keeps the ids of two guides
       on screen at once apart (the screen, and the dialog that shows a new key); key = the key to put into what is
       copied, none = the placeholder YOUR_API_KEY. */
    guide(pre, key) {
      const url = this.url(), a = { url, key: key || 'YOUR_API_KEY', withKey: url + '?key=' + (key || 'YOUR_API_KEY') }, on = this.chosen(), c = CONNECTORS.find(x => x.id === on);
      return '<div class="contabs" role="tablist">' + CONNECTORS.map(x => '<button type="button" role="tab" data-con="' + x.id + '" class="' + (x.id === on ? 'sel' : '') + '" aria-selected="' + (x.id === on) + '"><b>' + esc(x.name) + '</b><span>' + esc(x.by) + '</span></button>').join('') + '</div>' +
        '<div class="conbody"><ol class="consteps">' + c.steps(a).map(t => '<li>' + esc(t) + '</li>').join('') + '</ol>' +
        c.snippets(a).map((sn, i) => '<div class="consnip"><div class="lb"><span>' + esc(sn[0]) + '</span><button type="button" class="btn sm outline" data-concopy="' + pre + i + '">Copy</button></div><pre id="' + pre + i + '">' + esc(sn[1]) + '</pre></div>').join('') +
        (key ? '' : '<div class="hint">YOUR_API_KEY stands for a key of yours: make one below and this guide is shown again with the key filled in.</div>') + '</div>';
    },
    wireGuide(box, pre, key) {
      box.innerHTML = this.guide(pre, key);
      $$('[data-con]', box).forEach(b => b.onclick = () => { this.choose(b.dataset.con); this.wireGuide(box, pre, key); });
      $$('[data-concopy]', box).forEach(b => b.onclick = () => this.copy($('#' + b.dataset.concopy, box).textContent, 'Text'));
    },
    async screen() {
      const here = () => App.current && App.current.route === 'ai' && !!$('#aiKeys');
      const root = App.view(App.header('AI Access') +
        '<div class="card white"><div class="hd">Connect an AI assistant</div><div class="bd"><p>Let an AI assistant work with your books: ChatGPT, Claude, Gemini, Copilot, Cursor or any other tool that connects to MCP servers. Ask it for this month\'s sales, who still owes you money or what a customer bought, or have it make an invoice for you. One API key made here works with every assistant.</p>' +
        UI.field('MCP server address', '<input id="aiUrl" readonly value="' + esc(this.url()) + '">', { hint: 'The same address for every assistant and every key; the key decides whose books are opened and what may be done with them.' }) +
        '<div class="btnrow"><button class="btn outline" id="aiCopyUrl">Copy address</button><button class="btn green" id="aiNew">' + icon('plus') + ' New API key</button></div></div></div>' +
        '<div class="card white"><div class="hd">Connectors: set up your assistant</div><div class="bd" id="aiGuide"></div></div>' +
        '<div class="card white"><div class="hd">API keys</div><div class="bd" id="aiKeys"><div class="hint">Loading…</div></div></div>');
      App.wireBack(root);
      this.wireGuide($('#aiGuide'), 'cg', '');
      $('#aiCopyUrl').onclick = () => this.copy(this.url(), 'Address');
      $('#aiNew').onclick = () => this.create();
      if (!Sub.paymentsAvailable()) { $('#aiNew').disabled = true; $('#aiKeys').innerHTML = '<div class="empty">AI access works on books kept in your BlitzBook account. This browser is not signed in to the server right now (Export / Import shows whether the books are synced).</div>'; return; }
      let keys;
      try { keys = await this.list(); }
      catch (e) { if (here()) { $('#aiNew').disabled = true; $('#aiKeys').innerHTML = '<div class="empty">' + esc(e.status === 404 ? 'AI access is not set up on the server yet.' : 'The keys could not be loaded: ' + (e.message || 'no connection') + '.') + '</div>'; } return; }
      if (!here()) return;
      keys = Array.isArray(keys) ? keys : [];
      $('#aiKeys').innerHTML = keys.length ? '<div class="tablewrap"><table class="list cards"><thead><tr><th>Name</th><th>Key</th><th>Access</th><th>May use</th><th>Made</th><th>Last used</th><th></th></tr></thead><tbody>' + keys.map(k =>
        '<tr><td data-l="Name"><b>' + esc(k.name) + '</b></td><td data-l="Key"><code>' + esc(k.prefix) + '…</code></td><td data-l="Access"><span class="pill ' + (k.scope === 'write' ? 'warn' : 'ok') + '" style="white-space:nowrap">' + (k.scope === 'write' ? 'Read &amp; write' : 'Read only') + '</span></td><td data-l="May use" title="' + esc(this.toolsOf(k).map(t => t.t).join(', ') || 'Nothing') + '">' + esc(this.accessText(k)) + '</td><td data-l="Made">' + esc(this.when(k.created_at)) + '</td><td data-l="Last used">' + esc(k.last_used_at ? this.when(k.last_used_at) : 'Never') + '</td>' +
        '<td class="actions"><div class="ibtns">' + UI.ibtn('gear', 'Customize what this key may do', 'data-custom="' + esc(k.id) + '"') + UI.ibtn('trash', 'Revoke', 'data-revoke="' + esc(k.id) + '"', 'danger') + '</div></td></tr>').join('') + '</tbody></table></div>' +
        '<div class="hint">A key is shown only once, when it is made. Make a key for each assistant, named after it, so one can be revoked without the others. Customize (the gear) changes what a key may see and do at any time.</div>'
        : '<div class="empty">No API keys yet. Make one to connect an assistant.</div>';
      $$('[data-custom]', root).forEach(b => b.onclick = () => this.customize(keys.find(x => x.id === b.dataset.custom)));
      $$('[data-revoke]', root).forEach(b => b.onclick = () => { const k = keys.find(x => x.id === b.dataset.revoke); UI.confirm('Revoke API Key', 'Revoke "' + k.name + '" (' + k.prefix + '…)? Any assistant using this key loses access to your books at once.', async () => {
        try { await this.revoke(k.id); UI.toast('Key revoked'); } catch (e) { UI.toast(e.message || 'The key could not be revoked', 6000); }
        if (App.current && App.current.route === 'ai') this.screen();
      }, 'Revoke'); });
    },
    create() {
      const c = CONNECTORS.find(x => x.id === this.chosen());
      UI.modal({ title: 'New API Key',
        body: UI.field('Name', UI.input('akName', c.id === 'other' ? '' : c.name, { placeholder: 'e.g. ChatGPT on the office laptop', attrs: ' maxlength="60"' }), { hint: 'The assistant, or where and by whom the key is used, to tell your keys apart later.' }) +
          UI.field('Access', UI.select('akScope', [['read', 'Read only - look at the books'], ['write', 'Read & write - also save invoices, contacts and items']], 'read'), { hint: 'Choose read only unless the assistant has to enter things for you. An invoice saved by an assistant counts like any other invoice.' }) + this.ticksHtml({ scope: 'read', tools: null }),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Make key', cls: 'green', onClick: async (bg) => {
          let r; const tools = this.ticked(bg);
          if (tools && !tools.length) { UI.toast('Tick at least one thing the key may use'); return false; }
          if (tools && this.noTools) { UI.toast(this.NEEDS_SQL, 9000); return false; }
          try { r = await this.make(UI.val('akName', bg).trim(), UI.val('akScope', bg), tools); }
          catch (e) { UI.toast(e.status === 404 ? (tools ? this.NEEDS_SQL : 'AI access is not set up on the server yet') : e.message || 'The key could not be made', 9000); return false; }
          if (!r || !r.key) { UI.toast((r && r.error) || 'The key could not be made', 6000); return false; }
          this.show(r);
          return true;
        } }] });
      this.wireTicks($('#dialogs').lastElementChild);
    },
    // What a key already made may see and do: its access and its tools, changed in place (the key itself stays the same)
    customize(k) {
      if (!k) return;
      if (this.noTools) return UI.alert('Customize access', this.NEEDS_SQL);
      const bg = UI.modal({ title: 'Access of "' + k.name + '"', wide: true,
        body: '<p class="hint" style="margin-top:0">What the assistant holding this key (<code>' + esc(k.prefix) + '…</code>) may see and do in your books. A change holds from its next request.</p>' +
          UI.field('Access', UI.select('akScope', [['read', 'Read only - look at the books'], ['write', 'Read & write - also save invoices, contacts and items']], k.scope === 'write' ? 'write' : 'read')) + this.ticksHtml(k),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: async (bg) => {
          const tools = this.ticked(bg);
          if (tools && !tools.length) { UI.toast('Tick at least one thing the key may use, or revoke the key'); return false; }
          let r;
          try { r = await this.update(k.id, UI.val('akScope', bg), tools); }
          catch (e) { UI.toast(e.status === 404 ? this.NEEDS_SQL : e.message || 'The access could not be changed', 9000); return false; }
          if (!r || r.error) { UI.toast((r && r.error) || 'The access could not be changed', 6000); return false; }
          UI.toast('Access of ' + k.name + ' saved', 3000, 'ok');
          if (App.current && App.current.route === 'ai') this.screen();
          return true;
        } }] });
      this.wireTicks(bg);
    },
    // The one time the key itself is on screen: the key, the address, and the steps for the assistant chosen with
    // the key already in what is copied. The same key and address serve every assistant.
    show(k) {
      const url = this.url();
      const box = (id, text, rows) => '<textarea id="' + id + '" readonly rows="' + rows + '" style="min-height:0;font-family:monospace;font-size:12.5px;word-break:break-all">' + esc(text) + '</textarea>';
      const bg = UI.modal({ title: 'API Key: ' + k.name, wide: true, cancelable: false, focus: false,
        body: '<p><b>Copy the key now.</b> It is not shown again; if it is lost, revoke it and make a new one. Anyone who has it can ' + (k.scope === 'write' ? 'read and add to' : 'read') + ' your books, so treat it like a password.</p>' +
          UI.field('API key (' + (k.scope === 'write' ? 'read & write' : 'read only') + ')', box('akKey', k.key, 2)) + '<div class="btnrow"><button class="btn sm" data-copy="akKey">Copy key</button></div>' +
          UI.field('MCP server address', box('akUrl', url, 2), { hint: 'In your assistant add BlitzBook as a custom connector / MCP server: this address, with the header "Authorization: Bearer <key>" when the assistant asks for headers or a token.' }) + '<div class="btnrow"><button class="btn sm outline" data-copy="akUrl">Copy address</button></div>' +
          UI.field('Address with the key', box('akAny', url + '?key=' + k.key, 3), { hint: 'For an assistant that only takes a URL and no headers: this address carries the key, so no login is needed.' }) + '<div class="btnrow"><button class="btn sm outline" data-copy="akAny">Copy address with key</button></div>' +
          '<div class="field"><label>Set up your assistant with this key</label><div id="akGuide"></div></div>',
        buttons: [{ label: 'I have copied the key', cls: 'green', onClick: () => { if (App.current && App.current.route === 'ai') this.screen(); } }] });
      $$('[data-copy]', bg).forEach(b => b.onclick = () => this.copy($('#' + b.dataset.copy, bg).value, b.textContent.replace(/^Copy /, '').replace(/^./, c => c.toUpperCase())));
      this.wireGuide($('#akGuide', bg), 'kg', k.key);
    }
  };
  App.routes.ai = () => AiAccess.screen();

  /* The column headings of a list (Date, No, Type, Party / Account ...) sort it: a click sorts by that column, the
     next click the other way. A column of dates (dd/mm/yyyy) sorts by date, one of amounts by amount, the rest by
     text with the numbers in it in order (INV-9 before INV-10). A total line at the foot stays at the foot. Left
     alone: statements and grids (stmt, bank, attendance), headings without text, and lists whose rows come in pairs. */
  const TableSort = {
    SKIP: '.stmt, .bank, .alloc, .review, .mgmap, .attgrid, .tsgrid',
    // The rows that sort, or null when the body has lines of another shape between them
    rows(table) {
      const n = table.tHead.rows[0].cells.length, all = Array.from(table.tBodies[0] ? table.tBodies[0].rows : []);
      let i = 0; while (i < all.length && all[i].cells.length === n && !all[i].classList.contains('total')) i++;
      return all.slice(i).every(r => r.cells.length !== n || r.classList.contains('total')) ? all.slice(0, i) : null;
    },
    mark(root) {
      $$('table.list', root).forEach(t => {
        if (t.dataset.sorts || !t.tHead || !t.tHead.rows.length || t.tHead.rows.length > 1 || t.matches(this.SKIP)) return;
        const rows = this.rows(t); if (!rows || rows.length < 2) return;
        t.dataset.sorts = '1';
        Array.from(t.tHead.rows[0].cells).forEach(th => { if (th.textContent.trim() && !th.querySelector('input, select, button') && !th.dataset.dh && th.colSpan === 1) { th.classList.add('sortable'); th.title = th.title || 'Sort by ' + th.textContent.trim(); } });
      });
    },
    value(td) {
      const s = (td ? td.textContent : '').replace(/\s+/g, ' ').trim();
      if (!s || s === '-' || s === '—') return null;
      const d = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/.exec(s); if (d) return { d: +d[3] * 10000 + +d[2] * 100 + +d[1] };
      const m = s.replace(/[₹$,\s]|Rs\.?|INR|AED/gi, '').replace(/(Dr|Cr)$/i, ''); if (/^[-+]?\d*\.?\d+%?$/.test(m)) return { n: parseFloat(m) * (/Cr$/i.test(s) ? -1 : 1) };
      return { t: s };
    },
    sort(th) {
      const t = th.closest('table'), rows = this.rows(t); if (!rows) return;
      const col = th.cellIndex, dir = th.classList.contains('asc') ? -1 : 1;
      const vals = rows.map((r, i) => [r, this.value(r.cells[col]), i]), kinds = new Set(vals.filter(v => v[1]).map(v => Object.keys(v[1])[0]));
      const kind = kinds.size === 1 ? Array.from(kinds)[0] : 't';
      const key = (v) => kind === 't' ? (v.t !== undefined ? v.t : String(v.d !== undefined ? v.d : v.n)) : v[kind];
      vals.sort((a, b) => {
        if (!a[1] || !b[1]) return a[1] ? -1 : b[1] ? 1 : a[2] - b[2];   // the empty ones last, either way
        const x = key(a[1]), y = key(b[1]);
        return (kind === 't' ? String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) : x - y) * dir || a[2] - b[2];
      });
      const body = t.tBodies[0], foot = rows.length ? rows[rows.length - 1].nextSibling : null;
      vals.forEach(v => body.insertBefore(v[0], foot));
      $$('th.sortable', t).forEach(h => h.classList.remove('asc', 'desc')); th.classList.add(dir === 1 ? 'asc' : 'desc');
    },
    init() {
      let queued = false;
      new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; this.mark(document); }); }).observe(document.body, { childList: true, subtree: true });
      document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.colgrip')) return; const th = e.target.closest && e.target.closest('table.list th.sortable'); if (th) this.sort(th); });
      this.mark(document);
    }
  };
  if (document.body) TableSort.init(); else document.addEventListener('DOMContentLoaded', () => TableSort.init());

  /* The width of a list's columns is the user's to set. Every column heading has a grip at its right edge: dragging it
     makes that column wider or narrower (the table then keeps the widths given and scrolls sideways when they add up
     to more than the screen); a double click on a grip gives the table back its automatic widths. The widths are
     remembered on this device for that list (the screen and its headings), so it opens the same way the next time.
     Left alone: a list shown as cards on a phone (it has no columns), and headings that span several columns. */
  const TableCols = {
    KEY: 'blitzbook.colw', MIN: 40,
    saved() { try { const m = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } },
    keep(id, widths) { const m = this.saved(); if (widths) m[id] = widths; else delete m[id]; try { localStorage.setItem(this.KEY, JSON.stringify(m)); } catch (e) { /* storage blocked: the widths last until the screen is drawn again */ } },
    heads(t) { return Array.from(t.tHead.rows[0].cells); },
    // No columns to size while the list is shown as cards
    flat(t) { return getComputedStyle(t.tHead).display === 'none'; },
    clear(t) { t.classList.remove('sized'); t.style.tableLayout = ''; t.style.width = ''; this.heads(t).forEach(th => { th.style.width = ''; }); },
    apply(t, widths) {
      const ths = this.heads(t);
      if (!Array.isArray(widths) || widths.length !== ths.length || this.flat(t)) { this.clear(t); return false; }
      t.classList.add('sized'); t.style.tableLayout = 'fixed'; t.style.width = widths.reduce((s, w) => s + w, 0) + 'px';
      ths.forEach((th, i) => { th.style.width = widths[i] + 'px'; });
      return true;
    },
    mark(root) {
      $$('table.list', root).forEach(t => {
        if (t.dataset.cols || !t.tHead || t.tHead.rows.length !== 1) return;
        const ths = this.heads(t); if (ths.length < 2 || ths.some(th => th.colSpan !== 1)) return;
        t.dataset.cols = '1';
        // The same list is known by its screen and its headings, read before the grips go in
        t.dataset.colid = (App.current ? App.current.route + (App.current.params && App.current.params.tab ? '/' + App.current.params.tab : '') : '') + (t.id ? '#' + t.id : '') + '|' + ths.map(th => (th.firstChild && th.firstChild.nodeType === 3 ? th.firstChild.textContent : th.textContent).trim()).join('|');
        ths.forEach(th => { const g = document.createElement('span'); g.className = 'colgrip'; g.title = 'Drag to make this column wider or narrower; double-click for the automatic widths'; th.appendChild(g); });
        const w = this.saved()[t.dataset.colid]; if (w) this.apply(t, w);
      });
    },
    init() {
      let queued = false;
      new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; this.mark(document); }); }).observe(document.body, { childList: true, subtree: true });
      document.addEventListener('pointerdown', e => {
        const g = e.target.closest && e.target.closest('.colgrip'); if (!g || (e.button != null && e.button > 0)) return;
        const th = g.parentNode, t = th.closest('table'), ths = this.heads(t), at = ths.indexOf(th);
        // The widths as they stand on screen become the widths kept; the grip then moves its own column only
        const widths = ths.map(x => Math.round(x.getBoundingClientRect().width)), x0 = e.clientX, w0 = widths[at];
        e.preventDefault(); e.stopPropagation(); try { g.setPointerCapture(e.pointerId); } catch (err) { /* not captured: the moves still reach the grip while it is under the pointer */ }
        g.classList.add('on'); document.body.classList.add('colsizing');
        const move = (ev) => { widths[at] = Math.max(this.MIN, Math.round(w0 + ev.clientX - x0)); this.apply(t, widths); };
        const up = () => { g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); g.classList.remove('on'); document.body.classList.remove('colsizing'); if (widths[at] !== w0) this.keep(t.dataset.colid, widths); };
        g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
      });
      document.addEventListener('dblclick', e => { const g = e.target.closest && e.target.closest('.colgrip'); if (!g) return; const t = g.closest('table'); this.clear(t); this.keep(t.dataset.colid, null); UI.toast('Automatic column widths'); });
      // Turning the phone, or a window made narrow or wide: cards have no columns, a table gets its widths back
      let again = null; global.addEventListener('resize', () => { clearTimeout(again); again = setTimeout(() => { const m = this.saved(); $$('table.list[data-cols]').forEach(t => { const w = m[t.dataset.colid]; if (w) this.apply(t, w); }); }, 150); });
      this.mark(document);
    }
  };
  if (document.body) TableCols.init(); else document.addEventListener('DOMContentLoaded', () => TableCols.init());

  global.App = App; global.UI = UI; global.Auth = Auth; global.$ = $; global.$$ = $$; global.Company = Company; global.Subscription = Subscription; global.GetApp = GetApp; global.icon = icon; global.Theme = Theme; global.TableCols = TableCols; global.Tip = Tip; global.AiAccess = AiAccess; global.Pop = Pop; global.RowMenu = RowMenu;
})(window);
