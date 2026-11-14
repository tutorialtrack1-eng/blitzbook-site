/* BlitzBook web portal - HR & payroll: employees (monthly salaried or hourly), attendance, weekly timesheets with
   manager approval, reimbursements, leave requests that mark the attendance by themselves, monthly payroll with the statutory deductions (PF, ESI, professional tax, TDS),
   payslips, offer letters, the PF / ESI / PT summaries for the challans, a bank advice, and the posting of a finalised
   month into the books as a journal voucher. The module comes with the Full access plans (subscription.js isFull;
   the trial has it too). HR Settings hold the rates, the ceilings, the state for PT, working
   hours, the shift (start, end, grace; an employee record can carry its own), the HRA rule and the holiday list. The records sync like the rest of the books ("emp:", "att:", "ts:",
   "rb:", "pay:", "hr"); the HR and Manager roles of a company (companies.js) open only these screens, and only a
   manager, an admin or the owner approves timesheets and reimbursements: the server (companies.sql) lets the HR
   role save a timesheet only while unapproved and a claim only while pending.

   Pay (India, as in force in November 2026, changeable under HR Settings):
     Wages  Code on Social Security s. 2(88): basic, DA and every allowance that is not excluded (the special
            allowance) are wages; HRA, conveyance and overtime are excluded, but only up to half of the pay: what
            they are above half is added back to the wages. HRA is set from basic (50% in a metro, 40% elsewhere).
     PF     employee 12% of wages up to the ceiling of 25,000 (S.O. 5109(E): from 17 September 2026; 15,000 for the
            months before, 19,667 for September 2026, which is split 16 / 14 days); employer 12% split 8.33% EPS /
            3.67% EPF, plus EDLI 0.5% and administration charges 0.5%, at least 500 a month for the establishment
     ESI    wages of 21,000 or less (25,000 for a person with a disability): employee 0.75%, employer 3.25% of the
            wages, each rounded up to the rupee; overtime is not wages. Once covered, covered to the end of the
            contribution period (April - September, October - March). No employee share on an average daily wage of
            176 or less.
     PT     monthly slabs of the state (half-yearly states as a monthly equivalent); a custom slab list can be typed
     TDS    a fixed monthly amount on the employee, as worked out for the year
   A monthly salary is earned per paid day: the days of the pay period less absences (LOP); a half day counts half.
   The pay period of a month runs from the 1st (or the day of joining) to the last day (or the last working day), and
   never past today: a month that is not over is paid up to today.
   Overtime on a salary pays gross / (26 days x hours per day) x the multiplier per hour (twice the wages under the
   labour codes). An hourly employee is paid from the approved timesheets: the hours of the month at the rate per
   hour, hours above the weekly limit (40) at 1.5x, and the holidays of the list at the hours of a day. */
