/* BlitzBook web portal - Custom Fields (Settings > Custom Fields).

   The owner or an admin adds fields of their own to an invoice, a purchase, a customer, a supplier or an item: text,
   a number, a date, a drop-down, a tick box, or a formula worked out from other fields. A field can also be filled
   in by a rule (Auto-fill): it takes the value the rule gives whenever the fields the rule reads change, until
   somebody types over it. So one field is updated by the others, the way a spreadsheet does it:
     Freight          number
     Insurance        formula   ROUND({Taxable Value} * 0.5 / 100, 2)
     Landed Cost      formula   {Grand Total} + {Freight} + {Insurance}
     Zone             drop-down North / South / East / West, auto-fill IF({Buyer State} = "Karnataka (29)", "South", "")
     Priority         formula   IF({Grand Total} > 100000, "High", "Normal")

   The definitions are part of the company's settings record (settings.customFields, synced with the books, so every
   user sees the same fields); the values sit on the record they belong to: rec.cf {label: value} on an invoice, a
   purchase and an item, and in the contact's own columns (rec.extra) on a customer or supplier, the columns the
   Customer / Supplier lists already show.

   A formula is worked out by a small parser of its own (no eval): numbers, "text", {Field} references, + - * / % ^,
   & (joins text), = <> < > <= >=, AND / OR / NOT and the functions listed in FUNCS. */
