/* BlitzBook web portal - inventory management. Stock is the sum of its movements: what came in on purchases and
   stock uploads, what went out on invoices, what recipes used when a dish was sold, and the adjustments, counts
   and transfers kept here. Modelled on what the inventory tools in use offer (Zoho Inventory, Odoo, TallyPrime,
   Petpooja): locations with transfers, adjustments with reasons (wastage, damage, expiry ...), physical counts
   that post the difference, reorder levels, recipes with food costing, FIFO / average / last-rate valuation, and
   the stock summary, movement, ageing, fast and slow movers, expiry and location reports.

   The 'inventory' collection (ivt:<id> on the server; the Android app leaves the prefix alone) holds:
     ADJ  an adjustment      { no, date, reason, location, notes, items: [{ name, qty (+ in / - out), uqc, rate }], countNo }
     TRF  a transfer         { no, date, from, to, notes, items: [{ name, qty, uqc }] }
     CNT  a stock count      { no, date, location, notes, lines: [{ name, system, counted }], adjNo }
     RCP  a recipe           { item (the dish), yield (portions), lines: [{ name, qty, uqc }] }
     ITM  an item's settings { item, minStock (reorder level), shelfDays }
     SET  the settings       { method: last | avg | fifo, locations: [...], consumeFrom }
   Purchases and sales always move the Main location; a transfer moves stock on to another (Kitchen, Bar ...).
   Books.stock (ledger.js) asks Inv.stock, so the balance sheet and Stock in Hand carry the same figures. */
