/* BlitzBook web portal - Rental: property let by the month (line of activity Rental Services, or that business ticked
   under Company > Businesses & Tabs): a PG or hostel letting beds, a landlord with flats or shops, a co-living
   operator, somebody letting furnished rooms.

   What it does:
     Overview            the rooms and beds let and vacant, the occupancy, the rent of the month and what of it has come
                         in, what is outstanding, the deposits held; who owes rent now (with Collect), who moves in or
                         out soon, what stands vacant
     Buildings & Rooms   the buildings, the rooms / flats / shops in each (floor, kind, area, rent, deposit, capacity),
                         and the beds of a room that is let by the bed; vacant, let, partly let or under maintenance
                         follows from the tenancies
     Tenants             each tenancy: the tenant (address, identity document, emergency contact, employer), what is
                         let, from when, the rent, the deposit agreed and received, the day rent falls due, the notice
                         period; give notice, end the tenancy (move-out date, deposit refunded or set against the dues),
                         the tenant's statement
     Rent & Collections  month by month: "Generate rent for the month" raises the rent of every tenancy (by the day for
                         a month the tenancy begins or ends in), other charges are added (electricity by the meter,
                         water, maintenance, food ...), a collection is set against the oldest dues first and what is
                         over stays on account; a rent receipt, a late fee, and the rent invoice of a month in Sales
     Furniture & Assets  the register: item, category, quantity, value, condition, and where it is: the store, a room,
                         a bed, or with a tenant
     Reports             rent roll, occupancy and vacancy, outstanding with its ageing, collections, deposits, the
                         tenants register (what a police verification asks for), move-ins and move-outs, assets by place
     Settings            everything is the business's own: what a building, a room, a bed, a tenant and an asset are
                         called, the kinds of room, the asset categories, the charges billed besides rent, the identity
                         documents, the payment modes, fields of its own on each of the five, whether rooms, beds or
                         both are let, the due day, pro-rata, the late fee, the deposit, the notice, the tax on rent

   GST on rent (India): renting a residential dwelling for use as a residence is exempt (nil rate, SAC 997211,
   Notification 12/2017-Central Tax (Rate) entry 12); renting commercial or other non-residential property is 18%
   (SAC 997212). Each kind of room says which of the two it is, both rates and codes are in the settings, and a tenancy
   can carry a rate of its own (a dwelling let to a registered business, say). A landlord with no GSTIN in the Company
   Profile is not registered and adds no GST. Outside India rent carries the country's one rate (kept in the settings),
   with no SAC. The place of supply of immovable property is where the property is (IGST Act s.12(3)). "Make invoice"
   opens the month in Sales (invoice.js, the fromRent route): the rent and each charge a line, the tenant the buyer,
   the tenancy number the reference; saved there it reaches the books, the reports and the GST returns.

   Kept in the books: 'rental' (the settings and the masters: buildings, units, beds, assets; the owner, an admin, an
   accountant) and the collection 'tenancies' (tnc:<id>): the tenant, what is let, months['YYYY-MM'] (the rent, the
   charges, the late fee, the invoice number of each month) and payments. A field of the business's own is kept on its
   record under custom[<field id>]; a field taken off the settings keeps its data there. Portal only. */
