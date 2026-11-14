/* BlitzBook web portal - Professionals: the project report an accountant or a tax professional prepares for a bank
   loan, in the layout banks are used to (the report of a small manufacturing unit served as the model):
     the cover                    PROJECT REPORT OF M/S ..., the address
     1.  Introduction             name of the unit, constitution, address, partners, type of industry, classification ...
     2-6 Brief history and promoters' background, land, investments, viability, the manufacturing process step by step
     7.  Cost of the project and means of financing (amount to be incurred / raised, total)
     8-9 Turnover and purchase cost of goods sold, year by year
     and the annexures, each headed with the unit and its address, the figures in lacs, the years Ist, IInd, IIIrd ...:
         Cost of project and Means of finance (existing, proposed, total)
         Calculation of interest and repayment schedule
         Calculation of depreciation (written-down value, asset by asset)
         Projected profitability statement
         Calculation of working capital requirement
         Balance sheet at the end of the year
         Funds flow statement
         Calculation of debt service coverage ratio, with the average DSCR
         Calculation of break even point (in the 3rd year of operation)
         Ratios (current ratio, debt-equity, TOL / TNW, margins, interest cover)
   Everything is worked out from one page of inputs (Project details). The report is one record of the company's
   books ('pro', synced like the HR settings). It is printed and exported with a Professional licence (licences.js:
   the owner with a Professional seat running, a member assigned one); without it the tab is a preview: everything is
   worked out and shown, nothing is printed, exported or copied. */
