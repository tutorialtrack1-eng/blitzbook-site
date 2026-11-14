/* BlitzBook web portal - the reports of the Manpower tab and of the Hotel tab. Loaded after manpower.js and hotel.js:
   it gives Manpower its Reports tab and puts further reports beside the occupancy report of Hotel. Every report is
   one or more tables, each with Print (a PDF through the print page) and Excel; the ones over a period take two
   dates, the month to date unless given.

   Manpower > Attendance: the month as a grid, a line a member and a column a day; a click on a day goes through
   present, absent, half day, weekly off, holiday, leave. The heading of a day marks everybody deployed present, and
   Sundays off marks the weekly offs. Kept on the member as att['YYYY-MM'], a letter a day. Reports: the attendance
   summary over any period and the muster roll of a month (Form XVI).

   Manpower > Days Worked: the sheet of a month, a line a member: the days (or hours, or months, as the member's rate
   goes) worked, the overtime hours and what an overtime hour pays, and the advance or deductions. It is kept on the
   member (work['YYYY-MM']) with the pay rate, the bill rate and the client of that month, so a later change of rate
   or site does not rewrite the months gone by. "Fill from attendance" proposes the days from the attendance, or from the deployment dates where none is marked.

   Manpower > Reports
     Wage register       member by member and month by month: worked, rate, wages, overtime, gross, advance, net
                         payable (the columns of a register of wages, Form XVII of the Contract Labour Central Rules)
     Days worked         each member over the period: days worked against days deployed, pay, billing value, margin
     Man-days by client  client and site: people, man-days, overtime, pay cost, billing value, margin
     Month by month      people who worked, man-days, pay, billing value and margin of each month
     Strength            how many people by status, engagement, skill category, gender and trade
     Clients & billing   client and site by site: the head count and what a month bills, costs and leaves
     Margin by member    the pay rate against the bill rate of each member, and the ones billed below their pay
     Bench               who is available, since when and what their idle days would bill
     Movements           who joined, was deployed and was released in the period (from the deployment history)
     Billed              what the invoices' staff sheets billed in the period, member by member and client by client
   A month is estimated at 26 days of 8 hours for the rates per day and per hour (MONTH_DAYS, DAY_HOURS): an
   estimate from the roster's rates, said so on the report; "Billed" is the actual figure from the invoices.

   Hotel > Reports
     Occupancy           occupancy %, ADR and RevPAR (hotel.js, as before)
     Daily report        one date: the night's figures, arrivals, departures, the guests in house, the day's collections
                         (the manager's / night audit report of a PMS)
     Revenue             room revenue and every other charge head with its GST, and the GST rate by rate
     Collections         the payments taken: by mode, and each receipt
     Outstanding         folios with a balance due, advances held for stays to come, checked out but not invoiced
     Guests              the arrivals by nationality, state, purpose, meal plan and source; the guests who came back
     Cancellations       cancelled reservations and no-shows with the room revenue they would have brought
   Room revenue is before GST and by the night, as in the occupancy report; a charge counts on its own date. */