(function (global) {
  'use strict';
  const { esc, num } = U;
  const ENTITIES = [
    { key: 'invoice', t: 'Sales Invoice' }, { key: 'purchase', t: 'Purchase / Quotation' },
    { key: 'customer', t: 'Customer' }, { key: 'supplier', t: 'Supplier' }, { key: 'item', t: 'Item' }
  ];
  const TYPES = [['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['select', 'Drop-down list'], ['check', 'Tick box (Yes / No)'], ['formula', 'Formula (worked out)']];
  const FORMATS = [['auto', 'As it comes'], ['number', 'Number'], ['money', 'Amount (currency)'], ['text', 'Text'], ['date', 'Date'], ['yesno', 'Yes / No']];
  const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
  const first = (s) => String(s || '').split('\n')[0].trim();
  const qty = (items) => (items || []).reduce((s, it) => s + num(it.qty), 0);

  // ------------------------------------------------------------ the standard fields a formula can read, per kind of record
  const BUILTIN = {
    invoice: (inv) => { const t = inv.totals || {}, b = inv.buyer || {}; return {
      'Invoice No': inv.no || '', 'Date': inv.date || '', 'Due Date': inv.dueDate || '', 'Payment Mode': inv.payment || '',
      'Buyer Name': first(b.name), 'Buyer GSTIN': b.gstin || '', 'Buyer State': b.state || '', 'Buyer Phone': b.phone || '',
      'Taxable Value': num(t.taxable), 'CGST': num(t.cgst), 'SGST': num(t.sgst), 'IGST': num(t.igst), 'Tax': r2(num(t.cgst) + num(t.sgst) + num(t.igst)),
      'Grand Total': num(t.grand), 'Total': num(t.rounded) || num(t.grand), 'Total Qty': qty(inv.items), 'Item Count': (inv.items || []).filter(it => String(it.desc || '').trim()).length,
      'Reverse Charge': !!inv.rcm, 'Vehicle No': (inv.other || {}).vehicleNo || '', 'Destination': (inv.other || {}).destination || '' }; },
    purchase: (p) => ({
      'Bill No': p.no || '', 'Date': p.date || '', 'Supplier': p.supplier || '', 'Supplier GSTIN': p.supplierGstin || '', 'Paid By': p.paidBy || '',
      'Taxable Value': num(p.taxable), 'CGST': num(p.cgst), 'SGST': num(p.sgst), 'IGST': num(p.igst), 'Tax': num(p.gst) || r2(num(p.cgst) + num(p.sgst) + num(p.igst)),
      'Total': num(p.total), 'TDS': num(p.tds), 'Total Qty': qty(p.items), 'Item Count': (p.items || []).filter(it => String(it.name || '').trim()).length, 'Reverse Charge': !!p.rcm }),
    customer: (c) => ({ 'Name': c.name || '', 'Phone': c.phone || '', 'Email': c.email || '', 'GSTIN': c.gstin || '', 'State': c.state || '', 'Address': c.address || '', 'TDS Rate': num(c.tdsRate) }),
    supplier: (c) => BUILTIN.customer(c),
    item: (i) => ({ 'Name': i.name || '', 'Code': i.code || '', 'HSN': i.hsn || '', 'GST Rate': num(i.gst), 'Rate': num(i.rate), 'Category': i.category || '' })
  };
  const builtinNames = (entity) => Object.keys(BUILTIN[entity]({ items: [], totals: {}, buyer: {}, other: {} }));

  // ------------------------------------------------------------ dates: dd/mm/yyyy as the books keep them
  const dateOf = (v) => { if (v instanceof Date) return v; const s = String(v == null ? '' : v).trim(); let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s); if (m) return new Date(+m[3], +m[2] - 1, +m[1]); m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (m) return new Date(+m[1], +m[2] - 1, +m[3]); return null; };
  const dmy = (d) => U.pad(d.getDate()) + '/' + U.pad(d.getMonth() + 1) + '/' + d.getFullYear();
  const DAY = 86400000;

  // ------------------------------------------------------------ the formula language
  class FormulaError extends Error {}
  function tokens(src) {
    const out = []; let i = 0; const s = String(src || '');
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '{') { const j = s.indexOf('}', i); if (j < 0) throw new FormulaError('A { has no closing }'); out.push({ t: 'ref', v: s.slice(i + 1, j).trim() }); i = j + 1; continue; }
      if (c === '"' || c === "'") { let j = i + 1, v = ''; while (j < s.length && s[j] !== c) { v += s[j]; j++; } if (j >= s.length) throw new FormulaError('Text in quotes is not closed'); out.push({ t: 'str', v }); i = j + 1; continue; }
      if (/[0-9.]/.test(c)) { const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i)); if (!m) throw new FormulaError('A number is not written right'); out.push({ t: 'num', v: parseFloat(m[1]) }); i += m[1].length; continue; }
      if (/[A-Za-z_]/.test(c)) { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i)); out.push({ t: 'id', v: m[0].toUpperCase() }); i += m[0].length; continue; }
      const two = s.slice(i, i + 2);
      if (['<=', '>=', '<>', '!=', '=='].includes(two)) { out.push({ t: 'op', v: two === '!=' ? '<>' : two === '==' ? '=' : two }); i += 2; continue; }
      if ('+-*/%^&=<>(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
      throw new FormulaError('"' + c + '" is not understood');
    }
    return out;
  }
  // Parses into a tree: {k: 'num'|'str'|'ref'|'bin'|'un'|'call', ...}
  function parse(src) {
    const tk = tokens(src); let p = 0;
    const peek = () => tk[p], isOp = (v) => tk[p] && tk[p].t === 'op' && tk[p].v === v, isId = (v) => tk[p] && tk[p].t === 'id' && tk[p].v === v;
    const expect = (v) => { if (!isOp(v)) throw new FormulaError('"' + v + '" expected'); p++; };
    function or() { let l = and(); while (isId('OR')) { p++; l = { k: 'bin', op: 'OR', l, r: and() }; } return l; }
    function and() { let l = not(); while (isId('AND')) { p++; l = { k: 'bin', op: 'AND', l, r: not() }; } return l; }
    function not() { if (isId('NOT') && !(tk[p + 1] && tk[p + 1].t === 'op' && tk[p + 1].v === '(')) { p++; return { k: 'un', op: 'NOT', x: not() }; } return cmp(); }
    function cmp() { let l = cat(); while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) { const op = tk[p++].v; l = { k: 'bin', op, l, r: cat() }; } return l; }
    function cat() { let l = add(); while (isOp('&')) { p++; l = { k: 'bin', op: '&', l, r: add() }; } return l; }
    function add() { let l = mul(); while (isOp('+') || isOp('-')) { const op = tk[p++].v; l = { k: 'bin', op, l, r: mul() }; } return l; }
    function mul() { let l = pow(); while (isOp('*') || isOp('/') || isOp('%')) { const op = tk[p++].v; l = { k: 'bin', op, l, r: pow() }; } return l; }
    function pow() { const l = unary(); if (isOp('^')) { p++; return { k: 'bin', op: '^', l, r: pow() }; } return l; }
    function unary() { if (isOp('-')) { p++; return { k: 'un', op: '-', x: unary() }; } if (isOp('+')) { p++; return unary(); } return prim(); }
    function prim() {
      const t = tk[p]; if (!t) throw new FormulaError('The formula ends too soon');
      if (t.t === 'num' || t.t === 'str') { p++; return { k: t.t, v: t.v }; }
      if (t.t === 'ref') { p++; return { k: 'ref', v: t.v }; }
      if (t.t === 'op' && t.v === '(') { p++; const e = or(); expect(')'); return e; }
      if (t.t === 'id') {
        p++;
        if (t.v === 'TRUE' || t.v === 'FALSE') return { k: 'bool', v: t.v === 'TRUE' };
        if (!FUNCS[t.v]) throw new FormulaError(t.v + ' is not a function BlitzBook knows. Field names go in { }');
        expect('('); const args = [];
        if (!isOp(')')) { args.push(or()); while (isOp(',')) { p++; args.push(or()); } }
        expect(')');
        return { k: 'call', f: t.v, args };
      }
      throw new FormulaError('"' + t.v + '" is not expected here');
    }
    const tree = or(); if (p < tk.length) throw new FormulaError('"' + (tk[p].v) + '" is not expected here');
    return tree;
  }
  const isBlank = (v) => v == null || v === '' || (typeof v === 'number' && isNaN(v));
  const toNum = (v) => typeof v === 'boolean' ? (v ? 1 : 0) : num(v);
  const toStr = (v) => v == null ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'number' ? String(r2(v) === v ? v : Math.round(v * 1e6) / 1e6) : v instanceof Date ? dmy(v) : String(v);
  const truthy = (v) => typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : /^(yes|y|true|1)$/i.test(String(v || '').trim());
  const looksNum = (v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && isFinite(+v.replace(/,/g, '')));
  // Each takes the evaluated arguments; IF, AND and OR take the trees so the branch not taken is not worked out
  const FUNCS = {
    IF: { lazy: true, fn: (a, ev) => { if (a.length < 2) throw new FormulaError('IF needs a condition and a value'); return truthy(ev(a[0])) ? ev(a[1]) : a.length > 2 ? ev(a[2]) : ''; }, help: 'IF(condition, value if yes, value if no)' },
    IFS: { lazy: true, fn: (a, ev) => { for (let i = 0; i + 1 < a.length; i += 2) if (truthy(ev(a[i]))) return ev(a[i + 1]); return a.length % 2 ? ev(a[a.length - 1]) : ''; }, help: 'IFS(cond1, value1, cond2, value2, ..., otherwise)' },
    AND: { lazy: true, fn: (a, ev) => a.every(x => truthy(ev(x))), help: 'AND(a, b, ...)' },
    OR: { lazy: true, fn: (a, ev) => a.some(x => truthy(ev(x))), help: 'OR(a, b, ...)' },
    NOT: { fn: (a) => !truthy(a[0]), help: 'NOT(a)' },
    ROUND: { fn: (a) => { const d = a.length > 1 ? toNum(a[1]) : 0, f = Math.pow(10, d); return Math.round((toNum(a[0]) + Number.EPSILON) * f) / f; }, help: 'ROUND(number, decimals)' },
    ROUNDUP: { fn: (a) => { const f = Math.pow(10, a.length > 1 ? toNum(a[1]) : 0); return Math.ceil(toNum(a[0]) * f - 1e-9) / f; }, help: 'ROUNDUP(number, decimals)' },
    ROUNDDOWN: { fn: (a) => { const f = Math.pow(10, a.length > 1 ? toNum(a[1]) : 0); return Math.floor(toNum(a[0]) * f + 1e-9) / f; }, help: 'ROUNDDOWN(number, decimals)' },
    CEIL: { fn: (a) => Math.ceil(toNum(a[0])), help: 'CEIL(number)' }, FLOOR: { fn: (a) => Math.floor(toNum(a[0])), help: 'FLOOR(number)' },
    ABS: { fn: (a) => Math.abs(toNum(a[0])), help: 'ABS(number)' },
    MIN: { fn: (a) => a.length ? Math.min.apply(null, a.map(toNum)) : 0, help: 'MIN(a, b, ...)' }, MAX: { fn: (a) => a.length ? Math.max.apply(null, a.map(toNum)) : 0, help: 'MAX(a, b, ...)' },
    SUM: { fn: (a) => a.reduce((s, x) => s + toNum(x), 0), help: 'SUM(a, b, ...)' }, AVG: { fn: (a) => a.length ? a.reduce((s, x) => s + toNum(x), 0) / a.length : 0, help: 'AVG(a, b, ...)' },
    PERCENT: { fn: (a) => toNum(a[0]) * toNum(a[1]) / 100, help: 'PERCENT(amount, rate) = amount x rate / 100' },
    LEN: { fn: (a) => toStr(a[0]).length, help: 'LEN(text)' }, UPPER: { fn: (a) => toStr(a[0]).toUpperCase(), help: 'UPPER(text)' }, LOWER: { fn: (a) => toStr(a[0]).toLowerCase(), help: 'LOWER(text)' },
    TRIM: { fn: (a) => toStr(a[0]).trim(), help: 'TRIM(text)' }, CONCAT: { fn: (a) => a.map(toStr).join(''), help: 'CONCAT(a, b, ...)' },
    LEFT: { fn: (a) => toStr(a[0]).slice(0, a.length > 1 ? toNum(a[1]) : 1), help: 'LEFT(text, count)' }, RIGHT: { fn: (a) => { const s = toStr(a[0]), n = a.length > 1 ? toNum(a[1]) : 1; return n > 0 ? s.slice(-n) : ''; }, help: 'RIGHT(text, count)' },
    CONTAINS: { fn: (a) => toStr(a[0]).toLowerCase().includes(toStr(a[1]).toLowerCase()), help: 'CONTAINS(text, part)' },
    TEXT: { fn: (a) => { const n = toNum(a[0]), d = a.length > 1 ? toNum(a[1]) : 2; return n.toFixed(Math.max(0, Math.min(6, d))); }, help: 'TEXT(number, decimals)' },
    NUM: { fn: (a) => toNum(a[0]), help: 'NUM(text)' },
    ISBLANK: { fn: (a) => isBlank(a[0]), help: 'ISBLANK(value)' },
    TODAY: { fn: () => dmy(new Date()), help: 'TODAY()' },
    DAYS: { fn: (a) => { const x = dateOf(a[0]), y = dateOf(a[1]); return x && y ? Math.round((y - x) / DAY) : 0; }, help: 'DAYS(from date, to date)' },
    ADDDAYS: { fn: (a) => { const d = dateOf(a[0]); return d ? dmy(new Date(d.getTime() + Math.round(toNum(a[1])) * DAY)) : ''; }, help: 'ADDDAYS(date, days)' },
    YEAR: { fn: (a) => { const d = dateOf(a[0]); return d ? d.getFullYear() : 0; }, help: 'YEAR(date)' }, MONTH: { fn: (a) => { const d = dateOf(a[0]); return d ? d.getMonth() + 1 : 0; }, help: 'MONTH(date)' }, DAY: { fn: (a) => { const d = dateOf(a[0]); return d ? d.getDate() : 0; }, help: 'DAY(date)' }
  };
  function evaluate(tree, lookup) {
    const ev = (n) => {
      switch (n.k) {
        case 'num': case 'str': case 'bool': return n.v;
        case 'ref': return lookup(n.v);
        case 'un': return n.op === '-' ? -toNum(ev(n.x)) : !truthy(ev(n.x));
        case 'call': { const f = FUNCS[n.f]; return f.lazy ? f.fn(n.args, ev) : f.fn(n.args.map(ev)); }
        case 'bin': {
          if (n.op === 'AND') return truthy(ev(n.l)) && truthy(ev(n.r));
          if (n.op === 'OR') return truthy(ev(n.l)) || truthy(ev(n.r));
          const a = ev(n.l), b = ev(n.r);
          switch (n.op) {
            case '+': return toNum(a) + toNum(b); case '-': return toNum(a) - toNum(b); case '*': return toNum(a) * toNum(b);
            case '/': return toNum(b) === 0 ? 0 : toNum(a) / toNum(b); case '%': return toNum(b) === 0 ? 0 : toNum(a) % toNum(b); case '^': return Math.pow(toNum(a), toNum(b));
            case '&': return toStr(a) + toStr(b);
            default: {
              // Numbers compare as numbers, dates as dates, everything else as text without regard to case
              let x, y; const da = typeof a === 'string' && dateOf(a), db = typeof b === 'string' && dateOf(b);
              if (looksNum(a) && looksNum(b)) { x = toNum(a); y = toNum(b); } else if (da && db) { x = da.getTime(); y = db.getTime(); } else if (typeof a === 'boolean' || typeof b === 'boolean') { x = truthy(a) ? 1 : 0; y = truthy(b) ? 1 : 0; } else { x = toStr(a).trim().toLowerCase(); y = toStr(b).trim().toLowerCase(); }
              return n.op === '=' ? x === y : n.op === '<>' ? x !== y : n.op === '<' ? x < y : n.op === '>' ? x > y : n.op === '<=' ? x <= y : x >= y;
            }
          }
        }
      }
      return '';
    };
    return ev(tree);
  }
  const refsOf = (tree, out) => { out = out || new Set(); if (!tree) return out; if (tree.k === 'ref') out.add(tree.v.toLowerCase()); ['l', 'r', 'x'].forEach(k => tree[k] && refsOf(tree[k], out)); (tree.args || []).forEach(a => refsOf(a, out)); return out; };
  const cache = new Map();
  function compiled(src) { if (cache.has(src)) return cache.get(src); let r; try { r = { tree: parse(src) }; } catch (e) { r = { err: e.message }; } r.refs = r.tree ? refsOf(r.tree) : new Set(); cache.set(src, r); return r; }

  // ------------------------------------------------------------ the definitions
  const CF = {
    ENTITIES, TYPES, FUNCS, FormulaError, parse, evaluate, builtinNames,
    all() { const d = global.Settings ? Settings.doc() : {}; return Array.isArray(d.customFields) ? d.customFields.filter(f => f && f.label && f.entity) : []; },
    of(entity) { return this.all().filter(f => f.entity === entity); },
    save(list) { return Settings.save({ customFields: list.length ? list : undefined }); },
    // Where the values of a kind of record are kept
    bag(entity, rec, make) { const k = entity === 'customer' || entity === 'supplier' ? 'extra' : 'cf'; if (!rec[k] || typeof rec[k] !== 'object') { if (!make) return {}; rec[k] = {}; } return rec[k]; },
    contactEntity(type) { return /^supp/i.test(type || '') ? 'supplier' : 'customer'; },

    // Every value of a record, the standard fields and the custom ones, with the formulas and auto-fills worked out.
    // Returns {values: {label: value}, errors: {label: message}}
    compute(entity, rec) {
      const defs = this.of(entity), bag = this.bag(entity, rec), base = BUILTIN[entity] ? BUILTIN[entity](rec) : {};
      const byName = new Map(); defs.forEach(f => byName.set(f.label.toLowerCase(), f));
      const baseLow = new Map(Object.keys(base).map(k => [k.toLowerCase(), base[k]]));
      const values = {}, errors = {}, busy = new Set(), done = new Map(), manual = new Set((rec.cfManual || []).map(x => String(x).toLowerCase()));
      const valueOf = (name) => {
        const k = String(name || '').trim().toLowerCase();
        if (done.has(k)) return done.get(k);
        const f = byName.get(k);
        if (!f) { if (baseLow.has(k)) return baseLow.get(k); const alias = k.replace(/(tax id|trn|abn)/, 'gstin').replace(/(vat|sales tax)/, 'tax'); if (alias !== k && baseLow.has(alias)) return baseLow.get(alias); throw new FormulaError('There is no field called {' + name + '}'); }
        if (busy.has(k)) throw new FormulaError('{' + f.label + '} depends on itself');
        busy.add(k);
        let v;
        try {
          const rule = f.type === 'formula' ? f.formula : f.fill && !manual.has(k) ? f.fill : '';
          if (rule) { const c = compiled(rule); if (c.err) throw new FormulaError(c.err); v = evaluate(c.tree, valueOf); if (f.type !== 'formula' && (v === '' || v == null) && bag[f.label] != null) v = bag[f.label]; }
          else v = bag[f.label] != null ? bag[f.label] : f.type === 'check' ? false : '';
          if (f.type === 'number' || (f.type === 'formula' && ['number', 'money'].includes(f.format))) v = isBlank(v) || v === '' ? (f.type === 'number' ? '' : 0) : toNum(v);
          if (f.type === 'check') v = truthy(v);
        } catch (e) { busy.delete(k); errors[f.label] = e.message; done.set(k, ''); throw e; }
        busy.delete(k); done.set(k, v);
        return v;
      };
      defs.forEach(f => { try { values[f.label] = valueOf(f.label); } catch (e) { if (!errors[f.label]) errors[f.label] = e.message; values[f.label] = ''; } });
      return { values, errors, base };
    },
    // Puts the worked-out values on the record (what is printed, listed and synced)
    apply(entity, rec) {
      const defs = this.of(entity); if (!defs.length) return rec;
      const r = this.compute(entity, rec), bag = this.bag(entity, rec, true);
      defs.forEach(f => { const v = r.values[f.label]; if (f.type === 'formula' || (f.fill && !(rec.cfManual || []).some(x => String(x).toLowerCase() === f.label.toLowerCase()))) { if (v === '' || v == null) delete bag[f.label]; else bag[f.label] = typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v; } });
      return rec;
    },
    // A value as it is shown and printed
    show(f, v) {
      if (v == null || v === '') return '';
      const fmt = f.type === 'formula' ? f.format || 'auto' : f.type;
      if (fmt === 'check' || fmt === 'yesno') return truthy(v) ? 'Yes' : 'No';
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (fmt === 'money') return U.inr(num(v));
      if (fmt === 'number' || (fmt === 'auto' && typeof v === 'number')) { const d = f.decimals === '' || f.decimals == null ? null : num(f.decimals); return d == null ? String(Math.round(num(v) * 1e4) / 1e4) : num(v).toFixed(d); }
      if (fmt === 'date') { const d = dateOf(v); return d ? dmy(d) : String(v); }
      return String(v);
    },
    // Label / value pairs for the printed document: the fields ticked "Print"
    printPairs(entity, rec) {
      const defs = this.of(entity).filter(f => f.print); if (!defs.length) return [];
      const r = this.compute(entity, rec), bag = this.bag(entity, rec);
      return defs.map(f => [f.label, this.show(f, r.values[f.label] != null && r.values[f.label] !== '' ? r.values[f.label] : bag[f.label])]).filter(p => p[1] !== '');
    },
    listed(entity) { return this.of(entity).filter(f => f.list); },
    cell(entity, rec, f) { const v = this.bag(entity, rec)[f.label]; return v == null || v === '' ? '-' : esc(this.show(f, v)); },

    // ------------------------------------------------------------ the fields on a form
    inputId: (i) => 'cfx' + i,
    inputs(entity, rec, opts) {
      const defs = this.of(entity); if (!defs.length) return '';
      opts = opts || {}; const bag = this.bag(entity, rec), r = this.compute(entity, rec);
      return defs.map((f, i) => {
        const id = this.inputId(i), v = r.values[f.label] != null && r.values[f.label] !== '' ? r.values[f.label] : bag[f.label], req = !!f.req, hint = f.help || (f.type === 'formula' ? '= ' + f.formula : f.fill ? 'Filled in by: ' + f.fill : '');
        let inner;
        if (f.type === 'formula') inner = '<input id="' + id + '" data-cf="' + i + '" class="cf-calc" readonly tabindex="-1" value="' + esc(this.show(f, v)) + '">';
        else if (f.type === 'select') inner = UI.select(id, (f.options || []).map(o => [o, o]), v == null ? '' : String(v), { blank: '—', attrs: ' data-cf="' + i + '"' });
        else if (f.type === 'check') inner = '<label class="check"><input type="checkbox" id="' + id + '" data-cf="' + i + '"' + (truthy(v) ? ' checked' : '') + '> ' + esc(f.label) + '</label>';
        else if (f.type === 'date') inner = '<input id="' + id + '" data-cf="' + i + '" type="date" value="' + esc(U.toIso(v ? this.show(f, v) : '')) + '">';
        else inner = '<input id="' + id + '" data-cf="' + i + '"' + (f.type === 'number' ? ' type="number" step="any"' : '') + ' value="' + esc(v == null ? '' : v) + '">';
        return UI.field(f.type === 'check' ? ' ' : f.label, inner, { req, hint });
      }).join('');
    },
    // The fields as a card of their own (the invoice editor)
    card(entity, rec) {
      const html = this.inputs(entity, rec); if (!html) return '';
      return '<div class="card" id="cfCard"><div class="hd">Additional Fields' + (Settings.mayEdit() ? ' <span class="inline"><button class="btn sm outline" id="cfEdit" type="button" title="Settings &gt; Custom Fields">Fields…</button></span>' : '') + '</div><div class="bd"><div class="grid3">' + html + '</div><div class="hint" id="cfErr"></div></div></div>';
    },
    // Reads what is typed into the record as it changes, and works the formulas out again; onChange (optional) is told after each
    wire(root, entity, rec, onChange) {
      const defs = this.of(entity); if (!defs.length) return;
      const bag = this.bag(entity, rec, true);
      const read = (el) => {
        const f = defs[+el.dataset.cf]; if (!f || f.type === 'formula') return;
        let v = el.type === 'checkbox' ? (el.checked ? 'Yes' : '') : el.type === 'date' ? U.fromIso(el.value) : el.value;
        if (f.type === 'number') v = String(v).trim() === '' ? '' : num(v);
        if (v === '' || v == null) delete bag[f.label]; else bag[f.label] = v;
        // Typed by hand: an auto-filled field keeps what was typed; cleared, the rule fills it again
        if (f.fill) { const m = new Set(rec.cfManual || []); if (v === '' || v == null) m.delete(f.label); else m.add(f.label); rec.cfManual = Array.from(m); if (!rec.cfManual.length) delete rec.cfManual; }
      };
      $$('[data-cf]', root).forEach(el => { const h = () => { read(el); this.refresh(root, entity, rec); if (onChange) onChange(); }; el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', h); el.addEventListener('blur', () => setTimeout(() => this.refresh(root, entity, rec), 0)); });
      const edit = $('#cfEdit', root); if (edit) edit.onclick = () => App.go('settings', { tab: 'fields', entity });
      this.refresh(root, entity, rec);
    },
    // The formula and auto-filled fields shown again (after any change on the form)
    refresh(root, entity, rec) {
      const defs = this.of(entity); if (!defs.length || !root) return;
      const r = this.compute(entity, rec), active = document.activeElement;
      defs.forEach((f, i) => {
        const el = $('#' + this.inputId(i), root); if (!el) return;
        if (f.type !== 'formula' && !f.fill) return;
        // A box being typed into is left alone until it is left (a list or a tick box has nothing half-typed)
        if (el === active && el.tagName === 'INPUT' && el.type !== 'checkbox' && !el.readOnly) return;
        const v = r.values[f.label];
        if (f.type === 'formula') el.value = this.show(f, v);
        else if (f.type === 'check') el.checked = truthy(v);
        else if (f.type === 'date') el.value = U.toIso(v ? this.show(f, v) : '');
        else el.value = v == null ? '' : v;
        el.classList.toggle('err', !!r.errors[f.label]);
      });
      const box = $('#cfErr', root), msgs = Object.keys(r.errors).map(k => k + ': ' + r.errors[k]);
      if (box) { box.textContent = msgs.join(' · '); box.classList.toggle('red', msgs.length > 0); }
    },
    // Before a save: the required fields filled, the formulas worked out onto the record. False (with a note) when one is missing.
    check(entity, rec, root) {
      const defs = this.of(entity); if (!defs.length) return true;
      this.apply(entity, rec);
      const bag = this.bag(entity, rec), miss = defs.find(f => f.req && f.type !== 'formula' && f.type !== 'check' && (bag[f.label] == null || String(bag[f.label]).trim() === ''));
      if (miss) { const i = defs.indexOf(miss); if (root) UI.mark(this.inputId(i), true, root); UI.toast(miss.label + ' is required'); return false; }
      return true;
    },
    // Carries the values of a form (a dialog that rebuilds its record from the boxes on Save) onto the record
    collect(root, entity, rec) {
      const defs = this.of(entity); if (!defs.length) return true;
      const bag = this.bag(entity, rec, true);
      defs.forEach((f, i) => { if (f.type === 'formula') return; const el = $('#' + this.inputId(i), root); if (!el) return; let v = el.type === 'checkbox' ? (el.checked ? 'Yes' : '') : el.type === 'date' ? U.fromIso(el.value) : el.value; if (f.type === 'number') v = String(v).trim() === '' ? '' : num(v); if (v === '' || v == null) delete bag[f.label]; else bag[f.label] = typeof v === 'string' ? v.trim() : v; });
      // An auto-filled field that holds something other than its rule gives was typed by hand: it keeps what was typed
      const fills = defs.filter(f => f.fill && f.type !== 'formula');
      if (fills.length) { const typed = {}; fills.forEach(f => { typed[f.label] = bag[f.label]; }); delete rec.cfManual; const auto = this.compute(entity, rec).values, same = (a, b) => String(a == null ? '' : a) === String(b == null ? '' : b); const manual = fills.filter(f => typed[f.label] != null && typed[f.label] !== '' && !same(typed[f.label], auto[f.label])).map(f => f.label); if (manual.length) rec.cfManual = manual; }
      return this.check(entity, rec, root);
    },

    // ------------------------------------------------------------ Settings > Custom Fields
    tab(params) {
      const edit = Settings.mayEdit(), ent = ENTITIES.some(e => e.key === (params && params.entity)) ? params.entity : 'invoice', defs = this.of(ent), all = this.all();
      const typeName = (t) => (TYPES.find(x => x[0] === t) || ['', t])[1];
      const rows = defs.map((f, i) => '<tr><td data-l="Field"><b>' + esc(f.label) + '</b>' + (f.req ? ' <span class="pill warn">required</span>' : '') + '</td><td data-l="Type">' + esc(typeName(f.type)) + (f.type === 'select' ? '<div class="small muted">' + esc((f.options || []).join(', ')) + '</div>' : '') + '</td>' +
        '<td data-l="Worked out from" data-asis>' + (f.type === 'formula' || f.fill ? '<code class="small">' + esc(f.type === 'formula' ? '= ' + f.formula : 'auto-fill: ' + f.fill) + '</code>' : '') + '</td><td data-l="Shown">' + [f.print ? 'Print' : '', f.list ? 'List' : ''].filter(Boolean).join(', ') + '</td>' +
        '<td class="actions">' + (edit ? '<div class="ibtns">' + UI.ibtn('edit', 'Edit', 'data-cfe="' + i + '"', 'primary') + (i > 0 ? UI.ibtn('arrow', 'Move up', 'data-cfu="' + i + '"') : '') + UI.ibtn('trash', 'Remove', 'data-cfd="' + i + '"') + '</div>' : '') + '</td></tr>').join('');
      return { html: '<div class="card white"><div class="hd">Custom fields</div><div class="bd">' +
          '<p class="hint" style="margin-top:0">Add fields of your own to the records of <b>' + esc(Store.company().name || 'this company') + '</b>. A <b>formula</b> field is worked out from other fields every time one of them changes (like a spreadsheet); any other field can have an <b>auto-fill</b> rule that fills it from other fields until somebody types over it. Every user of the company sees the same fields.</p>' +
          '<div class="setnav" role="tablist" style="margin:0 0 10px">' + ENTITIES.map(e => '<button type="button" role="tab" class="' + (e.key === ent ? 'sel' : '') + '" data-cfent="' + e.key + '"><span>' + esc(e.t) + ' (' + all.filter(f => f.entity === e.key).length + ')</span></button>').join('') + '</div>' +
          (defs.length ? '<div class="tablewrap"><table class="list cards"><thead><tr><th>Field</th><th>Type</th><th>Worked out from</th><th>Shown</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No custom fields on a ' + esc(ENTITIES.find(e => e.key === ent).t.toLowerCase()) + ' yet.</div>') +
          (edit ? '<div class="btnrow"><button class="btn green" id="cfAdd">+ Add field</button></div>' : '<div class="hint">Only the owner or an admin adds or changes fields.</div>') + '</div></div>' +
          '<div class="card white cfhelp" data-asis><div class="hd">Writing a formula</div><div class="bd"><p class="hint" style="margin-top:0">Put field names in curly brackets. The standard fields of a ' + esc(ENTITIES.find(e => e.key === ent).t.toLowerCase()) + ' are: ' + builtinNames(ent).map(n => '<code>{' + esc(n) + '}</code>').join(' ') + ', and every custom field by its name.</p>' +
          '<p class="hint">Operators: <code>+ - * / % ^</code>, <code>&amp;</code> joins text, <code>= &lt;&gt; &lt; &gt; &lt;= &gt;=</code>, <code>AND OR NOT</code>. Text goes in "quotes". Functions: ' + Object.keys(FUNCS).map(k => '<code title="' + esc(FUNCS[k].help) + '">' + k + '</code>').join(' ') + '.</p>' +
          '<p class="hint">Examples: <code>ROUND({Taxable Value} * 2 / 100, 2)</code> · <code>{Grand Total} + {Freight}</code> · <code>IF({Total} &gt; 50000, "E-way bill needed", "")</code> · <code>ADDDAYS({Date}, 45)</code> · <code>UPPER(LEFT({Buyer Name}, 3)) &amp; "-" &amp; {Invoice No}</code></p></div></div>',
        wire: (root, again) => {
          $$('[data-cfent]', root).forEach(b => b.onclick = () => App.go('settings', { tab: 'fields', entity: b.dataset.cfent }));
          if (!edit) return;
          const allNow = () => this.all();
          const store = (list) => { if (this.save(list) === false) return false; again(); return true; };
          $('#cfAdd').onclick = () => this.editDialog(ent, null, () => App.go('settings', { tab: 'fields', entity: ent }));
          $$('[data-cfe]', root).forEach(b => b.onclick = () => this.editDialog(ent, defs[+b.dataset.cfe], () => App.go('settings', { tab: 'fields', entity: ent })));
          $$('[data-cfu]', root).forEach(b => b.onclick = () => { const f = defs[+b.dataset.cfu], g = defs[+b.dataset.cfu - 1], l = allNow(), a = l.indexOf(l.find(x => x.id === f.id)), c = l.indexOf(l.find(x => x.id === g.id)); l[a] = g; l[c] = f; store(l); });
          $$('[data-cfd]', root).forEach(b => b.onclick = () => { const f = defs[+b.dataset.cfd]; const users = allNow().filter(x => x.id !== f.id && x.entity === f.entity && compiled((x.type === 'formula' ? x.formula : x.fill) || '').refs.has(f.label.toLowerCase()));
            UI.confirm('Remove field', 'Remove "' + f.label + '"? Values already saved on records stay in the backup but are no longer shown.' + (users.length ? ' ' + users.map(x => x.label).join(', ') + (users.length > 1 ? ' use' : ' uses') + ' it in a formula and will show an error.' : ''), () => store(allNow().filter(x => x.id !== f.id)), 'Remove'); });
        } };
    },
    editDialog(entity, f, done) {
      const fresh = !f; f = Object.assign({ id: U.uid(), entity, label: '', type: 'text', options: [], formula: '', fill: '', format: 'auto', decimals: '', req: false, print: entity === 'invoice' || entity === 'purchase', list: false, help: '' }, f || {});
      const others = this.of(entity).filter(x => x.id !== f.id), names = builtinNames(entity).concat(others.map(x => x.label));
      const chips = '<div class="small" data-asis style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">' + names.map(n => '<button type="button" class="btn sm outline" data-ins="' + esc(n) + '" style="padding:2px 8px;min-height:0">{' + esc(n) + '}</button>').join('') + '</div>';
      const bg = UI.modal({ title: fresh ? 'Add field' : 'Edit field', wide: true, body: '<div class="grid2">' +
        UI.field('Field name', UI.input('cfL', f.label, { placeholder: 'e.g. Freight, Zone, Landed Cost' }), { req: true }) + UI.field('Type', UI.select('cfT', TYPES, f.type)) + '</div>' +
        '<div id="cfOptBox">' + UI.field('Choices (one a line)', '<textarea id="cfO" rows="4" placeholder="North\nSouth\nEast\nWest">' + esc((f.options || []).join('\n')) + '</textarea>') + '</div>' +
        '<div id="cfFBox">' + UI.field('Formula', '<textarea id="cfF" rows="2" style="font-family:monospace" placeholder="e.g. ROUND({Taxable Value} * 2 / 100, 2)">' + esc(f.formula) + '</textarea>' + chips, { hint: 'Worked out again whenever a field it reads changes. It cannot be typed into.' }) +
          '<div class="grid2">' + UI.field('Show the result as', UI.select('cfFmt', FORMATS, f.format)) + UI.field('Decimals', UI.input('cfDec', f.decimals, { type: 'number', placeholder: 'as it comes', attrs: ' min="0" max="6"' })) + '</div></div>' +
        '<div id="cfFillBox">' + UI.field('Auto-fill from other fields (optional)', '<textarea id="cfFill" rows="2" style="font-family:monospace" placeholder="e.g. IF(CONTAINS({Buyer State}, &quot;(29)&quot;), &quot;South&quot;, &quot;&quot;)">' + esc(f.fill) + '</textarea>' + chips.replace(/data-ins=/g, 'data-ins2='), { hint: 'The field takes this value whenever the fields it reads change, until somebody types over it. Cleared, the rule fills it again.' }) + '</div>' +
        '<div class="field" data-asis><label>Test</label><div class="hint" id="cfTest">—</div></div>' +
        UI.field('Help text (optional)', UI.input('cfH', f.help, { placeholder: 'Shown under the field' })) +
        '<div class="grid3">' + UI.check('cfReq', 'Required', f.req) + UI.check('cfPr', entity === 'invoice' || entity === 'purchase' ? 'Print on the document' : 'Print (where the record prints)', f.print) + UI.check('cfLs', 'Show as a column in the list', f.list) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save field', cls: 'green', onClick: (bg) => {
          const label = UI.val('cfL', bg).trim().replace(/[{}]/g, ''), type = UI.val('cfT', bg);
          if (!label) { UI.mark('cfL', true, bg); UI.toast('Give the field a name'); return false; }
          if (builtinNames(entity).some(n => n.toLowerCase() === label.toLowerCase())) { UI.mark('cfL', true, bg); UI.toast('"' + label + '" is a standard field already; choose another name'); return false; }
          if (others.some(x => x.label.toLowerCase() === label.toLowerCase())) { UI.mark('cfL', true, bg); UI.toast('There is a field with that name already'); return false; }
          const options = UI.val('cfO', bg).split('\n').map(s => s.trim()).filter(Boolean), formula = UI.val('cfF', bg).trim(), fill = UI.val('cfFill', bg).trim();
          if (type === 'select' && !options.length) { UI.mark('cfO', true, bg); UI.toast('Type the choices of the list'); return false; }
          if (type === 'formula' && !formula) { UI.mark('cfF', true, bg); UI.toast('Type the formula'); return false; }
          const rule = type === 'formula' ? formula : fill;
          if (rule) { const c = compiled(rule); if (c.err) { UI.mark(type === 'formula' ? 'cfF' : 'cfFill', true, bg); UI.toast('Formula: ' + c.err, 5000); return false; }
            const unknown = Array.from(c.refs).filter(r => !names.some(n => n.toLowerCase() === r) && r !== label.toLowerCase()); if (unknown.length) { UI.toast('No field called {' + unknown[0] + '}', 5000); return false; } }
          const oldLabel = fresh ? null : f.label;
          const def = { id: f.id, entity, label, type, options: type === 'select' ? options : [], formula: type === 'formula' ? formula : '', fill: type === 'formula' ? '' : fill, format: type === 'formula' ? UI.val('cfFmt', bg) : 'auto', decimals: UI.val('cfDec', bg), req: type !== 'formula' && !!UI.val('cfReq', bg), print: !!UI.val('cfPr', bg), list: !!UI.val('cfLs', bg), help: UI.val('cfH', bg).trim() };
          const list = this.all(), at = list.findIndex(x => x.id === f.id);
          // A renamed field: the formulas that read it and the values saved under the old name follow the new name
          if (oldLabel && oldLabel !== label) {
            const re = new RegExp('\\{\\s*' + oldLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\}', 'gi');
            list.forEach(x => { if (x.entity !== entity) return; if (x.formula) x.formula = x.formula.replace(re, '{' + label + '}'); if (x.fill) x.fill = x.fill.replace(re, '{' + label + '}'); });
            if (def.formula) def.formula = def.formula.replace(re, '{' + label + '}'); if (def.fill) def.fill = def.fill.replace(re, '{' + label + '}');
            this.renameValues(entity, oldLabel, label);
          }
          if (at >= 0) list[at] = def; else list.push(def);
          if (this.save(list) === false) return false;
          // A contact's custom field is one of the contact list's own columns too
          if (entity === 'customer' || entity === 'supplier') { const key = 'customcols_contacts_' + (entity === 'customer' ? 'Customer' : 'Supplier'), l = (Store.get(key, []) || []).filter(n => n !== oldLabel); if (!l.includes(label)) l.push(label); Store.set(key, l, true); }
          UI.toast('Field "' + label + '" saved', 2500, 'ok'); if (done) done();
        } }] });
      const show = () => { const t = UI.val('cfT', bg); $('#cfOptBox', bg).classList.toggle('hidden', t !== 'select'); $('#cfFBox', bg).classList.toggle('hidden', t !== 'formula'); $('#cfFillBox', bg).classList.toggle('hidden', t === 'formula'); $('#cfReq', bg).closest('label').classList.toggle('hidden', t === 'formula'); test(); };
      // The rule tried on the latest record of the kind, so a mistake shows at once
      const sample = () => { const list = entity === 'invoice' ? Biz.invoices() : entity === 'purchase' ? Store.list('purchases') : entity === 'item' ? Store.items() : Biz.contactsOf(entity === 'customer' ? 'Customer' : 'Supplier'); return list.length ? list[list.length - 1] : null; };
      const test = () => {
        const t = UI.val('cfT', bg), rule = (t === 'formula' ? UI.val('cfF', bg) : UI.val('cfFill', bg)).trim(), out = $('#cfTest', bg);
        if (!rule) { out.textContent = '—'; out.classList.remove('red'); return; }
        const c = compiled(rule); if (c.err) { out.textContent = c.err; out.classList.add('red'); return; }
        const rec = sample(); if (!rec) { out.textContent = 'The formula reads well. (No record yet to try it on.)'; out.classList.remove('red'); return; }
        try {
          const copy = JSON.parse(JSON.stringify(rec)), r = this.compute(entity, copy), self = UI.val('cfL', bg).trim().toLowerCase();
          const v = evaluate(c.tree, (n) => { const k = n.toLowerCase(); if (k === self) throw new FormulaError('A field cannot read itself'); const key = Object.keys(r.values).find(x => x.toLowerCase() === k); if (key) return r.values[key]; const b = Object.keys(r.base).find(x => x.toLowerCase() === k); if (b) return r.base[b]; throw new FormulaError('There is no field called {' + n + '}'); });
          out.textContent = 'On ' + (rec.no || rec.name || 'the latest record') + ': ' + this.show({ type: t === 'formula' ? 'formula' : 'text', format: UI.val('cfFmt', bg), decimals: UI.val('cfDec', bg) }, v); out.classList.remove('red');
        } catch (e) { out.textContent = e.message; out.classList.add('red'); }
      };
      const insert = (id, text) => { const ta = $('#' + id, bg), s = ta.selectionStart || ta.value.length, e = ta.selectionEnd || s; ta.value = ta.value.slice(0, s) + '{' + text + '}' + ta.value.slice(e); ta.focus(); ta.selectionStart = ta.selectionEnd = s + text.length + 2; test(); };
      $$('[data-ins]', bg).forEach(b => b.onclick = () => insert('cfF', b.dataset.ins));
      $$('[data-ins2]', bg).forEach(b => b.onclick = () => insert('cfFill', b.dataset.ins2));
      ['cfF', 'cfFill', 'cfFmt', 'cfDec', 'cfL'].forEach(id => $('#' + id, bg).addEventListener('input', test));
      $('#cfT', bg).addEventListener('change', show); show();
    },
    // The values kept under a field's old name move to the new one, on every record of the kind
    renameValues(entity, from, to) {
      const col = entity === 'invoice' ? 'invoices' : entity === 'purchase' ? 'purchases' : entity === 'item' ? 'items' : 'contacts', key = col === 'contacts' ? 'extra' : 'cf';
      const list = Store.list(col); let ch = false;
      list.forEach(r => { if (col === 'contacts' && this.contactEntity(r.type) !== entity) return; const b = r[key]; if (b && Object.prototype.hasOwnProperty.call(b, from)) { b[to] = b[from]; delete b[from]; if (Array.isArray(r.cfManual)) r.cfManual = r.cfManual.map(x => x === from ? to : x); r.updatedAt = Date.now(); ch = true; } });
      if (ch) Store.saveList(col, list);
    }
  };

  // ------------------------------------------------------------ the invoice editor (invoice.js) keeps its fields in step
  if (global.Invoice) {
    const validate = Invoice.validate;
    Invoice.validate = function () { const ok = validate.apply(this, arguments); if (!ok) return ok; if (this.inv && this.inv.kind !== 'challan' && !CF.check('invoice', this.inv, $('#view'))) return false; return ok; };
    const totals = Invoice.updateTotals;
    Invoice.updateTotals = function () { const r = totals.apply(this, arguments); if (this.inv && this.inv.kind !== 'challan') CF.refresh($('#view'), 'invoice', this.inv); return r; };
  }
  global.CustomFields = CF;
})(window);
