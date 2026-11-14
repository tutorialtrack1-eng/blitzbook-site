/* BlitzBook web portal - currencies and exchange rates.

   The books are kept in rupees (GST is). This file adds the other currencies a company deals in:
     - the company's table of currencies with their exchange rates (the 'fx' record of the books, synced like the
       HR settings): { rates: { USD: 83.2, ... }, at: when they were last fetched or typed }. A rate is the rupees
       one unit of the currency is worth.
     - the currency the login looks at the books in (kept for the login in this browser): every amount of the
       portal then carries its value in that currency beside the rupees, or instead of them (U.money reads U.fx).
       What is printed for a customer, the GST returns and the emails stay in rupees.
     - a currency and an exchange rate on an invoice (inv.fx = { code, rate }): the invoice is entered and booked in
       rupees, and shows and prints its total in that currency at that rate.
     - a converter, and the day's rates fetched from open.er-api.com (no key; nothing of the books is sent). */
(function (global) {
  'use strict';
  const { esc, num } = U;
  const CODES = U.CURRENCIES.map(c => c.code);
  const Currency = {
    doc() { const d = Store.get('fx', null) || {}; const rates = {}; Object.keys(d.rates && typeof d.rates === 'object' ? d.rates : {}).forEach(k => { const v = num(d.rates[k]); if (CODES.includes(k) && v > 0) rates[k] = v; }); return { rates, at: num(d.at), source: String(d.source || '') }; },
    save(d) { return Store.set('fx', { rates: d.rates, at: d.at || Date.now(), source: d.source || '' }); },
    rates() { return this.doc().rates; },
    rate(code) { return code === 'INR' ? 1 : num(this.rates()[code]); },
    codes() { return Object.keys(this.rates()).sort(); },
    info(code) { return U.CURRENCIES.find(c => c.code === code) || { code, symbol: code, name: code }; },
    mayEdit() { return Companies.mayWrite('fx') && (!Store.cid || ['owner', 'admin', 'accountant'].includes(Companies.role())); },
    // ---- what this login looks at the books in: { code, mode: 'both' | 'only' }
    key() { return 'fx_show:' + (Store.cid || 'own'); },
    shown() { const v = App.user ? (Store.peek(App.user.id, this.key(), null) || {}) : {}; return { code: CODES.includes(v.code) ? v.code : '', mode: v.mode === 'only' ? 'only' : 'both' }; },
    show(code, mode) { if (App.user) Store.poke(App.user.id, this.key(), { code: code || '', mode: mode || this.shown().mode }); this.apply(); if (App.user && $('#view')) { App.refreshBar(); App.refresh(); } },
    // Puts the choice where U.money finds it (after login, a company switch, a sync round, a change of the rates)
    apply() { const s = App.user && Store.uid ? this.shown() : { code: '' }, r = s.code ? this.rate(s.code) : 0; U.fx = s.code && r > 0 ? { code: s.code, rate: r, mode: s.mode } : null; },
    convert(amount, from, to) { const a = this.rate(from), b = this.rate(to); return a > 0 && b > 0 ? num(amount) * a / b : 0; },
    // The chip of the top bar: pick the currency the amounts are shown in
    pick() {
      const codes = this.codes(), cur = this.shown();
      const items = ['₹ Rupees only'].concat(codes.map(c => c + ' - ' + this.info(c).name + '  (1 ' + c + ' = ' + U.inr(this.rate(c)) + ')')).concat(['Currencies & exchange rates…']);
      UI.menu('Show amounts in', items, (i) => { if (i === items.length - 1) App.go('currency'); else this.show(i === 0 ? '' : codes[i - 1]); }, cur.code ? codes.indexOf(cur.code) + 1 : 0);
    },
    // The day's rates: rupees for one unit of every currency (open.er-api.com gives units per rupee)
    async fetchRates() {
      const res = await fetch('https://open.er-api.com/v6/latest/INR', { cache: 'no-store' });
      if (!res.ok) throw new Error('The rates could not be fetched (' + res.status + ')');
      const j = await res.json(), out = {};
      if (!j || j.result !== 'success' || !j.rates) throw new Error('The rates could not be read');
      CODES.forEach(c => { const v = num(j.rates[c]); if (v > 0) out[c] = Math.round(1 / v * 10000) / 10000; });
      return out;
    },
    screen() {
      const d = this.doc(), edit = this.mayEdit(), cur = this.shown(), codes = Object.keys(d.rates).sort();
      const when = d.at ? U.dmy(new Date(d.at)) + ' ' + U.pad(new Date(d.at).getHours()) + ':' + U.pad(new Date(d.at).getMinutes()) : '';
      const root = App.view(App.header('Currencies & Exchange Rates', edit ? '<div class="btnrow" style="margin:0"><button class="btn sm blue" id="fxFetch">Get today\'s rates</button><button class="btn sm green" id="fxSave">Save rates</button></div>' : '') +
        '<div class="hint" style="margin-bottom:10px">The books are kept in rupees (₹), and so are GST and what is printed. Here are the other currencies ' + esc(Companies.currentName() || 'the company') + ' deals in, each with its exchange rate: the rupees one unit is worth. An invoice can carry a currency and its rate; every amount of the portal can be shown in a currency beside the rupees.</div>' +
        '<div class="card white"><div class="hd">Show amounts in</div><div class="bd"><div class="grid2">' +
          UI.field('Currency', UI.select('fxShow', [['', '₹ Rupees only']].concat(codes.map(c => [c, c + ' - ' + this.info(c).name])), cur.code), { hint: 'For your login in this browser. The choice is also on the currency button at the top right.' }) +
          UI.field('How', UI.select('fxMode', [['both', 'Rupees with the converted amount beside: ₹ 1,00,000.00 (≈ $ 1,201.92)'], ['only', 'The converted amount only: $ 1,201.92']], cur.mode)) + '</div></div></div>' +
        '<div class="card white"><div class="hd">Exchange rates' + (when ? ' <span class="small muted" style="margin-left:8px;text-transform:none;letter-spacing:0">as of ' + esc(when) + (d.source ? ' · ' + esc(d.source) : '') + '</span>' : '') + '</div><div class="bd">' +
          (codes.length ? '<div class="tablewrap"><table class="list" id="fxTable"><thead><tr><th>Currency</th><th></th><th class="num">1 unit = ₹</th><th class="num">₹ 1,000 =</th>' + (edit ? '<th></th>' : '') + '</tr></thead><tbody>' +
            codes.map(c => '<tr data-code="' + c + '"><td><b>' + c + '</b></td><td class="left">' + esc(this.info(c).name) + ' (' + esc(this.info(c).symbol) + ')</td><td class="num">' + (edit ? '<input class="fxRate" type="number" min="0" step="any" value="' + d.rates[c] + '" style="width:130px;text-align:right">' : U.indianNumber(d.rates[c])) + '</td><td class="num fxK">' + esc(U.fxMoney(1000 / d.rates[c], c)) + '</td>' + (edit ? '<td class="actions"><button class="btn sm red outline" data-fxdel="' + c + '">Remove</button></td>' : '') + '</tr>').join('') + '</tbody></table></div>'
            : '<div class="hint">No currencies yet.' + (edit ? ' Add the ones you deal in below, or press Get today\'s rates for the common ones.' : '') + '</div>') +
          (edit ? '<div class="btnrow" style="margin-top:10px">' + UI.select('fxAddCode', U.CURRENCIES.filter(c => c.code !== 'INR' && !codes.includes(c.code)).map(c => [c.code, c.code + ' - ' + c.name]), '', { blank: '— add a currency —', attrs: ' style="min-height:36px"' }) + UI.input('fxAddRate', '', { type: 'number', placeholder: '1 unit = ₹', attrs: ' min="0" step="any" style="width:150px;min-height:36px"' }) + '<button class="btn sm outline" id="fxAdd">Add</button></div><div class="hint">Leave the rate blank to have today\'s rate filled in.</div>' : '') + '</div></div>' +
        '<div class="card white"><div class="hd">Converter</div><div class="bd"><div class="btnrow" style="margin:0;align-items:center">' + UI.input('fxAmt', '1000', { type: 'number', attrs: ' min="0" step="any" style="width:160px;min-height:36px"' }) + UI.select('fxFrom', [['INR', 'INR']].concat(codes.map(c => [c, c])), 'INR', { attrs: ' style="min-height:36px"' }) + '<span class="muted">is</span><b id="fxOut" style="font-size:18px"></b>' + UI.select('fxTo', [['INR', 'INR']].concat(codes.map(c => [c, c])), codes[0] || 'INR', { attrs: ' style="min-height:36px"' }) + '</div><div class="hint" id="fxLine" style="margin-top:6px"></div></div></div>');
      App.wireBack(root);
      const conv = () => { const a = num(UI.val('fxAmt')), f = UI.val('fxFrom'), t = UI.val('fxTo'), v = this.convert(a, f, t); $('#fxOut').textContent = t === 'INR' ? U.inr(v) : U.fxMoney(v, t); $('#fxLine').textContent = f === t ? '' : '1 ' + f + ' = ' + (t === 'INR' ? U.inr(this.convert(1, f, t)) : U.fxMoney(this.convert(1, f, t), t, 4)) + ' · 1 ' + t + ' = ' + (f === 'INR' ? U.inr(this.convert(1, t, f)) : U.fxMoney(this.convert(1, t, f), f, 4)); };
      ['fxAmt', 'fxFrom', 'fxTo'].forEach(id => { $('#' + id).addEventListener('input', conv); $('#' + id).addEventListener('change', conv); }); conv();
      $('#fxShow').onchange = e => this.show(e.target.value, UI.val('fxMode')); $('#fxMode').onchange = e => this.show(UI.val('fxShow'), e.target.value);
      if (!edit) return;
      const typed = () => { const r = {}; $$('#fxTable tbody tr', root).forEach(tr => { const v = num($('.fxRate', tr).value); if (v > 0) r[tr.dataset.code] = v; }); return r; };
      const put = (rates, source, msg) => { if (this.save({ rates, at: Date.now(), source: source || 'typed' }) === false) return; this.apply(); UI.toast(msg, 3500, 'ok'); App.refreshBar(); this.screen(); };
      $$('.fxRate', root).forEach(i => i.oninput = () => { const tr = i.closest('tr'), v = num(i.value); $('.fxK', tr).textContent = v > 0 ? U.fxMoney(1000 / v, tr.dataset.code) : ''; });
      $('#fxSave').onclick = () => put(typed(), 'typed', 'Exchange rates saved');
      $$('[data-fxdel]', root).forEach(b => b.onclick = () => { const r = typed(); delete r[b.dataset.fxdel]; if (cur.code === b.dataset.fxdel) this.show(''); put(r, d.source, b.dataset.fxdel + ' removed'); });
      $('#fxAdd').onclick = async () => {
        const c = UI.val('fxAddCode'); let v = num(UI.val('fxAddRate')); if (!c) return UI.toast('Choose the currency');
        if (!(v > 0)) { try { v = (await this.fetchRates())[c] || 0; } catch (e) { v = 0; } if (!(v > 0)) return UI.toast('Today\'s rate could not be fetched: type the rupees 1 ' + c + ' is worth', 5000); }
        const r = typed(); r[c] = v; put(r, 'typed', c + ' added at ' + U.inr(v));
      };
      $('#fxFetch').onclick = async () => {
        $('#fxFetch').disabled = true;
        try { const all = await this.fetchRates(), r = typed(), want = Object.keys(r).length ? Object.keys(r) : ['USD', 'EUR', 'GBP', 'AED', 'SGD']; want.forEach(c => { if (all[c]) r[c] = all[c]; }); put(r, 'open.er-api.com', 'Today\'s rates are in for ' + want.join(', ')); }
        catch (e) { UI.toast((e && e.message) || 'The rates could not be fetched: type them', 6000); if ($('#fxFetch')) $('#fxFetch').disabled = false; }
      };
    },
    // ---- an invoice in a currency: { code, rate } or null; its total in that currency
    of(inv) { const f = inv && inv.fx; return f && CODES.includes(f.code) && f.code !== 'INR' && num(f.rate) > 0 ? { code: f.code, rate: num(f.rate) } : null; },
    invText(inv, amount) { const f = this.of(inv); return f ? U.fxMoney(num(amount) / f.rate, f.code) : ''; },
    rateText(f) { return '1 ' + f.code + ' = ' + U.inr(f.rate); }
  };
  App.routes.currency = () => Currency.screen();
  global.Currency = Currency;
})(window);
