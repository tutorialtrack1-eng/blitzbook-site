/* BlitzBook web portal - Bank Statement (Reports > Bank Statement). The lines of the bank's statement (uploaded as
   CSV or Excel, read by Money.parseStatement) are kept in the books, each with what it was: money from a customer,
   money to a supplier, a contra (cash put in or drawn, a transfer to another account of one's own), an expense,
   bank charges, other income, capital or a loan, or any other account. Choosing a customer or supplier shows
   their pending invoices or bills; the ones ticked are knocked off. Post writes the entry (a receipt RCT-, a
   payment PMT-, a contra CTR-, an expense EXP-) and the line then carries its number: a link to it, with Edit and
   Undo beside it. A line is one record of the "bank" collection:
     { id, seq, date, desc, ref, inAmt, outAmt, key, type, party, bills: [{no, amount}], entry: {col, id, no}, acct }
   entry names the record it was posted as; when that record is deleted the line is pending again.
   A company with more than one bank account (Company Profile) has a statement for each: acct is the name of the
   line's account in the books, blank for the main one ('Bank'). The entries are posted through that account; an
   expense paid from a further account is a journal voucher (Dr the expense, Cr the account), since an expense
   record always goes through the main one. */
(function (global) {
  'use strict';
  const { esc, num, money } = U;
  const { td } = Ledger;
  const N = Books.N, NEW = '\u0001new', PAGE = 150, BANK = 'Bank';
  const lower = (s) => String(s || '').trim().toLowerCase();
  const r2 = U.round2;
  const accounts = () => U.bankAccounts(Store.company());
  // The account of a line in the books, and the one a statement is opened for
  const led = (l) => String((l && l.acct) || '').trim() || BANK;
  const pickAcct = (name) => { const hit = accounts().find(b => lower(b.ledger) === lower(name)); return hit ? hit.ledger : BANK; };
  function ensureAccount(name, nature) { if (!Books.accounts().some(a => lower(a.name) === lower(name))) Store.add('accounts', { name, nature }); }

  // What a line can be. dir: i = money in, o = money out; pick = what is chosen beside it
  const TYPES = [
    { key: 'customer', t: 'Customer', dir: 'io', pick: 'customer' },
    { key: 'supplier', t: 'Supplier', dir: 'io', pick: 'supplier' },
    { key: 'contra', t: 'Contra (cash / own account)', dir: 'io', pick: 'account' },
    { key: 'expense', t: 'Expense', dir: 'o', pick: 'category' },
    { key: 'charges', t: 'Bank Charges', dir: 'o', pick: '' },
    { key: 'income', t: 'Other Income / Interest', dir: 'i', pick: 'account' },
    { key: 'capital', t: 'Capital / Loan / Drawings', dir: 'io', pick: 'account' },
    { key: 'other', t: 'Other Account (tax, asset ...)', dir: 'io', pick: 'account' }
  ];
  const typeOf = (k) => TYPES.find(t => t.key === k) || null;
  const isIn = (l) => num(l.inAmt) > 0;
  const amt = (l) => r2(num(l.inAmt) || num(l.outAmt));
  const allowed = (l) => TYPES.filter(t => t.dir.includes(isIn(l) ? 'i' : 'o'));
  // The type an account or party belongs under
  function typeOfNature(n) {
    return n === N.CUSTOMER ? 'customer' : n === N.SUPPLIER ? 'supplier' : n === N.CASH || n === N.BANK ? 'contra' : n === N.INCOME ? 'income' : n === N.CAPITAL || n === N.LIABILITY ? 'capital' : 'other';
  }
  // The names offered beside a type
  function choices(type, acc, mine) {
    if (type === 'expense') {
      const m = new Map(); Ledger.EXPENSE_CATS.concat(Store.list('expenses').map(e => String(e.category || '').trim())).forEach(c => { if (c && !m.has(lower(c))) m.set(lower(c), c); });
      return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
    }
    return acc.filter(a => typeOfNature(a.nature) === type && lower(a.name) !== lower(mine || BANK) && !(type === 'income' && lower(a.name) === 'sales') && !(type === 'other' && a.nature === N.INCOME)).map(a => a.name);
  }
  const DEFAULT_PICK = { contra: 'Cash', income: 'Other Income' };
  function nextNo(prefix, col) {
    let max = 0; Store.all(col).forEach(x => { const m = new RegExp('^' + prefix + '-(\\d+)$').exec(x.no || ''); if (m) max = Math.max(max, +m[1]); });
    return prefix + '-' + String(max + 1).padStart(4, '0');
  }
  // The pending invoices (money in from a customer) or bills (money out to a supplier) of the line's party
  function dues() { return { recv: Biz.outstanding().open, pay: Books.payables().open }; }
  function billsFor(l, d) {
    if (!l.party || (l.type !== 'customer' && l.type !== 'supplier')) return [];
    const src = l.type === 'customer' && isIn(l) ? d.recv : l.type === 'supplier' && !isIn(l) ? d.pay : [];
    return src.filter(r => lower(r.party) === lower(l.party)).map(r => ({ no: r.no, date: r.date, days: r.days, due: r2(r.balance) }))
      .sort((a, b) => U.dateMs(a.date) - U.dateMs(b.date) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
  }
  // The ticks of a line, held to the bills still open and to what is due on each
  function ticks(l, bills) {
    const out = [];
    (Array.isArray(l.bills) ? l.bills : []).forEach(a => { const b = bills.find(x => lower(x.no) === lower(a.no)); if (b && num(a.amount) > 0.005) out.push({ no: b.no, amount: Math.min(r2(a.amount), b.due) }); });
    return out;
  }
  // A bill named in the bank's narration is ticked by itself; so is the only bill of exactly this amount
  function autoBills(l, bills) {
    const d = lower(l.desc) + ' ' + lower(l.ref); let left = amt(l); const out = [];
    bills.filter(b => String(b.no).length >= 3 && d.includes(lower(b.no))).forEach(b => { const a = Math.min(b.due, left); if (a > 0.005) { out.push({ no: b.no, amount: r2(a) }); left = r2(left - a); } });
    if (!out.length) { const same = bills.filter(b => Math.abs(b.due - amt(l)) < 0.005); if (same.length === 1) out.push({ no: same[0].no, amount: same[0].due }); }
    return out;
  }
  // The record a line was posted as, null while it is pending (or once that record was deleted)
  function entryOf(l) { return l.entry && l.entry.id ? Store.find(l.entry.col, l.entry.id) : null; }
  function describe(l, e) {
    if (l.entry.col === 'expenses') return { label: 'Expense', pill: 'warn', who: e.category, amount: num(e.amount), no: e.no, against: '' };
    const dr = (e.lines || []).filter(x => x.side === 'Dr').reduce((s, x) => s + num(x.amount), 0);
    if (e.vtype === 'receipt' || e.vtype === 'payment') return { label: e.vtype === 'receipt' ? 'Receipt' : 'Payment', pill: e.vtype === 'receipt' ? 'ok' : 'warn', who: e.party, amount: dr, no: e.no,
      against: Array.isArray(e.alloc) && e.alloc.length ? e.alloc.map(a => a.no).join(', ') : (e.ref || '') };
    const exp = l.type === 'expense' || l.type === 'charges';
    return { label: exp ? 'Expense' : 'Contra', pill: exp ? 'warn' : '', who: (e.lines || []).map(x => x.account).filter(a => lower(a) !== lower(led(l))).join(', '), amount: dr, no: e.no, against: '' };
  }
  const ready = (l) => { const t = typeOf(l.type); return !!t && t.dir.includes(isIn(l) ? 'i' : 'o') && (!t.pick || !!l.party); };

  const Bank = {
    TYPES,
    lines() { return Store.list('bank').slice().sort((a, b) => U.dateMs(a.date) - U.dateMs(b.date) || num(a.seq) - num(b.seq)); },

    /* Posts one line: writes the entry and puts its number on the line. Returns '' when done, else why not. */
    post(l, d) {
      if (entryOf(l)) return '';
      if (!ready(l)) return 'Choose what this line is' + (typeOf(l.type) && typeOf(l.type).pick ? ' and the ' + (l.type === 'expense' ? 'category' : l.type === 'customer' || l.type === 'supplier' ? l.type : 'account') : '');
      const fy = U.booksDateError(l.date); if (fy) return fy;
      const a = amt(l), into = isIn(l), bank = led(l); let entry;
      if ((l.type === 'expense' || l.type === 'charges') && bank !== BANK) {
        const cat = l.type === 'charges' ? 'Bank Charges' : l.party;
        ensureAccount(cat, N.EXPENSE);
        const j = Store.add('journal', { no: nextNo('JV', 'journal'), date: l.date, narration: l.desc + (l.ref ? ' (' + l.ref + ')' : ''), lines: [{ account: cat, side: 'Dr', amount: a }, { account: bank, side: 'Cr', amount: a }] });
        entry = { col: 'journal', id: j.id, no: j.no };
      } else if (l.type === 'expense' || l.type === 'charges') {
        const e = Store.add('expenses', { no: nextNo('EXP', 'expenses'), date: l.date, paidBy: 'Online', category: l.type === 'charges' ? 'Bank Charges' : l.party, description: l.desc, mode: 'taxable', rate: '0', taxable: a, gst: 0, cgst: 0, sgst: 0, igst: 0, amount: a, vendorGstin: '', rcm: false });
        entry = { col: 'expenses', id: e.id, no: e.no };
      } else if (l.type === 'contra') {
        const j = Store.add('journal', { no: nextNo('CTR', 'journal'), date: l.date, narration: l.desc + (l.ref ? ' (' + l.ref + ')' : ''),
          lines: into ? [{ account: bank, side: 'Dr', amount: a }, { account: l.party, side: 'Cr', amount: a }] : [{ account: l.party, side: 'Dr', amount: a }, { account: bank, side: 'Cr', amount: a }] });
        entry = { col: 'journal', id: j.id, no: j.no };
      } else {
        // A receipt or a payment through the bank book; the bills ticked are knocked off, the rest stays on account
        const kind = into ? 'receipt' : 'payment', bills = billsFor(l, d || dues()), alloc = ticks(l, bills);
        const sum = r2(alloc.reduce((s, x) => s + x.amount, 0));
        if (sum > a + 0.005) return 'The amounts ticked (' + money(sum) + ') are more than the ' + money(a) + ' of this line';
        const v = { vtype: kind, no: Money.nextNo(kind), date: l.date, party: l.party, mode: 'Bank Transfer', ref: alloc.map(x => x.no).join(', '), bankRef: l.ref || '', narration: l.desc, lines: Money.lines(kind, l.party, 'Bank Transfer', a, bank) };
        if (alloc.length) v.alloc = alloc;
        Store.add('journal', v);
        entry = { col: 'journal', id: v.id, no: v.no };
      }
      l.entry = entry; Store.update('bank', l);
      return '';
    },

    // What an uploaded line most likely is: the same narration as a line placed earlier, a party named in it, a tell-tale word
    suggest(l, learnt, names, nature) {
      const ok = (t) => !!t && typeOf(t).dir.includes(isIn(l) ? 'i' : 'o');
      const k = lower(l.desc).replace(/[\d\W]+/g, ' ').trim(), was = learnt.get(k);
      if (was && ok(was.type)) return was;
      const name = names.find(n => n.length >= 3 && lower(l.desc).includes(lower(n)));
      if (name) return { type: typeOfNature(nature(name)), party: name };
      const d = lower(l.desc);
      if (!isIn(l) && /\b(charges?|chrg|chgs?|fee|fees|commission|sms alert|min bal|amc)\b/.test(d)) return { type: 'charges', party: '' };
      if (/\b(cash dep|cash deposit|cash wdl|cash withdrawal|atm|self)\b/.test(d)) return { type: 'contra', party: 'Cash' };
      if (isIn(l) && /\b(int\.?\s?pd|interest|int cr)\b/.test(d)) return { type: 'income', party: 'Other Income' };
      return { type: '', party: '' };
    },

    // Reads a statement file and adds the lines that are not on the statement yet
    upload(onDone, acct) {
      const mine = pickAcct(acct);
      UI.pickSheet((rows) => {
        const txns = Money.parseStatement(rows);
        if (!txns.length) { UI.alert('Bank Statement', 'No transactions found. The file needs a date, a description and withdrawal / deposit (or amount) columns, as in most bank exports and in the template.'); return; }
        const have = Store.list('bank'), keys = new Set(have.filter(l => lower(led(l)) === lower(mine)).map(l => l.key)), seen = new Map();
        // Two lines alike on one day (the same amount twice) are told apart by their place among their likes
        txns.forEach(t => { const n = (seen.get(t.key) || 0) + 1; seen.set(t.key, n); if (n > 1) t.key += '#' + n; });
        const nature = Books.natures(), acc = Books.accounts(), d = dues();
        const names = acc.filter(a => a.nature === N.CUSTOMER || a.nature === N.SUPPLIER).map(a => a.name).sort((a, b) => b.length - a.length);
        const learnt = new Map(), nk = (s) => lower(s).replace(/[\d\W]+/g, ' ').trim();
        Money.vouchers().forEach(v => { if (v.narration && v.party) learnt.set(nk(v.narration), { type: typeOfNature(nature(v.party)), party: v.party }); });
        have.forEach(l => { if (l.type && l.desc) learnt.set(nk(l.desc), { type: l.type, party: l.party || '' }); });
        // A line recorded earlier from Receipts & Payments > Upload Bank Statement is shown as posted
        const used = new Set(have.map(l => l.entry && l.entry.id).filter(Boolean)), old = new Map();
        Money.vouchers().forEach(v => { if (v.narration && !used.has(v.id)) { const k = Money.stmtKey(v.date, v.vtype === 'receipt' ? Money.amountOf(v) : -Money.amountOf(v), v.narration); if (!old.has(k)) old.set(k, v); } });
        let seq = have.reduce((m, l) => Math.max(m, num(l.seq)), 0), added = 0;
        txns.forEach(t => {
          if (keys.has(t.key)) return;
          const l = { id: U.uid(), createdAt: Date.now(), seq: ++seq, date: t.date, desc: t.desc, ref: t.ref || '', inAmt: r2(t.inAmt), outAmt: r2(t.outAmt), key: t.key, type: '', party: '', bills: [], acct: mine === BANK ? '' : mine };
          const v = old.get(t.key.replace(/#\d+$/, ''));
          if (v) { old.delete(t.key.replace(/#\d+$/, '')); l.type = typeOfNature(nature(v.party)); l.party = v.party; l.entry = { col: 'journal', id: v.id, no: v.no }; }
          else { const s = Bank.suggest(l, learnt, names, nature); l.type = s.type; l.party = s.party; l.bills = autoBills(l, billsFor(l, d)); }
          have.push(l); added++;
        });
        if (added && Store.saveList('bank', have) === false) return;
        UI.toast(added ? added + ' line' + (added === 1 ? '' : 's') + ' added to the statement' + (txns.length > added ? ', ' + (txns.length - added) + ' already on it' : '') : 'Every line of this file is already on the statement', 5000);
        if (onDone) onDone();
      });
    },

    /* Adds a bank account of the company from the statement itself (the same list as Company Profile > Other Bank
       Accounts). A profile without a main account yet gets it as the main one ('Bank' in the books); otherwise it is
       a further account with an account of its own in the books. onDone gets the name of that account. */
    addAccount(onDone) {
      if (!Companies.mayWrite('company')) { UI.toast(Companies.readOnlyText('company'), 5000); return; }
      const c = Store.company(), IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
      const asMain = !String(c.bankAccountNo || '').trim() && !String(c.bankName || '').trim();
      const body = '<div class="hint" style="margin-bottom:10px">' + (asMain ? 'This becomes the main bank account of the company: "Bank" in the books, and the one printed on invoices.' : 'This account is added to the Company Profile beside the ' + (accounts().length) + ' already there. It gets an account of its own in the books; receipts, payments and this statement say which account the money moved through.') + '</div><div class="grid2">' +
        UI.field('Account Number', UI.input('baAcc', '', { attrs: ' inputmode="numeric"' }), { req: true }) + UI.field('Account Holder Name', UI.input('baHolder', String(c.bankHolder || c.name || '').toUpperCase(), { attrs: ' style="text-transform:uppercase"' })) +
        '<div class="field"><label>IFSC Code</label>' + UI.input('baIfsc', '', { placeholder: 'e.g. HDFC0001234', attrs: ' maxlength="11" style="text-transform:uppercase"' }) + '<div class="hint" id="baIfscMsg">Bank and branch fill in automatically from the IFSC</div></div>' +
        UI.field('Bank Name', UI.input('baBank', '', { placeholder: 'Filled automatically from IFSC' }), { req: true }) + UI.field('Branch Name', UI.input('baBranch', '', { placeholder: 'Filled automatically from IFSC' })) +
        (asMain ? '' : UI.field('Name in the Books', UI.input('baLedger', '', { placeholder: 'e.g. HDFC Bank A/c 4321 (filled in when left blank)' }), { hint: 'The account of the books this bank account is kept in' })) + '</div>';
      const bg = UI.modal({ title: 'Add Bank Account', body, buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Add Account', cls: 'green', onClick: (bg) => {
        const v = (id) => UI.val(id, bg).trim();
        const b = { ledger: asMain ? BANK : v('baLedger'), accountNo: v('baAcc').replace(/\s+/g, ''), holder: v('baHolder').toUpperCase(), ifsc: v('baIfsc').toUpperCase(), bankName: v('baBank'), branch: v('baBranch') };
        if (!UI.mark('baAcc', !b.accountNo, bg)) { UI.toast('Enter the account number'); return false; }
        if (!UI.mark('baBank', !b.bankName, bg)) { UI.toast('Enter the name of the bank'); return false; }
        if (b.ifsc && !IFSC.test(b.ifsc)) { UI.mark('baIfsc', true, bg); UI.toast('Invalid IFSC Code format (e.g. HDFC0001234)'); return false; }
        const o = Object.assign({}, c);
        if (asMain) Object.assign(o, { bankAccountNo: b.accountNo, bankHolder: b.holder, bankIfsc: b.ifsc, bankName: b.bankName, bankBranch: b.branch });
        else {
          const have = Array.isArray(c.banks) ? c.banks : [];
          if (b.accountNo === String(c.bankAccountNo || '').trim() || have.some(x => String(x.accountNo || '').trim() === b.accountNo)) { UI.mark('baAcc', true, bg); UI.toast('Account number ' + b.accountNo + ' is already in the Company Profile', 5000); return false; }
          if (!b.ledger) b.ledger = U.bankLedgerName(b);
          const taken = lower(b.ledger) === 'bank' || lower(b.ledger) === 'cash' || have.some(x => lower(x.ledger) === lower(b.ledger)) || Books.accounts().some(a => lower(a.name) === lower(b.ledger));
          if (taken) { UI.mark('baLedger', true, bg); UI.toast('"' + b.ledger + '" is already an account in the books: give this bank account another name', 6000); return false; }
          o.banks = have.concat([b]);
        }
        if (Store.saveCompany(o) === false) return false;
        if (!asMain) ensureAccount(b.ledger, N.BANK);
        UI.toast('Bank account added: ' + b.bankName + ' A/c ' + b.accountNo, 4000);
        if (onDone) onDone(b.ledger);
      } }] });
      const ifsc = $('#baIfsc', bg);
      ifsc.addEventListener('input', async () => {
        const code = ifsc.value.trim().toUpperCase(), say = (text, cls) => { const m = $('#baIfscMsg', bg); m.textContent = text; m.className = 'hint ' + (cls || ''); };
        ifsc.classList.remove('err');
        if (code.length < 11) { say('Bank and branch fill in automatically from the IFSC'); return; }
        if (!IFSC.test(code)) { ifsc.classList.add('err'); say('Invalid IFSC code format (e.g. HDFC0001234)', 'red'); return; }
        if (U.BANK_IFSC[code.slice(0, 4)]) $('#baBank', bg).value = U.BANK_IFSC[code.slice(0, 4)];
        say('Looking up bank & branch…');
        let found = null, reached = true;
        try { const r = await fetch('https://ifsc.razorpay.com/' + code); if (r.ok) found = await r.json(); else if (r.status !== 404) reached = false; } catch (err) { reached = false; }
        if (!ifsc.isConnected || ifsc.value.trim().toUpperCase() !== code) return;
        if (!found) { say(reached ? 'IFSC not found. Please check the code.' : 'Could not reach IFSC lookup. Enter bank & branch manually.', 'red'); return; }
        if (found.BANK) $('#baBank', bg).value = found.BANK.trim();
        $('#baBranch', bg).value = U.nameCase(found.BRANCH || '');
        say('✓ Bank & branch filled from IFSC', 'green');
      });
      const first = $('#baAcc', bg); if (first) first.focus();
    },

    open(p) {
      p = p || {};
      const show = p.show === 'pending' || p.show === 'posted' ? p.show : '', r = p.range || null, limit = Math.max(PAGE, num(p.limit));
      const accts = accounts(), multi = accts.length > 1, mine = multi ? pickAcct(p.acct) : BANK;
      // One account: every line is its line. More: the lines of the account chosen (a line without one is the main account's)
      const inPeriod = Bank.lines().filter(l => (!multi || lower(led(l)) === lower(mine)) && (!r || Books.inRange(l.date, r.a, r.b)));
      const info = new Map(); inPeriod.forEach(l => { const e = entryOf(l); info.set(l.id, e ? describe(l, e) : null); });
      const posted = inPeriod.filter(l => info.get(l.id)), pending = inPeriod.filter(l => !info.get(l.id));
      // The search box: every word typed must be somewhere in the line (date, narration, reference, party, type, entry, amount)
      const q = lower(p.q), words = q ? q.split(/\s+/) : [];
      const hay = (l) => { const e = info.get(l.id), t = typeOf(l.type); return lower([l.date, l.desc, l.ref, l.party, t ? t.t : '', e ? [e.label, e.who, e.no, e.against].join(' ') : 'pending', l.inAmt ? num(l.inAmt).toFixed(2) : '', l.outAmt ? num(l.outAmt).toFixed(2) : ''].join(' ')); };
      const byShow = show === 'posted' ? posted : show === 'pending' ? pending : inPeriod, list = words.length ? byShow.filter(l => { const h = hay(l); return words.every(w => h.includes(w)); }) : byShow, shown = list.slice(0, limit);
      const acc = Books.accounts(), d = dues(), canPost = pending.filter(ready);
      const sum = (ls, k) => ls.reduce((s, l) => s + num(l[k]), 0);
      const chip = (k, label, n) => '<button class="btn sm ' + (show === k ? '' : 'outline') + '" data-show="' + k + '">' + label + ' (' + n + ')</button>';
      const typeSel = (l) => '<select data-k="type" title="What this line is"><option value="">— type —</option>' + allowed(l).map(t => '<option value="' + t.key + '"' + (l.type === t.key ? ' selected' : '') + '>' + esc(t.t) + '</option>').join('') + '</select>';
      const pickSel = (l) => {
        const t = typeOf(l.type); if (!t || !t.pick) return '';
        const names = choices(l.type, acc, led(l)), known = names.some(n => lower(n) === lower(l.party));
        return '<select data-k="party" title="' + (t.pick === 'category' ? 'Expense category' : t.pick === 'account' ? 'Account' : t.t) + '"><option value="">— choose ' + (t.pick === 'category' ? 'category' : t.pick === 'account' ? 'account' : t.pick) + ' —</option><option value="' + NEW + '">+ New ' + (t.pick === 'category' ? 'category' : t.pick === 'account' ? 'account' : t.pick) + '…</option>' +
          (l.party && !known ? '<option selected>' + esc(l.party) + '</option>' : '') + names.map(n => '<option value="' + esc(n) + '"' + (lower(n) === lower(l.party) ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>';
      };
      // The pending invoices or bills of the party chosen, under the line: tick the ones this money is for
      const billsRow = (l) => {
        if (!l.party || (l.type !== 'customer' && l.type !== 'supplier')) return '';
        const bills = billsFor(l, d), what = l.type === 'customer' ? 'invoice' : 'bill';
        const refund = (l.type === 'customer') !== isIn(l);
        if (!bills.length) return '<tr class="bkbills none" data-for="' + esc(l.id) + '"><td colspan="8"><span class="hint">' + (refund ? 'Money ' + (isIn(l) ? 'back from' : 'returned to') + ' ' + esc(l.party) + ': it goes to their account.' : 'No pending ' + what + ' of ' + esc(l.party) + ': the money is kept on account.') + '</span></td></tr>';
        const on = new Map(ticks(l, bills).map(a => [lower(a.no), a.amount])), used = r2(Array.from(on.values()).reduce((s, v) => s + v, 0)), rest = r2(amt(l) - used);
        return '<tr class="bkbills" data-for="' + esc(l.id) + '"><td colspan="8"><div class="bkhd">Pending ' + what + 's of <b>' + esc(l.party) + '</b>: tick what this ' + money(amt(l)) + ' is for</div><div class="bklist">' +
          bills.map(b => '<label class="bkbill' + (on.has(lower(b.no)) ? ' on' : '') + '" data-no="' + esc(b.no) + '" data-due="' + b.due + '"><input type="checkbox" data-k="tick"' + (on.has(lower(b.no)) ? ' checked' : '') + '><b>' + esc(b.no) + '</b><span>' + esc(b.date) + ' · ' + b.days + ' d</span><span class="due">due ' + money(b.due) + '</span>' +
            '<input type="number" step="any" min="0" data-k="amount" placeholder="0.00" value="' + (on.has(lower(b.no)) ? on.get(lower(b.no)).toFixed(2) : '') + '" title="Amount knocked off this ' + what + '"></label>').join('') + '</div>' +
          '<div class="hint ' + (rest < -0.005 ? 'red' : rest > 0.005 ? '' : 'green') + '">' + (used > 0.005 ? 'Knocked off ' + money(used) + ' of ' + money(amt(l)) + (rest > 0.005 ? '; ' + money(rest) + ' stays on account of ' + esc(l.party) : rest < -0.005 ? '; ' + money(-rest) + ' more than this line' : '') + '.' : 'Nothing ticked: the whole amount stays on account of ' + esc(l.party) + '.') + '</div></td></tr>';
      };
      const row = (l) => {
        const e = info.get(l.id), head = td('Date', esc(l.date)) + td('Description', '<span class="bkdesc" title="' + esc(l.desc) + '">' + esc(l.desc) + '</span>' + (l.ref ? '<div class="small muted">' + esc(l.ref) + '</div>' : ''), 'left') +
          td('Withdrawal', l.outAmt ? money(l.outAmt) : '', 'num') + td('Deposit', l.inAmt ? money(l.inAmt) : '', 'num');
        if (e) return '<tr class="bkposted" data-id="' + esc(l.id) + '">' + head + td('Type', '<span class="pill ' + e.pill + '">' + e.label + '</span>') + td('Party / Account', '<b>' + esc(e.who || '-') + '</b>' + (e.against ? '<div class="small muted">against ' + esc(e.against) + '</div>' : '')) +
          td('Entry', '<b>' + (U.noLink(e.no) || 'posted') + '</b>' + (Math.abs(e.amount - amt(l)) > 0.005 ? '<div class="small red" title="The entry was changed after it was posted">entry is ' + money(e.amount) + '</div>' : '')) +
          '<td class="actions"><button class="btn sm outline" data-edit>Edit</button><button class="btn sm red outline" data-undo title="Delete the entry; the line is pending again">Undo</button></td></tr>';
        return '<tr class="bkpending" data-id="' + esc(l.id) + '">' + head + td('Type', typeSel(l)) + td('Party / Account', pickSel(l) || (l.type === 'charges' ? '<span class="muted small">Expense: Bank Charges</span>' : '')) + td('Entry', '<span class="pill bad">Pending</span>') +
          '<td class="actions"><button class="btn sm green" data-post' + (ready(l) ? '' : ' disabled') + '>Post</button><button class="btn sm outline" data-del title="Take this line off the statement">✕</button></td></tr>' + billsRow(l);
      };
      const root = App.view(App.header('Bank Statement', '<div class="btnrow" style="margin:0">' + (multi ? '<select id="bsAcct" title="The bank account this statement is of" style="min-height:34px;max-width:260px">' + accts.map(b => '<option value="' + esc(b.ledger) + '"' + (lower(b.ledger) === lower(mine) ? ' selected' : '') + '>' + esc(b.primary ? b.label + ' (main)' : b.label) + '</option>').join('') + '</select>' : '') + '<button class="btn sm green" id="bsAddAc" title="Add another bank account of the company">+ Add Bank Account</button><button class="btn sm blue" id="bsUp">Upload Statement</button><button class="btn sm outline" id="bsTpl">Template</button>' +
          (canPost.length ? '<button class="btn sm green" id="bsAll" title="Post every pending line that has its type and party chosen">Post all ready (' + canPost.length + ')</button>' : '') +
          '<button class="btn sm outline" id="bsPeriod">' + esc(r ? r.label : 'All dates') + '</button>' + (r ? '<button class="btn sm outline" id="bsAllDates">All dates</button>' : '') +
          (inPeriod.length ? '<button class="btn sm green" id="bsXls">Export Excel</button><button class="btn sm blue" id="bsPdf">PDF</button>' : '') + '</div>') +
        (inPeriod.length ? '<div class="btnrow" style="margin-bottom:8px"><input id="bsQ" type="search" autocomplete="off" placeholder="Search date, description, reference, party, entry no or amount" value="' + esc(p.q || '') + '" style="flex:1;min-width:220px;max-width:520px;min-height:36px">' + (words.length ? '<span class="hint">' + list.length + ' of ' + byShow.length + ' line' + (byShow.length === 1 ? '' : 's') + '</span><button class="btn sm outline" id="bsQx">Clear</button>' : '') + '</div>' : '') +
        '<div class="btnrow">' + chip('', 'All', inPeriod.length) + chip('pending', 'Pending', pending.length) + chip('posted', 'Posted', posted.length) +
          '<span class="hint bold" style="margin-left:auto">Deposits ' + money(sum(inPeriod, 'inAmt')) + '   |   Withdrawals ' + money(sum(inPeriod, 'outAmt')) + (pending.length ? '   |   Pending: in ' + money(sum(pending, 'inAmt')) + ', out ' + money(sum(pending, 'outAmt')) : '') + '</span></div>' +
        (inPeriod.length ? '<div class="hint" style="margin-bottom:8px">Say what each line is on the right. For a customer or supplier, choose the party and tick the pending invoices the money is for; Post writes the receipt, payment, contra or expense and puts its number on the line. Edit opens that entry.' + (multi ? ' Money moved to or from another bank account of your own is a Contra with that account: post it on one of the two statements only.' : '') + '</div>' : '') +
        '<div class="tablewrap">' + (shown.length ? '<table class="list cards bank"><thead><tr><th>Date</th><th>Description</th><th class="num">Withdrawal</th><th class="num">Deposit</th><th>Type</th><th>Party / Account</th><th>Entry</th><th></th></tr></thead><tbody>' + shown.map(row).join('') + '</tbody></table>' :
          '<div class="empty">' + (words.length ? 'No lines match "' + esc(p.q) + '".' : Store.list('bank').some(l => !multi || lower(led(l)) === lower(mine)) ? 'No ' + (show || '') + ' lines' + (r ? ' in this period' : '') + '.' : 'Upload your bank statement (CSV or Excel, as the bank gives it) to place its lines: receipts from customers, payments to suppliers, contra entries, expenses and the rest.') + '</div>') + '</div>' +
        (list.length > shown.length ? '<div class="btnrow"><button class="btn outline" id="bsMore">Show more (' + (list.length - shown.length) + ' more lines)</button></div>' : ''));
      App.wireBack(root);
      const again = () => { const y = window.scrollY; Bank.open(p); window.scrollTo(0, y); };
      const go = (extra) => App.go('bankstmt', Object.assign({ show: p.show, range: p.range, acct: p.acct, q: p.q }, extra));
      const byId = (id) => Store.find('bank', id);
      const save = (l) => Store.update('bank', l) !== false;
      $('#bsUp').onclick = () => Bank.upload(again, mine);
      const added = (ledger) => { p.acct = ledger; p.limit = 0; p.q = ''; Bank.open(p); };
      $('#bsAddAc').onclick = () => Bank.addAccount(added);
      // Searching redraws the list as it is typed; the box keeps the cursor
      if ($('#bsQ')) {
        const box = $('#bsQ'), find = (v) => { p.q = v; p.limit = 0; p.focusQ = true; Bank.open(p); };
        box.oninput = () => { clearTimeout(Bank.searchTimer); Bank.searchTimer = setTimeout(() => find(box.value), 250); };
        if ($('#bsQx')) $('#bsQx').onclick = () => { clearTimeout(Bank.searchTimer); find(''); };
        if (p.focusQ) { delete p.focusQ; box.focus(); try { box.setSelectionRange(box.value.length, box.value.length); } catch (e) { /* fine */ } }
      }
      if ($('#bsAcct')) $('#bsAcct').onchange = (e) => go({ acct: e.target.value, limit: 0 });
      $('#bsTpl').onclick = () => { UI.download('BlitzBook_Bank_Statement_Template.csv', 'Date,Description,Debit,Credit,Reference\n01/10/2026,UPI/The Chef Store/payment for invoice 0001,,15000,UTR2026100112345\n02/10/2026,NEFT Solara Appliances PUR-0001,20880,,NEFT987654\n03/10/2026,Bank charges,118,,\n04/10/2026,Cash deposit,,5000,\n', 'text/csv'); UI.toast('Template downloaded. Most bank statement exports (CSV / Excel) also upload as they are.', 4000); };
      $('#bsPeriod').onclick = () => Reports.pickPeriod('Bank Statement', r || Reports.periodRange(3), (rg) => go({ range: rg }));
      if ($('#bsAllDates')) $('#bsAllDates').onclick = () => go({ range: null });
      if ($('#bsMore')) $('#bsMore').onclick = () => { p.limit = limit + PAGE; again(); };
      $$('[data-show]', root).forEach(b => b.onclick = () => go({ show: b.dataset.show }));
      if ($('#bsAll')) $('#bsAll').onclick = () => UI.confirm('Post all ready', 'Post ' + canPost.length + ' line' + (canPost.length === 1 ? '' : 's') + ' as receipts, payments, contra entries and expenses? Each can be edited or undone afterwards.', () => {
        let done = 0; const why = [];
        canPost.forEach(x => { const l = byId(x.id); if (!l) return; const err = Bank.post(l); if (err) why.push(l.date + ' ' + l.desc.slice(0, 30) + ': ' + err); else done++; });
        UI.toast(done + ' entr' + (done === 1 ? 'y' : 'ies') + ' posted' + (why.length ? '; ' + why.length + ' not: ' + why[0] : ''), why.length ? 8000 : 4000); again();
      }, 'Post');
      const exportRows = () => list.map(l => { const e = info.get(l.id), t = typeOf(l.type); return [l.date, l.desc, l.ref || '', l.outAmt ? U.indianNumber(l.outAmt) : '', l.inAmt ? U.indianNumber(l.inAmt) : '', e ? e.label : t ? t.t : '', e ? e.who : l.party || '', e ? e.no || 'posted' : 'Pending', e ? e.against : '']; });
      const heads = ['Date', 'Description', 'Reference', 'Withdrawal', 'Deposit', 'Type', 'Party / Account', 'Entry', 'Against'];
      if ($('#bsXls')) $('#bsXls').onclick = () => UI.xls('Bank_Statement', heads, exportRows());
      if ($('#bsPdf')) $('#bsPdf').onclick = () => UI.pdf('Bank Statement' + (multi ? ': ' + (accts.find(b => lower(b.ledger) === lower(mine)) || accts[0]).label : ''), (r ? 'Period: ' + r.from + ' to ' + r.to : 'All dates') + '   ·   ' + posted.length + ' posted, ' + pending.length + ' pending', heads, exportRows(), { right: [3, 4], total: ['Total', '', '', U.indianNumber(sum(list, 'outAmt')), U.indianNumber(sum(list, 'inAmt')), '', '', '', ''] });

      $$('tr.bkpending', root).forEach(tr => {
        const id = tr.dataset.id;
        $('[data-k=type]', tr).addEventListener('change', e => { const l = byId(id); if (!l) return; l.type = e.target.value; l.party = DEFAULT_PICK[l.type] || ''; l.bills = []; save(l); again(); });
        const pick = $('[data-k=party]', tr);
        if (pick) pick.addEventListener('change', () => {
          const l = byId(id); if (!l) return;
          const set = (name) => { l.party = name; l.bills = autoBills(l, billsFor(l, dues())); save(l); again(); };
          if (pick.value !== NEW) { set(pick.value); return; }
          pick.value = l.party;
          if (l.type === 'expense') UI.prompt('New expense category', 'Category', '', (v) => { const name = U.nameCase(v); if (!name) { UI.toast('Type the category'); return false; } set(name); }, { placeholder: 'e.g. Courier' });
          else Ledger.Journal.newAccount((name) => set(name));
        });
        $('[data-post]', tr).onclick = () => { const l = byId(id); if (!l) return; const err = Bank.post(l); if (err) { UI.toast(err, 6000); return; } UI.toast((l.entry.no || 'Entry') + ' posted'); again(); };
        $('[data-del]', tr).onclick = () => { Store.delete('bank', id); again(); };
      });
      $$('tr.bkbills:not(.none)', root).forEach(tr => {
        const id = tr.dataset.for;
        const read = () => $$('.bkbill', tr).map(el => ({ no: el.dataset.no, due: num(el.dataset.due), box: $('[data-k=tick]', el), input: $('[data-k=amount]', el) }));
        const keep = (rows) => { const l = byId(id); if (!l) return; l.bills = rows.map(x => ({ no: x.no, amount: Math.min(x.due, r2(num(x.input.value))) })).filter(a => a.amount > 0.005); save(l); again(); };
        read().forEach(x => {
          x.box.addEventListener('change', () => {
            const rows = read(), l = byId(id); if (!l) return;
            if (x.box.checked) {
              const left = r2(amt(l) - rows.filter(o => o.no !== x.no).reduce((s, o) => s + num(o.input.value), 0));
              if (left <= 0.005) { UI.toast('The whole ' + money(amt(l)) + ' is already knocked off; reduce another amount first', 5000); x.box.checked = false; return; }
              x.input.value = Math.min(x.due, left).toFixed(2);
            } else x.input.value = '';
            keep(rows);
          });
          x.input.addEventListener('change', () => keep(read()));
        });
      });
      $$('tr.bkposted', root).forEach(tr => {
        const id = tr.dataset.id;
        $('[data-edit]', tr).onclick = () => {
          const l = byId(id), e = l && entryOf(l); if (!e) { again(); return; }
          if (l.entry.col === 'expenses') Ledger.Expenses.edit(e, again);
          else if (e.vtype === 'receipt' || e.vtype === 'payment') Money.edit(e.vtype, e, again);
          else Ledger.Journal.edit(e, again);
        };
        $('[data-undo]', tr).onclick = () => {
          const l = byId(id), e = l && entryOf(l); if (!e) { again(); return; }
          const x = describe(l, e);
          UI.confirm('Undo ' + x.label, 'Delete ' + x.label.toLowerCase() + ' ' + (x.no || '') + ' of ' + money(x.amount) + (x.who ? ' (' + x.who + ')' : '') + '? The statement line stays and is pending again.', () => {
            Store.delete(l.entry.col, l.entry.id); delete l.entry; save(l); UI.toast(x.label + ' ' + (x.no || '') + ' deleted'); again();
          }, 'Delete');
        };
      });
    }
  };
  App.routes.bankstmt = (p) => Bank.open(p);
  global.Bank = Bank;
})(window);