(function (global) {
  'use strict';
  const { esc, num, money } = U;
  const DAY = 86400000, MONTH_DAYS = 26, DAY_HOURS = 8;
  const ms = (d) => U.dateMs(d);
  const r2 = (v) => U.round2(v);
  const pct = (v) => (Math.round(v * 10) / 10).toFixed(1) + '%';
  const sum = (a, f) => a.reduce((t, x) => t + num(f(x)), 0);
  const lower = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const monthStart = () => { const d = new Date(); return U.dmy(new Date(d.getFullYear(), d.getMonth(), 1)); };
  const period = (p) => { const from = ms(p.from) ? p.from : monthStart(), to = ms(p.to) && ms(p.to) >= ms(from) ? p.to : (ms(U.today()) >= ms(from) ? U.today() : from); return { from, to, a: ms(from), b: ms(to) + DAY }; };
  const within = (d, P) => { const t = ms(d); return !!t && t >= P.a && t < P.b; };
  const tally = (list, keyOf, add) => { const m = new Map(); list.forEach(x => { const name = String(keyOf(x) || '').trim() || 'Not set', k = lower(name), o = m.get(k) || { name, n: 0 }; o.n++; if (add) add(o, x); m.set(k, o); }); return Array.from(m.values()).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)); };

  // ------------------------------------------------------------ what both screens share
  let shown = [];   // the tables of the report on the screen, for their Print and Excel buttons
  /* A table of a report: { title, sub, headers, rows, right: [columns set to the right], foot: a totals row, note,
     empty }. The cells are plain text. */
  const tableHtml = (s, i) => '<div class="section-title">' + esc(s.title) + (s.rows.length ? '<span class="tilehint"><button class="btn sm outline" data-xprint="' + i + '">Print</button> <button class="btn sm outline" data-xxls="' + i + '">Excel</button></span>' : '') + '</div>' +
    (s.note ? '<div class="hint" style="margin:-6px 0 8px">' + esc(s.note) + '</div>' : '') +
    (s.rows.length ? '<div class="tablewrap"><table class="list"><thead><tr>' + s.headers.map((h, j) => '<th' + ((s.right || []).includes(j) ? ' class="num"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
      s.rows.concat(s.foot ? [s.foot] : []).map((r, n) => '<tr' + (s.foot && n === s.rows.length ? ' style="font-weight:700"' : '') + '>' + r.map((v, j) => '<td' + ((s.right || []).includes(j) ? ' class="num"' : '') + '>' + esc(v == null || v === '' ? '-' : String(v)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'
      : '<div class="empty">' + esc(s.empty || 'Nothing to show here.') + '</div>');
  const render = (sections) => { shown = sections; return sections.map(tableHtml).join(''); };
  const wireTables = (root) => {
    const rowsOf = (s) => s.rows.concat(s.foot ? [s.foot] : []);
    $$('[data-xprint]', root).forEach(b => b.onclick = () => { const s = shown[+b.dataset.xprint]; if (s) UI.pdf(String(s.title).toUpperCase(), s.sub || '', s.headers, rowsOf(s), { right: s.right || [] }); });
    $$('[data-xxls]', root).forEach(b => b.onclick = () => { const s = shown[+b.dataset.xxls]; if (s) UI.xls(String(s.title).replace(/[^A-Za-z0-9]+/g, '_'), s.headers, rowsOf(s)); });
  };
  // The row of reports to choose from, and the dates of a report over a period (or the one date of a daily report)
  const chooser = (reps, rep) => '<div class="btnrow" style="margin-bottom:10px">' + reps.map(r => '<button class="btn sm ' + (r[0] === rep ? '' : 'outline') + '" data-xrep="' + r[0] + '">' + esc(r[1]) + '</button>').join('') + '</div>';
  const dates = (P, one) => '<div class="btnrow" style="align-items:center">' + UI.dateInput('xrFrom', P.from, { attrs: ' style="width:auto;min-height:34px"' }) + (one ? '' : '<span>to</span>' + UI.dateInput('xrTo', P.to, { attrs: ' style="width:auto;min-height:34px"' })) + '</div>';
  const wireNav = (root, route, rep) => {
    $$('[data-xrep]', root).forEach(b => b.onclick = () => App.go(route, { tab: 'reports', rep: b.dataset.xrep }));
    const go = () => App.go(route, { tab: 'reports', rep, from: UI.dateVal('xrFrom') || '', to: $('#xrTo', root) ? UI.dateVal('xrTo') || '' : '' });
    ['#xrFrom', '#xrTo'].forEach(id => { if ($(id, root)) $(id, root).onchange = go; });
    wireTables(root);
  };

  // ------------------------------------------------------------ Manpower
  if (global.Manpower) {
    const MREPS = [['attsum', 'Attendance'], ['muster', 'Muster roll'], ['wages', 'Wage register'], ['days', 'Days worked'], ['clientdays', 'Man-days by client'], ['trend', 'Month by month'], ['strength', 'Strength'], ['clients', 'Clients & billing'], ['margin', 'Margin by member'], ['bench', 'Bench'], ['moves', 'Movements'], ['billed', 'Billed']];
    const STATUS = Manpower.STATUS, statusOf = Manpower.statusOf, skillsOf = Manpower.skillsOf;
    const statusName = (k) => (STATUS.find(s => s[0] === k) || STATUS[0])[1];
    const per = (m) => m.unit === 'HRS' ? 'hour' : m.unit === 'MON' ? 'month' : 'day';
    const monthly = (m, rate) => num(rate) * (m.unit === 'MON' ? 1 : m.unit === 'HRS' ? MONTH_DAYS * DAY_HOURS : MONTH_DAYS);
    const EST = 'A month is estimated from the rates on the roster: ' + MONTH_DAYS + ' days for a rate per day, ' + (MONTH_DAYS * DAY_HOURS) + ' hours for a rate per hour, before overtime and before the employer PF / ESI the agency bears. What was actually billed is under Billed.';
    const where = (m) => [m.deploy.client, m.deploy.site].filter(Boolean).join(' · ');
    const PERIODIC = ['attsum', 'muster', 'wages', 'days', 'clientdays', 'trend', 'moves', 'billed'];
    // ---- the days worked: work['YYYY-MM'] = { qty, ot, otPay, adv, pay, bill, otBill, unit, client, site } on the member
    const ymOf = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
    const ymName = (ym) => { const [y, mo] = ym.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mo - 1] + ' ' + y; };
    const ymSpan = (ym) => { const [y, mo] = ym.split('-').map(Number); return { a: new Date(y, mo - 1, 1).getTime(), b: new Date(y, mo, 1).getTime() }; };
    const monthsOf = (P) => { const out = [], d = new Date(P.a); d.setDate(1); while (d.getTime() < P.b) { out.push(ymOf(d.getTime())); d.setMonth(d.getMonth() + 1); } return out; };
    const unitShort = (u) => u === 'HRS' ? 'h' : u === 'MON' ? 'mo' : 'd';
    const unitKey = (u) => u === 'HRS' || u === 'MON' ? u : 'DAY';
    const entryOf = (m, ym) => { const e = m.work && m.work[ym]; return e && (num(e.qty) || num(e.ot) || num(e.adv)) ? e : null; };
    const calc = (e) => { const wages = r2(num(e.qty) * num(e.pay)), otAmt = r2(num(e.ot) * num(e.otPay)), gross = r2(wages + otAmt), billv = r2(num(e.qty) * num(e.bill) + num(e.ot) * num(e.otBill)); return { wages, otAmt, gross, net: r2(gross - num(e.adv)), billv, margin: r2(billv - gross) }; };
    const entries = (every, P) => { const out = []; monthsOf(P).forEach(ym => every.forEach(m => { const e = entryOf(m, ym); if (e) out.push({ m, ym, e, c: calc(e) }); })); return out; };
    // Calendar days a member was on a site between two moments (not past today), from the deployment now and the history
    const dayNo = (t) => { const d = new Date(t); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); };
    const deployedDays = (m, a, b) => {
      const last = dayNo(ms(U.today())), lo = dayNo(a), hi = Math.min(dayNo(b) - 1, last), days = new Set();
      const spans = (m.history || []).map(h => [ms(h.from), ms(h.to)]);
      if (statusOf(m) === 'deployed' && ms(m.deploy.from)) spans.push([ms(m.deploy.from), ms(m.deploy.till) || ms(U.today())]);
      spans.forEach(([f, t]) => { if (!f || !t) return; for (let x = Math.max(dayNo(f), lo); x <= Math.min(dayNo(t), hi); x++) days.add(x); });
      return days.size;
    };
    const qtyText = (o) => [o.DAY ? U.fmtQty(o.DAY) + ' d' : '', o.HRS ? U.fmtQty(o.HRS) + ' h' : '', o.MON ? U.fmtQty(o.MON) + ' mo' : ''].filter(Boolean).join(', ') || '-';
    // ---- attendance: att['YYYY-MM'] on the member is a letter a day of the month ('-' not marked)
    const MARKS = [['P', 'P', 'Present', '#16A34A'], ['A', 'A', 'Absent', '#DC2626'], ['D', 'HD', 'Half day', '#D97706'], ['W', 'WO', 'Weekly off', '#64748B'], ['O', 'H', 'Holiday', '#2563EB'], ['L', 'L', 'Leave', '#7C3AED']];
    const markOf = (c) => MARKS.find(x => x[0] === c) || null;
    const daysIn = (ym) => { const [y, mo] = ym.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
    const marksOf = (m, ym) => { const s = String((m.att && m.att[ym]) || ''), n = daysIn(ym); return Array.from({ length: n }, (_, i) => (markOf(s[i]) ? s[i] : '-')).join(''); };
    const hasAtt = (m, ym) => /[^-]/.test(marksOf(m, ym));
    /* What the marks of a month add up to, between two moments when given: present, half days, absent, weekly offs,
       holidays, leave; worked = present + half a day for each half day; paid = worked + weekly offs, holidays and leave */
    const attCount = (marks, ym, a, b) => { const [y, mo] = ym.split('-').map(Number), o = { P: 0, A: 0, D: 0, W: 0, O: 0, L: 0 };
      for (let i = 0; i < marks.length; i++) { const t = new Date(y, mo - 1, i + 1).getTime(); if ((a != null && t < a) || (b != null && t >= b)) continue; if (o[marks[i]] != null) o[marks[i]]++; }
      o.worked = o.P + o.D / 2; o.paid = o.worked + o.W + o.O + o.L; o.marked = o.P + o.A + o.D + o.W + o.O + o.L; return o; };
    const cellStyle = (c) => { const k = markOf(c); return 'text-align:center;padding:2px;cursor:pointer;font-size:12px;font-weight:700;min-width:28px;user-select:none;' + (k ? 'color:#fff;background:' + k[3] : 'color:var(--label)'); };
    const NOSHEET = 'Nothing is entered under Days Worked for this period. Enter the days of each month there: these reports are made from that sheet.';

    Object.assign(Manpower, {
      reportSections(p, every) {
        const rep = MREPS.some(r => r[0] === p.rep) ? p.rep : 'wages', act = every.filter(m => statusOf(m) !== 'inactive'), asOn = 'As on ' + U.today(), P = period(p), span = P.from + ' to ' + P.to;
        if (rep === 'muster') {
          const ym = ymOf(P.a), n = daysIn(ym), l = every.filter(m => hasAtt(m, ym));
          const dcols = Array.from({ length: n }, (_, i) => String(i + 1));
          return [{ title: 'Muster roll', sub: ymName(ym) + ' · ' + l.length + ' member' + (l.length === 1 ? '' : 's') + ' · ' + MARKS.map(k => k[1] + ' ' + k[2].toLowerCase()).join(', '), headers: ['Code', 'Name', 'Designation'].concat(dcols, ['P', 'HD', 'A', 'WO', 'H', 'L', 'Days worked']), right: [n + 3, n + 4, n + 5, n + 6, n + 7, n + 8, n + 9],
            note: 'The attendance of ' + ymName(ym) + ' (the month of the first date), a column a day: the muster roll a contractor keeps (Form XVI, Contract Labour Central Rules). Days worked counts a half day as half.',
            rows: l.map(m => { const s = marksOf(m, ym), c = attCount(s, ym); return [m.code, m.name, m.trade].concat(s.split('').map(x => (markOf(x) || ['', ' '])[1]), [c.P, c.D, c.A, c.W, c.O, c.L, U.fmtQty(c.worked)]); }), empty: 'No attendance is marked for ' + ymName(ym) + '. Mark it under Attendance.' }];
        }
        if (rep === 'attsum') {
          const l = []; every.forEach(m => { const t = { P: 0, A: 0, D: 0, W: 0, O: 0, L: 0, worked: 0, paid: 0, marked: 0 }; monthsOf(P).forEach(ym => { if (!hasAtt(m, ym)) return; const c = attCount(marksOf(m, ym), ym, P.a, P.b); Object.keys(t).forEach(k => { t[k] += c[k]; }); }); if (t.marked) l.push({ m, t }); });
          const tot = (k) => sum(l, x => x.t[k]), due = (t) => t.P + t.D + t.A;
          return [{ title: 'Attendance summary', sub: span + ' · ' + l.length + ' member' + (l.length === 1 ? '' : 's'), headers: ['Code', 'Name', 'Designation', 'Deployed at', 'Present', 'Half days', 'Absent', 'Weekly offs', 'Holidays', 'Leave', 'Days worked', 'Paid days', 'Attendance %'], right: [4, 5, 6, 7, 8, 9, 10, 11, 12],
            note: 'From the attendance marked day by day. Days worked = present + half of the half days; paid days add the weekly offs, holidays and leave; attendance % is the days worked of the working days (present, half and absent).',
            rows: l.map(({ m, t }) => [m.code, m.name, m.trade, where(m), t.P, t.D, t.A, t.W, t.O, t.L, U.fmtQty(t.worked), U.fmtQty(t.paid), due(t) ? pct(t.worked / due(t) * 100) : '-']),
            foot: l.length ? ['Total', '', '', '', tot('P'), tot('D'), tot('A'), tot('W'), tot('O'), tot('L'), U.fmtQty(tot('worked')), U.fmtQty(tot('paid')), sum(l, x => due(x.t)) ? pct(tot('worked') / sum(l, x => due(x.t)) * 100) : '-'] : null, empty: 'No attendance is marked in this period. Mark it under Attendance.' }];
        }
        if (['wages', 'days', 'clientdays', 'trend'].includes(rep)) {
          const es = entries(every, P), T = (f) => money(r2(sum(es, f))), months = monthsOf(P);
          if (rep === 'wages') {
            const missing = months.length === 1 ? act.filter(m => statusOf(m) === 'deployed' && !entryOf(m, months[0])).length : 0;
            return [{ title: 'Wage register', sub: span + ' · ' + es.length + ' line' + (es.length === 1 ? '' : 's'), headers: ['Month', 'Code', 'Name', 'Designation', 'Client', 'Worked', 'Rate', 'Wages', 'Overtime hours', 'Overtime pay', 'Gross', 'Advance / deductions', 'Net payable'], right: [5, 6, 7, 8, 9, 10, 11, 12],
              note: 'From the Days Worked sheets, at the pay rate of each month.' + (missing ? ' ' + missing + ' deployed member' + (missing === 1 ? ' has' : 's have') + ' no days entered for ' + ymName(months[0]) + '.' : ''),
              rows: es.map(({ m, ym, e, c }) => [ymName(ym), m.code, m.name, m.trade, [e.client, e.site].filter(Boolean).join(' · '), U.fmtQty(num(e.qty)) + ' ' + unitShort(e.unit), money(num(e.pay)), money(c.wages), num(e.ot) ? U.fmtQty(num(e.ot)) : '-', money(c.otAmt), money(c.gross), money(num(e.adv)), money(c.net)]),
              foot: es.length ? ['Total', '', '', '', '', '', '', T(x => x.c.wages), U.fmtQty(sum(es, x => x.e.ot)), T(x => x.c.otAmt), T(x => x.c.gross), T(x => x.e.adv), T(x => x.c.net)] : null, empty: NOSHEET }];
          }
          const zero = () => ({ who: new Set(), months: 0, DAY: 0, HRS: 0, MON: 0, ot: 0, gross: 0, adv: 0, net: 0, billv: 0 });
          const put = (o, x) => { o.who.add(x.m.id); o.months++; o[unitKey(x.e.unit)] += num(x.e.qty); o.ot += num(x.e.ot); o.gross += x.c.gross; o.adv += num(x.e.adv); o.net += x.c.net; o.billv += x.c.billv; return o; };
          const all = es.reduce(put, zero());
          if (rep === 'days') {
            const by = new Map(); es.forEach(x => by.set(x.m.id, put(by.get(x.m.id) || Object.assign(zero(), { m: x.m }), x)));
            // Deployed in the period with nothing entered: shown with the days by the dates, so nobody is missed
            act.forEach(m => { if (!by.has(m.id) && deployedDays(m, P.a, P.b)) by.set(m.id, Object.assign(zero(), { m })); });
            const l = Array.from(by.values()).map(o => Object.assign(o, { dep: deployedDays(o.m, P.a, P.b) })).sort((a, b) => String(a.m.code).localeCompare(String(b.m.code), undefined, { numeric: true }));
            return [{ title: 'Days worked', sub: span + ' · ' + l.length + ' member' + (l.length === 1 ? '' : 's'), headers: ['Code', 'Name', 'Trade', 'Months entered', 'Worked', 'Days deployed (by the dates)', 'Overtime hours', 'Gross pay', 'Advance / deductions', 'Net payable', 'Billing value', 'Margin'], right: [3, 4, 5, 6, 7, 8, 9, 10, 11],
              note: 'Worked, pay and billing value are from the Days Worked sheets (the days at the pay rate and at the bill rate of the month, overtime included). Days deployed counts the calendar days on a site by the deployment dates, weekly offs and holidays included: a member with days deployed and nothing worked has not been entered.',
              rows: l.map(o => [o.m.code, o.m.name, o.m.trade, o.months, qtyText(o), o.dep, o.ot ? U.fmtQty(o.ot) : '-', money(r2(o.gross)), money(r2(o.adv)), money(r2(o.net)), money(r2(o.billv)), money(r2(o.billv - o.gross))]),
              foot: l.length ? ['Total', '', '', '', qtyText(all), sum(l, o => o.dep), U.fmtQty(all.ot), money(r2(all.gross)), money(r2(all.adv)), money(r2(all.net)), money(r2(all.billv)), money(r2(all.billv - all.gross))] : null, empty: NOSHEET }];
          }
          const group = (keyOf, nameOf) => { const g = new Map(); es.forEach(x => { const k = keyOf(x); g.set(k, put(g.get(k) || Object.assign(zero(), { name: nameOf(x) }), x)); }); return Array.from(g.values()); };
          const line = (o) => [o.who.size, qtyText(o), o.ot ? U.fmtQty(o.ot) : '-', money(r2(o.gross)), money(r2(o.billv)), money(r2(o.billv - o.gross)), o.billv ? pct((o.billv - o.gross) / o.billv * 100) : '-'];
          if (rep === 'clientdays') {
            const l = group(x => lower(x.e.client) + '|' + lower(x.e.site), x => [x.e.client || '(no client named)', x.e.site || '']).sort((a, b) => b.billv - a.billv);
            return [{ title: 'Man-days by client', sub: span, headers: ['Client', 'Site', 'People', 'Worked', 'Overtime hours', 'Pay cost', 'Billing value', 'Margin', 'Margin %'], right: [2, 3, 4, 5, 6, 7, 8],
              note: 'From the Days Worked sheets: the client and site each member was at in the month, the pay and the bill rate of that month, overtime included. Before the employer PF / ESI the agency bears; what was invoiced is under Billed.',
              rows: l.map(o => o.name.concat(line(o))), foot: l.length ? ['Total', ''].concat(line(all)) : null, empty: NOSHEET }];
          }
          const l = group(x => x.ym, x => x.ym).sort((a, b) => a.name.localeCompare(b.name));
          return [{ title: 'Month by month', sub: span, headers: ['Month', 'People who worked', 'Worked', 'Overtime hours', 'Pay cost', 'Billing value', 'Margin', 'Margin %'], right: [1, 2, 3, 4, 5, 6, 7], note: 'From the Days Worked sheets. Set the dates to the financial year for its twelve months.',
            rows: l.map(o => [ymName(o.name)].concat(line(o))), foot: l.length ? ['Total'].concat(line(all)) : null, empty: NOSHEET }];
        }
        if (rep === 'strength') {
          const rows = [], block = (label, list) => list.forEach(o => rows.push([label, o.name, o.n, pct(every.length ? o.n / every.length * 100 : 0)]));
          block('Status', STATUS.map(s => ({ name: s[1], n: every.filter(m => statusOf(m) === s[0]).length })));
          block('Engagement', tally(act, m => m.engagement)); block('Skill category', tally(act, m => m.category)); block('Gender', tally(act, m => m.gender)); block('Trade', tally(act, m => m.trade));
          return [{ title: 'Strength', sub: asOn + ' · ' + every.length + ' on the roster, ' + act.length + ' active', headers: ['Group', 'Value', 'People', 'Share of the roster'], rows: every.length ? rows : [], right: [2, 3], note: 'Status counts everybody on the roster; the other groups leave out the inactive members.', empty: 'No members on the roster yet.' }];
        }
        if (rep === 'clients') {
          const groups = new Map();
          act.filter(m => statusOf(m) === 'deployed').forEach(m => { const k = lower(m.deploy.client) + '|' + lower(m.deploy.site), g = groups.get(k) || { client: m.deploy.client || '(no client named)', site: m.deploy.site || '', ms: [] }; g.ms.push(m); groups.set(k, g); });
          const list = Array.from(groups.values()).map(g => { const bill = sum(g.ms, m => monthly(m, m.billRate)), pay = sum(g.ms, m => monthly(m, m.payRate)); return Object.assign(g, { bill, pay, margin: bill - pay, trades: tally(g.ms, m => m.trade || 'Other').map(t => t.n + ' ' + t.name).join(', ') }); }).sort((a, b) => b.bill - a.bill || b.ms.length - a.ms.length);
          const tb = sum(list, g => g.bill), tp = sum(list, g => g.pay);
          return [{ title: 'Clients and billing', sub: asOn + ' · estimated for a month', headers: ['Client', 'Site', 'People', 'Trades', 'Bills a month', 'Pay a month', 'Margin a month', 'Margin %'], right: [2, 4, 5, 6, 7], note: EST,
            rows: list.map(g => [g.client, g.site, g.ms.length, g.trades, money(g.bill), money(g.pay), money(g.margin), g.bill ? pct(g.margin / g.bill * 100) : '-']),
            foot: list.length ? ['Total', '', sum(list, g => g.ms.length), '', money(tb), money(tp), money(tb - tp), tb ? pct((tb - tp) / tb * 100) : '-'] : null, empty: 'Nobody is deployed.' }];
        }
        if (rep === 'margin') {
          const list = act.filter(m => num(m.payRate) > 0 || num(m.billRate) > 0).map(m => ({ m, margin: num(m.billRate) - num(m.payRate), month: monthly(m, num(m.billRate) - num(m.payRate)) })).sort((a, b) => a.margin / (num(a.m.billRate) || 1) - b.margin / (num(b.m.billRate) || 1));
          const below = list.filter(x => num(x.m.billRate) > 0 && x.margin < 0).length, norate = act.length - list.length;
          return [{ title: 'Margin by member', sub: asOn + ' · the lowest margin first', headers: ['Code', 'Name', 'Trade', 'Status', 'Deployed at', 'Pay rate', 'Bill rate', 'Per', 'Margin', 'Margin %', 'Margin a month'], right: [5, 6, 8, 9, 10],
            note: (below ? below + ' member' + (below === 1 ? ' is' : 's are') + ' billed below the pay rate. ' : '') + (norate ? norate + ' active member' + (norate === 1 ? ' has' : 's have') + ' no rate on record and ' + (norate === 1 ? 'is' : 'are') + ' left out. ' : '') + EST,
            rows: list.map(({ m, margin, month }) => [m.code, m.name, m.trade, statusName(statusOf(m)), where(m), num(m.payRate) > 0 ? money(num(m.payRate)) : '-', num(m.billRate) > 0 ? money(num(m.billRate)) : '-', per(m), money(r2(margin)), num(m.billRate) > 0 ? pct(margin / num(m.billRate) * 100) : '-', money(r2(month))]),
            foot: list.length ? ['Total', '', '', '', '', '', '', '', '', '', money(r2(sum(list, x => x.month)))] : null, empty: 'No member has a pay rate or a bill rate on record.' }];
        }
        if (rep === 'bench') {
          const today = ms(U.today());
          const list = act.filter(m => statusOf(m) === 'available').map(m => { const last = m.history.reduce((t, h) => Math.max(t, ms(h.to) || 0), 0), since = last || ms(m.doj) || 0; return { m, since, days: since ? Math.max(0, Math.round((today - since) / DAY)) : null }; }).sort((a, b) => (b.days == null ? -1 : b.days) - (a.days == null ? -1 : a.days));
          const idle = sum(list, x => x.m.unit === 'DAY' ? num(x.m.billRate) : x.m.unit === 'HRS' ? num(x.m.billRate) * DAY_HOURS : num(x.m.billRate) / MONTH_DAYS);
          return [{ title: 'Bench', sub: asOn + ' · ' + list.length + ' available' + (idle > 0 ? ' · a day of the bench would bill about ' + money(r2(idle)) : ''), headers: ['Code', 'Name', 'Trade', 'Category', 'Skills', 'Phone', 'Free since', 'Days free', 'Bill rate', 'Per'], right: [7, 8],
            note: 'Free since the last deployment ended, or since joining for someone not sent out yet. The longest on the bench first.',
            rows: list.map(({ m, since, days }) => [m.code, m.name, m.trade, m.category, skillsOf(m).join(', '), m.phone, since ? U.dmy(new Date(since)) : '-', days == null ? '-' : days, num(m.billRate) > 0 ? money(num(m.billRate)) : '-', per(m)]), empty: 'Nobody is on the bench: everybody is out on a site or away.' }];
        }
        if (rep === 'moves') {
          const ev = [];
          every.forEach(m => {
            if (within(m.doj, P)) ev.push({ d: m.doj, what: 'Joined', m, client: '', site: '', days: '' });
            m.history.forEach(h => { const days = ms(h.from) && ms(h.to) ? Math.max(0, Math.round((ms(h.to) - ms(h.from)) / DAY)) + 1 : '';
              if (within(h.from, P)) ev.push({ d: h.from, what: 'Deployed', m, client: h.client, site: h.site, days: '' });
              if (within(h.to, P)) ev.push({ d: h.to, what: 'Released', m, client: h.client, site: h.site, days }); });
            if (statusOf(m) === 'deployed' && within(m.deploy.from, P)) ev.push({ d: m.deploy.from, what: 'Deployed', m, client: m.deploy.client, site: m.deploy.site, days: '' });
          });
          ev.sort((x, y) => ms(x.d) - ms(y.d) || String(x.m.name).localeCompare(String(y.m.name)));
          const n = (w) => ev.filter(e => e.what === w).length;
          return [{ title: 'Movements', sub: span + ' · ' + n('Joined') + ' joined, ' + n('Deployed') + ' deployed, ' + n('Released') + ' released', headers: ['Date', 'What', 'Code', 'Name', 'Trade', 'Client', 'Site', 'Days on the site'], right: [7],
            rows: ev.map(e => [e.d, e.what, e.m.code, e.m.name, e.m.trade, e.client, e.site, e.days]), empty: 'Nobody joined, was deployed or was released in this period.' }];
        }
        // Billed: the staff sheets of the invoices dated in the period
        const invs = Store.list('invoices').filter(i => i.kind === 'invoice' && i.staff && within(i.date, P)), byM = new Map(), byC = new Map();
        const amount = (it) => it.taxable != null && it.taxable !== '' ? num(it.taxable) : r2(num(it.qty) * num(it.rate) + num(it.staff.ot) * num(it.staff.otRate));
        invs.forEach(i => { const client = String((i.buyer && i.buyer.name) || '').split('\n')[0].trim() || '(cash sale)', c = byC.get(lower(client)) || { client, invs: 0, lines: 0, amt: 0 }; c.invs++;
          (i.items || []).forEach(it => { if (!it.staff || !String(it.desc || '').trim()) return; const k = lower(it.desc), o = byM.get(k) || { name: String(it.desc).trim(), code: it.staff.empId || '', trade: it.staff.designation || '', clients: new Set(), invs: new Set(), DAY: 0, HRS: 0, MON: 0, ot: 0, amt: 0 };
            o.clients.add(client); o.invs.add(i.no); o[['HRS', 'MON'].includes(it.uqc) ? it.uqc : 'DAY'] += num(it.qty); o.ot += num(it.staff.ot); o.amt += amount(it); byM.set(k, o); c.lines++; c.amt += amount(it); });
          byC.set(lower(client), c); });
        const qty = (o) => [o.DAY ? U.fmtQty(o.DAY) + ' d' : '', o.HRS ? U.fmtQty(o.HRS) + ' h' : '', o.MON ? U.fmtQty(o.MON) + ' mo' : ''].filter(Boolean).join(', ');
        const ml = Array.from(byM.values()).sort((a, b) => b.amt - a.amt), cl = Array.from(byC.values()).sort((a, b) => b.amt - a.amt);
        return [{ title: 'Billed by member', sub: span + ' · ' + invs.length + ' staff invoice' + (invs.length === 1 ? '' : 's'), headers: ['Code', 'Name', 'Designation', 'Client', 'Invoices', 'Billed for', 'Overtime hours', 'Amount before GST'], right: [4, 6, 7],
          note: 'From the staff sheets of the sales invoices dated in the period: days, hours or months billed, the overtime hours, and the amount before GST and before the PF / ESI and service charge lines.',
          rows: ml.map(o => [o.code, o.name, o.trade, Array.from(o.clients).join(', '), o.invs.size, qty(o), o.ot ? U.fmtQty(o.ot) : '-', money(r2(o.amt))]), foot: ml.length ? ['Total', '', '', '', '', '', U.fmtQty(sum(ml, o => o.ot)), money(r2(sum(ml, o => o.amt)))] : null, empty: 'No staff invoice is dated in this period.' },
        { title: 'Billed by client', sub: span, headers: ['Client', 'Invoices', 'Staff lines', 'Amount before GST'], right: [1, 2, 3], rows: cl.map(c => [c.client, c.invs, c.lines, money(r2(c.amt))]), foot: cl.length ? ['Total', sum(cl, c => c.invs), sum(cl, c => c.lines), money(r2(sum(cl, c => c.amt)))] : null, empty: 'No staff invoice is dated in this period.' }];
      },
      reportsTab(p, every) {
        const rep = MREPS.some(r => r[0] === p.rep) ? p.rep : 'wages';
        return chooser(MREPS, rep) + (PERIODIC.includes(rep) ? dates(period(p)) : '') + render(this.reportSections(p, every));
      },
      wireReports(root, p) { wireNav(root, 'manpower', MREPS.some(r => r[0] === p.rep) ? p.rep : 'wages'); },
      deployedDays,
      attCount(m, ym) { return attCount(marksOf(m, ym), ym); },
      // Attendance: the month as a grid, a member a line and a day a column; a click on a day changes its mark
      attTab(p, every, w) {
        const ym = /^\d{4}-\d{2}$/.test(p.month || '') ? p.month : ymOf(Date.now()), n = daysIn(ym), [y, mo] = ym.split('-').map(Number), today = new Date();
        const rows = every.filter(m => statusOf(m) !== 'inactive' || hasAtt(m, ym)), isNow = today.getFullYear() === y && today.getMonth() + 1 === mo, day = isNow ? today.getDate() : 1;
        const wd = (i) => new Date(y, mo - 1, i).getDay();
        return '<div class="btnrow" style="align-items:center"><input type="month" id="atMonth" value="' + ym + '" style="width:auto;min-height:34px">' +
          (w && rows.length ? '<span class="hint" style="white-space:nowrap">Day</span><input type="number" id="atDay" min="1" max="' + n + '" value="' + day + '" style="width:70px;min-height:34px"><button class="btn sm outline" id="atAllP" title="Marks everybody deployed present on this day, where nothing is marked yet">Deployed present</button><button class="btn sm outline" id="atSun" title="Marks the Sundays of the month as weekly off, where nothing is marked yet">Sundays off</button><button class="btn sm green" id="atSave">Save ' + esc(ymName(ym)) + '</button>' : '') + '<span class="hint" id="atSum" style="white-space:nowrap"></span></div>' +
          '<div class="hint" style="margin-bottom:8px">' + (w ? 'Click a day to change its mark: ' : '') + MARKS.map(k => '<span style="display:inline-block;min-width:26px;text-align:center;border-radius:4px;color:#fff;font-weight:700;font-size:12px;background:' + k[3] + '">' + k[1] + '</span> ' + esc(k[2])).join(' &nbsp; ') + '. The heading of a day marks that day present for everybody deployed. Days Worked fills from this, and the muster roll and the attendance summary are under Reports.</div>' +
          (rows.length ? '<div class="tablewrap pin"><table class="list" id="atList" style="min-width:' + (330 + n * 30 + 330) + 'px"><thead><tr><th>Code</th><th>Name</th><th>At</th>' + Array.from({ length: n }, (_, i) => '<th data-dh="' + (i + 1) + '" title="Mark day ' + (i + 1) + '" style="text-align:center;padding:2px;font-size:12px' + (w ? ';cursor:pointer' : '') + (wd(i + 1) === 0 ? ';color:#DC2626' : '') + '">' + (i + 1) + '<br>' + 'SMTWTFS'[wd(i + 1)] + '</th>').join('') + '<th class="num">P</th><th class="num">HD</th><th class="num">A</th><th class="num">WO</th><th class="num">H</th><th class="num">L</th><th class="num">Worked</th></tr></thead><tbody>' +
            rows.map(m => { const s = marksOf(m, ym); return '<tr data-id="' + esc(m.id) + '" data-marks="' + s + '" data-dep="' + (statusOf(m) === 'deployed' ? 1 : 0) + '"><td><b>' + esc(m.code || '-') + '</b></td><td style="white-space:nowrap"><b>' + esc(m.name) + '</b><div class="small muted">' + esc(m.trade || '') + '</div></td><td class="small">' + esc(where(m) || '-') + '</td>' + s.split('').map((c, i) => '<td data-d="' + i + '" style="' + cellStyle(c) + '">' + ((markOf(c) || ['', '·'])[1]) + '</td>').join('') + '<td class="num" data-t="P"></td><td class="num" data-t="D"></td><td class="num" data-t="A"></td><td class="num" data-t="W"></td><td class="num" data-t="O"></td><td class="num" data-t="L"></td><td class="num" data-t="worked" style="font-weight:700"></td></tr>'; }).join('') + '</tbody></table></div>'
            : '<div class="empty">No members yet. Add them under Members.</div>');
      },
      wireAtt(root, p) {
        const ym = /^\d{4}-\d{2}$/.test(p.month || '') ? p.month : ymOf(Date.now()), w = Companies.mayWrite('manpower'), [y, mo] = ym.split('-').map(Number);
        $('#atMonth', root).onchange = (e) => { if (e.target.value) App.go('manpower', { tab: 'att', month: e.target.value }); };
        const trs = () => $$('#atList tbody tr', root);
        const totals = () => { let marked = 0; trs().forEach(tr => { const c = attCount(tr.dataset.marks, ym); $$('[data-t]', tr).forEach(td => { const v = c[td.dataset.t]; td.textContent = td.dataset.t === 'worked' ? U.fmtQty(v) : String(v); }); if (c.marked) marked++; }); if ($('#atSum', root)) $('#atSum', root).textContent = marked ? marked + ' of ' + trs().length + ' marked' : 'Nothing marked yet'; };
        const set = (tr, i, c) => { const s = tr.dataset.marks.split(''); if (i < 0 || i >= s.length) return; s[i] = c; tr.dataset.marks = s.join(''); const td = $('[data-d="' + i + '"]', tr); td.setAttribute('style', cellStyle(c)); td.textContent = (markOf(c) || ['', '·'])[1]; };
        totals(); if (!w) return;
        const order = ['-'].concat(MARKS.map(k => k[0]));
        $$('#atList td[data-d]', root).forEach(td => td.onclick = () => { const tr = td.parentNode, i = +td.dataset.d; set(tr, i, order[(order.indexOf(tr.dataset.marks[i]) + 1) % order.length]); totals(); });
        const dayPresent = (d) => { let n = 0; trs().forEach(tr => { if (tr.dataset.dep === '1' && tr.dataset.marks[d - 1] === '-') { set(tr, d - 1, 'P'); n++; } }); totals(); UI.toast(n ? n + ' marked present on day ' + d + '. Change the absentees, then Save.' : 'Nobody deployed is unmarked on day ' + d, 4000); };
        $$('#atList th[data-dh]', root).forEach(th => th.onclick = () => dayPresent(+th.dataset.dh));
        if ($('#atAllP', root)) $('#atAllP', root).onclick = () => { const d = Math.round(num($('#atDay', root).value)); if (d >= 1 && d <= daysIn(ym)) dayPresent(d); else UI.toast('Enter the day of the month'); };
        if ($('#atSun', root)) $('#atSun', root).onclick = () => { let n = 0; trs().forEach(tr => { for (let i = 0; i < tr.dataset.marks.length; i++) if (new Date(y, mo - 1, i + 1).getDay() === 0 && tr.dataset.marks[i] === '-') { set(tr, i, 'W'); n++; } }); totals(); UI.toast(n ? 'The Sundays are marked weekly off. Save to keep them.' : 'The Sundays are marked already', 4000); };
        if ($('#atSave', root)) $('#atSave', root).onclick = () => {
          const l = Store.list('manpower'); let n = 0;
          trs().forEach(tr => { const m = l.find(x => String(x.id) === tr.dataset.id); if (!m) return; const s = tr.dataset.marks, att = Object.assign({}, m.att), old = att[ym] || '';
            if (/[^-]/.test(s)) { n++; if (old !== s) { att[ym] = s; m.att = att; m.updatedAt = Date.now(); } } else if (old) { delete att[ym]; m.att = att; m.updatedAt = Date.now(); } });
          if (Store.saveList('manpower', l) === false) return;
          UI.toast('Attendance of ' + ymName(ym) + ' saved for ' + n + ' member' + (n === 1 ? '' : 's') + '. Days Worked fills from it.', 5000, 'ok'); App.go('manpower', { tab: 'att', month: ym });
        };
      },
      // The sheet of a month: a line for every active member and for anyone with days entered in that month
      workTab(p, every, w) {
        const ym = /^\d{4}-\d{2}$/.test(p.month || '') ? p.month : ymOf(Date.now()), S = ymSpan(ym), dis = w ? '' : ' disabled';
        const rows = every.filter(m => statusOf(m) !== 'inactive' || entryOf(m, ym));
        const inp = (k, v, ph) => '<input type="number" min="0" step="any" data-w="' + k + '" value="' + esc(v === 0 || v ? String(v) : '') + '" placeholder="' + (ph || '') + '" style="width:92px;min-height:32px"' + dis + '>';
        return '<div class="btnrow" style="align-items:center"><input type="month" id="wkMonth" value="' + ym + '" style="width:auto;min-height:34px">' + (w && rows.length ? '<button class="btn sm outline" id="wkFill" title="Proposes the days worked in ' + esc(ymName(ym)) + ' from the attendance (from the deployment dates for a member with none marked), where nothing is entered yet">Fill from attendance</button><button class="btn sm green" id="wkSave">Save ' + esc(ymName(ym)) + '</button>' : '') + '<span class="hint" id="wkSum" style="white-space:nowrap"></span></div>' +
          '<div class="hint" style="margin-bottom:8px">Enter what each member worked in ' + esc(ymName(ym)) + ': days, hours or months as their rate goes, the overtime hours and what an overtime hour pays, and any advance or deduction. The wage register and the days-worked reports (Reports) are made from these sheets.</div>' +
          (rows.length ? '<div class="tablewrap pin"><table class="list" id="wkList"><thead><tr><th>Code</th><th>Name</th><th>Trade</th><th>At</th><th class="num">Pay rate</th><th class="num">Attendance</th><th>Worked</th><th>Overtime h</th><th>Overtime pay ₹/h</th><th>Advance ₹</th><th class="num">Gross</th><th class="num">Net</th></tr></thead><tbody>' +
            rows.map(m => { const e = (m.work && m.work[ym]) || {}, live = !entryOf(m, ym), pay = live ? num(m.payRate) : num(e.pay), unit = unitKey(live ? m.unit : e.unit), at = live ? where(m) : [e.client, e.site].filter(Boolean).join(' · '), prev = Object.keys(m.work || {}).sort().reverse().map(k => m.work[k]).find(x => x && num(x.otPay) > 0), dep = deployedDays(m, S.a, S.b), ac = hasAtt(m, ym) ? attCount(marksOf(m, ym), ym) : null;
              return '<tr data-id="' + esc(m.id) + '" data-pay="' + pay + '" data-unit="' + unit + '" data-dep="' + dep + '" data-att="' + (ac ? ac.worked : '') + '" data-paid="' + (ac ? ac.paid : '') + '"><td><b>' + esc(m.code || '-') + '</b></td><td><b>' + esc(m.name) + '</b></td><td>' + esc(m.trade || '-') + '</td><td>' + esc(at || '-') + '</td><td class="num">' + (pay > 0 ? money(pay) + '<div class="small muted">per ' + (unit === 'HRS' ? 'hour' : unit === 'MON' ? 'month' : 'day') + '</div>' : '<span class="pill warn">no rate</span>') + '</td><td class="num">' + (ac ? '<b>' + U.fmtQty(ac.worked) + ' d</b><div class="small muted">attendance</div>' : dep + ' d<div class="small muted">deployed</div>') + '</td>' +
                '<td>' + inp('qty', e.qty, unit === 'HRS' ? 'hours' : unit === 'MON' ? 'months' : 'days') + '</td><td>' + inp('ot', e.ot) + '</td><td>' + inp('otPay', e.otPay != null && e.otPay !== '' ? e.otPay : (prev ? prev.otPay : '')) + '</td><td>' + inp('adv', e.adv) + '</td><td class="num" data-c="gross"></td><td class="num" data-c="net"></td></tr>'; }).join('') + '</tbody></table></div>'
            : '<div class="empty">No members yet. Add them under Members.</div>');
      },
      wireWork(root, p) {
        const ym = /^\d{4}-\d{2}$/.test(p.month || '') ? p.month : ymOf(Date.now());
        $('#wkMonth', root).onchange = (e) => { if (e.target.value) App.go('manpower', { tab: 'work', month: e.target.value }); };
        const val = (tr, k) => { const el = $('[data-w=' + k + ']', tr); return el && el.value !== '' ? num(el.value) : ''; };
        const show = () => { let gross = 0, net = 0, n = 0;
          $$('#wkList tbody tr', root).forEach(tr => { const g = r2(num(val(tr, 'qty')) * num(tr.dataset.pay) + num(val(tr, 'ot')) * num(val(tr, 'otPay'))), has = num(val(tr, 'qty')) || num(val(tr, 'ot')) || num(val(tr, 'adv')); $('[data-c=gross]', tr).textContent = has ? money(g) : '-'; $('[data-c=net]', tr).textContent = has ? money(r2(g - num(val(tr, 'adv')))) : '-'; if (has) { n++; gross += g; net += g - num(val(tr, 'adv')); } });
          if ($('#wkSum', root)) $('#wkSum', root).textContent = n ? n + ' entered · gross ' + money(r2(gross)) + ' · net ' + money(r2(net)) : 'Nothing entered yet'; };
        $$('#wkList input', root).forEach(i => i.addEventListener('input', show)); show();
        if ($('#wkFill', root)) $('#wkFill', root).onclick = () => { let n = 0; const S = ymSpan(ym), inMonth = Math.round((S.b - S.a) / DAY);
          $$('#wkList tbody tr', root).forEach(tr => { const el = $('[data-w=qty]', tr), marked = tr.dataset.att !== '', d = marked ? num(tr.dataset.att) : num(tr.dataset.dep); if (!el || el.value !== '' || !d) return; el.value = tr.dataset.unit === 'HRS' ? d * DAY_HOURS : tr.dataset.unit === 'MON' ? r2((marked ? num(tr.dataset.paid) : d) / inMonth) : d; n++; });
          show(); UI.toast(n ? n + ' line' + (n === 1 ? '' : 's') + ' filled: the days worked from the attendance where it is marked (a monthly rate by the paid days), otherwise the calendar days on a site by the deployment dates. Check them, then Save.' : 'Nothing to fill: the days are entered already, or nobody was deployed in ' + ymName(ym), 7000); };
        if ($('#wkSave', root)) $('#wkSave', root).onclick = () => {
          const l = Store.list('manpower'); let n = 0;
          $$('#wkList tbody tr', root).forEach(tr => { const m = l.find(x => String(x.id) === tr.dataset.id); if (!m) return; const qty = val(tr, 'qty'), ot = val(tr, 'ot'), adv = val(tr, 'adv'), otPay = val(tr, 'otPay'), work = Object.assign({}, m.work), old = work[ym];
            if (!num(qty) && !num(ot) && !num(adv)) { if (old) { delete work[ym]; m.work = work; m.updatedAt = Date.now(); } return; }
            // The rates and the site of the month are kept with it; a month entered before keeps the ones it was entered at
            const keep = old && (num(old.qty) || num(old.ot) || num(old.adv)) ? old : { pay: num(m.payRate), bill: num(m.billRate), otBill: num(m.otRate), unit: m.unit || 'DAY', client: (m.deploy || {}).client || '', site: (m.deploy || {}).site || '' };
            const e = { qty: num(qty), ot: num(ot), otPay: num(otPay), adv: num(adv), pay: num(keep.pay), bill: num(keep.bill), otBill: num(keep.otBill), unit: unitKey(keep.unit), client: keep.client || '', site: keep.site || '' };
            if (JSON.stringify(old || null) !== JSON.stringify(e)) { work[ym] = e; m.work = work; m.updatedAt = Date.now(); } n++; });
          if (Store.saveList('manpower', l) === false) return;
          UI.toast(ymName(ym) + ' saved: ' + n + ' member' + (n === 1 ? '' : 's') + '. The wage register is under Reports.', 5000, 'ok'); App.go('manpower', { tab: 'work', month: ym });
        };
      }
    });
  }

  // ------------------------------------------------------------ Hotel
  if (global.Hotel) {
    const HREPS = [['occ', 'Occupancy'], ['daily', 'Daily report'], ['revenue', 'Revenue'], ['collections', 'Collections'], ['due', 'Outstanding'], ['guests', 'Guests'], ['cancel', 'Cancellations']];
    const LIVE = (s) => s.status !== 'cancelled' && s.status !== 'noshow';
    const statusName = (k) => (Hotel.STATUS.find(s => s[0] === k) || ['', k])[1];
    const roomNo = (s) => (Hotel.room(s.roomId) || {}).no || '';
    const typeName = (s) => (Hotel.type(s.typeId) || {}).name || '';
    const pax = (s) => num(s.adults) + num(s.children);
    const occupancy = Hotel.reportsTab;

    Object.assign(Hotel, {
      reportSections(p, all, rooms) {
        const rep = p.rep, P = period(p), span = P.from + ' to ' + P.to, live = all.filter(LIVE), today = ms(U.today());
        const payments = (list) => { const out = []; list.forEach(s => (s.payments || []).forEach(y => out.push({ s, y }))); return out; };
        const byMode = (pays) => { const l = tally(pays, x => x.y.mode, (o, x) => { o.amt = (o.amt || 0) + num(x.y.amount); }).sort((a, b) => b.amt - a.amt); return { rows: l.map(o => [o.name, o.n, money(r2(o.amt))]), foot: l.length ? ['Total', sum(l, o => o.n), money(r2(sum(l, o => o.amt)))] : null }; };
        if (rep === 'daily') {
          const d = ms(p.from) ? p.from : U.today(), a = ms(d), b = a + DAY, m = this.measure(all, rooms, a, b);
          const arrivals = live.filter(s => ms(s.from) === a), departures = live.filter(s => ms(s.to) === a), house = live.filter(s => ms(s.from) <= a && ms(s.to) > a && s.status !== 'out').sort((x, y) => String(roomNo(x)).localeCompare(String(roomNo(y)), undefined, { numeric: true }));
          const charges = []; live.forEach(s => (s.charges || []).forEach(c => { if (ms(c.date) === a) charges.push(c); }));
          const pays = payments(all).filter(x => ms(x.y.date) === a), mode = byMode(pays);
          return [{ title: 'Daily report', sub: d, headers: ['Measure', 'Figure'], right: [1], rows: [['Rooms', rooms.length], ['Rooms sold for the night', m.sold], ['Occupancy', pct(m.occ)], ['ADR (average daily rate)', money(m.adr)], ['RevPAR (revenue per available room)', money(m.revpar)], ['Room revenue of the night, before GST', money(m.rev)],
            ['Other charges posted, before GST', money(r2(sum(charges, c => c.amount)))], ['Collections of the day', money(r2(sum(pays, x => x.y.amount)))], ['Arrivals', arrivals.length + ' (' + arrivals.filter(s => ['in', 'out'].includes(s.status)).length + ' checked in)'], ['Departures', departures.length + ' (' + departures.filter(s => s.status === 'out').length + ' checked out)'], ['Guests in house for the night', sum(house, pax)]] },
          { title: 'Arrivals', sub: d, headers: ['No', 'Guest', 'Phone', 'Room', 'Nights', 'Persons', 'Plan', 'Source', 'Status'], right: [4, 5], rows: arrivals.map(s => [s.no, s.guest.name, s.guest.phone, roomNo(s) || typeName(s), this.nights(s), pax(s), s.plan, s.source, statusName(s.status)]), empty: 'No arrival on this date.' },
          { title: 'Departures', sub: d, headers: ['No', 'Guest', 'Phone', 'Room', 'Arrived', 'Status', 'Folio total', 'Due'], right: [6, 7], rows: departures.map(s => { const f = this.folio(s); return [s.no, s.guest.name, s.guest.phone, roomNo(s), s.from, statusName(s.status), money(f.total), money(f.balance)]; }), empty: 'No departure on this date.' },
          { title: 'In house for the night', sub: d, headers: ['Room', 'Type', 'Guest', 'Persons', 'Arrival', 'Departure', 'Plan', 'Rate a night', 'Status'], right: [3, 7], rows: house.map(s => [roomNo(s), typeName(s), s.guest.name, pax(s), s.from, s.to, s.plan, money(this.nightly(s)), statusName(s.status)]), empty: 'No room is taken for this night.' },
          { title: 'Collections of the day', sub: d, headers: ['Mode', 'Receipts', 'Amount'], right: [1, 2], rows: mode.rows, foot: mode.foot, empty: 'Nothing was collected on this date.' }];
        }
        if (rep === 'revenue') {
          const heads = new Map(), rates = new Map();
          const add = (head, n, amt, gst, room) => { if (!amt && !n) return; const tax = r2(amt * gst / 100), h = heads.get(lower(head)) || { name: head, n: 0, amt: 0, tax: 0, room }; h.n += n; h.amt += amt; h.tax += tax; heads.set(lower(head), h); const r = rates.get(gst) || { gst, amt: 0, tax: 0 }; r.amt += amt; r.tax += tax; rates.set(gst, r); };
          live.forEach(s => { const n = this.nightsIn(s, P.a, P.b), night = this.nightly(s); if (n) add('Room tariff', n, r2(n * night), num(this.slab(night)), true); (s.charges || []).forEach(c => { if (within(c.date, P)) add(String(c.desc || 'Other charge').trim() || 'Other charge', 1, num(c.amount), num(c.gst), false); }); });
          const hl = Array.from(heads.values()).sort((a, b) => (b.room ? 1 : 0) - (a.room ? 1 : 0) || b.amt - a.amt), rl = Array.from(rates.values()).sort((a, b) => a.gst - b.gst), ta = sum(hl, h => h.amt), tt = sum(hl, h => h.tax);
          return [{ title: 'Revenue by head', sub: span, headers: ['Head', 'Nights / postings', 'Before GST', 'GST', 'With GST', 'Share'], right: [1, 2, 3, 4, 5], note: 'Room tariff by the night that falls in the period (stays in house and to come included, cancelled and no-shows left out); every other charge on its own date. The tax invoice is made at check-out and is what reaches the books.',
            rows: hl.map(h => [h.name, h.n, money(r2(h.amt)), money(r2(h.tax)), money(r2(h.amt + h.tax)), pct(ta ? h.amt / ta * 100 : 0)]), foot: hl.length ? ['Total', '', money(r2(ta)), money(r2(tt)), money(r2(ta + tt)), ''] : null, empty: 'No room night and no charge falls in this period.' },
          { title: 'GST rate by rate', sub: span, headers: ['GST rate', 'Taxable value', 'CGST', 'SGST', 'GST'], right: [0, 1, 2, 3, 4], rows: rl.map(r => [r.gst + '%', money(r2(r.amt)), money(r2(r.tax / 2)), money(r2(r.tax / 2)), money(r2(r.tax))]), foot: rl.length ? ['Total', money(r2(ta)), money(r2(tt / 2)), money(r2(tt / 2)), money(r2(tt))] : null, empty: 'Nothing taxable in this period.' }];
        }
        if (rep === 'collections') {
          const pays = payments(all).filter(x => within(x.y.date, P)).sort((x, y) => ms(x.y.date) - ms(y.y.date)), mode = byMode(pays);
          return [{ title: 'Collections by mode', sub: span, headers: ['Mode', 'Receipts', 'Amount'], right: [1, 2], rows: mode.rows, foot: mode.foot, empty: 'Nothing was collected in this period.' },
          { title: 'Receipts', sub: span, headers: ['Date', 'Reservation', 'Guest', 'Room', 'Mode', 'Reference', 'Amount'], right: [6], rows: pays.map(({ s, y }) => [y.date, s.no, s.guest.name, roomNo(s), y.mode, y.ref, money(num(y.amount))]), foot: pays.length ? ['Total', '', '', '', '', '', money(r2(sum(pays, x => x.y.amount)))] : null, empty: 'Nothing was collected in this period.' }];
        }
        if (rep === 'due') {
          const fol = live.map(s => ({ s, f: this.folio(s) }));
          const due = fol.filter(x => ['in', 'out'].includes(x.s.status) && x.f.balance > 0.5).sort((x, y) => y.f.balance - x.f.balance);
          const adv = fol.filter(x => ['tentative', 'confirmed'].includes(x.s.status) && x.f.paid > 0).sort((x, y) => ms(x.s.from) - ms(y.s.from));
          const noInv = fol.filter(x => x.s.status === 'out' && !x.s.invoiceNo).sort((x, y) => ms(x.s.to) - ms(y.s.to));
          const days = (s) => s.status === 'out' ? Math.max(0, Math.round((today - ms(s.to)) / DAY)) : '';
          return [{ title: 'Balance due', sub: 'As on ' + U.today(), headers: ['No', 'Guest', 'Phone', 'Company', 'Room', 'Status', 'Arrival', 'Departure', 'Folio total', 'Paid', 'Due', 'Days since departure'], right: [8, 9, 10, 11], note: 'Guests in house and checked out whose folio is not settled. The folio of a guest in house runs to the departure date.',
            rows: due.map(({ s, f }) => [s.no, s.guest.name, s.guest.phone, s.guest.company, roomNo(s), statusName(s.status), s.from, s.to, money(f.total), money(f.paid), money(f.balance), days(s)]), foot: due.length ? ['Total', '', '', '', '', '', '', '', money(r2(sum(due, x => x.f.total))), money(r2(sum(due, x => x.f.paid))), money(r2(sum(due, x => x.f.balance))), ''] : null, empty: 'Every folio is settled.' },
          { title: 'Advances held', sub: 'As on ' + U.today(), headers: ['No', 'Guest', 'Phone', 'Arrival', 'Nights', 'Folio total', 'Advance paid'], right: [4, 5, 6], note: 'Paid on reservations still to arrive.', rows: adv.map(({ s, f }) => [s.no, s.guest.name, s.guest.phone, s.from, this.nights(s), money(f.total), money(f.paid)]), foot: adv.length ? ['Total', '', '', '', '', '', money(r2(sum(adv, x => x.f.paid)))] : null, empty: 'No advance is held for a stay to come.' },
          { title: 'Checked out, not invoiced', sub: 'As on ' + U.today(), headers: ['No', 'Guest', 'Room', 'Departure', 'Folio total', 'Due'], right: [4, 5], note: 'The tax invoice of these stays has not been saved: open the reservation and make it, so the stay reaches the books and the GST returns.', rows: noInv.map(({ s, f }) => [s.no, s.guest.name, roomNo(s), s.to, money(f.total), money(f.balance)]), empty: 'Every stay that checked out has its invoice.' }];
        }
        if (rep === 'guests') {
          const arr = live.filter(s => within(s.from, P)), rows = [];
          const block = (label, keyOf) => tally(arr, keyOf, (o, s) => { o.pax = (o.pax || 0) + pax(s); o.nights = (o.nights || 0) + this.nights(s); }).forEach(o => rows.push([label, o.name, o.n, o.pax, o.nights, pct(arr.length ? o.n / arr.length * 100 : 0)]));
          block('Nationality', s => s.guest.nationality); block('State', s => /^indian?$/i.test(String(s.guest.nationality).trim()) ? s.guest.state : 'Outside India'); block('Purpose of visit', s => s.guest.purpose); block('Meal plan', s => s.plan); block('Source', s => s.source);
          const who = new Map(); live.forEach(s => { const k = String(s.guest.phone || '').replace(/\D/g, '').slice(-10) || lower(s.guest.name); if (!k) return; const o = who.get(k) || { name: s.guest.name, phone: s.guest.phone, n: 0, nights: 0, rev: 0, last: 0 }; o.n++; o.nights += this.nights(s); o.rev += this.nights(s) * this.nightly(s); if (ms(s.from) > o.last) { o.last = ms(s.from); o.name = s.guest.name || o.name; } who.set(k, o); });
          const back = Array.from(who.values()).filter(o => o.n > 1).sort((a, b) => b.n - a.n || b.rev - a.rev);
          return [{ title: 'Arrivals by kind of guest', sub: span + ' · ' + arr.length + ' arrival' + (arr.length === 1 ? '' : 's') + ', ' + sum(arr, pax) + ' persons', headers: ['Group', 'Value', 'Stays', 'Persons', 'Room nights', 'Share of the stays'], right: [2, 3, 4, 5], rows: arr.length ? rows : [], empty: 'No arrival in this period.' },
          { title: 'Guests who came back', sub: 'Every stay on record, by mobile number', headers: ['Guest', 'Phone', 'Stays', 'Room nights', 'Room revenue', 'Last arrival'], right: [2, 3, 4], rows: back.map(o => [o.name, o.phone, o.n, o.nights, money(r2(o.rev)), o.last ? U.dmy(new Date(o.last)) : '-']), empty: 'No guest has stayed more than once yet.' }];
        }
        // Cancellations and no-shows whose arrival falls in the period
        const lost = all.filter(s => !LIVE(s) && within(s.from, P)).sort((x, y) => ms(x.from) - ms(y.from)), rev = (s) => this.nights(s) * this.nightly(s), paid = (s) => sum(s.payments || [], y => y.amount);
        const arrivals = all.filter(s => within(s.from, P)).length;
        return [{ title: 'Cancellations and no-shows', sub: span + ' · ' + lost.length + ' of ' + arrivals + ' reservation' + (arrivals === 1 ? '' : 's') + (arrivals ? ' (' + pct(lost.length / arrivals * 100) + ')' : ''), headers: ['No', 'Guest', 'Phone', 'Source', 'What', 'Arrival', 'Nights', 'Room type', 'Room revenue lost', 'Advance paid'], right: [6, 8, 9], note: 'By the arrival date. The advance paid stays on the reservation until it is refunded or kept.',
          rows: lost.map(s => [s.no, s.guest.name, s.guest.phone, s.source, statusName(s.status), s.from, this.nights(s), typeName(s), money(r2(rev(s))), money(r2(paid(s)))]), foot: lost.length ? ['Total', '', '', '', '', '', sum(lost, s => this.nights(s)), '', money(r2(sum(lost, rev))), money(r2(sum(lost, paid)))] : null, empty: 'No cancellation and no no-show in this period.' }];
      },
      reportsTab(p, all, rooms) {
        const rep = HREPS.some(r => r[0] === p.rep) ? p.rep : 'occ', top = chooser(HREPS, rep);
        if (rep === 'occ') { const o = occupancy.call(this, p, all, rooms); return { html: top + o.html, wire: (root, again) => { $$('[data-xrep]', root).forEach(b => b.onclick = () => App.go('hotel', { tab: 'reports', rep: b.dataset.xrep })); if (o.wire) o.wire(root, again); } }; }
        const q = Object.assign({}, p, { rep }), bar = rep === 'due' ? '' : rep === 'daily' ? dates({ from: ms(p.from) ? p.from : U.today() }, true) : dates(period(p));
        return { html: top + bar + render(this.reportSections(q, all, rooms)), wire: (root) => wireNav(root, 'hotel', rep) };
      }
    });
  }
})(window);