(function (global) {
  'use strict';
  const { esc, num, money } = U;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const STATUS = { P: 'Present', A: 'Absent (LOP)', L: 'Leave', HL: 'Half-day leave (paid)', HD: 'Half day (half loss of pay)', W: 'Weekly off', H: 'Holiday', NA: 'Not yet' };
  const CYCLE = ['P', 'A', 'L', 'HL', 'HD', 'W', 'H'];
  const LV_TYPES = ['Casual leave', 'Sick leave', 'Earned leave', 'Loss of pay'];
  /* The leave policy of the company (HR > HR Policy; 'leavePolicy' on the HR settings): two groups, the company's own
     employees and, for a manpower and staffing agency, the staff deployed at client sites. Each group has its kinds of
     leave with the days of a year and the rule in words, and its general rules. The days are not given at once: they
     are earned month by month (a twelfth of the year's days a month, from April), and someone who joins in the year
     earns from the day of joining only, the month of joining in proportion to the days worked in it. */
  const LEAVE_POLICY = {
    staff: { name: 'Employees', types: [
      { name: 'Casual leave', days: 12, note: 'For personal and urgent needs. Asked for in advance where it can be; not more than 3 days at a stretch.' },
      { name: 'Sick leave', days: 12, note: 'For illness or injury. A medical certificate is needed for more than 2 days in a row.' },
      { name: 'Earned leave', days: 15, note: 'Planned leave: asked for at least 7 days ahead and taken when the reporting manager agrees.' }],
      rules: ['The leave year runs from 1 April to 31 March.', 'Leave is earned month by month: a twelfth of the days of the year is added to the balance every month. Someone who joins during the year earns leave from the date of joining, in proportion.',
        'Leave is applied under HR > Leave (My Leave) and is approved by the reporting manager, a manager, an admin or the owner. Leave is taken only after it is approved, except sick leave in an emergency, which is applied on the first day back.',
        'Weekly offs and the holidays of the company list that fall inside a leave are not counted as leave.', 'A half day of leave can be taken for the first or the second half of a day.',
        'A leave balance never goes below nothing: leave asked for beyond the balance earned so far goes in as loss of pay, and those days are not paid.', 'Leave not taken by 31 March lapses, unless the company says otherwise in writing.', 'Absence without approved leave is marked absent and is not paid.'] },
    manpower: { name: 'Manpower (staff deployed at client sites)', types: [
      { name: 'Casual leave', days: 7, note: 'For urgent personal needs. The site supervisor and the agency are told before the shift.' },
      { name: 'Sick leave', days: 7, note: 'For illness or injury. Staff covered by ESI claim the sickness benefit from ESIC with the medical certificate.' },
      { name: 'Earned leave', days: 15, note: 'Earned at one day for every 20 days worked; taken when the site can release the person and a reliever is arranged.' }],
      rules: ['The leave year runs from 1 April to 31 March. Leave is earned month by month, from the date of deployment, in proportion.',
        'Deployed staff follow the working days, the shift and the weekly off of the client site they are posted at. The national and festival holidays are those of the site; work on such a day is paid as the law and the contract provide.',
        'Leave is asked for from the agency (HR > Leave, or through the site supervisor) at least 3 days ahead so that a reliever can be sent; it is approved by the agency, not by the client.',
        'Nobody leaves the site or stays away without approved leave: such days are marked absent, are not paid and are not billed.',
        'A leave balance never goes below nothing: leave beyond the balance earned so far is loss of pay.', 'At the end of the deployment the earned leave that is left is settled with the final wages; casual and sick leave lapse.',
        'Maternity benefit, ESI and PF are as the law provides for the person.'] }
  };
  const RB_CATS = ['Travel', 'Food', 'Phone / Internet', 'Medical', 'Stationery', 'Other'];
  // The employees upload: the template's columns, the headings accepted for each field (letters only, lower case; the
  // Excel export's headings are among them), and the sample rows of the template
  const EMP_COLUMNS = ['Code', 'Name', 'Designation', 'Department', 'Joined', 'Left on', 'Phone', 'Email', 'PAN', 'UAN', 'ESI No', 'Pay type', 'Rate / hour', 'Basic', 'DA', 'HRA', 'Conveyance', 'Special', 'PF', 'ESI', 'PT', 'TDS / month', 'Bank', 'Account', 'IFSC', 'Manager', 'Address', 'Aadhaar', 'Leaves per year', 'Shift start', 'Shift end'];
  const EMP_HEADS = { code: ['code', 'empcode', 'employeecode'], name: ['name', 'fullname', 'employee', 'employeename'], designation: ['designation', 'title', 'role'], department: ['department', 'dept'], doj: ['joined', 'dateofjoining', 'doj', 'joiningdate', 'joining'], dol: ['lefton', 'dateofleaving', 'dol', 'left', 'leavingdate'],
    phone: ['phone', 'mobile', 'mobilenumber', 'phonenumber'], email: ['email', 'emailaddress', 'mail'], pan: ['pan'], uan: ['uan', 'uanpf', 'pfuan'], esiNo: ['esino', 'esinumber', 'esiip', 'ipnumber'], payType: ['paytype', 'pay', 'type'], hourlyRate: ['ratehour', 'rateperhour', 'hourlyrate', 'rate'],
    basic: ['basic', 'basicsalary'], da: ['da', 'dearnessallowance'], hra: ['hra'], conveyance: ['conveyance'], special: ['special', 'specialallowance', 'other', 'otherallowance'], pf: ['pf', 'pfapplies'], esi: ['esi', 'esiapplies'], pt: ['pt', 'professionaltax', 'ptapplies'], tds: ['tdsmonth', 'tds', 'tdspermonth'],
    bankName: ['bank', 'bankname'], bankAccount: ['account', 'accountnumber', 'accountno', 'bankaccount'], bankIfsc: ['ifsc', 'ifsccode'], manager: ['manager', 'reportingmanager', 'reportsto'], address: ['address'], aadhaar: ['aadhaar', 'aadhar'], leavesPerYear: ['leavesperyear', 'leaves', 'paidleave', 'paidleaveperyear'], shiftStart: ['shiftstart', 'shiftfrom', 'shiftin', 'intime', 'shiftstarttime'], shiftEnd: ['shiftend', 'shiftto', 'shiftout', 'outtime', 'shiftendtime'] };
  const EMP_SAMPLE = [['EMP001', 'Ravi Kumar', 'Accountant', 'Accounts', '01/04/2026', '', '9876543210', 'ravi@gmail.com', 'ABCDE1234F', '100123456789', '', 'Monthly', '', '20000', '2000', '10000', '1600', '3000', 'Yes', 'Yes', 'Yes', '0', 'HDFC Bank', '50100012345678', 'HDFC0001234', '', '12 MG Road Vijayawada', '', '12', '09:30', '18:30'],
    ['EMP002', 'Sita Devi', 'Packer', 'Warehouse', '15/04/2026', '', '9123456789', '', '', '', '', 'Hourly', '150', '', '', '', '', '', 'Yes', 'Yes', 'No', '0', 'SBI', '30012345678', 'SBIN0001234', 'EMP001', '', '', '12', '08:00', '17:00']];
  // Monthly professional tax slabs: [upper limit of the monthly salary, tax]; '*' = and above
  const PT = {
    'Andhra Pradesh': [[15000, 0], [20000, 150], ['*', 200]], 'Telangana': [[15000, 0], [20000, 150], ['*', 200]],
    'Karnataka': [[25000, 0], ['*', 200]], 'Maharashtra': [[7500, 0], [10000, 175], ['*', 200]], 'Gujarat': [[12000, 0], ['*', 200]],
    'Tamil Nadu': [[21000, 0], [30000, 135], [45000, 315], [60000, 690], [75000, 1025], ['*', 1250]],
    'West Bengal': [[10000, 0], [15000, 110], [25000, 130], [40000, 150], ['*', 200]], 'Kerala': [[11999, 0], [17999, 20], [29999, 30], [44999, 50], [99999, 100], [124999, 125], ['*', 208]],
    'Madhya Pradesh': [[18750, 0], [25000, 125], [33333, 167], ['*', 208]], 'Odisha': [[13333, 0], [25000, 125], ['*', 200]], 'Bihar': [[25000, 0], [41666, 83], [83333, 167], ['*', 208]],
    'Assam': [[10000, 0], [15000, 150], [25000, 180], ['*', 208]], 'Jharkhand': [[25000, 0], [41666, 100], [66666, 150], [83333, 175], ['*', 208]], 'Meghalaya': [[4166, 0], [6250, 16.5], [8333, 25], [12500, 41.5], [16666, 62.5], [20833, 83.33], [25000, 104.16], [29166, 125], [33333, 150], [37500, 175], [41666, 200], ['*', 208]],
    'Sikkim': [[20000, 0], [30000, 125], [40000, 150], ['*', 200]], 'Tripura': [[7500, 0], [15000, 150], ['*', 208]], 'None / not applicable': [['*', 0]], 'Custom slabs': []
  };
  // The standard points of an offer letter (HR Settings changes them; the words in braces are filled in for the employee)
  const OFFER_POINTS = [
    'Your appointment is subject to a probation of {probation} months from the date of joining, during which either side may end the engagement with {probation_notice} days\' notice; on confirmation the notice period is {notice} days on either side, or pay in lieu.',
    'Working hours are {hours}. {pay_basis}',
    'Statutory deductions (provident fund, ESI, professional tax and income tax) apply as the law provides. Basic and dearness allowance together are at least half of the pay, as the Code on Wages requires.',
    'You are entitled to {leave} days of paid leave a year, earned month by month from your date of joining as the leave policy of the company says, and the holidays of the company\'s list.',
    'You will keep the company\'s information confidential during and after your employment and will give your whole time and attention to the company\'s work.'
  ];
  const PF_CEILING = 25000, PF_CEILING_OLD = 15000, PF_CEILING_SEP26 = 19667;   // S.O. 5109(E) of 17 September 2026
  // Leaving the company: the kinds of exit, the usual reasons of each, and the clearance before the settlement
  const EXIT_TYPES = [['resignation', 'Resignation'], ['termination', 'Termination by the company'], ['contract', 'End of contract / fixed term'], ['retirement', 'Retirement'], ['absconding', 'Absconding (no show)'], ['death', 'Death in service']];
  const EXIT_REASONS = { resignation: ['Better opportunity', 'Personal reasons', 'Higher studies', 'Relocation', 'Health', 'Other'], termination: ['Poor performance', 'Misconduct', 'Unauthorised absence', 'Breach of company policy', 'Redundancy / retrenchment', 'Probation not confirmed', 'Other'],
    contract: ['Contract period over', 'Project completed', 'Other'], retirement: ['Superannuation', 'Voluntary retirement', 'Other'], absconding: ['No show without notice', 'Other'], death: ['Death in service'] };
  const CLEARANCE = [['assets', 'Company property returned (laptop, phone, ID card, keys)'], ['handover', 'Work, files and passwords handed over'], ['dues', 'Advances, loans and other dues recovered'], ['access', 'Email, software and door access removed'], ['interview', 'Exit interview held']];
  const LETTERS = { relieving: ['Relieving letter', 'RELIEVING LETTER', 'REL'], experience: ['Experience letter', 'EXPERIENCE CERTIFICATE', 'EXP'], termination: ['Termination letter', 'TERMINATION OF EMPLOYMENT', 'TER'] };
  /* The standard words of each letter, a paragraph a line; the words in braces are filled in from the employee and
     the exit: {name} {first_name} {code} {designation} {department} {joining} {last_day} {company} {notice_date}
     {notice_days} {reason} */
  const LETTER_TEXT = {
    relieving: ['This refers to your separation from the company ({exit}). We confirm that you are relieved from the services of {company} at the close of working hours on {last_day}.',
      'You worked with us as {designation}{in_department} from {joining} to {last_day}. You have handed over your responsibilities and the property of the company in your charge, and your dues are settled in the full and final settlement.',
      'We thank you for your contribution and wish you the very best in what you take up next.'],
    experience: ['This is to certify that {name} (employee code {code}) was employed with {company} from {joining} to {last_day}, and was working as {designation}{in_department} at the time of leaving.',
      'During this time we found {first_name} to be sincere, hardworking and dependable in the work entrusted. Their conduct and character were good.',
      'This certificate is issued at the request of {first_name}. We wish them success in their career.'],
    termination: ['We regret to inform you that your employment with {company} as {designation}{in_department} is terminated with effect from the close of working hours on {last_day}.',
      'Reason: {reason}.',
      'This letter is the notice of {notice_days} days required by the terms of your appointment, counted from {notice_date}; pay in lieu is given for any part of it not served. Please return the property of the company in your possession and hand over your work on or before your last working day.',
      'Your salary up to the last working day and your other dues will be paid in the full and final settlement, as the rules of the company and the law provide.']
  };
  const TAX = { std: 75000, slabs: [[400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [Infinity, 30]], rebateUpto: 1200000, cess: 4 };
  const DEFAULTS = { pfRate: 12, pfCeiling: PF_CEILING, epsRate: 8.33, edliRate: 0.5, pfAdmin: 0.5, pfAdminMin: 500, esiEmp: 0.75, esiEmployer: 3.25, esiCeiling: 21000, esiCeilingPwd: 25000, esiDailyExempt: 176, esiBasis: 'wages', ptState: 'Andhra Pradesh', ptSlabs: '', otMultiplier: 2, hoursPerDay: 8, weeklyOff: '0', holidays: [], payDay: 1, leavesPerYear: 12,
    hraPct: 40, metro: false, wagesFloor: 50, weeklyHours: 40, usOtMultiplier: 1.5, holidayPaid: true, shiftStart: '09:30', shiftEnd: '18:30', graceMin: 10, attFromClock: true };
  const pad = (n) => String(n).padStart(2, '0');
  const thisMonth = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const monthLabel = (m) => { const [y, mo] = m.split('-'); return MONTHS[+mo - 1] + ' ' + y; };
  const daysIn = (m) => { const [y, mo] = m.split('-'); return new Date(+y, +mo, 0).getDate(); };
  const dateOf = (m, d) => pad(d) + '/' + m.split('-')[1] + '/' + m.split('-')[0];
  const weekday = (m, d) => new Date(+m.split('-')[0], +m.split('-')[1] - 1, d).getDay();
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dmy = (d) => pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  // The Monday of the week a date falls in, as yyyy-mm-dd
  const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };
  const r2 = U.round2;
  const ceil = (v) => Math.ceil(v - 1e-9);
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  // A time of day as hh:mm from what is typed or uploaded: 9:30, 09:30, 9.30 pm, 09:30:00, or an Excel fraction of a day
  const tm = (v) => { if (v == null || v === '') return ''; let s = String(v).trim().toLowerCase(); if (/^0?\.\d+$/.test(s) || (typeof v === 'number' && v >= 0 && v < 1)) { const m = Math.round(parseFloat(s) * 1440); return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); }
    const m = /^(\d{1,2})(?:[:.](\d{1,2}))?(?::\d{2})?\s*(am|pm)?$/.exec(s); if (!m) return ''; let h = +m[1]; const mi = +(m[2] || 0); if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0; if (h > 23 || mi > 59) return ''; return pad(h) + ':' + pad(mi); };
  const fmtMin = (m) => m >= 60 ? Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm' : m + ' min';

  const HR = {
    // Settings saved before the ceiling of 17 September 2026 carry the old 15,000: they follow the new one until HR
    // Settings is saved again (rules2026), after which whatever is typed there stands
    settings() { const s = Object.assign({}, DEFAULTS, Store.get('hr', {}) || {}); if (!s.rules2026 && num(s.pfCeiling) === PF_CEILING_OLD) s.pfCeiling = PF_CEILING; return s; },
    // Today, as a Date (the checks set another day)
    now() { return new Date(); },
    todayIso() { return iso(this.now()); },
    /* The PF wage ceiling of a month. While HR Settings carries the statutory 25,000 the months before it came in
       keep theirs: 15,000 up to August 2026, and September 2026 the two parts of the month together (15,000 x 16 / 30
       + 25,000 x 14 / 30 = 19,667). A ceiling typed by hand applies to every month; 0 means no ceiling. */
    pfCeilingFor(month, s) { const c = num((s || this.settings()).pfCeiling); if (!c) return Infinity; if (c !== PF_CEILING) return c; return month < '2026-09' ? PF_CEILING_OLD : month === '2026-09' ? PF_CEILING_SEP26 : PF_CEILING; },
    /* The pay period of an employee in a month: from the 1st, or the day of joining, to the last day, or the last
       working day (date of leaving), and never past today. { from, to, days, total }; days is 0 for a month that has
       not begun, or one the employee was not on the rolls in. Without an employee: the days of the month so far. */
    span(emp, month) {
      const total = daysIn(month), t = this.todayIso(), tm0 = t.slice(0, 7); let from = 1, to = month > tm0 ? 0 : month === tm0 ? +t.slice(8) : total;
      const j = emp ? U.dateMs(emp.doj) : 0, l = emp ? U.dateMs(emp.dol) : 0;
      if (j) { const d = new Date(j), m = iso(d).slice(0, 7); if (m > month) to = 0; else if (m === month) from = d.getDate(); }
      if (l) { const d = new Date(l), m = iso(d).slice(0, 7); if (m < month) to = 0; else if (m === month) to = Math.min(to, d.getDate()); }
      return { from, to, days: Math.max(0, to - from + 1), total };
    },
    // The day a month is paid up to when it is not over yet (0 for a month that is complete)
    cutoff(month) { const sp = this.span(null, month); return sp.to < sp.total ? sp.to : 0; },
    periodText(month, from, to) { return dateOf(month, from || 1) + ' to ' + dateOf(month, to || daysIn(month)); },
    /* Covered by ESI earlier in the same contribution period (April - September, October - March): an employee whose
       wages go above the ceiling stays covered until the period ends. Read from the finalised payrolls. */
    esiCovered(emp, month) { const [y, mo] = month.split('-').map(Number), start = mo >= 10 ? y + '-10' : mo >= 4 ? y + '-04' : (y - 1) + '-10'; return Store.list('payroll').some(p => p.status === 'final' && p.month >= start && p.month < month && (p.rows || []).some(r => r.empId === emp.id && (num(r.esiEmp) > 0 || num(r.esiEmployer) > 0))); },
    // Wages under the Code: basic, DA and the special allowance, and at least the floor (half) of all that is paid
    /* Income tax on salaries, worked out by itself (the new tax regime, which applies unless the employee opts out):
       the pay of the months worked in the financial year, less the standard deduction, taxed by the slabs; nil up to
       a taxable income of 12,00,000 (rebate, with marginal relief just above it); surcharge above 50,00,000; 4% cess.
       The year's tax is spread evenly over those months. An employee in the old regime, or with other income or
       deductions declared, has the monthly amount typed instead (tdsAuto off). */
    taxOf(income) {
      const ti = Math.max(0, num(income) - TAX.std); let tax = 0, low = 0;
      TAX.slabs.forEach(([upto, rate]) => { if (ti > low) tax += (Math.min(ti, upto) - low) * rate / 100; low = upto; });
      tax = ti <= TAX.rebateUpto ? 0 : Math.min(tax, ti - TAX.rebateUpto);
      const sur = ti > 20000000 ? 25 : ti > 10000000 ? 15 : ti > 5000000 ? 10 : 0;
      return Math.round(tax * (1 + sur / 100) * (1 + TAX.cess / 100));
    },
    // Automatic unless a monthly amount was typed (employees saved before this keep the amount they have)
    tdsAuto(emp) { return emp.tdsAuto != null ? !!emp.tdsAuto : !(num(emp.tds) > 0); },
    // The months of the financial year of 'month' in which the employee is on the payroll
    fyMonths(emp, month) {
      const [y, mo] = month.split('-').map(Number), fy = mo >= 4 ? y : y - 1, ym = (d) => { const p = String(d || '').split('/'); return p.length === 3 ? p[2] + '-' + p[1].padStart(2, '0') : ''; };
      const x = this.exitOf(emp), from = ym(emp.doj), to = ym((x && x.lwd) || emp.dol); let n = 0;
      for (let i = 0; i < 12; i++) { const m = (i < 9 ? fy : fy + 1) + '-' + String(i < 9 ? i + 4 : i - 8).padStart(2, '0'); if ((!from || m >= from) && (!to || m <= to)) n++; }
      return n;
    },
    // TDS for a full month, worked out
    tdsOf(emp, month) {
      const s = this.settings(), monthly = this.hourly(emp) ? num(emp.hourlyRate) * (num(s.weeklyHours) || 40) * 52 / 12 : this.structure(emp), n = this.fyMonths(emp, month);
      return n > 0 && monthly > 0 ? Math.round(this.taxOf(monthly * n) / n) : 0;
    },
    /* Whether PF and ESI apply to a monthly salary: both go by the wages (basic + DA + special, at least the floor of
       the pay). PF is compulsory up to its wage ceiling and by choice above it; ESI covers wages up to its ceiling. */
    applies(emp, month) {
      const s = this.settings(), total = this.structure(emp), wages = this.codeWages(num(emp.basic) + num(emp.da) + num(emp.special), total, s);
      const pfCeil = this.pfCeilingFor(month || this.todayIso().slice(0, 7), s), esiCeil = num(emp.pwd ? s.esiCeilingPwd : s.esiCeiling);
      return { wages, pfCeil, esiCeil, pf: wages <= pfCeil, esi: wages <= esiCeil };
    },
    codeWages(core, total, s) { return Math.max(r2(core), r2(total * num(s.wagesFloor) / 100)); },
    saveSettings(s) { return Store.set('hr', s); },
    employees(all) { return Store.list('employees').filter(e => all || e.active !== false).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true }) || String(a.name).localeCompare(String(b.name))); },
    employee(id) { return Store.find('employees', id); },
    // The employees a login may see: the HR roles everyone, an employee login themselves and the people who report to them
    visible(all) { const hrRole = this.clockRole(); return this.employees(all).filter(e => hrRole || ['self', 'manager'].includes(this.relation(e))); },
    // Owner and admin give an employee a login of their own: the employee's mobile or email joins the company as Employee
    canGiveLogin() { const co = Companies.current(); return !!(co && co.id) && ['owner', 'admin'].includes(Companies.role()); },
    /* The role of an employee's login (the Role box of the employee): 'employee' unless chosen, one of the built-in
       roles, or 'c:<id>' for a custom role of the company. { value, base, custom, label } */
    roleOf(e) {
      const v = String((e && e.role) || 'employee'), custom = /^c:/.test(v) ? Companies.customRoles().find(x => x.id === v.slice(2)) : null;
      const base = custom ? custom.base : (Companies.ROLES.includes(v) && v !== 'owner' ? v : 'employee');
      return { value: custom ? v : base, base, custom, label: custom ? custom.name : Companies.ROLE_LABEL[base] };
    },
    roleOptions() { return Companies.ROLES.filter(r => r !== 'owner').sort((a, b) => (a === 'employee' ? -1 : b === 'employee' ? 1 : 0)).map(r => [r, Companies.ROLE_LABEL[r]]).concat(Companies.customRoles().map(r => ['c:' + r.id, r.id === Companies.SUPER_ID ? r.name : r.name + ' (' + Companies.ROLE_LABEL[r.base] + ')'])).filter(o => Companies.isSuper() || !Companies.adminRole(o[0])); },
    /* The employee's role was changed: when their mobile number or email already has a login in the company (a member
       or an invitation), that login gets the role. Answers what was done, '' when there is no login yet. */
    async applyRole(e) {
      const co = Companies.current();
      if (!this.canGiveLogin() || !co || !co.id || !Companies.available()) return '';
      const r = this.roleOf(e), ph = String(e.phone || '').replace(/\D/g, '').slice(-10), em = String(e.email || '').trim().toLowerCase();
      if (!ph && !em) return '';
      const list = Companies.checked(await Companies.rpc('list_members', { cid: co.id }), 'Members');
      const m = (Array.isArray(list) ? list : []).find(x => x.role !== 'owner' && ((ph && String(x.phone || '').replace(/\D/g, '').slice(-10) === ph) || (em && String(x.email || '').trim().toLowerCase() === em)));
      if (!m) return '';
      if (m.role !== r.base) Companies.checked(await Companies.rpc('set_member', { cid: co.id, identity: m.phone || m.email, role_in: r.base }), 'Change role');
      if (r.custom || Companies.customOf(m)) Companies.setCustom(m, r.custom ? r.custom.id : '');
      return m.role !== r.base || r.custom ? 'The login of ' + e.name + ' is now ' + r.label : '';
    },
    giveLogin(e) {
      const co = Companies.current(), identity = String(e.email || e.phone || '').trim(), role = this.roleOf(e);
      if (!co || !co.id) return UI.toast('Logins need the server: sign in with sync on first', 5000);
      if (!identity) return UI.toast('Put the mobile number or email on the employee record first', 5000);
      UI.confirm('Give ' + e.name + ' a login', 'Add ' + identity + ' to ' + (co.name || Store.company().name) + ' as ' + role.label + ' (the role on the employee record)? They log in with their own BlitzBook account (registering with this ' + (e.email ? 'email' : 'mobile number') + ' if they have none)' + (role.base === 'employee' ? ', clock in and out, fill their timesheet and raise claims; their reporting manager approves.' : ': ' + Companies.ROLE_HELP[role.base] + '.'),
        async () => { try { const r = await Companies.invite(co.id, identity, role.base); if (role.custom) Companies.setCustom({ user_id: r.user_id || '', phone: e.phone || r.phone || '', email: e.email || r.email || '' }, role.custom.id); UI.toast(Companies.inviteText(r, identity), 8000);
          // The licence the role works with goes with the login when a seat of it is free (Company > Licences): Self Service for an employee
          try { await Companies.rpc('assign_licence', { cid: co.id, who_in: r.user_id || identity.toLowerCase(), kind_in: (global.Lic && Lic.ROLE_KIND[role.base]) || 'self' }); } catch (x) { /* no licences on this server, or no seat free */ } Companies.shareJoin({ e: String(e.email || r.email || '').trim().toLowerCase(), p: String(e.phone || r.phone || '').trim(), n: e.name, c: co.name || Store.company().name, r: role.base, by: (App.user && App.user.name) || '', mailed: !!r.mailed, hasAccount: !r.invited }); } catch (x) { UI.toast(x.message || 'Could not add the login', 6000); } }, 'Give login');
    },
    /* ---- every member of the company is an employee too (other than an investor)
       The members and the people invited (Companies > Members, in the portal or the app) who are not on the employee
       list yet are put there, found by mobile number or email, with the role of their login; the pay and the rest is
       filled in on the record afterwards. A record that lacks the mobile number, the email or the name of its member
       gets it. An employee who was offboarded stays as they are (the record is there), an investor is left out. */
    addMembers(list) {
      if (!Array.isArray(list) || !Companies.mayWrite('employees')) return 0;
      // Not before the books of the company have arrived in this browser: the employees may be on their way
      if (global.Sync && Sync.isSupabase && Sync.isSupabase() && !Sync.state().last) return 0;
      const p10 = (v) => { const d = String(v || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? d : ''; }, low = (v) => String(v || '').trim().toLowerCase();
      const every = this.employees(true), s = this.settings(); let max = 0, added = 0;
      every.forEach(x => { const m = /(\d+)$/.exec(x.code || ''); if (m) max = Math.max(max, +m[1]); });
      list.forEach(m => {
        if (!m || m.role === 'owner' || !Companies.ROLES.includes(m.role) || Companies.isInvestor(m)) return;
        const ph = p10(m.phone), em = low(m.email); if (!ph && !em) return;
        const name = String(m.name || Companies.inviteNames[ph] || Companies.inviteNames[em] || '').trim(), cust = Companies.customOf(m, m.role);
        const e = every.find(x => (ph && p10(x.phone) === ph) || (em && low(x.email) === em));
        if (e) {
          let ch = false;
          if (!String(e.phone || '').trim() && ph) { e.phone = ph; ch = true; }
          if (!String(e.email || '').trim() && em) { e.email = em; ch = true; }
          if (name && e.viaMember && (!e.name || e.name === e.phone || low(e.name) === low(e.email)) && e.name !== name) { e.name = name; ch = true; }
          if (ch) Store.update('employees', e);
          return;
        }
        const rec = { code: 'EMP' + String(++max).padStart(3, '0'), name: name || ph || em, designation: '', department: '', doj: U.today(), dol: '', phone: ph, email: em, address: '', role: cust ? 'c:' + cust.id : m.role,
          payType: 'monthly', hourlyRate: 0, metro: !!s.metro, basic: 0, da: 0, hra: 0, conveyance: 0, special: 0, pf: true, esi: true, pt: true, tds: 0, leavesPerYear: s.leavesPerYear, active: true, manager: '', managerId: '', shiftStart: '', shiftEnd: '', viaMember: true };
        if (Store.add('employees', rec)) { every.push(rec); added++; }
      });
      return added;
    },
    // Asks the server who the members are and puts the missing ones on the employee list (at most once a minute)
    async syncMembers(force) {
      const co = Companies.current();
      if (!co || !co.id || !Companies.available() || !Companies.mayWrite('employees')) return 0;
      const key = co.id, now = Date.now();
      if (!force && this._membersAt && this._membersAt.key === key && now - this._membersAt.at < 60000) return 0;
      this._membersAt = { key, at: now };
      try { const l = Companies.checked(await Companies.rpc('list_members', { cid: co.id }), 'Members'); return (Store.cid || '') === (co.primary && co.role === 'owner' ? '' : co.id) ? this.addMembers(l) : 0; } catch (e) { return 0; }
    },
    /* ---- who may apply leave for whom
       Oneself; the owner, an admin, a manager and HR for anybody; the reporting manager (and the managers above) for
       the people who report to them. Nobody else applies, changes or withdraws another person's leave. */
    leaveForAll() { return ['owner', 'admin', 'manager', 'hr'].includes(Companies.role()); },
    /* Who decides a leave: never the employee themselves (the owner excepted); the owner, an admin, a manager, and
       whoever is above the employee in the reporting line (the reporting manager and the managers above), whatever
       their own role is. The server holds the same line (companies.sql, books_may_write). */
    canApproveLeave(emp) { const r = Companies.role(); if (r === 'owner') return true; const rel = emp ? this.relation(emp) : ''; if (rel === 'self') return false; return r === 'admin' || r === 'manager' || rel === 'manager'; },
    mayApplyFor(e) { if (!e) return false; if (this.leaveForAll()) return true; const rel = this.relation(e); return rel === 'self' || rel === 'manager'; },
    attendance(empId, month) { return Store.list('attendance').find(a => a.empId === empId && a.month === month) || null; },
    timesheet(empId, week) { return Store.list('timesheets').find(t => t.empId === empId && t.week === week) || null; },
    payroll(month) { return Store.list('payroll').find(p => p.month === month) || null; },
    /* Who may approve a timesheet or a claim of an employee: never the employee themselves (the login whose mobile or
       email is on the employee record), otherwise the employee's reporting manager and the managers above them (any
       login with HR access), or the roles above (owner, admin, manager). The owner is the top and is never held to
       the self rule. The server (companies.sql, hr_relation) applies the same rule. */
    myEmployee() { const u = App.user || {}, ph = String(u.phone || '').trim(), em = String(u.email || '').trim().toLowerCase(); if (!ph && !em) return null; return this.employees(true).find(e => (ph && String(e.phone || '').trim() === ph) || (em && String(e.email || '').trim().toLowerCase() === em)) || null; },
    // 'self' | 'manager' (somewhere up the employee's reporting line) | ''
    relation(emp) { const me = this.myEmployee(); if (!me || !emp) return ''; let cur = emp, i = 0; while (cur && i < 8) { if (cur.id === me.id) return i === 0 ? 'self' : 'manager'; cur = cur.managerId ? this.employee(cur.managerId) : null; i++; } return ''; },
    canApprove(emp) {
      const r = Companies.role(); if (r === 'owner') return true;
      const rel = emp ? this.relation(emp) : '';
      if (rel === 'self') return false;
      return r === 'admin' || r === 'manager' || (rel === 'manager' && Companies.mayWrite('timesheets'));
    },
    // Any approval right at all (for the screens' hints): a role above, or a reporting manager of someone
    approver() { const r = Companies.role(); return r === 'owner' || r === 'admin' || r === 'manager' || (!!this.myEmployee() && this.employees(true).some(e => this.relation(e) === 'manager')); },
    // HR & payroll come with the Full access plans (and the trial); members use the owner's plan, or their own Self
    // Service, HR or Accounts + HR licence (Sub.isFull knows it)
    allowed() { return Sub.isFull(); },
    lock() {
      UI.modal({ title: 'Full access subscription required', body: '<div class="gstlock"><div class="big">🔒</div><div><p>HR & payroll (employees, attendance, timesheets, reimbursements, payroll, payslips and offer letters) come with the Full access plans, which cover accounts and HR together. ' + esc(Sub.statusText()) + '.</p></div></div>',
        buttons: [{ label: 'Close', cls: 'outline' }, { label: 'Buy Full access', cls: 'blue', onClick: () => { if (Store.cid) Companies.switcher(); else Subscription.plans(); } }] });
      return false;
    },
    hourly(emp) { return emp.payType === 'hourly'; },
    structure(emp) { return this.hourly(emp) ? 0 : num(emp.basic) + num(emp.da) + num(emp.hra) + num(emp.conveyance) + num(emp.special); },
    // HRA from basic: 50% in a metro city, 40% elsewhere (the income-tax exemption limits), unless typed
    hraOf(basic, metro) { const s = this.settings(); return r2(num(basic) * ((metro != null ? metro : s.metro) ? 50 : num(s.hraPct) || 40) / 100); },
    holidayMap() { const m = new Map(); (this.settings().holidays || []).forEach(h => m.set(h.date, h.name)); return m; },
    isOff(date) { const s = this.settings(), offs = String(s.weeklyOff || '').split(',').map(x => +x).filter(x => !isNaN(x)); return offs.includes(date.getDay()); },
    // Weekly offs and holidays of a month from the settings, as the default statuses of its days
    defaults(month, emp) {
      const hol = this.holidayMap(), out = {};
      // A day still to come, one before the employee joined or one after their last working day is not a day of theirs
      const sp = this.span(emp || null, month);
      for (let d = 1; d <= daysIn(month); d++) out[d] = d < sp.from || d > sp.to ? 'NA' : hol.has(dateOf(month, d)) ? 'H' : this.isOff(fromIso(month + '-' + pad(d))) ? 'W' : 'P';
      // Marked from the Web Clock for an employee who uses it that month: a past working day with a clock-in is
      // present (a half day under half the hours of a day), one without a clock-in absent; today and the days to
      // come stay present. A tap on the grid still overrides any day.
      if (emp && this.settings().attFromClock !== false) {
        const today = this.todayIso(), half = (num(this.settings().hoursPerDay) || 8) / 2;
        const used = Store.list('clock').some(c => c.empId === emp.id && String(c.date).slice(0, 7) === month && Array.isArray(c.punches) && c.punches.length > 0);
        if (used) for (let d = 1; d <= daysIn(month); d++) { const date = month + '-' + pad(d); if (out[d] !== 'P' || date >= today) continue; const dc = this.dayClock(emp, date); out[d] = dc.punched ? (dc.hours >= half ? 'P' : 'HD') : 'A'; }
      }
      // Approved leave (leave requests) marks its working days by itself: over present, and over the absent or half
      // day the Web Clock would give a day without a full clock-in
      if (emp) { const lv = this.leaveMap(emp.id); if (lv.size) for (let d = 1; d <= daysIn(month); d++) { const m = lv.get(month + '-' + pad(d)); if (m && ['P', 'A', 'HD'].includes(out[d])) out[d] = m; } }
      return out;
    },
    /* A day still to come ('' for today and the days gone by): nobody can be present, absent or on a half day on it
       yet. The holidays of the list and the weekly offs show by themselves, approved leave requests too, and leave
       can be entered ahead by hand; it is counted once the day comes. 'NA' is a working day to come, or a day the employee is not on the rolls. */
    ahead(emp, month, d, a) {
      const date = month + '-' + pad(d);
      if (date <= this.todayIso()) return '';
      const ms = fromIso(date).getTime(), j = emp ? U.dateMs(emp.doj) : 0, l = emp ? U.dateMs(emp.dol) : 0;
      if ((j && ms < j) || (l && ms > l)) return 'NA';
      return a && a.days && a.days[d] === 'L' ? 'L' : this.holidayMap().has(dateOf(month, d)) ? 'H' : this.isOff(fromIso(date)) ? 'W' : (emp && this.leaveMap(emp.id).get(date)) || 'NA';
    },
    // The status a day shows on the grid and in the export
    dayMark(emp, month, d, a, de) { return this.ahead(emp, month, d, a) || (a && a.days && a.days[d]) || de[d]; },
    // Days of the month by status, the hours worked and the overtime hours, from the attendance record (a month without
    // one counts as fully present)
    summary(emp, month) {
      const a = this.attendance(emp.id, month) || { days: {}, ot: {} }, def = this.defaults(month, emp), s = this.settings(), sp = this.span(emp, month);
      const out = { P: 0, A: 0, L: 0, HL: 0, HD: 0, W: 0, H: 0, hours: 0, ot: 0, lop: 0, paid: 0, total: daysIn(month), from: sp.from, to: sp.to, days: sp.days };
      for (let d = 1; d <= out.total; d++) {
        // Only the days of the pay period count: a mark on a day outside it (still to come, before joining, after leaving) does not
        const st = d < sp.from || d > sp.to ? 'NA' : (a.days && a.days[d]) || def[d];
        if (st !== 'NA') { out[st] = (out[st] || 0) + 1; if (st === 'P') out.hours += num(s.hoursPerDay); else if (st === 'HD' || st === 'HL') out.hours += num(s.hoursPerDay) / 2; }
        out.ot += num(a.ot && a.ot[d]);
      }
      // Leave in days: a half-day leave (HL) is half a day of leave, paid in full; a half day (HD) is half a day's loss of pay
      out.leave = out.L + out.HL / 2;
      out.lop = out.A + out.HD / 2; out.paid = Math.max(0, out.days - out.lop); out.hours += out.ot;
      return out;
    },
    /* Hours of an hourly employee in a month from the weekly timesheets: the hours of the days that fall in the month,
       with the hours of a week above the weekly limit as overtime (a week counts in the month its Monday is in), the
       holidays of the list that fall on working days paid at the hours of a day, and how many of the month's
       timesheets are still to be approved. */
    hoursOf(emp, month) {
      const s = this.settings(), limit = num(s.weeklyHours) || 40, out = { regular: 0, ot: 0, holiday: 0, days: 0, weeks: 0, unapproved: 0, hours: 0 }, sp = this.span(emp, month);
      const inSpan = (d) => iso(d).slice(0, 7) === month && d.getDate() >= sp.from && d.getDate() <= sp.to;
      Store.list('timesheets').filter(t => t.empId === emp.id).forEach(t => {
        const mon = fromIso(t.week); let inMonth = 0, total = 0, days = 0;
        for (let i = 0; i < 7; i++) { const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i), h = num(t.hours && t.hours[i]); total += h; if (inSpan(d) && h > 0) { inMonth += h; days++; } }
        if (!inMonth && iso(mon).slice(0, 7) !== month) return;
        out.weeks++; out.days += days; if (!t.approved) out.unapproved++;
        const ot = iso(mon).slice(0, 7) === month ? Math.max(0, total - limit) : 0;
        out.ot += Math.min(ot, inMonth); out.regular += inMonth - Math.min(ot, inMonth);
      });
      if (s.holidayPaid !== false) this.holidayMap().forEach((name, date) => { const ms = U.dateMs(date); if (!ms) return; const d = new Date(ms); if (inSpan(d) && !this.isOff(d)) out.holiday += num(s.hoursPerDay); });
      out.hours = out.regular + out.ot + out.holiday;
      return out;
    },
    /* Leave requests. An employee asks for leave from a day to a day; the reporting manager (or a role above) approves
       or rejects it, never the employee themselves: the rule of the claims. A request is kept with the claims (a
       record of the reimbursements, "rb:", with kind 'leave'), because the server (companies.sql) already holds those
       records to exactly that rule: the employee writes their own while it is pending, only someone entitled decides.
       An approved request marks its working days on the attendance by itself (defaults): L, or A for loss of pay;
       a half-day request (half: 'first' | 'second', one day) marks HL, half a day of paid leave, or HD for loss of
       pay; holidays and weekly offs inside it are not counted. A mark made by hand on the grid still wins. A request
       withdrawn, rejected or cancelled marks nothing. */
    claims() { return Store.list('reimbursements').filter(r => r.kind !== 'leave'); },
    leaves() { return Store.list('reimbursements').filter(r => r.kind === 'leave'); },
    // The working days of a request (not the weekly offs, not the holidays of the list), as ISO dates
    leaveDates(r) {
      const a = U.dateMs(r.from), b = U.dateMs(r.to) || a, out = [], hol = this.holidayMap();
      if (!a || b < a) return out;
      for (let t = new Date(a), n = 0; t.getTime() <= b && n < 370; t.setDate(t.getDate() + 1), n++) if (!this.isOff(t) && !hol.has(U.dmy(t))) out.push(iso(t));
      return out;
    },
    // The days of leave a request asks for: its working days, half a day for a half-day request
    leaveCount(r) { return this.leaveDates(r).length * (r.half ? 0.5 : 1); },
    // The approved leave of an employee: ISO date -> 'L' ('HL' for a half day), or 'A' ('HD') for loss of pay
    leaveMap(empId) { const m = new Map(); this.leaves().forEach(r => { if (r.empId === empId && r.status === 'approved') { const lop = r.type === 'Loss of pay', mark = r.half ? (lop ? 'HD' : 'HL') : (lop ? 'A' : 'L'); this.leaveDates(r).forEach(s => m.set(s, mark)); } }); return m; },
    // The last month of the financial year that is running: the leave of the whole year, what is booked ahead included
    leaveYearEnd() { const t = this.todayIso(), y = +t.slice(0, 4), mo = +t.slice(5, 7); return (mo >= 4 ? y + 1 : y) + '-03'; },
    // Leave taken in the financial year so far against the yearly quota: the days marked L on the attendance and the
    // days of the approved requests (a day marked otherwise by hand counts as it is marked)
    leaveBalance(emp, month) {
      const [y, mo] = month.split('-').map(Number), fy = mo >= 4 ? y : y - 1, marked = new Set();
      let used = 0;
      Store.list('attendance').forEach(a => { if (a.empId !== emp.id) return; const [ay, am] = a.month.split('-').map(Number); const afy = am >= 4 ? ay : ay - 1; if (afy !== fy || (ay > y || (ay === y && am > mo))) return; Object.keys(a.days || {}).forEach(d => { marked.add(a.month + '-' + pad(d)); if (a.days[d] === 'L') used++; else if (a.days[d] === 'HL') used += 0.5; }); });
      this.leaveMap(emp.id).forEach((m, s) => { if ((m !== 'L' && m !== 'HL') || marked.has(s)) return; const ay = +s.slice(0, 4), am = +s.slice(5, 7), afy = am >= 4 ? ay : ay - 1; if (afy === fy && !(ay > y || (ay === y && am > mo))) used += m === 'HL' ? 0.5 : 1; });
      // By kind of leave: a day marked L by hand belongs to the request that covers it, else to the first kind of the policy
      const pol = this.policyOf(emp), names = pol.types.map(t => t.name), byType = {}, kindOf = this.leaveTypeMap(emp.id), first = names[0] || 'Casual leave';
      const add = (s, n) => { const t = kindOf.get(s), k = t && names.includes(t) ? t : first; byType[k] = (byType[k] || 0) + n; };
      Store.list('attendance').forEach(a => { if (a.empId !== emp.id) return; const [ay, am] = a.month.split('-').map(Number); const afy = am >= 4 ? ay : ay - 1; if (afy !== fy || (ay > y || (ay === y && am > mo))) return; Object.keys(a.days || {}).forEach(d => { if (a.days[d] === 'L') add(a.month + '-' + pad(d), 1); else if (a.days[d] === 'HL') add(a.month + '-' + pad(d), 0.5); }); });
      this.leaveMap(emp.id).forEach((m, s) => { if ((m !== 'L' && m !== 'HL') || marked.has(s)) return; const ay = +s.slice(0, 4), am = +s.slice(5, 7), afy = am >= 4 ? ay : ay - 1; if (afy === fy && !(ay > y || (ay === y && am > mo))) add(s, m === 'HL' ? 0.5 : 1); });
      // Earned so far: up to the month asked about, and never beyond the month that is running
      const now = this.todayIso().slice(0, 7), upto = month < now ? month : now, months = this.leaveMonths(emp, fy, upto);
      // A balance is never below nothing: what was taken beyond what was earned is loss of pay, not a debt of leave
      const types = pol.types.map(t => { const q = num(t.days), accrued = Math.min(q, Math.floor(q * months / 12 * 2 + 1e-9) / 2), u = byType[t.name] || 0; return { name: t.name, quota: q, accrued, used: u, left: Math.max(0, accrued - u), over: Math.max(0, u - accrued) }; });
      const quota = types.reduce((a, t) => a + t.quota, 0), accrued = types.reduce((a, t) => a + t.accrued, 0);
      return { quota, accrued, used, left: types.reduce((a, t) => a + t.left, 0), over: types.reduce((a, t) => a + t.over, 0), types };
    },
    // ---- the leave policy (LEAVE_POLICY; what the company changed is on the HR settings)
    leavePolicy() {
      const saved = this.settings().leavePolicy || {}, out = {};
      Object.keys(LEAVE_POLICY).forEach(g => { const d = LEAVE_POLICY[g], s = saved[g] || {};
        out[g] = { key: g, name: d.name, types: (Array.isArray(s.types) && s.types.length ? s.types : d.types).map(t => ({ name: String(t.name || '').trim(), days: Math.max(0, num(t.days)), note: String(t.note || '').trim() })).filter(t => t.name && t.name !== 'Loss of pay'), rules: (Array.isArray(s.rules) && s.rules.length ? s.rules : d.rules).map(x => String(x).trim()).filter(Boolean) }; });
      return out;
    },
    // The group an employee is in: what their record says, else Manpower for someone on the roster of a staffing agency
    policyGroup(emp) {
      if (emp && (emp.leaveGroup === 'staff' || emp.leaveGroup === 'manpower')) return emp.leaveGroup;
      if (!emp || !U.isStaffingCo(Store.company())) return 'staff';
      const code = String(emp.code || '').trim().toLowerCase(), name = String(emp.name || '').trim().toLowerCase();
      return (Store.list('manpower') || []).some(m => (code && String(m.code || '').trim().toLowerCase() === code) || (name && String(m.name || '').trim().toLowerCase() === name)) ? 'manpower' : 'staff';
    },
    policyOf(emp) { return this.leavePolicy()[this.policyGroup(emp)]; },
    policyDays(emp) { return this.policyOf(emp).types.reduce((a, t) => a + t.days, 0); },
    leaveTypesFor(emp) { return this.policyOf(emp).types.map(t => t.name).concat(['Loss of pay']); },
    // ISO date -> the kind of leave of the approved request that covers it
    leaveTypeMap(empId) { const m = new Map(); this.leaves().forEach(r => { if (r.empId === empId && r.status === 'approved' && r.type !== 'Loss of pay') this.leaveDates(r).forEach(s => m.set(s, r.type)); }); return m; },
    /* The months of leave earned in the financial year fy up to the month 'upto' (yyyy-mm, inclusive): one a month from
       April, or from the date of joining when that is inside the year, the month of joining in proportion to its days */
    leaveMonths(emp, fy, upto) {
      const [uy, um] = upto.split('-').map(Number), end = uy * 12 + (um - 1), start = fy * 12 + 3, last = Math.min(end, start + 11);
      if (last < start) return 0;
      let from = start, part = 1;
      const j = emp && emp.doj ? U.dateMs(emp.doj) : 0;
      if (j) { const d = new Date(j), jm = d.getFullYear() * 12 + d.getMonth(); if (jm > last) return 0; if (jm >= start) { from = jm; const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); part = (dim - d.getDate() + 1) / dim; } }
      return (last - from) + part;
    },
    /* ---- no leave below nothing
       What a request of paid leave may still take: the balance of its kind (earned so far less taken or approved),
       less the other requests of that kind still waiting. A request for more is cut: the working days the balance
       covers stay as asked, the days after them become a request of loss of pay of their own (a half day with no
       balance becomes loss of pay whole). fitLeave answers the one or two requests to keep; r itself is the first. */
    leaveRoom(r) {
      const e = this.employee(r.empId); if (!e || r.type === 'Loss of pay') return Infinity;
      const b = this.leaveBalance(e, this.leaveYearEnd()), t = b.types.find(x => x.name === r.type); if (!t) return Infinity;
      const waiting = this.leaves().filter(o => o.id !== r.id && o.empId === r.empId && o.status === 'pending' && o.type === r.type).reduce((a, o) => a + this.leaveCount(o), 0);
      // An approved request is in 'used' already: its own days are free for it
      const own = r.id && r.status === 'approved' ? this.leaveCount(r) : 0;
      return Math.max(0, t.left + own - waiting);
    },
    fitLeave(r) {
      const room = this.leaveRoom(r), days = this.leaveDates(r), n = this.leaveCount(r);
      if (room === Infinity || n <= room + 1e-9) return [r];
      const keep = r.half ? 0 : Math.floor(room + 1e-9), dmy = (s) => U.dmy(fromIso(s)), was = r.type;
      if (keep <= 0) { r.lopFor = was; r.type = 'Loss of pay'; return [r]; }
      const rest = Object.assign({}, r, { id: undefined, createdAt: undefined, updatedAt: undefined, from: dmy(days[keep]), to: r.to, date: dmy(days[keep]), type: 'Loss of pay', lopFor: was });
      delete rest.id; delete rest.createdAt; delete rest.updatedAt;
      r.to = dmy(days[keep - 1]);
      return [r, rest];
    },
    policyText(g) {
      const p = this.leavePolicy()[g], co = Store.company().name || 'the company';
      return 'LEAVE POLICY - ' + co + '\n' + p.name + '\n\n' + p.types.map(t => t.name + ': ' + t.days + ' days a year (' + (Math.round(t.days / 12 * 100) / 100) + ' a month). ' + t.note).join('\n') + '\nLoss of pay: leave without pay, when the balance is used up.\n\n' + p.rules.map((x, i) => (i + 1) + '. ' + x).join('\n');
    },
    policyAck() { return App.user ? (Store.peek(App.user.id, 'policy_ack:' + (Store.cid || 'own'), null) || null) : null; },
    /* ---- HR Policy screen: the leave policy as everyone reads it, the balance of the login by kind of leave, and
       for HR, an admin or the owner the days and the wording to change, to print and to send to the people */
    screenPolicy(p) {
      const pol = this.leavePolicy(), me = this.myEmployee(), edit = Companies.mayWrite('hr') && !Companies.leaveOnly() && ['owner', 'admin', 'manager', 'hr'].includes(Companies.role());
      const staffing = U.isStaffingCo(Store.company()), groups = Object.keys(pol).filter(g => g === 'staff' || staffing || this.employees(true).some(e => e.leaveGroup === g));
      const mine = me ? this.policyGroup(me) : '', show = edit ? groups : groups.filter(g => !mine || g === mine);
      const g0 = show.includes(p && p.g) ? p.g : (mine && show.includes(mine) ? mine : show[0]), P = pol[g0];
      const bal = me ? this.leaveBalance(me, this.leaveYearEnd()) : null, ack = this.policyAck();
      const perMonth = (d) => String(Math.round(num(d) / 12 * 100) / 100);
      const row = (t, i) => edit ? '<tr><td><input class="plName" value="' + esc(t.name) + '" maxlength="40" style="min-width:150px"></td><td class="num"><input class="plDays" type="number" min="0" step="0.5" value="' + t.days + '" style="width:90px"></td><td class="num plPm">' + perMonth(t.days) + '</td><td><input class="plNote" value="' + esc(t.note) + '" maxlength="300" style="min-width:320px;width:100%"></td><td class="actions"><button class="btn sm red outline" data-pldel="' + i + '">Remove</button></td></tr>'
        : '<tr><td><b>' + esc(t.name) + '</b></td><td class="num">' + t.days + '</td><td class="num">' + perMonth(t.days) + '</td><td class="left">' + esc(t.note) + '</td></tr>';
      const root = App.view(App.header('HR Policy', '<div class="btnrow" style="margin:0">' + (Companies.mayOpen('leave') ? '<button class="btn sm outline" id="plLeave">Leave</button>' : '') + '<button class="btn sm outline" id="plPrint">Print / PDF</button>' + (edit ? '<button class="btn sm blue" id="plSend">Send to the staff</button><button class="btn sm green" id="plSave">Save policy</button>' : '') + '</div>') +
        (show.length > 1 ? '<div class="btnrow">' + show.map(g => '<button class="btn sm ' + (g === g0 ? '' : 'outline') + '" data-plg="' + g + '">' + esc(pol[g].name) + '</button>').join('') + '</div>' : '') +
        (bal && (!mine || mine === g0) ? '<div class="card white"><div class="hd">My leave balance</div><div class="bd"><table class="list"><thead><tr><th>Leave</th><th class="num">Days a year</th><th class="num">Earned so far</th><th class="num">Taken or approved</th><th class="num">Left</th></tr></thead><tbody>' + bal.types.map(t => '<tr><td><b>' + esc(t.name) + '</b></td><td class="num">' + t.quota + '</td><td class="num">' + t.accrued + '</td><td class="num">' + t.used + '</td><td class="num"><b>' + t.left + '</b></td></tr>').join('') + '<tr class="total"><td>Total</td><td class="num">' + bal.quota + '</td><td class="num">' + bal.accrued + '</td><td class="num">' + bal.used + '</td><td class="num"><b>' + bal.left + '</b></td></tr></tbody></table>' +
          (me && me.doj ? '<div class="hint">Joined on ' + esc(me.doj) + ': leave is earned from that day, month by month.</div>' : '') + '</div></div>' : '') +
        '<div class="card white"><div class="hd">Leave policy: ' + esc(P.name) + '</div><div class="bd"><div class="hint" style="margin-bottom:8px">The days of a year are earned month by month (a twelfth a month, from April); someone who joins during the year earns from the date of joining, in proportion. The policy applies to every employee from the day they are added.' + (g0 === 'manpower' ? ' It applies to the staff on the Manpower roster and to the employees whose record says Manpower.' : '') + '</div>' +
        '<div class="tablewrap"><table class="list" id="plTypes"><thead><tr><th>Leave</th><th class="num">Days a year</th><th class="num">Earned a month</th><th>Rule</th>' + (edit ? '<th></th>' : '') + '</tr></thead><tbody>' + P.types.map(row).join('') + '<tr><td><b>Loss of pay</b></td><td class="num">-</td><td class="num">-</td><td class="left">Leave without pay, when the balance is used up: its days are marked absent.</td>' + (edit ? '<td></td>' : '') + '</tr></tbody></table></div>' +
        (edit ? '<div class="btnrow" style="margin-top:8px"><button class="btn sm outline" id="plAdd">+ Another kind of leave</button><button class="btn sm outline" id="plStd">Put the standard policy back</button></div>' : '') +
        '<div class="field span" style="margin-top:12px"><label>Rules</label>' + (edit ? '<textarea id="plRules" style="min-height:220px">' + esc(P.rules.join('\n')) + '</textarea><div class="hint">One rule a line.</div>' : '<ol style="margin:4px 0 0 18px;padding:0">' + P.rules.map(x => '<li style="margin-bottom:4px">' + esc(x) + '</li>').join('') + '</ol>') + '</div></div></div>' +
        (me && !edit ? '<div class="card white"><div class="bd" id="plAckBox">' + (ack ? '<span class="pill ok">Read</span> You confirmed on ' + esc(U.dmy(new Date(ack.at))) + ' that you have read this policy.' : '<button class="btn green" id="plAck">I have read the leave policy</button>') + '</div></div>' : ''));
      App.wireBack(root);
      const again = (q) => App.go('hrpolicy', Object.assign({ g: g0 }, q || {}));
      $$('[data-plg]', root).forEach(b => b.onclick = () => again({ g: b.dataset.plg }));
      if ($('#plLeave')) $('#plLeave').onclick = () => App.go('leave');
      if ($('#plAck')) $('#plAck').onclick = () => { Store.poke(App.user.id, 'policy_ack:' + (Store.cid || 'own'), { at: Date.now() }); UI.toast('Thank you: noted', 2500, 'ok'); App.refreshBar(); again(); };
      const collect = () => ({ types: $$('#plTypes tbody tr', root).map(tr => $('.plName', tr) ? { name: String($('.plName', tr).value).trim().replace(/\s+/g, ' '), days: Math.max(0, num($('.plDays', tr).value)), note: String($('.plNote', tr).value).trim() } : null).filter(t => t && t.name), rules: String(UI.val('plRules') || '').replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean) });
      $('#plPrint').onclick = () => UI.pdf('Leave Policy', P.name, ['Leave', 'Days a year', 'Earned a month', 'Rule'], P.types.map(t => [t.name, String(t.days), perMonth(t.days), t.note]).concat([['Loss of pay', '-', '-', 'Leave without pay, when the balance is used up.'], ['', '', '', '']]).concat(P.rules.map((x, i) => ['Rule ' + (i + 1), '', '', x])), { right: [1, 2] });
      if (!edit) return;
      $$('.plDays', root).forEach(i => i.oninput = () => { $('.plPm', i.closest('tr')).textContent = perMonth(i.value); });
      const put = (o) => { const s = this.settings(), lp = Object.assign({}, s.leavePolicy || {}); if (o) lp[g0] = o; else delete lp[g0]; s.leavePolicy = lp; if (g0 === 'staff') s.leavesPerYear = (o ? o.types : LEAVE_POLICY.staff.types).reduce((a, t) => a + num(t.days), 0) || s.leavesPerYear; return this.saveSettings(s) !== false; };
      const save = () => { const o = collect(); if (!o.types.length) { UI.toast('Keep at least one kind of leave'); return false; } if (new Set(o.types.map(t => t.name.toLowerCase())).size < o.types.length || o.types.some(t => t.name.toLowerCase() === 'loss of pay')) { UI.toast('Each kind of leave needs a name of its own'); return false; } return put(o); };
      $('#plSave').onclick = () => { if (save()) { UI.toast('Leave policy saved: the balances follow it from now', 4000, 'ok'); again(); } };
      $('#plAdd').onclick = () => { const o = collect(); o.types.push({ name: 'Other leave', days: 0, note: '' }); if (put(o)) again(); };
      $$('[data-pldel]', root).forEach(b => b.onclick = () => { const o = collect(); o.types.splice(+b.dataset.pldel, 1); if (!o.types.length) return UI.toast('Keep at least one kind of leave'); if (put(o)) again(); });
      $('#plStd').onclick = () => UI.confirm('Standard policy', 'Put the standard leave policy of ' + P.name + ' back? The days and the rules you changed here are replaced.', () => { if (put(null)) again(); }, 'Put back');
      $('#plSend').onclick = () => { if (save()) this.sendPolicy(g0); };
    },
    // The policy as a message: copied, or sent to an employee on WhatsApp or by email
    sendPolicy(g) {
      const text = this.policyText(g), emps = this.employees().filter(e => this.policyGroup(e) === g && (e.phone || e.email));
      const bg = UI.modal({ title: 'Send the leave policy', wide: true, body: '<p>Everyone with a login reads the policy under HR &gt; HR Policy and is reminded by the bell until they confirm it. Send it as a message too:</p>' +
          UI.field('To', UI.select('psEmp', emps.map(e => [e.id, e.name + (e.code ? ' (' + e.code + ')' : '') + ' - ' + (e.phone || e.email)]), '', { blank: emps.length ? '- choose an employee -' : 'No employee of this group has a mobile number or an email' })) +
          UI.field('Message', '<textarea id="psText" readonly style="min-height:260px">' + esc(text) + '</textarea>', { span: true }),
        buttons: [{ label: 'Close', cls: 'outline' }, { label: 'Copy', cls: 'outline', onClick: () => { const t = $('#psText', bg); t.select(); try { document.execCommand('copy'); } catch (e) { /* older browser */ } if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => { /* fine */ }); UI.toast('Policy copied', 2500, 'ok'); return false; } },
          { label: 'Email', cls: 'blue', onClick: () => { const e = this.employee(UI.val('psEmp', bg)); if (!e || !e.email) { UI.toast('Choose an employee who has an email'); return false; } window.open('mailto:' + encodeURIComponent(e.email) + '?subject=' + encodeURIComponent('Leave policy - ' + (Store.company().name || '')) + '&body=' + encodeURIComponent(text), '_blank'); return false; } },
          { label: 'WhatsApp', cls: 'green', onClick: () => { const e = this.employee(UI.val('psEmp', bg)), ph = e ? String(e.phone || '').replace(/\D/g, '').slice(-10) : ''; window.open('https://wa.me/' + (ph.length === 10 ? '91' + ph : '') + '?text=' + encodeURIComponent(text), '_blank'); return false; } }] });
      return bg;
    },
    /* ---- the bell in the top bar: what waits for this login
       approve   a leave request or a claim of somebody else that this login may decide
       decided   one's own request that was approved or rejected (in the last 30 days), until the bell was opened
       policy    the leave policy, for an employee login, until they confirm having read it */
    notices() {
      const out = [];
      if (!App.user || !Store.uid) return out;
      const me = this.myEmployee(), seen = Store.peek(App.user.id, 'notice_seen:' + (Store.cid || 'own'), {}) || {}, since = Date.now() - 30 * 86400000;
      Store.list('reimbursements').forEach(r => {
        const e = this.employee(r.empId); if (!e) return;
        const leave = r.kind === 'leave', own = !!me && e.id === me.id, what = leave ? (r.type || 'leave') + ' from ' + r.from + (r.to && r.to !== r.from ? ' to ' + r.to : '') + (r.half ? ' (half day)' : '') : 'a claim of ' + money(num(r.amount)) + (r.category ? ' (' + r.category + ')' : '');
        if (r.status === 'pending' && !own && (leave ? this.canApproveLeave(e) : this.canApprove(e)) && Companies.mayOpen(leave ? 'leave' : 'reimbursements')) out.push({ id: 'a:' + r.id, kind: 'approve', route: leave ? 'leave' : 'reimbursements', params: { status: 'pending' }, title: e.name + ' asks for ' + what, sub: 'Waiting for your approval' + (r.askedOn || r.date ? ' · asked on ' + (r.askedOn || r.date) : '') });
        else if (own && ['approved', 'rejected'].includes(r.status) && num(r.approvedAt) > since && !seen['d:' + r.id + ':' + r.status]) out.push({ id: 'd:' + r.id + ':' + r.status, kind: r.status, route: leave ? 'leave' : 'reimbursements', params: {}, title: 'Your ' + (leave ? 'leave' : 'claim') + ' was ' + r.status + ': ' + what, sub: (r.approvedBy ? 'By ' + r.approvedBy : '') });
      });
      if (me && Store.cid && Companies.role() !== 'owner' && !this.policyAck()) out.push({ id: 'policy', kind: 'policy', route: 'hrpolicy', params: {}, title: 'Leave policy of ' + (Store.company().name || 'the company'), sub: 'Read it and confirm' });
      return out;
    },
    bell() {
      const list = this.notices(), pill = (k) => k === 'approve' ? 'warn' : k === 'rejected' ? 'bad' : 'ok', label = (k) => k === 'approve' ? 'To approve' : k === 'policy' ? 'Policy' : k[0].toUpperCase() + k.slice(1);
      const bg = UI.modal({ title: 'Notifications', body: list.length ? '<div class="menu-list">' + list.map((n, i) => '<button data-n="' + i + '" style="text-align:left;white-space:normal"><span class="pill ' + pill(n.kind) + '" style="margin-right:8px">' + label(n.kind) + '</span><b>' + esc(n.title) + '</b>' + (n.sub ? '<div class="small muted" style="margin-top:2px">' + esc(n.sub) + '</div>' : '') + '</button>').join('') + '</div>' : '<div class="hint">Nothing waits for you.</div>', buttons: [{ label: 'Close', cls: 'outline' }] });
      $$('[data-n]', bg).forEach(b => b.onclick = () => { const n = list[+b.dataset.n]; bg.remove(); App.go(n.route, n.params); });
      // The decisions shown are read now: they leave the bell
      const seen = Store.peek(App.user.id, 'notice_seen:' + (Store.cid || 'own'), {}) || {}; let ch = false;
      list.forEach(n => { if (n.id.indexOf('d:') === 0) { seen[n.id] = Date.now(); ch = true; } });
      if (ch) { Store.poke(App.user.id, 'notice_seen:' + (Store.cid || 'own'), seen); App.refreshBar(); }
      return bg;
    },
    ptOf(gross, s) {
      let slabs = PT[s.ptState] || [];
      if (s.ptState === 'Custom slabs' || !slabs.length) slabs = String(s.ptSlabs || '').split(/[;,\n]/).map(x => x.trim()).filter(Boolean).map(x => { const [lim, tax] = x.split(':'); return [lim.trim() === '*' ? '*' : num(lim), num(tax)]; });
      for (const [lim, tax] of slabs) if (lim === '*' || gross <= lim) return r2(tax);
      return 0;
    },
    /* A claim is "paid" when a finalised payroll carries its id (each payroll row lists the claims it pays, reimbIds),
       so the claim record itself is written only when it is entered (HR) or decided (a manager); the server lets the
       HR role save a claim only while it is pending. Reopening a month frees its claims by itself. */
    paidIn(claimId) { const run = Store.list('payroll').find(p => p.status === 'final' && (p.rows || []).some(row => (row.reimbIds || []).includes(claimId))); return run ? run.month : (Store.find('reimbursements', claimId) || {}).paidMonth || ''; },
    claimState(r) { const paid = r.status === 'paid' ? (r.paidMonth || '') : r.status === 'approved' ? this.paidIn(r.id) : ''; return paid ? { status: 'paid', paidMonth: paid } : { status: r.status, paidMonth: '' }; },
    // Approved reimbursements to pay with this month: not yet paid by another finalised month
    reimbursementsOf(empId, month) { return this.claims().filter(r => r.empId === empId && (r.status === 'approved' || r.status === 'paid') && [month, ''].includes(this.claimState(r).paidMonth)); },
    // One employee's pay for a month: earned per paid day (or the timesheet hours at the rate), overtime, reimbursements,
    // then PF / ESI / PT / TDS. prev keeps the manual entries (advance recovered, other deductions, remarks).
    compute(emp, month, prev, opt) {
      const s = this.settings(), hourly = this.hourly(emp), full = !!(opt && opt.full), n = daysIn(month);
      let basic = 0, da = 0, hra = 0, conv = 0, special = 0, gross = 0, ot = 0, structure = 0, sum = { total: n, days: n, from: 1, to: n, paid: 0, lop: 0, P: 0, L: 0, hours: 0, ot: 0 }, hoursInfo = null;
      if (hourly) {
        hoursInfo = this.hoursOf(emp, month);
        const rate = num(emp.hourlyRate), sp = this.span(emp, month);
        basic = r2((hoursInfo.regular + hoursInfo.holiday) * rate); gross = basic; ot = r2(hoursInfo.ot * rate * (num(s.usOtMultiplier) || 1.5));
        structure = r2(gross + ot); sum.paid = hoursInfo.days; sum.hours = hoursInfo.hours; sum.ot = hoursInfo.ot; sum.from = sp.from; sum.to = sp.to; sum.days = sp.days;
      } else {
        // full: the whole month at full attendance, whatever the day is (the offer letter, the settlement's rates)
        if (full) sum.paid = n; else sum = this.summary(emp, month);
        const earn = (v) => r2(num(v) * sum.paid / sum.total);
        basic = earn(emp.basic); da = earn(emp.da); hra = earn(emp.hra); conv = earn(emp.conveyance); special = earn(emp.special);
        structure = this.structure(emp);
        gross = r2(basic + da + hra + conv + special);
        ot = r2(sum.ot * (structure / (26 * (num(s.hoursPerDay) || 8))) * (num(s.otMultiplier) || 1));
      }
      // Wages (Code on Social Security): basic, DA and the special allowance; HRA, conveyance and overtime are left
      // out, but only up to half of the pay: what they are above half is added to the wages. An hourly employee's
      // wages are the pay for the hours, without the overtime.
      const core = r2(basic + da + special), wages = hourly ? gross : this.codeWages(core, gross + ot, s), wagesAdded = hourly ? 0 : r2(Math.max(0, wages - core));
      /* September 2026 straddles the two ceilings: the wages are apportioned, those of 1-16 September under 15,000
         and those of 17-30 September under 25,000, each part held to its own share of its ceiling (the EPFO's
         wage ceiling FAQs of 17 September 2026). So 20,000 a month gives 8,000 + 9,333, not the blended ceiling. */
      const sep26 = month === '2026-09' && num(s.pfCeiling) === PF_CEILING;
      const pfWage = emp.pf === false ? 0 : sep26 ? Math.round(Math.min(wages * 16 / 30, PF_CEILING_OLD * 16 / 30) + Math.min(wages * 14 / 30, PF_CEILING * 14 / 30)) : Math.min(wages, this.pfCeilingFor(month, s));
      const pfEmp = Math.round(pfWage * num(s.pfRate) / 100), eps = Math.round(pfWage * num(s.epsRate) / 100), epf = Math.round(pfWage * num(s.pfRate) / 100) - eps;
      const edli = Math.round(pfWage * num(s.edliRate) / 100), pfAdmin = Math.round(pfWage * num(s.pfAdmin) / 100);
      // ESI: in when the wages of a full month are within the ceiling (a higher one for a person with a disability),
      // or when already covered in this contribution period; on the wages earned (the gross with overtime when HR
      // Settings says so); the employee's share is nil on an average daily wage up to the exempt limit
      const byGross = s.esiBasis === 'gross', fullWages = hourly ? gross : byGross ? structure : this.codeWages(num(emp.basic) + num(emp.da) + num(emp.special), structure, s);
      const esiCeil = num(emp.pwd ? s.esiCeilingPwd : s.esiCeiling), esiOn = emp.esi !== false && (fullWages <= esiCeil || this.esiCovered(emp, month));
      const esiWage = !esiOn ? 0 : byGross ? r2(gross + ot) : wages, daily = sum.paid > 0 ? esiWage / sum.paid : 0;
      const esiEmp = esiOn && !(daily > 0 && daily <= num(s.esiDailyExempt)) ? ceil(esiWage * num(s.esiEmp) / 100) : 0, esiEmployer = esiOn ? ceil(esiWage * num(s.esiEmployer) / 100) : 0;
      const pt = emp.pt === false ? 0 : this.ptOf(gross + ot, s);
      const claims = full ? [] : this.reimbursementsOf(emp.id, month), reimb = r2(claims.reduce((x, r) => x + num(r.amount), 0));
      const tdsFull = this.tdsAuto(emp) ? this.tdsOf(emp, month) : 0, tds = !this.tdsAuto(emp) ? r2(num(emp.tds)) : hourly ? (gross > 0 ? tdsFull : 0) : Math.round(tdsFull * Math.min(1, sum.total ? sum.paid / sum.total : 0)), advance = r2(num(prev && prev.advance)), other = r2(num(prev && prev.other));
      const net = r2(gross + ot + reimb - pfEmp - esiEmp - pt - tds - advance - other);
      return { empId: emp.id, code: emp.code || '', name: emp.name, designation: emp.designation || '', payType: hourly ? 'hourly' : 'monthly', rate: hourly ? num(emp.hourlyRate) : 0, days: sum.total, from: sum.from, to: sum.to, periodDays: sum.days, paid: sum.paid, lop: sum.lop, present: sum.P, leave: sum.leave, hours: sum.hours, otHours: sum.ot,
        regularHours: hoursInfo ? hoursInfo.regular : 0, holidayHours: hoursInfo ? hoursInfo.holiday : 0, unapproved: hoursInfo ? hoursInfo.unapproved : 0,
        basic, da, hra, conv, special, gross, ot, reimb, reimbIds: claims.map(r => r.id), wages, wagesAdded, pfWage, pfEmp, epf, eps, edli, pfAdmin, pfEmployer: epf + eps, esiWage, esiEmp, esiEmployer, pt, tds, advance, other, deductions: r2(pfEmp + esiEmp + pt + tds + advance + other), net, remarks: (prev && prev.remarks) || '',
        bank: emp.bankName || '', account: emp.bankAccount || '', ifsc: emp.bankIfsc || '', uan: emp.uan || '', esiNo: emp.esiNo || '', pan: emp.pan || '' };
    },
    computeRun(month) {
      const prev = this.payroll(month), was = new Map(((prev && prev.rows) || []).map(r => [r.empId, r]));
      // Everyone on the rolls for a day of the month: joined by its end, and not left before it began (someone who
      // left during the month is paid up to the last working day; one deactivated without a date of leaving is out)
      const first = U.dateMs(dateOf(month, 1)), last = U.dateMs(dateOf(month, daysIn(month))), st = this.settings();
      const rows = this.employees(true).filter(e => (!e.doj || U.dateMs(e.doj) <= last) && (U.dateMs(e.dol) ? U.dateMs(e.dol) >= first : e.active !== false)).map(e => this.compute(e, month, was.get(e.id)));
      const t = {}; ['gross', 'ot', 'reimb', 'pfEmp', 'epf', 'eps', 'edli', 'pfAdmin', 'pfEmployer', 'esiEmp', 'esiEmployer', 'pt', 'tds', 'advance', 'other', 'deductions', 'net'].forEach(k => t[k] = r2(rows.reduce((s, r) => s + num(r[k]), 0)));
      // PF administration charges are at least 500 a month for an establishment with a contributing member
      const adminSum = t.pfAdmin; if (rows.some(r => r.pfWage > 0)) t.pfAdmin = Math.max(t.pfAdmin, num(st.pfAdminMin)); t.pfAdminTopUp = r2(t.pfAdmin - adminSum);
      return Object.assign(prev || { id: month, month, status: 'draft' }, { rows, totals: t, computedAt: Date.now(), upto: this.cutoff(month), pfCeiling: this.pfCeilingFor(month, st) });
    },
    // A finalised month goes into the books as one journal voucher: salaries, reimbursements and the employer's share as
    // expenses, the statutory amounts and the net pay as payables (paid later with a Payment voucher against Salary Payable)
    post(run) {
      const want = [['Salaries & Wages', Books.N.EXPENSE], ['Employer PF & ESI', Books.N.EXPENSE], ['Staff Reimbursements', Books.N.EXPENSE], ['PF Payable', Books.N.LIABILITY], ['ESI Payable', Books.N.LIABILITY], ['Professional Tax Payable', Books.N.LIABILITY], ['Salary Payable', Books.N.LIABILITY], ['Staff Advances', Books.N.ASSET]];
      const have = new Set(Books.accounts().map(a => a.name.toLowerCase()));
      want.forEach(([name, nature]) => { if (!have.has(name.toLowerCase())) Store.add('accounts', { name, nature }); });
      const t = run.totals, L = [], line = (account, side, amount) => { if (amount > 0.005) L.push({ account, side, amount: r2(amount) }); };
      line('Salaries & Wages', 'Dr', t.gross + t.ot);
      line('Employer PF & ESI', 'Dr', t.pfEmployer + t.edli + t.pfAdmin + t.esiEmployer);
      line('Staff Reimbursements', 'Dr', t.reimb);
      line('PF Payable', 'Cr', t.pfEmp + t.pfEmployer + t.edli + t.pfAdmin);
      line('ESI Payable', 'Cr', t.esiEmp + t.esiEmployer);
      line('Professional Tax Payable', 'Cr', t.pt);
      line('TDS Payable', 'Cr', t.tds);
      line('Staff Advances', 'Cr', t.advance);
      line('Salary Payable', 'Cr', t.net + t.other);
      const v = { vtype: '', date: dateOf(run.month, run.upto || daysIn(run.month)), narration: 'Salaries for ' + monthLabel(run.month) + (run.upto ? ' up to ' + dateOf(run.month, run.upto) : '') + ' (payroll)', lines: L };
      const old = run.voucherId ? Store.find('journal', run.voucherId) : null;
      if (old) { Object.assign(old, v); Store.update('journal', old); return old.id; }
      return Store.add('journal', v).id;
    },

    // ------------------------------------------------------------ employees
    /* No employee is ever deleted: the attendance, the payrolls and the letters of someone who has left stay with
       their record. An employee leaves through Offboard (the exit procedure), which deactivates them; Reactivate
       puts them back on the payroll. */
    EXIT_TYPES, EXIT_REASONS, CLEARANCE, LETTERS,
    exitOf(e) { return e && e.exit && e.exit.type ? e.exit : null; },
    exitLabel(x) { return x ? (EXIT_TYPES.find(t => t[0] === x.type) || ['', 'Exit'])[1] : ''; },
    // 'active' | 'notice' (an exit is entered and the last working day has not passed) | 'left'
    stateOf(e) { return e.active === false ? 'left' : this.exitOf(e) ? 'notice' : 'active'; },
    todayMs() { return U.dateMs(dmy(this.now())); },
    /* Someone on notice whose last working day has passed is off the payroll from the next day, by itself, and their
       settlement goes into the books by itself too (postSettlement), with the figures on the exit: what was typed,
       else the paid leave not used and the gratuity the law gives. It is posted once (exit.autoPosted) by the first
       login that may write the journal, so one taken off the payroll under an HR login is posted when the owner, an
       admin or the accountant next opens the employees or the payroll. Not when the tick on the exit is off, and
       not over a voucher that is already there. */
    sweepExits() {
      if (!global.Companies) return;
      const t = this.todayMs(), mayE = Companies.mayWrite('employees'), mayJ = Companies.mayWrite('journal'), posted = [];
      if (!mayE && !mayJ) return;
      this.employees(true).forEach(e => {
        const x = this.exitOf(e), l = x ? U.dateMs(x.lwd) : 0; if (!x || !l || l >= t) return;
        let changed = false;
        if (mayE && e.active !== false) { e.active = false; e.dol = x.lwd; changed = true; }
        if (mayJ && e.active === false && x.post !== false && !x.voucherId && !x.autoPosted) {
          const p = this.postSettlement(e, x);
          if (!p.error) { x.autoPosted = true; x.voucherId = p.id; changed = true; if (p.id) posted.push(e.name + (p.no ? ' (' + p.no + ')' : '')); }
        }
        if (changed) Store.update('employees', e);
      });
      if (posted.length && UI.toast) UI.toast('Full and final settlement posted to the books: ' + posted.join(', '), 7000);
    },
    // 'yes' | 'above' (the wages are over the ceiling) | '' (ESI does not apply)
    esiIn(e) { const s = this.settings(); if (e.esi === false) return ''; if (this.hourly(e)) return 'yes'; const st = this.structure(e), w = s.esiBasis === 'gross' ? st : this.codeWages(num(e.basic) + num(e.da) + num(e.special), st, s); return w <= num(e.pwd ? s.esiCeilingPwd : s.esiCeiling) ? 'yes' : 'above'; },
    screenEmployees(p) {
      this.sweepExits();
      // The members of the company who are not on the list yet (added under Companies > Members, or in the app) join it
      this.syncMembers().then(n => { if (n && App.current && App.current.route === 'employees') { UI.toast(n + ' member' + (n === 1 ? '' : 's') + ' of the company added to the employees: fill in the pay on the record', 6000, 'ok'); this.screenEmployees(p); } });
      const show = (p && p.show) || '', every = this.employees(true), list = every.filter(e => !show || (show === 'left' ? e.active === false : e.active !== false)), month = thisMonth(), mayW = Companies.mayWrite('employees');
      const chip = (k, label, n) => '<button class="btn sm ' + (show === k ? '' : 'outline') + '" data-show="' + k + '">' + label + ' (' + n + ')</button>';
      const status = (e) => { const st = this.stateOf(e), x = this.exitOf(e); return st === 'active' ? '<span class="pill ok">Active</span>' : st === 'notice' ? '<span class="pill warn">On notice</span><div class="small muted">till ' + esc(x.lwd || '-') + '</div>' : '<span class="pill bad">Inactive</span><div class="small muted">' + esc([e.dol || (x && x.lwd) || '', this.exitLabel(x)].filter(Boolean).join(' · ')) + '</div>'; };
      const root = App.view(App.header('Employees', '<div class="btnrow" style="margin:0"><button class="btn sm green" id="eAdd">+ Add Employee</button><button class="btn sm outline" id="eCsv">Upload CSV / Excel</button><button class="btn sm outline" id="eTpl">Template</button><button class="btn sm outline" id="eAtt">Attendance</button><button class="btn sm outline" id="eTs">Timesheets</button><button class="btn sm outline" id="ePay">Payroll</button><button class="btn sm outline" id="eSet">HR Settings</button><button class="btn sm outline" id="eAssets">Assets</button><button class="btn sm outline" id="eXls">Export Excel</button></div>') +
        '<div class="btnrow">' + chip('', 'All', every.length) + chip('active', 'Active', every.filter(e => e.active !== false).length) + chip('left', 'Inactive', every.filter(e => e.active === false).length) + '<span class="hint">An employee is never deleted: Offboard takes them through the exit and deactivates them; the letters and the history stay.</span></div>' +
        // One column per fact; the code is the link that opens the employee. The code and the actions stay in view
        // while the columns between them scroll (pin), and a scroll bar stays at the foot of the window (UI.rails)
        Ledger.listTable(['Code', 'Name', 'Status', 'Phone', 'Designation', 'Department', 'Role', 'Joined', '#Pay', 'PF', 'ESI', 'Leave left', 'Assets', ''], list.map(e => { const g = this.structure(e), lb = this.leaveBalance(e, month), hourly = this.hourly(e), st = this.stateOf(e), x = this.exitOf(e), esi = this.esiIn(e);
          return '<tr' + (e.active === false ? ' class="muted"' : '') + '>' + Ledger.td('Code', '<b>' + (e.code ? '<a class="nolink" href="#open?no=' + encodeURIComponent(e.code) + '" data-e="' + esc(e.id) + '" title="Open ' + esc(e.code) + '">' + esc(e.code) + '</a>' : '-') + '</b>') + Ledger.td('Name', '<b>' + esc(e.name) + '</b>') + Ledger.td('Status', status(e)) + Ledger.td('Phone', esc(e.phone || '-')) + Ledger.td('Designation', esc(e.designation || '-')) + Ledger.td('Department', esc(e.department || '-')) + Ledger.td('Role', '<span class="pill' + (this.roleOf(e).base === 'employee' ? '' : ' warn') + '">' + esc(this.roleOf(e).label) + '</span>') + Ledger.td('Joined', esc(e.doj || '-')) +
            Ledger.td('Pay', hourly ? '<b>' + money(num(e.hourlyRate)) + '</b> / hour' : '<b>' + money(g) + '</b> / month', 'num') + Ledger.td('PF', e.pf === false ? '-' : '<span class="pill ok">Yes</span>') + Ledger.td('ESI', !esi ? '-' : esi === 'yes' ? '<span class="pill ok">Yes</span>' : '<span class="pill">Above ceiling</span>') + Ledger.td('Leave', lb.left + ' of ' + lb.quota) + Ledger.td('Assets', this.assetsHeld(e)) +
            '<td class="actions">' + (e.code ? '' : '<button class="btn sm outline" data-e="' + esc(e.id) + '">Edit</button>') +
            (st !== 'left' ? (this.canGiveLogin() ? '<button class="btn sm blue" data-login="' + esc(e.id) + '" title="A login of their own, with the role on the employee record">Give login</button>' : '') + '<button class="btn sm outline" data-offer="' + esc(e.id) + '">Offer letter</button>' + (mayW ? '<button class="btn sm red outline" data-exit="' + esc(e.id) + '" title="Resignation, termination or the end of a contract: the notice, the clearance, the settlement and the letters">' + (st === 'notice' ? 'Exit procedure' : 'Offboard') + '</button>' : '')
              : '<button class="btn sm outline" data-exit="' + esc(e.id) + '" title="The exit: notice, clearance and the full and final settlement">Exit</button><button class="btn sm" data-letter="relieving" data-id="' + esc(e.id) + '">Relieving letter</button><button class="btn sm" data-letter="experience" data-id="' + esc(e.id) + '">Experience letter</button>' + (mayW ? '<button class="btn sm green outline" data-react="' + esc(e.id) + '" title="Back on the payroll">Reactivate</button>' : '')) +
            (x && x.type === 'termination' ? '<button class="btn sm outline" data-letter="termination" data-id="' + esc(e.id) + '">Termination letter</button>' : '') + '</td></tr>'; }), show === 'left' ? 'Nobody is inactive.' : 'No employees yet. Add the people on your payroll.').replace('<div class="tablewrap">', '<div class="tablewrap pin">'));
      App.wireBack(root);
      const again = () => this.screenEmployees({ show });
      $$('[data-show]', root).forEach(b => b.onclick = () => this.screenEmployees({ show: b.dataset.show }));
      $('#eAdd').onclick = () => this.editEmployee(null); $('#eAtt').onclick = () => App.go('attendance');
      $('#eCsv').onclick = () => UI.pickSheet(rows => this.importRows(rows));
      $('#eTpl').onclick = () => { UI.download('BlitzBook_Employees_Template.csv', EMP_COLUMNS.join(',') + '\n' + EMP_SAMPLE.map(r => r.join(',')).join('\n') + '\n', 'text/csv'); UI.toast('Template downloaded'); }; $('#eTs').onclick = () => App.go('timesheets'); $('#ePay').onclick = () => App.go('payroll'); $('#eSet').onclick = () => App.go('hrsettings');
      $('#eXls').onclick = () => UI.xls('Employees', ['Code', 'Name', 'Status', 'Designation', 'Department', 'Joined', 'Left on', 'Exit', 'Reason', 'Phone', 'Email', 'PAN', 'UAN', 'ESI No', 'Pay type', 'Shift start', 'Shift end', 'Rate / hour', 'Basic', 'DA', 'HRA', 'Conveyance', 'Special', 'Gross', 'PF', 'ESI', 'PT', 'TDS / month', 'Bank', 'Account', 'IFSC'],
        list.map(e => { const x = this.exitOf(e); return [e.code, e.name, { active: 'Active', notice: 'On notice', left: 'Inactive' }[this.stateOf(e)], e.designation, e.department, e.doj, e.dol || (x && x.lwd) || '', this.exitLabel(x), x ? x.reason : '', e.phone, e.email, e.pan, e.uan, e.esiNo, this.hourly(e) ? 'Hourly' : 'Monthly', this.shiftOf(e).start, this.shiftOf(e).end, num(e.hourlyRate), num(e.basic), num(e.da), num(e.hra), num(e.conveyance), num(e.special), this.structure(e), e.pf === false ? 'No' : 'Yes', e.esi === false ? 'No' : 'Yes', e.pt === false ? 'No' : 'Yes', num(e.tds), e.bankName, e.bankAccount, e.bankIfsc]; }));
      $$('[data-e]', root).forEach(b => b.onclick = (ev) => { ev.preventDefault(); this.editEmployee(Store.find('employees', b.dataset.e)); });
      $('#eAssets').onclick = () => this.assetsReport();
      $$('[data-offer]', root).forEach(b => b.onclick = () => this.offerLetter(Store.find('employees', b.dataset.offer)));
      $$('[data-login]', root).forEach(b => b.onclick = () => this.giveLogin(Store.find('employees', b.dataset.login)));
      $$('[data-exit]', root).forEach(b => b.onclick = () => this.offboard(Store.find('employees', b.dataset.exit), again));
      $$('[data-letter]', root).forEach(b => b.onclick = () => this.letter(Store.find('employees', b.dataset.id), b.dataset.letter));
      $$('[data-react]', root).forEach(b => b.onclick = () => { const e = Store.find('employees', b.dataset.react); UI.confirm('Reactivate Employee', 'Put ' + e.name + ' back on the payroll? The date of leaving is cleared and the exit is kept in their history. A login that was removed has to be given again (Give login).', () => { if (e.exit) e.exits = (e.exits || []).concat([Object.assign({ dol: e.dol || '' }, e.exit)]); e.exit = null; e.active = true; e.dol = ''; Store.update('employees', e); UI.toast(e.name + ' is back on the payroll'); again(); }, 'Reactivate'); });
    },

    // ------------------------------------------------------------ offboarding (the exit procedure)
    /* Three steps on one dialog, kept on the employee record (e.exit):
         1. Separation   the kind of exit, the notice or resignation date, the last working day, the reason
         2. Clearance    company property returned (the assets held are ticked back), handover, dues, access
         3. Settlement   the salary up to the last working day, leave encashment, gratuity, notice pay either way
       Save keeps the employee on notice: they stay on the payroll, are paid up to the last working day and go off it
       by themselves the day after. Complete & deactivate closes the exit once the last working day has come. */
    serviceYears(e, lwd) { const a = U.dateMs(e.doj), b = U.dateMs(lwd) || this.todayMs(); return a && b > a ? (b - a + 86400000) / (365.25 * 86400000) : 0; },
    // Gratuity: 15 days of the last wages for every year (26 working days a month, six months and more count as a
    // year), after five years of service; one year for a fixed term; any service on death. At most 20,00,000.
    gratuityOf(e, x) {
      if (this.hourly(e)) return 0;
      const y = this.serviceYears(e, x.lwd), due = x.type === 'death' || (x.type === 'contract' ? y >= 1 : y >= 5); if (!due) return 0;
      const s = this.settings(), wage = this.codeWages(num(e.basic) + num(e.da) + num(e.special), this.structure(e), s), years = Math.floor(y) + (y - Math.floor(y) >= 0.5 ? 1 : 0);
      return Math.min(2000000, Math.round(wage * 15 / 26 * Math.max(1, years)));
    },
    settlement(e, x) {
      const f = x.ff || {}, ms = U.dateMs(x.lwd), month = ms ? iso(new Date(ms)).slice(0, 7) : thisMonth(), given = (v) => v != null && v !== '';
      const run = this.payroll(month), row = run && run.status === 'final' ? (run.rows || []).find(r => r.empId === e.id) : null;
      const was = run ? (run.rows || []).find(r => r.empId === e.id) : null, pay = row || this.compute(Object.assign({}, e, { dol: x.lwd || e.dol }), month, was);
      const perDay = this.hourly(e) ? 0 : r2((num(e.basic) + num(e.da)) / 26), leaveDays = given(f.leaveDays) ? num(f.leaveDays) : Math.max(0, this.leaveBalance(e, month).left), gratuity = given(f.gratuity) ? num(f.gratuity) : this.gratuityOf(e, x);
      const lines = [['Salary for ' + this.periodText(month, pay.from, pay.to) + ' (net of the deductions' + (row ? ', as in the payroll' : '') + ')', pay.net], ['Leave encashment (' + leaveDays + ' day' + (leaveDays === 1 ? '' : 's') + ' at ' + money(perDay) + ')', r2(leaveDays * perDay)], ['Gratuity', gratuity], ['Notice pay', num(f.noticePay)], ['Bonus / other payments', num(f.bonus)]];
      const less = [['Notice period not served', num(f.noticeRecovery)], ['Other recoveries', num(f.recovery)]];
      return { month, pay, perDay, leaveDays, gratuity, years: this.serviceYears(e, x.lwd), lines, less, total: r2(lines.reduce((t, l) => t + l[1], 0) - less.reduce((t, l) => t + l[1], 0)) };
    },
    /* The settlement goes into the books as one journal voucher dated the last working day: leave encashment,
       gratuity, notice pay and bonus as expenses; the notice pay recovered as income; other recoveries against Staff
       Advances; the balance to Salary Payable, from where it is paid with a Payment voucher like any salary. The
       salary of the last month is NOT in this voucher: it reaches the books with the payroll of that month, which
       pays the employee up to the last working day. Saving the exit again brings the voucher up to date; with
       nothing left to post it is removed. Answers { id, no, amount } or { error }. */
    postSettlement(e, x) {
      const st = this.settlement(e, x), old = x.voucherId ? Store.find('journal', x.voucherId) : null;
      const leave = st.lines[1][1], gratuity = st.lines[2][1], notice = st.lines[3][1], bonus = st.lines[4][1], noticeRec = st.less[0][1], otherRec = st.less[1][1];
      const net = r2(leave + gratuity + notice + bonus - noticeRec - otherRec);
      if (!(leave || gratuity || notice || bonus || noticeRec || otherRec)) { if (old) Store.delete('journal', old.id); return { id: '', amount: 0 }; }
      const date = x.lwd, bad = U.booksDateError(date); if (bad) return { error: bad };
      const want = [['Leave Encashment', Books.N.EXPENSE], ['Gratuity', Books.N.EXPENSE], ['Salaries & Wages', Books.N.EXPENSE], ['Notice Pay Recovered', Books.N.INCOME], ['Staff Advances', Books.N.ASSET], ['Salary Payable', Books.N.LIABILITY]];
      const have = new Set(Books.accounts().map(a => a.name.toLowerCase()));
      want.forEach(([name, nature]) => { if (!have.has(name.toLowerCase())) Store.add('accounts', { name, nature }); });
      const L = [], line = (account, side, amount) => { if (amount > 0.005) L.push({ account, side, amount: r2(amount) }); };
      line('Leave Encashment', 'Dr', leave); line('Gratuity', 'Dr', gratuity); line('Salaries & Wages', 'Dr', notice + bonus);
      line('Notice Pay Recovered', 'Cr', noticeRec); line('Staff Advances', 'Cr', otherRec);
      // What is recovered beyond what is paid comes off the salary still payable
      line('Salary Payable', net >= 0 ? 'Cr' : 'Dr', Math.abs(net));
      const v = { vtype: '', date, narration: 'Full and final settlement of ' + e.name + (e.code ? ' (' + e.code + ')' : '') + ', last working day ' + x.lwd, lines: L };
      if (old) { Object.assign(old, v); Store.update('journal', old); return { id: old.id, no: old.no || '', amount: net }; }
      const made = Store.add('journal', v); return { id: made.id, no: made.no || '', amount: net };
    },
    offboard(e, onDone) {
      if (!e) return;
      const left = e.active === false, mayW = Companies.mayWrite('employees'), was = this.exitOf(e);
      const x = Object.assign({ type: 'resignation', noticeOn: U.today(), lwd: e.dol || '', reason: '', remarks: '', noticeDays: num(e.offer && e.offer.notice != null ? e.offer.notice : 30), clearance: {}, ff: {} }, JSON.parse(JSON.stringify(was || {})));
      x.clearance = x.clearance || {}; x.ff = x.ff || {};
      const held = (e.assets || []).map((a, i) => ({ a, i })).filter(r => r.a.name && !r.a.returned);
      const reasonSel = (type, val) => { const list = EXIT_REASONS[type] || ['Other']; return UI.select('xReason', val && !list.includes(val) ? list.concat([val]) : list, val || list[0]); };
      const amt = (id, label, val, hint) => UI.field(label, UI.input(id, val == null ? '' : val, { type: 'number', attrs: ' min="0" step="any"' }), hint ? { hint } : {});
      const bg = UI.modal({ title: (left ? 'Exit - ' : 'Offboard - ') + e.name, wide: true, focus: false, body: '<div class="grid2">' +
          '<div class="field span"><label>1. Separation</label><div class="hint">' + esc(e.name) + (e.code ? ' (' + esc(e.code) + ')' : '') + (e.designation ? ', ' + esc(e.designation) : '') + ', joined ' + esc(e.doj || '-') + '.</div></div>' +
          UI.field('Type of exit', UI.select('xType', EXIT_TYPES, x.type), { req: true }) + '<div class="field"><label>Reason</label><span id="xReasonBox">' + reasonSel(x.type, x.reason) + '</span></div>' +
          UI.field('Resignation / notice date', UI.dateInput('xNotice', x.noticeOn), { hint: 'The day the resignation was given or the notice was served' }) + UI.field('Last working day', UI.dateInput('xLwd', x.lwd), { req: true, hint: 'Paid up to this day; off the payroll from the next' }) +
          UI.field('Notice period (days)', UI.input('xNDays', x.noticeDays, { type: 'number', attrs: ' min="0" step="1"' }), { hint: 'As in the terms of appointment' }) + '<div class="field"><label>Notice served</label><div id="xServed" class="bold"></div></div>' +
          UI.field('Remarks', '<textarea id="xRemarks" placeholder="What happened, what was agreed">' + esc(x.remarks || '') + '</textarea>', { span: true }) +
          '<div class="field span"><label>2. Clearance</label>' + CLEARANCE.map(c => UI.check('xc_' + c[0], c[1], !!x.clearance[c[0]])).join('') +
          (held.length ? '<div class="hint" style="margin-top:6px">Still with ' + esc(e.name.split(' ')[0]) + ' (tick what has come back):</div>' + held.map(r => UI.check('xa_' + r.i, r.a.name + (r.a.tag ? ' (' + r.a.tag + ')' : ''), false)).join('') : '<div class="hint">No company asset is recorded as held.</div>') + '</div>' +
          '<div class="field span"><label>3. Full and final settlement</label><div class="hint">Left blank, leave encashment takes the paid leave not used and gratuity what the law gives; type a figure to change it. The salary of the last month is paid up to the last working day.</div></div>' +
          amt('xLeave', 'Leave encashment (days)', x.ff.leaveDays) + amt('xGrat', 'Gratuity ₹', x.ff.gratuity) +
          amt('xNPay', 'Notice pay to the employee ₹', x.ff.noticePay, 'When the company ends the service without the full notice') + amt('xNRec', 'Notice not served, recovered ₹', x.ff.noticeRecovery, 'When the employee leaves before the notice is over') +
          amt('xBonus', 'Bonus / other payments ₹', x.ff.bonus) + amt('xRec', 'Other recoveries ₹', x.ff.recovery, 'Advances, loans, property not returned') +
          '<div class="field span"><div id="xTotal" class="kv"></div></div>' +
          (Companies.mayWrite('journal') ? '<div class="field span">' + UI.check('xPost', 'Post the settlement to the books (a journal voucher dated the last working day)', x.post !== false) + '<div class="hint" id="xPosted">' + (x.voucherId && Store.find('journal', x.voucherId) ? 'Posted as ' + esc(Store.find('journal', x.voucherId).no || 'a journal voucher') + '; saving brings it up to date. ' : '') + 'Leave encashment, gratuity, notice pay and bonus go to expenses, recoveries come off, and the balance goes to Salary Payable, paid with a Payment voucher. The salary of the last month is posted by the payroll of that month, not here. Posted when this is saved once the last working day has come, and by itself the day after it when nobody has.</div></div>' : '<div class="field span"><div class="hint">The settlement is posted to the books when the owner, an admin or the accountant saves this exit.</div></div>') +
          (this.canGiveLogin() && !left ? '<div class="field span">' + UI.check('xLogin', 'Remove their login from this company when they are deactivated', true) + '</div><div class="field span">' + UI.check('xLic', 'Remove their licence, so the seat is free for someone else (Company > Licences)', true) + '<div class="hint">Removing the login frees the licence too.</div></div>' : '') + '</div>',
        buttons: [{ label: 'Close', cls: 'outline' }].concat(mayW ? [{ label: 'Save', cls: 'blue', onClick: (bg) => save(bg, false) }] : []).concat([{ label: 'Settlement PDF', cls: 'outline', onClick: (bg) => { const o = read(bg); if (!o.lwd) { UI.toast('Enter the last working day'); return false; } Print.show(this.settlementHtml(e, o)); return false; } }]).concat(mayW && !left ? [{ label: 'Complete & deactivate', cls: 'red', onClick: (bg) => save(bg, true) }] : []) });
      const v = (id) => String(UI.val(id, bg) == null ? '' : UI.val(id, bg)).trim(), opt = (id) => v(id) === '' ? null : num(v(id));
      const read = () => Object.assign({}, x, { type: v('xType'), reason: v('xReason'), noticeOn: UI.dateVal('xNotice', bg), lwd: UI.dateVal('xLwd', bg), noticeDays: num(v('xNDays')), remarks: v('xRemarks'),
        clearance: Object.fromEntries(CLEARANCE.map(c => [c[0], !!UI.val('xc_' + c[0], bg)])), ff: { leaveDays: opt('xLeave'), gratuity: opt('xGrat'), noticePay: opt('xNPay'), noticeRecovery: opt('xNRec'), bonus: opt('xBonus'), recovery: opt('xRec') } });
      const draw = () => {
        const o = read(), a = U.dateMs(o.noticeOn), b = U.dateMs(o.lwd), served = a && b && b >= a ? Math.round((b - a) / 86400000) : 0, short = Math.max(0, o.noticeDays - served);
        $('#xServed', bg).textContent = !b ? 'Enter the last working day' : served + ' day' + (served === 1 ? '' : 's') + (short ? ', ' + short + ' short of the notice' : ', the notice is served');
        if (!b) { $('#xTotal', bg).innerHTML = ''; return; }
        const st = this.settlement(e, o);
        $('#xTotal', bg).innerHTML = st.lines.filter(l => l[1]).map(l => kv(esc(l[0]), money(l[1]))).join('') + st.less.filter(l => l[1]).map(l => kv('Less: ' + esc(l[0]), money(l[1]))).join('') + kv('Payable in full and final settlement (' + st.years.toFixed(1) + ' years of service)', money(st.total), 'tot');
      };
      $('#xType', bg).addEventListener('change', () => { $('#xReasonBox', bg).innerHTML = reasonSel(v('xType'), ''); draw(); });
      $$('input, select', bg).forEach(el => { el.addEventListener('input', draw); el.addEventListener('change', draw); });
      draw();
      const save = (bg, complete) => {
        const o = read(), l = U.dateMs(o.lwd), by = (App.user && App.user.name) || Companies.roleLabel();
        if (!l) { UI.mark('xLwd', true, bg); UI.toast('Enter the last working day'); return false; }
        if (U.dateMs(e.doj) && l < U.dateMs(e.doj)) { UI.mark('xLwd', true, bg); UI.toast('The last working day is before the date of joining (' + e.doj + ')', 5000); return false; }
        if (complete && l > this.todayMs()) { UI.toast('The last working day (' + o.lwd + ') is still to come. Save keeps ' + e.name.split(' ')[0] + ' on notice: they are paid up to that day and go off the payroll by themselves the day after.', 8000); return false; }
        // What came back is marked returned on the asset list
        held.forEach(r => { if (UI.val('xa_' + r.i, bg)) e.assets[r.i].returned = l <= this.todayMs() ? o.lwd : U.today(); });
        o.by = x.by || by; o.at = x.at || Date.now();
        // Into the books once the last working day has come: the voucher is made, brought up to date, or taken out when the tick is off
        let posted = null;
        if ($('#xPost', bg)) {
          o.post = !!UI.val('xPost', bg);
          if (o.post && l <= this.todayMs()) { posted = this.postSettlement(e, o); if (posted.error) { UI.toast('The settlement cannot be posted: ' + posted.error, 7000); return false; } o.voucherId = posted.id; }
          if (l <= this.todayMs()) o.autoPosted = true;
          if (!o.post && o.voucherId) { if (Store.find('journal', o.voucherId)) Store.delete('journal', o.voucherId); o.voucherId = ''; }
        }
        if (complete) { o.done = true; o.doneBy = by; o.doneAt = Date.now(); e.active = false; }
        e.exit = o; e.dol = o.lwd;
        Store.update('employees', e);
        const book = posted && posted.id ? ' The settlement is posted to the books' + (posted.no ? ' as ' + posted.no : '') + ' (' + money(Math.abs(posted.amount)) + (posted.amount >= 0 ? ' to' : ' off') + ' Salary Payable).' : '';
        UI.toast((complete ? e.name + ' is deactivated. The relieving and experience letters are on their row.' : left ? 'Exit saved.' : e.name + ' is on notice till ' + o.lwd + '.') + book, 7000);
        if (complete && $('#xLogin', bg) && UI.val('xLogin', bg)) this.removeLogin(e).then(t => { if (t) UI.toast(t, 6000); }, err => UI.toast('The login could not be removed: ' + (err.message || 'no connection') + '. Remove it under Companies > Members.', 8000));
        else if (complete && $('#xLic', bg) && UI.val('xLic', bg)) this.removeLicence(e).then(t => { if (t) UI.toast(t, 6000); }, err => UI.toast('The licence could not be removed: ' + (err.message || 'no connection') + '. Remove it under Company > Licences.', 8000));
        if (onDone) onDone();
      };
    },
    // The login of an employee who has left is taken out of the company (a member is removed, an invitation withdrawn)
    async removeLogin(e) {
      const co = Companies.current();
      if (!this.canGiveLogin() || !co || !co.id || !Companies.available()) return '';
      const ph = String(e.phone || '').replace(/\D/g, '').slice(-10), em = String(e.email || '').trim().toLowerCase();
      if (!ph && !em) return '';
      const m = await this.memberOf(co, ph, em);
      if (!m) return '';
      if (m.invited) Companies.checked(await Companies.rpc('remove_invite', { cid: co.id, identity: m.phone || m.email }), 'Withdraw');
      else Companies.checked(await Companies.rpc('remove_member', { cid: co.id, member: m.user_id }), 'Remove');
      return 'The login of ' + e.name + ' is removed from ' + (co.name || 'the company');
    },
    // The member (or invitation) of the company with the employee's mobile number or email
    async memberOf(co, ph, em) {
      const list = Companies.checked(await Companies.rpc('list_members', { cid: co.id }), 'Members');
      return (Array.isArray(list) ? list : []).find(x => x.role !== 'owner' && ((ph && String(x.phone || '').replace(/\D/g, '').slice(-10) === ph) || (em && String(x.email || '').trim().toLowerCase() === em))) || null;
    },
    // The licence of an employee who has left is taken away, the login stays: the seat is free for someone else
    async removeLicence(e) {
      const co = Companies.current();
      if (!this.canGiveLogin() || !co || !co.id || !Companies.available()) return '';
      const ph = String(e.phone || '').replace(/\D/g, '').slice(-10), em = String(e.email || '').trim().toLowerCase();
      if (!ph && !em) return '';
      const m = await this.memberOf(co, ph, em);
      if (!m || !m.lic) return '';
      Companies.checked(await Companies.rpc('assign_licence', { cid: co.id, who_in: m.user_id || m.phone || m.email || '', kind_in: '' }), 'Licence');
      Companies.load().catch(() => null);
      return 'The licence of ' + e.name + ' is removed; the seat is free for someone else';
    },
    settlementHtml(e, x) {
      const co = Store.company(), st = this.settlement(e, x), m = (v) => U.indianNumber(num(v));
      const facts = [['Employee', e.name], ['Employee code', e.code], ['Designation', e.designation], ['Department', e.department], ['Date of joining', e.doj], ['Last working day', x.lwd], ['Type of exit', this.exitLabel(x)], ['Reason', x.reason], ['Service', st.years.toFixed(1) + ' years'], ['PAN', e.pan], ['Bank', e.bankName], ['Account / IFSC', [e.bankAccount, e.bankIfsc].filter(Boolean).join(' / ')]];
      const cell = (d) => '<td style="width:14%;background:#f2f2f2;font-weight:bold;font-size:8.5pt">' + esc(d[0]) + '</td><td style="width:19%;font-size:8.5pt">' + esc(d[1] || '-') + '</td>';
      const done = CLEARANCE.map(c => (x.clearance && x.clearance[c[0]] ? '☑ ' : '☐ ') + c[1]);
      const body = '<div class="doc std"><div class="part top">' + Print.head('FULL AND FINAL SETTLEMENT', co, [['Date:', U.today(), 1], ['Ref:', 'HR/' + (e.code || '') + '/FNF/' + String(x.lwd || U.today()).slice(-4)]]) + '</div>' +
        '<table class="grid" style="margin-top:8px"><tbody>' + Array.from({ length: Math.ceil(facts.length / 3) }, (_, i) => '<tr>' + facts.slice(i * 3, i * 3 + 3).map(cell).join('') + '</tr>').join('') + '</tbody></table>' +
        '<table class="grid items"><thead><tr><th>PARTICULARS</th><th style="width:130pt">AMOUNT (₹)</th></tr></thead><tbody>' + st.lines.map(l => '<tr><td>' + esc(l[0]) + '</td><td class="r">' + m(l[1]) + '</td></tr>').join('') + st.less.filter(l => l[1]).map(l => '<tr><td>Less: ' + esc(l[0]) + '</td><td class="r">- ' + m(l[1]) + '</td></tr>').join('') +
        '<tr><td class="r"><b>NET PAYABLE</b></td><td class="r"><b>' + money(st.total) + '</b></td></tr></tbody></table>' +
        '<div class="sect words">Amount in words: ' + esc(U.rupeesPaiseWords(Math.max(0, st.total))) + '</div>' +
        (x.voucherId && Store.find('journal', x.voucherId) ? '<div class="note" style="font-weight:normal">Posted to the books as ' + esc(Store.find('journal', x.voucherId).no || 'a journal voucher') + ' dated ' + esc(x.lwd) + '; the salary of the last month is in the payroll.</div>' : '') +
        '<div class="sect">Clearance</div><div style="font-size:9pt;line-height:1.6">' + done.map(esc).join('<br>') + '</div>' + (x.remarks ? '<div class="sect" style="font-weight:normal">Remarks: ' + esc(x.remarks) + '</div>' : '') +
        '<div class="sect" style="font-weight:normal">I have received the amount above in full and final settlement of all that is due to me from ' + esc(co.name) + ' and have no further claim against the company.</div>' +
        Print.signBlock(co) + '<div class="sect" style="font-weight:normal;margin-top:24px">Received: ______________________ &nbsp;&nbsp; (' + esc(e.name) + ') &nbsp;&nbsp; Date: ____________</div>' + Print.POWERED + '</div>';
      return Print.page('Full and final settlement - ' + e.name, Print.PAPERS.A4.css, '12mm 10mm', body);
    },

    // ------------------------------------------------------------ relieving, experience and termination letters
    /* For an employee who has left (or is leaving): the letter starts from the standard words (LETTER_TEXT), which can
       be changed for this employee on the dialog and are then kept with their record (e.letters). */
    letter(e, kind) {
      if (!e || !LETTERS[kind]) return;
      const x = this.exitOf(e) || {}, kept = (e.letters && e.letters[kind]) || {}, std = LETTER_TEXT[kind].join('\n');
      const bg = UI.modal({ title: LETTERS[kind][0] + ' - ' + e.name, wide: true, body: '<div class="grid2">' + UI.field('Letter date', UI.dateInput('ltDate', U.today())) + UI.field('Last working day', UI.dateInput('ltLwd', x.lwd || e.dol || ''), { req: true }) +
          '<div class="field span"><label>The letter</label><textarea id="ltText" style="min-height:210px">' + esc(kept.text || std) + '</textarea><div class="hint">One paragraph a line. The words in braces are filled in: {name} {first_name} {code} {designation} {department} {joining} {last_day} {company} {notice_date} {notice_days} {reason} {exit}. <button class="link" id="ltStd">Put the standard words back</button></div></div></div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'blue', onClick: (bg) => { keep(bg); UI.toast('Kept with ' + e.name); return false; } }, { label: 'Print / PDF', cls: 'green', onClick: (bg) => { const o = keep(bg); if (!o.lwd) { UI.mark('ltLwd', true, bg); UI.toast('Enter the last working day'); return false; } Print.show(this.letterHtml(e, kind, o)); return false; } }] });
      const keep = (bg) => {
        const text = String(UI.val('ltText', bg)).replace(/\r/g, '').split('\n').map(t => t.trim()).filter(Boolean).join('\n'), lwd = UI.dateVal('ltLwd', bg);
        if (Companies.mayWrite('employees')) { e.letters = Object.assign({}, e.letters, { [kind]: text === std ? null : { text } }); if (lwd && !e.dol && e.active === false) e.dol = lwd; Store.update('employees', e); }
        return { date: UI.dateVal('ltDate', bg) || U.today(), lwd, text };
      };
      $('#ltStd', bg).onclick = () => { $('#ltText', bg).value = std; };
    },
    letterHtml(e, kind, o) {
      const co = Store.company(), x = this.exitOf(e) || {}, L = LETTERS[kind], first = String(e.name || '').split(' ')[0];
      const words = { name: e.name, first_name: first, code: e.code || '-', designation: e.designation || 'Employee', department: e.department || '', in_department: e.department ? ' in the ' + e.department + ' department' : '', joining: e.doj || '', last_day: o.lwd || '', company: co.name, notice_date: x.noticeOn || o.date, notice_days: x.noticeDays != null ? x.noticeDays : 30,
        reason: [x.reason, x.remarks].filter(Boolean).join(': ') || 'as discussed with you', exit: x.type ? this.exitLabel(x).toLowerCase() + (x.type === 'resignation' && x.noticeOn ? ' dated ' + x.noticeOn : '') : 'end of service' };
      const fill = (t) => String(t).replace(/\{([a-z_]+)\}/gi, (all, k) => words[k.toLowerCase()] != null ? String(words[k.toLowerCase()]) : all);
      const paras = String(o.text || LETTER_TEXT[kind].join('\n')).split('\n').map(t => t.trim()).filter(Boolean);
      const facts = [['Name', e.name], ['Employee code', e.code], ['Designation', e.designation], ['Department', e.department], ['Date of joining', e.doj], ['Last working day', o.lwd]].filter(f => f[1]);
      const body = '<div class="doc std"><div class="part top">' + Print.head(L[1], co, [['Date:', o.date, 1], ['Ref:', 'HR/' + (e.code || '') + '/' + L[2] + '/' + String(o.date).slice(-4)]]) + '</div>' +
        (kind === 'experience' ? '<div class="sect" style="text-align:center;letter-spacing:.5px">TO WHOMSOEVER IT MAY CONCERN</div>'
          : '<div class="sect" style="font-weight:normal"><div><b>' + esc(e.name) + '</b></div>' + (e.code ? '<div>Employee code ' + esc(e.code) + '</div>' : '') + String(e.address || '').split('\n').filter(Boolean).map(l => '<div>' + esc(l) + '</div>').join('') + '</div><div class="sect">Dear ' + esc(first) + ',</div>') +
        paras.map(t => '<div class="sect" style="font-weight:normal;font-size:10.5pt;line-height:1.6;text-align:justify">' + esc(fill(t)) + '</div>').join('') +
        '<table class="grid" style="margin-top:14px;width:70%"><tbody>' + facts.map(f => '<tr><td style="width:40%;background:#f2f2f2;font-weight:bold;font-size:9pt">' + esc(f[0]) + '</td><td style="font-size:9pt">' + esc(f[1]) + '</td></tr>').join('') + '</tbody></table>' +
        Print.signBlock(co) + (kind === 'termination' ? '<div class="sect" style="font-weight:normal;margin-top:24px">Received: ______________________ &nbsp;&nbsp; (' + esc(e.name) + ') &nbsp;&nbsp; Date: ____________</div>' : '') + Print.POWERED + '</div>';
      return Print.page(L[0] + ' - ' + e.name, Print.PAPERS.A4.css, '14mm 12mm', body);
    },

    /* Employees from a CSV / Excel file in the template's columns (the Excel export reads back too; extra columns are
       ignored, missing ones are left alone). An employee already on the list is matched by code, else by name: Upsert
       brings the filled-in cells of the row up to date (a blank cell changes nothing), Insert only leaves them as they
       are. "Manager" names the reporting manager by code or name, from the list or the file. "Left on" marks an
       employee as left. Pay type Monthly needs a Basic, Hourly a Rate / hour; PF / ESI / PT take Yes or No. */
    importRows(rows) {
      const head = rows.length ? rows[0].map(c => String(c == null ? '' : c).trim().toLowerCase().replace(/[^a-z]/g, '')) : [];
      const at = {}; Object.keys(EMP_HEADS).forEach(k => { at[k] = head.findIndex(h => EMP_HEADS[k].includes(h)); });
      if (at.name < 0) { UI.alert('Upload Employees', 'The first row has to carry the column headings, with at least Name. Download the template for the columns.'); return; }
      const cell = (r, k) => at[k] >= 0 && r[at[k]] != null ? String(r[at[k]]).trim() : '';
      const yes = (v) => /^(y|yes|true|1)$/i.test(v), s = this.settings();
      const recs = [], bad = [];
      rows.slice(1).forEach((r, i) => {
        const name = cell(r, 'name'); if (!name) return;
        const f = { name }, given = (k, v) => { if (v !== '') f[k] = v; };
        ['code', 'designation', 'department', 'address', 'uan', 'esiNo', 'bankName', 'bankAccount'].forEach(k => given(k, cell(r, k)));
        given('phone', cell(r, 'phone').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')); given('email', cell(r, 'email').toLowerCase()); given('pan', cell(r, 'pan').toUpperCase()); given('aadhaar', cell(r, 'aadhaar').replace(/\s/g, '')); given('bankIfsc', cell(r, 'bankIfsc').toUpperCase());
        given('doj', U.sheetDate(cell(r, 'doj'))); const dol = U.sheetDate(cell(r, 'dol')); if (cell(r, 'dol')) { f.dol = dol; f.active = false; }
        const pt = cell(r, 'payType'); if (pt) f.payType = /hour/i.test(pt) ? 'hourly' : 'monthly';
        ['hourlyRate', 'basic', 'da', 'hra', 'conveyance', 'special', 'tds', 'leavesPerYear'].forEach(k => { const v = cell(r, k); if (v !== '') f[k] = num(v); });
        ['pf', 'esi', 'pt'].forEach(k => { const v = cell(r, k); if (v !== '') f[k] = yes(v); });
        const mgr = cell(r, 'manager'); if (mgr) f.managerRef = mgr;
        const line = 'Row ' + (i + 2) + ' (' + name + ')';
        let badTime = false; ['shiftStart', 'shiftEnd'].forEach(k => { const v = cell(r, k); if (v === '') return; const t = tm(v); if (t) f[k] = t; else badTime = true; });
        if (badTime) { bad.push(line + ': the shift time is not a time of day (hh:mm)'); return; }
        if (f.phone && !/^[6-9][0-9]{9}$/.test(f.phone)) { bad.push(line + ': the mobile number is not 10 digits'); return; }
        if (f.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(f.pan)) { bad.push(line + ': PAN is 10 characters, e.g. ABCDE1234F'); return; }
        if (f.doj && !U.dateMs(f.doj)) { bad.push(line + ': the joining date is not a date (dd/mm/yyyy)'); return; }
        recs.push(f);
      });
      if (!recs.length && !bad.length) { UI.alert('Upload Employees', 'No employees found in the file. The columns are ' + EMP_COLUMNS.join(', ') + ' (download the template).'); return; }
      const list = Store.list('employees'), lower = (v) => String(v || '').trim().toLowerCase();
      const match = (f) => (f.code && list.find(e => lower(e.code) === lower(f.code))) || list.find(e => lower(e.name) === lower(f.name)) || null;
      const known = recs.filter(f => match(f)).length;
      UI.modal({ title: 'Upload Employees', focus: false, body: '<p>' + recs.length + ' employee' + (recs.length === 1 ? '' : 's') + ' in the file: <b>' + (recs.length - known) + '</b> new, <b>' + known + '</b> already on the list (by code or name).' + (bad.length ? ' <b>' + bad.length + '</b> row' + (bad.length === 1 ? '' : 's') + ' cannot be read and will be skipped.' : '') + '</p>' + UI.modeField('Employees') +
          '<div class="hint">Upsert changes only the cells that are filled in; a blank cell leaves the value as it is. A row with "Left on" marks the employee as left.</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Upload', cls: 'green', onClick: (bg) => {
          const mode = UI.modeOf(bg), r = { inserted: 0, updated: 0, unchanged: 0, skipped: bad.length, lines: bad.slice() };
          let max = 0; list.forEach(x => { const m = /(\d+)$/.exec(x.code || ''); if (m) max = Math.max(max, +m[1]); });
          const later = [];
          recs.forEach(f => {
            const ref = f.managerRef; delete f.managerRef;
            const ex = match(f);
            if (!ex) {
              const hourly = f.payType === 'hourly';
              if (hourly ? !(num(f.hourlyRate) > 0) : !(num(f.basic) > 0)) { r.skipped++; r.lines.push(f.name + ': ' + (hourly ? 'needs a rate per hour' : 'needs a basic salary (or pay type Hourly with a rate)')); return; }
              const e = Object.assign({ code: '', designation: '', department: '', doj: U.today(), dol: '', phone: '', email: '', address: '', pan: '', aadhaar: '', uan: '', esiNo: '', bankName: '', bankAccount: '', bankIfsc: '', payType: 'monthly', hourlyRate: 0, metro: !!s.metro, basic: 0, da: 0, hra: null, conveyance: 0, special: 0, pf: true, esi: true, pt: true, tds: 0, leavesPerYear: num(s.leavesPerYear), active: true, managerId: '', manager: '' }, f);
              if (!e.code) e.code = 'EMP' + String(++max).padStart(3, '0');
              if (e.hra == null) e.hra = hourly ? 0 : this.hraOf(e.basic, e.metro);
              if (!hourly) { const ap = this.applies(e); if (f.pf == null) e.pf = ap.pf; if (f.esi == null) e.esi = ap.esi; }
              list.push(Object.assign(e, { id: U.uid(), createdAt: Date.now() })); r.inserted++;
              if (ref) later.push([e, ref]);
              return;
            }
            if (mode === 'insert') { r.skipped++; r.lines.push(f.name + ': already on the list, left as it is'); return; }
            if (ref) later.push([ex, ref]);
            if (Object.keys(f).every(k => k === 'name' ? lower(ex.name) === lower(f.name) : String(ex[k] == null ? '' : ex[k]) === String(f[k]))) { r.unchanged++; return; }
            Object.assign(ex, f, { updatedAt: Date.now() }); r.updated++;
          });
          // Reporting managers, once every employee of the file is on the list
          later.forEach(([e, ref]) => { const m = list.find(x => x !== e && (lower(x.code) === lower(ref) || lower(x.name) === lower(ref))); if (m) { e.managerId = m.id; e.manager = m.name; } else r.lines.push(e.name + ': manager "' + ref + '" not found, left without one'); });
          Store.saveList('employees', list);
          UI.importResult('Employees uploaded', r, () => this.screenEmployees());
        } }] });
    },
    editEmployee(e) {
      const fresh = !e, s = this.settings(), wasRole = e ? (e.role || 'employee') : null;
      e = Object.assign({ code: '', name: '', designation: '', department: '', doj: U.today(), dol: '', phone: '', email: '', address: '', pan: '', aadhaar: '', uan: '', esiNo: '', bankName: '', bankAccount: '', bankIfsc: '', payType: 'monthly', hourlyRate: '', metro: !!s.metro, basic: '', da: '', hra: '', conveyance: '', special: '', pf: true, esi: true, pt: true, tds: '', leavesPerYear: s.leavesPerYear, active: true, manager: '', shiftStart: '', shiftEnd: '' }, e || {});
      if (fresh && !e.code) { let max = 0; this.employees(true).forEach(x => { const m = /(\d+)$/.exec(x.code || ''); if (m) max = Math.max(max, +m[1]); }); e.code = 'EMP' + String(max + 1).padStart(3, '0'); }
      const bg = UI.modal({ title: fresh ? 'New Employee' : 'Edit Employee', wide: true, body: '<div class="grid2">' +
        UI.field('Employee code', UI.input('hCode', e.code)) + UI.field('Full name', UI.input('hName', e.name), { req: true }) +
        UI.field('Designation', UI.input('hDesig', e.designation)) + UI.field('Department', UI.input('hDept', e.department)) +
        UI.field('Date of joining', UI.dateInput('hDoj', e.doj), { req: true }) + UI.field('Date of leaving', UI.dateInput('hDol', e.dol), { hint: 'Blank while employed' }) +
        UI.field('Mobile', UI.input('hPhone', e.phone, { type: 'tel', attrs: ' maxlength="10"' })) + UI.field('Email', UI.input('hEmail', e.email, { type: 'email' })) +
        UI.field('Address', '<textarea id="hAddr">' + esc(e.address) + '</textarea>', { span: true }) +
        UI.field('Reporting manager', UI.select('hMgr', this.employees(true).filter(x => x.id !== e.id).map(x => [x.id, x.name + (x.designation ? ' · ' + x.designation : '')]), e.managerId || '', { blank: '— none —' }), { hint: 'Approves this employee\'s timesheets and claims (with the managers above); on the offer letter' }) +
        UI.field('Role (what their login may do)', UI.select('hRole', this.roleOptions(), this.roleOf(e).value, this.canGiveLogin() || !Store.cid ? {} : { attrs: ' disabled' }), { hint: 'Give login adds the employee to the company with this role; changing it here changes the role of the login they already have. Roles and what each can access: Companies > Roles & hierarchy' }) +
        UI.field('PAN', UI.input('hPan', e.pan, { attrs: ' maxlength="10" style="text-transform:uppercase"' })) + UI.field('Aadhaar', UI.input('hAadhaar', e.aadhaar, { attrs: ' maxlength="12" inputmode="numeric"' })) +
        UI.field('UAN (PF)', UI.input('hUan', e.uan, { attrs: ' maxlength="12" inputmode="numeric"' })) + UI.field('ESI number', UI.input('hEsiNo', e.esiNo)) +
        UI.field('Shift start', UI.input('hShStart', e.shiftStart || '', { type: 'time' }), { hint: 'Blank = the company shift ' + esc(tm(s.shiftStart) || '09:30') + ' – ' + esc(tm(s.shiftEnd) || '18:30') + ' (HR Settings); the Web Clock measures late clock-ins and early clock-outs against it' }) + UI.field('Shift end', UI.input('hShEnd', e.shiftEnd || '', { type: 'time' }), { hint: 'A shift ending before it starts runs over midnight' }) +
        '<div class="field span"><label>Assets held</label><div class="tablewrap"><table class="items" style="min-width:0"><thead><tr><th>Asset</th><th class="hsn">Tag / serial</th><th class="rate">Issued on</th><th class="rate">Returned on</th><th>Notes</th><th class="del"></th></tr></thead><tbody id="hAssets">' + (e.assets || []).map(a => this.assetRow(a)).join('') + '</tbody></table></div><div class="btnrow" style="margin:6px 0 0"><button class="btn sm" id="hAssetAdd" type="button">+ Add asset</button></div></div>' +
        '<div class="field span"><label>Pay</label></div>' +
        UI.field('Pay type', UI.select('hPayType', [['monthly', 'Monthly salary (attendance)'], ['hourly', 'Rate per hour (weekly timesheets)']], e.payType)) + UI.field('Rate per hour ₹', UI.input('hRate', e.hourlyRate, { type: 'number', attrs: ' min="0" step="any"' }), { hint: 'Hours above ' + num(s.weeklyHours) + ' a week pay ' + num(s.usOtMultiplier) + 'x; holidays of the list are paid at ' + num(s.hoursPerDay) + ' hours' }) +
        '<div class="field span" id="hMonthly"><div class="grid2" style="margin:0">' +
        UI.field('Basic', UI.input('hBasic', e.basic, { type: 'number', attrs: ' min="0" step="any"' }), { req: true, hint: 'Wages for PF and ESI are basic + DA + the special allowance, and at least ' + num(s.wagesFloor) + '% of the pay (Code on Social Security)' }) + UI.field('DA', UI.input('hDa', e.da, { type: 'number', attrs: ' min="0" step="any"' })) +
        UI.field('HRA', UI.input('hHra', e.hra, { type: 'number', attrs: ' min="0" step="any"' }), { hint: 'Filled as ' + (e.metro ? 50 : num(s.hraPct)) + '% of basic when blank' }) + '<div class="field">' + UI.check('hMetro', 'Metro city (HRA at 50% of basic)', !!e.metro) + '</div>' +
        UI.field('Conveyance', UI.input('hConv', e.conveyance, { type: 'number', attrs: ' min="0" step="any"' })) + UI.field('Special / other allowance', UI.input('hSpecial', e.special, { type: 'number', attrs: ' min="0" step="any"' })) + '</div></div>' +
        '<div class="field"><label>TDS per month</label>' + UI.input('hTds', e.tds, { type: 'number', attrs: ' min="0" step="any"' }) + UI.check('hTdsAuto', 'Work out the TDS automatically from the salary', this.tdsAuto(e)) + '<div class="hint" id="hTdsHint"></div></div>' +
        '<div class="field">' + UI.check('hPf', 'PF applies', e.pf !== false) + UI.check('hEsi', 'ESI applies', e.esi !== false) + '<div class="hint" id="hApplies"></div>' + UI.check('hPt', 'Professional tax applies', e.pt !== false) + UI.check('hPwd', 'Person with a disability (ESI wage ceiling ' + U.indianNumber(num(s.esiCeilingPwd)).replace(/\.00$/, '') + ')', !!e.pwd) + '</div>' +
        UI.field('Leave policy', UI.select('hLvGroup', Object.keys(this.leavePolicy()).map(g => [g, this.leavePolicy()[g].name + ' - ' + this.leavePolicy()[g].types.reduce((a, t) => a + t.days, 0) + ' days a year']), this.policyGroup(e)), { hint: 'The days are earned month by month from the date of joining (HR > HR Policy).' }) +
        '<div class="field span"><label>Bank account (for the bank advice)</label></div>' +
        UI.field('Bank', UI.input('hBank', e.bankName)) + UI.field('Account number', UI.input('hAcc', e.bankAccount)) + UI.field('IFSC', UI.input('hIfsc', e.bankIfsc, { attrs: ' maxlength="11" style="text-transform:uppercase"' })) +
        '<div class="field">' + UI.check('hActive', 'On the payroll (Offboard on the list is the way out: notice, clearance, settlement and letters)', e.active !== false) + '</div></div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const g = (id) => String(UI.val(id, bg)).trim(), hourly = g('hPayType') === 'hourly';
          const o = Object.assign(e, { code: g('hCode'), name: g('hName'), designation: g('hDesig'), department: g('hDept'), doj: UI.dateVal('hDoj', bg), dol: UI.dateVal('hDol', bg), phone: g('hPhone'), email: g('hEmail'), address: g('hAddr'), managerId: g('hMgr'), manager: (this.employee(g('hMgr')) || {}).name || '', role: g('hRole') || 'employee', pan: g('hPan').toUpperCase(), aadhaar: g('hAadhaar'), uan: g('hUan'), esiNo: g('hEsiNo'),
            payType: hourly ? 'hourly' : 'monthly', hourlyRate: num(g('hRate')), metro: UI.val('hMetro', bg), basic: num(g('hBasic')), da: num(g('hDa')), hra: g('hHra') === '' ? this.hraOf(num(g('hBasic')), UI.val('hMetro', bg)) : num(g('hHra')), conveyance: num(g('hConv')), special: num(g('hSpecial')), tdsAuto: !!UI.val('hTdsAuto', bg), tds: UI.val('hTdsAuto', bg) ? 0 : num(g('hTds')), pf: UI.val('hPf', bg), esi: UI.val('hEsi', bg), pt: UI.val('hPt', bg), pwd: UI.val('hPwd', bg), leaveGroup: g('hLvGroup') || 'staff', leavesPerYear: this.leavePolicy()[g('hLvGroup') || 'staff'].types.reduce((a, t) => a + t.days, 0), bankName: g('hBank'), bankAccount: g('hAcc'), bankIfsc: g('hIfsc').toUpperCase(), active: UI.val('hActive', bg), shiftStart: tm(g('hShStart')), shiftEnd: tm(g('hShEnd')) });
          o.assets = $$('#hAssets tr', bg).map(tr => { const f = (k) => String(($('[data-a=' + k + ']', tr) || {}).value || '').trim(); return { name: f('name'), tag: f('tag'), issued: U.fromIso(f('issued')), returned: U.fromIso(f('returned')), notes: f('notes') }; }).filter(a => a.name);
          if (!o.name) { UI.mark('hName', true, bg); UI.toast('Enter the name'); return false; }
          if (!o.doj) { UI.toast('Enter the date of joining'); return false; }
          if (hourly && o.hourlyRate <= 0) { UI.mark('hRate', true, bg); UI.toast('Enter the rate per hour'); return false; }
          if (!hourly && o.basic <= 0) { UI.mark('hBasic', true, bg); UI.toast('Enter the basic salary'); return false; }
          if (o.phone && !/^[6-9][0-9]{9}$/.test(o.phone)) { UI.mark('hPhone', true, bg); UI.toast('Enter a valid 10-digit mobile number'); return false; }
          if (o.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(o.pan)) { UI.mark('hPan', true, bg); UI.toast('PAN is 10 characters, e.g. ABCDE1234F'); return false; }
          if (!hourly) { const total = o.basic + o.da + o.hra + o.conveyance + o.special; if (o.basic + o.da + o.special < total * num(s.wagesFloor) / 100 - 0.005) UI.toast('Note: basic + DA + special allowance is below ' + num(s.wagesFloor) + '% of the pay; the shortfall is treated as wages for PF and ESI (Code on Social Security)', 6000); }
          if (o.id) Store.update('employees', o); else Store.add('employees', o);
          UI.toast('Employee saved'); this.screenEmployees();
          // A login the employee already has follows the role chosen
          if (o.role !== wasRole) this.applyRole(o).then(t => { if (t) UI.toast(t, 5000); }, x => UI.toast('The role of the login could not be changed: ' + (x.message || 'no connection'), 7000));
        } }] });
      const sync = () => { const hourly = $('#hPayType', bg).value === 'hourly'; $('#hMonthly', bg).style.display = hourly ? 'none' : ''; $('#hRate', bg).disabled = !hourly; };
      $('#hPayType', bg).addEventListener('change', sync); sync();
      // HRA follows basic (and the metro tick) until it is typed
      const fillHra = () => { if (!$('#hHra', bg).dataset.typed) $('#hHra', bg).value = num($('#hBasic', bg).value) > 0 ? this.hraOf(num($('#hBasic', bg).value), $('#hMetro', bg).checked).toFixed(2) : ''; };
      $('#hBasic', bg).addEventListener('input', fillHra); $('#hMetro', bg).addEventListener('change', fillHra); $('#hHra', bg).addEventListener('input', e => { e.target.dataset.typed = '1'; });
      if (fresh) fillHra();
      /* PF and ESI are ticked or unticked by the salary as it is typed, and the TDS is worked out from it, so nobody
         has to know the rules. A tick changed by hand is left alone; so is one of an employee already saved whose pay
         goes above a ceiling (a PF member stays one, and ESI runs to the end of the contribution period). */
      const month = this.todayIso().slice(0, 7), plain = (v) => U.indianNumber(v).replace(/\.00$/, '');
      let payTyped = false;
      const draft = () => { const v = (id) => num($('#' + id, bg).value); return Object.assign({}, e, { payType: $('#hPayType', bg).value, hourlyRate: v('hRate'), basic: v('hBasic'), da: v('hDa'), hra: $('#hHra', bg).value === '' ? this.hraOf(v('hBasic'), $('#hMetro', bg).checked) : v('hHra'), conveyance: v('hConv'), special: v('hSpecial'), pwd: $('#hPwd', bg).checked, doj: UI.dateVal('hDoj', bg) || e.doj }); };
      const rules = () => {
        const d = draft(), hourly = d.payType === 'hourly', ap = this.applies(d, month), has = !hourly && this.structure(d) > 0;
        if (has && payTyped) [['hPf', ap.pf], ['hEsi', ap.esi]].forEach(([id, on]) => { const c = $('#' + id, bg); if (!c.dataset.typed && (on || fresh)) c.checked = on; });
        $('#hApplies', bg).innerHTML = (has ? 'Wages for PF and ESI: ₹' + plain(ap.wages) + '. PF is ' + (ap.pf ? 'compulsory (within ₹' + plain(ap.pfCeil) + ')' : 'not compulsory above ₹' + plain(ap.pfCeil) + ': tick it only for someone already a PF member, or who opts in') + '. ESI ' + (ap.esi ? 'applies (within ₹' + plain(ap.esiCeil) + ')' : 'does not apply above ₹' + plain(ap.esiCeil)) + '. The ticks follow the salary. ' : '') + 'PF covers an establishment of 20 or more people and ESI one of 10 or more: untick both when yours is not registered.';
        const auto = $('#hTdsAuto', bg).checked, tds = $('#hTds', bg), yearly = this.tdsOf(d, month) * this.fyMonths(d, month);
        tds.disabled = auto; if (auto) tds.value = this.tdsOf(d, month) || (has || hourly ? 0 : '');
        $('#hTdsHint', bg).textContent = auto ? 'New tax regime: standard deduction ₹75,000, nil up to a taxable income of ₹12,00,000, 4% cess' + (yearly ? '; about ₹' + plain(yearly) + ' for this financial year' : '') + '. Untick to type the amount (old regime, or other income and deductions declared).' : 'Income tax to deduct each month, as worked out for the year';
      };
      ['hBasic', 'hDa', 'hHra', 'hConv', 'hSpecial'].forEach(id => $('#' + id, bg).addEventListener('input', () => { payTyped = true; rules(); }));
      ['hRate'].forEach(id => $('#' + id, bg).addEventListener('input', rules));
      ['hMetro', 'hPwd', 'hPayType', 'hTdsAuto', 'hDoj'].forEach(id => $('#' + id, bg).addEventListener('change', () => { if (id !== 'hTdsAuto' && id !== 'hDoj') payTyped = payTyped || fresh; rules(); }));
      ['hPf', 'hEsi'].forEach(id => $('#' + id, bg).addEventListener('change', ev => { ev.target.dataset.typed = '1'; }));
      rules();
      const wireAssets = () => $$('#hAssets [data-arm]', bg).forEach(b => b.onclick = () => b.closest('tr').remove());
      wireAssets();
      $('#hAssetAdd', bg).onclick = () => { $('#hAssets', bg).insertAdjacentHTML('beforeend', this.assetRow({})); wireAssets(); const last = $$('#hAssets tr', bg).pop(); if (last) $('[data-a=name]', last).focus(); };
    },

    // ------------------------------------------------------------ assets held by the employees
    // Each employee record carries what the company gave them (e.assets: name, tag / serial, issued on, returned on, notes)
    assetsHeld(e) { const held = (e.assets || []).filter(a => a.name && !a.returned); return held.length ? held.map(a => esc(a.name) + (a.tag ? ' (' + esc(a.tag) + ')' : '')).join(', ') : '-'; },
    assetRow(a) { return '<tr><td><input data-a="name" placeholder="Laptop, phone, uniform, keys ..." value="' + esc(a.name || '') + '"></td><td><input data-a="tag" class="num" placeholder="Tag / serial" value="' + esc(a.tag || '') + '"></td><td><input type="date" data-a="issued" value="' + esc(U.toIso(a.issued || '')) + '"></td><td><input type="date" data-a="returned" value="' + esc(U.toIso(a.returned || '')) + '"></td><td><input data-a="notes" placeholder="Condition, notes" value="' + esc(a.notes || '') + '"></td><td class="del"><button class="delbtn" type="button" title="Remove" data-arm>🗑</button></td></tr>'; },
    assetsReport() {
      const rows = []; this.employees(true).forEach(e => (e.assets || []).forEach(a => { if (a.name) rows.push({ e, a }); }));
      const held = rows.filter(r => !r.a.returned);
      const bg = UI.modal({ title: 'Assets with the employees', wide: true, body: '<div class="hint">' + held.length + ' held, ' + (rows.length - held.length) + ' returned. Add or return an asset on the employee (the code opens it).</div>' +
          Ledger.listTable(['Employee', 'Asset', 'Tag / serial', 'Issued on', 'Returned on', 'Notes', 'Status'], rows.sort((x, y) => (x.a.returned ? 1 : 0) - (y.a.returned ? 1 : 0) || String(x.e.name).localeCompare(String(y.e.name))).map(r => '<tr>' + Ledger.td('Employee', '<b>' + esc(r.e.name) + '</b>' + (r.e.code ? ' ' + U.noLink(r.e.code) : '')) + Ledger.td('Asset', esc(r.a.name)) + Ledger.td('Tag', esc(r.a.tag || '-')) + Ledger.td('Issued', esc(r.a.issued || '-')) + Ledger.td('Returned', esc(r.a.returned || '-')) + Ledger.td('Notes', esc(r.a.notes || '-')) + Ledger.td('Status', r.a.returned ? '<span class="pill">Returned</span>' : '<span class="pill ok">Held</span>') + '</tr>'), 'No assets recorded yet. Open an employee and add what they hold under Assets.'),
        buttons: [{ label: 'Close', cls: 'outline' }, { label: 'Export Excel', cls: 'green', onClick: () => { UI.xls('Employee_Assets', ['Code', 'Employee', 'Asset', 'Tag / serial', 'Issued on', 'Returned on', 'Notes', 'Status'], rows.map(r => [r.e.code, r.e.name, r.a.name, r.a.tag, r.a.issued, r.a.returned, r.a.notes, r.a.returned ? 'Returned' : 'Held'])); return false; } }] });
      $$('a.nolink', bg).forEach(a => a.onclick = () => bg.remove());
      return bg;
    },

    // ------------------------------------------------------------ offer letter
    /* The points of the letter ("Terms of employment") are kept in HR Settings, one a line, and can be changed there;
       an employee's letter starts from them and can be changed for that employee alone (kept on the employee record
       with the probation, the notice and the rest typed for the letter). Words in braces are filled in from the
       employee and the letter: {name} {first_name} {designation} {department} {joining} {company} {manager}
       {probation} {probation_notice} {notice} {hours} {leave} {gross} {ctc} {pay_basis}. */
    OFFER_POINTS,
    offerPoints(e) { const own = e && Array.isArray(e.offerPoints) && e.offerPoints.length ? e.offerPoints : null, s = this.settings(); return own || (Array.isArray(s.offerPoints) && s.offerPoints.length ? s.offerPoints : OFFER_POINTS); },
    offerLetter(e) {
      const s = this.settings(), was = e.offer || {}, std = (Array.isArray(s.offerPoints) && s.offerPoints.length ? s.offerPoints : OFFER_POINTS).join('\n');
      const lines = (v) => String(v).replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean);
      const bg = UI.modal({ title: 'Offer Letter - ' + e.name, wide: true, body: '<div class="grid2">' + UI.field('Letter date', UI.dateInput('olDate', U.today())) + UI.field('Place', UI.input('olPlace', was.place != null ? was.place : String(Store.company().address || '').split('\n').pop() || '')) +
          UI.field('Probation (months)', UI.input('olProb', was.probation != null ? was.probation : 6, { type: 'number' })) + UI.field('Notice period (days)', UI.input('olNotice', was.notice != null ? was.notice : 30, { type: 'number' })) +
          UI.field('Working hours', UI.input('olHours', was.hours || num(s.hoursPerDay) + ' hours a day (' + this.shiftOf(e).start + ' to ' + this.shiftOf(e).end + '), ' + (num(s.weeklyHours) || 40) + ' hours a week')) + UI.field('Reporting to', UI.input('olMgr', was.manager != null ? was.manager : (e.manager || (e.managerId && this.employee(e.managerId) ? this.employee(e.managerId).name : '')))) +
          '<div class="field span"><label>Points of this letter (Terms of employment)</label><textarea id="olPoints" style="min-height:190px">' + esc(this.offerPoints(e).join('\n')) + '</textarea><div class="hint">One point a line; change, add or remove them for ' + esc(e.name.split(' ')[0]) + '. The words in braces are filled in from the employee and the boxes above: {name} {designation} {department} {joining} {manager} {probation} {notice} {hours} {leave} {gross} {ctc} {company}. The standard points are kept under HR Settings. <button class="link" id="olStd">Put the standard points back</button></div></div>' +
          UI.field('Other terms', '<textarea id="olTerms" placeholder="One per line (optional)">' + esc((was.terms || []).join('\n')) + '</textarea>', { span: true }) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'blue', onClick: (bg) => { keep(bg); UI.toast('Kept with ' + e.name); return false; } }, { label: 'Print / PDF', cls: 'green', onClick: (bg) => { const o = keep(bg); Print.show(this.offerLetterHtml(e, Object.assign({ date: UI.dateVal('olDate', bg) }, o))); } }] });
      // What was typed is kept on the employee record, the points only when they differ from the standard ones
      const keep = (bg) => {
        const o = { place: UI.val('olPlace', bg), probation: num(UI.val('olProb', bg)), notice: num(UI.val('olNotice', bg)), hours: UI.val('olHours', bg), manager: UI.val('olMgr', bg), terms: lines(UI.val('olTerms', bg)) }, points = lines(UI.val('olPoints', bg));
        e.offer = o; e.offerPoints = points.join('\n') === std ? null : points;
        if (Companies.mayWrite('employees')) Store.update('employees', e);
        return Object.assign({ points }, o);
      };
      $('#olStd', bg).onclick = () => { $('#olPoints', bg).value = std; };
    },
    offerLetterHtml(e, o) {
      const co = Store.company(), s = this.settings(), hourly = this.hourly(e), m = (v) => U.indianNumber(num(v));
      const comp = this.compute(e, thisMonth(), null, { full: true }), employer = comp.pfEmployer + comp.edli + comp.pfAdmin + comp.esiEmployer;
      const rows = hourly ? [['Rate per hour', m(e.hourlyRate), '-'], ['Overtime above ' + (num(s.weeklyHours) || 40) + ' hours a week', num(s.usOtMultiplier) + ' x the rate', '-']]
        : [['Basic', m(e.basic), m(num(e.basic) * 12)], ['Dearness allowance', m(e.da), m(num(e.da) * 12)], ['House rent allowance', m(e.hra), m(num(e.hra) * 12)], ['Conveyance', m(e.conveyance), m(num(e.conveyance) * 12)], ['Special allowance', m(e.special), m(num(e.special) * 12)], ['<b>Gross salary</b>', '<b>' + m(this.structure(e)) + '</b>', '<b>' + m(this.structure(e) * 12) + '</b>'],
          ['Employer\'s PF contribution', m(comp.pfEmployer + comp.edli + comp.pfAdmin), m((comp.pfEmployer + comp.edli + comp.pfAdmin) * 12)], ['Employer\'s ESI contribution', m(comp.esiEmployer), m(comp.esiEmployer * 12)], ['<b>Cost to company</b>', '<b>' + m(this.structure(e) + employer) + '</b>', '<b>' + m((this.structure(e) + employer) * 12) + '</b>']];
      // The points, with the words in braces filled in from the employee and the letter
      const mgr = o.manager || '', words = { name: e.name, first_name: e.name.split(' ')[0], designation: e.designation || 'Employee', department: e.department || '', joining: e.doj || '', company: co.name, manager: mgr, probation: o.probation || 0, probation_notice: Math.min(7, o.notice || 7), notice: o.notice || 0, hours: o.hours || '',
        leave: this.policyDays(e), gross: hourly ? '₹ ' + m(e.hourlyRate) + ' an hour' : '₹ ' + m(this.structure(e)) + ' a month', ctc: hourly ? '₹ ' + m(e.hourlyRate) + ' an hour' : '₹ ' + m((this.structure(e) + employer) * 12) + ' a year',
        pay_basis: hourly ? 'Pay is for the hours recorded on the weekly timesheet and approved by your manager; hours above the weekly limit are paid at the overtime rate.' : 'Salary is paid monthly for the days of attendance; overtime, where applicable, is paid at twice the wages as the labour codes provide.' };
      const fill = (t) => String(t).replace(/\{([a-z_]+)\}/gi, (all, k) => words[k.toLowerCase()] != null ? String(words[k.toLowerCase()]) : all);
      const terms = (Array.isArray(o.points) && o.points.length ? o.points : this.offerPoints(e)).map(t => esc(fill(t))).concat((o.terms || []).map(esc));
      const body = '<div class="doc std"><div class="part top">' + Print.head('OFFER OF EMPLOYMENT', co, [['Date:', o.date || U.today(), 1], ['Ref:', 'HR/' + (e.code || '') + '/' + (o.date || U.today()).slice(-4)]]) + '</div>' +
        '<div class="sect" style="font-weight:normal"><div>' + esc(e.name) + '</div>' + String(e.address || '').split('\n').filter(Boolean).map(l => '<div>' + esc(l) + '</div>').join('') + (o.place ? '<div>' + esc(o.place) + '</div>' : '') + '</div>' +
        '<div class="sect">Dear ' + esc(e.name.split(' ')[0]) + ',</div>' +
        '<div class="sect" style="font-weight:normal">We are pleased to offer you the position of <b>' + esc(e.designation || 'Employee') + '</b>' + (e.department ? ' in our ' + esc(e.department) + ' department' : '') + ' at ' + esc(co.name) + ', joining on <b>' + esc(e.doj || '') + '</b>' + (o.manager ? ', reporting to ' + esc(o.manager) : '') + '. Your remuneration will be as follows:</div>' +
        '<table class="grid items"><thead><tr><th>COMPONENT</th><th style="width:110pt">PER MONTH (₹)</th><th style="width:110pt">PER YEAR (₹)</th></tr></thead><tbody>' + rows.map(r => '<tr><td>' + r[0] + '</td><td class="r">' + r[1] + '</td><td class="r">' + r[2] + '</td></tr>').join('') + '</tbody></table>' +
        '<div class="sect">Terms of employment</div><ol style="margin:4px 0 0 18px;padding:0;font-size:9.5pt;line-height:1.5">' + terms.map(t => '<li>' + t + '</li>').join('') + '</ol>' +
        '<div class="sect" style="font-weight:normal">Please sign and return a copy of this letter as your acceptance. We look forward to working with you.</div>' +
        Print.signBlock(co) + '<div class="sect" style="font-weight:normal;margin-top:24px">Accepted: ______________________ &nbsp;&nbsp; (' + esc(e.name) + ') &nbsp;&nbsp; Date: ____________</div>' + Print.POWERED + '</div>';
      return Print.page('Offer letter - ' + e.name, Print.PAPERS.A4.css, '12mm 10mm', body);
    },

    // ------------------------------------------------------------ attendance
    screenAttendance(p) {
      const month = /^\d{4}-\d{2}$/.test(p.month || '') ? p.month : thisMonth(), n = daysIn(month), emps = this.employees().filter(e => !this.hourly(e)), def = this.defaults(month), s = this.settings();
      const run = this.payroll(month), locked = !!run && run.status === 'final';
      const cell = (st) => '<span class="att ' + st + '">' + (st === 'NA' ? '·' : st) + '</span>';
      const fromClock = s.attFromClock !== false, lvPending = this.leaves().filter(r => r.status === 'pending').length;
      const root = App.view(App.header('Attendance', '<div class="btnrow" style="margin:0">' + UI.input('atMonth', month, { type: 'month', attrs: ' style="min-height:36px;width:170px"' }) + '<button class="btn sm ' + (fromClock ? 'blue' : 'outline') + '" id="atMode" title="Mark the days from the Web Clock: a working day with a clock-in is present, without one absent">From Web Clock: ' + (fromClock ? 'On' : 'Off') + '</button><button class="btn sm outline" id="atAll">Clear marks</button><button class="btn sm outline" id="atLv" title="Leave requests: an approved request marks its days here by itself">Leave' + (lvPending ? ' (' + lvPending + ' to approve)' : '') + '</button><button class="btn sm outline" id="atClock">Web Clock</button><button class="btn sm outline" id="atTs">Timesheets</button><button class="btn sm outline" id="atPay">Payroll</button><button class="btn sm green" id="atXls">Export Excel</button></div>') +
        '<div class="hint" style="margin-bottom:10px">P present · A absent · L leave · HL half-day leave (paid) · HD half day (half loss of pay) · W weekly off · H holiday · ⚠ not clocked out · a dot is a day still to come: only leave can be marked ahead (tap the day), holidays, weekly offs and approved leave requests show by themselves' + (locked ? ' <b>This month\'s payroll is finalised: attendance is locked.</b>' : '') + '</div>' +
        (emps.length ? '<div class="tablewrap gs"><table class="list stmt attgrid"><thead><tr><th>Employee</th>' + Array.from({ length: n }, (_, i) => '<th class="' + (def[i + 1] !== 'P' ? 'off' : '') + '">' + (i + 1) + '<div class="small">' + 'SMTWTFS'[weekday(month, i + 1)] + '</div></th>').join('') + '<th class="num">P</th><th class="num">A</th><th class="num">L</th><th class="num">HD</th><th class="num">Hours</th><th class="num">OT hrs</th></tr></thead><tbody>' +
          emps.map(e => { const a = this.attendance(e.id, month) || { days: {}, ot: {} }, sm = this.summary(e, month), de = this.defaults(month, e);
            return '<tr data-emp="' + esc(e.id) + '"><td class="left"><b>' + esc(e.name) + '</b><div class="small muted">' + esc(e.code || '') + '</div></td>' + Array.from({ length: n }, (_, i) => { const d = i + 1, st = this.dayMark(e, month, d, a, de); const dc = this.dayClock(e, month + '-' + pad(d)), ch = dc.punched ? Math.round(dc.hours * 10) / 10 : 0; return '<td class="day" data-d="' + d + '" title="' + esc(STATUS[st]) + (st === 'L' && this.ahead(e, month, d, a) ? ' (to come)' : '') + (num(a.ot && a.ot[d]) ? ', OT ' + a.ot[d] + ' h' : '') + (ch ? ', web clock ' + ch + ' h' : '') + (dc.missed ? ', not clocked out' : '') + (dc.isLate ? ', late by ' + fmtMin(dc.late) : '') + (dc.isEarly ? ', left early by ' + fmtMin(dc.early) : '') + '">' + cell(st) + (ch ? '<div class="small muted">' + ch + '</div>' : '') + (dc.missed ? '<div class="miss">⚠</div>' : '') + (num(a.ot && a.ot[d]) ? '<div class="small">+' + a.ot[d] + '</div>' : '') + '</td>'; }).join('') +
              '<td class="num">' + sm.P + '</td><td class="num">' + sm.A + '</td><td class="num">' + sm.leave + '</td><td class="num">' + sm.HD + '</td><td class="num">' + sm.hours + '</td><td class="num"><input type="number" min="0" step="0.5" class="otm" value="' + (sm.ot || '') + '" style="width:70px;min-height:32px;text-align:right"' + (locked ? ' disabled' : '') + ' title="Overtime hours of the month (put on the last working day)"></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">No monthly-salaried employees yet.</div>'));
      App.wireBack(root);
      $('#atMonth').onchange = e => { if (e.target.value) App.go('attendance', { month: e.target.value }); };
      $('#atTs').onclick = () => App.go('timesheets'); $('#atPay').onclick = () => App.go('payroll', { month }); $('#atClock').onclick = () => App.go('clock', { month }); $('#atLv').onclick = () => App.go('leave');
      const save = (empId, fn) => { let a = this.attendance(empId, month); if (!a) a = { id: empId + ':' + month, empId, month, days: {}, ot: {} }; fn(a); if (a.id && Store.find('attendance', a.id)) Store.update('attendance', a); else Store.add('attendance', a); };
      $('#atMode').onclick = () => { const o = this.settings(); o.attFromClock = !fromClock; this.saveSettings(o); UI.toast(o.attFromClock ? 'Days are marked from the Web Clock' : 'Days are marked by hand; a day not touched is present'); this.screenAttendance({ month }); };
      $('#atAll').onclick = () => { if (locked) return UI.toast('The payroll of this month is finalised'); emps.forEach(e => save(e.id, a => { a.days = {}; })); UI.toast('Marks cleared' + (fromClock ? ': the days follow the Web Clock' : ': everyone present on the working days')); this.screenAttendance({ month }); };
      $$('td.day', root).forEach(td => td.onclick = () => {
        if (locked) return UI.toast('The payroll of this month is finalised');
        const empId = td.closest('tr').dataset.emp, d = td.dataset.d, a = this.attendance(empId, month), emp = this.employee(empId), de = this.defaults(month, emp), cur = (a && a.days && a.days[d]) || de[d];
        // A day still to come takes leave and nothing else: present, absent and half day wait for the day itself
        const fut = this.ahead(emp, month, +d, a);
        if (fut) {
          if (fut === 'H' || fut === 'W') return UI.toast(dateOf(month, +d) + ' is a ' + (fut === 'H' ? 'holiday' : 'weekly off') + ': it is marked by itself');
          const ms = fromIso(month + '-' + pad(+d)).getTime(), j = U.dateMs(emp && emp.doj), l = U.dateMs(emp && emp.dol);
          if ((j && ms < j) || (l && ms > l)) return UI.toast(j && ms < j ? 'This day is before the date of joining' : 'This day is after the last working day');
          if (!(a && a.days && a.days[d]) && emp && this.leaveMap(emp.id).get(month + '-' + pad(+d))) return UI.toast(dateOf(month, +d) + ' is on an approved leave request: cancel the request under Leave to change it', 5000);
          save(empId, x => { x.days = x.days || {}; if (fut === 'L') delete x.days[d]; else x.days[d] = 'L'; });
          UI.toast(fut === 'L' ? 'Leave on ' + dateOf(month, +d) + ' removed' : 'Leave marked on ' + dateOf(month, +d) + '. Present cannot be marked for a day still to come.', 4000);
          return this.screenAttendance({ month });
        }
        const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
        save(empId, x => { x.days = x.days || {}; if (next === de[d]) delete x.days[d]; else x.days[d] = next; });
        this.screenAttendance({ month });
      });
      $$('input.otm', root).forEach(inp => inp.onchange = () => { const empId = inp.closest('tr').dataset.emp, h = num(inp.value); save(empId, a => { a.ot = {}; if (h > 0) { let last = n; while (last > 1 && def[last] !== 'P') last--; a.ot[last] = h; } }); this.screenAttendance({ month }); });
      $('#atXls').onclick = () => UI.xls('Attendance_' + month, ['Code', 'Employee'].concat(Array.from({ length: n }, (_, i) => String(i + 1))).concat(['Present', 'Absent', 'Leave', 'Half days', 'Hours', 'OT hours', 'Paid days']),
        emps.map(e => { const a = this.attendance(e.id, month) || { days: {} }, sm = this.summary(e, month), de = this.defaults(month, e); return [e.code, e.name].concat(Array.from({ length: n }, (_, i) => { const st = this.dayMark(e, month, i + 1, a, de); return st === 'NA' ? '' : st; })).concat([sm.P, sm.A, sm.leave, sm.HD, sm.hours, sm.ot, sm.paid]); }));
    },

    // ------------------------------------------------------------ timesheets (weekly, hours a day, approved by a manager)
    screenTimesheets(p) {
      const week = /^\d{4}-\d{2}-\d{2}$/.test(p.week || '') ? mondayOf(fromIso(p.week)) : mondayOf(new Date()), mon = fromIso(week), s = this.settings(), hol = this.holidayMap(), approve = this.approver();
      const days = Array.from({ length: 7 }, (_, i) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i));
      const emps = this.visible().sort((a, b) => (this.hourly(b) ? 1 : 0) - (this.hourly(a) ? 1 : 0));
      const monthOf = iso(mon).slice(0, 7), run = this.payroll(monthOf), locked = !!run && run.status === 'final';
      const root = App.view(App.header('Timesheets', '<div class="btnrow" style="margin:0"><button class="btn sm outline" id="tsPrev">‹</button>' + UI.input('tsWeek', week, { type: 'date', attrs: ' style="min-height:36px;width:170px"' }) + '<button class="btn sm outline" id="tsNext">›</button><button class="btn sm outline" id="tsCopy">Copy last week</button><button class="btn sm outline" id="tsPay">Payroll</button><button class="btn sm green" id="tsXls">Export Excel</button></div>') +
        '<div class="hint" style="margin-bottom:10px">Week of ' + esc(dmy(days[0])) + ' to ' + esc(dmy(days[6])) + (approve ? '' : ' <b>Your login enters hours; approval is for the reporting manager.</b>') + (locked ? ' <b>The payroll of this month is finalised: the sheet is locked.</b>' : '') + '</div>' +
        (emps.length ? '<div class="tablewrap gs"><table class="list stmt tsgrid"><thead><tr><th>Employee</th>' + days.map((d, i) => '<th class="' + (hol.has(dmy(d)) || this.isOff(d) ? 'off' : '') + '">' + DAY_NAMES[i] + '<div class="small">' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + (hol.has(dmy(d)) ? ' H' : '') + '</div></th>').join('') + '<th class="num">Total</th><th class="num">OT</th><th>Approved</th></tr></thead><tbody>' +
          emps.map(e => { const t = this.timesheet(e.id, week) || { hours: {}, approved: false }, total = Object.values(t.hours || {}).reduce((x, h) => x + num(h), 0), ot = this.hourly(e) ? Math.max(0, total - (num(s.weeklyHours) || 40)) : 0;
            return '<tr data-emp="' + esc(e.id) + '"><td class="left"><b>' + esc(e.name) + '</b><div class="small muted">' + esc(e.code || '') + (this.hourly(e) ? ' · ' + money(num(e.hourlyRate)) + '/h' : ' · monthly') + '</div></td>' + days.map((d, i) => '<td class="num"><input type="number" min="0" max="24" step="0.5" class="tsh" data-i="' + i + '" value="' + (num(t.hours && t.hours[i]) || '') + '" style="width:62px;min-height:32px;text-align:right"' + (locked || t.approved ? ' disabled' : '') + '></td>').join('') +
              '<td class="num"><b>' + total + '</b></td><td class="num">' + (ot || '') + '</td><td><label class="check" style="justify-content:center"><input type="checkbox" class="tsa"' + (t.approved ? ' checked' : '') + (this.canApprove(e) && !locked ? '' : ' disabled') + (this.relation(e) === 'self' ? ' title="Your own timesheet is approved by your manager"' : '') + '> ' + (t.approved ? '<span class="small muted">' + esc(t.approvedBy || '') + '</span>' : '') + '</label></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">Add employees first.</div>'));
      App.wireBack(root);
      const go = (d) => App.go('timesheets', { week: iso(d) });
      $('#tsWeek').onchange = e => { if (e.target.value) go(fromIso(e.target.value)); };
      $('#tsPrev').onclick = () => go(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 7)); $('#tsNext').onclick = () => go(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7));
      $('#tsPay').onclick = () => App.go('payroll', { month: monthOf });
      const save = (empId, fn) => { let t = this.timesheet(empId, week); if (!t) t = { id: empId + ':' + week, empId, week, hours: {}, approved: false }; fn(t); if (Store.find('timesheets', t.id)) Store.update('timesheets', t); else Store.add('timesheets', t); };
      $$('input.tsh', root).forEach(inp => inp.onchange = () => { const empId = inp.closest('tr').dataset.emp, h = Math.max(0, Math.min(24, num(inp.value))); save(empId, t => { t.hours = t.hours || {}; if (h > 0) t.hours[inp.dataset.i] = h; else delete t.hours[inp.dataset.i]; }); this.screenTimesheets({ week }); });
      $$('input.tsa', root).forEach(inp => inp.onchange = () => { const empId = inp.closest('tr').dataset.emp; save(empId, t => { t.approved = inp.checked; t.approvedBy = inp.checked ? (App.user && App.user.name) || Companies.roleLabel() : ''; t.approvedAt = inp.checked ? Date.now() : 0; }); UI.toast(inp.checked ? 'Timesheet approved' : 'Approval withdrawn'); this.screenTimesheets({ week }); });
      $('#tsCopy').onclick = () => { if (locked) return UI.toast('The payroll of this month is finalised'); const prev = iso(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 7)); let n = 0; emps.forEach(e => { const was = this.timesheet(e.id, prev); if (!was) return; save(e.id, t => { if (t.approved) return; t.hours = JSON.parse(JSON.stringify(was.hours || {})); n++; }); }); UI.toast(n ? 'Copied the hours of last week for ' + n + ' employee' + (n === 1 ? '' : 's') : 'Nothing recorded last week'); this.screenTimesheets({ week }); };
      $('#tsXls').onclick = () => UI.xls('Timesheet_' + week, ['Code', 'Employee', 'Pay type'].concat(days.map((d, i) => DAY_NAMES[i] + ' ' + dmy(d))).concat(['Total', 'Overtime', 'Approved', 'Approved by']), emps.map(e => { const t = this.timesheet(e.id, week) || { hours: {} }, total = Object.values(t.hours || {}).reduce((x, h) => x + num(h), 0); return [e.code, e.name, this.hourly(e) ? 'Hourly' : 'Monthly'].concat(days.map((d, i) => num(t.hours && t.hours[i]))).concat([total, this.hourly(e) ? Math.max(0, total - (num(s.weeklyHours) || 40)) : 0, t.approved ? 'Yes' : 'No', t.approvedBy || '']); }));
    },

    // ------------------------------------------------------------ reimbursements (claims approved by a manager, paid with the payroll)
    screenReimbursements(p) {
      const status = p.status || '', approve = this.approver(), emps = new Map(this.employees(true).map(e => [e.id, e])), vis = new Set(this.visible(true).map(e => e.id));
      const all = this.claims().filter(r => vis.has(r.empId)).map(r => Object.assign({}, r, this.claimState(r))).sort((a, b) => U.dateMs(b.date) - U.dateMs(a.date) || num(b.createdAt) - num(a.createdAt)), list = status ? all.filter(r => r.status === status) : all;
      const pill = (st) => st === 'paid' ? 'ok' : st === 'approved' ? '' : st === 'rejected' ? 'bad' : 'warn';
      const chip = (k, label) => '<button class="btn sm ' + (status === k ? '' : 'outline') + '" data-st="' + k + '">' + label + '</button>';
      const root = App.view(App.header('Reimbursements', '<div class="btnrow" style="margin:0"><button class="btn sm green" id="rbAdd">+ Claim</button><button class="btn sm outline" id="rbPay">Payroll</button><button class="btn sm outline" id="rbXls">Export Excel</button></div>') +
        '<div class="btnrow">' + chip('', 'All') + chip('pending', 'Pending') + chip('approved', 'Approved') + chip('paid', 'Paid') + chip('rejected', 'Rejected') + '</div>' +
        
        Ledger.listTable(['Date', 'Employee', 'Category', 'Description', '#Amount', 'Status', ''], list.map(r => { const e = emps.get(r.empId) || { name: '-' };
          return '<tr>' + Ledger.td('Date', esc(r.date)) + Ledger.td('Employee', '<b>' + esc(e.name) + '</b>') + Ledger.td('Category', esc(r.category)) + Ledger.td('Description', esc(r.description || '') + (r.bill ? '<div class="small muted">Bill ' + esc(r.bill) + '</div>' : '')) + Ledger.td('Amount', '<b>' + money(num(r.amount)) + '</b>', 'num') + Ledger.td('Status', '<span class="pill ' + pill(r.status) + '">' + esc(r.status[0].toUpperCase() + r.status.slice(1)) + '</span>' + (r.paidMonth ? '<div class="small muted">' + esc(monthLabel(r.paidMonth)) + '</div>' : r.approvedBy ? '<div class="small muted">' + esc(r.approvedBy) + '</div>' : '')) +
            '<td class="actions">' + (r.status === 'pending' && this.canApprove(e.id ? e : null) ? '<button class="btn sm green" data-ok="' + esc(r.id) + '">Approve</button><button class="btn sm red" data-no="' + esc(r.id) + '">Reject</button>' : r.status === 'pending' && this.relation(e) === 'self' ? '<span class="small muted">Your manager approves</span>' : '') + (r.status === 'pending' || (approve && r.status !== 'paid') ? '<button class="btn sm outline" data-e="' + esc(r.id) + '">Edit</button>' + (Companies.role() === 'employee' ? '' : '<button class="btn sm red" data-d="' + esc(r.id) + '">Delete</button>') : '') + '</td></tr>'; }), status ? 'No ' + status + ' claims.' : 'No reimbursement claims yet.'));
      App.wireBack(root);
      const back = () => this.screenReimbursements({ status });
      $$('[data-st]', root).forEach(b => b.onclick = () => this.screenReimbursements({ status: b.dataset.st }));
      $('#rbAdd').onclick = () => this.editReimbursement(null, back); $('#rbPay').onclick = () => App.go('payroll');
      $('#rbXls').onclick = () => UI.xls('Reimbursements', ['Date', 'Employee', 'Category', 'Description', 'Bill', 'Amount', 'Status', 'Approved by', 'Paid with'], list.map(r => [r.date, (emps.get(r.empId) || {}).name, r.category, r.description, r.bill, num(r.amount), r.status, r.approvedBy || '', r.paidMonth ? monthLabel(r.paidMonth) : '']));
      // Edit keeps the stored record (status as entered), not the derived state
      $$('[data-e]', root).forEach(b => b.onclick = () => this.editReimbursement(Store.find('reimbursements', b.dataset.e), back));
      $$('[data-d]', root).forEach(b => b.onclick = () => UI.confirm('Delete Claim', 'Delete this claim?', () => { Store.delete('reimbursements', b.dataset.d); UI.toast('Claim deleted'); back(); }, 'Delete'));
      const decide = (id, st) => { const r = Store.find('reimbursements', id); r.status = st; r.approvedBy = (App.user && App.user.name) || Companies.roleLabel(); r.approvedAt = Date.now(); Store.update('reimbursements', r); UI.toast(st === 'approved' ? 'Approved: paid with the next payroll' : 'Rejected'); back(); };
      $$('[data-ok]', root).forEach(b => b.onclick = () => decide(b.dataset.ok, 'approved'));
      $$('[data-no]', root).forEach(b => b.onclick = () => decide(b.dataset.no, 'rejected'));
    },
    editReimbursement(r, onDone) {
      const fresh = !r; r = Object.assign({ empId: '', date: U.today(), category: RB_CATS[0], amount: '', description: '', bill: '', status: 'pending' }, r || {});
      const emps = this.visible();
      if (fresh && !r.empId && !this.clockRole()) { const me = this.myEmployee(); if (me) r.empId = me.id; }
      UI.modal({ title: fresh ? 'New Claim' : 'Edit Claim', body: '<div class="grid2">' + UI.field('Employee', UI.select('rbEmp', emps.map(e => [e.id, e.name + (e.code ? ' (' + e.code + ')' : '')]), r.empId, { blank: emps.length ? '— choose —' : 'No employees' }), { req: true }) + UI.field('Date', UI.dateInput('rbDate', r.date), { req: true }) +
          UI.field('Category', UI.select('rbCat', RB_CATS, r.category)) + UI.field('Amount ₹', UI.input('rbAmt', r.amount, { type: 'number', attrs: ' min="0" step="any"' }), { req: true }) +
          UI.field('Description', UI.input('rbDesc', r.description, { placeholder: 'e.g. Taxi to the client, 3 Oct' }), { span: true }) + UI.field('Bill / receipt number', UI.input('rbBill', r.bill)) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          Object.assign(r, { empId: UI.val('rbEmp', bg), date: UI.dateVal('rbDate', bg), category: UI.val('rbCat', bg), amount: num(UI.val('rbAmt', bg)), description: String(UI.val('rbDesc', bg)).trim(), bill: String(UI.val('rbBill', bg)).trim() });
          if (!r.empId) { UI.toast('Choose the employee'); return false; }
          if (!r.date) { UI.toast('Enter the date'); return false; }
          if (r.amount <= 0) { UI.mark('rbAmt', true, bg); UI.toast('Enter the amount'); return false; }
          if (r.id) Store.update('reimbursements', r); else Store.add('reimbursements', r);
          UI.toast('Claim saved'); if (onDone) onDone();
        } }] });
    },

    // ------------------------------------------------------------ leave requests (asked by the employee, approved by a manager, marked on the attendance)
    screenLeave(p) {
      const status = p.status || '', emps = new Map(this.employees(true).map(e => [e.id, e])), own1 = Companies.leaveOnly(), vis = new Set((own1 ? this.employees(true).filter(e => ['self', 'manager'].includes(this.relation(e))) : this.visible(true)).map(e => e.id)), me = this.myEmployee(), yearEnd = this.leaveYearEnd();
      const all = this.leaves().filter(r => vis.has(r.empId)).sort((a, b) => U.dateMs(b.from) - U.dateMs(a.from) || num(b.createdAt) - num(a.createdAt)), list = status ? all.filter(r => r.status === status) : all;
      const pill = (st) => st === 'approved' ? 'ok' : st === 'rejected' ? 'bad' : st === 'cancelled' ? '' : 'warn';
      const chip = (k, label) => '<button class="btn sm ' + (status === k ? '' : 'outline') + '" data-st="' + k + '">' + label + (k ? ' (' + all.filter(r => r.status === k).length + ')' : '') + '</button>';
      // Whether this login applies leave for anybody but itself (HR, a manager, an admin, the owner; a reporting manager for their people)
      const forOthers = this.employees().some(e => (!me || e.id !== me.id) && this.mayApplyFor(e));
      this.syncMembers();
      const bal = me ? this.leaveBalance(me, yearEnd) : null;
      const root = App.view(App.header(this.clockRole() && !own1 ? 'Leave' : 'My Leave', '<div class="btnrow" style="margin:0"><button class="btn sm green" id="lvAdd">' + (forOthers ? '+ Apply leave' : '+ Request leave') + '</button>' + (Companies.mayOpen('attendance') ? '<button class="btn sm outline" id="lvAtt">Attendance</button>' : '') + '<button class="btn sm outline" id="lvXls">Export Excel</button></div>') +
        (bal ? '<div class="card white"><div class="bd" id="lvBal"><b>' + esc(me.name) + '</b>: <b>' + bal.left + '</b> days of paid leave left of ' + bal.accrued + ' earned so far this year (' + bal.quota + ' a year, earned month by month; ' + bal.used + ' taken or approved). ' + bal.types.map(t => esc(t.name) + ' <b>' + t.left + '</b>').join(' &middot; ') + ' &middot; <a href="#hrpolicy">Leave policy</a></div></div>' : '') +
        '<div class="hint" style="margin-bottom:10px">' + (forOthers ? 'Leave can be applied for an employee by the owner, an admin, a manager or HR, and by the employee\'s reporting manager; everyone else applies only their own. ' : 'You apply your own leave; nobody applies it for you except HR, a manager, an admin or the owner. ') + 'A request is approved by whoever is above the employee: the reporting manager (and the managers above), a manager, an admin or the owner; never by the employee themselves. Once approved, its working days are marked as leave on the attendance by themselves; holidays and weekly offs inside it are not counted.</div>' +
        '<div class="btnrow">' + chip('', 'All') + chip('pending', 'Pending') + chip('approved', 'Approved') + chip('rejected', 'Rejected') + chip('cancelled', 'Cancelled') + '</div>' +
        Ledger.listTable(['Employee', 'From', 'To', '#Days', 'Type', 'Reason', 'Status', ''], list.map(r => { const e = emps.get(r.empId) || { name: '-' }, may = this.canApproveLeave(e.id ? e : null), own = this.relation(e) === 'self', mine = this.mayApplyFor(e.id ? e : null);
          return '<tr>' + Ledger.td('Employee', '<b>' + esc(e.name) + '</b>' + (e.id && (may || this.clockRole()) ? '<div class="small muted">' + this.leaveBalance(e, yearEnd).left + ' days left</div>' : '') + (r.appliedBy ? '<div class="small muted">Applied by ' + esc(r.appliedBy) + '</div>' : '')) + Ledger.td('From', esc(r.from)) + Ledger.td('To', esc(r.to)) + Ledger.td('Days', '<b>' + this.leaveCount(r) + '</b>', 'num') + Ledger.td('Type', esc(r.type || '') + (r.half ? '<div class="small muted">Half day, ' + (r.half === 'second' ? 'second half' : 'first half') + '</div>' : '')) + Ledger.td('Reason', esc(r.reason || '')) +
            Ledger.td('Status', '<span class="pill ' + pill(r.status) + '">' + esc(r.status[0].toUpperCase() + r.status.slice(1)) + '</span>' + (r.approvedBy && r.status !== 'pending' ? '<div class="small muted">' + esc(r.approvedBy) + '</div>' : '')) +
            '<td class="actions">' + (r.status === 'pending' && may ? '<button class="btn sm green" data-ok="' + esc(r.id) + '">Approve</button><button class="btn sm red" data-no="' + esc(r.id) + '">Reject</button>' : r.status === 'pending' && own ? '<span class="small muted">Your manager approves</span>' : '') +
              (r.status === 'pending' && (mine || may) ? (mine ? '<button class="btn sm outline" data-e="' + esc(r.id) + '">Edit</button>' : '') + '<button class="btn sm outline" data-x="' + esc(r.id) + '">' + (own ? 'Withdraw' : 'Cancel') + '</button>' : r.status === 'approved' && may ? '<button class="btn sm outline" data-x="' + esc(r.id) + '">Cancel leave</button>' : '') + '</td></tr>'; }), status ? 'No ' + status + ' leave requests.' : 'No leave requests yet.'));
      App.wireBack(root);
      const back = () => this.screenLeave({ status });
      $$('[data-st]', root).forEach(b => b.onclick = () => this.screenLeave({ status: b.dataset.st }));
      $('#lvAdd').onclick = () => this.editLeave(null, back); if ($('#lvAtt')) $('#lvAtt').onclick = () => App.go('attendance');
      $('#lvXls').onclick = () => UI.xls('Leave_requests', ['Employee', 'Code', 'From', 'To', 'Days of leave', 'Half day', 'Type', 'Reason', 'Status', 'Decided by', 'Asked on'], list.map(r => { const e = emps.get(r.empId) || {}; return [e.name, e.code, r.from, r.to, this.leaveCount(r), r.half ? (r.half === 'second' ? 'Second half' : 'First half') : '', r.type, r.reason, r.status, r.approvedBy || '', r.askedOn || '']; }));
      $$('[data-e]', root).forEach(b => b.onclick = () => this.editLeave(Store.find('reimbursements', b.dataset.e), back));
      const decide = (id, st) => { const r = Store.find('reimbursements', id); if (!r) return; let cut = '';
        // At the approval the balance is looked at again: what it no longer covers is approved as loss of pay
        if (st === 'approved' && r.status === 'pending') { const asked = r.type, parts = this.fitLeave(r); if (parts.length > 1) { const q = parts[1]; q.status = 'approved'; q.approvedBy = (App.user && App.user.name) || Companies.roleLabel(); q.approvedAt = Date.now(); Store.add('reimbursements', q); cut = this.leaveCount(q) + ' day' + (this.leaveCount(q) === 1 ? '' : 's') + ' beyond the ' + asked + ' left approved as loss of pay. '; } else if (r.type !== asked) cut = 'No ' + asked + ' left: approved as loss of pay. '; }
        r.status = st; r.approvedBy = (App.user && App.user.name) || Companies.roleLabel(); r.approvedAt = Date.now(); Store.update('reimbursements', r); if (cut) UI.toast(cut, 7000); UI.toast(st === 'approved' ? 'Approved: the days are marked as leave on the attendance' : st === 'rejected' ? 'Rejected' : 'Cancelled: the days are no longer marked as leave', 4000); back(); };
      $$('[data-ok]', root).forEach(b => b.onclick = () => decide(b.dataset.ok, 'approved'));
      $$('[data-no]', root).forEach(b => b.onclick = () => decide(b.dataset.no, 'rejected'));
      $$('[data-x]', root).forEach(b => b.onclick = () => { const r = Store.find('reimbursements', b.dataset.x); if (!r) return; const e = this.employee(r.empId); if (!(this.mayApplyFor(e) || this.canApproveLeave(e))) { UI.toast('Only the employee, HR, a manager or an admin can withdraw this leave', 4000); return; } UI.confirm(r.status === 'approved' ? 'Cancel Leave' : 'Withdraw Request', 'Leave from ' + r.from + ' to ' + r.to + (r.status === 'approved' ? ': cancel it? The days go back to what the attendance says.' : ': take the request back?'), () => decide(r.id, 'cancelled'), r.status === 'approved' ? 'Cancel leave' : 'Withdraw'); });
    },
    editLeave(r, onDone) {
      const fresh = !r; r = Object.assign({ kind: 'leave', empId: '', from: U.today(), to: U.today(), type: LV_TYPES[0], half: '', reason: '', status: 'pending' }, r || {});
      // The people this login may apply leave for: itself, and everybody (HR, a manager, an admin, the owner) or its own reports
      const me = this.myEmployee(), emps = this.employees().filter(e => this.mayApplyFor(e)), others = emps.some(e => !me || e.id !== me.id);
      if (!fresh && !this.mayApplyFor(this.employee(r.empId))) return UI.alert('Leave Request', 'This leave is not yours: only the employee, HR, a manager, an admin or the owner can change it.');
      if (fresh && !r.empId && me && emps.some(e => e.id === me.id)) r.empId = me.id;
      if (!emps.length) return UI.alert('Request Leave', this.leaveForAll() ? 'There are no employees yet: add them under Employees first.' : 'Your login is not linked to an employee record yet. Ask HR to put your mobile number or email on your employee record.');
      const bg = UI.modal({ title: fresh ? (others ? 'Apply Leave' : 'Request Leave') : 'Edit Leave Request', body: '<div class="grid2">' + UI.field(others ? 'Apply for (employee)' : 'Employee', UI.select('lvEmp', emps.map(e => [e.id, e.name + (e.code ? ' (' + e.code + ')' : '') + (me && e.id === me.id ? ' - myself' : '')]), r.empId, others ? { blank: '— choose —' } : { attrs: ' disabled' }), { req: true, hint: others ? 'Your own leave, or the leave of an employee you apply for.' : 'You apply your own leave.' }) + UI.field('Type', UI.select('lvType', LV_TYPES, r.type), { hint: 'Loss of pay is leave without pay: its days are marked absent.' }) +
          UI.field('Duration', UI.select('lvHalf', [['', 'Full day(s)'], ['first', 'Half day: first half'], ['second', 'Half day: second half']], r.half || ''), { hint: 'A half day is for one day: half a day of leave, the other half worked.' }) + '<div class="field"></div>' +
          UI.field('From', UI.dateInput('lvFrom', r.from), { req: true }) + UI.field('To', UI.dateInput('lvTo', r.to), { req: true }) +
          UI.field('Reason', UI.input('lvReason', r.reason, { placeholder: 'e.g. family function, fever' }), { span: true }) + '<div class="field span"><div class="hint" id="lvInfo"></div></div></div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: fresh ? 'Send request' : 'Save', cls: 'green', onClick: (bg) => {
          const x = read(bg), e = this.employee(x.empId);
          if (!e) { UI.toast('Choose the employee'); return false; }
          if (!this.mayApplyFor(e)) { UI.toast('You can apply only your own leave: for ' + e.name + ' it is HR, a manager, an admin or the owner', 5000); return false; }
          if (!x.from || !x.to) { UI.toast('Enter the first and the last day of the leave'); return false; }
          if (U.dateMs(x.to) < U.dateMs(x.from)) { UI.mark('lvTo', true, bg); UI.toast('The last day is before the first'); return false; }
          if (!this.leaveDates(x).length) { UI.toast('There is no working day in these dates: they are weekly offs or holidays'); return false; }
          const clash = this.leaves().find(o => o.id !== r.id && o.empId === x.empId && ['pending', 'approved'].includes(o.status) && U.dateMs(o.from) <= U.dateMs(x.to) && U.dateMs(o.to || o.from) >= U.dateMs(x.from));
          if (clash) { UI.toast('There is already a ' + clash.status + ' request from ' + clash.from + ' to ' + clash.to, 5000); return false; }
          // Shown as a claim of nothing by a portal not yet reloaded: the date, a category and the reason stand in
          Object.assign(r, x, { kind: 'leave', date: x.from, category: 'Leave', description: x.reason, amount: 0, askedOn: r.askedOn || U.today() });
          // Applied for somebody else: who did it stays on the request
          if (fresh) r.appliedBy = this.relation(e) === 'self' ? '' : ((App.user && App.user.name) || Companies.roleLabel());
          // No balance, no paid leave: the days beyond what is left go in as loss of pay
          const asked = r.type, parts = this.fitLeave(r);
          parts.forEach(q => { if (q.id) Store.update('reimbursements', q); else Store.add('reimbursements', q); });
          const cut = parts.length > 1 ? 'There is ' + asked + ' for ' + this.leaveCount(parts[0]) + ' day' + (this.leaveCount(parts[0]) === 1 ? '' : 's') + ' only: the other ' + this.leaveCount(parts[1]) + ' went in as loss of pay. ' : r.lopFor && r.type === 'Loss of pay' && asked !== 'Loss of pay' ? 'There is no ' + asked + ' left: the request went in as loss of pay. ' : '';
          UI.toast(cut + (this.canApproveLeave(e) ? 'Leave request saved: approve it to mark the attendance' : 'Leave request sent to your manager'), cut ? 8000 : 4000); if (onDone) onDone();
        } }] });
      const read = (bg) => { const half = UI.val('lvHalf', bg) || '', from = UI.dateVal('lvFrom', bg); return { empId: UI.val('lvEmp', bg), type: UI.val('lvType', bg), half, from, to: half ? from : UI.dateVal('lvTo', bg), reason: String(UI.val('lvReason', bg)).trim() }; };
      // The working days asked for and the balance of the year, as the dates are typed
      const kinds = () => { const e = this.employee(UI.val('lvEmp', bg)), sel = $('#lvType', bg), cur = sel.value || r.type, l = this.leaveTypesFor(e || null); if (cur && !l.includes(cur)) l.unshift(cur); sel.innerHTML = l.map(t => '<option' + (t === cur ? ' selected' : '') + '>' + esc(t) + '</option>').join(''); };
      kinds(); $('#lvEmp', bg).addEventListener('change', kinds);
      const info = () => { const x = read(bg), e = this.employee(x.empId), n = x.from && x.to ? this.leaveCount(x) : 0, all = e ? this.leaveBalance(e, this.leaveYearEnd()) : null, b = all ? (all.types.find(t => t.name === x.type) || all) : null;
        // A half day is one day: the last day follows the first and is not typed
        const to = $('#lvTo', bg); to.disabled = !!x.half; if (x.half) to.value = $('#lvFrom', bg).value;
        $('#lvInfo', bg).innerHTML = (n ? '<b>' + (n === 0.5 ? 'Half a working day' : n + ' working day' + (n === 1 ? '' : 's')) + '</b>' : 'No working day in these dates') + (b && x.type !== 'Loss of pay' ? ' &middot; ' + esc(b.name || 'Paid leave') + ': <b>' + b.left + '</b> left of ' + b.accrued + ' earned so far (' + b.quota + ' a year, earned month by month)' + (x.type !== 'Loss of pay' && n > this.leaveRoom(Object.assign({}, r, x)) ? ' &middot; <span class="red">' + (n - (x.half ? 0 : Math.floor(this.leaveRoom(Object.assign({}, r, x))))) + ' more than the balance: those days go in as loss of pay</span>' : '') : ''); };
      ['lvEmp', 'lvType', 'lvHalf', 'lvFrom', 'lvTo'].forEach(id => $('#' + id, bg).addEventListener('change', info)); info();
    },

    // ------------------------------------------------------------ payroll
    screenPayroll(p) {
      const month = /^\d{4}-\d{2}$/.test(p.month || '') ? p.month : thisMonth(), s = this.settings(); let run = this.payroll(month);
      this.sweepExits();
      // A month that is not over is paid up to today: a draft worked out on an earlier day is brought up to date
      if (run && run.status !== 'final' && num(run.upto) !== this.cutoff(month) && month <= thisMonth() && Companies.mayWrite('payroll')) { const r = this.computeRun(month); if (Store.find('payroll', r.id)) { Store.update('payroll', r); run = r; } }
      const fin = !!run && run.status === 'final', rows = run ? run.rows : [], t = run ? run.totals : null, unapproved = rows.reduce((x, r) => x + num(r.unapproved), 0);
      const upto = run ? num(run.upto) : this.cutoff(month), part = upto > 0 && month === thisMonth() || (run && num(run.upto) > 0);
      const period = part ? '<div class="hint" style="margin-bottom:10px"><b>Pay period ' + esc(this.periodText(month, 1, upto)) + '.</b> ' + esc(monthLabel(month)) + (fin ? ' was finalised before it was over: the pay is for the days up to ' + esc(dateOf(month, upto)) + '.' : ' is not over yet, so the pay is worked out up to today (' + upto + ' of ' + daysIn(month) + ' days); it moves on by itself each day until the month is finalised.') + '</div>' : '';
      const root = App.view(App.header('Payroll', '<div class="btnrow" style="margin:0">' + UI.input('pyMonth', month, { type: 'month', attrs: ' style="min-height:36px;width:170px"' }) +
          (fin ? '<span class="pill ok">Finalised' + (run.finalisedAt ? ' ' + new Date(run.finalisedAt).toLocaleDateString('en-IN') : '') + '</span><button class="btn sm outline" id="pyReopen">Reopen</button>' : '<button class="btn sm" id="pyCompute">' + (run ? 'Recompute' : 'Compute payroll') + '</button>' + (run ? '<button class="btn sm green" id="pyFinal">Finalise &amp; post to books</button>' : '')) +
          (run ? '<button class="btn sm outline" id="pyStat">Statutory summary</button><button class="btn sm outline" id="pyBank">Bank advice</button><button class="btn sm outline" id="pyXls">Export Excel</button><button class="btn sm outline" id="pyAll">All payslips</button>' : '') + '</div>') +
        period + (unapproved ? '<div class="hint" style="margin-bottom:10px"><b class="red">' + unapproved + ' timesheet' + (unapproved === 1 ? '' : 's') + ' of this month ' + (unapproved === 1 ? 'is' : 'are') + ' not approved yet.</b></div>' : '') +
        (!run ? '<div class="empty">Not computed yet for ' + esc(monthLabel(month)) + '. Mark the attendance and the timesheets, then Compute payroll.</div>' :
          '<div class="tablewrap gs"><table class="list stmt"><thead><tr><th>Employee</th><th class="num">Paid days / hrs</th><th class="num">OT hrs</th><th class="num">Basic</th><th class="num">DA</th><th class="num">HRA</th><th class="num">Conv.</th><th class="num">Special</th><th class="num">Gross</th><th class="num">OT</th><th class="num">Reimb.</th><th class="num">PF</th><th class="num">ESI</th><th class="num">PT</th><th class="num">TDS</th><th class="num">Advance</th><th class="num">Other</th><th class="num">Net pay</th><th></th></tr></thead><tbody>' +
          rows.map((r, i) => '<tr data-i="' + i + '"><td class="left"><b>' + esc(r.name) + '</b><div class="small muted">' + esc(r.code) + (r.designation ? ' · ' + esc(r.designation) : '') + (r.payType === 'hourly' ? ' · ' + money(r.rate) + '/h' : '') + (r.unapproved ? ' · <span class="red">' + r.unapproved + ' week' + (r.unapproved === 1 ? '' : 's') + ' unapproved</span>' : '') + '</div></td><td class="num">' + (r.payType === 'hourly' ? r.hours + ' h' + (r.holidayHours ? '<div class="small muted">incl. ' + r.holidayHours + ' holiday</div>' : '') : r.paid + ' / ' + r.days + (r.to && (r.from > 1 || r.to < r.days) ? '<div class="small muted">' + pad(r.from) + ' to ' + pad(r.to) + ' ' + MONTHS[+month.split('-')[1] - 1].slice(0, 3) + '</div>' : '') + (r.lop ? '<div class="small muted">LOP ' + r.lop + '</div>' : '')) + '</td><td class="num">' + (r.otHours || '') + '</td><td class="num">' + money(r.basic) + (r.wagesAdded ? '<div class="small muted" title="HRA, conveyance and overtime above half the pay count as wages for PF and ESI">+' + money(r.wagesAdded) + ' as wages</div>' : '') + '</td><td class="num">' + money(r.da) + '</td><td class="num">' + money(r.hra) + '</td><td class="num">' + money(r.conv) + '</td><td class="num">' + money(r.special) + '</td><td class="num"><b>' + money(r.gross) + '</b></td><td class="num">' + money(r.ot) + '</td><td class="num">' + money(r.reimb) + '</td><td class="num">' + money(r.pfEmp) + '</td><td class="num">' + money(r.esiEmp) + '</td><td class="num">' + money(r.pt) + '</td><td class="num">' + money(r.tds) + '</td>' +
            '<td class="num">' + (fin ? money(r.advance) : '<input type="number" min="0" step="any" class="adv" value="' + (r.advance || '') + '" style="width:90px;min-height:32px;text-align:right">') + '</td><td class="num">' + (fin ? money(r.other) : '<input type="number" min="0" step="any" class="oth" value="' + (r.other || '') + '" style="width:90px;min-height:32px;text-align:right">') + '</td><td class="num"><b>' + money(r.net) + '</b></td><td class="actions"><button class="btn sm" data-slip="' + i + '">Payslip</button></td></tr>').join('') +
          '<tr class="total"><td class="left">Total (' + rows.length + ')</td><td></td><td></td><td class="num">' + money(rows.reduce((x, r) => x + r.basic, 0)) + '</td><td class="num">' + money(rows.reduce((x, r) => x + r.da, 0)) + '</td><td class="num">' + money(rows.reduce((x, r) => x + r.hra, 0)) + '</td><td class="num">' + money(rows.reduce((x, r) => x + r.conv, 0)) + '</td><td class="num">' + money(rows.reduce((x, r) => x + r.special, 0)) + '</td><td class="num">' + money(t.gross) + '</td><td class="num">' + money(t.ot) + '</td><td class="num">' + money(t.reimb) + '</td><td class="num">' + money(t.pfEmp) + '</td><td class="num">' + money(t.esiEmp) + '</td><td class="num">' + money(t.pt) + '</td><td class="num">' + money(t.tds) + '</td><td class="num">' + money(t.advance) + '</td><td class="num">' + money(t.other) + '</td><td class="num">' + money(t.net) + '</td><td></td></tr></tbody></table></div>' +
          '<div class="card white" style="margin-top:12px"><div class="hd">Employer cost for the month</div><div class="bd"><div class="kv">' + kv('Gross salaries + overtime', money(t.gross + t.ot)) + kv('Reimbursements', money(t.reimb)) + kv('Employer PF (EPF ' + money(t.epf) + ' + EPS ' + money(t.eps) + ')', money(t.pfEmployer)) + kv('EDLI + PF administration' + (num(t.pfAdminTopUp) > 0 ? ' (administration at the minimum of ' + money(t.pfAdmin) + ')' : ''), money(t.edli + t.pfAdmin)) + kv('Employer ESI', money(t.esiEmployer)) + kv('Total cost to company', money(t.gross + t.ot + t.reimb + t.pfEmployer + t.edli + t.pfAdmin + t.esiEmployer), 'tot') + kv('Net pay to employees', money(t.net), 'tot') + '</div></div></div>'));
      App.wireBack(root);
      $('#pyMonth').onchange = e => { if (e.target.value) App.go('payroll', { month: e.target.value }); };
      const saveRun = (r) => { if (Store.find('payroll', r.id)) Store.update('payroll', r); else Store.add('payroll', r); };
      if ($('#pyCompute')) $('#pyCompute').onclick = () => { if (!this.employees(true).length) return UI.toast('Add employees first'); if (month > thisMonth()) return UI.toast(monthLabel(month) + ' has not begun: there is nothing to pay yet', 5000); const r = this.computeRun(month); if (!r.rows.length) return UI.toast('No employee had joined by ' + monthLabel(month)); saveRun(r); UI.toast('Payroll computed for ' + r.rows.length + ' employee' + (r.rows.length === 1 ? '' : 's')); this.screenPayroll({ month }); };
      const manual = () => { $$('tr[data-i]', root).forEach(tr => { const r = run.rows[+tr.dataset.i]; r.advance = r2(num($('.adv', tr).value)); r.other = r2(num($('.oth', tr).value)); }); };
      // A typed advance or deduction is kept with the run first, so the recomputation picks it up
      if (!fin && run) { $$('input.adv, input.oth', root).forEach(inp => inp.onchange = () => { manual(); saveRun(run); const r = this.computeRun(month); saveRun(r); this.screenPayroll({ month }); }); }
      if ($('#pyFinal')) $('#pyFinal').onclick = () => UI.confirm('Finalise Payroll', 'Finalise ' + monthLabel(month) + ' for ' + run.rows.length + ' employees, net pay ' + money(run.totals.net) + '?' + (this.cutoff(month) ? ' The month is not over: this pays only the days up to ' + dateOf(month, this.cutoff(month)) + ', and the rest of the month would need the payroll reopened.' : '') + (unapproved ? ' ' + unapproved + ' timesheet' + (unapproved === 1 ? ' is' : 's are') + ' not approved yet.' : '') + ' A journal voucher is posted to the books (Salaries & Wages, Employer PF & ESI, Staff Reimbursements, PF / ESI / PT / TDS Payable, Salary Payable) and the month is locked. The salaries are then paid with a Payment voucher against Salary Payable.', () => {
        manual(); saveRun(run); const r = this.computeRun(month); r.status = 'final'; r.finalisedAt = Date.now(); r.voucherId = this.post(r); saveRun(r); UI.toast('Payroll finalised and posted'); this.screenPayroll({ month });
      }, 'Finalise');
      if ($('#pyReopen')) $('#pyReopen').onclick = () => UI.confirm('Reopen Payroll', 'Reopen ' + monthLabel(month) + '? The posted voucher is removed from the books until the month is finalised again.', () => { if (run.voucherId && Store.find('journal', run.voucherId)) Store.delete('journal', run.voucherId); run.status = 'draft'; delete run.voucherId; saveRun(run); UI.toast('Payroll reopened'); this.screenPayroll({ month }); }, 'Reopen');
      const REG = ['Code', 'Employee', 'Pay type', 'Days / hours', 'Paid days', 'LOP', 'OT hrs', 'Basic', 'DA', 'HRA', 'Conveyance', 'Special', 'Gross', 'Overtime', 'Reimbursements', 'PF wages', 'PF (employee)', 'ESI (employee)', 'PT', 'TDS', 'Advance', 'Other', 'Net pay', 'Employer EPF', 'Employer EPS', 'EDLI', 'PF admin', 'Employer ESI'];
      const reg = (r) => [r.code, r.name, r.payType, r.payType === 'hourly' ? r.hours : r.days, r.paid, r.lop, r.otHours, r.basic, r.da, r.hra, r.conv, r.special, r.gross, r.ot, r.reimb, r.pfWage, r.pfEmp, r.esiEmp, r.pt, r.tds, r.advance, r.other, r.net, r.epf, r.eps, r.edli, r.pfAdmin, r.esiEmployer];
      if ($('#pyXls')) $('#pyXls').onclick = () => UI.xls('Payroll_' + month, REG, rows.map(reg).concat([['', 'Total', '', '', '', '', '', rows.reduce((x, r) => x + r.basic, 0), rows.reduce((x, r) => x + r.da, 0), rows.reduce((x, r) => x + r.hra, 0), rows.reduce((x, r) => x + r.conv, 0), rows.reduce((x, r) => x + r.special, 0), t.gross, t.ot, t.reimb, rows.reduce((x, r) => x + r.pfWage, 0), t.pfEmp, t.esiEmp, t.pt, t.tds, t.advance, t.other, t.net, t.epf, t.eps, t.edli, t.pfAdmin, t.esiEmployer]]));
      if ($('#pyStat')) $('#pyStat').onclick = () => this.statutory(run);
      if ($('#pyBank')) $('#pyBank').onclick = () => { UI.download('BlitzBook_Bank_Advice_' + month + '.csv', UI.csv([['Employee', 'Code', 'Bank', 'Account number', 'IFSC', 'Net pay']].concat(rows.map(r => [r.name, r.code, r.bank, r.account, r.ifsc, r.net.toFixed(2)]))), 'text/csv'); UI.toast('Bank advice downloaded'); };
      $$('[data-slip]', root).forEach(b => b.onclick = () => this.payslip(run, run.rows[+b.dataset.slip]));
      if ($('#pyAll')) $('#pyAll').onclick = () => Print.show(this.payslipHtml(run, rows));
    },
    /* The payslip: the employee's details on top, earnings on the left and deductions on the right, the net pay and
       its amount in words at the foot. Several rows make one document with a page per employee. */
    payslipHtml(run, rowOrRows) {
      const co = Store.company(), rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      const slip = (r) => {
        const e = Store.find('employees', r.empId) || {}, hourly = r.payType === 'hourly';
        const earn = hourly ? [['Hours worked (' + r.hours + ' h at ' + money(r.rate) + ')', r.basic]] : [['Basic', r.basic], ['Dearness allowance', r.da], ['House rent allowance', r.hra], ['Conveyance', r.conv], ['Special / other allowance', r.special]];
        if (r.ot) earn.push(['Overtime (' + r.otHours + ' h)', r.ot]); if (r.reimb) earn.push(['Reimbursements', r.reimb]);
        const ded = [['Provident fund', r.pfEmp], ['ESI', r.esiEmp], ['Professional tax', r.pt], ['Income tax (TDS)', r.tds]]; if (r.advance) ded.push(['Advance recovered', r.advance]); if (r.other) ded.push(['Other deductions', r.other]);
        const n = Math.max(earn.length, ded.length), line = (a, i) => a[i] ? '<td>' + esc(a[i][0]) + '</td><td class="r">' + (num(a[i][1]) ? U.indianNumber(a[i][1]) : '') + '</td>' : '<td></td><td></td>';
        // Employee details: label / value pairs in three columns of one bordered block
        const details = [['Employee', r.name], ['Employee code', r.code], ['Designation', r.designation], ['Department', e.department], ['Date of joining', e.doj], ['Pay type', hourly ? 'Hourly, ' + money(r.rate) + ' per hour' : 'Monthly salary'],
          [hourly ? 'Hours paid' : 'Paid days', hourly ? r.hours + ' h (overtime ' + r.otHours + ' h)' : r.paid + ' of ' + r.days + (r.lop ? ', LOP ' + r.lop : '')], ['PAN', r.pan], ['UAN (PF)', r.uan], ['ESI number', r.esiNo], ['Bank', r.bank], ['Account / IFSC', [r.account, r.ifsc].filter(Boolean).join(' / ')]];
        const cell = (d) => '<td class="k">' + esc(d[0]) + '</td><td class="v">' + esc(d[1] || '-') + '</td>';
        const block = '<table class="grid emp"><tbody>' + Array.from({ length: Math.ceil(details.length / 3) }, (_, i) => '<tr>' + details.slice(i * 3, i * 3 + 3).map(cell).join('') + '</tr>').join('') + '</tbody></table>';
        return '<div class="doc std payslip"><style>.payslip .emp { margin-top: 8px; } .payslip .emp td { font-size: 8.5pt; padding: 4px 5px; border-color: #999; } .payslip .emp td.k { color: #444; font-weight: bold; width: 12%; background: #f2f2f2; white-space: nowrap; } .payslip .emp td.v { width: 21%; } .payslip .items td { font-size: 9pt; padding: 4px 5px; } .payslip .items tr.b td { font-weight: bold; background: #f7f7f7; } .payslip .items tr.tot td { font-size: 10.5pt; }</style><div class="part top">' + Print.head('PAYSLIP - ' + monthLabel(run.month).toUpperCase(), co, [['Month:', monthLabel(run.month), 1], ['Pay period:', this.periodText(run.month, r.from, r.to)], ['Pay date:', dateOf(run.month, num(run.upto) || daysIn(run.month))]]) + '</div>' + block +
          '<table class="grid items"><thead><tr><th style="width:32%">EARNINGS</th><th style="width:18%">AMOUNT (₹)</th><th style="width:32%">DEDUCTIONS</th><th style="width:18%">AMOUNT (₹)</th></tr></thead><tbody>' +
          Array.from({ length: n }, (_, i) => '<tr>' + line(earn, i) + line(ded, i) + '</tr>').join('') +
          '<tr class="b"><td>Total earnings</td><td class="r">' + U.indianNumber(r.gross + r.ot + r.reimb) + '</td><td>Total deductions</td><td class="r">' + (num(r.deductions) ? U.indianNumber(r.deductions) : '') + '</td></tr>' +
          '<tr class="tot b"><td colspan="3" class="r">NET PAY</td><td class="r">' + money(r.net) + '</td></tr></tbody></table>' +
          (r.pfEmployer || r.esiEmployer ? '<div class="sect" style="font-weight:normal">Employer contributions (not deducted): PF ' + money(r.pfEmployer) + ' (EPF ' + money(r.epf) + ' + EPS ' + money(r.eps) + ')' + (r.esiEmployer ? ', ESI ' + money(r.esiEmployer) : '') + (r.wagesAdded ? '. Wages for PF include ' + money(r.wagesAdded) + ' of allowances (Code on Social Security).' : '') + '</div>' : '') +
          '<div class="sect words">Net pay in words: ' + esc(U.rupeesPaiseWords(r.net)) + '</div>' +
          '<div class="note" style="font-weight:normal">This is a computer-generated payslip.</div>' + Print.signBlock(co) + Print.POWERED + '</div>';
      };
      return Print.page('Payslip ' + monthLabel(run.month), Print.PAPERS.A4.css, '12mm 10mm', rows.map(slip).join('<div style="page-break-after:always"></div>'));
    },
    payslip(run, r) { Print.show(this.payslipHtml(run, r)); },
    statutory(run) {
      const t = run.totals, rows = run.rows;
      const L = [['PROVIDENT FUND (ECR)', '', 2], ['Employees covered', String(rows.filter(r => r.pfWage > 0).length)]].concat(run.pfCeiling && isFinite(run.pfCeiling) ? [['Wage ceiling of the month', money(run.pfCeiling)]] : []).concat([['PF wages', money(rows.reduce((x, r) => x + r.pfWage, 0))], ['Employee share (A/c 1)', money(t.pfEmp)], ['Employer EPF (A/c 1)', money(t.epf)], ['Employer EPS (A/c 10)', money(t.eps)], ['EDLI (A/c 21)', money(t.edli)], ['Administration charges (A/c 2)' + (num(t.pfAdminTopUp) > 0 ? ', at the minimum' : ''), money(t.pfAdmin)], ['Total PF challan', money(t.pfEmp + t.pfEmployer + t.edli + t.pfAdmin), 1],
        ['ESI', '', 2], ['Employees covered', String(rows.filter(r => r.esiEmp > 0 || r.esiEmployer > 0).length)], ['ESI wages', money(rows.reduce((x, r) => x + num(r.esiWage), 0))], ['Employee share', money(t.esiEmp)], ['Employer share', money(t.esiEmployer)], ['Total ESI challan', money(t.esiEmp + t.esiEmployer), 1],
        ['PROFESSIONAL TAX (' + this.settings().ptState + ')', '', 2], ['Employees covered', String(rows.filter(r => r.pt > 0).length)], ['Total PT', money(t.pt), 1],
        ['TDS ON SALARIES (24Q)', '', 2], ['Total TDS', money(t.tds), 1]]);
      UI.modal({ title: 'Statutory summary - ' + monthLabel(run.month), wide: true, body: '<div class="kv">' + L.map(l => l[2] === 2 ? '<div class="h">' + esc(l[0]) + '</div>' : kv(esc(l[0]), esc(l[1]), l[2] === 1 ? 'tot' : '')).join('') + '</div>',
        buttons: [{ label: 'Close', cls: 'outline' }, { label: 'Export Excel', cls: 'green', onClick: () => { UI.xls('Statutory_' + run.month, ['Particulars', 'Amount'], L.filter(l => l[2] !== 2).map(l => [l[0], String(l[1]).replace('₹ ', '')])); return false; } },
          { label: 'PF ECR sheet', cls: 'outline', onClick: () => { UI.xls('PF_ECR_' + run.month, ['UAN', 'Member name', 'Gross wages', 'EPF wages', 'EPS wages', 'EDLI wages', 'EPF contribution (employee)', 'EPS contribution', 'EPF employer (diff)', 'NCP days'], rows.filter(r => r.pfWage > 0).map(r => [r.uan, r.name, r.gross + r.ot, r.pfWage, r.pfWage, r.pfWage, r.pfEmp, r.eps, r.epf, r.lop])); return false; } }] });
    },

    // ------------------------------------------------------------ settings
    screenSettings() {
      const s = this.settings();
      const root = App.view(App.header('HR Settings') +
        '<div class="card white"><div class="hd">Statutory rates and ceilings</div><div class="bd"><div class="hint" style="margin-bottom:10px">As in force in November 2026: the PF wage ceiling is 25,000 from 17 September 2026 (S.O. 5109(E)); ESI stays at 21,000 (25,000 for a person with a disability) at 0.75% + 3.25%; wages are as the Code on Social Security defines them. When a new notification comes, change the figure here.</div><div class="grid2">' +
        UI.field('PF rate (employee and employer) %', UI.input('sPfRate', s.pfRate, { type: 'number', attrs: ' step="any"' })) + UI.field('PF wage ceiling ₹', UI.input('sPfCeil', s.pfCeiling, { type: 'number' }), { hint: 'Contributions are on wages up to this. At 25,000 the months before the change keep theirs: 15,000 up to August 2026, 19,667 for September 2026' }) +
        UI.field('EPS share of the employer PF %', UI.input('sEps', s.epsRate, { type: 'number', attrs: ' step="any"' })) + UI.field('EDLI % / PF administration %', '<div class="inline">' + UI.input('sEdli', s.edliRate, { type: 'number', attrs: ' step="any"' }) + UI.input('sAdmin', s.pfAdmin, { type: 'number', attrs: ' step="any"' }) + '</div>') +
        UI.field('ESI employee % / employer %', '<div class="inline">' + UI.input('sEsiE', s.esiEmp, { type: 'number', attrs: ' step="any"' }) + UI.input('sEsiR', s.esiEmployer, { type: 'number', attrs: ' step="any"' }) + '</div>') + UI.field('ESI wage ceiling ₹ / for a person with a disability ₹', '<div class="inline">' + UI.input('sEsiCeil', s.esiCeiling, { type: 'number' }) + UI.input('sEsiPwd', s.esiCeilingPwd, { type: 'number' }) + '</div>', { hint: 'Employees with wages above this are outside ESI; one already covered stays in until the contribution period ends (September, March)' }) +
        UI.field('PF administration charges: minimum ₹ a month', UI.input('sAdminMin', s.pfAdminMin, { type: 'number' }), { hint: 'For the establishment, when the 0.5% comes to less' }) + UI.field('ESI: no employee share up to a daily wage of ₹', UI.input('sEsiDaily', s.esiDailyExempt, { type: 'number' }), { hint: 'The employer still pays its share' }) +
        UI.field('ESI is worked out on', UI.select('sEsiBasis', [['wages', 'Wages under the Code (HRA, conveyance and overtime left out)'], ['gross', 'Gross pay with overtime (the way before the Code)']], s.esiBasis), { span: true }) +
        UI.field('Professional tax: state', UI.select('sPt', Object.keys(PT), s.ptState)) + UI.field('Custom PT slabs', UI.input('sPtSlabs', s.ptSlabs, { placeholder: '15000:0, 20000:150, *:200' }), { hint: 'Used with "Custom slabs": upper limit of the monthly salary : tax, * for and above' }) +
        '</div></div></div>' +
        '<div class="card white"><div class="hd">Wages and HRA (Code on Wages)</div><div class="bd"><div class="grid2">' +
        UI.field('Wages floor: wages at least % of the pay', UI.input('sFloor', s.wagesFloor, { type: 'number', attrs: ' step="any"' }), { hint: 'Wages are basic + DA + the special allowance. The Codes require them to be 50% of the pay: HRA, conveyance and overtime above the other half count as wages for PF and ESI' }) +
        UI.field('HRA as % of basic (outside metros)', UI.input('sHra', s.hraPct, { type: 'number', attrs: ' step="any"' }), { hint: '40% outside and 50% in Delhi, Mumbai, Kolkata, Chennai (the income-tax exemption limits)' }) +
        '<div class="field">' + UI.check('sMetro', 'The company is in a metro city (new employees get HRA at 50%)', !!s.metro) + '</div>' +
        '</div></div></div>' +
        '<div class="card white"><div class="hd">Working time, shift, timesheets and leave</div><div class="bd"><div class="grid2">' +
        UI.field('Shift start', UI.input('sShStart', tm(s.shiftStart) || '09:30', { type: 'time' }), { hint: 'The company shift; an employee record can carry its own. The Web Clock shows how late each clock-in and how early each clock-out is against it' }) + UI.field('Shift end', UI.input('sShEnd', tm(s.shiftEnd) || '18:30', { type: 'time' })) +
        UI.field('Grace minutes', UI.input('sGrace', s.graceMin, { type: 'number', attrs: ' min="0" step="1"' }), { hint: 'A clock-in this many minutes after the shift start (or a clock-out this much before its end) does not count as late or early' }) +
        UI.field('Hours per working day', UI.input('sHours', s.hoursPerDay, { type: 'number', attrs: ' step="any"' })) + UI.field('Overtime multiplier (monthly salary)', UI.input('sOt', s.otMultiplier, { type: 'number', attrs: ' step="any"' }), { hint: 'Overtime pays gross / (26 x hours per day) x this per hour; twice the wages under the labour codes' }) +
        UI.field('Weekly hours before overtime (timesheets)', UI.input('sWeekly', s.weeklyHours, { type: 'number' })) + UI.field('Overtime multiplier (hourly, timesheets)', UI.input('sUsOt', s.usOtMultiplier, { type: 'number', attrs: ' step="any"' })) +
        UI.field('Weekly off', UI.select('sOff', [['0', 'Sunday'], ['6,0', 'Saturday and Sunday'], ['6', 'Saturday'], ['5', 'Friday'], ['', 'None']], String(s.weeklyOff))) + UI.field('Paid leave', '<button class="btn sm outline" id="sPolicy" type="button">Leave policy: ' + this.leavePolicy().staff.types.map(t => esc(t.name) + ' ' + t.days).join(', ') + '</button>', { hint: 'The kinds of leave, their days of a year and the rules are under HR > HR Policy; the days are earned month by month.' }) +
        '<div class="field">' + UI.check('sHolPaid', 'Hourly employees are paid for the holidays of the list (hours of a day)', s.holidayPaid !== false) + '</div>' +
        '<div class="field">' + UI.check('sAttClock', 'Mark attendance from the Web Clock: a working day with a clock-in is present, without one absent (employees who never clock in stay present)', s.attFromClock !== false) + '</div>' +
        '</div></div></div>' +
        '<div class="card white"><div class="hd">Holidays</div><div class="bd"><div id="sHol">' + ((s.holidays || []).length ? '<table class="list"><tbody>' + s.holidays.map((h, i) => '<tr><td>' + esc(h.date) + '</td><td class="left">' + esc(h.name) + '</td><td class="actions"><button class="btn sm red" data-hd="' + i + '">Remove</button></td></tr>').join('') + '</tbody></table>' : '<div class="hint">No holidays yet.</div>') + '</div>' +
        '<div class="btnrow" style="margin-top:8px">' + UI.input('sHolDate', '', { type: 'date', attrs: ' style="width:170px;min-height:36px"' }) + UI.input('sHolName', '', { placeholder: 'Holiday name', attrs: ' style="min-height:36px"' }) + '<button class="btn sm outline" id="sHolAdd">Add holiday</button></div></div></div>' +
        '<div class="card white"><div class="hd">Offer letter points</div><div class="bd"><textarea id="sOffer" style="min-height:200px">' + esc((Array.isArray(s.offerPoints) && s.offerPoints.length ? s.offerPoints : OFFER_POINTS).join('\n')) + '</textarea>' +
        '<div class="hint">The points printed under "Terms of employment" on every offer letter, one a line: change, add or remove them. Each employee\'s letter starts from these and can be changed for that employee on the Offer letter dialog. The words in braces are filled in from the employee: {name} {first_name} {designation} {department} {joining} {manager} {probation} {probation_notice} {notice} {hours} {leave} {gross} {ctc} {pay_basis} {company}.</div>' +
        '<div class="btnrow" style="margin-top:8px"><button class="btn sm outline" id="sOfferStd">Put the standard points back</button></div></div></div>' +
        '<div class="btnrow"><button class="btn green" id="sSave">Save settings</button></div>');
      App.wireBack(root);
      const collect = () => Object.assign({}, s, { pfRate: num(UI.val('sPfRate')), pfCeiling: num(UI.val('sPfCeil')), epsRate: num(UI.val('sEps')), edliRate: num(UI.val('sEdli')), pfAdmin: num(UI.val('sAdmin')), esiEmp: num(UI.val('sEsiE')), esiEmployer: num(UI.val('sEsiR')), esiCeiling: num(UI.val('sEsiCeil')), esiCeilingPwd: num(UI.val('sEsiPwd')), esiDailyExempt: num(UI.val('sEsiDaily')), esiBasis: UI.val('sEsiBasis'), pfAdminMin: num(UI.val('sAdminMin')), rules2026: true, ptState: UI.val('sPt'), ptSlabs: String(UI.val('sPtSlabs')).trim(),
        wagesFloor: num(UI.val('sFloor')), hraPct: num(UI.val('sHra')), metro: UI.val('sMetro'), hoursPerDay: num(UI.val('sHours')), otMultiplier: num(UI.val('sOt')), weeklyHours: num(UI.val('sWeekly')), usOtMultiplier: num(UI.val('sUsOt')), weeklyOff: UI.val('sOff'), holidayPaid: UI.val('sHolPaid'), shiftStart: tm(UI.val('sShStart')) || '09:30', shiftEnd: tm(UI.val('sShEnd')) || '18:30', graceMin: Math.max(0, num(UI.val('sGrace'))), attFromClock: UI.val('sAttClock'), offerPoints: String(UI.val('sOffer')).replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean) });
      $('#sPolicy').onclick = () => App.go('hrpolicy');
      $('#sOfferStd').onclick = () => { $('#sOffer').value = OFFER_POINTS.join('\n'); };
      $('#sSave').onclick = () => { this.saveSettings(collect()); UI.toast('HR settings saved'); };
      $('#sHolAdd').onclick = () => { const d = UI.dateVal('sHolDate'), nm = String(UI.val('sHolName')).trim(); if (!d || !nm) return UI.toast('Enter the date and the name'); const o = collect(); o.holidays = (o.holidays || []).concat([{ date: d, name: nm }]).sort((a, b) => U.dateMs(a.date) - U.dateMs(b.date)); this.saveSettings(o); this.screenSettings(); };
      $$('[data-hd]', root).forEach(b => b.onclick = () => { const o = collect(); o.holidays.splice(+b.dataset.hd, 1); this.saveSettings(o); this.screenSettings(); });
    },
    // ------------------------------------------------------------ web clock (clock in / out from the browser)
    /* One record per employee and day (the 'clock' collection, clk:<employee id>:<yyyy-mm-dd> on the server) holding
       the punches of the day, [{in, out, inBy, outBy}] in ms. An employee clocks in and out for themselves (the login
       whose mobile number or email is on their employee record; the server lets every member write their own
       record), the HR roles and the accountant for anyone. Clocking out an hourly employee puts the day's hours on
       the week's timesheet while it is not approved. The attendance grid shows the clocked hours of a day in the
       cell's tooltip; the monthly attendance itself is still marked there. */
    clockRec(empId, date) { return Store.list('clock').find(c => c.empId === empId && c.date === date) || null; },
    // Hours of a day's punches; an open punch counts up to now, or up to the cap (its stop moment) when one is given
    clockHours(rec, now, cap) { const t = now || Date.now(), end = cap ? Math.min(t, cap) : t; return rec && Array.isArray(rec.punches) ? rec.punches.reduce((s, p) => s + Math.max(0, (p.out || end) - p.in) / 3600000, 0) : 0; },
    /* A punch never clocked out stops counting by itself: at the shift end of that day, or hours-per-day after a
       clock-in that came after the shift end. Past that moment the day is "not clocked out" (an icon on the Web
       Clock and the attendance grid) until one of the HR roles sets the clock-out. */
    stopAt(emp, date, inMs) { const w = this.shiftMs(this.shiftOf(emp), date); return inMs < w.end ? w.end : inMs + Math.max(1, num(this.settings().hoursPerDay) || 8) * 3600000; },
    clockHoursOn(empId, date) { const r = this.clockRec(empId, date); return r ? Math.round(this.clockHours(r) * 100) / 100 : 0; },
    clockOpen(rec) { return !!(rec && Array.isArray(rec.punches) && rec.punches.length && !rec.punches[rec.punches.length - 1].out); },
    clockRole() { return ['owner', 'admin', 'manager', 'hr', 'accountant'].includes(Companies.role()); },
    /* The shift an employee works: the times on the employee record, else the company shift of HR Settings, with
       the grace minutes. dayClock measures one day against it: the first clock-in and the last clock-out, the
       hours, the minutes late at clock-in and early at clock-out (0 when within the shift), flagged when beyond the
       grace. A shift that ends at or before its start runs over midnight. clockMonth adds the days of a month up. */
    shiftOf(emp) { const s = this.settings(); return { start: tm(emp && emp.shiftStart) || tm(s.shiftStart) || '09:30', end: tm(emp && emp.shiftEnd) || tm(s.shiftEnd) || '18:30', grace: Math.max(0, num(s.graceMin)) }; },
    shiftMs(sh, date) { const base = fromIso(date).getTime(), at = (t) => { const [h, m] = t.split(':').map(Number); return base + (h * 60 + m) * 60000; }; let start = at(sh.start), end = at(sh.end); if (end <= start) end += 86400000; return { start, end }; },
    dayClock(emp, date, now) {
      const rec = this.clockRec(emp.id, date), ps = rec && Array.isArray(rec.punches) ? rec.punches.filter(p => p.in) : [], sh = this.shiftOf(emp), w = this.shiftMs(sh, date), t = now || Date.now();
      const open = this.clockOpen(rec), first = ps.length ? ps[0].in : null, last = ps.length && !open ? ps[ps.length - 1].out : null;
      // An open punch counts up to its stop moment only; past it the day is "not clocked out" until a clock-out is set
      const cap = open ? this.stopAt(emp, date, ps[ps.length - 1].in) : null, missed = !!cap && t > cap;
      const late = first ? Math.max(0, Math.round((first - w.start) / 60000)) : 0, early = last ? Math.max(0, Math.round((w.end - last) / 60000)) : 0;
      return { rec, shift: sh, first, last, open, cap, missed, punched: ps.length > 0, hours: ps.length ? this.clockHours(rec, t, cap) : 0, late, early, isLate: late > sh.grace, isEarly: early > sh.grace };
    },
    clockMonth(emp, month, now) {
      const out = { days: 0, hours: 0, lateDays: 0, lateMin: 0, earlyDays: 0, earlyMin: 0, missed: 0, rows: [] }, today = this.todayIso(), hol = this.holidayMap();
      for (let d = 1; d <= daysIn(month); d++) {
        const date = month + '-' + pad(d); if (date > today) break;
        const dc = this.dayClock(emp, date, now), working = !hol.has(dateOf(month, d)) && !this.isOff(fromIso(date));
        if (dc.punched) { out.days++; out.hours += dc.hours; if (dc.missed) out.missed++; if (dc.isLate) { out.lateDays++; out.lateMin += dc.late; } if (dc.isEarly) { out.earlyDays++; out.earlyMin += dc.early; } }
        if (dc.punched || working) out.rows.push(Object.assign({ date, d, working }, dc));
      }
      return out;
    },
    punch(emp, dir) {
      if (!emp) return;
      const now = Date.now(), date = iso(new Date(now)), by = (App.user && App.user.name) || Companies.roleLabel();
      let rec = this.clockRec(emp.id, date);
      if (!rec) rec = { id: emp.id + ':' + date, empId: emp.id, date, punches: [] };
      rec.punches = Array.isArray(rec.punches) ? rec.punches : [];
      let stopped = false;
      if (dir === 'in') { if (this.clockOpen(rec)) return UI.toast(emp.name + ' is already clocked in'); rec.punches.push({ in: now, inBy: by }); }
      else {
        if (!this.clockOpen(rec)) return UI.toast(emp.name + ' is not clocked in');
        // A clock-out after the stop moment closes the punch at that moment: the hours stopped counting there
        const p = rec.punches[rec.punches.length - 1], before = this.dayClock(emp, date, now); stopped = before.missed;
        p.out = stopped ? before.cap : now; p.outBy = by;
      }
      if (Store.find('clock', rec.id)) Store.update('clock', rec); else Store.add('clock', rec);
      const hours = this.clockHours(rec, now);
      if (dir === 'out') this.afterOut(emp, rec);
      const dc = this.dayClock(emp, date, now);
      UI.toast(dir === 'in' ? emp.name + ' clocked in at ' + hhmm(now) + (dc.isLate && dc.first === now ? ' · ' + fmtMin(dc.late) + ' late for the ' + dc.shift.start + ' shift' : '') : emp.name + ' clocked out at ' + hhmm(dc.last) + (stopped ? ' (the hours stopped there)' : '') + ' · ' + fmtHours(hours) + ' today' + (dc.isEarly ? ' · ' + fmtMin(dc.early) + ' before the shift ends at ' + dc.shift.end : ''), 5000);
    },
    // After a clock-out (or a clock-out set by HR): an hourly employee's day goes on the week's timesheet while the
    // sheet is not approved and the month not finalised
    afterOut(emp, rec) {
      const run = this.payroll(rec.date.slice(0, 7));
      if (!this.hourly(emp) || !Companies.mayWrite('timesheets') || (run && run.status === 'final')) return;
      const d = fromIso(rec.date), week = mondayOf(d), di = (d.getDay() + 6) % 7, h = Math.round(this.clockHours(rec) * 4) / 4;
      let t = this.timesheet(emp.id, week);
      if (!t) t = { id: emp.id + ':' + week, empId: emp.id, week, hours: {}, approved: false };
      if (t.approved) return;
      t.hours = t.hours || {}; if (h > 0) t.hours[di] = h; else delete t.hours[di];
      if (Store.find('timesheets', t.id)) Store.update('timesheets', t); else Store.add('timesheets', t);
    },
    // One of the HR roles sets the clock-out of a day that was never clocked out
    fixOut(emp, date, done) {
      const dc = this.dayClock(emp, date), rec = dc.rec; if (!dc.open) return;
      const p = rec.punches[rec.punches.length - 1], base = fromIso(date).getTime();
      return UI.modal({ title: 'Set clock-out · ' + emp.name, body: '<p>' + esc(dmy(fromIso(date))) + ': clocked in at <b>' + hhmm(p.in) + '</b>, never clocked out. The hours stopped at <b>' + hhmm(dc.cap) + '</b>.</p>' + UI.field('Clocked out at', UI.input('fxOut', hhmm(dc.cap), { type: 'time' })),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const t = tm(UI.val('fxOut', bg)); if (!t) { UI.toast('Enter the time'); return false; }
          const [h, m] = t.split(':').map(Number); let out = base + (h * 60 + m) * 60000; if (out <= p.in) out += 86400000;
          p.out = out; p.outBy = ((App.user && App.user.name) || Companies.roleLabel()) + ' (set)'; p.fixed = true;
          Store.update('clock', rec); this.afterOut(emp, rec);
          UI.toast(emp.name + ': clock-out set at ' + hhmm(out) + ' · ' + fmtHours(this.clockHours(rec)), 4000);
          if (done) done();
        } }] });
    },
    screenClock(p) {
      const month = /^\d{4}-\d{2}$/.test(p.month || '') ? p.month : thisMonth(), today = iso(new Date()), now = Date.now();
      const me = this.myEmployee(), hrRole = this.clockRole(), all = this.employees();
      const emps = hrRole ? all : all.filter(e => me && e.id === me.id);
      const mine = me ? this.clockRec(me.id, today) : null, open = this.clockOpen(mine), last = mine && mine.punches && mine.punches.length ? mine.punches[mine.punches.length - 1] : null, myDay = me ? this.dayClock(me, today, now) : null;
      const lateTxt = (dc) => dc.isLate ? ' · ' + fmtMin(dc.late) + ' late' : dc.first ? ' · on time' : '', earlyTxt = (dc) => dc.isEarly ? ' · left ' + fmtMin(dc.early) + ' early' : '';
      const youCard = me
        ? '<div class="wc-you' + (open ? ' in' : '') + '"><div><div class="wc-name">' + esc(me.name) + '</div><div class="wc-state">Shift ' + esc(myDay.shift.start) + ' – ' + esc(myDay.shift.end) + '</div><div class="wc-state">' + (open ? 'Clocked in at ' + hhmm(last.in) + lateTxt(myDay) + ' · <b id="wcSoFar">' + fmtHours(myDay.hours) + '</b>' + (myDay.missed ? ' · <b>⚠ stopped at ' + hhmm(myDay.cap) + ', not clocked out</b>' : ' so far') : last ? 'Clocked in at ' + hhmm(mine.punches[0].in) + lateTxt(myDay) + ' · out at ' + hhmm(last.out) + earlyTxt(myDay) + ' · ' + fmtHours(this.clockHours(mine, now)) + ' today' : 'Not clocked in yet today') + '</div></div>' +
          '<div class="btnrow" style="margin:0">' + (open ? '<button class="btn red" id="wcOut">Clock out</button>' : '<button class="btn green" id="wcIn">Clock in</button>') + '</div></div>'
        : '<div class="wc-you"><div class="wc-state">To clock in for yourself, the mobile number or email of your login has to be on your employee record (Employees &gt; Edit).' + (hrRole ? ' You can clock the employees below in and out.' : '') + '</div></div>';
      const days = daysIn(month), monthRows = emps.map(e => Object.assign({ e }, this.clockMonth(e, month, now)));
      const lateCell = (dc) => !dc.first ? '-' : dc.late ? '<span class="' + (dc.isLate ? 'red' : 'muted') + '">' + fmtMin(dc.late) + '</span>' : '<span class="green">On time</span>';
      const earlyCell = (dc) => !dc.last ? '-' : dc.early ? '<span class="' + (dc.isEarly ? 'red' : 'muted') + '">' + fmtMin(dc.early) + '</span>' : '<span class="green">Full shift</span>';
      // The day-by-day table of the month: one employee at a time (the viewer's own record for an employee login)
      const dayEmp = (hrRole && this.employee(p.emp)) || (me && emps.find(e => e.id === me.id)) || emps[0] || null, dayRows = dayEmp ? this.clockMonth(dayEmp, month, now).rows : [];
      const root = App.view(App.header('Web Clock', '<div class="btnrow" style="margin:0">' + UI.input('wcMonth', month, { type: 'month', attrs: ' style="min-height:36px;width:170px"' }) + (hrRole ? '<button class="btn sm outline" id="wcAtt">Attendance</button><button class="btn sm outline" id="wcTs">Timesheets</button>' : '') + '<button class="btn sm green" id="wcXls">Export Excel</button></div>') +
        '<div class="wc-hero"><div><div class="wc-day">' + esc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</div><div class="wc-time" id="wcTime">' + hhmm(now) + '</div></div>' + youCard + '</div>' +
        
        (emps.length ? '<div class="card white"><div class="hd">Today</div><div class="bd"><div class="tablewrap"><table class="list"><thead><tr><th class="left">Employee</th><th>Shift</th><th>In</th><th>Late by</th><th>Out</th><th>Early by</th><th class="num">Hours</th><th>Status</th>' + (hrRole ? '<th></th>' : '') + '</tr></thead><tbody>' +
          emps.map(e => { const dc = this.dayClock(e, today, now), r = dc.rec, o = dc.open, ps = (r && r.punches) || [];
            return '<tr><td class="left"><b>' + esc(e.name) + '</b><div class="small muted">' + esc(e.code || '') + (this.hourly(e) ? ' · hourly' : '') + '</div></td><td class="small">' + esc(dc.shift.start) + ' – ' + esc(dc.shift.end) + '</td><td>' + (dc.first ? hhmm(dc.first) : '-') + '</td><td>' + lateCell(dc) + '</td><td>' + (dc.last ? hhmm(dc.last) : '-') + '</td><td>' + earlyCell(dc) + '</td><td class="num">' + (ps.length ? fmtHours(dc.hours) : '-') + '</td>' +
              '<td>' + (o ? (dc.missed ? '<span class="pill bad" title="Never clocked out: the hours stopped at ' + hhmm(dc.cap) + '">⚠ Not clocked out</span>' : '<span class="pill ok">Clocked in</span>') : ps.length ? '<span class="pill">Clocked out</span>' : '<span class="pill warn">Not in</span>') + (dc.isLate ? ' <span class="pill bad">Late</span>' : '') + (dc.isEarly ? ' <span class="pill bad">Left early</span>' : '') + '</td>' + (hrRole ? '<td class="actions">' + (o ? (dc.missed ? '<button class="btn sm blue" data-fix="' + esc(e.id) + '" data-date="' + today + '">Set clock-out</button>' : '<button class="btn sm red outline" data-out="' + esc(e.id) + '">Clock out</button>') : '<button class="btn sm outline" data-in="' + esc(e.id) + '">Clock in</button>') + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div></div></div>' +
          '<div class="card white"><div class="hd">' + esc(monthLabel(month)) + '</div><div class="bd"><div class="tablewrap"><table class="list"><thead><tr><th class="left">Employee</th><th>Shift</th><th class="num">Days clocked</th><th class="num">Hours</th><th class="num">Average a day</th><th class="num">Late days</th><th class="num">Late in all</th><th class="num">Left early</th><th class="num">Early in all</th><th class="num">Not clocked out</th></tr></thead><tbody>' +
          monthRows.map(x => { const sh = this.shiftOf(x.e); return '<tr><td class="left"><b>' + esc(x.e.name) + '</b></td><td class="small">' + esc(sh.start) + ' – ' + esc(sh.end) + '</td><td class="num">' + x.days + '</td><td class="num">' + fmtHours(x.hours) + '</td><td class="num">' + (x.days ? fmtHours(x.hours / x.days) : '-') + '</td><td class="num' + (x.lateDays ? ' red' : '') + '">' + x.lateDays + '</td><td class="num' + (x.lateMin ? ' red' : '') + '">' + (x.lateMin ? fmtMin(x.lateMin) : '-') + '</td><td class="num' + (x.earlyDays ? ' red' : '') + '">' + x.earlyDays + '</td><td class="num' + (x.earlyMin ? ' red' : '') + '">' + (x.earlyMin ? fmtMin(x.earlyMin) : '-') + '</td><td class="num' + (x.missed ? ' red' : '') + '">' + (x.missed ? '⚠ ' + x.missed : '-') + '</td></tr>'; }).join('') + '</tbody></table></div></div></div>' +
          (dayEmp ? '<div class="card white"><div class="hd">Day by day · ' + esc(monthLabel(month)) + (hrRole && emps.length > 1 ? ' <span style="float:right;font-weight:400">' + UI.select('wcEmp', emps.map(e => [e.id, e.name]), dayEmp.id, { attrs: ' style="min-height:32px"' }) + '</span>' : ' · ' + esc(dayEmp.name)) + '</div><div class="bd">' +
            (dayRows.length ? '<div class="tablewrap"><table class="list"><thead><tr><th class="left">Date</th><th>Shift</th><th>In</th><th>Late by</th><th>Out</th><th>Early by</th><th class="num">Hours</th></tr></thead><tbody>' +
              dayRows.map(r => '<tr><td class="left">' + dateOf(month, r.d) + ' <span class="small muted">' + DAY_NAMES[(weekday(month, r.d) + 6) % 7] + '</span></td><td class="small">' + esc(r.shift.start) + ' – ' + esc(r.shift.end) + '</td>' + (r.punched ? '<td>' + hhmm(r.first) + '</td><td>' + lateCell(r) + '</td><td>' + (r.last ? hhmm(r.last) : r.open ? (r.missed ? '<span class="pill bad">⚠ Not clocked out</span>' + (hrRole ? ' <button class="btn sm blue" data-fix="' + esc(dayEmp.id) + '" data-date="' + r.date + '">Set</button>' : '') : '<span class="pill ok">In</span>') : '-') + '</td><td>' + earlyCell(r) + '</td><td class="num">' + fmtHours(r.hours) + '</td>' : '<td colspan="5" class="muted">No clock-in</td>') + '</tr>').join('') + '</tbody></table></div>' : '<div class="hint">No working days yet this month.</div>') + '</div></div>' : '')
        : '<div class="empty">Add employees first.</div>'));
      App.wireBack(root);
      $('#wcMonth').onchange = e => { if (e.target.value) App.go('clock', { month: e.target.value, emp: p.emp }); };
      if ($('#wcEmp')) $('#wcEmp').onchange = e => App.go('clock', { month, emp: e.target.value });
      if ($('#wcAtt')) $('#wcAtt').onclick = () => App.go('attendance', { month });
      if ($('#wcTs')) $('#wcTs').onclick = () => App.go('timesheets');
      if ($('#wcIn')) $('#wcIn').onclick = () => { this.punch(me, 'in'); this.screenClock(p); };
      if ($('#wcOut')) $('#wcOut').onclick = () => { this.punch(me, 'out'); this.screenClock(p); };
      $$('[data-in]', root).forEach(b => b.onclick = () => { this.punch(this.employee(b.dataset.in), 'in'); this.screenClock(p); });
      $$('[data-out]', root).forEach(b => b.onclick = () => { this.punch(this.employee(b.dataset.out), 'out'); this.screenClock(p); });
      $$('[data-fix]', root).forEach(b => b.onclick = () => this.fixOut(this.employee(b.dataset.fix), b.dataset.date, () => this.screenClock(p)));
      // The time and the running hours tick while the screen is open; the hours stop at the stop moment
      clearInterval(this.clockTimer);
      this.clockTimer = setInterval(() => { const el = document.getElementById('wcTime'); if (!el) { clearInterval(this.clockTimer); return; } el.textContent = hhmm(Date.now()); const sf = document.getElementById('wcSoFar'); if (sf && mine) { const t = Date.now(); sf.textContent = fmtHours(this.clockHours(mine, t, myDay.cap)); if (myDay.cap && t > myDay.cap && !myDay.missed) this.screenClock(p); } }, 15000);
      $('#wcXls').onclick = () => {
        const rows = [];
        emps.forEach(e => { for (let d = 1; d <= days; d++) { const dc = this.dayClock(e, month + '-' + pad(d), now), r = dc.rec; if (!r || !r.punches) continue; r.punches.forEach((q, i) => rows.push([dateOf(month, d), e.code, e.name, dc.shift.start + ' - ' + dc.shift.end, hhmm(q.in), q.out ? hhmm(q.out) : '', q.out ? Math.round((q.out - q.in) / 36000) / 100 : '', i === 0 ? dc.late : '', i === r.punches.length - 1 && q.out ? dc.early : '', q.inBy || '', q.outBy || ''])); } });
        UI.xls('Web_Clock_' + month, ['Date', 'Code', 'Employee', 'Shift', 'In', 'Out', 'Hours', 'Late by (min)', 'Early by (min)', 'Clocked in by', 'Clocked out by'], rows);
      };
    },
    PT, DEFAULTS, LEAVE_POLICY, STATUS, RB_CATS, monthLabel, daysIn, dateOf, mondayOf, iso
  };
  const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const fmtHours = (h) => { const m = Math.round(h * 60); return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm'; };
  const kv = (k, v, cls) => '<div class="' + (cls || '') + '">' + k + '</div><div class="v ' + (cls || '') + '">' + v + '</div>';

  // Every HR screen is behind the Full access plan: without it the lock shows and the dashboard stays
  const gated = (fn) => (p) => { if (!HR.allowed()) { if (!App.current || App.current.route === 'dashboard') App.routes.dashboard({}); HR.lock(); return; } fn(p); };
  App.routes.employees = gated((p) => HR.screenEmployees(p || {}));
  App.routes.attendance = gated((p) => HR.screenAttendance(p || {}));
  App.routes.clock = gated((p) => HR.screenClock(p || {}));
  App.routes.timesheets = gated((p) => HR.screenTimesheets(p || {}));
  App.routes.reimbursements = gated((p) => HR.screenReimbursements(p || {}));
  // Leave is every member's: one's own leave opens whatever the licence of the login is
  App.routes.leave = (p) => (HR.allowed() || Store.cid ? HR.screenLeave(p || {}) : gated(() => 0)(p));
  App.routes.payroll = gated((p) => HR.screenPayroll(p || {}));
  App.routes.hrsettings = gated(() => HR.screenSettings());
  // The policy is everyone's to read
  App.routes.hrpolicy = (p) => (HR.allowed() || Store.cid ? HR.screenPolicy(p || {}) : gated(() => 0)(p));
  global.HR = HR;
})(window);