(function (global) {
  'use strict';
  const { esc, num, money } = U;
  const DAY = 86400000;
  const TABS = [['overview', 'Overview'], ['units', 'Buildings & Rooms'], ['tenants', 'Tenants'], ['rent', 'Rent & Collections'], ['assets', 'Furniture & Assets'], ['reports', 'Reports'], ['settings', 'Settings']];
  const KINDS = ['building', 'unit', 'bed', 'tenant', 'asset'];
  const LABELS = { building: ['Building', 'Buildings'], unit: ['Room', 'Rooms'], bed: ['Bed', 'Beds'], tenant: ['Tenant', 'Tenants'], asset: ['Asset', 'Assets'] };
  const WHAT = { building: 'A building', unit: 'A room, flat or shop', bed: 'A bed', tenant: 'A tenant', asset: 'A piece of furniture or other asset' };
  const UNIT_KINDS = [{ name: 'Room', use: 'res' }, { name: 'Flat', use: 'res' }, { name: 'Dormitory', use: 'res' }, { name: 'House', use: 'res' }, { name: 'Shop', use: 'com' }, { name: 'Office', use: 'com' }, { name: 'Godown', use: 'com' }];
  const ASSET_CATS = ['Bed & mattress', 'Furniture', 'Appliance', 'Electrical', 'Kitchen', 'Linen', 'Other'];
  // A charge billed besides rent: its own rate, or none given = the rate of the rent it goes with
  const HEADS = [{ name: 'Electricity', gst: '0', sac: '' }, { name: 'Water', gst: '0', sac: '' }, { name: 'Maintenance', gst: '', sac: '' }, { name: 'Food', gst: '', sac: '' }, { name: 'Internet', gst: '', sac: '' }, { name: 'Parking', gst: '', sac: '' }, { name: 'Damages', gst: '0', sac: '' }];
  const IDS = ['Aadhaar', 'PAN', 'Passport', 'Driving Licence', 'Voter ID', 'Company ID', 'Other'];
  const MODES = ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card'];
  const TSTATUS = [['active', 'Active', 'ok'], ['notice', 'On notice', 'warn'], ['ended', 'Ended', '']];
  const USTATUS = [['vacant', 'Vacant', 'warn'], ['let', 'Let', 'ok'], ['part', 'Partly let', ''], ['maint', 'Under maintenance', 'bad']];
  const COND = [['good', 'Good', 'ok'], ['repair', 'Needs repair', 'warn'], ['damaged', 'Damaged', 'bad'], ['disposed', 'Disposed', '']];
  const FTYPES = [['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['choice', 'A list to choose from']];
  const LETBY = [['both', 'Whole rooms and beds'], ['unit', 'Whole rooms, flats or shops only'], ['bed', 'Beds only (a PG, a hostel)']];
  const REPS = [['roll', 'Rent roll'], ['occupancy', 'Occupancy & vacancy'], ['due', 'Outstanding & ageing'], ['collections', 'Collections'], ['deposits', 'Deposits'], ['register', 'Tenants register'], ['moves', 'Move-ins & move-outs'], ['assets', 'Asset register']];
  const PERIODIC = ['collections', 'deposits', 'moves'];
  const DEF = { letBy: 'both', dueDay: 5, proRata: true, late: { kind: 'none', amount: 0, pct: 0, grace: 5 }, depositMonths: 2, noticeDays: 30, tax: { resRate: '0', resSac: '997211', comRate: '18', comSac: '997212' }, prefix: 'RNT' };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const ms = (d) => U.dateMs(d);
  const plus = (d, n) => { const x = new Date(ms(d) || Date.now()); x.setDate(x.getDate() + n); return U.dmy(x); };
  const pick = (list, k) => list.find(x => x[0] === k) || list[0];
  const pill = (list, k) => { const s = pick(list, k); return '<span class="pill ' + s[2] + '">' + esc(s[1]) + '</span>'; };
  const sum = (a, f) => a.reduce((t, x) => t + num(f(x)), 0);
  const r2 = (v) => U.round2(v);
  const pct = (v) => (Math.round(v * 10) / 10).toFixed(1) + '%';
  const byNo = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const linesOf = (v) => String(v || '').replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean);
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const DSM = ' style="width:auto;min-height:34px"';
  const LIVE = (t) => t.status !== 'ended';
  // A month is 'YYYY-MM'
  const isYm = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));
  const ymOf = (d) => { const x = typeof d === 'number' ? new Date(d) : new Date(ms(d) || Date.now()); return x.getFullYear() + '-' + U.pad(x.getMonth() + 1); };
  const ymSpan = (ym) => { const [y, m] = ym.split('-').map(Number); return { y, m, a: new Date(y, m - 1, 1).getTime(), b: new Date(y, m, 1).getTime(), of: new Date(y, m, 0).getDate() }; };
  const ymName = (ym) => { const s = ymSpan(ym); return MON[s.m - 1] + ' ' + s.y; };
  const ymPlus = (ym, n) => { const s = ymSpan(ym); return ymOf(new Date(s.y, s.m - 1 + n, 1).getTime()); };
  // The day after the last day a tenancy holds what it has: the move-out, or the day a tenant on notice leaves; open otherwise
  const endMs = (t) => ms(t.movedOut) ? ms(t.movedOut) + DAY : t.status === 'notice' && ms(t.vacateOn) ? ms(t.vacateOn) + DAY : Infinity;
  const period = (p, back) => { const d = new Date(), from = ms(p.from) ? p.from : U.dmy(new Date(d.getFullYear(), d.getMonth() - (back || 0), 1)), to = ms(p.to) && ms(p.to) >= ms(from) ? p.to : (ms(U.today()) >= ms(from) ? U.today() : from); return { from, to, a: ms(from), b: ms(to) + DAY }; };
  const within = (d, P) => { const t = ms(d); return !!t && t >= P.a && t < P.b; };
  const L = (k, pl) => Rental.label(k, pl);
  const low = (k, pl) => L(k, pl).toLowerCase();
  let shown = [];   // the tables of the report on the screen, for their Print and Excel buttons
  /* The 'rental' record as it is kept. A screen asks for it many times while it is drawn (every label is in the
     business's own words), so it is read once for the work in hand: forgotten when that work is done, and when it is saved. */
  let memo = null;
  const kept = () => { if (!memo || memo.uid !== Store.uid) { memo = { uid: Store.uid, d: Store.get('rental', null) }; Promise.resolve().then(() => { memo = null; }); } return memo.d; };

  const Rental = {
    TABS, TSTATUS, USTATUS, COND, REPS,
    // ------------------------------------------------------------ the records
    settings() {
      const d = kept(), s = d && typeof d === 'object' ? d : {}, o = Object.assign({}, DEF, s);
      o.labels = {}; KINDS.forEach(k => { const v = (s.labels && s.labels[k]) || [], one = String(v[0] || '').trim(), many = String(v[1] || '').trim(); o.labels[k] = [one || LABELS[k][0], many || (one ? one + 's' : LABELS[k][1])]; });
      o.late = Object.assign({}, DEF.late, s.late); o.tax = Object.assign({}, DEF.tax, s.tax);
      o.fields = {}; KINDS.forEach(k => { o.fields[k] = s.fields && Array.isArray(s.fields[k]) ? s.fields[k] : []; });
      ['buildings', 'units', 'beds', 'assets'].forEach(k => { o[k] = Array.isArray(s[k]) ? s[k] : []; });
      o.kinds = Array.isArray(s.kinds) && s.kinds.length ? s.kinds : UNIT_KINDS; o.assetCats = Array.isArray(s.assetCats) && s.assetCats.length ? s.assetCats : ASSET_CATS;
      o.heads = Array.isArray(s.heads) && s.heads.length ? s.heads : HEADS; o.ids = Array.isArray(s.ids) && s.ids.length ? s.ids : IDS; o.modes = Array.isArray(s.modes) && s.modes.length ? s.modes : MODES;
      if (!LETBY.some(x => x[0] === o.letBy)) o.letBy = 'both';
      return o;
    },
    saveSettings(o) { memo = null; return Store.set('rental', o); },
    mayMasters() { return Companies.mayWrite('rental'); },
    mayTen() { return Companies.mayWrite('tenancies'); },
    // The business's own word for a building, a unit (room, flat, shop), a bed, a tenant, an asset
    label(kind, plural) { const l = this.settings().labels[kind] || LABELS[kind] || [kind, kind + 's']; return l[plural ? 1 : 0]; },
    tabName(id) { return id === 'units' ? L('building', 1) + ' & ' + L('unit', 1) : id === 'tenants' ? L('tenant', 1) : id === 'assets' ? 'Furniture & ' + L('asset', 1) : pick(TABS, id)[1]; },
    building(id, st) { return (st || this.settings()).buildings.find(b => b.id === id) || null; },
    unit(id, st) { return (st || this.settings()).units.find(u => u.id === id) || null; },
    bed(id, st) { return (st || this.settings()).beds.find(b => b.id === id) || null; },
    unitsSorted(st) { st = st || this.settings(); const bn = (u) => (this.building(u.buildingId, st) || {}).name || ''; return st.units.slice().sort((a, b) => byNo(bn(a), bn(b)) || byNo(a.no, b.no)); },
    bedsOf(unitId, st) { return (st || this.settings()).beds.filter(b => b.unitId === unitId).sort((a, b) => byNo(a.label, b.label)); },
    unitName(u, st) { if (!u) return '-'; const b = this.building(u.buildingId, st); return (b ? b.name + ' · ' : '') + u.no; },
    spotName(unitId, bedId, st) { st = st || this.settings(); const u = this.unit(unitId, st), b = bedId ? this.bed(bedId, st) : null; return u ? this.unitName(u, st) + (b ? ' · ' + st.labels.bed[0] + ' ' + b.label : '') : ''; },
    // What a tenancy has on rent, by the masters as they are now; the name kept on the tenancy when they are gone
    place(t, st) { return this.spotName(t.unitId, t.bedId, st) || t.letName || '-'; },
    tenancies() { return Store.list('tenancies').map(t => this.full(t)); },
    full(t) {
      return Object.assign({ no: '', status: 'active', unitId: '', bedId: '', letName: '', from: U.today(), to: '', rent: 0, deposit: 0, depositPaid: 0, depositDate: '', depositMode: '', dueDay: DEF.dueDay, noticeDays: DEF.noticeDays, gst: '', notes: '', noticeOn: '', vacateOn: '', movedOut: '', refund: null }, t,
        { tenant: Object.assign({ name: '', phone: '', email: '', address: '', state: '', gstin: '', idType: '', idNo: '', emergency: '', occupation: '' }, t && t.tenant), months: (t && t.months) || {}, payments: (t && t.payments) || [], custom: (t && t.custom) || {} });
    },
    find(id) { const t = Store.find('tenancies', id); return t ? this.full(t) : null; },
    nextNo() { const p = this.settings().prefix || 'RNT'; let max = 0; Store.list('tenancies').forEach(t => { const m = /(\d+)$/.exec(t.no || ''); if (m) max = Math.max(max, +m[1]); }); return p + '-' + String(max + 1).padStart(4, '0'); },
    nextReceipt() { const p = this.settings().prefix || 'RNT'; let max = 0; Store.list('tenancies').forEach(t => (t.payments || []).forEach(x => { const m = /(\d+)$/.exec(x.receiptNo || ''); if (m) max = Math.max(max, +m[1]); })); return p + '-R' + String(max + 1).padStart(4, '0'); },
    /* What can be let: a room let whole is one, a room let by the bed is each of its beds. A tenancy holds what it has
       from its first day until it ends (the move-out, or the day a tenant on notice leaves). A whole room clashes with
       any tenancy in it, a bed with a tenancy on that bed or on the whole room. */
    spots(st) {
      st = st || this.settings(); const out = [];
      this.unitsSorted(st).forEach(u => {
        if (u.letBy === 'bed') this.bedsOf(u.id, st).forEach(b => out.push({ unitId: u.id, bedId: b.id, key: u.id + '|' + b.id, name: this.spotName(u.id, b.id, st), rent: num(b.rent) || num(u.rent), deposit: num(u.deposit), maint: !!(u.maintenance || b.maintenance), u, b }));
        else out.push({ unitId: u.id, bedId: '', key: u.id + '|', name: this.unitName(u, st), rent: num(u.rent), deposit: num(u.deposit), maint: !!u.maintenance, u });
      });
      return out;
    },
    clash(unitId, bedId, from, exceptId, all) { const a = ms(from) || ms(U.today()); return (all || this.tenancies()).find(t => t.id !== exceptId && LIVE(t) && t.unitId === unitId && (!bedId || !t.bedId || t.bedId === bedId) && endMs(t) > a) || null; },
    freeSpots(from, exceptId, all, st) { all = all || this.tenancies(); return this.spots(st).filter(s => !s.maint && !this.clash(s.unitId, s.bedId, from, exceptId, all)); },
    // The tenancy on a room let whole, or on a bed
    holder(unitId, bedId, all) { return all.find(t => LIVE(t) && t.unitId === unitId && (t.bedId || '') === (bedId || '')) || null; },
    unitStatus(u, all, st) {
      if (u.maintenance) return 'maint';
      if (all.some(t => LIVE(t) && t.unitId === u.id && !t.bedId)) return 'let';
      if (u.letBy !== 'bed') return 'vacant';
      const beds = this.bedsOf(u.id, st), k = beds.filter(b => this.holder(u.id, b.id, all)).length;
      return !k ? 'vacant' : k < beds.length ? 'part' : 'let';
    },
    // ------------------------------------------------------------ the tax on rent
    // Outside India (the country of the Company Profile) rent carries the country's tax at one rate, kept under the country's code
    intl() { const r = U.region(); if (r.code === 'IN') return null; const o = ((this.settings().intl || {})[r.code]) || {}; return { code: r.code, tax: r.tax || 'Tax', rate: o.rate == null || o.rate === '' ? num(r.defRate) : num(o.rate) }; },
    // In India a landlord with no GSTIN in the Company Profile is not registered: no GST on the rent or the charges
    taxed() { return !!this.intl() || !!String(Store.company().gstin || '').trim(); },
    useOf(t, st) { st = st || this.settings(); const u = this.unit(t.unitId, st), k = u ? st.kinds.find(x => x.name === u.kind) : null; return k && k.use === 'com' ? 'com' : 'res'; },
    rateFor(t, st) { if (t.gst != null && String(t.gst) !== '') return num(t.gst); const io = this.intl(); if (io) return io.rate; if (!this.taxed()) return 0; st = st || this.settings(); return num(this.useOf(t, st) === 'com' ? st.tax.comRate : st.tax.resRate); },
    sacFor(t, st) { if (this.intl()) return ''; st = st || this.settings(); return String(this.useOf(t, st) === 'com' ? st.tax.comSac : st.tax.resSac); },
    // The rate of a charge head: its own, or the rate of the rent it is billed with
    headRate(name, t, st) { st = st || this.settings(); const h = st.heads.find(x => x.name === name); if (!this.taxed()) return 0; return h && h.gst !== '' && h.gst != null ? num(h.gst) : this.rateFor(t, st); },
    // ------------------------------------------------------------ the rent of a month
    /* The days of a month a tenancy runs, and its rent for them: the whole rent for a whole month, by the day (to the
       rupee) for a month it begins or ends in when the settings say pro-rata, nothing for a month it does not touch */
    rentFor(t, ym, st) {
      st = st || this.settings(); const s = ymSpan(ym), days = Math.max(0, Math.round((Math.min(s.b, endMs(t)) - Math.max(s.a, ms(t.from))) / DAY));
      return { days, of: s.of, rent: !days ? 0 : days >= s.of || st.proRata === false ? r2(t.rent) : Math.round(num(t.rent) * days / s.of) };
    },
    newMonth(t, ym, st) { const r = this.rentFor(t, ym, st); return { rent: r.rent, days: r.days, of: r.of, gst: String(this.rateFor(t, st)), sac: this.sacFor(t, st), charges: [], lateFee: 0, invoiceNo: '' }; },
    // Rent falls due on the tenancy's day of the month; in the month a tenancy begins, not before it begins
    dueDate(t, ym) { const s = ymSpan(ym), d = new Date(s.y, s.m - 1, Math.min(Math.max(1, Math.round(num(t.dueDay)) || DEF.dueDay), s.of)).getTime(); return U.dmy(new Date(Math.max(d, ms(t.from) || d))); },
    // The lines of a month: the rent, each other charge, the late fee, each with its tax
    lines(t, ym, st) {
      const m = t.months[ym]; if (!m) return null;
      const g = num(m.gst), where = this.place(t, st), ls = [];
      if (num(m.rent) || !(m.charges || []).length) ls.push({ kind: 'rent', desc: 'Rent - ' + ymName(ym), detail: where + (num(m.days) && num(m.days) < num(m.of) ? ', ' + m.days + ' of ' + m.of + ' days' : ''), amount: num(m.rent), gst: g, sac: m.sac || '' });
      (m.charges || []).forEach((c, i) => ls.push({ kind: 'charge', i, desc: c.head, date: c.date, detail: num(c.cur) || num(c.prev) ? 'Meter ' + num(c.prev) + ' to ' + num(c.cur) + ': ' + r2(num(c.cur) - num(c.prev)) + ' units at ' + num(c.rate) : c.note || '', amount: num(c.amount), gst: num(c.gst), sac: c.sac || '' }));
      if (num(m.lateFee)) ls.push({ kind: 'late', desc: 'Late fee - ' + ymName(ym), detail: '', amount: num(m.lateFee), gst: g, sac: m.sac || '' });
      ls.forEach(l => { l.tax = r2(l.amount * l.gst / 100); });
      const rent = r2(sum(ls.filter(l => l.kind === 'rent'), l => l.amount)), taxable = r2(sum(ls, l => l.amount)), tax = r2(sum(ls, l => l.tax));
      return { lines: ls, rent, other: r2(taxable - rent), taxable, tax, total: r2(taxable + tax) };
    },
    /* The account of a tenancy: its months oldest first, and everything collected set against them in that order;
       what is over is an advance on account. A month is paid, part paid, due, or overdue by so many days. */
    ledger(t, st) {
      const today = ms(U.today()), paid = r2(sum(t.payments, p => p.amount)); let left = paid;
      const rows = Object.keys(t.months).filter(isYm).sort().map(ym => {
        const d = this.lines(t, ym, st), got = r2(Math.min(left, d.total)); left = r2(left - got);
        const balance = r2(d.total - got), due = this.dueDate(t, ym), days = balance > 0.005 ? Math.max(0, Math.round((today - ms(due)) / DAY)) : 0;
        return Object.assign(d, { ym, paid: got, balance, due, days, status: balance <= 0.005 ? 'paid' : got > 0 ? 'part' : days > 0 ? 'overdue' : 'due' });
      });
      const billed = r2(sum(rows, r => r.total));
      return { rows, billed, paid, balance: r2(Math.max(0, billed - paid)), advance: r2(Math.max(0, paid - billed)) };
    },
    statusPill(r) { return r.status === 'paid' ? '<span class="pill ok">Paid</span>' : r.status === 'part' ? '<span class="pill warn">Part paid' + (r.days ? ' · ' + r.days + 'd overdue' : '') + '</span>' : r.status === 'overdue' ? '<span class="pill bad">Overdue ' + r.days + 'd</span>' : '<span class="pill">Due</span>'; },
    statusText(r) { return r.status === 'paid' ? 'Paid' : r.status === 'part' ? 'Part paid' + (r.days ? ', ' + r.days + ' days overdue' : '') : r.status === 'overdue' ? 'Overdue ' + r.days + ' days' : 'Due'; },
    // The late fee the settings ask for on a month's unpaid balance: a flat amount, or a % of it for each month (30 days) late, after the days of grace
    lateFor(row, st) { st = st || this.settings(); const k = st.late.kind, late = row.days - num(st.late.grace); if (k === 'none' || row.balance <= 0.005 || late <= 0) return 0; return k === 'flat' ? r2(st.late.amount) : r2(row.balance * num(st.late.pct) / 100 * Math.ceil(late / 30)); },
    // The rent of a month for every tenancy that runs in it and has none yet
    generate(ym) {
      const st = this.settings(), list = Store.list('tenancies'); let n = 0;
      list.forEach(raw => { const t = this.full(raw); if (t.months[ym] || this.rentFor(t, ym, st).days <= 0) return; raw.months = Object.assign({}, raw.months); raw.months[ym] = this.newMonth(t, ym, st); raw.updatedAt = Date.now(); n++; });
      if (n && Store.saveList('tenancies', list) === false) return -1;
      return n;
    },
    applyLate(ym) {
      const st = this.settings(), list = Store.list('tenancies'); let n = 0;
      list.forEach(raw => { const t = this.full(raw), m = t.months[ym]; if (!m || num(m.lateFee)) return; const row = this.ledger(t, st).rows.find(r => r.ym === ym), fee = row ? this.lateFor(row, st) : 0; if (fee <= 0) return; m.lateFee = fee; raw.months = t.months; raw.updatedAt = Date.now(); n++; });
      if (n && Store.saveList('tenancies', list) === false) return -1;
      return n;
    },
    depositHeld(t) { return LIVE(t) ? r2(t.depositPaid) : 0; },
    // The figures of the Overview
    stats(st, all) {
      st = st || this.settings(); all = all || this.tenancies();
      const today = U.today(), t0 = ms(today), cur = ymOf(today), sp = ymSpan(cur), live = all.filter(LIVE), spots = this.spots(st).filter(s => !s.maint), free = spots.filter(s => !this.clash(s.unitId, s.bedId, today, '', all));
      const us = st.units.map(u => this.unitStatus(u, all, st)), beds = spots.filter(s => s.bedId), bedsFree = free.filter(s => s.bedId), leds = all.map(t => this.ledger(t, st));
      const ending = live.filter(t => { const e = t.status === 'notice' && ms(t.vacateOn) ? ms(t.vacateOn) : ms(t.to); return e && e >= t0 && e <= t0 + 30 * DAY; });
      return { units: st.units.length, unitsLet: us.filter(x => x === 'let').length, unitsPart: us.filter(x => x === 'part').length, unitsVacant: us.filter(x => x === 'vacant').length, unitsMaint: us.filter(x => x === 'maint').length,
        beds: beds.length, bedsLet: beds.length - bedsFree.length, bedsVacant: bedsFree.length, spots: spots.length, spotsLet: spots.length - free.length, occupancy: spots.length ? (spots.length - free.length) / spots.length * 100 : 0, tenants: live.length,
        rentMonth: r2(sum(leds, l => sum(l.rows.filter(r => r.ym === cur), r => r.total))), collectedMonth: r2(sum(all, t => sum(t.payments.filter(p => !p.adj && ms(p.date) >= sp.a && ms(p.date) < sp.b), p => p.amount))),
        outstanding: r2(sum(leds, l => l.balance)), advance: r2(sum(leds, l => l.advance)), deposits: r2(sum(all, t => this.depositHeld(t))), ending: ending.length, notice: live.filter(t => t.status === 'notice').length, free };
    },

    // ------------------------------------------------------------ fields of the business's own (settings.fields[kind])
    cfFields(kind, st) { return (st || this.settings()).fields[kind] || []; },
    cfForm(kind, custom) {
      return this.cfFields(kind).map(f => { const v = (custom || {})[f.id], id = 'cf_' + f.id, opts = (f.options || []).concat(v && !(f.options || []).includes(v) ? [v] : []);
        return UI.field(f.label, f.type === 'choice' ? UI.select(id, opts, v == null ? '' : v, { blank: 'Select' }) : f.type === 'date' ? UI.dateInput(id, v || '') : UI.input(id, v, f.type === 'number' ? { type: 'number', attrs: ' step="any"' } : {}), { req: !!f.req }); }).join('');
    },
    // The values typed, over the ones kept (a field taken off the settings keeps its data); null when a required one is empty
    cfRead(kind, bg, custom) {
      const out = Object.assign({}, custom); let ok = true;
      this.cfFields(kind).forEach(f => { const id = 'cf_' + f.id; let v = f.type === 'date' ? UI.dateVal(id, bg) : String(UI.val(id, bg)).trim(); if (f.type === 'number' && v !== '') v = num(v);
        if (f.req && v === '' && ok) { ok = false; UI.mark(id, true, bg); UI.toast('Enter ' + f.label); } out[f.id] = v; });
      return ok ? out : null;
    },
    cfHead(kind, st) { return this.cfFields(kind, st).map(f => f.label); },
    cfVals(kind, rec, st) { return this.cfFields(kind, st).map(f => { const v = ((rec && rec.custom) || {})[f.id]; return v == null ? '' : v; }); },
    cfText(kind, rec, st) { return this.cfFields(kind, st).map(f => { const v = ((rec && rec.custom) || {})[f.id]; return v == null || v === '' ? '' : f.label + ': ' + v; }).filter(Boolean).join(' · '); },

    // ------------------------------------------------------------ the screen
    screen(p) {
      const tab = TABS.some(t => t[0] === p.tab) ? p.tab : 'overview', st = this.settings(), all = this.tenancies();
      const body = { overview: () => this.overviewTab(st, all), units: () => this.unitsTab(p, st, all), tenants: () => this.tenantsTab(p, st, all), rent: () => this.rentTab(p, st, all), assets: () => this.assetsTab(p, st, all), reports: () => this.reportsTab(p, st, all), settings: () => this.settingsPanel() }[tab]();
      const root = App.view(App.header('Rentals', '<div class="btnrow" style="margin:0">' + (this.mayTen() && st.units.length ? '<button class="btn sm green" id="rnNew">+ New ' + esc(L('tenant')) + '</button>' : '') + '</div>') +
        (st.buildings.length ? '' : '<div class="card white"><div class="bd"><div class="hint" style="margin:0">Start with what is let: add the ' + esc(low('building', 1)) + ' and the ' + esc(low('unit', 1)) + ' in them under <a href="#" data-go-tab="units">' + esc(this.tabName('units')) + '</a>' + (this.mayMasters() ? '' : ' (the owner, an admin or an accountant does this)') + ', then the ' + esc(low('tenant', 1)) + '. What each thing is called, the kinds of ' + esc(low('unit')) + ', the charges besides rent and fields of your own are under <a href="#" data-go-tab="settings">Settings</a>.</div></div></div>') +
        '<div class="btnrow" style="margin-bottom:12px">' + TABS.map(t => '<button class="btn sm ' + (t[0] === tab ? 'blue' : 'outline') + '" data-tab="' + t[0] + '">' + esc(this.tabName(t[0])) + '</button>').join('') + '</div>' + body.html);
      App.wireBack(root);
      const again = () => App.go('rental', Object.assign({}, p, { tab }));
      const on = (attr, fn) => $$('[data-' + attr + ']', root).forEach(b => { b.onclick = (e) => { e.preventDefault(); fn(b.dataset[attr], b); }; });
      const ten = (fn) => (id) => { const t = this.find(id); if (t) fn(t); };
      on('tab', (v) => App.go('rental', { tab: v })); on('go-tab', (v, b) => App.go('rental', { tab: b.dataset.goTab }));
      if ($('#rnNew')) $('#rnNew').onclick = () => this.editTenancy(null, again);
      on('ten', (id) => this.open(id, again)); on('tedit', ten(t => this.editTenancy(t, again))); on('tcollect', ten(t => this.collect(t, again))); on('tstmt', ten(t => this.printStatement(t)));
      on('tnotice', ten(t => this.notice(t, again))); on('tend', ten(t => this.end(t, again))); on('tdel', ten(t => this.removeTenancy(t, again))); on('tgive', ten(t => this.give(t, again)));
      on('let', (key) => { const k = key.split('|'); this.editTenancy({ unitId: k[0], bedId: k[1] || '' }, again); });
      if (body.wire) body.wire(root, again);
    },

    overviewTab(st, all) {
      const s = this.stats(st, all), today = U.today(), t0 = ms(today), w = this.mayTen();
      const stat = (k, v, cls, go) => '<div class="istat ' + (cls || '') + '"' + (go ? ' data-go-tab="' + go + '" style="cursor:pointer"' : '') + '><div class="v">' + v + '</div><div class="k">' + esc(k) + '</div></div>';
      const stats = '<div class="istats">' + stat(L('unit', 1), s.units, '', 'units') + stat('Let', s.unitsLet + (s.unitsPart ? ' + ' + s.unitsPart + ' part' : ''), 'ok', 'units') + stat('Vacant', s.unitsVacant, s.unitsVacant ? 'warn' : '', 'units') +
        (s.beds ? stat(L('bed', 1) + ' let', s.bedsLet + ' / ' + s.beds, 'ok', 'units') + stat(L('bed', 1) + ' vacant', s.bedsVacant, s.bedsVacant ? 'warn' : '', 'units') : '') + stat('Occupancy', s.spots ? pct(s.occupancy) : '-', '', 'reports') + stat(L('tenant', 1), s.tenants, '', 'tenants') + '</div>' +
        '<div class="istats">' + stat('Rent of ' + ymName(ymOf(today)), money(s.rentMonth), '', 'rent') + stat('Collected this month', money(s.collectedMonth), 'ok', 'rent') + stat('Outstanding', money(s.outstanding), s.outstanding > 0 ? 'bad' : '', 'rent') + stat('Deposits held', money(s.deposits), '', 'reports') +
        stat('Ending in 30 days', s.ending, s.ending ? 'warn' : '', 'tenants') + stat('On notice', s.notice, s.notice ? 'warn' : '', 'tenants') + '</div>';
      // Who owes rent now: the oldest unpaid month says since when
      const owing = all.map(t => ({ t, l: this.ledger(t, st) })).filter(x => x.l.balance > 0.005).map(x => Object.assign(x, { first: x.l.rows.find(r => r.balance > 0.005) })).sort((a, b) => b.first.days - a.first.days || b.l.balance - a.l.balance);
      const dueHtml = '<div class="section-title">Rent due now (' + owing.length + ')</div>' + (owing.length ? '<div class="tablewrap"><table class="list cards" id="rnDue"><thead><tr><th>No</th><th>' + esc(L('tenant')) + '</th><th>Let</th><th>Since</th><th>Due on</th><th>Status</th><th class="num">Balance</th><th></th></tr></thead><tbody>' +
        owing.map(x => '<tr><td data-l="No"><a href="#" data-ten="' + esc(x.t.id) + '">' + esc(x.t.no) + '</a></td><td data-l="' + esc(L('tenant')) + '"><b>' + esc(x.t.tenant.name) + '</b><div class="small muted">' + esc(x.t.tenant.phone) + '</div></td><td data-l="Let">' + esc(this.place(x.t, st)) + '</td><td data-l="Since">' + esc(ymName(x.first.ym)) + '</td><td data-l="Due on">' + esc(x.first.due) + '</td><td data-l="Status">' + this.statusPill(x.first) + '</td><td class="num" data-l="Balance"><b>' + money(x.l.balance) + '</b></td><td class="actions" data-l="">' + (w ? '<button class="btn sm green" data-tcollect="' + esc(x.t.id) + '">Collect</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<div class="empty">' + (all.length ? 'Nobody owes rent. The rent of a month is raised under Rent &amp; Collections.' : 'No ' + esc(low('tenant')) + ' yet.') + '</div>');
      // Moving in (a tenancy that begins from today on) and out (on notice, or the agreed date within 30 days or gone by)
      const moves = all.filter(LIVE).map(t => { const out = t.status === 'notice' && ms(t.vacateOn) ? t.vacateOn : t.to; return ms(t.from) >= t0 ? { t, what: 'Moves in', cls: 'ok', date: t.from } : ms(out) && ms(out) <= t0 + 30 * DAY ? { t, what: t.status === 'notice' ? 'Moves out' : ms(out) < t0 ? 'Agreement over' : 'Agreement ends', cls: 'warn', date: out } : null; }).filter(Boolean).sort((a, b) => ms(a.date) - ms(b.date));
      const moveHtml = '<div class="section-title">Moving in and out (' + moves.length + ')</div>' + (moves.length ? '<div class="tablewrap"><table class="list cards"><thead><tr><th>Date</th><th></th><th>' + esc(L('tenant')) + '</th><th>Let</th><th class="num">Rent</th><th></th></tr></thead><tbody>' +
        moves.map(x => '<tr><td data-l="Date">' + esc(x.date) + '</td><td data-l=""><span class="pill ' + x.cls + '">' + x.what + '</span></td><td data-l="' + esc(L('tenant')) + '"><a href="#" data-ten="' + esc(x.t.id) + '">' + esc(x.t.tenant.name || x.t.no) + '</a><div class="small muted">' + esc(x.t.tenant.phone) + '</div></td><td data-l="Let">' + esc(this.place(x.t, st)) + '</td><td class="num" data-l="Rent">' + money(x.t.rent) + '</td><td class="actions" data-l="">' + (w && x.what !== 'Moves in' ? UI.ibtn('key', 'End the tenancy', 'data-tend="' + esc(x.t.id) + '"') : '') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty">Nobody moves in or out in the next 30 days.</div>');
      const vacHtml = '<div class="section-title">Vacant (' + s.free.length + ')</div>' + (s.free.length ? '<div class="tablewrap"><table class="list cards" id="rnVacant"><thead><tr><th>Vacant</th><th>Kind</th><th>Floor</th><th class="num">Rent asked</th><th></th></tr></thead><tbody>' +
        s.free.map(f => '<tr><td data-l="Vacant"><b>' + esc(f.name) + '</b></td><td data-l="Kind">' + esc(f.u.kind || '-') + '</td><td data-l="Floor">' + esc(f.u.floor || '-') + '</td><td class="num" data-l="Rent asked">' + money(f.rent) + '</td><td class="actions" data-l="">' + (w ? '<button class="btn sm outline" data-let="' + esc(f.key) + '">Let it</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<div class="empty">' + (st.units.length ? 'Nothing stands vacant.' : 'No ' + esc(low('unit')) + ' yet: add them under ' + esc(this.tabName('units')) + '.') + '</div>');
      return { html: stats + dueHtml + moveHtml + vacHtml };
    },

    // ------------------------------------------------------------ buildings, the rooms in them, the beds of a room
    unitsTab(p, st, all) {
      const w = this.mayMasters(), bsel = this.building(p.b, st) ? p.b : '', units = this.unitsSorted(st).filter(u => !bsel || u.buildingId === bsel), useBeds = st.letBy !== 'unit' || st.beds.length > 0;
      const count = (b, s) => st.units.filter(u => u.buildingId === b.id && (!s || this.unitStatus(u, all, st) === s)).length;
      const small = (txt) => txt ? '<div class="small muted">' + esc(txt) + '</div>' : '';
      const bedLine = (u, b) => { const t = this.holder(u.id, b.id, all); return '<div style="margin:2px 0">' + (w ? '<a href="#" data-bed="' + esc(b.id) + '" title="' + esc(this.cfText('bed', b, st) || 'Edit') + '">' + esc(st.labels.bed[0] + ' ' + b.label) + '</a>' : esc(st.labels.bed[0] + ' ' + b.label)) + ' <span class="small muted">' + money(num(b.rent) || num(u.rent)) + '</span> ' +
        (b.maintenance ? '<span class="pill bad">Maintenance</span>' : t ? '<a href="#" data-ten="' + esc(t.id) + '">' + esc(t.tenant.name || t.no) + '</a>' : '<span class="pill warn">Vacant</span>') + '</div>'; };
      const now = (u) => { const t = this.holder(u.id, '', all); if (t) return '<a href="#" data-ten="' + esc(t.id) + '">' + esc(t.tenant.name || t.no) + '</a><div class="small muted">since ' + esc(t.from) + '</div>'; if (u.letBy !== 'bed') return '<span class="muted">-</span>'; const beds = this.bedsOf(u.id, st); return beds.length ? beds.map(b => bedLine(u, b)).join('') : '<span class="small muted">No ' + esc(low('bed')) + ' yet</span>'; };
      const html = '<div class="section-title">' + esc(L('building', 1)) + ' (' + st.buildings.length + ')' + (w ? '<span class="tilehint"><button class="btn sm green" id="rnAddB">+ ' + esc(L('building')) + '</button></span>' : '') + '</div>' +
        (st.buildings.length ? '<div class="tablewrap"><table class="list cards" id="rnBuildings"><thead><tr><th>' + esc(L('building')) + '</th><th>Address</th><th class="num">Floors</th><th class="num">' + esc(L('unit', 1)) + '</th><th class="num">Let</th><th class="num">Vacant</th><th></th></tr></thead><tbody>' +
          st.buildings.slice().sort((a, b) => byNo(a.name, b.name)).map(b => '<tr><td data-l="' + esc(L('building')) + '"><b>' + esc(b.name) + '</b>' + small(this.cfText('building', b, st)) + small(b.notes) + '</td><td data-l="Address">' + esc(b.address || '-') + '</td><td class="num" data-l="Floors">' + esc(b.floors || '-') + '</td><td class="num" data-l="' + esc(L('unit', 1)) + '">' + count(b) + '</td><td class="num" data-l="Let">' + (count(b, 'let') + count(b, 'part')) + '</td><td class="num" data-l="Vacant">' + count(b, 'vacant') + '</td><td class="actions" data-l="">' +
            (w ? UI.ibtn('plus', 'Add ' + low('unit', 1) + ' here', 'data-uadd="' + esc(b.id) + '"') + UI.ibtn('edit', 'Edit ' + low('building'), 'data-bedit="' + esc(b.id) + '"') + UI.ibtn('trash', 'Delete ' + low('building'), 'data-bdel="' + esc(b.id) + '"', 'danger') : '') + '</td></tr>').join('') + '</tbody></table></div>'
          : '<div class="empty">No ' + esc(low('building')) + ' yet' + (w ? ': add the first with + ' + esc(L('building')) + ', then the ' + esc(low('unit', 1)) + ' in it.' : '.') + '</div>') +
        '<div class="section-title">' + esc(L('unit', 1)) + ' (' + units.length + ')' + (w && st.buildings.length ? '<span class="tilehint"><button class="btn sm green" id="rnAddU">+ ' + esc(L('unit', 1)) + '</button></span>' : '') + '</div>' +
        '<div class="btnrow" style="align-items:center">' + UI.select('rnBld', st.buildings.map(b => [b.id, b.name]), bsel, { blank: 'All ' + low('building', 1), attrs: DSM }) + '<input id="rnFind" placeholder="Search number, kind, ' + esc(low('tenant')) + '" style="flex:1;min-width:200px;min-height:34px"><button class="btn sm outline" id="rnXls">Export</button></div>' +
        (units.length ? '<div class="tablewrap"><table class="list cards" id="rnUnits"><thead><tr><th>' + esc(L('unit')) + '</th><th>' + esc(L('building')) + '</th><th>Floor</th><th>Let</th><th class="num">Rent</th><th class="num">Deposit</th><th class="num">Capacity</th><th>Status</th><th>' + (useBeds ? esc(L('bed', 1)) + ' / ' : '') + esc(L('tenant')) + '</th><th></th></tr></thead><tbody>' +
          units.map(u => { const us = this.unitStatus(u, all, st), who = all.filter(t => LIVE(t) && t.unitId === u.id).map(t => t.tenant.name).join(' ');
            return '<tr data-f="' + esc([u.no, u.kind, u.floor, (this.building(u.buildingId, st) || {}).name, who, pick(USTATUS, us)[1]].join(' ').toLowerCase()) + '"><td data-l="' + esc(L('unit')) + '"><b>' + esc(u.no) + '</b><div class="small muted">' + esc([u.kind, u.area].filter(Boolean).join(' · ')) + '</div>' + small(this.cfText('unit', u, st)) + '</td><td data-l="' + esc(L('building')) + '">' + esc((this.building(u.buildingId, st) || {}).name || '-') + '</td><td data-l="Floor">' + esc(u.floor || '-') + '</td><td data-l="Let">' + (u.letBy === 'bed' ? 'By the ' + esc(low('bed')) : 'Whole') + '</td><td class="num" data-l="Rent">' + money(u.rent) + (u.letBy === 'bed' ? '<div class="small muted">a ' + esc(low('bed')) + '</div>' : '') + '</td><td class="num" data-l="Deposit">' + money(u.deposit) + '</td><td class="num" data-l="Capacity">' + (num(u.capacity) || '-') + '</td><td data-l="Status">' + pill(USTATUS, us) + '</td><td data-l="' + esc(L('tenant')) + '">' + now(u) + '</td><td class="actions" data-l="">' +
              (w ? (u.letBy === 'bed' ? UI.ibtn('bed', 'Add ' + low('bed'), 'data-badd="' + esc(u.id) + '"') : '') + UI.ibtn('edit', 'Edit ' + low('unit'), 'data-uedit="' + esc(u.id) + '"') + UI.ibtn('trash', 'Delete ' + low('unit'), 'data-udel="' + esc(u.id) + '"', 'danger') : '') + '</td></tr>'; }).join('') + '</tbody></table></div>'
          : '<div class="empty">' + (st.buildings.length ? 'No ' + esc(low('unit')) + ' here yet.' : 'Add a ' + esc(low('building')) + ' first.') + '</div>');
      return { html, wire: (root, again) => {
        const on = (attr, fn) => $$('[data-' + attr + ']', root).forEach(b => { b.onclick = (e) => { e.preventDefault(); fn(b.dataset[attr]); }; });
        if ($('#rnAddB')) $('#rnAddB').onclick = () => this.editBuilding(null, again);
        if ($('#rnAddU')) $('#rnAddU').onclick = () => this.editUnit(null, again, bsel);
        on('uadd', (id) => this.editUnit(null, again, id)); on('bedit', (id) => this.editBuilding(this.building(id), again)); on('bdel', (id) => this.removeBuilding(id, again));
        on('uedit', (id) => this.editUnit(this.unit(id), again)); on('udel', (id) => this.removeUnit(id, again)); on('badd', (id) => this.editBed(null, this.unit(id), again)); on('bed', (id) => { const b = this.bed(id); if (b) this.editBed(b, this.unit(b.unitId), again); });
        $('#rnBld', root).onchange = () => App.go('rental', { tab: 'units', b: UI.val('rnBld') });
        const f = $('#rnFind', root), run = () => { const t = f.value.trim().toLowerCase(); $$('#rnUnits tbody tr', root).forEach(tr => { tr.style.display = !t || tr.dataset.f.includes(t) ? '' : 'none'; }); };
        f.addEventListener('input', run);
        $('#rnXls', root).onclick = () => UI.xls(L('unit', 1).replace(/[^A-Za-z0-9]+/g, '_'), [L('building'), L('unit'), 'Floor', 'Kind', 'Area', 'Let', L('bed'), 'Rent', 'Deposit', 'Capacity', 'Status', L('tenant'), 'Tenancy'].concat(this.cfHead('unit', st)),
          this.spots(st).filter(s => !bsel || s.u.buildingId === bsel).map(s => { const t = this.holder(s.unitId, s.bedId, all) || (s.bedId ? this.holder(s.unitId, '', all) : null); return [(this.building(s.u.buildingId, st) || {}).name || '', s.u.no, s.u.floor || '', s.u.kind || '', s.u.area || '', s.bedId ? 'By the bed' : 'Whole', s.b ? s.b.label : '', s.rent, s.deposit, num(s.u.capacity) || '', s.maint ? 'Under maintenance' : t ? 'Let' : 'Vacant', t ? t.tenant.name : '', t ? t.no : ''].concat(this.cfVals('unit', s.u, st)); }));
      } };
    },
    editBuilding(b, then) {
      const st = this.settings(), isNew = !b; b = Object.assign({ id: U.uid(), name: '', address: '', floors: '', notes: '', custom: {} }, b);
      return UI.modal({ title: isNew ? 'New ' + low('building') : L('building') + ' ' + b.name, body: '<div class="grid2">' + UI.field('Name', UI.input('bdName', b.name, { placeholder: 'Sunrise Residency' }), { req: true }) + UI.field('Floors', UI.input('bdFloors', b.floors, { type: 'number', attrs: ' min="0" step="1"' })) +
          UI.field('Address', UI.input('bdAddr', b.address), { span: true }) + UI.field('Notes', UI.input('bdNotes', b.notes, { placeholder: 'Caretaker, gate timings, meter number ...' }), { span: true }) + this.cfForm('building', b.custom) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const name = String(UI.val('bdName', bg)).trim(); if (!name) { UI.mark('bdName', true, bg); return false; }
          if (st.buildings.some(x => x.id !== b.id && String(x.name).toLowerCase() === name.toLowerCase())) { UI.toast('There is a ' + low('building') + ' of that name'); return false; }
          const custom = this.cfRead('building', bg, b.custom); if (!custom) return false;
          Object.assign(b, { name, floors: String(UI.val('bdFloors', bg)).trim(), address: String(UI.val('bdAddr', bg)).trim(), notes: String(UI.val('bdNotes', bg)).trim(), custom });
          st.buildings = isNew ? st.buildings.concat([b]) : st.buildings.map(x => x.id === b.id ? b : x);
          if (this.saveSettings(st) === false) return false; UI.toast(L('building') + ' saved', 2500, 'ok'); then();
        } }] });
    },
    removeBuilding(id, then) {
      const st = this.settings(), b = this.building(id, st), all = this.tenancies(); if (!b) return;
      const units = st.units.filter(u => u.buildingId === id), held = all.find(t => LIVE(t) && units.some(u => u.id === t.unitId));
      if (held) { UI.toast(b.name + ' has a ' + low('tenant') + ' in it (' + held.tenant.name + ', ' + held.no + '): end the tenancy first', 6000); return; }
      UI.confirm('Delete ' + b.name, units.length ? 'Its ' + units.length + ' ' + low('unit', units.length !== 1) + ' and their ' + low('bed', 1) + ' go with it; what is kept in them moves to the store. The tenancies that have ended stay in the records.' : 'The ' + low('building') + ' is removed.', () => {
        const gone = new Set(units.map(u => u.id)), beds = new Set(st.beds.filter(x => gone.has(x.unitId)).map(x => x.id));
        st.buildings = st.buildings.filter(x => x.id !== id); st.units = st.units.filter(u => !gone.has(u.id)); st.beds = st.beds.filter(x => !gone.has(x.unitId));
        st.assets = st.assets.map(a => { const k = String(a.at || '').split(':'); return (k[0] === 'unit' && gone.has(k[1])) || (k[0] === 'bed' && beds.has(k[1])) ? Object.assign({}, a, { at: 'store' }) : a; });
        if (this.saveSettings(st) === false) return; UI.toast(b.name + ' deleted'); then();
      }, 'Delete');
    },
    // A room, flat or shop. A new one takes several numbers at once: 101-110, or 101, 102, 205
    editUnit(u, then, buildingId) {
      const st = this.settings(), isNew = !u; if (!st.buildings.length) { UI.toast('Add a ' + low('building') + ' first', 4000); return null; }
      u = Object.assign({ id: U.uid(), buildingId: buildingId || st.buildings[0].id, no: '', floor: '', kind: st.kinds[0].name, area: '', letBy: st.letBy === 'bed' ? 'bed' : 'unit', rent: '', deposit: '', capacity: '', maintenance: false, custom: {} }, u);
      const lets = [['unit', 'Whole, to one ' + low('tenant')], ['bed', 'By the ' + low('bed')]].filter(x => st.letBy === 'both' || x[0] === st.letBy || x[0] === u.letBy), kinds = st.kinds.map(k => k.name).concat(u.kind && !st.kinds.some(k => k.name === u.kind) ? [u.kind] : []);
      const bg = UI.modal({ title: isNew ? 'New ' + low('unit') : L('unit') + ' ' + u.no, body: '<div class="grid2">' + UI.field(L('building'), UI.select('unB', st.buildings.map(b => [b.id, b.name]), u.buildingId)) + UI.field('Number or name', UI.input('unNo', u.no, { placeholder: isNew ? '101-110, 201, 202' : '101' }), { req: true, hint: isNew ? 'A range adds every number in it' : '' }) +
          UI.field('Floor', UI.input('unFloor', u.floor, { placeholder: '1' })) + UI.field('Kind', UI.select('unKind', kinds, u.kind), { hint: 'The kind says whether the rent is residential or commercial (Settings)' }) + UI.field('Area', UI.input('unArea', u.area, { placeholder: '450 sq ft' })) + UI.field('How it is let', UI.select('unLet', lets, u.letBy)) +
          '<div class="field"><label id="unRentL">Monthly rent</label>' + UI.input('unRent', u.rent, { type: 'number', attrs: ' min="0" step="any"' }) + '</div>' + UI.field('Deposit', UI.input('unDep', u.deposit, { type: 'number', attrs: ' min="0" step="any"' }), { hint: 'Left blank: ' + num(st.depositMonths) + ' month(s) of rent' }) +
          UI.field('Capacity (people)', UI.input('unCap', u.capacity, { type: 'number', attrs: ' min="0" step="1"' })) + (isNew ? '<div class="field" id="unBedsF"><label>' + esc(L('bed', 1)) + ' in each</label>' + UI.input('unBeds', '', { type: 'number', attrs: ' min="0" max="60" step="1"' }) + '<div class="hint">Named A, B, C ...; more are added later</div></div>' : '<div class="field"></div>') +
          this.cfForm('unit', u.custom) + '<div class="field span">' + UI.check('unMaint', 'Under maintenance: not offered to a ' + low('tenant'), !!u.maintenance) + '</div></div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const raw = String(UI.val('unNo', bg)).trim(), nos = []; if (!raw) { UI.mark('unNo', true, bg); return false; }
          if (isNew) raw.split(/\s*,\s*/).filter(Boolean).forEach(part => { const m = /^(\d+)\s*-\s*(\d+)$/.exec(part); if (m && +m[2] >= +m[1] && +m[2] - +m[1] < 500) { for (let n = +m[1]; n <= +m[2]; n++) nos.push(String(n)); } else nos.push(part); }); else nos.push(raw);
          const bId = UI.val('unB', bg), have = new Set(st.units.filter(x => x.buildingId === bId && x.id !== u.id).map(x => String(x.no).toLowerCase())), fresh = nos.filter((n, i) => !have.has(n.toLowerCase()) && nos.indexOf(n) === i);
          if (!fresh.length) { UI.mark('unNo', true, bg); UI.toast('There is a ' + low('unit') + ' ' + nos[0] + ' in this ' + low('building')); return false; }
          const letBy = UI.val('unLet', bg), all = this.tenancies();
          if (!isNew && letBy !== u.letBy && all.some(t => LIVE(t) && t.unitId === u.id)) { UI.toast('It is let now: how it is let changes once the tenancy has ended', 5000); return false; }
          const custom = this.cfRead('unit', bg, u.custom); if (!custom) return false;
          const rent = num(UI.val('unRent', bg)), depRaw = String(UI.val('unDep', bg)).trim(), vals = { buildingId: bId, floor: String(UI.val('unFloor', bg)).trim(), kind: UI.val('unKind', bg), area: String(UI.val('unArea', bg)).trim(), letBy, rent, deposit: depRaw === '' ? r2(rent * num(st.depositMonths)) : num(depRaw), capacity: num(UI.val('unCap', bg)), maintenance: !!UI.val('unMaint', bg), custom };
          if (isNew) { const nb = letBy === 'bed' ? Math.min(60, Math.max(0, Math.round(num(UI.val('unBeds', bg))))) : 0;
            fresh.forEach(no => { const x = Object.assign({}, vals, { id: U.uid(), no, custom: Object.assign({}, custom), capacity: vals.capacity || nb }); st.units = st.units.concat([x]); for (let i = 0; i < nb; i++) st.beds = st.beds.concat([{ id: U.uid(), unitId: x.id, label: i < 26 ? String.fromCharCode(65 + i) : String(i + 1), rent, maintenance: false, custom: {} }]); });
          } else st.units = st.units.map(x => x.id === u.id ? Object.assign({}, u, vals, { no: raw }) : x);
          if (this.saveSettings(st) === false) return false;
          UI.toast(isNew ? fresh.length + ' ' + low('unit', fresh.length !== 1) + ' added' + (nos.length > fresh.length ? '; ' + (nos.length - fresh.length) + ' already there' : '') : L('unit') + ' saved', 3000, 'ok'); then();
        } }] });
      const sync = () => { const bed = UI.val('unLet', bg) === 'bed'; $('#unRentL', bg).textContent = bed ? 'Monthly rent of a ' + low('bed') : 'Monthly rent'; if ($('#unBedsF', bg)) $('#unBedsF', bg).style.display = bed ? '' : 'none'; };
      $('#unLet', bg).onchange = sync; sync();
      return bg;
    },
    removeUnit(id, then) {
      const st = this.settings(), u = this.unit(id, st); if (!u) return;
      const held = this.tenancies().find(t => LIVE(t) && t.unitId === id);
      if (held) { UI.toast(L('unit') + ' ' + u.no + ' is let to ' + held.tenant.name + ' (' + held.no + '): end the tenancy first', 6000); return; }
      UI.confirm('Delete ' + low('unit') + ' ' + u.no, 'Its ' + low('bed', 1) + ' go with it and what is kept in it moves to the store. The tenancies that have ended stay in the records.', () => {
        const beds = new Set(st.beds.filter(x => x.unitId === id).map(x => x.id));
        st.units = st.units.filter(x => x.id !== id); st.beds = st.beds.filter(x => x.unitId !== id);
        st.assets = st.assets.map(a => a.at === 'unit:' + id || beds.has(String(a.at || '').replace(/^bed:/, '')) ? Object.assign({}, a, { at: 'store' }) : a);
        if (this.saveSettings(st) === false) return; UI.toast(L('unit') + ' ' + u.no + ' deleted'); then();
      }, 'Delete');
    },
    editBed(b, u, then) {
      const st = this.settings(), isNew = !b; if (!u) return null;
      const used = this.bedsOf(u.id, st).map(x => String(x.label).toUpperCase()); let next = 'A'; for (let i = 0; i < 60; i++) { next = i < 26 ? String.fromCharCode(65 + i) : String(i + 1); if (!used.includes(next)) break; }
      b = Object.assign({ id: U.uid(), unitId: u.id, label: next, rent: num(u.rent) || '', maintenance: false, custom: {} }, b);
      const taken = () => this.tenancies().find(t => LIVE(t) && t.bedId === b.id);
      return UI.modal({ title: (isNew ? 'New ' + low('bed') + ' in ' : L('bed') + ' ' + b.label + ' of ') + this.unitName(u, st), body: '<div class="grid2">' + UI.field('Label', UI.input('beLabel', b.label, { placeholder: 'A, lower, window ...' }), { req: true }) + UI.field('Monthly rent', UI.input('beRent', b.rent, { type: 'number', attrs: ' min="0" step="any"' })) + this.cfForm('bed', b.custom) +
          '<div class="field span">' + UI.check('beMaint', 'Under maintenance: not offered to a ' + low('tenant'), !!b.maintenance) + '</div></div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }].concat(isNew ? [] : [{ label: 'Delete', cls: 'red outline', onClick: () => { const t = taken(); if (t) { UI.toast(L('bed') + ' ' + b.label + ' is let to ' + t.tenant.name + ' (' + t.no + '): end the tenancy first', 6000); return false; }
          st.beds = st.beds.filter(x => x.id !== b.id); st.assets = st.assets.map(a => a.at === 'bed:' + b.id ? Object.assign({}, a, { at: 'unit:' + u.id }) : a); if (this.saveSettings(st) === false) return false; UI.toast(L('bed') + ' ' + b.label + ' deleted'); then(); } }]).concat([{ label: 'Save', cls: 'green', onClick: (bg) => {
          const label = String(UI.val('beLabel', bg)).trim(); if (!label) { UI.mark('beLabel', true, bg); return false; }
          if (st.beds.some(x => x.unitId === u.id && x.id !== b.id && String(x.label).toLowerCase() === label.toLowerCase())) { UI.toast('There is a ' + low('bed') + ' ' + label + ' in ' + u.no); return false; }
          const custom = this.cfRead('bed', bg, b.custom); if (!custom) return false;
          Object.assign(b, { label, rent: num(UI.val('beRent', bg)), maintenance: !!UI.val('beMaint', bg), custom });
          st.beds = isNew ? st.beds.concat([b]) : st.beds.map(x => x.id === b.id ? b : x);
          if (this.saveSettings(st) === false) return false; UI.toast(L('bed') + ' saved', 2500, 'ok'); then();
        } }]) });
    },

    // ------------------------------------------------------------ the tenancies
    tenantsTab(p, st, all) {
      const w = this.mayTen(), show = p.show || 'live', shows = [['live', 'Active & on notice'], ['notice', 'On notice'], ['ended', 'Ended'], ['all', 'All']];
      const list = all.filter(t => show === 'all' || (show === 'live' ? LIVE(t) : t.status === show)).sort((a, b) => byNo(b.no, a.no));
      const html = '<div class="btnrow" style="align-items:center">' + shows.map(s => '<button class="btn sm ' + (s[0] === show ? 'blue' : 'outline') + '" data-show="' + s[0] + '">' + s[1] + '</button>').join('') + '<input id="rnFind" placeholder="Search name, phone, number, ' + esc(low('unit')) + '" style="flex:1;min-width:200px;min-height:34px"><button class="btn sm outline" id="rnXls">Export</button></div>' +
        (list.length ? '<div class="tablewrap"><table class="list cards" id="rnTenants"><thead><tr><th>No</th><th>' + esc(L('tenant')) + '</th><th>Let</th><th>Since</th><th class="num">Rent</th><th class="num">Deposit</th><th class="num">Due</th><th>Status</th><th></th></tr></thead><tbody>' +
          list.map(t => { const l = this.ledger(t, st), got = t.payments.length > 0 || num(t.depositPaid) > 0;
            return '<tr data-f="' + esc([t.no, t.tenant.name, t.tenant.phone, t.tenant.occupation, this.place(t, st)].join(' ').toLowerCase()) + '"><td data-l="No"><a href="#" data-ten="' + esc(t.id) + '">' + esc(t.no) + '</a></td><td data-l="' + esc(L('tenant')) + '"><b>' + esc(t.tenant.name || '-') + '</b><div class="small muted">' + esc([t.tenant.phone, t.tenant.occupation].filter(Boolean).join(' · ')) + '</div></td><td data-l="Let">' + esc(this.place(t, st)) + '</td><td data-l="Since">' + esc(t.from) + (t.movedOut ? '<div class="small muted">to ' + esc(t.movedOut) + '</div>' : t.to ? '<div class="small muted">agreed to ' + esc(t.to) + '</div>' : '') + '</td><td class="num" data-l="Rent">' + money(t.rent) + '</td><td class="num" data-l="Deposit">' + money(t.depositPaid) + (num(t.deposit) > num(t.depositPaid) && LIVE(t) ? '<div class="small muted">of ' + money(t.deposit) + '</div>' : '') + '</td><td class="num" data-l="Due">' + (l.balance > 0 ? '<b>' + money(l.balance) + '</b>' : l.advance > 0 ? '<span class="small muted">advance ' + money(l.advance) + '</span>' : money(0)) + '</td><td data-l="Status">' + pill(TSTATUS, t.status) + (t.status === 'notice' && t.vacateOn ? '<div class="small muted">leaves ' + esc(t.vacateOn) + '</div>' : '') + '</td><td class="actions" data-l="">' +
              (w ? (LIVE(t) ? UI.ibtn('edit', 'Edit ' + low('tenant'), 'data-tedit="' + esc(t.id) + '"') : '') + (LIVE(t) || l.balance > 0 ? UI.ibtn('cash', 'Collect rent', 'data-tcollect="' + esc(t.id) + '"', 'primary') : '') : '') + UI.ibtn('printer', 'Print statement', 'data-tstmt="' + esc(t.id) + '"') +
              (w && LIVE(t) ? (this.mayMasters() ? UI.ibtn('box', 'Furniture given', 'data-tgive="' + esc(t.id) + '"') : '') + UI.ibtn('bell', t.status === 'notice' ? 'Notice given' : 'Give notice', 'data-tnotice="' + esc(t.id) + '"') + UI.ibtn('key', 'End the tenancy', 'data-tend="' + esc(t.id) + '"') : '') + (w && !got ? UI.ibtn('trash', 'Delete', 'data-tdel="' + esc(t.id) + '"', 'danger') : '') + '</td></tr>'; }).join('') + '</tbody></table></div>'
          : '<div class="empty">' + (all.length ? 'No ' + esc(low('tenant')) + ' here.' : st.units.length ? 'No ' + esc(low('tenant')) + ' yet: + New ' + esc(L('tenant')) + ' lets a vacant ' + esc(low('unit')) + (st.beds.length ? ' or ' + esc(low('bed')) : '') + '.' : 'Add the ' + esc(low('building', 1)) + ' and ' + esc(low('unit', 1)) + ' first, then the ' + esc(low('tenant', 1)) + '.') + '</div>');
      return { html, wire: (root) => {
        $$('[data-show]', root).forEach(b => { b.onclick = () => App.go('rental', { tab: 'tenants', show: b.dataset.show }); });
        const f = $('#rnFind', root), run = () => { const t = f.value.trim().toLowerCase(); $$('#rnTenants tbody tr', root).forEach(tr => { tr.style.display = !t || tr.dataset.f.includes(t) ? '' : 'none'; }); };
        f.addEventListener('input', run);
        $('#rnXls', root).onclick = () => UI.xls(L('tenant', 1).replace(/[^A-Za-z0-9]+/g, '_'), ['No', 'Name', 'Phone', 'Email', 'Permanent address', 'State', 'GSTIN', 'Identity document', 'Document number', 'Emergency contact', 'Occupation / employer', 'Let', 'From', 'Agreed to', 'Moved out', 'Rent', 'Deposit agreed', 'Deposit received', 'Due day', 'Notice days', 'Status', 'Billed', 'Collected', 'Outstanding', 'Notes'].concat(this.cfHead('tenant', st)),
          list.map(t => { const l = this.ledger(t, st), g = t.tenant; return [t.no, g.name, g.phone, g.email, g.address, U.stateName(g.state), g.gstin, g.idType, g.idNo, g.emergency, g.occupation, this.place(t, st), t.from, t.to, t.movedOut, num(t.rent), num(t.deposit), num(t.depositPaid), t.dueDay, t.noticeDays, pick(TSTATUS, t.status)[1], l.billed, l.paid, l.balance, t.notes].concat(this.cfVals('tenant', t, st)); }));
      } };
    },
    editTenancy(init, then) {
      const st = this.settings(), isNew = !(init && init.id), t = this.full(Object.assign({}, init)), g = t.tenant, all = this.tenancies(), cur = isNew ? '' : t.unitId + '|' + (t.bedId || '');
      if (!st.units.length) { UI.toast('Add the ' + low('building', 1) + ' and ' + low('unit', 1) + ' first (' + this.tabName('units') + ')', 5000); return null; }
      if (isNew) { t.no = ''; t.dueDay = num(st.dueDay) || DEF.dueDay; t.noticeDays = num(st.noticeDays); if (!init || init.rent == null) t.rent = ''; if (!init || init.deposit == null) t.deposit = ''; if (!init || init.depositPaid == null) t.depositPaid = ''; }
      const want = isNew && init && init.unitId ? init.unitId + '|' + (init.bedId || '') : cur, spots = this.spots(st);
      const spotOpts = () => { const from = UI.dateVal('tnFrom', bg) || t.from; return spots.filter(s => s.key === cur || (!s.maint && !this.clash(s.unitId, s.bedId, from, t.id, all))).map(s => [s.key, s.name + ' · ' + money(s.rent)]); };
      const rateHint = () => { const k = String(UI.val('tnSpot', bg)).split('|'), probe = { unitId: k[0], gst: '' }; return this.taxed() ? 'By the kind of ' + low('unit') + ': ' + this.rateFor(probe, st) + '%' : 'No GSTIN in the Company Profile: no GST'; };
      const bg = UI.modal({ title: isNew ? 'New ' + low('tenant') : t.no + ' · ' + (g.name || L('tenant')), wide: true, focus: false, body:
        '<div class="section-title" style="margin-top:0">' + esc(L('tenant')) + '</div><div class="grid3">' + UI.field('Name', UI.input('tnName', g.name), { req: true }) + UI.field('Mobile', UI.input('tnPhone', g.phone, { type: 'tel' })) + UI.field('Email', UI.input('tnEmail', g.email, { type: 'email' })) +
        UI.field('Permanent address', UI.input('tnAddr', g.address), { span: true }) + UI.field('State', UI.select('tnState', U.STATES, g.state || '', { blank: 'Select' })) + UI.field('Occupation / employer', UI.input('tnOcc', g.occupation, { placeholder: 'Student, Infosys ...' })) + UI.field('GSTIN (a business)', UI.input('tnGstin', g.gstin, { attrs: ' maxlength="15" style="text-transform:uppercase"' })) +
        UI.field('Identity document', UI.select('tnIdT', st.ids.concat(g.idType && !st.ids.includes(g.idType) ? [g.idType] : []), g.idType || st.ids[0])) + UI.field('Document number', UI.input('tnIdN', g.idNo)) + UI.field('Emergency contact', UI.input('tnEmer', g.emergency, { placeholder: 'Name and phone' })) + this.cfForm('tenant', t.custom) + '</div>' +
        '<div class="section-title">Tenancy</div><div class="grid3">' + '<div class="field"><label>From</label>' + UI.dateInput('tnFrom', t.from) + '</div>' + UI.field('What is let', UI.select('tnSpot', [], ''), { req: true, hint: 'Only what is free from that date' }) + '<div class="field"><label>Agreed to (optional)</label>' + UI.dateInput('tnTo', t.to) + '</div>' +
        UI.field('Monthly rent', UI.input('tnRent', t.rent, { type: 'number', attrs: ' min="0" step="any"' }), { req: true }) + UI.field('Deposit agreed', UI.input('tnDep', t.deposit, { type: 'number', attrs: ' min="0" step="any"' })) + UI.field('Deposit received', UI.input('tnDepPaid', t.depositPaid, { type: 'number', attrs: ' min="0" step="any"' })) +
        '<div class="field"><label>Deposit received on</label>' + UI.dateInput('tnDepDate', t.depositDate) + '</div>' + UI.field('Deposit received by', UI.select('tnDepMode', st.modes.concat(t.depositMode && !st.modes.includes(t.depositMode) ? [t.depositMode] : []), t.depositMode || st.modes[0])) + UI.field('Rent falls due on day', UI.input('tnDue', t.dueDay, { type: 'number', attrs: ' min="1" max="28" step="1"' })) +
        UI.field('Notice period (days)', UI.input('tnNotice', t.noticeDays, { type: 'number', attrs: ' min="0" step="1"' })) + '<div class="field"><label>' + esc(this.intl() ? this.intl().tax : 'GST') + ' on the rent %</label>' + UI.input('tnGst', t.gst, { type: 'number', attrs: ' min="0" max="100" step="any"', placeholder: 'As the settings say' }) + '<div class="hint" id="tnGstH"></div></div>' +
        UI.field('Notes', UI.input('tnNotes', t.notes, { placeholder: 'Agreement number, lock-in, who referred ...' }), { span: true }) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const name = String(UI.val('tnName', bg)).trim(); if (!name) { UI.mark('tnName', true, bg); UI.toast('Enter the name of the ' + low('tenant')); return false; }
          const phone = String(UI.val('tnPhone', bg)).trim(); if (phone && !U.isValidPhone(phone)) { UI.mark('tnPhone', true, bg); UI.toast('Enter a correct mobile number'); return false; }
          const gstin = String(UI.val('tnGstin', bg)).trim().toUpperCase(); if (gstin && U.isIndia() && !U.isValidGstin(gstin)) { UI.mark('tnGstin', true, bg); UI.toast('Enter a valid GSTIN (15 characters)'); return false; }
          const from = UI.dateVal('tnFrom', bg), to = UI.dateVal('tnTo', bg); if (!ms(from)) { UI.mark('tnFrom', true, bg); UI.toast('From when?'); return false; }
          if (to && ms(to) <= ms(from)) { UI.mark('tnTo', true, bg); UI.toast('The agreed-to date is after the first day'); return false; }
          const k = String(UI.val('tnSpot', bg)).split('|'), unitId = k[0], bedId = k[1] || ''; if (!unitId || !this.unit(unitId, st)) { UI.mark('tnSpot', true, bg); UI.toast('Choose what is let'); return false; }
          const c = this.clash(unitId, bedId, from, t.id); if (c) { UI.toast(this.spotName(unitId, bedId, st) + ' is taken by ' + c.no + ' (' + c.tenant.name + ', from ' + c.from + ')', 6000); return false; }
          const rent = num(UI.val('tnRent', bg)); if (rent <= 0) { UI.mark('tnRent', true, bg); UI.toast('Enter the monthly rent'); return false; }
          const custom = this.cfRead('tenant', bg, t.custom); if (!custom) return false;
          const paid = num(UI.val('tnDepPaid', bg)), gst = String(UI.val('tnGst', bg)).trim();
          Object.assign(g, { name, phone, email: String(UI.val('tnEmail', bg)).trim(), address: String(UI.val('tnAddr', bg)).trim(), state: UI.val('tnState', bg), occupation: String(UI.val('tnOcc', bg)).trim(), gstin, idType: UI.val('tnIdT', bg), idNo: String(UI.val('tnIdN', bg)).trim(), emergency: String(UI.val('tnEmer', bg)).trim() });
          Object.assign(t, { tenant: g, unitId, bedId, letName: this.spotName(unitId, bedId, st), from, to, rent, deposit: num(UI.val('tnDep', bg)), depositPaid: paid, depositDate: paid > 0 ? UI.dateVal('tnDepDate', bg) || from : '', depositMode: paid > 0 ? UI.val('tnDepMode', bg) : '', dueDay: Math.min(28, Math.max(1, Math.round(num(UI.val('tnDue', bg))) || DEF.dueDay)), noticeDays: Math.max(0, Math.round(num(UI.val('tnNotice', bg)))), gst: gst === '' ? '' : String(Math.max(0, Math.min(100, num(gst)))), notes: String(UI.val('tnNotes', bg)).trim(), custom });
          if (!t.no) t.no = this.nextNo();
          if (isNew) Store.add('tenancies', t); else Store.update('tenancies', t);
          UI.toast(t.no + ' saved' + (isNew ? ': its rent is raised under Rent & Collections' : ''), 3500, 'ok'); then();
        } }] });
      const fill = () => { const s = spots.find(x => x.key === UI.val('tnSpot', bg)); $('#tnGstH', bg).textContent = rateHint(); if (!s || !isNew) return; $('#tnRent', bg).value = s.rent || ''; $('#tnDep', bg).value = s.deposit || r2(s.rent * num(st.depositMonths)) || ''; };
      const opts = () => { const now = UI.val('tnSpot', bg) || want, o = spotOpts(); $('#tnSpot', bg).outerHTML = UI.select('tnSpot', o, o.some(x => x[0] === now) ? now : '', { blank: o.length ? 'Select' : 'Nothing is free' }); $('#tnSpot', bg).onchange = fill; };
      $('#tnFrom', bg).addEventListener('change', () => { opts(); fill(); });
      opts(); fill();
      return bg;
    },
    // The account of a tenancy: its months with their lines, what was collected, what is due
    open(id, then) {
      const t = this.find(id); if (!t) return null;
      const st = this.settings(), w = this.mayTen(), l = this.ledger(t, st), g = t.tenant, held = st.assets.filter(a => a.at === 'tenancy:' + t.id), again = () => { then(); this.open(id, then); };
      const cf = this.cfText('tenant', t, st);
      const bg = UI.modal({ title: t.no + ' · ' + (g.name || L('tenant')), wide: true, focus: false, body:
        '<div style="margin-bottom:10px">' + pill(TSTATUS, t.status) + ' <b>' + esc(this.place(t, st)) + '</b> · since ' + esc(t.from) + (t.movedOut ? ' · moved out ' + esc(t.movedOut) : t.status === 'notice' && t.vacateOn ? ' · leaves ' + esc(t.vacateOn) : t.to ? ' · agreed to ' + esc(t.to) : '') + ' · rent ' + money(t.rent) + ' due on day ' + num(t.dueDay) + ' · deposit ' + money(t.depositPaid) + (num(t.deposit) > num(t.depositPaid) ? ' of ' + money(t.deposit) : '') +
        '<div class="small muted">' + esc([g.phone, g.email, g.occupation, g.idType && g.idNo ? g.idType + ' ' + g.idNo : '', g.address, g.emergency ? 'Emergency: ' + g.emergency : '', g.gstin ? 'GSTIN ' + g.gstin : ''].filter(Boolean).join(' · ')) + '</div>' + (cf ? '<div class="small muted">' + esc(cf) + '</div>' : '') + (t.notes ? '<div class="small muted">' + esc(t.notes) + '</div>' : '') +
        (held.length ? '<div class="small muted">Furniture given: ' + esc(held.map(a => a.name + (num(a.qty) > 1 ? ' × ' + num(a.qty) : '')).join(', ')) + '</div>' : '') + (t.refund ? '<div class="small muted">Deposit: ' + money(t.refund.adjusted) + ' set against dues, ' + money(t.refund.refunded) + ' refunded' + (t.refund.mode ? ' by ' + esc(t.refund.mode) : '') + ' on ' + esc(t.refund.date) + '</div>' : '') + '</div>' +
        (l.rows.length ? '<div class="tablewrap"><table class="list" id="rnLedger"><thead><tr><th>Month</th><th>Particulars</th><th class="num">Amount</th><th class="num">Tax</th><th class="num">Total</th><th></th></tr></thead><tbody>' +
          l.rows.map(r => r.lines.map((x, n) => '<tr><td>' + (n ? '' : '<b>' + esc(ymName(r.ym)) + '</b>') + '</td><td>' + esc(x.desc) + (x.detail ? '<div class="small muted">' + esc(x.detail) + '</div>' : '') + '</td><td class="num">' + money(x.amount) + '</td><td class="num">' + (x.gst ? x.gst + '% ' + money(x.tax) : '-') + '</td><td class="num">' + money(r2(x.amount + x.tax)) + '</td><td>' + (w && !t.months[r.ym].invoiceNo && x.kind !== 'rent' ? '<button class="btn sm outline" data-delc="' + r.ym + '|' + (x.kind === 'late' ? 'late' : x.i) + '" title="Remove">✕</button>' : '') + '</td></tr>').join('') +
            '<tr><td></td><td class="small muted">Due ' + esc(r.due) + (t.months[r.ym].invoiceNo ? ' · Invoice ' + U.noLink(t.months[r.ym].invoiceNo) : '') + '</td><td class="num" colspan="2">' + this.statusPill(r) + '</td><td class="num"><b>' + money(r.total) + '</b>' + (r.paid && r.balance > 0 ? '<div class="small muted">balance ' + money(r.balance) + '</div>' : '') + '</td><td>' + (w && !t.months[r.ym].invoiceNo ? '<button class="btn sm outline" data-delm="' + r.ym + '" title="Remove the month">✕</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="hint">No rent raised yet: Rent &amp; Collections &gt; Generate rent for the month.</div>') +
        (t.payments.length ? '<div class="tablewrap" style="margin-top:10px"><table class="list" id="rnPaid"><thead><tr><th>Date</th><th>Receipt</th><th>Collected by</th><th>Reference</th><th class="num">Amount</th><th></th></tr></thead><tbody>' +
          t.payments.map((p, i) => '<tr><td>' + esc(p.date) + '</td><td>' + esc(p.receiptNo || '-') + '</td><td>' + esc(p.mode) + '</td><td>' + esc(p.ref || '') + '</td><td class="num">' + money(p.amount) + '</td><td>' + (p.adj ? '' : UI.ibtn('printer', 'Print receipt', 'data-prc="' + i + '"') + (w ? UI.ibtn('trash', 'Remove', 'data-delp="' + i + '"', 'danger') : '')) + '</td></tr>').join('') + '</tbody></table></div>' : '') +
        '<div class="kv" style="margin-top:12px"><div>Billed</div><div class="v">' + money(l.billed) + '</div><div>Collected</div><div class="v">' + money(l.paid) + '</div><div class="tot">' + (l.advance > 0 ? 'Advance on account' : 'Outstanding') + '</div><div class="v tot" id="rnBal">' + money(l.advance > 0 ? l.advance : l.balance) + '</div></div>',
        buttons: [{ label: 'Close', cls: 'outline' }, { label: 'Print statement', cls: 'outline', onClick: () => { this.printStatement(t); return false; } }]
          .concat(w && LIVE(t) ? [{ label: 'Edit', cls: 'outline', onClick: () => { this.editTenancy(t, then); } }, { label: '+ Charge', cls: 'outline', onClick: () => { this.addCharge(t, ymOf(U.today()), again); } }] : []).concat(w && LIVE(t) && this.mayMasters() ? [{ label: 'Furniture', cls: 'outline', onClick: () => { this.give(t, again); } }] : [])
          .concat(w && (LIVE(t) || l.balance > 0) ? [{ label: 'Collect', cls: 'green', onClick: () => { this.collect(t, again); } }] : [])
          .concat(w && LIVE(t) ? [{ label: t.status === 'notice' ? 'Notice' : 'Give notice', cls: 'outline', onClick: () => { this.notice(t, then); } }, { label: 'End tenancy', cls: 'red', onClick: () => { this.end(t, then); } }] : []) });
      const save = () => { Store.update('tenancies', t); bg.remove(); again(); };
      $$('[data-delc]', bg).forEach(b => { b.onclick = () => { const k = b.dataset.delc.split('|'), m = t.months[k[0]]; if (k[1] === 'late') m.lateFee = 0; else m.charges.splice(+k[1], 1); save(); }; });
      $$('[data-delm]', bg).forEach(b => { b.onclick = () => UI.confirm('Remove ' + ymName(b.dataset.delm), 'The rent and the charges of ' + ymName(b.dataset.delm) + ' are taken off ' + t.no + '. What was collected stays on the account.', () => { delete t.months[b.dataset.delm]; save(); }, 'Remove'); });
      $$('[data-delp]', bg).forEach(b => { b.onclick = () => { const p = t.payments[+b.dataset.delp]; UI.confirm('Remove the collection', money(p.amount) + ' of ' + p.date + (p.receiptNo ? ' (' + p.receiptNo + ')' : '') + ' is taken off the account.', () => { t.payments.splice(+b.dataset.delp, 1); save(); }, 'Remove'); }; });
      $$('[data-prc]', bg).forEach(b => { b.onclick = () => this.printReceipt(t, +b.dataset.prc); });
      return bg;
    },
    // A charge besides rent on a month: one of the business's heads; by the meter where it is read (previous, current, rate a unit)
    addCharge(t, ym, then) {
      const st = this.settings(), heads = st.heads.map(h => h.name), taxed = this.taxed(), metered = (h) => /electric|power|water|gas|meter/i.test(h);
      const bg = UI.modal({ title: 'Charge to ' + t.no + ' · ' + t.tenant.name, body: '<div class="grid2">' + UI.field('Charge', UI.select('chHead', heads, heads[0]), { req: true }) + UI.field('Month', UI.input('chMonth', ym, { type: 'month' })) +
          '<div class="field span" id="chMeter"><div class="grid3 keep2" style="margin:0">' + UI.field('Previous reading', UI.input('chPrev', '', { type: 'number', attrs: ' min="0" step="any"' })) + UI.field('Current reading', UI.input('chCur', '', { type: 'number', attrs: ' min="0" step="any"' })) + UI.field('Rate a unit', UI.input('chRate', '', { type: 'number', attrs: ' min="0" step="any"' })) + '</div></div>' +
          UI.field('Amount' + (taxed ? ' (before tax)' : ''), UI.input('chAmt', '', { type: 'number', attrs: ' min="0" step="any"' }), { req: true }) + '<div class="field"><label>Date</label>' + UI.dateInput('chDate', U.today()) + '</div>' +
          (taxed ? UI.field((this.intl() ? this.intl().tax : 'GST') + ' %', UI.input('chGst', '', { type: 'number', attrs: ' min="0" max="100" step="any"' })) + (this.intl() ? '<input type="hidden" id="chSac" value="">' : UI.field('SAC / HSN', UI.input('chSac', ''))) : '<input type="hidden" id="chGst" value="0"><input type="hidden" id="chSac" value="">') +
          UI.field('Note', UI.input('chNote', ''), { span: true }) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Add', cls: 'green', onClick: (bg) => {
          const head = UI.val('chHead', bg), month = UI.val('chMonth', bg), amount = r2(UI.val('chAmt', bg)); if (!isYm(month)) { UI.mark('chMonth', true, bg); return false; } if (amount <= 0) { UI.mark('chAmt', true, bg); return false; }
          const prev = num(UI.val('chPrev', bg)), cur = num(UI.val('chCur', bg)), m = t.months[month] || this.newMonth(t, month, st);
          if (m.invoiceNo) { UI.toast(ymName(month) + ' is invoiced (' + m.invoiceNo + '): bill this in the next month', 5000); return false; }
          m.charges = (m.charges || []).concat([Object.assign({ id: U.uid(), head, date: UI.dateVal('chDate', bg) || U.today(), amount, gst: String(num(UI.val('chGst', bg))), sac: String(UI.val('chSac', bg)).trim(), note: String(UI.val('chNote', bg)).trim() }, metered(head) && cur > prev ? { prev, cur, rate: num(UI.val('chRate', bg)) } : {})]);
          t.months[month] = m; Store.update('tenancies', t); UI.toast(head + ' ' + money(amount) + ' added to ' + ymName(month), 3000, 'ok'); then();
        } }] });
      const head = () => { const h = UI.val('chHead', bg), hd = st.heads.find(x => x.name === h) || {}; $('#chMeter', bg).style.display = metered(h) ? '' : 'none'; $('#chGst', bg).value = this.headRate(h, t, st); $('#chSac', bg).value = this.intl() ? '' : hd.sac || (hd.gst === '' || hd.gst == null ? this.sacFor(t, st) : ''); };
      const meter = () => { const u = num(UI.val('chCur', bg)) - num(UI.val('chPrev', bg)), r = num(UI.val('chRate', bg)); if (u > 0 && r > 0) $('#chAmt', bg).value = r2(u * r); };
      $('#chHead', bg).onchange = head; ['chPrev', 'chCur', 'chRate'].forEach(id => $('#' + id, bg).addEventListener('input', meter)); head();
      return bg;
    },
    // A collection: set against the oldest dues first, what is over stays on account; the late fee of an overdue month goes on first when ticked
    collect(t, then) {
      const st = this.settings(), l = this.ledger(t, st), fees = l.rows.map(r => ({ r, fee: num(t.months[r.ym].lateFee) ? 0 : this.lateFor(r, st) })).filter(x => x.fee > 0), fee = r2(sum(fees, x => x.fee * (1 + num(t.months[x.r.ym].gst) / 100)));
      const unpaid = l.rows.filter(r => r.balance > 0.005);
      return UI.modal({ title: 'Collect from ' + t.tenant.name + ' · ' + t.no, body: '<div class="hint" style="margin:0 0 10px">' + esc(this.place(t, st)) + '. ' + (unpaid.length ? 'Due: ' + unpaid.map(r => esc(ymName(r.ym)) + ' ' + money(r.balance)).join(', ') + '. The oldest is settled first.' : 'Nothing is due: this stays on account as an advance.') + '</div>' +
          '<div class="grid2">' + UI.field('Amount', UI.input('pyAmt', l.balance > 0 ? l.balance : '', { type: 'number', attrs: ' min="0" step="any"' }), { req: true, hint: 'Outstanding ' + money(l.balance) + (l.advance > 0 ? ', advance held ' + money(l.advance) : '') }) + UI.field('Collected by', UI.select('pyMode', st.modes, st.modes.includes('UPI') ? 'UPI' : st.modes[0])) + '<div class="field"><label>Date</label>' + UI.dateInput('pyDate', U.today()) + '</div>' + UI.field('Reference', UI.input('pyRef', '', { placeholder: 'UPI reference, cheque number' })) +
          (fee > 0 ? '<div class="field span">' + UI.check('pyLate', 'Add the late fee of ' + money(fee) + ' (' + fees.map(x => ymName(x.r.ym) + ', ' + x.r.days + ' days late').join('; ') + ')', true) + '</div>' : '') + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }].concat([['Save', false, 'outline'], ['Save & print receipt', true, 'green']].map(b => ({ label: b[0], cls: b[2], onClick: (bg) => {
          const amount = r2(UI.val('pyAmt', bg)); if (amount <= 0) { UI.mark('pyAmt', true, bg); return false; }
          if (fee > 0 && UI.val('pyLate', bg)) fees.forEach(x => { t.months[x.r.ym].lateFee = x.fee; });
          t.payments = t.payments.concat([{ id: U.uid(), date: UI.dateVal('pyDate', bg) || U.today(), amount, mode: UI.val('pyMode', bg), ref: String(UI.val('pyRef', bg)).trim(), receiptNo: this.nextReceipt() }]);
          Store.update('tenancies', t); const after = this.ledger(t, st); UI.toast(money(amount) + ' collected from ' + t.tenant.name + (after.balance > 0 ? ': ' + money(after.balance) + ' still due' : after.advance > 0 ? ': ' + money(after.advance) + ' on account' : ': all paid'), 4000, 'ok');
          then(); if (b[1]) this.printReceipt(t, t.payments.length - 1);
        } }))) });
    },
    // What a collection settled: the months it reached, oldest first, and what of it stays on account
    settled(t, i) {
      const before = r2(sum(t.payments.slice(0, i), p => p.amount)), p = t.payments[i], to = r2(before + num(p.amount)), out = []; let at = 0;
      this.ledger(t).rows.forEach(r => { const a = Math.max(at, before), b = Math.min(at + r.total, to); if (b - a > 0.005) out.push({ ym: r.ym, amount: r2(b - a) }); at = r2(at + r.total); });
      return { parts: out, advance: r2(Math.max(0, to - Math.max(at, before))) };
    },
    printReceipt(t, i) {
      const p = t.payments[i]; if (!p) return; const s = this.settled(t, i), co = Store.company(), l = this.ledger(t);
      UI.pdf('RENT RECEIPT ' + (p.receiptNo || ''), 'Received from ' + t.tenant.name + (t.tenant.phone ? ' (' + t.tenant.phone + ')' : '') + ' · ' + this.place(t) + ' · ' + L('tenant') + ' no. ' + t.no + ' · ' + p.date + ' · ' + p.mode + (p.ref ? ' ' + p.ref : ''),
        ['Particulars', 'Amount'], s.parts.map(x => ['Rent and charges of ' + ymName(x.ym), money(x.amount)]).concat(s.advance > 0 ? [['Advance on account', money(s.advance)]] : []).concat([['Received with thanks by ' + (co.name || ''), money(p.amount)], [l.balance > 0 ? 'Balance still due' : l.advance > 0 ? 'Advance held on account' : 'Nothing is due', money(l.balance > 0 ? l.balance : l.advance)]]), { right: [1], bold: [s.parts.length + (s.advance > 0 ? 1 : 0)] });
    },
    // The statement of a tenant: every charge and every collection in the order of their dates, with the balance after each
    statement(t) {
      const l = this.ledger(t), ev = [];
      l.rows.forEach(r => r.lines.forEach(x => ev.push({ at: ms(x.date) || ms(r.due), date: x.date || r.due, what: x.desc + (x.detail ? ' (' + x.detail + ')' : '') + (x.tax ? ' + tax ' + x.gst + '%' : ''), dr: r2(x.amount + x.tax), cr: 0 })));
      t.payments.forEach(p => ev.push({ at: ms(p.date), date: p.date, what: (p.adj ? 'Deposit set against dues' : 'Received · ' + p.mode) + (p.ref ? ' · ' + p.ref : '') + (p.receiptNo ? ' · ' + p.receiptNo : ''), dr: 0, cr: num(p.amount) }));
      let bal = 0; return ev.sort((a, b) => a.at - b.at || b.dr - a.dr).map(e => { bal = r2(bal + e.dr - e.cr); return [e.date, e.what, e.dr ? money(e.dr) : '', e.cr ? money(e.cr) : '', money(Math.abs(bal)) + (bal < -0.005 ? ' Cr' : '')]; });
    },
    printStatement(t) {
      const l = this.ledger(t), rows = this.statement(t);
      UI.pdf('STATEMENT OF ACCOUNT', t.tenant.name + ' · ' + this.place(t) + ' · ' + t.no + ' · since ' + t.from + (t.movedOut ? ' to ' + t.movedOut : '') + ' · rent ' + money(t.rent) + ' a month · deposit held ' + money(this.depositHeld(t)),
        ['Date', 'Particulars', 'Charged', 'Received', 'Balance'], rows.concat([['', l.advance > 0 ? 'Advance on account' : 'Outstanding', money(l.billed), money(l.paid), money(l.advance > 0 ? l.advance : l.balance)]]), { right: [2, 3, 4], bold: [rows.length] });
    },
    notice(t, then) {
      const on = t.status === 'notice';
      return UI.modal({ title: 'Notice · ' + t.tenant.name, body: '<div class="grid2"><div class="field"><label>Notice given on</label>' + UI.dateInput('ntOn', t.noticeOn || U.today()) + '</div><div class="field"><label>Leaves on</label>' + UI.dateInput('ntOut', t.vacateOn || plus(U.today(), num(t.noticeDays))) + '<div class="hint">The notice period is ' + num(t.noticeDays) + ' days. ' + esc(this.place(t)) + ' is offered again from the day after.</div></div></div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }].concat(on ? [{ label: 'Withdraw the notice', cls: 'red outline', onClick: () => { const c = this.clash(t.unitId, t.bedId, plus(t.vacateOn || U.today(), 1), t.id); if (c) { UI.toast(this.place(t) + ' is promised to ' + c.tenant.name + ' (' + c.no + ') from ' + c.from, 6000); return false; } Object.assign(t, { status: 'active', noticeOn: '', vacateOn: '' }); Store.update('tenancies', t); UI.toast('Notice withdrawn'); then(); } }] : []).concat([{ label: on ? 'Save' : 'Give notice', cls: 'green', onClick: (bg) => {
          const d = UI.dateVal('ntOn', bg), out = UI.dateVal('ntOut', bg); if (!ms(d)) { UI.mark('ntOn', true, bg); return false; } if (!ms(out) || ms(out) < ms(d)) { UI.mark('ntOut', true, bg); UI.toast('The day of leaving is on or after the notice'); return false; }
          Object.assign(t, { status: 'notice', noticeOn: d, vacateOn: out }); Store.update('tenancies', t); UI.toast(t.tenant.name + ' is on notice: leaves on ' + out, 3500, 'ok'); then();
        } }]) });
    },
    /* A tenancy as it stands when it ends on a date: the rent of the month of leaving is by the day up to it (where the
       month is not invoiced), months raised beyond it that carry nothing else are dropped */
    closing(t, date, st) {
      const c = copy(t), ym = ymOf(date); c.movedOut = date;
      const r = this.rentFor(c, ym, st);
      if (r.days > 0) { if (!c.months[ym]) c.months[ym] = this.newMonth(c, ym, st); else if (!c.months[ym].invoiceNo) Object.assign(c.months[ym], { rent: r.rent, days: r.days, of: r.of }); }
      Object.keys(c.months).forEach(k => { const m = c.months[k]; if (isYm(k) && k > ym && !m.invoiceNo && !(m.charges || []).length && !num(m.lateFee)) delete c.months[k]; });
      return c;
    },
    // The end of a tenancy: the day of leaving, the dues to it, the deposit set against them and the rest refunded; what was let stands vacant
    end(t, then) {
      const st = this.settings(), held = r2(t.depositPaid), dues = (d) => this.ledger(this.closing(t, d, st), st).balance, first = t.status === 'notice' && ms(t.vacateOn) && ms(t.vacateOn) <= ms(U.today()) ? t.vacateOn : U.today();
      const bg = UI.modal({ title: 'End the tenancy · ' + t.tenant.name, body: '<div class="grid2"><div class="field"><label>Moved out on</label>' + UI.dateInput('enDate', first) + '<div class="hint" id="enDues"></div></div>' + UI.field('Deposit held', UI.input('enHeld', held, { type: 'number', disabled: true })) +
          UI.field('Deposit set against the dues', UI.input('enAdj', '', { type: 'number', attrs: ' min="0" step="any"' })) + UI.field('Deposit refunded', UI.input('enRef', '', { type: 'number', attrs: ' min="0" step="any"' }), { hint: 'What is neither set against dues nor refunded is kept (damages, a short notice)' }) +
          UI.field('Refunded by', UI.select('enMode', st.modes, st.modes[0])) + UI.field('Note', UI.input('enNote', '', { placeholder: 'Keys returned, meter reading, damages ...' })) + '</div><div class="hint">' + esc(this.place(t, st)) + ' stands vacant from the day after, and the furniture given goes back to it.</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'End tenancy', cls: 'red', onClick: (bg) => {
          const date = UI.dateVal('enDate', bg); if (!ms(date) || ms(date) < ms(t.from)) { UI.mark('enDate', true, bg); UI.toast('The day of leaving is on or after ' + t.from); return false; }
          const adj = r2(UI.val('enAdj', bg)), ref = r2(UI.val('enRef', bg)), due = dues(date);
          if (adj > due + 0.005) { UI.mark('enAdj', true, bg); UI.toast('Only ' + money(due) + ' is due'); return false; }
          if (adj + ref > held + 0.005) { UI.mark('enRef', true, bg); UI.toast('The deposit held is ' + money(held)); return false; }
          const c = this.closing(t, date, st);
          if (adj > 0) c.payments.push({ id: U.uid(), date, amount: adj, mode: 'Deposit', ref: 'Deposit set against dues', receiptNo: '', adj: true });
          Object.assign(c, { status: 'ended', movedOut: date, letName: this.place(t, st), refund: { date, adjusted: adj, refunded: ref, kept: r2(held - adj - ref), mode: ref > 0 ? UI.val('enMode', bg) : '', note: String(UI.val('enNote', bg)).trim() } });
          Store.update('tenancies', c);
          const s2 = this.settings(); if (this.mayMasters() && s2.assets.some(a => a.at === 'tenancy:' + t.id)) { s2.assets = s2.assets.map(a => a.at === 'tenancy:' + t.id ? Object.assign({}, a, { at: t.bedId && this.bed(t.bedId, s2) ? 'bed:' + t.bedId : this.unit(t.unitId, s2) ? 'unit:' + t.unitId : 'store' }) : a); this.saveSettings(s2); }
          const left = this.ledger(c, st).balance; UI.toast(t.tenant.name + ' has moved out' + (left > 0 ? ': ' + money(left) + ' is still due' : ''), 4500, 'ok'); then();
        } }] });
      const sync = (fill) => { const d = UI.dateVal('enDate', bg), due = ms(d) ? dues(d) : 0; $('#enDues', bg).textContent = 'Dues up to that day: ' + money(due); if (fill) { const adj = Math.min(held, due); $('#enAdj', bg).value = adj || ''; $('#enRef', bg).value = r2(held - adj) || ''; } };
      $('#enDate', bg).addEventListener('change', () => sync(true)); $('#enAdj', bg).addEventListener('input', () => { $('#enRef', bg).value = r2(Math.max(0, held - num(UI.val('enAdj', bg)))) || ''; }); sync(true);
      return bg;
    },
    removeTenancy(t, then) {
      if (t.payments.length || num(t.depositPaid) > 0) { UI.toast('Rent or a deposit was collected on ' + t.no + ': end the tenancy instead of deleting it', 6000); return; }
      if (Object.keys(t.months).some(k => t.months[k].invoiceNo)) { UI.toast(t.no + ' has an invoice: end the tenancy instead of deleting it', 6000); return; }
      UI.confirm('Delete ' + t.no, t.tenant.name + ', ' + this.place(t) + '. Nothing was collected on it; it is removed from the records.', () => {
        Store.delete('tenancies', t.id); const st = this.settings(); if (this.mayMasters() && st.assets.some(a => a.at === 'tenancy:' + t.id)) { st.assets = st.assets.map(a => a.at === 'tenancy:' + t.id ? Object.assign({}, a, { at: 'store' }) : a); this.saveSettings(st); }
        UI.toast(t.no + ' deleted'); then();
      }, 'Delete');
    },
    // The furniture given with a tenancy: of what is in the store, in the room or with the bed
    give(t, then) {
      const st = this.settings(), mine = 'tenancy:' + t.id, home = t.bedId ? 'bed:' + t.bedId : 'unit:' + t.unitId, list = st.assets.filter(a => a.condition !== 'disposed' && [mine, 'store', 'unit:' + t.unitId, home].includes(a.at || 'store'));
      return UI.modal({ title: 'Furniture given to ' + t.tenant.name, body: list.length ? '<div class="hint" style="margin:0 0 8px">What is ticked is with the ' + esc(low('tenant')) + ' and goes back to the ' + esc(low(t.bedId ? 'bed' : 'unit')) + ' when the tenancy ends.</div>' + list.map((a, i) => '<div style="margin-bottom:6px">' + UI.check('gv' + i, a.name + (num(a.qty) > 1 ? ' × ' + num(a.qty) : '') + ' · ' + (a.category || '') + ' · ' + this.whereName(a.at, st) + (a.condition && a.condition !== 'good' ? ' · ' + pick(COND, a.condition)[1].toLowerCase() : ''), a.at === mine) + '</div>').join('') : '<div class="empty">Nothing in the store or in this ' + esc(low('unit')) + ': add it under ' + esc(this.tabName('assets')) + '.</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }].concat(list.length ? [{ label: 'Save', cls: 'green', onClick: (bg) => {
          const pickd = new Map(list.map((a, i) => [a.id, !!UI.val('gv' + i, bg)]));
          st.assets = st.assets.map(a => !pickd.has(a.id) ? a : pickd.get(a.id) ? Object.assign({}, a, { at: mine }) : a.at === mine ? Object.assign({}, a, { at: home }) : a);
          if (this.saveSettings(st) === false) return false; UI.toast('Furniture noted', 2500, 'ok'); then();
        } }] : []) });
    },

    // ------------------------------------------------------------ rent and collections, month by month
    rentTab(p, st, all) {
      const ym = isYm(p.month) ? p.month : ymOf(U.today()), w = this.mayTen(), inv = Companies.mayWrite('invoices');
      const list = all.filter(t => t.months[ym] || (LIVE(t) && this.rentFor(t, ym, st).days > 0)).sort((a, b) => byNo(this.place(a, st), this.place(b, st)));
      const data = list.map(t => { const l = this.ledger(t, st); return { t, l, r: l.rows.find(x => x.ym === ym) || null, pre: this.rentFor(t, ym, st) }; }), have = data.filter(d => d.r), missing = data.length - have.length;
      const tot = (f) => r2(sum(have, d => f(d.r)));
      const dash = '<span class="muted">-</span>';
      const row = (d) => { const t = d.t, r = d.r, m = t.months[ym];
        return '<tr data-f="' + esc([t.no, t.tenant.name, t.tenant.phone, this.place(t, st)].join(' ').toLowerCase()) + '" data-id="' + esc(t.id) + '"><td data-l="No"><a href="#" data-ten="' + esc(t.id) + '">' + esc(t.no) + '</a></td><td data-l="' + esc(L('tenant')) + '"><b>' + esc(t.tenant.name || '-') + '</b><div class="small muted">' + esc(t.tenant.phone) + '</div></td><td data-l="Let">' + esc(this.place(t, st)) + '</td>' +
          (r ? '<td class="num" data-l="Rent">' + money(r.rent) + (num(m.days) < num(m.of) ? '<div class="small muted">' + m.days + ' of ' + m.of + ' days</div>' : '') + '</td><td class="num" data-l="Other charges">' + (r.other ? money(r.other) + '<div class="small muted">' + esc(r.lines.filter(x => x.kind !== 'rent').map(x => x.desc.replace(/ - .*$/, '')).join(', ')) + '</div>' : dash) + '</td><td class="num" data-l="Tax">' + (r.tax ? money(r.tax) : dash) + '</td><td class="num" data-l="Total"><b>' + money(r.total) + '</b></td><td class="num" data-l="Collected">' + money(r.paid) + '</td><td class="num" data-l="Balance">' + (r.balance > 0 ? '<b>' + money(r.balance) + '</b>' : money(0)) + '</td><td data-l="Due on">' + esc(r.due) + '</td><td data-l="Status">' + this.statusPill(r) + (m.invoiceNo ? '<div class="small muted">Invoice ' + U.noLink(m.invoiceNo) + '</div>' : '') + '</td>'
            : '<td class="num" data-l="Rent"><span class="muted">' + money(d.pre.rent) + '</span><div class="small muted">not raised yet</div></td><td class="num" data-l="Other charges">' + dash + '</td><td class="num" data-l="Tax">' + dash + '</td><td class="num" data-l="Total">' + dash + '</td><td class="num" data-l="Collected">' + dash + '</td><td class="num" data-l="Balance">' + dash + '</td><td data-l="Due on">' + esc(this.dueDate(t, ym)) + '</td><td data-l="Status">' + dash + '</td>') +
          '<td class="actions" data-l="">' + (w ? (d.l.balance > 0 || LIVE(t) ? UI.ibtn('cash', 'Collect rent', 'data-tcollect="' + esc(t.id) + '"', 'primary') : '') + (LIVE(t) && !(m && m.invoiceNo) ? UI.ibtn('plus', 'Add charge', 'data-charge="' + esc(t.id) + '"') : '') : '') + (t.payments.some(x => !x.adj) ? UI.ibtn('printer', 'Print the last receipt', 'data-rcpt="' + esc(t.id) + '"') : '') + (r && !m.invoiceNo && inv ? UI.ibtn('file', 'Make invoice', 'data-inv="' + esc(t.id) + '"') : '') + '</td></tr>'; };
      const head = ['No', L('tenant'), 'Let', 'Rent', 'Other charges', 'Tax', 'Total', 'Collected', 'Balance', 'Due on', 'Status'];
      const html = '<div class="btnrow" style="align-items:center"><button class="btn sm outline" id="rnPrev">◀</button><input type="month" id="rnMonth" value="' + ym + '"' + DSM + '><button class="btn sm outline" id="rnNext">▶</button>' +
        (w ? '<button class="btn sm green" id="rnGen"' + (missing ? '' : ' disabled') + '>Generate rent for the month' + (missing ? ' (' + missing + ')' : '') + '</button>' + (st.late.kind !== 'none' ? '<button class="btn sm outline" id="rnLate">Apply late fees</button>' : '') : '') + '<input id="rnFind" placeholder="Search" style="flex:1;min-width:140px;min-height:34px"><button class="btn sm outline" id="rnXls">Excel</button></div>' +
        '<div class="istats">' + [['Rent of ' + ymName(ym), tot(r => r.rent), ''], ['Other charges', tot(r => r.other), ''], ['Tax', tot(r => r.tax), ''], ['Billed', tot(r => r.total), ''], ['Collected', tot(r => r.paid), 'ok'], ['Balance', tot(r => r.balance), tot(r => r.balance) > 0 ? 'bad' : '']].map(x => '<div class="istat ' + x[2] + '"><div class="v">' + money(x[1]) + '</div><div class="k">' + esc(x[0]) + '</div></div>').join('') + '</div>' +
        (data.length ? '<div class="tablewrap"><table class="list cards" id="rnRent"><thead><tr>' + head.map((h, i) => '<th' + (i >= 3 && i <= 8 ? ' class="num"' : '') + '>' + esc(h) + '</th>').join('') + '<th></th></tr></thead><tbody>' + data.map(row).join('') + '</tbody></table></div>' +
          (missing && w ? '<div class="hint" style="margin-top:8px">' + missing + ' of these have no rent for ' + esc(ymName(ym)) + ' yet: Generate rent for the month raises it' + (st.proRata === false ? '' : ', by the day where the tenancy begins or ends inside the month') + '.</div>' : '')
          : '<div class="empty">' + (all.length ? 'No tenancy runs in ' + esc(ymName(ym)) + '.' : 'No ' + esc(low('tenant')) + ' yet: the rent of each month is raised and collected here.') + '</div>');
      return { html, wire: (root, again) => {
        const go = (m) => App.go('rental', { tab: 'rent', month: m }), ten = (b) => this.find(b.dataset.charge || b.dataset.rcpt || b.dataset.inv);
        $('#rnPrev', root).onclick = () => go(ymPlus(ym, -1)); $('#rnNext', root).onclick = () => go(ymPlus(ym, 1)); $('#rnMonth', root).onchange = () => { const v = UI.val('rnMonth'); if (isYm(v)) go(v); };
        if ($('#rnGen', root)) $('#rnGen', root).onclick = () => { const n = this.generate(ym); if (n < 0) return; UI.toast(n ? 'Rent of ' + ymName(ym) + ' raised for ' + n + ' ' + low('tenant', n !== 1) : 'Every tenancy has its rent for ' + ymName(ym), 3500, n ? 'ok' : ''); again(); };
        if ($('#rnLate', root)) $('#rnLate', root).onclick = () => { const n = this.applyLate(ym); if (n < 0) return; UI.toast(n ? 'Late fee added to ' + n + ' ' + low('tenant', n !== 1) : 'No rent of ' + ymName(ym) + ' is late beyond the ' + num(st.late.grace) + ' days of grace', 4000, n ? 'ok' : ''); again(); };
        $$('[data-charge]', root).forEach(b => { b.onclick = () => { const t = ten(b); if (t) this.addCharge(t, ym, again); }; });
        $$('[data-rcpt]', root).forEach(b => { b.onclick = () => { const t = ten(b); if (!t) return; let i = t.payments.length - 1; while (i >= 0 && t.payments[i].adj) i--; if (i >= 0) this.printReceipt(t, i); }; });
        $$('[data-inv]', root).forEach(b => { b.onclick = () => App.go('invoice', { fromRent: b.dataset.inv, month: ym }); });
        const f = $('#rnFind', root), run = () => { const t = f.value.trim().toLowerCase(); $$('#rnRent tbody tr', root).forEach(tr => { tr.style.display = !t || tr.dataset.f.includes(t) ? '' : 'none'; }); };
        f.addEventListener('input', run);
        $('#rnXls', root).onclick = () => UI.xls('Rent_' + ym, ['No', L('tenant'), 'Phone', 'Let', 'Days', 'Rent', 'Other charges', 'Tax', 'Total', 'Collected', 'Balance', 'Due on', 'Status', 'Invoice'],
          data.map(d => d.r ? [d.t.no, d.t.tenant.name, d.t.tenant.phone, this.place(d.t, st), d.t.months[ym].days + '/' + d.t.months[ym].of, d.r.rent, d.r.other, d.r.tax, d.r.total, d.r.paid, d.r.balance, d.r.due, this.statusText(d.r), d.t.months[ym].invoiceNo || ''] : [d.t.no, d.t.tenant.name, d.t.tenant.phone, this.place(d.t, st), d.pre.days + '/' + d.pre.of, d.pre.rent, '', '', '', '', '', this.dueDate(d.t, ym), 'Not raised', ''])
            .concat([['', 'Total', '', '', '', tot(r => r.rent), tot(r => r.other), tot(r => r.tax), tot(r => r.total), tot(r => r.paid), tot(r => r.balance), '', '', '']]));
      } };
    },

    // ------------------------------------------------------------ furniture and other assets
    whereName(at, st, all) {
      st = st || this.settings(); const k = String(at || 'store').split(':');
      if (k[0] === 'unit') { const u = this.unit(k[1], st); return u ? this.unitName(u, st) : 'Store'; }
      if (k[0] === 'bed') { const b = this.bed(k[1], st); return b ? this.spotName(b.unitId, b.id, st) : 'Store'; }
      if (k[0] === 'tenancy') { const t = (all || this.tenancies()).find(x => x.id === k[1]); return t ? t.tenant.name + ' (' + t.no + ', ' + this.place(t, st) + ')' : 'Store'; }
      return 'Store';
    },
    places(st, all) { return [['store', 'Store']].concat(this.unitsSorted(st).map(u => ['unit:' + u.id, this.unitName(u, st)])).concat(this.spots(st).filter(s => s.bedId).map(s => ['bed:' + s.bedId, s.name])).concat(all.filter(LIVE).map(t => ['tenancy:' + t.id, 'With ' + t.tenant.name + ' (' + t.no + ')'])); },
    assetsTab(p, st, all) {
      const w = this.mayMasters(), cat = p.cat || '', list = st.assets.filter(a => !cat || a.category === cat).sort((a, b) => byNo(a.name, b.name)), cats = Array.from(new Set(st.assetCats.concat(st.assets.map(a => a.category).filter(Boolean))));
      const live = list.filter(a => a.condition !== 'disposed');
      const html = '<div class="btnrow" style="align-items:center">' + (w ? '<button class="btn sm green" id="rnAddA">+ ' + esc(L('asset')) + '</button>' : '') + UI.select('rnCat', cats, cat, { blank: 'All categories', attrs: DSM }) + '<input id="rnFind" placeholder="Search item, place, ' + esc(low('tenant')) + '" style="flex:1;min-width:200px;min-height:34px"><button class="btn sm outline" id="rnXls">Export</button></div>' +
        '<div class="istats"><div class="istat"><div class="v">' + r2(sum(live, a => num(a.qty) || 1)) + '</div><div class="k">Pieces</div></div><div class="istat"><div class="v">' + money(sum(live, a => a.value)) + '</div><div class="k">Value</div></div><div class="istat warn"><div class="v">' + list.filter(a => a.condition === 'repair' || a.condition === 'damaged').length + '</div><div class="k">To repair</div></div><div class="istat"><div class="v">' + live.filter(a => String(a.at || '').startsWith('tenancy:')).length + '</div><div class="k">With ' + esc(low('tenant', 1)) + '</div></div></div>' +
        (list.length ? '<div class="tablewrap"><table class="list cards" id="rnAssets"><thead><tr><th>Item</th><th>Category</th><th class="num">Qty</th><th class="num">Value</th><th>Condition</th><th>Where</th><th></th></tr></thead><tbody>' +
          list.map(a => { const where = this.whereName(a.at, st, all), cf = this.cfText('asset', a, st);
            return '<tr data-f="' + esc([a.name, a.category, where, a.notes, pick(COND, a.condition)[1]].join(' ').toLowerCase()) + '"><td data-l="Item"><b>' + esc(a.name) + '</b>' + (cf ? '<div class="small muted">' + esc(cf) + '</div>' : '') + (a.notes ? '<div class="small muted">' + esc(a.notes) + '</div>' : '') + '</td><td data-l="Category">' + esc(a.category || '-') + '</td><td class="num" data-l="Qty">' + (num(a.qty) || 1) + '</td><td class="num" data-l="Value">' + money(a.value) + '</td><td data-l="Condition">' + pill(COND, a.condition) + '</td><td data-l="Where">' + esc(where) + '</td><td class="actions" data-l="">' +
              (w ? UI.ibtn('box', 'Move', 'data-amove="' + esc(a.id) + '"') + UI.ibtn('edit', 'Edit ' + low('asset'), 'data-aedit="' + esc(a.id) + '"') + UI.ibtn('trash', 'Delete', 'data-adel="' + esc(a.id) + '"', 'danger') : '') + '</td></tr>'; }).join('') + '</tbody></table></div>'
          : '<div class="empty">' + (st.assets.length ? 'Nothing in this category.' : 'No ' + esc(low('asset')) + ' yet: the cots, mattresses, cupboards, fans, geysers and whatever else is kept in a ' + esc(low('unit')) + ' or given with a ' + esc(low('bed')) + '.') + '</div>');
      return { html, wire: (root, again) => {
        const on = (attr, fn) => $$('[data-' + attr + ']', root).forEach(b => { b.onclick = () => { const a = this.settings().assets.find(x => x.id === b.dataset[attr]); if (a) fn(a); }; });
        if ($('#rnAddA', root)) $('#rnAddA', root).onclick = () => this.editAsset(null, again);
        on('aedit', (a) => this.editAsset(a, again)); on('amove', (a) => this.moveAsset(a, again));
        on('adel', (a) => UI.confirm('Delete ' + a.name, 'It is removed from the register. Something sold or scrapped is better marked Disposed, so the register still shows it.', () => { const s = this.settings(); s.assets = s.assets.filter(x => x.id !== a.id); if (this.saveSettings(s) === false) return; again(); }, 'Delete'));
        $('#rnCat', root).onchange = () => App.go('rental', { tab: 'assets', cat: UI.val('rnCat') });
        const f = $('#rnFind', root), run = () => { const t = f.value.trim().toLowerCase(); $$('#rnAssets tbody tr', root).forEach(tr => { tr.style.display = !t || tr.dataset.f.includes(t) ? '' : 'none'; }); };
        f.addEventListener('input', run);
        $('#rnXls', root).onclick = () => UI.xls(L('asset', 1).replace(/[^A-Za-z0-9]+/g, '_'), ['Item', 'Category', 'Qty', 'Value', 'Condition', 'Where', 'Notes'].concat(this.cfHead('asset', st)), list.map(a => [a.name, a.category, num(a.qty) || 1, num(a.value), pick(COND, a.condition)[1], this.whereName(a.at, st, all), a.notes].concat(this.cfVals('asset', a, st))));
      } };
    },
    editAsset(a, then) {
      const st = this.settings(), isNew = !a, all = this.tenancies(); a = Object.assign({ id: U.uid(), name: '', category: st.assetCats[0], qty: 1, value: '', condition: 'good', at: 'store', notes: '', custom: {} }, a);
      return UI.modal({ title: isNew ? 'New ' + low('asset') : a.name, body: '<div class="grid2">' + UI.field('Item', UI.input('asName', a.name, { placeholder: 'Single cot, ceiling fan, geyser ...' }), { req: true }) + UI.field('Category', UI.select('asCat', st.assetCats.concat(a.category && !st.assetCats.includes(a.category) ? [a.category] : []), a.category)) +
          UI.field('Quantity', UI.input('asQty', a.qty, { type: 'number', attrs: ' min="1" step="1"' })) + UI.field('Value', UI.input('asVal', a.value, { type: 'number', attrs: ' min="0" step="any"' }), { hint: 'Of the lot, as bought' }) + UI.field('Condition', UI.select('asCond', COND.map(c => [c[0], c[1]]), a.condition)) + UI.field('Where it is', UI.select('asAt', this.places(st, all), a.at || 'store')) +
          UI.field('Notes', UI.input('asNotes', a.notes, { placeholder: 'Serial number, bought from, warranty ...' }), { span: true }) + this.cfForm('asset', a.custom) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const name = String(UI.val('asName', bg)).trim(); if (!name) { UI.mark('asName', true, bg); return false; }
          const custom = this.cfRead('asset', bg, a.custom); if (!custom) return false;
          Object.assign(a, { name, category: UI.val('asCat', bg), qty: Math.max(1, Math.round(num(UI.val('asQty', bg))) || 1), value: num(UI.val('asVal', bg)), condition: UI.val('asCond', bg), at: UI.val('asAt', bg) || 'store', notes: String(UI.val('asNotes', bg)).trim(), custom });
          st.assets = isNew ? st.assets.concat([a]) : st.assets.map(x => x.id === a.id ? a : x);
          if (this.saveSettings(st) === false) return false; UI.toast(L('asset') + ' saved', 2500, 'ok'); then();
        } }] });
    },
    moveAsset(a, then) {
      const st = this.settings(), all = this.tenancies();
      return UI.modal({ title: 'Move ' + a.name, body: '<div class="hint" style="margin:0 0 10px">Now: ' + esc(this.whereName(a.at, st, all)) + '</div><div class="grid2">' + UI.field('Move to', UI.select('mvAt', this.places(st, all), a.at || 'store')) + UI.field('Condition', UI.select('mvCond', COND.map(c => [c[0], c[1]]), a.condition)) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Move', cls: 'green', onClick: (bg) => { st.assets = st.assets.map(x => x.id === a.id ? Object.assign({}, x, { at: UI.val('mvAt', bg) || 'store', condition: UI.val('mvCond', bg) }) : x); if (this.saveSettings(st) === false) return false; UI.toast(a.name + ': ' + this.whereName(UI.val('mvAt', bg), st, all), 3000, 'ok'); then(); } }] });
    },

    // ------------------------------------------------------------ reports
    /* A report is one or more tables: { title, sub, headers, rows, right: [columns set to the right], foot: a totals
       row, note, empty }, the cells plain text; each with Print (a PDF through the print page) and Excel */
    reportSections(p, all, st) {
      st = st || this.settings(); all = all || this.tenancies(); p = p || {};
      const rep = REPS.some(r => r[0] === p.rep) ? p.rep : 'roll', P = period(p, rep === 'collections' ? 5 : 0), span = P.from + ' to ' + P.to, asOn = 'As on ' + U.today(), live = all.filter(LIVE), t0 = ms(U.today()), bname = (u) => (this.building(u.buildingId, st) || {}).name || '-';
      const spots = this.spots(st), holder = (s) => this.holder(s.unitId, s.bedId, all) || (s.bedId ? this.holder(s.unitId, '', all) : null);
      if (rep === 'roll') {
        const rows = spots.map(s => { const t = holder(s); return { s, t, row: [bname(s.u), s.u.no, s.b ? s.b.label : '', s.u.kind || '', t ? t.tenant.name : s.maint ? 'Under maintenance' : 'Vacant', t ? t.tenant.phone : '', t ? t.no : '', t ? t.from : '', money(s.rent), t ? money(t.rent) : '', t ? money(t.depositPaid) : ''] }; });
        return [{ title: 'Rent roll', sub: asOn, headers: [L('building'), L('unit'), L('bed'), 'Kind', L('tenant'), 'Phone', 'Tenancy', 'Since', 'Rent asked', 'Rent', 'Deposit held'], right: [8, 9, 10], rows: rows.map(x => x.row),
          foot: ['', '', '', '', rows.filter(x => x.t).length + ' let of ' + rows.length, '', '', '', money(sum(rows, x => x.s.rent)), money(sum(rows.filter(x => x.t), x => x.t.rent)), money(sum(rows.filter(x => x.t), x => x.t.depositPaid))], empty: 'No ' + low('unit') + ' yet.', note: 'Every ' + low('unit') + ' let whole and every ' + low('bed') + ', with who has it. The rent asked is the one on the ' + low('unit') + '; the rent is what the tenancy pays.' }];
      }
      if (rep === 'occupancy') {
        const rows = st.buildings.slice().sort((a, b) => byNo(a.name, b.name)).map(b => { const us = st.units.filter(u => u.buildingId === b.id), ss = us.map(u => this.unitStatus(u, all, st)), sp = spots.filter(s => s.u.buildingId === b.id && !s.maint), let_ = sp.filter(s => holder(s)), vac = sp.filter(s => !holder(s));
          return { n: sp.length, k: let_.length, rent: sum(let_, s => holder(s).rent), lost: sum(vac, s => s.rent), row: [b.name, us.length, ss.filter(x => x === 'let').length, ss.filter(x => x === 'part').length, ss.filter(x => x === 'vacant').length, ss.filter(x => x === 'maint').length, sp.length, let_.length, sp.length ? pct(let_.length / sp.length * 100) : '-', money(sum(let_, s => holder(s).rent)), money(sum(vac, s => s.rent))] }; });
        const n = sum(rows, r => r.n), k = sum(rows, r => r.k), vac = spots.filter(s => !s.maint && !holder(s));
        return [{ title: 'Occupancy by ' + low('building'), sub: asOn, headers: [L('building'), L('unit', 1), 'Let', 'Partly let', 'Vacant', 'Maintenance', 'To let (' + low('unit', 1) + ' + ' + low('bed', 1) + ')', 'Let', 'Occupancy', 'Rent a month', 'Rent lost to vacancy'], right: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rows: rows.map(r => r.row),
          foot: ['Total', st.units.length, '', '', '', '', n, k, n ? pct(k / n * 100) : '-', money(sum(rows, r => r.rent)), money(sum(rows, r => r.lost))], empty: 'No ' + low('building') + ' yet.' },
          { title: 'Vacant now', sub: asOn, headers: [L('building'), L('unit'), L('bed'), 'Kind', 'Floor', 'Rent asked'], right: [5], rows: vac.map(s => [bname(s.u), s.u.no, s.b ? s.b.label : '', s.u.kind || '', s.u.floor || '', money(s.rent)]), foot: ['', '', '', '', vac.length + ' vacant', money(sum(vac, s => s.rent))], empty: 'Nothing stands vacant.' }];
      }
      if (rep === 'due') {
        const B = [0, 0, 0, 0, 0], rows = all.map(t => { const l = this.ledger(t, st); if (l.balance <= 0.005) return null; const b = [0, 0, 0, 0, 0];
          l.rows.forEach(r => { if (r.balance <= 0.005) return; const d = Math.round((t0 - ms(r.due)) / DAY), i = d < 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4; b[i] = r2(b[i] + r.balance); B[i] = r2(B[i] + r.balance); });
          return { bal: l.balance, row: [t.no, t.tenant.name, t.tenant.phone, this.place(t, st), pick(TSTATUS, t.status)[1]].concat(b.map(v => v ? money(v) : '')).concat([money(l.balance), money(this.depositHeld(t))]) }; }).filter(Boolean).sort((a, b) => b.bal - a.bal);
        const adv = all.map(t => ({ t, l: this.ledger(t, st) })).filter(x => x.l.advance > 0.005);
        return [{ title: 'Outstanding and ageing', sub: asOn, headers: ['No', L('tenant'), 'Phone', 'Let', 'Tenancy', 'Not yet due', '0-30 days', '31-60 days', '61-90 days', 'Over 90 days', 'Outstanding', 'Deposit held'], right: [5, 6, 7, 8, 9, 10, 11], rows: rows.map(r => r.row),
          foot: ['', rows.length + ' owing', '', '', ''].concat(B.map(v => money(v))).concat([money(sum(rows, r => r.bal)), '']), empty: 'Nobody owes rent.', note: 'A month\'s balance is aged from the day it fell due. A collection settles the oldest month first.' },
          { title: 'Advances on account', sub: asOn, headers: ['No', L('tenant'), 'Let', 'Advance'], right: [3], rows: adv.map(x => [x.t.no, x.t.tenant.name, this.place(x.t, st), money(x.l.advance)]), foot: ['', '', 'Total', money(sum(adv, x => x.l.advance))], empty: 'No advance is held.' }];
      }
      if (rep === 'collections') {
        const rec = []; all.forEach(t => t.payments.forEach(x => { if (!x.adj && within(x.date, P)) rec.push({ t, p: x }); })); rec.sort((a, b) => ms(a.p.date) - ms(b.p.date));
        const group = (key) => { const m = new Map(); rec.forEach(x => { const k = key(x), o = m.get(k) || { n: 0, amt: 0 }; o.n++; o.amt += num(x.p.amount); m.set(k, o); }); return Array.from(m.entries()); }, total = money(sum(rec, x => x.p.amount));
        return [{ title: 'Collections by month', sub: span, headers: ['Month', 'Receipts', 'Collected'], right: [1, 2], rows: group(x => ymOf(x.p.date)).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, o]) => [ymName(k), o.n, money(o.amt)]), foot: ['Total', rec.length, total], empty: 'Nothing was collected in this period.' },
          { title: 'Collections by mode', sub: span, headers: ['Collected by', 'Receipts', 'Collected'], right: [1, 2], rows: group(x => x.p.mode || '-').sort((a, b) => b[1].amt - a[1].amt).map(([k, o]) => [k, o.n, money(o.amt)]), foot: ['Total', rec.length, total], empty: 'Nothing was collected in this period.' },
          { title: 'Receipts', sub: span, headers: ['Date', 'Receipt', 'No', L('tenant'), 'Let', 'Collected by', 'Reference', 'Amount'], right: [7], rows: rec.map(x => [x.p.date, x.p.receiptNo || '', x.t.no, x.t.tenant.name, this.place(x.t, st), x.p.mode, x.p.ref || '', money(x.p.amount)]), foot: ['', '', '', '', '', '', 'Total', total], empty: 'Nothing was collected in this period.', note: 'Deposits are not rent: they are under Deposits. A deposit set against dues at the end of a tenancy is not a collection either.' }];
      }
      if (rep === 'deposits') {
        const done = all.filter(t => t.refund && within(t.refund.date, P));
        return [{ title: 'Deposits held', sub: asOn, headers: ['No', L('tenant'), 'Let', 'Since', 'Agreed', 'Received', 'Received on', 'Received by', 'Still to come'], right: [4, 5, 8], rows: live.map(t => [t.no, t.tenant.name, this.place(t, st), t.from, money(t.deposit), money(t.depositPaid), t.depositDate || '', t.depositMode || '', money(Math.max(0, num(t.deposit) - num(t.depositPaid)))]),
          foot: ['', '', '', 'Total', money(sum(live, t => t.deposit)), money(sum(live, t => t.depositPaid)), '', '', money(sum(live, t => Math.max(0, num(t.deposit) - num(t.depositPaid))))], empty: 'No deposit is held.' },
          { title: 'Deposits settled', sub: span, headers: ['Moved out', 'No', L('tenant'), 'Let', 'Received', 'Set against dues', 'Refunded', 'Refunded by', 'Kept', 'Note'], right: [4, 5, 6, 8], rows: done.map(t => [t.refund.date, t.no, t.tenant.name, this.place(t, st), money(t.depositPaid), money(t.refund.adjusted), money(t.refund.refunded), t.refund.mode || '', money(t.refund.kept), t.refund.note || '']),
            foot: ['', '', '', 'Total', money(sum(done, t => t.depositPaid)), money(sum(done, t => t.refund.adjusted)), money(sum(done, t => t.refund.refunded)), '', money(sum(done, t => t.refund.kept)), ''], empty: 'No tenancy ended in this period.' }];
      }
      if (rep === 'register') {
        const list = all.slice().sort((a, b) => ms(a.from) - ms(b.from) || byNo(a.no, b.no));
        return [{ title: L('tenant', 1) + ' register', sub: asOn, headers: ['Sr', 'No', 'Name', 'Phone', 'Permanent address', 'Occupation / employer', 'Identity document', 'Document number', 'Emergency contact', 'Let', 'From', 'Till'].concat(this.cfHead('tenant', st)),
          rows: list.map((t, i) => [i + 1, t.no, t.tenant.name, t.tenant.phone, [t.tenant.address, U.stateName(t.tenant.state)].filter(Boolean).join(', '), t.tenant.occupation, t.tenant.idType, t.tenant.idNo, t.tenant.emergency, this.place(t, st), t.from, t.movedOut || (t.status === 'notice' ? 'on notice, leaves ' + t.vacateOn : 'staying')].concat(this.cfVals('tenant', t, st))), empty: 'No ' + low('tenant') + ' yet.',
          note: 'Everybody who has stayed, in the order they came, with the identity and address details a tenant verification by the police or a tenant register asks for.' }];
      }
      if (rep === 'moves') {
        const ins = all.filter(t => within(t.from, P)).sort((a, b) => ms(a.from) - ms(b.from)), outs = all.filter(t => t.movedOut && within(t.movedOut, P)).sort((a, b) => ms(a.movedOut) - ms(b.movedOut));
        const soon = live.map(t => ({ t, d: t.status === 'notice' && ms(t.vacateOn) ? t.vacateOn : t.to })).filter(x => ms(x.d) && ms(x.d) <= t0 + 30 * DAY).sort((a, b) => ms(a.d) - ms(b.d));
        return [{ title: 'Move-ins', sub: span, headers: ['Date', 'No', L('tenant'), 'Phone', 'Let', 'Rent', 'Deposit received'], right: [5, 6], rows: ins.map(t => [t.from, t.no, t.tenant.name, t.tenant.phone, this.place(t, st), money(t.rent), money(t.depositPaid)]), foot: ['', '', ins.length + ' moved in', '', '', money(sum(ins, t => t.rent)), money(sum(ins, t => t.depositPaid))], empty: 'Nobody moved in in this period.' },
          { title: 'Move-outs', sub: span, headers: ['Date', 'No', L('tenant'), 'Let', 'Stayed (days)', 'Rent', 'Deposit refunded', 'Still due'], right: [4, 5, 6, 7], rows: outs.map(t => [t.movedOut, t.no, t.tenant.name, this.place(t, st), Math.round((ms(t.movedOut) - ms(t.from)) / DAY) + 1, money(t.rent), money((t.refund || {}).refunded), money(this.ledger(t, st).balance)]), foot: ['', '', outs.length + ' moved out', '', '', money(sum(outs, t => t.rent)), money(sum(outs, t => (t.refund || {}).refunded)), money(sum(outs, t => this.ledger(t, st).balance))], empty: 'Nobody moved out in this period.' },
          { title: 'Leaving within 30 days', sub: asOn, headers: ['Date', 'No', L('tenant'), 'Phone', 'Let', 'Why', 'Rent'], right: [6], rows: soon.map(x => [x.d, x.t.no, x.t.tenant.name, x.t.tenant.phone, this.place(x.t, st), x.t.status === 'notice' ? 'On notice since ' + x.t.noticeOn : 'Agreed-to date', money(x.t.rent)]), empty: 'Nobody is on notice and no agreement ends in the next 30 days.' }];
      }
      const as = st.assets.map(a => ({ a, where: this.whereName(a.at, st, all) })).sort((x, y) => byNo(x.where, y.where) || byNo(x.a.name, y.a.name)), cats = new Map();
      as.forEach(x => { if (x.a.condition === 'disposed') return; const k = x.a.category || '-', o = cats.get(k) || { n: 0, v: 0, bad: 0 }; o.n += num(x.a.qty) || 1; o.v += num(x.a.value); if (x.a.condition !== 'good') o.bad += num(x.a.qty) || 1; cats.set(k, o); });
      return [{ title: 'Asset register by place', sub: asOn, headers: ['Where', 'Item', 'Category', 'Qty', 'Value', 'Condition', 'Notes'].concat(this.cfHead('asset', st)), right: [3, 4], rows: as.map(x => [x.where, x.a.name, x.a.category || '', num(x.a.qty) || 1, money(x.a.value), pick(COND, x.a.condition)[1], x.a.notes || ''].concat(this.cfVals('asset', x.a, st))), foot: ['Total', '', '', sum(as, x => num(x.a.qty) || 1), money(sum(as, x => x.a.value)), '', ''].concat(this.cfHead('asset', st).map(() => '')), empty: 'No ' + low('asset') + ' yet.' },
        { title: 'By category', sub: asOn, headers: ['Category', 'Pieces', 'Value', 'Not in good condition'], right: [1, 2, 3], rows: Array.from(cats.entries()).sort((a, b) => b[1].v - a[1].v).map(([k, o]) => [k, o.n, money(o.v), o.bad]), empty: 'No ' + low('asset') + ' yet.', note: 'What was disposed of is left out here.' }];
    },
    reportsTab(p, st, all) {
      const rep = REPS.some(r => r[0] === p.rep) ? p.rep : 'roll', P = period(p, rep === 'collections' ? 5 : 0), sections = this.reportSections(Object.assign({}, p, { rep }), all, st); shown = sections;
      const table = (s, i) => '<div class="section-title">' + esc(s.title) + (s.rows.length ? '<span class="tilehint"><button class="btn sm outline" data-xprint="' + i + '">Print</button> <button class="btn sm outline" data-xxls="' + i + '">Excel</button></span>' : '') + '</div>' + (s.note ? '<div class="hint" style="margin:-6px 0 8px">' + esc(s.note) + '</div>' : '') +
        (s.rows.length ? '<div class="tablewrap"><table class="list"><thead><tr>' + s.headers.map((h, j) => '<th' + ((s.right || []).includes(j) ? ' class="num"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + s.rows.concat(s.foot ? [s.foot] : []).map((r, n) => '<tr' + (s.foot && n === s.rows.length ? ' style="font-weight:700"' : '') + '>' + r.map((v, j) => '<td' + ((s.right || []).includes(j) ? ' class="num"' : '') + '>' + esc(v == null || v === '' ? '-' : String(v)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '<div class="empty">' + esc(s.empty || 'Nothing to show here.') + '</div>');
      const html = '<div class="btnrow" style="margin-bottom:10px">' + REPS.map(r => '<button class="btn sm ' + (r[0] === rep ? '' : 'outline') + '" data-xrep="' + r[0] + '">' + esc(r[0] === 'register' ? L('tenant', 1) + ' register' : r[1]) + '</button>').join('') + '</div>' +
        (PERIODIC.includes(rep) ? '<div class="btnrow" style="align-items:center">' + UI.dateInput('xrFrom', P.from, { attrs: DSM }) + '<span>to</span>' + UI.dateInput('xrTo', P.to, { attrs: DSM }) + '</div>' : '') + sections.map(table).join('');
      return { html, wire: (root) => {
        const rowsOf = (s) => s.rows.concat(s.foot ? [s.foot] : []);
        $$('[data-xrep]', root).forEach(b => { b.onclick = () => App.go('rental', { tab: 'reports', rep: b.dataset.xrep }); });
        const go = () => App.go('rental', { tab: 'reports', rep, from: UI.dateVal('xrFrom') || '', to: UI.dateVal('xrTo') || '' });
        ['#xrFrom', '#xrTo'].forEach(id => { if ($(id, root)) $(id, root).onchange = go; });
        $$('[data-xprint]', root).forEach(b => { b.onclick = () => { const s = shown[+b.dataset.xprint]; if (s) UI.pdf(String(s.title).toUpperCase(), s.sub || '', s.headers, rowsOf(s), { right: s.right || [], bold: s.foot ? [s.rows.length] : [] }); }; });
        $$('[data-xxls]', root).forEach(b => { b.onclick = () => { const s = shown[+b.dataset.xxls]; if (s) UI.xls(String(s.title).replace(/[^A-Za-z0-9]+/g, '_'), s.headers, rowsOf(s)); }; });
      } };
    },

    // ------------------------------------------------------------ the settings: one form, here and under the portal's Settings
    settingsPanel() {
      const st = this.settings(), w = this.mayMasters(), io = this.intl();
      const card = (title, inner, hint) => '<div class="card white" style="margin-bottom:12px"><div class="hd">' + esc(title) + '</div><div class="bd">' + (hint ? '<div class="hint" style="margin:0 0 10px">' + esc(hint) + '</div>' : '') + inner + '</div></div>';
      const n = (id, v, attrs) => UI.input(id, v, { type: 'number', attrs: attrs || ' min="0" step="any"' });
      const area = (id, list, rows) => '<textarea id="' + id + '" rows="' + (rows || 5) + '">' + esc(list.join('\n')) + '</textarea>';
      const frow = (f) => '<div class="rnfld" data-id="' + esc(f.id) + '" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px"><input class="fl" value="' + esc(f.label) + '" placeholder="Name of the field" style="flex:2;min-width:150px">' +
        '<select class="ft" style="flex:1;min-width:130px">' + FTYPES.map(x => '<option value="' + x[0] + '"' + (x[0] === f.type ? ' selected' : '') + '>' + esc(x[1]) + '</option>').join('') + '</select><input class="fo" value="' + esc((f.options || []).join(', ')) + '" placeholder="The choices, separated by commas" style="flex:2;min-width:170px">' +
        '<label class="small" style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap"><input type="checkbox" class="fr"' + (f.req ? ' checked' : '') + ' style="width:18px;height:18px"> Required</label>' + UI.ibtn('trash', 'Remove the field', 'data-delf="1"', 'danger') + '</div>';
      const html = '<div id="rnSettings">' +
        card('Words', KINDS.map(k => '<div class="grid2" style="margin-bottom:6px">' + UI.field(WHAT[k] + ' is called', UI.input('rsL_' + k + '_0', st.labels[k][0], { placeholder: LABELS[k][0] })) + UI.field('Several of them', UI.input('rsL_' + k + '_1', st.labels[k][1], { placeholder: LABELS[k][1] })) + '</div>').join(''), 'Your own words go on the tabs, the lists, the dialogs and the reports: a Building may be a Property or a Block, a Room a Flat, a Shop or a Unit, a Tenant a Resident or a Guest.') +
        card('What is let', '<div class="grid2">' + UI.field('You let', UI.select('rsLet', LETBY, st.letBy), { hint: 'A room let by the bed has its beds listed under it, each with its own rent and tenant' }) + UI.field('Tenancy number starts with', UI.input('rsPre', st.prefix), { hint: 'Tenancies are numbered ' + (st.prefix || 'RNT') + '-0001, receipts ' + (st.prefix || 'RNT') + '-R0001' }) + '</div>') +
        card('Rent', '<div class="grid3">' + UI.field('Rent falls due on day', n('rsDue', st.dueDay, ' min="1" max="28" step="1"'), { hint: 'Of each month; a tenancy can have its own' }) + UI.field('Deposit: months of rent', n('rsDepM', st.depositMonths), { hint: 'Proposed on a new ' + low('unit') + ' and tenancy' }) + UI.field('Notice period (days)', n('rsNotice', st.noticeDays, ' min="0" step="1"')) +
          UI.field('Late fee', UI.select('rsLateK', [['none', 'None'], ['flat', 'A flat amount'], ['pct', 'A % of the balance a month']], st.late.kind)) + '<div class="field" id="rsLateAmtF"><label>Late fee amount</label>' + n('rsLateAmt', st.late.amount) + '</div><div class="field" id="rsLatePctF"><label>Late fee % a month</label>' + n('rsLatePct', st.late.pct, ' min="0" max="100" step="any"') + '</div>' + '<div class="field" id="rsGraceF"><label>Days of grace after the due day</label>' + n('rsGrace', st.late.grace, ' min="0" step="1"') + '</div>' +
          '<div class="field span">' + UI.check('rsPro', 'Rent by the day for the month a tenancy begins or ends in (pro-rata)', st.proRata !== false) + '</div></div>') +
        card('Tax on rent', io ? '<div class="grid2">' + UI.field(io.tax + ' on rent %', n('rsRate', io.rate, ' min="0" max="100" step="any"'), { hint: 'One rate on every rent; a tenancy can carry a rate of its own, a charge the rate of its head' }) + '</div>'
          : '<div class="grid2">' + UI.field('Residential: GST %', n('rsResRate', st.tax.resRate, ' min="0" max="100" step="any"')) + UI.field('Residential: SAC', UI.input('rsResSac', st.tax.resSac)) + UI.field('Commercial: GST %', n('rsComRate', st.tax.comRate, ' min="0" max="100" step="any"')) + UI.field('Commercial: SAC', UI.input('rsComSac', st.tax.comSac)) + '</div>' +
            '<div class="hint">Renting a residential dwelling for use as a residence is exempt (nil rate, SAC 997211); renting commercial or other non-residential property is 18% (SAC 997212). Each kind of ' + esc(low('unit')) + ' below says which of the two it is, and a tenancy can carry a rate of its own.' + (this.taxed() ? '' : ' <b>The Company Profile has no GSTIN: no GST is added to rent or charges until it has one.</b>') + '</div>') +
        card('Lists', '<div class="grid2">' + UI.field('Kinds of ' + low('unit'), area('rsKinds', st.kinds.map(k => k.name + ': ' + (k.use === 'com' ? 'commercial' : 'residential')), 7), { hint: 'One a line, "Name: residential" or "Name: commercial"' }) + UI.field('Charges besides rent', area('rsHeads', st.heads.map(h => h.name + (h.gst !== '' && h.gst != null ? ': ' + h.gst + '%' + (h.sac ? ' SAC ' + h.sac : '') : '')), 7), { hint: 'One a line. "Electricity: 0%" or "Maintenance: 18% SAC 997212" gives a charge its own tax rate and SAC; a name alone takes the rate of the rent it is billed with' }) +
          UI.field('Categories of ' + low('asset', 1), area('rsCats', st.assetCats)) + UI.field('Identity documents asked', area('rsIds', st.ids)) + UI.field('Payment modes', area('rsModes', st.modes)) + '</div>') +
        card('Fields of your own', KINDS.map(k => '<div data-ent="' + k + '" style="margin-bottom:14px"><div class="small" style="font-weight:700;margin-bottom:6px;color:var(--label)">On a ' + esc(low(k)) + '</div><div class="rnflds">' + st.fields[k].map(frow).join('') + '</div>' + (w ? '<button class="btn sm outline" data-addf="' + k + '">+ Field</button>' : st.fields[k].length ? '' : '<span class="small muted">None</span>') + '</div>').join(''),
          'A field added here shows in the add and edit dialog, in the list and in the exports of that record: the wing of a building, the meter number of a room, the college or the vehicle of a tenant, the serial number of an asset. A field removed keeps its data in the records.') +
        (w ? '<div class="btnrow"><button class="btn green" id="rsSave">Save rental settings</button></div>' : '<div class="hint">Only the owner, an admin or an accountant changes these.</div>') + '</div>';
      return { html, wire: (root, again) => {
        const box = $('#rnSettings', root || document); if (!box) return;
        const late = () => { const k = UI.val('rsLateK'); $('#rsLateAmtF', box).style.display = k === 'flat' ? '' : 'none'; $('#rsLatePctF', box).style.display = k === 'pct' ? '' : 'none'; $('#rsGraceF', box).style.display = k === 'none' ? 'none' : ''; };
        const opt = (r) => { $('.fo', r).style.display = $('.ft', r).value === 'choice' ? '' : 'none'; };
        const wireRow = (r) => { $('.ft', r).onchange = () => opt(r); $('[data-delf]', r).onclick = () => r.remove(); opt(r); };
        $$('.rnfld', box).forEach(wireRow); $('#rsLateK', box).onchange = late; late();
        if (!w) { $$('input, select, textarea', box).forEach(e => { e.disabled = true; }); $$('[data-delf]', box).forEach(b => b.remove()); return; }
        $$('[data-addf]', box).forEach(b => { b.onclick = () => { const holder = $('.rnflds', b.parentNode); holder.insertAdjacentHTML('beforeend', frow({ id: 'f' + U.uid(), label: '', type: 'text', options: [], req: false })); wireRow(holder.lastElementChild); $('.fl', holder.lastElementChild).focus(); }; });
        $('#rsSave', box).onclick = () => {
          const cur = this.settings(), due = Math.round(num(UI.val('rsDue'))); if (due < 1 || due > 28) { UI.mark('rsDue', true, box); UI.toast('The due day is between 1 and 28'); return; }
          const labels = {}; KINDS.forEach(k => { const one = String(UI.val('rsL_' + k + '_0')).trim() || LABELS[k][0], many = String(UI.val('rsL_' + k + '_1')).trim(); labels[k] = [one, many && (many !== cur.labels[k][1] || one === cur.labels[k][0]) ? many : one === LABELS[k][0] ? LABELS[k][1] : one === cur.labels[k][0] ? cur.labels[k][1] : one + 's']; });
          const kinds = linesOf(UI.val('rsKinds')).map(x => { const m = /^(.+?)\s*:\s*(.*)$/.exec(x); return { name: (m ? m[1] : x).trim(), use: m && /com|shop|office|non/i.test(m[2]) ? 'com' : 'res' }; }).filter(k => k.name);
          const heads = linesOf(UI.val('rsHeads')).map(x => { const m = /^(.+?)\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*%?\s*(?:SAC|HSN)?\s*([0-9]{4,8})?\s*$/i.exec(x); return m ? { name: m[1].trim(), gst: String(num(m[2])), sac: m[3] || '' } : { name: x.replace(/\s*:.*$/, '').trim(), gst: '', sac: '' }; }).filter(h => h.name);
          if (!kinds.length) { UI.mark('rsKinds', true, box); UI.toast('Name at least one kind of ' + low('unit')); return; }
          const fields = {}; let dup = '';
          KINDS.forEach(k => { fields[k] = $$('.rnfld', $('[data-ent="' + k + '"]', box)).map(r => ({ id: r.dataset.id, label: $('.fl', r).value.trim(), type: $('.ft', r).value, options: $('.ft', r).value === 'choice' ? $('.fo', r).value.split(',').map(x => x.trim()).filter(Boolean) : [], req: $('.fr', r).checked })).filter(f => f.label);
            fields[k].forEach((f, i) => { if (fields[k].findIndex(x => x.label.toLowerCase() === f.label.toLowerCase()) !== i) dup = f.label; if (f.type === 'choice' && !f.options.length) dup = dup || f.label + ' (it has no choices)'; }); });
          if (dup) { UI.toast('Check the field ' + dup, 5000); return; }
          Object.assign(cur, { labels, letBy: UI.val('rsLet'), prefix: String(UI.val('rsPre')).trim().toUpperCase().replace(/[^A-Z0-9/]/g, '') || 'RNT', dueDay: due, depositMonths: Math.max(0, num(UI.val('rsDepM'))), noticeDays: Math.max(0, Math.round(num(UI.val('rsNotice')))), proRata: !!UI.val('rsPro'),
            late: { kind: UI.val('rsLateK'), amount: Math.max(0, num(UI.val('rsLateAmt'))), pct: Math.max(0, Math.min(100, num(UI.val('rsLatePct')))), grace: Math.max(0, Math.round(num(UI.val('rsGrace')))) },
            kinds, heads: heads.length ? heads : HEADS, assetCats: linesOf(UI.val('rsCats')), ids: linesOf(UI.val('rsIds')), modes: linesOf(UI.val('rsModes')), fields });
          if (io) cur.intl = Object.assign({}, cur.intl || {}, { [io.code]: { rate: Math.max(0, Math.min(100, num(UI.val('rsRate')))) } });
          else cur.tax = { resRate: String(num(UI.val('rsResRate'))), resSac: String(UI.val('rsResSac')).trim(), comRate: String(num(UI.val('rsComRate'))), comSac: String(UI.val('rsComSac')).trim() };
          if (this.saveSettings(cur) === false) return; UI.toast('Rental settings saved', 2500, 'ok'); if (again) again();
        };
      } };
    },

    // ------------------------------------------------------------ the rent invoice (invoice.js, route invoice?fromRent=<id>&month=YYYY-MM)
    invoiceFor(id, month, inv) {
      const t = this.find(id); if (!t) return null;
      const st = this.settings(), ym = isYm(month) ? month : ymOf(U.today()); if (!t.months[ym]) t.months[ym] = this.newMonth(t, ym, st);
      const row = this.ledger(t, st).rows.find(r => r.ym === ym), g = t.tenant, where = this.place(t, st);
      // The place of supply of immovable property is where it is: the tax of the landlord's own state whatever the tenant's (IGST Act s.12(3))
      const own = inv.buyer.state;
      inv.buyer = { name: g.name + (g.address ? '\n' + g.address : '') + (g.state && g.state !== own ? '\n' + U.stateName(g.state) : ''), phone: g.phone || '', email: g.email || '', gstin: g.gstin || '', state: own };
      inv.sameShip = true; inv.consignee = copy(inv.buyer);
      inv.items = row.lines.map((l, n) => ({ sl: n + 1, desc: l.desc, hsn: this.intl() ? '' : l.sac || '', gst: String(l.gst), inc: false, qty: 1, uqc: 'OTH', rate: l.amount, taxable: 0, totalIncl: 0, subSerial: '', subDesc: l.detail || '', subInfo: '' }));
      inv.other = Object.assign({}, inv.other, { reference: 'Tenancy ' + t.no, info: where + ', ' + ymName(ym) + (num(t.months[ym].days) < num(t.months[ym].of) ? ' (' + t.months[ym].days + ' of ' + t.months[ym].of + ' days)' : '') });
      const last = t.payments.filter(p => !p.adj).slice(-1)[0], mode = last ? (/cash/i.test(last.mode) ? 'Cash' : /cheque/i.test(last.mode) ? 'Cheque' : 'Online') : 'Cash';
      inv.payment = row.balance > 0.5 ? 'Credit' : mode;
      inv.rentalTenancy = t.id; inv.rentalMonth = ym;
      return inv;
    },
    // A saved invoice that was made for a month of a tenancy: the month names it
    invoiced(inv) {
      const t = this.find(inv.rentalTenancy), ym = inv.rentalMonth; if (!t || !isYm(ym)) return;
      if (!t.months[ym]) t.months[ym] = this.newMonth(t, ym);
      if (t.months[ym].invoiceNo === inv.no) return; t.months[ym].invoiceNo = inv.no; Store.update('tenancies', t);
    }
  };

  App.routes.rental = (p) => { p = p || {}; if (!p.tab) p.tab = 'overview'; Rental.screen(p); App.markNav('rental', { tab: p.tab }); };
  global.Rental = Rental;
})(window);