(function (global) {
  'use strict';
  const { esc, num } = U;
  const TABS = [['project', 'Project details'], ['cost', 'Cost & means of finance'], ['profit', 'Profitability statement'], ['balance', 'Balance sheet'], ['funds', 'Funds flow'], ['cashflow', 'Cash flow statement'], ['depreciation', 'Depreciation'], ['repayment', 'Repayment schedule'], ['dscr', 'DSCR'], ['bep', 'Break-even point'], ['wc', 'Working capital'], ['ratios', 'Ratios']];
  const ROMAN = ['Ist', 'IInd', 'IIIrd', 'IVth', 'Vth', 'VIth', 'VIIth', 'VIIIth', 'IXth', 'Xth'];
  const DEFAULT_ASSETS = [['Land', 0], ['Building', 10], ['Plant & Machinery', 15], ['Electrical Installation', 10], ['Furniture & Fixtures', 10], ['Vehicles', 15], ['Computers', 40], ['Other Fixed Assets', 15]];
  const DEFAULT_OTHER = ['Preliminary & Pre-operative Expenses', 'Deposits', ''];
  const r0 = (v) => Math.round(num(v));
  const x2 = (v) => isFinite(v) ? v.toFixed(2) : 'n/a';
  const pct = (a, b) => b > 0.005 ? (a / b * 100).toFixed(1) + '%' : 'n/a';
  // The two layouts the report prints in: chosen on Project details (layout on the record)
  const LAYOUTS = [['annex', 'Annexures: cover, introduction, cost of project, then every annexure a page'], ['bank', 'Bank loan format: executive summary, cash flow statement, man power, plant & machinery, projected balance sheet']];
  const lines = (v) => String(v == null ? '' : v).replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean);

  const Pro = {
    TABS, ROMAN, LAYOUTS,
    blank() {
      const co = global.Store && Store.uid != null ? Store.company() : {};
      return { name: '', constitution: 'Proprietorship Concern', address: String(co.address || ''), corrAddress: 'As above', partners: '', industry: '', classification: 'Manufacturing', category: 'General', reserved: 'No',
        history: '', land: '', investments: '', viability: '', process: '', unit: 'lacs', layout: 'annex', years: 7, startYear: U.fyFirstYear(),
        assets: DEFAULT_ASSETS.map(a => ({ name: a[0], existing: 0, cost: 0, rate: a[1] })), other: DEFAULT_OTHER.map(n => ({ name: n, amount: 0 })), wcReq: 0,
        capitalExisting: 0, capital: 0, subsidy: 0, unsecured: 0, unsRate: 12, termLoan: 0, tlRate: 12.5, tlMonths: 60, tlMoratorium: 6, wcLimit: 0, wcRate: 12.5,
        sales1: 0, growth: 10, util: '', miscIncome: 0, rmPct: 80, powerPct: 4, wages1: 0, wagesGrowth: 3, sellingPct: 1, admin1: 0, adminGrowth: 5, repairs1: 0, repairsGrowth: 5, misc1: 0,
        rmDays: 20, fgDays: 15, debtorDays: 30, creditorDays: 30, taxPct: 30, drawings: 0, drawingsGrowth: 0,
        // Amounts year by year (rupees, the last holds), as the model report gives them; blank = worked out from the days above
        wipList: '', fgList: '', debtorList: '', creditorList: '', advancesList: '', drawingsList: '',
        // The second layout (executive summary, project description, cash flow, man power, plant and machinery, projected balance sheet)
        execSummary: '', description: '', products: '', market: '', management: '', manpower: '', machinery: '', feasibility: '', collateral: '', conclusion: '' };
    },
    data() {
      const d = Store.get('pro', null), b = this.blank();
      if (!d || typeof d !== 'object') return b;
      const o = Object.assign(b, d, { assets: Array.isArray(d.assets) && d.assets.length ? d.assets : b.assets, other: Array.isArray(d.other) && d.other.length ? d.other : b.other });
      if (d.wcReq == null && d.wcMargin != null) o.wcReq = d.wcMargin;      // a report saved in the first layout
      if (!d.partners && d.promoter) o.partners = d.promoter;
      if (!d.industry && d.activity) o.industry = d.activity;
      return o;
    },
    /* 'full' with a Professional licence (the owner with a seat of it running, a member assigned one that runs),
       'preview' for an owner without one (the trial included): shown, not printed, exported or copied; 'none' for a
       member whose licence is not Professional. */
    access() {
      const c = global.Companies ? Companies.current() : null, owner = !Store.cid || (c && c.role === 'owner');
      if (!owner) return Companies.licKind() === 'pro' && global.Lic && Lic.valid() ? 'full' : 'none';
      return c && (parseInt(c.lic_pro, 10) || 0) > 0 ? 'full' : 'preview';
    },
    unitName(d) { return String(d.name || '').trim() || Store.company().name || 'The unit'; },
    // "M/S SHIVALIK AGRO FOODS, VILL. HALUWALA, DISTT. YAMUNA NAGAR": the line at the head of every annexure
    headLine(d) { const n = this.unitName(d).toUpperCase(), a = lines(d.address).join(', ').toUpperCase(); return (/^M\/S/i.test(n) ? n : 'M/S ' + n) + (a ? ', ' + a : ''); },

    // ------------------------------------------------------------ the arithmetic
    compute(d) {
      const n = Math.max(1, Math.min(10, r0(d.years) || 7)), Y = Array.from({ length: n }, (_, i) => i);
      const assets = (d.assets || []).filter(a => String(a.name || '').trim() && num(a.cost) + num(a.existing) > 0).map(a => ({ name: String(a.name).trim(), existing: num(a.existing), proposed: num(a.cost), cost: num(a.existing) + num(a.cost), rate: Math.max(0, Math.min(100, num(a.rate))) }));
      const other = (d.other || []).filter(o => String(o.name || '').trim() && num(o.amount) > 0).map(o => ({ name: String(o.name).trim(), amount: num(o.amount) }));
      const fixed = assets.reduce((s, a) => s + a.cost, 0), fixedExisting = assets.reduce((s, a) => s + a.existing, 0), prelim = other.reduce((s, o) => s + o.amount, 0), wcReq = num(d.wcReq);
      const cost = fixed + prelim + wcReq, capital0 = num(d.capitalExisting) + num(d.capital), P = num(d.termLoan), cc = num(d.wcLimit), uns = num(d.unsecured), subsidy = num(d.subsidy);
      const means = capital0 + subsidy + uns + P + cc;
      // Depreciation on the written-down value; the other costs of the project are written off over five years
      const dep = assets.map(a => { let w = a.cost; return Y.map(() => { const open = w, v = open * a.rate / 100; w = open - v; return { open, dep: v, close: w }; }); });
      const depY = Y.map(y => dep.reduce((s, a) => s + a[y].dep, 0)), nfa = Y.map(y => dep.reduce((s, a) => s + a[y].close, 0));
      const amort = Y.map(y => y < 5 ? prelim / 5 : 0), prelimLeft = Y.map(y => prelim - amort.slice(0, y + 1).reduce((s, v) => s + v, 0));
      /* Term loan: repaid in equal amounts a year over its period (a loan of 2 lacs for 5 years: 0.40 a year), the
         first year in the instalments left after the moratorium (6 of them with 6 months of it) and 12 a year after.
         The schedule runs month by month: nothing but interest in the moratorium, then an instalment a month, the
         interest of a month on its opening balance. The year-wise schedule and every statement take the totals of
         the months, so the detailed schedule and the summary always agree. */
      const months = Math.max(1, r0(d.tlMonths) || 1), mor = Math.max(0, Math.min(11, r0(d.tlMoratorium))), loanYears = Math.max(1, Math.ceil(months / 12)), perYear = P / loanYears;
      const sched = []; let bal = P, instNo = 0;
      for (let y = 0; y < loanYears; y++) {
        const inst = perYear / (y === 0 ? 12 - mor : 12);
        for (let m = 0; m < 12; m++) { const open = bal, pays = y > 0 || m >= mor, principal = pays ? Math.min(open, inst) : 0; bal = open - principal; sched.push({ y, m, no: pays && principal > 0.005 ? ++instNo : 0, open, principal, interest: open * num(d.tlRate) / 1200, close: bal }); }
      }
      const tlAll = Array.from({ length: Math.max(n, loanYears) + 1 }, (_, y) => { const ms = sched.filter(x => x.y === y); return ms.length ? { open: ms[0].open, repaid: ms.reduce((t, x) => t + x.principal, 0), close: ms[ms.length - 1].close, interest: ms.reduce((t, x) => t + x.interest, 0), count: ms.filter(x => x.no).length } : { open: 0, repaid: 0, close: 0, interest: 0, count: 0 }; });
      const tl = tlAll.slice(0, n), dueNext = Y.map(y => tlAll[y + 1].repaid);
      // Sales: by the capacity utilisation of every year when it is given (70, 80, 85: the last holds), else growing
      const g = (base, rate, y) => num(base) * Math.pow(1 + num(rate) / 100, y);
      const utilList = String(d.util || '').split(/[,\s]+/).map(num).filter(v => v > 0), util = utilList.length ? Y.map(y => utilList[Math.min(y, utilList.length - 1)]) : null;
      const sales = Y.map(y => util ? num(d.sales1) * util[y] / util[0] : g(d.sales1, d.growth, y)), miscIncome = Y.map(() => num(d.miscIncome)), income = Y.map(y => sales[y] + miscIncome[y]);
      const rm = sales.map(s => s * num(d.rmPct) / 100), power = sales.map(s => s * num(d.powerPct) / 100), wages = Y.map(y => g(d.wages1, d.wagesGrowth, y));
      const selling = Y.map(y => sales[y] * num(d.sellingPct) / 100 + g(d.admin1, d.adminGrowth, y)), repairs = Y.map(y => g(d.repairs1, d.repairsGrowth, y)), misc = Y.map(() => num(d.misc1));
      const intTl = tl.map(t => t.interest), intWc = Y.map(() => cc * num(d.wcRate) / 100), intUns = Y.map(() => uns * num(d.unsRate) / 100);
      const expend = Y.map(y => rm[y] + power[y] + wages[y] + intWc[y] + intUns[y] + intTl[y] + selling[y] + depY[y] + repairs[y] + misc[y] + amort[y]);
      const pbt = Y.map(y => income[y] - expend[y]), tax = pbt.map(p => Math.max(0, p) * num(d.taxPct) / 100), pat = Y.map(y => pbt[y] - tax[y]);
      // An amount for every year typed as a list (rupees; the last holds): null when nothing is typed
      const series = (text) => { const l = String(text == null ? '' : text).split(/[,;\s]+/).filter(t => t !== '').map(num); return l.length ? Y.map(y => l[Math.min(y, l.length - 1)]) : null; };
      const drawings = series(d.drawingsList) || Y.map(y => g(d.drawings, d.drawingsGrowth, y));
      /* Working capital, as the model report has it: raw material on the days of its consumption; stock in process
         and finished stock as the amounts given for every year (without them: the days of the cost of making, in one
         line); debtors and creditors as the amounts given, else on the days of sales and of purchases. */
      const rmStock = rm.map(v => v * num(d.rmDays) / 365), wipL = series(d.wipList), fgL = series(d.fgList), byList = !!(wipL || fgL);
      const wipStock = wipL || Y.map(() => 0), fgStock = fgL || (wipL ? Y.map(() => 0) : Y.map(y => (rm[y] + power[y] + wages[y] + repairs[y]) * num(d.fgDays) / 365)), stock = Y.map(y => rmStock[y] + wipStock[y] + fgStock[y]);
      const debtorL = series(d.debtorList), creditorL = series(d.creditorList), debtors = debtorL || sales.map(s => s * num(d.debtorDays) / 365), creditors = creditorL || rm.map(v => v * num(d.creditorDays) / 365);
      const advances = series(d.advancesList) || Y.map(() => 0);
      // Funds flow: what is left over is the increase in cash, so the balance sheet balances by it
      const prev = (a, y) => y ? a[y - 1] : 0;
      const src = Y.map(y => ({ capital: y ? 0 : capital0, subsidy: y ? 0 : subsidy, pat: pat[y], dep: depY[y], amort: amort[y], tl: y ? 0 : P, cc: y ? 0 : cc, unsecured: y ? 0 : uns, creditors: creditors[y] - prev(creditors, y) }));
      const app = Y.map(y => ({ fixed: y ? 0 : fixed, prelim: y ? 0 : prelim, stock: stock[y] - prev(stock, y), debtors: debtors[y] - prev(debtors, y), drawings: drawings[y], repaid: tl[y].repaid, advances: advances[y] - prev(advances, y) }));
      const sum = (o) => Object.keys(o).reduce((s, k) => s + o[k], 0);
      const srcTotal = src.map(sum), cashUp = Y.map(y => srcTotal[y] - sum(app[y])); const cash = []; cashUp.forEach((v, y) => cash.push((y ? cash[y - 1] : 0) + v));
      const capOpen = [], capClose = []; Y.forEach(y => { capOpen.push(y ? capClose[y - 1] : capital0); capClose.push(capOpen[y] + pat[y] - drawings[y]); });
      const netWorth = Y.map(y => capClose[y] + subsidy);
      const liab = Y.map(y => netWorth[y] + tl[y].close + cc + uns + creditors[y]), asset = Y.map(y => nfa[y] + prelimLeft[y] + stock[y] + debtors[y] + advances[y] + cash[y]);
      // Debt service coverage: the profit, the depreciation and every interest, against every interest and the repayment
      const dAvail = Y.map(y => pat[y] + depY[y] + amort[y] + intWc[y] + intTl[y] + intUns[y]), dDebt = Y.map(y => intWc[y] + intTl[y] + intUns[y] + tl[y].repaid);
      const dscr = Y.map(y => dDebt[y] > 0.005 ? dAvail[y] / dDebt[y] : NaN), good = dscr.filter(isFinite);
      // Break-even in the 3rd year of operation: [name, total, the part that moves with sales %]
      const by = Math.min(2, n - 1);
      const bepRows = [['Raw Material', rm[by], 100], ['Electricity & Diesel', power[by], 90], ['Wages & Salaries', wages[by], 80], ['Bank Interest & Charges', intWc[by], 0], ['Interest on Unsecured Loans', intUns[by], 0], ['Interest on Term Loans', intTl[by], 0], ['Selling & Adm. Charges', selling[by], 80], ['Repair & Consumables', repairs[by], 80], ['Other Misc Charges', misc[by], 80], ['Depreciation', depY[by] + amort[by], 0]]
        .map(r => ({ name: r[0], split: r[2], variable: r[1] * r[2] / 100, fixed: r[1] * (100 - r[2]) / 100, total: r[1] }));
      const bVar = bepRows.reduce((s, r) => s + r.variable, 0), bFix = bepRows.reduce((s, r) => s + r.fixed, 0), contribution = sales[by] - bVar;
      const ca = Y.map(y => stock[y] + debtors[y] + advances[y] + Math.max(0, cash[y])), cl = Y.map(y => cc + creditors[y] + dueNext[y] + Math.max(0, -cash[y]));
      return { n, Y, roman: Y.map(y => ROMAN[y]), fy: Y.map(y => U.fyLabel((r0(d.startYear) || U.fyFirstYear()) + y)), assets, other, fixed, fixedExisting, prelim, wcReq, cost, means, capital0, P, cc, uns, subsidy, dep, depY, nfa, amort, prelimLeft, tl, tlAll, sched, dueNext, months, mor, loanYears,
        util, sales, miscIncome, income, rm, power, wages, selling, repairs, misc, intTl, intWc, intUns, expend, pbt, tax, pat, drawings, rmStock, wipStock, fgStock, byList, debtorL, creditorL, stock, debtors, creditors, advances, src, app, srcTotal, cashUp, cash, capOpen, capClose, netWorth, liab, asset,
        dAvail, dDebt, dscr, dscrAvg: good.length ? good.reduce((s, v) => s + v, 0) / good.length : NaN, by, bepRows, bVar, bFix, contribution, bepPct: contribution > 0.005 ? bFix / contribution * 100 : NaN, ca, cl };
    },
    /* The annexures as tables: { title, heads, rows: [{ c: [cells], s: 0 line | 1 total | 2 heading }], pre: [[label,
       value]] printed above the table, note below it }. The figures are in lacs to two places, or in rupees. */
    sections(d, c) {
      const lacs = d.unit !== 'rs', f = (v) => { const a = Math.abs(num(v)), t = lacs ? (a / 100000).toFixed(2) : U.indianNumber(Math.round(a)).replace(/\.00$/, ''); return v < -0.005 ? '(' + t + ')' : t; };
      const unit = lacs ? 'Rs. In Lacs' : 'Rs.', yr = ['Year'].concat(c.roman), blank = c.Y.map(() => '');
      const L = (label, vals, s) => ({ c: [label].concat(vals.map(f)), s: s || 0 }), T = (label, vals, s) => ({ c: [label].concat(vals), s: s || 0 }), H = (label) => ({ c: [label].concat(blank), s: 2 });
      const all = (v) => c.Y.map(() => v), S = {};
      // Cost of project and means of finance: existing, proposed, total
      const cp = c.assets.map(a => ({ c: [a.name, f(a.existing), f(a.proposed), f(a.cost)], s: 0 })).concat(c.other.map(o => ({ c: [o.name, f(0), f(o.amount), f(o.amount)], s: 0 }))).concat(c.wcReq ? [{ c: ['Working Capital Requirement', f(0), f(c.wcReq), f(c.wcReq)], s: 0 }] : []);
      cp.push({ c: ['Total ' + unit, f(c.fixedExisting), f(c.cost - c.fixedExisting), f(c.cost)], s: 1 });
      const mf = [['Own Contribution', num(d.capitalExisting), num(d.capital)], ['Capital Subsidy', 0, c.subsidy], ['Term Loan', 0, c.P], ['Working Capital Limit Proposed', 0, c.cc], ['Unsecured Loans', 0, c.uns]].filter(r => r[1] + r[2] > 0.005).map(r => ({ c: [r[0], f(r[1]), f(r[2]), f(r[1] + r[2])], s: 0 }));
      mf.push({ c: ['Total ' + unit, f(num(d.capitalExisting)), f(c.means - num(d.capitalExisting)), f(c.means)], s: 1 });
      S.cost = { title: 'Cost of project', heads: ['Particulars', 'Existing', 'Proposed', 'Total'], rows: cp, unit };
      S.means = { title: 'Means of Finance', heads: ['Particulars', 'Existing', 'Proposed', 'Total'], rows: mf, unit };
      /* Repayment of the term loan, twice: the summary a year a line, and the schedule in detail a month a line (in
         rupees: an instalment is too small to show in lacs), each year closing on the figures of the summary. */
      const fyM = (global.Store && Store.uid != null ? parseInt(Store.company().fyMonth, 10) : 0) || 4, y0 = r0(d.startYear) || U.fyFirstYear(), MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthOf = (x) => { const at = fyM - 1 + x.m; return MON[at % 12] + ' ' + (y0 + x.y + (at >= 12 ? 1 : 0)); }, yearOf = (y) => (ROMAN[y] || (y + 1) + 'th') + ' year (' + U.fyLabel(y0 + y) + ')';
      const rs = (v) => U.indianNumber(Math.round(num(v))).replace(/\.00$/, ''), loanY = c.tlAll.map((t, y) => y).filter(y => c.tlAll[y].open > 0.005), tot = (k) => loanY.reduce((t, y) => t + c.tlAll[y][k], 0), insts = c.sched.filter(x => x.no).length;
      S.repayment = { title: 'Calculation of Interest & Repayment Schedule :', sub: '(Summary, year-wise)', unit, pre: [['Amount of Loan', f(c.P) + (lacs ? ' Lacs' : '')], ['Rate of Interest', num(d.tlRate).toFixed(2) + '% P.A., on the opening balance of every month'], ['Repayment Period', c.loanYears + ' Years: ' + insts + ' monthly instalments' + (c.mor ? ' after a moratorium of ' + c.mor + ' months' : '')]],
        heads: ['Year', 'No. of Instalments', 'Opening Balance', 'Repayment Amount', 'Interest', 'Total Outgo', 'Closing Balance'],
        rows: loanY.map(y => { const t = c.tlAll[y]; return { c: [yearOf(y), String(t.count), f(t.open), f(t.repaid), f(t.interest), f(t.repaid + t.interest), f(t.close)], s: 0 }; }).concat(loanY.length ? [{ c: ['Total', String(insts), '', f(tot('repaid')), f(tot('interest')), f(tot('repaid') + tot('interest')), ''], s: 1 }] : []) };
      const det = [];
      loanY.forEach(y => { const ms = c.sched.filter(x => x.y === y), t = c.tlAll[y];
        det.push({ c: [yearOf(y), '', '', '', '', '', ''], s: 2 });
        ms.forEach(x => det.push({ c: [monthOf(x), x.no ? String(x.no) : 'Moratorium', rs(x.open), rs(x.principal), rs(x.interest), rs(x.principal + x.interest), rs(x.close)], s: 0 }));
        det.push({ c: ['Total of the ' + (ROMAN[y] || (y + 1) + 'th') + ' year', String(t.count), '', rs(t.repaid), rs(t.interest), rs(t.repaid + t.interest), rs(t.close)], s: 1 }); });
      if (loanY.length) det.push({ c: ['Total of the loan', String(insts), '', rs(tot('repaid')), rs(tot('interest')), rs(tot('repaid') + tot('interest')), ''], s: 1 });
      S.repaymentDetail = { title: 'Repayment Schedule in detail :', sub: '(Month by month: the instalment, the interest of the month and the balance)', unit: 'Rs.', heads: ['Month', 'Instalment No.', 'Opening Balance', 'Principal', 'Interest', 'Total Payment', 'Closing Balance'], rows: det };
      // Depreciation: the years down the page, the assets across it
      const dr = [{ c: ['', 'Rate of Depreciation'].concat(c.assets.map(a => a.rate + '%')).concat(['']), s: 0 }];
      c.Y.forEach(y => { if (!y) dr.push({ c: [c.roman[0], 'Cost'].concat(c.assets.map(a => f(a.cost))).concat([f(c.fixed)]), s: 0 });
        dr.push({ c: [y ? c.roman[y] : '', 'Depreciation'].concat(c.assets.map((a, i) => f(c.dep[i][y].dep))).concat([f(c.depY[y])]), s: 0 }); dr.push({ c: ['', 'WDV'].concat(c.assets.map((a, i) => f(c.dep[i][y].close))).concat([f(c.nfa[y])]), s: 1 }); });
      S.depreciation = { title: 'Calculation of Depreciation :', heads: ['Year', 'Particulars'].concat(c.assets.map(a => a.name)).concat(['Total']), rows: dr };
      S.profit = { title: 'Projected profitability Statement for the year ended :', heads: yr, rows: (c.util ? [T('Capacity utilization', c.util.map(u => u + '%'))] : []).concat([H('A. Income'), L('Sales', c.sales), L('Misc. Receipts', c.miscIncome), L(unit, c.income, 1), H('B. Expenditure'), L('Raw Material', c.rm), L('Electricity & Diesel', c.power), L('Wages & Salaries', c.wages), L('Bank Interest & Charges', c.intWc), L('Interest on Unsecured Loans', c.intUns), L('Interest on Term Loan', c.intTl),
        L('Selling & Adm. Charges', c.selling), L('Depreciation', c.depY), L('Repairs & Consumables', c.repairs), L('Other Misc Charges', c.misc)]).concat(c.prelim ? [L('Preliminary Expenses written off', c.amort)] : []).concat([L(unit, c.expend, 1), L('C. Net Profit before tax', c.pbt, 1), L('D. Income Tax', c.tax, 1), L('E. Profit after tax (C-D)', c.pat, 1)]) };
      const wcl = (label, days, vals, s) => ({ c: [label, days].concat(vals.map(f)), s: s || 0 });
      S.wc = { title: 'Calculation of working capital requirement :', heads: ['Particulars', 'Days'].concat(c.roman.map(r => r + ' year')), rows: [wcl('Raw Material', String(num(d.rmDays)), c.rmStock)].concat(c.byList ? [wcl('Stock in process', '', c.wipStock), wcl('Finished stock', '', c.fgStock)] : [wcl('Stock in process & Finished stock', String(num(d.fgDays)), c.fgStock)]).concat([wcl('', '', c.stock, 1), wcl('Add Sundry Debtors', c.debtorL ? '' : String(num(d.debtorDays)), c.debtors), wcl('', '', c.Y.map(y => c.stock[y] + c.debtors[y]), 1), wcl('Less Sundry Creditors', c.creditorL ? '' : String(num(d.creditorDays)), c.creditors), wcl('Total ' + unit, '', c.Y.map(y => c.stock[y] + c.debtors[y] - c.creditors[y]), 1)]) };
      S.balance = { title: 'Balance Sheet at the end of the year :', heads: yr, rows: [H('LIABILITIES'), H('Capital Fund'), L('Opening Balance', c.capOpen), L('Add Net Profit', c.pat), L('', c.Y.map(y => c.capOpen[y] + c.pat[y]), 1), L('Less Drawings', c.drawings), L('', c.capClose, 1)].concat(c.subsidy ? [L('Capital Subsidy', all(c.subsidy))] : []).concat([H('Secured Loans from Bank :'), L('Term Loan', c.tl.map(t => t.close)), L('Cash Credit Limit', all(c.cc)), H('Unsecured Loans:'), L('From Friends and Relatives', all(c.uns)), H('Current Liabilities :'), L('Sundry Creditors', c.creditors), L(unit, c.liab, 1),
        H('ASSETS :'), L('Fixed Assets', c.nfa)]).concat(c.prelim ? [L('Preliminary Expenses not written off', c.prelimLeft)] : []).concat([H('Current Assets'), L('Closing Stock', c.stock), L('Sundry Debtors & Advances', c.debtors)]).concat(c.advances.some(v => v > 0.005) ? [L('Advances & Securities', c.advances)] : []).concat([L('Cash & Bank Balances', c.cash), L(unit, c.asset, 1)]) };
      S.funds = { title: 'Funds Flow Statement for the year ended :', heads: yr, rows: [H('Sources of funds'), L('Capital Introduced', c.src.map(s => s.capital))].concat(c.subsidy ? [L('Capital Subsidy', c.src.map(s => s.subsidy))] : []).concat([L('Net profit after tax', c.src.map(s => s.pat)), L('Depreciation', c.src.map(s => s.dep))]).concat(c.prelim ? [L('Preliminary Expenses written off', c.src.map(s => s.amort))] : []).concat([H('Secured Loans from Bank :'), L('Term Loan', c.src.map(s => s.tl)), L('Cash Credit Limit', c.src.map(s => s.cc)), L('Increase in Unsecured Loans', c.src.map(s => s.unsecured)), L('Increase in Creditors', c.src.map(s => s.creditors)), L(unit, c.srcTotal, 1),
        H('Application of Funds'), L('Purchase of Fixed Assets', c.app.map(a => a.fixed))]).concat(c.prelim ? [L('Preliminary & Pre-operative Expenses', c.app.map(a => a.prelim))] : []).concat([L('Increase in closing stock', c.app.map(a => a.stock)), L('Increase in Debtors', c.app.map(a => a.debtors)), L('Drawings', c.app.map(a => a.drawings)), L('Repayment of Loan', c.app.map(a => a.repaid))]).concat(c.advances.some(v => v > 0.005) ? [L('Increase in Misc. Assets', c.app.map(a => a.advances))] : []).concat([L('Increase in Cash & Bank Balances', c.cashUp), L(unit, c.srcTotal, 1)]) };
      S.dscr = { title: 'Calculation of Debt Service Coverage Ratio :', heads: yr, rows: [H('Funds Available for services :'), L('Net profit for the Year', c.pat), L('Depreciation', c.Y.map(y => c.depY[y] + c.amort[y])), L('Interest on Bank Loans', c.intWc), L('Interest on Term Loan', c.intTl), L('Interest on Unsecured Loans', c.intUns), L(unit, c.dAvail, 1), H('Debts to be Served :'), L('Interest on Bank Loans', c.intWc), L('Interest on Term Loan', c.intTl), L('Repayment of Term Loan', c.tl.map(t => t.repaid)), L('Interest on Unsecured Loans', c.intUns), L(unit, c.dDebt, 1),
        T('DSCR', c.dscr.map(x2), 1), T('Average DSCR', [x2(c.dscrAvg)].concat(blank.slice(1)), 1)] };
      S.bep = { title: 'Calculation of Break Even Point :', heads: ['Particulars', 'Variable', 'Fixed', 'Total'],
        rows: c.bepRows.map(r => ({ c: [r.name + (r.split > 0 && r.split < 100 ? ' (' + r.split + ':' + (100 - r.split) + ')' : ''), f(r.variable), f(r.fixed), f(r.total)], s: 0 })).concat([{ c: ['', f(c.bVar), f(c.bFix), f(c.bVar + c.bFix)], s: 1 }, { c: ['Sales', f(c.sales[c.by]), '', ''], s: 0 }, { c: ['Contribution', f(c.contribution), '', ''], s: 1 }, { c: ['Break Even Point = Fixed Exps. / Contribution x 100', isFinite(c.bepPct) ? c.bepPct.toFixed(2) + '%' : 'n/a', '', ''], s: 1 }]) };
      S.ratios = { title: 'Ratios :', heads: yr, rows: [H('Liquidity'), L('Current assets', c.ca), L('Current liabilities (with the term loan due within 12 months)', c.cl), T('Current ratio', c.Y.map(y => x2(c.cl[y] > 0.005 ? c.ca[y] / c.cl[y] : NaN)), 1), L('Net working capital', c.Y.map(y => c.ca[y] - c.cl[y])),
        H('Leverage'), T('Debt-equity (term loan : net worth)', c.Y.map(y => x2(c.netWorth[y] > 0.005 ? c.tl[y].close / c.netWorth[y] : NaN))), T('TOL / TNW (outside liabilities : net worth)', c.Y.map(y => x2(c.netWorth[y] > 0.005 ? (c.liab[y] - c.netWorth[y]) / c.netWorth[y] : NaN))),
        H('Profitability'), T('Net profit before tax to sales', c.Y.map(y => pct(c.pbt[y], c.sales[y]))), T('Net profit after tax to sales', c.Y.map(y => pct(c.pat[y], c.sales[y]))), T('Return on net worth', c.Y.map(y => pct(c.pat[y], c.netWorth[y]))),
        H('Coverage'), T('Interest coverage (profit before interest and tax : interest)', c.Y.map(y => { const i = c.intTl[y] + c.intWc[y] + c.intUns[y]; return x2(i > 0.005 ? (c.pbt[y] + i) / i : NaN); })), T('DSCR', c.dscr.map(x2), 1)] };
      Object.keys(S).forEach(k => { if (S[k].heads === yr) S[k].fy = c.fy; });
      S.bep.sub = '(In the ' + ['1st', '2nd', '3rd'][c.by] + ' year of operation)';
      /* Cash flow statement (the second layout): a column for the construction period, when the capital and the loans
         come in and the fixed assets are bought, then the years; the closing balance is the cash of the balance sheet. */
      const ordinal = c.Y.map(y => ['Ist', '2nd', '3rd'][y] || (y + 1) + 'th'), cy = ['Particulars', 'Construction Period'].concat(ordinal.map(o => o + ' Year')), C0 = (label, first, vals, s) => ({ c: [label, f(first)].concat(vals.map(f)), s: s || 0 }), zero = c.Y.map(() => 0);
      const intAll = c.Y.map(y => c.intTl[y] + c.intWc[y] + c.intUns[y]), accr = c.Y.map(y => c.pat[y] + intAll[y]), depA = c.Y.map(y => c.depY[y] + c.amort[y]), credUp = c.src.map(s => s.creditors), emi = c.Y.map(y => c.tl[y].repaid + intAll[y]);
      const equity0 = c.capital0 + c.subsidy + c.uns, loan0 = c.P + c.cc, srcY = c.Y.map(y => accr[y] + depA[y] + credUp[y]), dispY = c.Y.map(y => c.app[y].stock + emi[y] + c.app[y].debtors + c.app[y].advances + c.app[y].drawings), net0 = equity0 + loan0 - c.fixed - c.prelim, netY = c.Y.map(y => srcY[y] - dispY[y]);
      const closing = []; netY.forEach((v, y) => closing.push((y ? closing[y - 1] : net0) + v));
      S.cashflow = { title: 'CASH FLOW STATEMENT', heads: cy, rows: [{ c: ['A. Source Funds :'].concat(cy.slice(1).map(() => '')), s: 2 }, C0('1. Cash Accruals (Net Profit + Interest)', 0, accr), C0('2. Depreciation', 0, depA), C0('3. Equity (capital, subsidy, unsecured loans)', equity0, zero), C0('4. Bank Loan (term loan, working capital limit)', loan0, zero), C0('5. Increase in Creditors', 0, credUp), C0('Total Sources', equity0 + loan0, srcY, 1),
        { c: ['B. Disposition of Funds :'].concat(cy.slice(1).map(() => '')), s: 2 }, C0('1. Preliminary and Pre-operative Expenses', c.prelim, zero), C0('2. Increase in Raw Material and Stock', 0, c.app.map(a => a.stock)), C0('3. Increase in fixed assets', c.fixed, zero), C0('4. EMI (repayment and interest)', 0, emi), C0('5. Increase in Receivables', 0, c.app.map(a => a.debtors + a.advances)), C0('6. Drawing', 0, c.app.map(a => a.drawings)), C0('Total Disposition', c.fixed + c.prelim, dispY, 1),
        C0('C. Net Surplus (A - B)', net0, netY, 1), C0('D. Closing Balance', net0, closing, 1)] };
      // Projected balance sheet in the order of the Schedule: equity and liabilities, then assets with the gross block and the depreciation to date
      const by3 = ['Particulars'].concat(ordinal.map(o => o + ' Year')), accDep = c.Y.map(y => c.fixed - c.nfa[y]);
      S.balance3 = { title: 'PROJECTED BALANCE SHEET', heads: by3, rows: [H('I. EQUITY AND LIABILITIES'), H("(1) Shareholder's Funds"), L('(a) Capital: Opening Balance', c.capOpen), L('(b) Net Profit', c.pat), L('Less: Drawing', c.drawings), L('Reserve & surplus (capital subsidy)', all(c.subsidy)), L("Shareholder's funds", c.netWorth, 1), H('(2) Non-current Liabilities'), L('Long-term borrowings: Term loan', c.tl.map(t => t.close)), L('Long-term borrowings: Unsecured loans', all(c.uns)),
        H('(3) Current Liabilities'), L('Short-term borrowings: Working capital limit', all(c.cc)), L('Trade payables', c.creditors), L('Total', c.liab, 1), H('II. ASSETS'), H('(1) Non-current assets'), L('A. Fixed Assets: Gross Block', all(c.fixed)), L('Less : Depreciation', accDep), L('Net Block', c.nfa, 1), L('Other non-current assets', c.prelimLeft),
        H('(2) Current assets'), L('Inventories', c.stock), L('Trade receivables', c.debtors), L('Cash and cash equivalents', c.cash), L('Other current assets', c.advances), L('Total', c.asset, 1)] };
      return { S, f, unit, lacs };
    },
    // A section as an HTML table (the screen and the printed report share it; in print the years carry their financial year)
    table(sec, id, print) {
      const cols = sec.heads.length;
      return '<table class="list stmt prt' + (cols > 8 ? ' wide' : '') + '"' + (id ? ' id="' + id + '"' : '') + '><thead><tr>' + sec.heads.map((h, i) => '<th' + (i ? ' class="num"' : '') + '>' + esc(h) + (print && sec.fy && i ? '<span class="fy">' + esc(sec.fy[i - 1] || '') + '</span>' : '') + '</th>').join('') + '</tr></thead><tbody>' +
        sec.rows.map(r => r.s === 2 ? '<tr class="grp"><td class="left" colspan="' + cols + '"><b>' + esc(r.c[0]) + '</b></td></tr>' : '<tr' + (r.s === 1 ? ' class="total"' : '') + '>' + r.c.map((v, i) => '<td class="' + (i ? 'num' : 'left') + '">' + esc(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    },
    pre(sec) { return (sec.pre || []).length ? '<table class="prpre"><tbody>' + sec.pre.map(p => '<tr><td>' + esc(p[0]) + '</td><td><b>' + esc(p[1]) + '</b></td></tr>').join('') + '</tbody></table>' : ''; },
    // The printed report: Calibri throughout, the statements as ruled tables under a dark heading row
    FONT: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif',
    docCss() {
      const navy = '#1F3864';
      return '.prdoc { font-family: ' + this.FONT + '; font-size: 11pt; color: #111; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .prdoc * { font-family: inherit; } .prdoc .pg { page-break-before: always; }' +
        '.prdoc .cover { text-align: center; padding-top: 150pt; min-height: 600pt; } .prdoc .cover h1 { font-size: 30pt; letter-spacing: 2pt; margin: 0 0 22pt; color: ' + navy + '; } .prdoc .cover .rule { width: 120pt; height: 2.5pt; background: ' + navy + '; margin: 0 auto 26pt; } .prdoc .cover .of { font-size: 15pt; margin: 0 0 24pt; color: #444; } .prdoc .cover .nm { font-size: 22pt; font-weight: bold; margin-bottom: 8pt; } .prdoc .cover .ad { font-size: 14pt; font-weight: bold; color: #333; }' +
        '.prdoc h3 { font-size: 13pt; color: ' + navy + '; margin: 14pt 0 8pt; padding-bottom: 2pt; border-bottom: 1pt solid ' + navy + '; } .prdoc h4 { font-size: 11.5pt; color: ' + navy + '; margin: 8pt 0 3pt; } .prdoc p { margin: 0 0 8pt; text-align: justify; }' +
        '.prdoc .ph { text-align: center; font-weight: bold; font-size: 11.5pt; margin-bottom: 8pt; padding-bottom: 4pt; border-bottom: 0.75pt solid #999; } .prdoc .an { float: right; font-weight: bold; font-size: 10pt; color: ' + navy + '; margin-top: 9pt; } .prdoc .pu { text-align: right; font-size: 9pt; font-style: italic; color: #333; margin: 2pt 0; } .prdoc .gap { height: 14pt; }' +
        '.prdoc table { border-collapse: collapse; width: 100%; } .prdoc table.prkv td { padding: 7pt 4pt; vertical-align: top; } .prdoc table.prkv td:first-child { width: 26pt; } .prdoc table.prkv td:nth-child(2) { width: 42%; font-weight: bold; } .prdoc table.pry { width: 70%; margin: 0 0 8pt 20pt; } .prdoc table.pry td { padding: 2pt 4pt; } .prdoc table.pry .num { text-align: right; } .prdoc table.prpre { width: auto; margin: 0 0 6pt; } .prdoc table.prpre td { padding: 1.5pt 14pt 1.5pt 0; font-size: 10pt; }' +
        '.prdoc table.prt th, .prdoc table.prt td { border: 0.5pt solid #7F8FA9; padding: 3.2pt 5pt; font-size: 9.5pt; } .prdoc table.prt.wide th, .prdoc table.prt.wide td { font-size: 8.5pt; padding: 3pt 3.5pt; } .prdoc table.prt th { background: ' + navy + '; color: #fff; font-weight: bold; text-align: left; vertical-align: middle; } .prdoc table.prt th.num { text-align: right; } .prdoc table.prt th .fy { display: block; font-weight: normal; font-size: 7.5pt; }' +
        '.prdoc table.prt .num { text-align: right; white-space: nowrap; } .prdoc table.prt td.left { text-align: left; } .prdoc table.prt tr.total td { font-weight: bold; background: #EEF2F8; border-top: 1pt solid ' + navy + '; } .prdoc table.prt tr.grp td { background: #DCE6F1; color: ' + navy + '; }' +
        '.prdoc .flow { text-align: center; margin: 12pt 0; } .prdoc .flow div.st { display: inline-block; border: 0.8pt solid ' + navy + '; background: #EEF2F8; padding: 6pt 16pt; min-width: 180pt; } .prdoc .flow div.ar { font-size: 16pt; line-height: 1.2; color: ' + navy + '; }' +
        // The pages the protected print is made of (paginate): A4 at 96 dots an inch
        '.prdoc .prpage { position: relative; box-sizing: border-box; width: ' + this.PAGE.w + 'px; height: ' + this.PAGE.h + 'px; padding: ' + this.PAGE.mt + 'px ' + this.PAGE.mx + 'px ' + this.PAGE.mb + 'px; overflow: hidden; background: #fff; } .prdoc .prpage .pg { page-break-before: auto; } .prdoc .prcover { padding: 34px; } .prdoc .prcover .prin { box-sizing: border-box; height: 100%; border: 2.5pt double ' + navy + '; } .prdoc .prcover .cover { min-height: 0; }' +
        '.prdoc .prft { position: absolute; left: ' + this.PAGE.mx + 'px; right: ' + this.PAGE.mx + 'px; bottom: 18px; display: flex; justify-content: space-between; font-size: 8pt; color: #555; border-top: 0.5pt solid #bbb; padding-top: 3px; }';
    },
    // One sheet of statements under the name and address of the unit: [keys of sections], an annexure number when given
    sheet(d, R, keys, annexNo) {
      const S = R.S;
      return '<div class="pg">' + (annexNo ? '<div class="an">Annexure - ' + annexNo + '</div>' : '') + '<div class="ph">' + esc(this.headLine(d)) + '</div>' + keys.map(k => '<h4>' + esc(S[k].title) + '</h4>' + (S[k].sub ? '<div class="pu" style="text-align:left">' + esc(S[k].sub) + '</div>' : '') + this.pre(S[k]) + '<div class="pu">Amount (' + (S[k].unit || R.unit) + ')</div>' + this.table(S[k], '', true)).join('<div class="gap"></div>') + '</div>';
    },
    doc(sheets) { return '<div class="prdoc"><style>' + this.docCss() + '</style>' + sheets + '</div>'; },
    /* The whole report as one document in the bank's layout: the cover, the introduction, the narrative, the cost and
       the means, the turnover, then every annexure on a page of its own under the name and address of the unit. */
    reportBody(d, c, R) {
      const f = R.f, name = this.unitName(d).toUpperCase(), ms = /^M\/S/i.test(name) ? name : 'M/S ' + name;
      const kv = [['NAME OF THE UNIT', ms], ['CONSTITUTION', d.constitution], ['ADDRESS OF THE FIRM', d.address], ['CORRESPONDENCE ADDRESS', d.corrAddress], [/partner/i.test(d.constitution) ? "PARTNER'S NAME" : /compan|limited|ltd/i.test(d.constitution) ? "DIRECTOR'S NAME" : "PROPRIETOR'S NAME", d.partners], ['TYPE OF INDUSTRY', d.industry], ['CLASSIFICATION', d.classification], ['CATEGORY', d.category], ['WHETHER ITEM RESERVED FOR SSI', d.reserved]].filter(r => String(r[1] || '').trim());
      const para = (t) => lines(t).map(l => '<p>' + esc(l) + '</p>').join('');
      const sect = []; let no = 1;
      const add = (title, html) => { if (html) sect.push('<div class="ps"><h3>' + (++no) + '. ' + esc(title) + '</h3>' + html + '</div>'); };
      add("BRIEF HISTORY, CONSTITUTION & PROMOTERS' BACKGROUND", para(d.history)); add('LAND', para(d.land)); add('INVESTMENTS', para(d.investments)); add('VIABILITY', para(d.viability));
      const steps = lines(d.process), procNo = steps.length ? ++no : 0;
      const cost = '<div class="ps"><h3>' + (++no) + '. COST OF THE PROJECT</h3><div class="pu">(Figures in ' + (R.lacs ? 'Lacs' : 'Rupees') + ')</div><table class="prt"><thead><tr><th>COST OF PROJECT</th><th class="num">Amt. to be incurred</th><th class="num">Total Cost</th></tr></thead><tbody>' +
        c.assets.map(a => '<tr><td>' + esc(a.name) + '</td><td class="num">' + (a.proposed ? f(a.proposed) : 'Already Owned') + '</td><td class="num">' + f(a.cost) + '</td></tr>').join('') + c.other.map(o => '<tr><td>' + esc(o.name) + '</td><td class="num">' + f(o.amount) + '</td><td class="num">' + f(o.amount) + '</td></tr>').join('') + (c.wcReq ? '<tr><td>Working Capital Requirement</td><td class="num">' + f(c.wcReq) + '</td><td class="num">' + f(c.wcReq) + '</td></tr>' : '') +
        '<tr class="total"><td>TOTAL</td><td class="num">' + f(c.cost - c.fixedExisting) + '</td><td class="num">' + f(c.cost) + '</td></tr></tbody></table>' +
        '<div class="gap"></div><table class="prt"><thead><tr><th>MEANS OF FINANCING</th><th class="num">Amt. to be raised</th><th class="num">Total Cost</th></tr></thead><tbody>' + [['Capital Account', num(d.capital), c.capital0], ['Capital Subsidy', c.subsidy, c.subsidy], ['Unsecured Loan', c.uns, c.uns], ['Working Capital Limit Proposed', c.cc, c.cc], ['Term Loan (Proposed)', c.P, c.P]].filter(r => r[2] > 0.005).map(r => '<tr><td>' + r[0] + '</td><td class="num">' + f(r[1]) + '</td><td class="num">' + f(r[2]) + '</td></tr>').join('') +
        '<tr class="total"><td>TOTAL</td><td class="num">' + f(c.means - num(d.capitalExisting)) + '</td><td class="num">' + f(c.means) + '</td></tr></tbody></table></div>';
      const yearList = (vals) => '<table class="pry"><tbody>' + c.Y.map(y => '<tr><td>' + ROMAN[y] + ' year</td><td class="num">' + f(vals[y]) + (R.lacs ? ' LACS' : '') + '</td></tr>').join('') + '</tbody></table>';
      const tn = ++no, pn = ++no, sn = ++no, bn = ++no;
      const AN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']; let an = 0;
      const annex = (keys) => this.sheet(d, R, keys, AN[an++]);
      return this.doc(
        '<div class="cover"><h1>PROJECT REPORT</h1><div class="rule"></div><div class="of">OF</div><div class="nm">' + esc(ms) + ',</div>' + lines(d.address).map(l => '<div class="ad">' + esc(l.toUpperCase()) + '</div>').join('') + '</div>' +
        '<div class="pg"><h3>1. INTRODUCTION</h3><table class="prkv"><tbody>' + kv.map((r, i) => '<tr><td>' + String.fromCharCode(65 + i) + ')</td><td>' + esc(r[0]) + '</td><td>' + lines(r[1]).map(l => esc(l.toUpperCase())).join('<br>') + '</td></tr>').join('') + '</tbody></table></div>' +
        (sect.length ? '<div class="pg">' + sect.join('') + '</div>' : '') +
        (steps.length ? '<div class="pg"><h3>' + procNo + '. MANUFACTURING PROCESS</h3><p style="text-align:center">A summarized process for ' + esc(d.industry || 'the unit') + '</p><div class="flow">' + steps.map((st, i) => (i ? '<div class="ar">↓</div>' : '') + '<div><div class="st">' + esc(st) + '</div></div>').join('') + '</div></div>' : '') +
        '<div class="pg">' + cost + '</div>' +
        '<div class="pg"><div class="ps"><h3>' + tn + '. TURNOVER</h3><p>On the basis of the demand the expected turnover of the ' + (/partner/i.test(d.constitution) ? 'firm' : 'unit') + ' will be as under:-</p>' + yearList(c.sales) + '</div>' +
        '<div class="ps"><h3>' + pn + '. PURCHASE COST OF GOODS SOLD</h3><p>On the basis of expected turnover the estimated purchase of Raw Materials and Consumables are as under:-</p>' + yearList(c.rm) + '</div>' +
        '<div class="ps"><h3>' + sn + '. PROJECTED PROFITABILITY STATEMENT</h3><p>Detail of projected profitability statement has been given as per annexure attached.</p></div><div class="ps"><h3>' + bn + '. PROJECTED BALANCE SHEET</h3><p>Detail of projected balance sheet has been given as per annexure attached.</p></div></div>' +
        annex(['cost', 'means']) + annex(['repayment']) + annex(['repaymentDetail']) + annex(['depreciation']) + annex(['profit']) + annex(['wc']) + annex(['balance']) + annex(['funds']) + annex(['dscr']) + annex(['bep']) + annex(['ratios']));
    },
    reportHtml(d, c, R) { return Print.page('Project report - ' + this.unitName(d), Print.PAPERS.A4.css, '14mm 12mm', this.reportBody(d, c, R)); },

    /* ---- the protected print
       A project report leaves as a PDF that can be read and printed, not copied: the pages are laid out here (A4, the
       long tables carried over with their heading row, the unit and the page number at the foot), each page is drawn
       as a picture, and the pictures are what the print dialog gets. A PDF saved from it has no text to select.
       A browser that will not hand the picture back (Safari) prints the report as text, with a note. */
    PAGE: { w: 794, h: 1123, mx: 46, mt: 46, mb: 52 },
    paginate(body, foot) {
      const P = this.PAGE, innerH = P.h - P.mt - P.mb, host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-30000px;top:0;width:' + P.w + 'px;visibility:hidden;pointer-events:none;';
      host.innerHTML = body; document.body.appendChild(host);
      const src = host.firstElementChild, css = src.querySelector('style').textContent, sheets = Array.from(src.children).filter(e => e.tagName !== 'STYLE');
      const stage = document.createElement('div'); stage.className = 'prdoc'; stage.innerHTML = '<style>' + css + '</style>'; host.appendChild(stage);
      const pages = [];
      const page = (cover) => { const pg = document.createElement('div'); pg.className = 'prpage' + (cover ? ' prcover' : ''); const inner = document.createElement('div'); inner.className = 'prin'; pg.appendChild(inner); stage.appendChild(pg); pages.push(pg); return inner; };
      sheets.forEach(sheet => {
        if (sheet.classList.contains('cover')) { page(true).appendChild(sheet); return; }
        let inner = page(false);
        // A numbered section (.ps) is laid out part by part, so a long one runs over the page
        const blocks = []; Array.from(sheet.children).forEach(el => { if (el.classList.contains('ps')) Array.from(el.children).forEach(x => blocks.push(x)); else blocks.push(el); });
        blocks.forEach(node => {
          inner.appendChild(node);
          if (inner.offsetHeight <= innerH) return;
          const long = node.tagName === 'TABLE' && node.classList.contains('prt') && node.tBodies[0] && node.tBodies[0].rows.length > 3;
          // Too little room left for a table to begin, or a block that does not divide: it starts the next page
          if (inner.children.length > 1 && (!long || node.offsetTop - inner.offsetTop > innerH * 0.72)) { inner = page(false); inner.appendChild(node); if (inner.offsetHeight <= innerH) return; }
          if (!long) return;
          let cur = node;
          for (let guard = 0; guard < 60 && inner.offsetHeight > innerH; guard++) {
            const tb = cur.tBodies[0], moved = [];
            while (inner.offsetHeight > innerH && tb.rows.length > 1) moved.unshift(tb.removeChild(tb.lastElementChild));
            if (!moved.length) break;
            // A heading row is not left alone at the foot of a page
            if (tb.rows.length > 1 && tb.lastElementChild.classList.contains('grp')) moved.unshift(tb.removeChild(tb.lastElementChild));
            inner = page(false);
            const next = cur.cloneNode(false), body2 = document.createElement('tbody'), note = document.createElement('div');
            if (cur.tHead) next.appendChild(cur.tHead.cloneNode(true));
            moved.forEach(r => body2.appendChild(r)); next.appendChild(body2);
            note.className = 'pu'; note.style.textAlign = 'left'; note.textContent = '(continued)';
            inner.appendChild(note); inner.appendChild(next); cur = next;
          }
        });
      });
      pages.forEach((pg, i) => { if (pg.classList.contains('prcover')) return; const ft = document.createElement('div'); ft.className = 'prft'; ft.innerHTML = '<span>' + esc(foot || '') + '</span><span>Page ' + (i + 1) + ' of ' + pages.length + '</span>'; pg.appendChild(ft); });
      const out = pages.map(pg => new XMLSerializer().serializeToString(pg));
      host.remove();
      return { css, pages: out };
    },
    // One page as a picture (a data: address of a PNG), drawn through an SVG so the page looks exactly as laid out
    picture(css, xhtml, scale) {
      const P = this.PAGE;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + P.w * scale + '" height="' + P.h * scale + '" viewBox="0 0 ' + P.w + ' ' + P.h + '"><foreignObject x="0" y="0" width="' + P.w + '" height="' + P.h + '"><div xmlns="http://www.w3.org/1999/xhtml" class="prdoc"><style>' + css.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</style>' + xhtml + '</div></foreignObject></svg>';
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { try { const cv = document.createElement('canvas'); cv.width = P.w * scale; cv.height = P.h * scale; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height); resolve(cv.toDataURL('image/png')); } catch (e) { reject(e); } };
        img.onerror = () => reject(new Error('The page could not be drawn'));
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
    },
    async protectedHtml(body, title, foot) {
      const laid = this.paginate(body, foot), pics = [];
      for (const pg of laid.pages) pics.push(await this.picture(laid.css, pg, 2));
      return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>@page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; -webkit-user-select: none; user-select: none; } img { display: block; width: 210mm; height: 296.6mm; page-break-after: always; break-after: page; } img:last-child { page-break-after: auto; break-after: auto; }</style></head><body>' +
        pics.map((u, i) => '<img alt="Page ' + (i + 1) + '" src="' + u + '">').join('') + '</body></html>';
    },
    // Prints a report document (doc(...)): protected when the browser can, as text otherwise
    async print(body, title, d) {
      this.lastBody = body;
      UI.toast('Preparing the PDF…', 4000);
      let html;
      try { html = await this.protectedHtml(body, title, this.unitName(d)); }
      catch (e) { UI.toast('This browser cannot make the copy-protected PDF: the report prints as text.', 6000); html = Print.page(title, Print.PAPERS.A4.css, '14mm 12mm', body); }
      Print.show(html);
    },

    /* The second layout, after the usual outline of a project report for a bank loan: executive summary with the project
       cost and source of finance, project description with the product details, project plan with the cash flow
       statement, market analysis, management team with the man power requirements, technical feasibility with the
       plant and machinery, financial projections (profitability statement and projected balance sheet), collateral
       and security, conclusion. Lists are typed a line each, the parts of a line separated by commas. */
    summaryBody(d, c, R) {
      const S = R.S, f = R.f, name = this.unitName(d).toUpperCase(), ms = /^M\/S/i.test(name) ? name : 'M/S ' + name, para = (t) => lines(t).map(l => '<p>' + esc(l) + '</p>').join('');
      const cells = (line) => String(line).split(',').map(x => x.trim());
      let no = 0; const h = (t) => '<h3>' + (++no) + '. ' + esc(t) + '</h3>';
      const tbl = (heads, rows, right) => '<table class="prt"><thead><tr>' + heads.map((x, i) => '<th' + (right.includes(i) ? ' class="num"' : '') + '>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr' + (r.b ? ' class="total"' : r.g ? ' class="grp"' : '') + '>' + (r.g ? '<td colspan="' + heads.length + '"><b>' + esc(r.c[0]) + '</b></td>' : r.c.map((v, i) => '<td' + (right.includes(i) ? ' class="num"' : '') + '>' + esc(v) + '</td>').join('')) + '</tr>').join('') + '</tbody></table>';
      const capInv = c.fixed + c.prelim, equity = c.capital0 + c.subsidy;
      const costRows = [{ c: ['(A) Capital Investment', f(capInv)] }, { c: ['(B) Working Capital', f(c.wcReq)] }, { c: ['Total Project Cost', f(c.cost)], b: 1 }, { c: ['Equity', f(equity)] }].concat(c.uns ? [{ c: ['Unsecured Loans', f(c.uns)] }] : []).concat([{ c: ['Bank Loan (term loan ' + f(c.P) + ', working capital limit ' + f(c.cc) + ')', f(c.P + c.cc)] }, { c: ['Total Source of Finance', f(c.means)], b: 1 }]);
      const prod = lines(d.products).map(l => { const p = cells(l); return { c: [p[0] || '', p[1] || '', p[2] || '', p[3] || '', p[4] || ''] }; });
      // Man power: "Manager, 1, 25000"; a line without figures is a heading (A. ADMINISTRATION)
      let month = 0;
      const men = lines(d.manpower).map((l, i) => { const p = cells(l), nos = num(p[1]), rate = num(p[2]); if (p.length < 2 || (!nos && !rate)) return { c: [p[0]], g: 1 }; month += nos * rate; return { c: ['', p[0], String(nos), U.indianNumber(rate).replace(/\.00$/, ''), U.indianNumber(nos * rate).replace(/\.00$/, '')] }; });
      if (men.length) { men.push({ c: ['', 'Total salary per month', '', '', U.indianNumber(month).replace(/\.00$/, '')], b: 1 }); men.push({ c: ['', 'Annual salary', '', '', U.indianNumber(month * 12).replace(/\.00$/, '')], b: 1 }); }
      // Plant and machinery: "Machine, 250000" a line; without a list, the fixed assets of the project
      const typed = lines(d.machinery).map(l => { const p = cells(l); return [p[0], num(p[p.length - 1])]; }).filter(m => m[0]), mach = typed.length ? typed : c.assets.map(a => [a.name, a.cost]);
      const machRows = mach.map((m, i) => ({ c: ['(' + ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'][i] + ')', m[0], f(m[1])] })).concat([{ c: ['', 'Total', f(mach.reduce((t, m) => t + m[1], 0))], b: 1 }]);
      const sec = (k) => '<h4>' + esc(S[k].title) + '</h4>' + (S[k].sub ? '<div class="pu" style="text-align:left">' + esc(S[k].sub) + '</div>' : '') + this.pre(S[k]) + '<div class="pu">Amount (' + (S[k].unit || R.unit) + ')</div>' + this.table(S[k], '', true);
      return this.doc(
        '<div class="cover"><h1>PROJECT REPORT</h1><div class="rule"></div><div class="of">FOR BANK LOAN</div><div class="nm">' + esc(ms) + '</div>' + lines(d.address).map(l => '<div class="ad">' + esc(l.toUpperCase()) + '</div>').join('') + (d.industry ? '<div class="of" style="margin-top:26pt">' + esc(d.industry) + '</div>' : '') + '</div>' +
        '<div class="pg">' + h('Executive Summary') + (para(d.execSummary) || '<p>' + esc(ms) + (d.constitution ? ', a ' + esc(String(d.constitution).toLowerCase()) + ',' : '') + ' proposes ' + esc(d.industry ? 'to take up ' + d.industry : 'the project described here') + (lines(d.address).length ? ' at ' + esc(lines(d.address).join(', ')) : '') + '. The cost of the project, the source of its finance and the projections for ' + c.n + ' years are given below.</p>') +
          '<h4>Project Cost &amp; Source of Finance</h4><div class="pu">' + R.unit + '</div>' + tbl(['Particulars', 'Amount'], costRows, [1]) + '</div>' +
        '<div class="pg">' + h('Project Description') + (para(d.description) || para(d.history) + para(d.viability)) + (prod.length ? '<h4>Product Basic Details</h4>' + tbl(['Raw Material', 'Market Rate/Kg', 'Finished Goods (output)', 'Percentage', 'Market Rate/Kg'], prod, [1, 3, 4]) : '') + '</div>' +
        '<div class="pg">' + h('Project Plan') + (para(d.investments) || '<p>The capital and the loans come in and the fixed assets are bought in the construction period; the years after it are the years of operation.</p>') + sec('cashflow') + '</div>' +
        '<div class="pg">' + h('Market Analysis') + (para(d.market) || para(d.viability)) + h('Management Team') + (para(d.management) || para(d.history)) + (lines(d.partners).length ? '<p><b>' + esc(/partner/i.test(d.constitution) ? 'Partners' : /compan|limited|ltd/i.test(d.constitution) ? 'Directors' : 'Proprietor') + ':</b> ' + esc(lines(d.partners).join(', ')) + '</p>' : '') +
          (men.length ? '<h4>MAN POWER REQUIREMENTS</h4>' + tbl(['Sl. No.', 'Designation', 'Number', 'Rate', 'Salary (Rs./Month)'], men, [2, 3, 4]) : '') + '</div>' +
        '<div class="pg">' + h('Technical Feasibility') + (para(d.feasibility) || para(d.land)) + (lines(d.process).length ? '<p><b>Process:</b> ' + esc(lines(d.process).join(' → ')) + '</p>' : '') + '<h4>PLANT &amp; MACHINERY</h4>' + tbl(['Sr No', 'Particulars', 'Amount ' + R.unit], machRows, [2]) + '</div>' +
        '<div class="pg">' + h('Financial Projections') + '<p>The projected profitability statement, the projected balance sheet and the debt service coverage are given below; the cash flow statement is with the project plan.</p>' + sec('profit') + '</div>' +
        '<div class="pg">' + sec('balance3') + '</div><div class="pg">' + sec('dscr') + '</div>' + (c.P > 0.005 ? '<div class="pg">' + sec('repayment') + '</div><div class="pg">' + sec('repaymentDetail') + '</div>' : '') +
        '<div class="pg">' + h('Collateral & Security') + (para(d.collateral) || '<p>The assets created out of the bank finance will be hypothecated to the bank.</p>') + h('Conclusion') + (para(d.conclusion) || '<p>The projections show an average debt service coverage ratio of ' + x2(c.dscrAvg) + ' over ' + c.n + ' years' + (isFinite(c.bepPct) ? ' and a break-even at ' + c.bepPct.toFixed(2) + '% of the sales of the ' + ['1st', '2nd', '3rd'][c.by] + ' year' : '') + '. The project is technically feasible and economically viable.</p>') + '</div>');
    },
    summaryHtml(d, c, R) { return Print.page('Project report for bank loan - ' + this.unitName(d), Print.PAPERS.A4.css, '14mm 12mm', this.summaryBody(d, c, R)); },

    // ------------------------------------------------------------ the screen
    screen(p) {
      const old = { operating: 'profit', workings: 'wc' }, want = old[p.tab] || p.tab, tab = TABS.some(t => t[0] === want) ? want : 'project', access = this.access(), full = access === 'full';
      if (access === 'none') { const root = App.view(App.header('Professionals') + '<div class="card white"><div class="bd gstlock"><div class="big">🔒</div><div><h3>Professional licence required</h3><p class="muted">The project report (cost of project, projected profitability statement and balance sheet, funds flow, depreciation and repayment schedules, DSCR, break-even and ratios) comes with the Professional licence. Ask the owner or an admin to assign you one under Company &gt; Licences.</p></div></div></div>'); App.wireBack(root); return; }
      const d = this.data(), c = this.compute(d), R = this.sections(d, c), S = R.S, title = TABS.find(t => t[0] === tab)[1];
      const gap = c.cost - c.means;
      const secs = tab === 'cost' ? [S.cost, S.means] : tab === 'project' ? [] : tab === 'balance' ? [S.balance, S.balance3] : tab === 'repayment' ? [S.repayment, S.repaymentDetail] : [S[tab]];
      const body = tab === 'project' ? this.form(d, c, R) : '<div class="prhead">' + esc(this.headLine(d)) + '</div>' + secs.map((s, i) => '<div class="section-title" style="margin-top:' + (i ? 16 : 0) + 'px">' + esc(s.title) + (s.sub ? ' <span class="small muted">' + esc(s.sub) + '</span>' : '') + (s.unit && s.unit !== R.unit ? ' <span class="small muted">Amount (' + esc(s.unit) + ')</span>' : '') + '</div>' + this.pre(s) + '<div class="tablewrap gs">' + this.table(s, i ? '' : 'prTable') + '</div>').join('');
      const warn = (Math.abs(gap) >= 1 && c.cost > 0 ? '<div class="hint" style="margin-bottom:8px"><b class="red">The means of finance ' + (gap > 0 ? 'fall short of' : 'exceed') + ' the cost of the project by ' + R.f(Math.abs(gap)) + (R.lacs ? ' lacs' : '') + '.</b> Change the capital, the loans or the working capital under Project details.</div>' : '') +
        (c.cash.some(v => v < -0.5) && tab !== 'project' ? '<div class="hint" style="margin-bottom:8px"><b class="red">Cash runs short in the ' + c.Y.filter(y => c.cash[y] < -0.5).map(y => c.roman[y]).join(', ') + ' year.</b> The project needs more capital, a longer loan or a larger working capital limit.</div>' : '');
      const root = App.view(App.header('Professionals: ' + title, '<div class="btnrow" style="margin:0">' + (tab === 'project' ? '' : '<button class="btn sm green" id="prXls"' + (full ? '' : ' disabled') + '>Export Excel</button><button class="btn sm blue" id="prPdf"' + (full ? '' : ' disabled') + '>PDF</button>') + '<button class="btn sm blue" id="prAll"' + (full ? '' : ' disabled') + ' title="The whole project report in the layout chosen on Project details: ' + (d.layout === 'bank' ? 'bank loan format' : 'annexures') + '">Project report PDF</button></div>') +
        '<div class="btnrow" id="prTabs" style="margin:0 0 10px;flex-wrap:wrap">' + TABS.map(t => '<button class="btn sm ' + (t[0] === tab ? '' : 'outline') + '" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' +
        (full ? '' : '<div class="card white" id="prPreview"><div class="bd"><div class="hint" style="margin:0"><b>Preview.</b> Everything is worked out and shown, but the report is not printed, exported or copied without a Professional licence (Rs ' + Lic.kind('pro').month + ' a user a month, Rs ' + U.indianNumber(Lic.kind('pro').year).replace(/\.00$/, '') + ' a year). <button class="link" id="prBuy">Buy it under Company &gt; Licences</button>.</div></div></div>') +
        warn + (tab === 'project' ? '' : '<div class="muted small" style="margin-bottom:6px">Figures in ' + (R.lacs ? 'lacs of rupees' : 'rupees') + '   ·   Ist year = ' + esc(c.fy[0]) + '   ·   Layout: ' + (d.layout === 'bank' ? 'bank loan format' : 'annexures') + ' <button class="link small" id="prSwitch">switch to ' + (d.layout === 'bank' ? 'annexures' : 'bank loan format') + '</button></div>') + '<div id="prBody"' + (full ? '' : ' class="nocopy"') + '>' + body + '</div>');
      App.wireBack(root);
      $$('[data-tab]', root).forEach(b => b.onclick = () => App.go('pro', { tab: b.dataset.tab }));
      if ($('#prBuy')) $('#prBuy').onclick = () => App.go('licences');
      if (tab === 'project') this.wireForm(d, root);
      // The other layout, from any statement: kept with the report at once
      if ($('#prSwitch')) $('#prSwitch').onclick = () => { const to = d.layout === 'bank' ? 'annex' : 'bank'; if (Store.set('pro', Object.assign({}, d, { layout: to })) === false) return; UI.toast('Project report PDF now prints in the ' + (to === 'bank' ? 'bank loan format' : 'annexures layout')); App.go('pro', { tab }); };
      // Preview: nothing leaves the screen. The marks of a selection, the copy, the right-click menu and the print are refused
      if (!full) { const box = $('#prBody'); ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'].forEach(ev => box.addEventListener(ev, (e) => { if (tab === 'project' && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; e.preventDefault(); if (ev === 'copy' || ev === 'cut') UI.toast('Copying needs a Professional licence'); })); return; }
      const flat = (s) => s.rows.map(r => r.s === 2 ? [r.c[0]].concat(s.heads.slice(1).map(() => '')) : r.c), bold = (s) => s.rows.map((r, i) => r.s ? i : -1).filter(i => i >= 0);
      // Two statements on a tab go into one sheet, the second under its own heading row
      const both = () => { const w = Math.max(secs[0].heads.length, secs[1].heads.length), padTo = (r) => r.concat(Array(Math.max(0, w - r.length)).fill('')); return flat(secs[0]).map(padTo).concat([padTo([]), padTo([secs[1].title + ' ' + (secs[1].sub || '')])]).concat(secs[1].heads.join() === secs[0].heads.join() ? [] : [padTo(secs[1].heads)]).concat(flat(secs[1]).map(padTo)); };
      if ($('#prXls')) $('#prXls').onclick = () => { const s = secs[0]; UI.xls('Project_' + title.replace(/[^A-Za-z0-9]+/g, '_'), s.heads, secs.length > 1 ? both() : flat(s)); };
      // The PDF of a statement, and of the whole report in the layout chosen: both leave copy-protected (print)
      const keyOf = (s) => Object.keys(S).find(k => S[k] === s);
      if ($('#prPdf')) $('#prPdf').onclick = () => this.print(this.doc(tab === 'repayment' ? secs.map(s => this.sheet(d, R, [keyOf(s)])).join('') : this.sheet(d, R, secs.map(keyOf))), secs[0].title.replace(/\s*:$/, '') + ' - ' + this.unitName(d), d);
      $('#prAll').onclick = () => { const bank = d.layout === 'bank'; this.print(bank ? this.summaryBody(d, c, R) : this.reportBody(d, c, R), (bank ? 'Project report for bank loan - ' : 'Project report - ') + this.unitName(d), d); };
    },
    form(d, c, R) {
      const n = (id, v, hint, step) => UI.field(hint, UI.input(id, v === 0 || v === '0' ? '' : v, { type: 'number', attrs: ' min="0" step="' + (step || 'any') + '" placeholder="0"' }));
      const t = (id, v, label, ph, span) => UI.field(label, UI.input(id, v, { placeholder: ph || '' }), { span: !!span });
      const ta = (id, v, label, ph) => '<div class="field span"><label>' + esc(label) + '</label><textarea id="' + id + '" placeholder="' + esc(ph || '') + '">' + esc(v || '') + '</textarea></div>';
      return '<div class="card white"><div class="hd">Layout of the report</div><div class="bd"><div class="grid2">' + UI.field('The project report prints in', UI.select('prLayout', LAYOUTS, d.layout === 'bank' ? 'bank' : 'annex'), { hint: 'Project report PDF follows this choice as soon as it is made. The figures are the same in both; the bank loan format has a few texts and lists of its own, further down.' }) + '</div></div></div>' +
        '<div class="card white"><div class="hd">1. Introduction</div><div class="bd"><div class="grid2">' + t('prName', d.name, 'Name of the unit', Store.company().name || 'M/s ...') + t('prConst', d.constitution, 'Constitution', 'Proprietorship / Partnership Concern / Private Limited Company') +
        ta('prAddr', d.address, 'Address of the firm', 'Village, tehsil, district') + ta('prPart', d.partners, "Proprietor's / partners' / directors' names (one a line)", 'Sh. ...') + t('prCorr', d.corrAddress, 'Correspondence address', 'As above') + t('prInd', d.industry, 'Type of industry', 'e.g. Grading of rice with the help of silky machine and graders') +
        t('prClass', d.classification, 'Classification', 'Manufacturing / Trading / Service') + t('prCat', d.category, 'Category', 'General') + t('prRes', d.reserved, 'Whether item reserved for SSI', 'Yes / No') +
        UI.field('Figures in', UI.select('prUnit', [['lacs', 'Lacs of rupees (two decimals)'], ['rs', 'Rupees']], d.unit === 'rs' ? 'rs' : 'lacs'), { hint: 'Type every amount below in rupees; the report prints it in lacs' }) +
        UI.field('First year of the projections', UI.input('prStart', d.startYear, { type: 'number', attrs: ' min="2000" max="2100" step="1"' }), { hint: 'The year the Ist financial year starts in' }) + UI.field('Years projected', UI.select('prYears', [3, 4, 5, 6, 7, 8, 9, 10], r0(d.years) || 7)) + '</div></div></div>' +
        '<div class="card white"><div class="hd">2 - 6. Background, land, investments, viability, process</div><div class="bd"><div class="grid2">' + ta('prHist', d.history, "Brief history, constitution & promoters' background", 'Who the promoters are, their experience, who will manage the unit') + ta('prLand', d.land, 'Land', 'e.g. Land is already owned by the partners. The cost of land is Rs. 19.43 lac.') +
        ta('prInv', d.investments, 'Investments', 'e.g. Building will be constructed from own resources; for the purchase of machinery funds will be required as term loan.') + ta('prVia', d.viability, 'Viability', 'What the unit will make, why the location and the demand make it viable') + ta('prProc', d.process, 'Manufacturing process (one step a line, printed as a flow chart)', 'Cleaning from blower\nPolishing\nGrading\nPacking') + '</div></div></div>' +
        '<div class="card white"><div class="hd">7. Cost of the project (in rupees)</div><div class="bd"><div class="tablewrap"><table class="list" id="prAssets"><thead><tr><th>Fixed asset</th><th class="num">Existing / already owned</th><th class="num">Proposed (to be incurred)</th><th class="num">Depreciation % (WDV)</th></tr></thead><tbody>' +
          d.assets.map((a, i) => '<tr><td><input data-a="' + i + '" data-k="name" value="' + esc(a.name) + '" placeholder="Asset"></td><td class="num"><input data-a="' + i + '" data-k="existing" type="number" min="0" step="any" value="' + (num(a.existing) || '') + '" placeholder="0" style="text-align:right"></td><td class="num"><input data-a="' + i + '" data-k="cost" type="number" min="0" step="any" value="' + (num(a.cost) || '') + '" placeholder="0" style="text-align:right"></td><td class="num"><input data-a="' + i + '" data-k="rate" type="number" min="0" max="100" step="any" value="' + num(a.rate) + '" style="text-align:right;width:110px"></td></tr>').join('') + '</tbody></table></div>' +
          '<div class="tablewrap" style="margin-top:10px"><table class="list" id="prOther"><thead><tr><th>Other cost (written off over five years)</th><th class="num">Amount</th></tr></thead><tbody>' + d.other.map((o, i) => '<tr><td><input data-o="' + i + '" data-k="name" value="' + esc(o.name) + '" placeholder="Other item"></td><td class="num"><input data-o="' + i + '" data-k="amount" type="number" min="0" step="any" value="' + (num(o.amount) || '') + '" placeholder="0" style="text-align:right"></td></tr>').join('') + '</tbody></table></div>' +
          '<div class="grid2" style="margin-top:10px">' + n('prWcm', d.wcReq, 'Working capital requirement') + '</div></div></div>' +
        '<div class="card white"><div class="hd">Means of financing (in rupees)</div><div class="bd"><div class="grid2">' + n('prCapE', d.capitalExisting, 'Capital already brought in (existing: the land owned, say)') + n('prCap', d.capital, 'Capital to be brought in (proposed)') + n('prSub', d.subsidy, 'Capital subsidy') + n('prUns', d.unsecured, 'Unsecured loans (friends and relatives)') + n('prUnsR', d.unsRate, 'Interest on unsecured loans % a year') +
          n('prTl', d.termLoan, 'Term loan (proposed)') + n('prTlR', d.tlRate, 'Term loan interest % a year') + n('prTlM', d.tlMonths, 'Repayment period (months): repaid in equal amounts a year, an instalment a month', 1) + n('prTlMo', d.tlMoratorium, 'Moratorium (months): interest only, the Ist year has the instalments left after it', 1) + n('prWc', d.wcLimit, 'Working capital (cash credit) limit proposed') + n('prWcR', d.wcRate, 'Bank interest on the limit % a year') + '</div></div></div>' +
        '<div class="card white"><div class="hd">8 - 9. Turnover, expenditure and the other assumptions</div><div class="bd"><div class="btnrow" style="margin:0 0 8px"><button class="btn sm outline" id="prBooks" title="Sales, materials and expenses of this financial year, from the books of the company">Fill from the books</button></div><div class="grid2">' +
          n('prSales', d.sales1, 'Sales of the Ist year (rupees)') + UI.field('Capacity utilization % year by year', UI.input('prUtil', d.util, { placeholder: 'e.g. 70, 80, 85 (the last holds); blank = use the growth' }), { hint: 'Sales follow the utilization: 84 lacs at 70% is 96 at 80%' }) + n('prGrow', d.growth, 'Growth of sales % a year (without a utilization)') + n('prMiscI', d.miscIncome, 'Misc. receipts a year') +
          n('prRm', d.rmPct, 'Raw material % of sales') + n('prPow', d.powerPct, 'Electricity & diesel % of sales') + n('prWages', d.wages1, 'Wages & salaries of the Ist year') + n('prWg', d.wagesGrowth, 'Growth of wages % a year') + n('prSell', d.sellingPct, 'Selling & adm. charges % of sales') + n('prAdm', d.admin1, 'Further selling & adm. charges of the Ist year') + n('prAg', d.adminGrowth, 'Their growth % a year') +
          n('prRep', d.repairs1, 'Repairs & consumables of the Ist year') + n('prRepG', d.repairsGrowth, 'Their growth % a year') + n('prMisc', d.misc1, 'Other misc. charges a year') + n('prRmD', d.rmDays, 'Raw material held (days)', 1) + n('prFgD', d.fgDays, 'Stock in process & finished stock (days)', 1) + n('prDeb', d.debtorDays, 'Sundry debtors (days of sales)', 1) + n('prCre', d.creditorDays, 'Sundry creditors (days of purchases)', 1) +
          n('prTax', d.taxPct, 'Income tax % of the profit') + n('prDraw', d.drawings, 'Drawings of the Ist year') + n('prDrawG', d.drawingsGrowth, 'Growth of drawings % a year') + '</div>' +
          '<div class="hint" style="margin:10px 0 6px"><b>Amounts year by year</b> (rupees, separated by commas; the last holds for the years after). Typed, they take the place of the days and the growth above.</div><div class="grid2">' +
          t('prWipL', d.wipList, 'Stock in process, year by year', 'e.g. 250000, 350000, 450000') + t('prFgL', d.fgList, 'Finished stock, year by year', 'e.g. 450000') + t('prDebL', d.debtorList, 'Sundry debtors, year by year', 'e.g. 800000, 1000000, 1200000') + t('prCreL', d.creditorList, 'Sundry creditors, year by year', 'e.g. 850000, 1100000, 1400000') +
          t('prAdvL', d.advancesList, 'Advances & securities, year by year', 'e.g. 5000, 10000, 20000') + t('prDrawL', d.drawingsList, 'Drawings, year by year', 'e.g. 200000, 250000, 300000') + '</div></div></div>' +
        '<div class="card white" id="prBankCard"' + (d.layout === 'bank' ? '' : ' style="display:none"') + '><div class="hd">For the bank loan format</div><div class="bd"><div class="hint" style="margin:0 0 8px">Executive summary, project description, project plan with the cash flow statement, market analysis, management team with the man power, technical feasibility with the plant and machinery, financial projections, collateral and conclusion. What is left blank is taken from the texts above.</div><div class="grid2">' +
          ta('prExec', d.execSummary, 'Executive summary', 'A brief overview of the project: its goals, objectives and expected outcomes') + ta('prDesc', d.description, 'Project description', 'The scope, the objectives and the expected results of the project') +
          ta('prProd', d.products, 'Product basic details (a line each: raw material, market rate/kg, finished goods, percentage, market rate/kg)', 'Paddy, 22, Rice, 65, 45\n, , Bran, 8, 20') + ta('prMkt', d.market, 'Market analysis', 'The target market, the competition and the trends of the industry') +
          ta('prMgmt', d.management, 'Management team', 'Who manages the unit, their qualifications and roles') + ta('prMen', d.manpower, 'Man power requirements (a line each: designation, number, rate a month; a line without figures is a heading)', 'A. ADMINISTRATION\nManager, 1, 25000\nB. PRODUCTION\nSkilled, 2, 18000\nUnskilled, 4, 12000\nGuard, 1, 10000') +
          ta('prMach', d.machinery, 'Plant & machinery (a line each: particulars, amount in rupees); blank = the fixed assets above', 'Silky rice polisher machine, 180000\nGrader, 70000\nTransportation, packing & taxes, 50000') + ta('prFeas', d.feasibility, 'Technical feasibility', 'The technology and the equipment the project needs') +
          ta('prColl', d.collateral, 'Collateral & security', 'The real estate, equipment or stock offered to secure the loan') + ta('prConc', d.conclusion, 'Conclusion', 'The potential of the project and the return expected') + '</div></div></div>' +
        '<div class="btnrow"><button class="btn green" id="prSave">Save and work out</button></div>' +
        '<div id="prSummary"><div class="section-title">Cost of project <span class="small muted">' + R.unit + '</span></div><div class="tablewrap">' + this.table(R.S.cost) + '</div><div class="section-title" style="margin-top:12px">Means of Finance</div><div class="tablewrap">' + this.table(R.S.means) + '</div></div>';
    },
    wireForm(d, root) {
      const v = (id) => num(UI.val(id)), s = (id) => String(UI.val(id)).trim(), m = (id) => String(UI.val(id)).replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean).join('\n');
      const collect = () => {
        const o = Object.assign({}, d, { name: s('prName'), constitution: s('prConst'), address: m('prAddr'), partners: m('prPart'), corrAddress: s('prCorr'), industry: s('prInd'), classification: s('prClass'), category: s('prCat'), reserved: s('prRes'), unit: UI.val('prUnit') === 'rs' ? 'rs' : 'lacs', layout: UI.val('prLayout') === 'bank' ? 'bank' : 'annex',
          history: m('prHist'), land: m('prLand'), investments: m('prInv'), viability: m('prVia'), process: m('prProc'), startYear: U.validFyYear(UI.val('prStart')) || U.fyFirstYear(), years: r0(UI.val('prYears')) || 7,
          wcReq: v('prWcm'), capitalExisting: v('prCapE'), capital: v('prCap'), subsidy: v('prSub'), unsecured: v('prUns'), unsRate: v('prUnsR'), termLoan: v('prTl'), tlRate: v('prTlR'), tlMonths: Math.max(1, r0(v('prTlM')) || 1), tlMoratorium: r0(v('prTlMo')), wcLimit: v('prWc'), wcRate: v('prWcR'),
          sales1: v('prSales'), util: s('prUtil'), growth: v('prGrow'), miscIncome: v('prMiscI'), rmPct: v('prRm'), powerPct: v('prPow'), wages1: v('prWages'), wagesGrowth: v('prWg'), sellingPct: v('prSell'), admin1: v('prAdm'), adminGrowth: v('prAg'), repairs1: v('prRep'), repairsGrowth: v('prRepG'), misc1: v('prMisc'),
          rmDays: v('prRmD'), fgDays: v('prFgD'), debtorDays: v('prDeb'), creditorDays: v('prCre'), taxPct: v('prTax'), drawings: v('prDraw'), drawingsGrowth: v('prDrawG'),
          wipList: s('prWipL'), fgList: s('prFgL'), debtorList: s('prDebL'), creditorList: s('prCreL'), advancesList: s('prAdvL'), drawingsList: s('prDrawL'),
          execSummary: m('prExec'), description: m('prDesc'), products: m('prProd'), market: m('prMkt'), management: m('prMgmt'), manpower: m('prMen'), machinery: m('prMach'), feasibility: m('prFeas'), collateral: m('prColl'), conclusion: m('prConc') });
        o.assets = d.assets.map((a, i) => ({ name: String($('[data-a="' + i + '"][data-k=name]', root).value).trim(), existing: num($('[data-a="' + i + '"][data-k=existing]', root).value), cost: num($('[data-a="' + i + '"][data-k=cost]', root).value), rate: num($('[data-a="' + i + '"][data-k=rate]', root).value) }));
        o.other = d.other.map((x, i) => ({ name: String($('[data-o="' + i + '"][data-k=name]', root).value).trim(), amount: num($('[data-o="' + i + '"][data-k=amount]', root).value) }));
        return o;
      };
      // The texts and lists of the bank loan format show when that layout is chosen
      $('#prLayout').onchange = (e) => {
        const to = e.target.value === 'bank' ? 'bank' : 'annex';
        $('#prBankCard').style.display = to === 'bank' ? '' : 'none';
        // Kept with the report at once: Project report PDF follows it without waiting for Save and work out
        d.layout = to; const saved = Store.get('pro', null);
        if (Store.set('pro', Object.assign({}, saved && typeof saved === 'object' ? saved : this.blank(), { layout: to })) === false) return;
        const b = $('#prAll'); if (b) b.title = 'The whole project report in the layout chosen on Project details: ' + (to === 'bank' ? 'bank loan format' : 'annexures');
        UI.toast('Project report PDF now prints in the ' + (to === 'bank' ? 'bank loan format' : 'annexures layout'));
      };
      $('#prSave').onclick = () => { if (Store.set('pro', collect()) === false) return; UI.toast('Project saved: the report is worked out'); App.go('pro', { tab: 'project' }); };
      // This financial year from the books, as the Ist year of the projections
      $('#prBooks').onclick = () => {
        const r = Reports.periodRange(3), pl = Books.profitLoss(r.a, r.b), sales = pl.sales - pl.salesReturns, mat = pl.purchasesValue - pl.purchaseReturns;
        if (sales <= 0) return UI.toast('No sales in the books of this financial year yet');
        const exp = (re) => Array.from(pl.expensesByCategory.entries()).filter(e => re.test(e[0])).reduce((t, e) => t + e[1], 0), wages = exp(/salar|wage/i), power = exp(/electric|power|fuel/i), repairs = exp(/repair|maint/i), selling = Math.max(0, pl.expenses - wages - power - repairs);
        $('#prSales').value = r0(sales); $('#prRm').value = (mat / sales * 100).toFixed(1); $('#prWages').value = r0(wages) || ''; $('#prPow').value = (power / sales * 100).toFixed(1); $('#prRep').value = r0(repairs) || ''; $('#prAdm').value = r0(selling) || '';
        UI.toast('Filled from the books of ' + r.from + ' to ' + r.to + ': check the figures, then Save and work out', 6000);
      };
    }
  };
  App.routes.pro = (p) => Pro.screen(p || {});
  global.Pro = Pro;
})(window);