(function (global) {
  'use strict';
  const { esc, num, money } = U;
  const MAIN = 'Main';
  const REASONS = ['Wastage', 'Damage / breakage', 'Expired', 'Theft / loss', 'Own use / staff meal', 'Free sample', 'Found / surplus', 'Opening correction', 'Other'];
  const LOSS = ['Wastage', 'Damage / breakage', 'Expired', 'Theft / loss'];
  const METHODS = { last: 'Last purchase rate', avg: 'Weighted average', fifo: 'FIFO (first in, first out)' };
  const TABS = [['overview', 'Overview'], ['moves', 'Movements'], ['adjust', 'Adjustments & Wastage'], ['count', 'Stock Count'], ['transfer', 'Transfers'], ['recipes', 'Recipes'], ['reports', 'Reports'], ['settings', 'Settings']];
  // A restaurant has dishes and recipes; everyone else has finished items and a bill of materials
  const food = () => !!(global.Biz && Biz.isRestaurant && Biz.isRestaurant());
  const W = () => food() ? { tab: 'Recipes', one: 'Recipe', dish: 'Dish', part: 'Ingredient', parts: 'Ingredients', unit: 'portion', pct: 'Food cost %', eg: 'e.g. Veg Biryani' } : { tab: 'Bill of Materials', one: 'Bill of materials', dish: 'Finished item', part: 'Material', parts: 'Materials', unit: 'unit', pct: 'Material cost %', eg: 'e.g. Office Chair' };
  const key = (n) => String(n || '').trim().toLowerCase();
  const all = () => Store.list('inventory');
  // In id order: where two devices each made a settings or an item record, all of them use the same one (the app does too)
  const docs = (kind) => all().filter(d => d.kind === kind).sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const save = (d) => { if (d.id && Store.find('inventory', d.id)) Store.update('inventory', d); else Store.add('inventory', d); return d; };
  const nextNo = (kind) => { let max = 0; all().forEach(d => { const m = new RegExp('^' + kind + '-(\\d+)$').exec(d.no || ''); if (m) max = Math.max(max, +m[1]); }); return kind + '-' + String(max + 1).padStart(4, '0'); };
  const byNo = (a, b) => U.dateMs(b.date) - U.dateMs(a.date) || String(b.no).localeCompare(String(a.no), undefined, { numeric: true });
  const qtyText = (q) => U.fmtQty(Math.round(num(q) * 1000) / 1000);
  const link = (no) => '<b>' + U.noLink(no) + '</b>';
  const T = (h, rows, empty) => Ledger.listTable(h, rows, empty), td = (l, v, c) => Ledger.td(l, v, c);
  const todayMs = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dmy = (ms) => { const d = new Date(ms); return U.pad(d.getDate()) + '/' + U.pad(d.getMonth() + 1) + '/' + d.getFullYear(); };

  const Inv = {
    REASONS, METHODS, MAIN, nextNo,
    // ---------------------------------------------------------------- settings, item settings, recipes
    settings() { const d = docs('SET')[0] || {}; const locs = Array.isArray(d.locations) && d.locations.length ? d.locations.slice() : [MAIN]; if (!locs.includes(MAIN)) locs.unshift(MAIN); return { id: d.id, kind: 'SET', method: METHODS[d.method] ? d.method : 'last', locations: locs, consumeFrom: locs.includes(d.consumeFrom) ? d.consumeFrom : MAIN }; },
    saveSettings(s) { const cur = docs('SET')[0]; save(Object.assign({}, cur || {}, s, { kind: 'SET' })); },
    // An item's inventory settings; until one is saved here the reorder level typed under Procurement (on the item) stands
    attr(name) { const k = key(name), d = docs('ITM').find(x => key(x.item) === k); if (d) return d; const it = Store.items().find(x => key(x.name) === k); return { kind: 'ITM', item: name, minStock: it ? num(it.minStock) : 0 }; },
    setAttr(name, patch) { const cur = this.attr(name); save(Object.assign({}, cur, patch, { kind: 'ITM', item: cur.item || name })); },
    recipeMap() { const m = new Map(); docs('RCP').forEach(r => { if (key(r.item) && (r.lines || []).length) m.set(key(r.item), r); }); return m; },

    // ---------------------------------------------------------------- the movements: every in and out, oldest first
    moves(asAt) {
      const inR = (d) => Books.inRange(d, null, asAt || null), out = [], rc = this.recipeMap(), s = this.settings();
      const push = (m) => out.push(Object.assign({ ms: U.dateMs(m.date) || 0, key: key(m.name), loc: MAIN, rate: 0, uqc: '', hsn: '', note: '' }, m));
      Store.list('purchases').forEach(p => { if (p.kind === 'QTN' || !inR(p.date)) return; (p.items || []).forEach(it => { const name = String(it.name || '').trim(); if (!it.stock || !name) return; push({ date: p.date, no: p.no, type: p.kind === 'STK' ? 'Opening / upload' : 'Purchase', name, qty: num(it.qty), rate: num(it.rate), uqc: it.uqc || '', hsn: it.hsn || '', note: p.supplier || '', seq: 0 }); }); });
      docs('ADJ').forEach(d => { if (!inR(d.date)) return; (d.items || []).forEach(it => { if (!key(it.name) || !num(it.qty)) return; push({ date: d.date, no: d.no, type: 'Adjustment', reason: d.reason || '', name: it.name, qty: num(it.qty), rate: num(it.rate), uqc: it.uqc || '', loc: d.location || MAIN, note: d.reason || '', seq: 2 }); }); });
      docs('TRF').forEach(d => { if (!inR(d.date)) return; (d.items || []).forEach(it => { const q = num(it.qty); if (!key(it.name) || q <= 0) return; push({ date: d.date, no: d.no, type: 'Transfer out', name: it.name, qty: -q, uqc: it.uqc || '', loc: d.from || MAIN, note: 'to ' + (d.to || ''), seq: 2 }); push({ date: d.date, no: d.no, type: 'Transfer in', name: it.name, qty: q, uqc: it.uqc || '', loc: d.to || MAIN, note: 'from ' + (d.from || ''), seq: 3 }); }); });
      // A sale takes a stock item out; the sale of a dish with a recipe takes its ingredients out instead
      const stockNames = new Set(out.map(m => m.key));
      Store.list('invoices').forEach(inv => { if (inv.kind !== 'invoice' || !inR(inv.date)) return; (inv.items || []).forEach(it => {
        const k = key(it.desc), q = num(it.qty); if (!k || !q) return;
        const r = rc.get(k);
        if (r) (r.lines || []).forEach(l => { const used = num(l.qty) * q / (num(r.yield) || 1); if (key(l.name) && used) push({ date: inv.date, no: inv.no, type: 'Used in recipe', name: l.name, qty: -used, uqc: l.uqc || '', loc: s.consumeFrom, note: String(it.desc).trim() + ' x ' + qtyText(q), seq: 1 }); });
        else if (stockNames.has(k)) push({ date: inv.date, no: inv.no, type: 'Sale', name: String(it.desc).trim(), qty: -q, note: String((inv.buyer && inv.buyer.name) || '').split('\n')[0].trim(), seq: 1 });
      }); });
      return out.sort((a, b) => a.ms - b.ms || a.seq - b.seq || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
    },
    /* Stock per item from the movements (of one location when given): bought, sold, used in recipes, adjusted, in
       hand, the last and the average rate, the FIFO layers still on the shelf, and the value by each method (value =
       the method under Settings). Without adjustments and recipes and on the last purchase rate this is exactly the
       bought - sold of before. */
    stock(asAt, loc) {
      const rows = new Map(), method = this.settings().method;
      const take = (r, q) => { while (q > 1e-9 && r.layers.length) { const l = r.layers[0], d = Math.min(l.qty, q); l.qty -= d; q -= d; if (l.qty <= 1e-9) r.layers.shift(); } };
      this.moves(asAt).forEach(m => {
        if (loc && m.loc !== loc) return;
        let r = rows.get(m.key);
        if (!r) { r = { name: m.name, hsn: '', uqc: '', purchased: 0, sold: 0, used: 0, adjusted: 0, moved: 0, lastRate: 0, inQty: 0, inCost: 0, layers: [], lastMs: 0 }; rows.set(m.key, r); }
        if (m.hsn && !r.hsn) r.hsn = m.hsn; if (m.uqc) r.uqc = m.uqc;
        if (m.type === 'Purchase' || m.type === 'Opening / upload') { r.purchased += m.qty; r.lastRate = m.rate; r.inQty += m.qty; r.inCost += m.qty * m.rate; r.layers.push({ qty: m.qty, rate: m.rate, date: m.date, ms: m.ms }); }
        else if (m.type === 'Sale') { r.sold -= m.qty; take(r, -m.qty); }
        else if (m.type === 'Used in recipe') { r.used -= m.qty; take(r, -m.qty); }
        else if (m.type === 'Adjustment') { r.adjusted += m.qty; if (m.qty > 0) { const rate = m.rate || r.lastRate; r.inQty += m.qty; r.inCost += m.qty * rate; r.layers.push({ qty: m.qty, rate, date: m.date, ms: m.ms }); if (!r.lastRate) r.lastRate = rate; } else take(r, -m.qty); }
        else r.moved += m.qty;
        r.lastMs = Math.max(r.lastMs, m.ms);
      });
      return Array.from(rows.values()).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())).map(r => {
        const onHand = r.purchased - r.sold - r.used + r.adjusted + (loc ? r.moved : 0), pos = Math.max(0, onHand), avgRate = r.inQty > 0 ? r.inCost / r.inQty : r.lastRate;
        const values = { last: pos * r.lastRate, avg: pos * avgRate, fifo: loc ? pos * avgRate : (onHand > 0 ? r.layers.reduce((s, l) => s + l.qty * l.rate, 0) : 0) };
        return Object.assign(r, { onHand, avgRate, values, value: values[method] });
      });
    },
    // Quantity of every item at every location
    byLocation(asAt) {
      const m = new Map(), locs = this.settings().locations;
      this.moves(asAt).forEach(x => { let r = m.get(x.key); if (!r) { r = { name: x.name, uqc: '', by: {} }; m.set(x.key, r); } if (x.uqc) r.uqc = x.uqc; r.by[x.loc] = (r.by[x.loc] || 0) + x.qty; });
      return { locs: Array.from(new Set(locs.concat(Array.from(m.values()).flatMap(r => Object.keys(r.by))))), rows: Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name)) };
    },
    // What is on the shelf lot by lot (the FIFO layers) with the day each lot expires, for the items with a shelf life
    lots() {
      const out = [], now = todayMs();
      this.stock(null).forEach(r => { const days = num(this.attr(r.name).shelfDays); if (!(days > 0)) return; r.layers.forEach(l => { if (l.qty <= 1e-9) return; const exp = l.ms + days * 86400000; out.push({ name: r.name, uqc: r.uqc, qty: l.qty, rate: l.rate, bought: l.date, expMs: exp, left: Math.round((exp - now) / 86400000) }); }); });
      return out.sort((a, b) => a.expMs - b.expMs);
    },
    lowStock() { return this.stock(null).map(r => Object.assign({ min: num(this.attr(r.name).minStock) }, r)).filter(r => r.onHand <= 0 || (r.min > 0 && r.onHand <= r.min)); },
    // What one portion of a dish costs: its ingredients at the rate the valuation method gives
    recipeCost(r, stockMap) { const method = this.settings().method; return (r.lines || []).reduce((s, l) => { const st = stockMap.get(key(l.name)); return s + num(l.qty) * (st ? (method === 'last' ? st.lastRate : st.avgRate) : 0); }, 0) / (num(r.yield) || 1); },
    names() { const s = new Set(this.stock(null).map(r => r.name)); Store.items().forEach(i => s.add(i.name)); return Array.from(s).sort((a, b) => a.localeCompare(b)); },

    // ---------------------------------------------------------------- the screen
    screen(p) {
      const tab = TABS.some(t => t[0] === p.tab) ? p.tab : 'overview';
      const body = { overview: () => this.overview(), moves: () => this.movesTab(p), adjust: () => this.adjustTab(), count: () => this.countTab(), transfer: () => this.transferTab(), recipes: () => this.recipesTab(), reports: () => this.reportsTab(p), settings: () => this.settingsTab() }[tab]();
      const root = App.view(App.header('Inventory', '<div class="btnrow" style="margin:0"><button class="btn sm green" id="ivAdj">+ Adjustment</button><button class="btn sm blue" id="ivCnt">+ Stock Count</button><button class="btn sm outline" id="ivTrf">+ Transfer</button><button class="btn sm outline" id="ivItems">Items</button><button class="btn sm outline" id="ivStock">Stock in Hand</button><button class="btn sm outline" id="ivProc">Procurement</button></div>') +
        '<div class="btnrow" style="margin-bottom:12px">' + TABS.map(t => '<button class="btn sm ' + (t[0] === tab ? 'blue' : 'outline') + '" data-tab="' + t[0] + '">' + (t[0] === 'recipes' ? W().tab : t[1]) + '</button>').join('') + '</div>' + body);
      App.wireBack(root);
      const again = () => App.go('inventory', Object.assign({}, p, { tab }));
      $$('[data-tab]', root).forEach(b => b.onclick = () => App.go('inventory', { tab: b.dataset.tab }));
      $('#ivAdj').onclick = () => this.editAdjust(null, () => App.go('inventory', { tab: 'adjust' }));
      $('#ivCnt').onclick = () => this.editCount(() => App.go('inventory', { tab: 'count' }));
      $('#ivTrf').onclick = () => this.editTransfer(() => App.go('inventory', { tab: 'transfer' }));
      $('#ivItems').onclick = () => App.go('items'); $('#ivStock').onclick = () => App.go('stock'); $('#ivProc').onclick = () => App.go('procurement', { tab: 'low' });
      $$('[data-go-tab]', root).forEach(b => b.onclick = () => App.go('inventory', { tab: b.dataset.goTab, rep: b.dataset.rep || '' }));
      $$('[data-del]', root).forEach(b => b.onclick = () => { const d = Store.find('inventory', b.dataset.del); UI.confirm('Delete ' + (d.no || 'this'), 'Delete ' + (d.no || 'it') + '? The stock goes back to what it was without it.' + (d.kind === 'CNT' && d.adjNo ? ' Its adjustment ' + d.adjNo + ' is deleted too.' : ''), () => { if (d.kind === 'CNT' && d.adjNo) { const a = docs('ADJ').find(x => x.no === d.adjNo && x.countNo === d.no); if (a) Store.delete('inventory', a.id); } Store.delete('inventory', d.id); UI.toast('Deleted'); again(); }, 'Delete'); });
      $$('[data-edit-rcp]', root).forEach(b => b.onclick = () => this.editRecipe(Store.find('inventory', b.dataset.editRcp), again));
      if ($('#rcNew')) $('#rcNew').onclick = () => this.editRecipe(null, again);
      if ($('#mvItem')) { const go = () => App.go('inventory', { tab: 'moves', item: $('#mvItem').value, loc: $('#mvLoc').value }); $('#mvItem').onchange = go; $('#mvLoc').onchange = go; $('#mvXls').onclick = () => this.movesXls(p); }
      if ($('#locAdd')) $('#locAdd').onclick = () => { const n = String(UI.val('locNew')).trim(), s = this.settings(); if (!n) return UI.toast('Type the location name'); if (s.locations.some(x => x.toLowerCase() === n.toLowerCase())) return UI.toast('That location is there already'); s.locations.push(n); this.saveSettings(s); UI.toast('Location ' + n + ' added'); again(); };
      $$('[data-rmloc]', root).forEach(b => b.onclick = () => { const n = b.dataset.rmloc, has = this.byLocation(null).rows.some(r => Math.abs(num(r.by[n])) > 1e-9); if (has) return UI.toast('There is stock at ' + n + ': transfer it out first', 5000); const s = this.settings(); s.locations = s.locations.filter(x => x !== n); if (s.consumeFrom === n) s.consumeFrom = MAIN; this.saveSettings(s); again(); });
      if ($('#stSave')) $('#stSave').onclick = () => { const s = this.settings(); s.method = UI.val('stMethod'); s.consumeFrom = UI.val('stFrom'); this.saveSettings(s); UI.toast('Inventory settings saved'); again(); };
      $$('input[data-attr]', root).forEach(i => i.onchange = () => { this.setAttr(i.dataset.item, { [i.dataset.attr]: num(i.value) }); UI.toast('Saved', 1500, 'ok'); });
      $$('[data-rep]', root).forEach(b => { if (!b.dataset.goTab) b.onclick = () => App.go('inventory', { tab: 'reports', rep: b.dataset.rep, from: p.from || '', to: p.to || '' }); });
      if ($('#rpFrom')) { const go = () => App.go('inventory', { tab: 'reports', rep: p.rep || 'summary', from: U.fromIso($('#rpFrom').value), to: U.fromIso($('#rpTo').value) }); $('#rpFrom').onchange = go; $('#rpTo').onchange = go; }
      if ($('#rpXls')) $('#rpXls').onclick = () => { const r = this.report(p); UI.xls('Inventory_' + r.title.replace(/[^A-Za-z0-9]+/g, '_'), r.headers.map(h => h.replace('#', '')), r.xls); };
    },

    // ---------------------------------------------------------------- overview
    overview() {
      const s = this.settings(), rows = this.stock(null), value = rows.reduce((t, r) => t + r.value, 0), inStock = rows.filter(r => r.onHand > 0).length, low = this.lowStock(), out = low.filter(r => r.onHand <= 0).length;
      const lots = this.lots(), exp = lots.filter(l => l.left <= 7), expired = exp.filter(l => l.left < 0).length;
      const now = new Date(), mStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime(), rate = new Map(rows.map(r => [key(r.name), r.lastRate]));
      const waste = this.moves(null).filter(m => m.type === 'Adjustment' && m.qty < 0 && LOSS.includes(m.reason) && m.ms >= mStart).reduce((t, m) => t + -m.qty * (rate.get(m.key) || 0), 0);
      const kpi = (k, v, sub, cls, tab, rep) => '<div class="kpi ' + (cls || '') + (tab ? ' tap' : '') + '"' + (tab ? ' data-go-tab="' + tab + '" data-rep="' + (rep || '') + '"' : '') + '><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + esc(sub) + '</div></div>';
      const recent = this.moves(null).slice(-8).reverse();
      return '<div class="kpis">' + kpi('Stock value', money(value), METHODS[s.method], '', 'reports', 'valuation') + kpi('Items in stock', inStock, rows.length + ' item' + (rows.length === 1 ? '' : 's') + ' tracked', '', 'reports', 'summary') +
        kpi('Low stock', low.length - out, 'at or under the reorder level', low.length - out ? 'warn' : '', 'settings') + kpi('Out of stock', out, 'nothing in hand', out ? 'bad' : '', 'reports', 'summary') +
        kpi('Expiring in 7 days', exp.length, expired ? expired + ' lot' + (expired === 1 ? '' : 's') + ' already past' : 'lots with a shelf life', exp.length ? (expired ? 'bad' : 'warn') : '', 'reports', 'expiry') +
        kpi('Wastage this month', money(waste), 'wastage, damage, expiry, loss', waste > 0 ? 'warn' : '', 'adjust') + '</div>' +
        '<div class="grid2"><div class="card white"><div class="hd">Needs attention</div><div class="bd">' + (low.length ? T(['Item', '#In hand', '#Reorder level', 'Status'], low.slice(0, 10).map(r => '<tr>' + td('Item', '<b>' + esc(r.name) + '</b>') + td('In hand', qtyText(r.onHand) + ' ' + esc(r.uqc), 'num') + td('Reorder level', r.min ? qtyText(r.min) : '-', 'num') + td('Status', r.onHand <= 0 ? '<span class="pill bad">Out of stock</span>' : '<span class="pill warn">Low</span>') + '</tr>')) + '<div class="btnrow" style="margin:10px 0 0"><button class="btn sm green" id="ovReq">Requisition for these</button></div>' : '<div class="hint">Every item is above its reorder level.</div>') + '</div></div>' +
        '<div class="card white"><div class="hd">Latest movements</div><div class="bd">' + (recent.length ? T(['Date', 'Item', 'Type', '#Qty'], recent.map(m => '<tr>' + td('Date', esc(m.date)) + td('Item', '<b>' + esc(m.name) + '</b>') + td('Type', esc(m.type)) + td('Qty', '<span class="' + (m.qty < 0 ? 'red' : 'green') + '">' + (m.qty > 0 ? '+' : '') + qtyText(m.qty) + '</span>', 'num') + '</tr>')) : '<div class="hint">No movements yet.</div>') + '</div></div></div>';
    },

    // ---------------------------------------------------------------- movements
    movesData(p) {
      const item = key(p.item), loc = p.loc || '', bal = new Map();
      return this.moves(null).filter(m => (!item || m.key === item) && (!loc || m.loc === loc)).map(m => { const b = (bal.get(m.key) || 0) + m.qty; bal.set(m.key, b); return Object.assign({ balance: b }, m); });
    },
    movesTab(p) {
      const s = this.settings(), rows = this.movesData(p).reverse(), names = Array.from(new Set(this.moves(null).map(m => m.name))).sort((a, b) => a.localeCompare(b));
      return '<div class="btnrow">' + UI.select('mvItem', names.map(n => [n, n]), p.item || '', { blank: 'All items', attrs: ' style="min-height:36px;max-width:260px"' }) + UI.select('mvLoc', s.locations.map(l => [l, l]), p.loc || '', { blank: 'All locations', attrs: ' style="min-height:36px;max-width:200px"' }) + '<button class="btn sm green" id="mvXls">Export Excel</button></div>' +
        T(['Date', 'No', 'Type', 'Item', 'Location', '#In', '#Out', '#Balance', 'Note'], rows.slice(0, 500).map(m => '<tr>' + td('Date', esc(m.date)) + td('No', link(m.no)) + td('Type', '<span class="pill ' + (m.qty < 0 ? (m.type === 'Sale' ? '' : 'warn') : 'ok') + '">' + esc(m.type) + '</span>') + td('Item', '<b>' + esc(m.name) + '</b>') + td('Location', esc(m.loc)) + td('In', m.qty > 0 ? qtyText(m.qty) : '', 'num') + td('Out', m.qty < 0 ? qtyText(-m.qty) : '', 'num') + td('Balance', qtyText(m.balance), 'num') + td('Note', esc(m.note || '')) + '</tr>'),
          'No movements yet.');
    },
    movesXls(p) { UI.xls('Stock_Movements', ['Date', 'No', 'Type', 'Item', 'Location', 'In', 'Out', 'Balance', 'Note'], this.movesData(p).map(m => [m.date, m.no, m.type, m.name, m.loc, m.qty > 0 ? m.qty : '', m.qty < 0 ? -m.qty : '', m.balance, m.note || ''])); },

    // ---------------------------------------------------------------- adjustments
    adjustTab() {
      const rate = new Map(this.stock(null).map(r => [key(r.name), r.lastRate]));
      return T(['No', 'Date', 'Reason', 'Location', 'Items', '#Value', 'Notes', ''], docs('ADJ').sort(byNo).map(d => { const val = (d.items || []).reduce((t, it) => t + num(it.qty) * (num(it.rate) || rate.get(key(it.name)) || 0), 0);
        return '<tr>' + td('No', link(d.no)) + td('Date', esc(d.date)) + td('Reason', '<span class="pill ' + (LOSS.includes(d.reason) ? 'warn' : '') + '">' + esc(d.reason || '-') + '</span>') + td('Location', esc(d.location || MAIN)) + td('Items', (d.items || []).map(it => esc(it.name) + ' ' + (num(it.qty) > 0 ? '+' : '') + qtyText(it.qty)).join(', ')) + td('Value', '<span class="' + (val < 0 ? 'red' : '') + '">' + money(val) + '</span>', 'num') + td('Notes', esc(d.notes || (d.countNo ? 'From ' + d.countNo : '-'))) + '<td class="actions">' + (d.countNo ? '' : '<button class="btn sm red" data-del="' + esc(d.id) + '">Delete</button>') + '</td></tr>'; }),
        'No adjustments yet.');
    },
    editAdjust(d, done) {
      const s = this.settings(), names = this.names(), stock = new Map(this.stock(null).map(r => [key(r.name), r]));
      d = Object.assign({ kind: 'ADJ', no: nextNo('ADJ'), date: U.today(), reason: REASONS[0], location: MAIN, notes: '', items: [] }, d || {});
      const lines = d.items.length ? d.items.map(it => ({ name: it.name, qty: Math.abs(num(it.qty)), rate: it.rate || '' })) : [{ name: '', qty: '', rate: '' }];
      let dir = d.items.length && num(d.items[0].qty) > 0 ? 'in' : 'out';
      const rowsHtml = () => lines.map((l, i) => '<tr data-i="' + i + '">' + td('Item', '<input data-k="name" list="ajDl" placeholder="Item" value="' + esc(l.name) + '">', 'desc') + td('In hand', '<span data-hand>' + (stock.get(key(l.name)) ? qtyText(stock.get(key(l.name)).onHand) + ' ' + esc(stock.get(key(l.name)).uqc) : '-') + '</span>', 'num') + td('Qty', '<input data-k="qty" class="num" type="number" min="0" step="any" value="' + esc(l.qty) + '">', 'qty') + td('Rate', '<input data-k="rate" class="num" type="number" min="0" step="any" placeholder="for stock added" value="' + esc(l.rate) + '">', 'rate') + '<td class="del"><button class="delbtn" data-rm title="Remove">🗑</button></td></tr>').join('');
      const bg = UI.modal({ title: 'Stock adjustment', wide: true, body: '<div class="grid3">' + UI.field('No', UI.input('ajNo', d.no)) + UI.field('Date', UI.dateInput('ajDate', d.date), { req: true }) + UI.field('Stock', UI.select('ajDir', [['out', 'Take out of stock'], ['in', 'Add to stock']], dir)) +
          UI.field('Reason', UI.select('ajReason', REASONS, d.reason)) + UI.field('Location', UI.select('ajLoc', s.locations, d.location)) + UI.field('Notes', UI.input('ajNotes', d.notes)) + '</div>' +
          '<div class="tablewrap" style="margin-top:8px"><table class="items" style="min-width:0"><thead><tr><th>Item</th><th class="qty">In hand</th><th class="qty">Qty</th><th class="rate">Rate</th><th class="del"></th></tr></thead><tbody id="ajRows">' + rowsHtml() + '</tbody></table></div>' + UI.datalist('ajDl', names) + '<div class="btnrow"><button class="btn sm" id="ajAdd">+ Add Item</button></div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const date = UI.dateVal('ajDate', bg); if (!date) { UI.toast('Enter the date'); return false; }
          const sign = UI.val('ajDir', bg) === 'in' ? 1 : -1, items = lines.filter(l => key(l.name) && num(l.qty) > 0).map(l => { const st = stock.get(key(l.name)); return { name: st ? st.name : U.nameCase(l.name), qty: sign * num(l.qty), uqc: st ? st.uqc : 'NOS', rate: num(l.rate) || (st ? st.lastRate : 0) }; });
          if (!items.length) { UI.toast('Add at least one item with a quantity'); return false; }
          Object.assign(d, { no: String(UI.val('ajNo', bg)).trim() || nextNo('ADJ'), date, reason: UI.val('ajReason', bg), location: UI.val('ajLoc', bg), notes: String(UI.val('ajNotes', bg)).trim(), items });
          save(d); UI.toast('Adjustment ' + d.no + ' saved'); if (done) done();
        } }] });
      const wire = () => $$('#ajRows tr', bg).forEach(tr => { const i = +tr.dataset.i; $$('[data-k]', tr).forEach(el => { const on = () => { lines[i][el.dataset.k] = el.value; if (el.dataset.k === 'name') { const st = stock.get(key(el.value)); $('[data-hand]', tr).textContent = st ? qtyText(st.onHand) + ' ' + st.uqc : '-'; } }; el.addEventListener('input', on); el.addEventListener('change', on); }); $('[data-rm]', tr).onclick = () => { lines.splice(i, 1); if (!lines.length) lines.push({ name: '', qty: '', rate: '' }); $('#ajRows', bg).innerHTML = rowsHtml(); wire(); }; });
      wire();
      $('#ajAdd', bg).onclick = () => { lines.push({ name: '', qty: '', rate: '' }); $('#ajRows', bg).innerHTML = rowsHtml(); wire(); const last = $$('#ajRows tr', bg).pop(); if (last) $('[data-k=name]', last).focus(); };
      return bg;
    },

    // ---------------------------------------------------------------- stock count: what is on the shelf against what the books say
    countTab() {
      return T(['No', 'Date', 'Location', '#Items counted', '#Differences', 'Adjustment', 'Notes', ''], docs('CNT').sort(byNo).map(d => { const diff = (d.lines || []).filter(l => Math.abs(num(l.counted) - num(l.system)) > 1e-9).length;
        return '<tr>' + td('No', link(d.no)) + td('Date', esc(d.date)) + td('Location', esc(d.location || MAIN)) + td('Counted', String((d.lines || []).length), 'num') + td('Differences', diff ? '<span class="red bold">' + diff + '</span>' : '0', 'num') + td('Adjustment', d.adjNo ? U.noLink(d.adjNo) : '<span class="pill ok">Matches</span>') + td('Notes', esc(d.notes || '-')) + '<td class="actions"><button class="btn sm red" data-del="' + esc(d.id) + '">Delete</button></td></tr>'; }),
        'No stock counts yet.');
    },
    editCount(done) {
      const s = this.settings();
      const body = (loc) => { const rows = this.stock(null, loc === MAIN && s.locations.length === 1 ? null : loc); return rows.length ? '<div class="tablewrap" style="margin-top:8px;max-height:46vh;overflow:auto"><table class="list"><thead><tr><th>Item</th><th class="num">In the books</th><th class="num">Counted</th><th class="num">Difference</th></tr></thead><tbody>' + rows.map(r => '<tr data-n="' + esc(r.name) + '" data-s="' + r.onHand + '" data-u="' + esc(r.uqc) + '" data-r="' + r.lastRate + '"><td><b>' + esc(r.name) + '</b></td><td class="num">' + qtyText(r.onHand) + ' ' + esc(r.uqc) + '</td><td class="num"><input type="number" min="0" step="any" class="cnt" placeholder="not counted" style="width:120px;min-height:32px;text-align:right"></td><td class="num" data-diff>-</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty">No stock at this location.</div>'; };
      const bg = UI.modal({ title: 'Stock count', wide: true, body: '<div class="grid3">' + UI.field('Date', UI.dateInput('ctDate', U.today()), { req: true }) + UI.field('Location', UI.select('ctLoc', s.locations, MAIN)) + UI.field('Notes', UI.input('ctNotes', '')) + '</div><div id="ctBody">' + body(MAIN) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Post count', cls: 'green', onClick: (bg) => {
          const date = UI.dateVal('ctDate', bg), loc = UI.val('ctLoc', bg); if (!date) { UI.toast('Enter the date'); return false; }
          const lines = $$('#ctBody tr[data-n]', bg).filter(tr => $('.cnt', tr).value !== '').map(tr => ({ name: tr.dataset.n, system: num(tr.dataset.s), counted: num($('.cnt', tr).value), uqc: tr.dataset.u, rate: num(tr.dataset.r) }));
          if (!lines.length) { UI.toast('Type what was counted for at least one item'); return false; }
          const c = { kind: 'CNT', no: nextNo('CNT'), date, location: loc, notes: String(UI.val('ctNotes', bg)).trim(), lines: lines.map(l => ({ name: l.name, system: l.system, counted: l.counted })), adjNo: '' };
          const diffs = lines.filter(l => Math.abs(l.counted - l.system) > 1e-9);
          if (diffs.length) { const a = save({ kind: 'ADJ', no: nextNo('ADJ'), date, reason: 'Stock count', location: loc, notes: 'Stock count ' + c.no, countNo: c.no, items: diffs.map(l => ({ name: l.name, qty: l.counted - l.system, uqc: l.uqc, rate: l.rate })) }); c.adjNo = a.no; }
          save(c); UI.toast(c.no + ': ' + (diffs.length ? diffs.length + ' difference' + (diffs.length === 1 ? '' : 's') + ' posted as ' + c.adjNo : 'everything matches the books'), 5000); if (done) done();
        } }] });
      const wire = () => $$('#ctBody .cnt', bg).forEach(i => i.oninput = () => { const tr = i.closest('tr'), d = i.value === '' ? null : num(i.value) - num(tr.dataset.s); $('[data-diff]', tr).innerHTML = d == null ? '-' : Math.abs(d) < 1e-9 ? '<span class="green">0</span>' : '<span class="red bold">' + (d > 0 ? '+' : '') + qtyText(d) + '</span>'; });
      wire(); $('#ctLoc', bg).onchange = (e) => { $('#ctBody', bg).innerHTML = body(e.target.value); wire(); };
      return bg;
    },

    // ---------------------------------------------------------------- locations and transfers
    transferTab() {
      const s = this.settings(), bl = this.byLocation(null);
      return '<div class="card white"><div class="hd">Locations</div><div class="bd"><div class="btnrow" style="margin:0 0 8px">' + s.locations.map(l => '<span class="pill" style="font-size:13px;padding:6px 12px">' + esc(l) + (l === MAIN ? '' : ' <button class="link small" data-rmloc="' + esc(l) + '" title="Remove">×</button>') + '</span>').join('') + '</div><div class="btnrow" style="margin:0">' + UI.input('locNew', '', { placeholder: 'e.g. Kitchen, Bar, Godown 2', attrs: ' style="max-width:260px;min-height:36px"' }) + '<button class="btn sm outline" id="locAdd">Add location</button></div></div></div>' +
        (s.locations.length > 1 ? '<div class="card white"><div class="hd">Stock by location</div><div class="bd">' + T(['Item'].concat(bl.locs.map(l => '#' + l)).concat(['#Total']), bl.rows.map(r => '<tr>' + td('Item', '<b>' + esc(r.name) + '</b>') + bl.locs.map(l => td(l, r.by[l] ? qtyText(r.by[l]) : '-', 'num')).join('') + td('Total', '<b>' + qtyText(bl.locs.reduce((t, l) => t + num(r.by[l]), 0)) + '</b> ' + esc(r.uqc), 'num') + '</tr>'), 'No stock yet.') + '</div></div>' : '') +
        T(['No', 'Date', 'From', 'To', 'Items', 'Notes', ''], docs('TRF').sort(byNo).map(d => '<tr>' + td('No', link(d.no)) + td('Date', esc(d.date)) + td('From', esc(d.from)) + td('To', esc(d.to)) + td('Items', (d.items || []).map(it => esc(it.name) + ' x ' + qtyText(it.qty)).join(', ')) + td('Notes', esc(d.notes || '-')) + '<td class="actions"><button class="btn sm red" data-del="' + esc(d.id) + '">Delete</button></td></tr>'),
          s.locations.length > 1 ? 'No transfers yet.' : 'Add a second location to transfer stock.');
    },
    editTransfer(done) {
      const s = this.settings();
      if (s.locations.length < 2) { UI.toast('Add a second location first (Transfers > Locations)', 5000); App.go('inventory', { tab: 'transfer' }); return; }
      const lines = [{ name: '', qty: '' }], at = () => new Map(this.stock(null, UI.val('tfFrom', bg)).map(r => [key(r.name), r]));
      const rowsHtml = () => lines.map((l, i) => '<tr data-i="' + i + '">' + td('Item', '<input data-k="name" list="tfDl" placeholder="Item" value="' + esc(l.name) + '">', 'desc') + td('There', '<span data-hand>-</span>', 'num') + td('Qty', '<input data-k="qty" class="num" type="number" min="0" step="any" value="' + esc(l.qty) + '">', 'qty') + '<td class="del"><button class="delbtn" data-rm title="Remove">🗑</button></td></tr>').join('');
      const bg = UI.modal({ title: 'Stock transfer', wide: true, body: '<div class="grid3">' + UI.field('Date', UI.dateInput('tfDate', U.today()), { req: true }) + UI.field('From', UI.select('tfFrom', s.locations, MAIN)) + UI.field('To', UI.select('tfTo', s.locations, s.locations.find(l => l !== MAIN))) + '</div>' +
          '<div class="tablewrap" style="margin-top:8px"><table class="items" style="min-width:0"><thead><tr><th>Item</th><th class="qty">At the source</th><th class="qty">Qty</th><th class="del"></th></tr></thead><tbody id="tfRows">' + rowsHtml() + '</tbody></table></div>' + UI.datalist('tfDl', this.names()) + '<div class="btnrow"><button class="btn sm" id="tfAdd">+ Add Item</button></div>' + UI.field('Notes', UI.input('tfNotes', '')),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Transfer', cls: 'green', onClick: (bg) => {
          const date = UI.dateVal('tfDate', bg), from = UI.val('tfFrom', bg), to = UI.val('tfTo', bg), st = at();
          if (!date) { UI.toast('Enter the date'); return false; } if (from === to) { UI.toast('From and To are the same location'); return false; }
          const items = lines.filter(l => key(l.name) && num(l.qty) > 0).map(l => { const r = st.get(key(l.name)); return { name: r ? r.name : U.nameCase(l.name), qty: num(l.qty), uqc: r ? r.uqc : 'NOS', have: r ? r.onHand : 0 }; });
          if (!items.length) { UI.toast('Add at least one item with a quantity'); return false; }
          const short = items.find(it => it.qty > it.have + 1e-9); if (short) { UI.toast('Only ' + qtyText(short.have) + ' of ' + short.name + ' at ' + from, 5000); return false; }
          const d = save({ kind: 'TRF', no: nextNo('TRF'), date, from, to, notes: String(UI.val('tfNotes', bg)).trim(), items: items.map(it => ({ name: it.name, qty: it.qty, uqc: it.uqc })) });
          UI.toast(d.no + ': moved to ' + to); if (done) done();
        } }] });
      const hands = () => { const st = at(); $$('#tfRows tr', bg).forEach(tr => { const r = st.get(key(lines[+tr.dataset.i].name)); $('[data-hand]', tr).textContent = r ? qtyText(r.onHand) + ' ' + r.uqc : '-'; }); };
      const wire = () => { $$('#tfRows tr', bg).forEach(tr => { const i = +tr.dataset.i; $$('[data-k]', tr).forEach(el => { const on = () => { lines[i][el.dataset.k] = el.value; if (el.dataset.k === 'name') hands(); }; el.addEventListener('input', on); el.addEventListener('change', on); }); $('[data-rm]', tr).onclick = () => { lines.splice(i, 1); if (!lines.length) lines.push({ name: '', qty: '' }); $('#tfRows', bg).innerHTML = rowsHtml(); wire(); }; }); hands(); };
      wire(); $('#tfFrom', bg).onchange = hands;
      $('#tfAdd', bg).onclick = () => { lines.push({ name: '', qty: '' }); $('#tfRows', bg).innerHTML = rowsHtml(); wire(); };
      return bg;
    },

    // ---------------------------------------------------------------- recipes: what a dish uses, and what it costs
    recipesTab() {
      const st = new Map(this.stock(null).map(r => [key(r.name), r])), items = new Map(Store.items().map(i => [key(i.name), i]));
      const w = W();
      return '<div class="btnrow"><button class="btn sm green" id="rcNew">+ ' + w.one + '</button></div>' +
        T([w.dish, w.parts, '#Cost / ' + w.unit, '#Selling price', '#' + w.pct, ''], docs('RCP').sort((a, b) => String(a.item).localeCompare(String(b.item))).map(r => { const cost = this.recipeCost(r, st), m = items.get(key(r.item)), g = m ? num(m.gst) : 0, price = m && num(m.rate) > 0 ? (Biz.chargesGst() ? num(m.rate) / (1 + g / 100) : num(m.rate)) : 0;
          return '<tr>' + td('Dish', '<b>' + esc(r.item) + '</b>' + (num(r.yield) > 1 ? ' <span class="small muted">makes ' + qtyText(r.yield) + '</span>' : '')) + td('Ingredients', (r.lines || []).map(l => esc(l.name) + ' ' + qtyText(l.qty) + ' ' + esc(l.uqc || '')).join(', ')) + td('Cost', money(cost), 'num') + td('Price', price ? money(price) : '-', 'num') + td('Food cost', price ? '<span class="pill ' + (cost / price > 0.4 ? 'bad' : cost / price > 0.3 ? 'warn' : 'ok') + '">' + (cost / price * 100).toFixed(1) + '%</span>' : '-', 'num') +
            '<td class="actions"><button class="btn sm outline" data-edit-rcp="' + esc(r.id) + '">Edit</button><button class="btn sm red" data-del="' + esc(r.id) + '">Delete</button></td></tr>'; }),
          food() ? 'No recipes yet. A recipe lists what one portion of a dish uses; each sale of the dish then takes those out of stock.' : 'No bills of materials yet. One lists what a finished item is made of; each sale of the item then takes those out of stock.');
    },
    editRecipe(r, done) {
      const w = W();
      r = Object.assign({ kind: 'RCP', item: '', yield: 1, lines: [] }, r ? JSON.parse(JSON.stringify(r)) : {});
      const lines = r.lines.length ? r.lines : [{ name: '', qty: '', uqc: '' }], st = new Map(this.stock(null).map(x => [key(x.name), x]));
      const rowsHtml = () => lines.map((l, i) => '<tr data-i="' + i + '">' + td(w.part, '<input data-k="name" list="rcDl" placeholder="Stock item" value="' + esc(l.name) + '">', 'desc') + td('Qty', '<input data-k="qty" class="num" type="number" min="0" step="any" value="' + esc(l.qty) + '">', 'qty') + td('Unit', UI.select('', U.UQC_CODES, l.uqc || (st.get(key(l.name)) || {}).uqc || 'NOS', { attrs: ' data-k="uqc"' }), 'uqc') + '<td class="del"><button class="delbtn" data-rm title="Remove">🗑</button></td></tr>').join('');
      const bg = UI.modal({ title: w.one, wide: true, body: '<div class="grid2">' + UI.field(w.dish + ' (as on the invoice)', UI.input('rcItem', r.item, { list: 'rcItemsDl', placeholder: w.eg }) + UI.datalist('rcItemsDl', Store.items().map(i => i.name)), { req: true }) + UI.field(food() ? 'Portions this makes' : 'Units this makes', UI.input('rcYield', r.yield, { type: 'number', attrs: ' min="1" step="any"' })) + '</div>' +
          '<div class="tablewrap" style="margin-top:8px"><table class="items" style="min-width:0"><thead><tr><th>' + w.part + '</th><th class="qty">Qty</th><th class="uqc">Unit</th><th class="del"></th></tr></thead><tbody id="rcRows">' + rowsHtml() + '</tbody></table></div>' + UI.datalist('rcDl', this.names()) + '<div class="btnrow"><button class="btn sm" id="rcAdd">+ Add ' + w.part + '</button></div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const item = String(UI.val('rcItem', bg)).trim(); if (!item) { UI.mark('rcItem', true, bg); UI.toast('Enter the ' + w.dish.toLowerCase()); return false; }
          const m = Biz.findMaster(item), name = m && !m.hidden ? m.name : U.nameCase(item);
          if (docs('RCP').some(x => key(x.item) === key(name) && x.id !== r.id)) { UI.toast(name + ' has one already'); return false; }
          const ls = lines.filter(l => key(l.name) && num(l.qty) > 0).map(l => { const x = st.get(key(l.name)); return { name: x ? x.name : U.nameCase(l.name), qty: num(l.qty), uqc: l.uqc || (x ? x.uqc : 'NOS') }; });
          if (!ls.length) { UI.toast('Add at least one ' + w.part.toLowerCase() + ' with a quantity'); return false; }
          if (ls.some(l => key(l.name) === key(name))) { UI.toast(name + ' cannot be made of itself'); return false; }
          Object.assign(r, { item: name, yield: Math.max(1, num(UI.val('rcYield', bg)) || 1), lines: ls }); save(r); UI.toast(w.one + ' for ' + name + ' saved'); if (done) done();
        } }] });
      const wire = () => $$('#rcRows tr', bg).forEach(tr => { const i = +tr.dataset.i; $$('[data-k]', tr).forEach(el => { const on = () => { lines[i][el.dataset.k] = el.value; if (el.dataset.k === 'name') { const x = st.get(key(el.value)); if (x && x.uqc) { lines[i].uqc = x.uqc; $('[data-k=uqc]', tr).value = x.uqc; } } }; el.addEventListener('input', on); el.addEventListener('change', on); }); $('[data-rm]', tr).onclick = () => { lines.splice(i, 1); if (!lines.length) lines.push({ name: '', qty: '', uqc: '' }); $('#rcRows', bg).innerHTML = rowsHtml(); wire(); }; });
      wire(); $('#rcAdd', bg).onclick = () => { lines.push({ name: '', qty: '', uqc: '' }); $('#rcRows', bg).innerHTML = rowsHtml(); wire(); const last = $$('#rcRows tr', bg).pop(); if (last) $('[data-k=name]', last).focus(); };
      return bg;
    },

    // ---------------------------------------------------------------- reports
    report(p) {
      const rep = ['summary', 'valuation', 'ageing', 'movers', 'expiry'].includes(p.rep) ? p.rep : 'summary', now = todayMs();
      if (rep === 'valuation') { const rows = this.stock(null).filter(r => r.onHand > 0), sum = (k) => rows.reduce((t, r) => t + r.values[k], 0);
        return { rep, title: 'Stock valuation', headers: ['Item', '#In hand', '#Last rate', '#Average rate', '#At last rate', '#At average', '#FIFO'], rows: rows.map(r => '<tr>' + td('Item', '<b>' + esc(r.name) + '</b>') + td('In hand', qtyText(r.onHand) + ' ' + esc(r.uqc), 'num') + td('Last', U.indianNumber(r.lastRate), 'num') + td('Average', U.indianNumber(r.avgRate), 'num') + td('At last', money(r.values.last), 'num') + td('At average', money(r.values.avg), 'num') + td('FIFO', money(r.values.fifo), 'num') + '</tr>').concat(rows.length ? ['<tr class="total"><td>Total</td><td></td><td></td><td></td><td class="num">' + money(sum('last')) + '</td><td class="num">' + money(sum('avg')) + '</td><td class="num">' + money(sum('fifo')) + '</td></tr>'] : []),
          xls: rows.map(r => [r.name, r.onHand, r.lastRate, r.avgRate, r.values.last, r.values.avg, r.values.fifo]), empty: 'Nothing in stock.' }; }
      if (rep === 'ageing') { const rows = this.stock(null).filter(r => r.onHand > 0).map(r => Object.assign({ days: r.lastMs ? Math.round((now - r.lastMs) / 86400000) : 0 }, r)).sort((a, b) => b.days - a.days);
        return { rep, title: 'Stock ageing', headers: ['Item', '#In hand', '#Value', 'Last movement', '#Days idle', 'Status'], rows: rows.map(r => '<tr>' + td('Item', '<b>' + esc(r.name) + '</b>') + td('In hand', qtyText(r.onHand) + ' ' + esc(r.uqc), 'num') + td('Value', money(r.value), 'num') + td('Last movement', r.lastMs ? dmy(r.lastMs) : '-') + td('Days', String(r.days), 'num') + td('Status', r.days > 90 ? '<span class="pill bad">Dead stock</span>' : r.days > 30 ? '<span class="pill warn">Slow</span>' : '<span class="pill ok">Moving</span>') + '</tr>'),
          xls: rows.map(r => [r.name, r.onHand, r.value, r.lastMs ? dmy(r.lastMs) : '', r.days, r.days > 90 ? 'Dead stock' : r.days > 30 ? 'Slow' : 'Moving']), empty: 'Nothing in stock.' }; }
      if (rep === 'movers') { const since = now - 90 * 86400000, st = new Map(this.stock(null).map(r => [r.name.toLowerCase(), r])), use = new Map();
        this.moves(null).forEach(m => { if (m.ms < since || !(m.type === 'Sale' || m.type === 'Used in recipe')) return; const u = use.get(m.key) || { name: m.name, qty: 0 }; u.qty += -m.qty; use.set(m.key, u); });
        const rows = Array.from(use.values()).map(u => { const r = st.get(u.name.toLowerCase()) || {}; return Object.assign(u, { name: r.name || u.name, uqc: r.uqc || '', value: u.qty * (r.avgRate || r.lastRate || 0), onHand: r.onHand || 0 }); }).sort((a, b) => b.value - a.value), total = rows.reduce((t, r) => t + r.value, 0); let run = 0;
        rows.forEach(r => { const before = total ? run / total : 0; run += r.value; r.cls = before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C'; r.cover = r.qty > 0 ? Math.round(r.onHand / (r.qty / 90)) : 0; });
        return { rep, title: 'Fast and slow movers (90 days)', headers: ['Item', '#Used / sold', '#Value used', 'Class', '#In hand', '#Days of cover'], rows: rows.map(r => '<tr>' + td('Item', '<b>' + esc(r.name) + '</b>') + td('Used', qtyText(r.qty) + ' ' + esc(r.uqc), 'num') + td('Value', money(r.value), 'num') + td('Class', '<span class="pill ' + (r.cls === 'A' ? 'ok' : r.cls === 'B' ? '' : 'warn') + '">' + r.cls + '</span>') + td('In hand', qtyText(r.onHand), 'num') + td('Cover', r.cover > 0 ? String(r.cover) : '-', 'num') + '</tr>'),
          xls: rows.map(r => [r.name, r.qty, r.value, r.cls, r.onHand, r.cover]), empty: 'Nothing was sold or used in the last 90 days.' }; }
      if (rep === 'expiry') { const lots = this.lots();
        return { rep, title: 'Expiry', headers: ['Item', '#Qty', 'Came in', 'Expires', '#Days left', 'Status'], rows: lots.map(l => '<tr>' + td('Item', '<b>' + esc(l.name) + '</b>') + td('Qty', qtyText(l.qty) + ' ' + esc(l.uqc), 'num') + td('Came in', esc(l.bought)) + td('Expires', dmy(l.expMs)) + td('Days left', String(l.left), 'num') + td('Status', l.left < 0 ? '<span class="pill bad">Expired</span>' : l.left <= 7 ? '<span class="pill warn">Use first</span>' : '<span class="pill ok">Fresh</span>') + '</tr>'),
          xls: lots.map(l => [l.name, l.qty, l.bought, dmy(l.expMs), l.left, l.left < 0 ? 'Expired' : l.left <= 7 ? 'Use first' : 'Fresh']), empty: 'No lots to watch. Set a shelf life per item under Settings.' }; }
      // stock summary over a period: opening, in, out, closing
      const d = new Date(), from = p.from || ('01/' + U.pad(d.getMonth() + 1) + '/' + d.getFullYear()), to = p.to || U.today(), a = U.dateMs(from), b = U.dateMs(to), m = new Map();
      this.moves(b).forEach(x => { if (x.type === 'Transfer in' || x.type === 'Transfer out') return; let r = m.get(x.key); if (!r) { r = { name: x.name, uqc: '', open: 0, inQ: 0, outQ: 0, adj: 0 }; m.set(x.key, r); } if (x.uqc) r.uqc = x.uqc; if (x.ms < a) r.open += x.qty; else if (x.type === 'Adjustment') r.adj += x.qty; else if (x.qty > 0) r.inQ += x.qty; else r.outQ += -x.qty; });
      const val = new Map(this.stock(b).map(r => [r.name.toLowerCase(), r.value])), rows = Array.from(m.values()).sort((x, y) => x.name.localeCompare(y.name)).map(r => Object.assign(r, { close: r.open + r.inQ - r.outQ + r.adj, value: val.get(r.name.toLowerCase()) || 0 }));
      return { rep: 'summary', from, to, title: 'Stock summary ' + from + ' to ' + to, headers: ['Item', '#Opening', '#In', '#Out', '#Adjusted', '#Closing', '#Value'], rows: rows.map(r => '<tr>' + td('Item', '<b>' + esc(r.name) + '</b>' + (r.uqc ? ' <span class="small muted">' + esc(r.uqc) + '</span>' : '')) + td('Opening', qtyText(r.open), 'num') + td('In', qtyText(r.inQ), 'num') + td('Out', qtyText(r.outQ), 'num') + td('Adjusted', r.adj ? '<span class="' + (r.adj < 0 ? 'red' : 'green') + '">' + (r.adj > 0 ? '+' : '') + qtyText(r.adj) + '</span>' : '-', 'num') + td('Closing', '<b class="' + (r.close <= 0 ? 'red' : '') + '">' + qtyText(r.close) + '</b>', 'num') + td('Value', money(r.value), 'num') + '</tr>').concat(rows.length ? ['<tr class="total"><td>Total</td><td></td><td></td><td></td><td></td><td></td><td class="num">' + money(rows.reduce((t, r) => t + r.value, 0)) + '</td></tr>'] : []),
        xls: rows.map(r => [r.name, r.open, r.inQ, r.outQ, r.adj, r.close, r.value]), empty: 'No stock movements up to ' + to + '.' };
    },
    reportsTab(p) {
      const r = this.report(p), reps = [['summary', 'Stock summary'], ['valuation', 'Valuation'], ['ageing', 'Ageing'], ['movers', 'Fast & slow movers'], ['expiry', 'Expiry']];
      return '<div class="btnrow">' + reps.map(x => '<button class="btn sm ' + (x[0] === r.rep ? '' : 'outline') + '" data-rep="' + x[0] + '">' + x[1] + '</button>').join('') + (r.rep === 'summary' ? UI.input('rpFrom', U.toIso(r.from), { type: 'date', attrs: ' style="width:160px;min-height:36px"' }) + UI.input('rpTo', U.toIso(r.to), { type: 'date', attrs: ' style="width:160px;min-height:36px"' }) : '') + '<button class="btn sm green" id="rpXls">Export Excel</button></div>' + T(r.headers, r.rows, r.empty);
    },

    // ---------------------------------------------------------------- settings
    settingsTab() {
      const s = this.settings(), rows = this.stock(null), names = new Map(rows.map(r => [key(r.name), r]));
      Store.items().forEach(i => { if (!names.has(key(i.name))) names.set(key(i.name), { name: i.name, uqc: '', onHand: 0 }); });
      return '<div class="card white"><div class="hd">Valuation</div><div class="bd"><div class="grid3">' + UI.field('Value the stock at', UI.select('stMethod', Object.keys(METHODS).map(k => [k, METHODS[k]]), s.method)) + UI.field(food() ? 'Recipes take their ingredients from' : 'Materials are taken from', UI.select('stFrom', s.locations, s.consumeFrom)) + '<div class="field"><label>&nbsp;</label><button class="btn green" id="stSave">Save settings</button></div></div></div></div>' +
        '<div class="card white"><div class="hd">Reorder level and shelf life per item</div><div class="bd">' + T(['Item', '#In hand', '#Reorder level', '#Shelf life (days)'], Array.from(names.values()).sort((a, b) => a.name.localeCompare(b.name)).map(r => { const a = this.attr(r.name); return '<tr>' + td('Item', '<b>' + esc(r.name) + '</b>') + td('In hand', qtyText(r.onHand) + ' ' + esc(r.uqc || ''), 'num') + td('Reorder level', '<input type="number" min="0" step="any" data-attr="minStock" data-item="' + esc(r.name) + '" value="' + (num(a.minStock) || '') + '" style="width:110px;min-height:32px;text-align:right">', 'num') + td('Shelf life', '<input type="number" min="0" step="1" data-attr="shelfDays" data-item="' + esc(r.name) + '" value="' + (num(a.shelfDays) || '') + '" placeholder="does not expire" style="width:130px;min-height:32px;text-align:right">', 'num') + '</tr>'; }), 'No items yet.') + '</div></div>';
    }
  };
  App.routes.inventory = (p) => { p = p || {}; if (!p.tab) p.tab = 'overview'; Inv.screen(p); App.markNav('inventory', p); if ($('#ovReq')) $('#ovReq').onclick = () => App.go('procurement', { tab: 'low' }); };
  global.Inv = Inv;
})(window);
