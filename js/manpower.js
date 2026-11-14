/* BlitzBook web portal - Manpower: the roster of a manpower and staffing agency (a Services company of the type
   Manpower and Staffing Services, Company Profile). Such a company has little or no stock; what it keeps is people.
   The Manpower tab holds every member the agency can send out, for reference: who they are, what they can do, where
   they are deployed, what they are paid and billed at, and which of their papers are due.

   A member is not an employee under HR: the HR attendance and payroll are not run from here. The roster has an
   attendance of its own (the Attendance tab) and a sheet of the days worked and the pay of each month. Members on the agency's own payroll
   can be copied over from HR > Employees (From Employees) and are then kept in step by hand.

   What a member carries, and where the list of fields comes from:
     Identity     code (MP001 ...), name, gender, date of birth, father's / spouse's name, mobile, address, emergency
                  contact: the columns of the register of workmen a contractor keeps (Form XIII, Contract Labour
                  Central Rules, rule 75: name, sex, father's / husband's name, designation, address, commencement and
                  termination of employment)
     Skill set    trade / designation, the skill category of the minimum wages notifications (Unskilled, Semi-skilled,
                  Skilled, Highly skilled), skills as tags, experience, education, languages, certificates and
                  licences with their numbers and validity: the education / occupation / skill type of e-Shram and the
                  skills and qualifications of a staffing system's candidate record (Bullhorn, Zoho Recruit)
     Engagement   on our rolls / contract / daily wage / through a sub-contractor, joined on, engagement ends
     Deployment   status (Available, Deployed, On leave, Inactive), the client and the site, since when, till when,
                  the shift; every deployment that ended stays as history. Availability and the job a temp is on are
                  what Zoho Workerly schedules by
     Rates        pay rate (what the member gets) and bill rate (what the client is charged) per day, hour or month,
                  and the overtime rate per hour: Workerly's base pay rate and job rate. The invoice's staff sheet
                  takes the bill rate, the unit and the overtime rate from here (invoice.js staffKnown, pickStaff)
     Papers       Aadhaar, PAN, UAN, ESI number, bank account; police verification (status, valid till), medical
                  fitness (valid till); the Papers tab lists what is missing and what runs out in the next 60 days

   Tabs: Members (the list, search, filters, upload / export), Deployment (who is where, client by client, and the
   bench), Skills (how many people of each skill and category, free or deployed), Papers (missing and expiring),
   Attendance (the month as a grid, a mark a day for each member: present, absent, half day, weekly off, holiday,
   leave; kept on the member as att['YYYY-MM']), Days Worked (the month's days, overtime and advance of each member, kept on the member as work['YYYY-MM']) and
   Reports (wage register, days worked, man-days by client, month by month, strength, clients and billing, margin,
   bench, movements, billed): both in modreports.js.

   Kept in the 'manpower' collection (mpw:<id> on the server), portal to portal like procure and inventory: the app
   leaves the prefix alone. The owner, an admin and an accountant change it, a viewer reads it; the HR roles, sales
   and employee logins do not open it (the server gives the HR roles nothing but the HR records). */
(function (global) {
  'use strict';
  const { esc, num, money } = U;
  const td = (l, v, c) => Ledger.td(l, v, c);
  const CATS = ['Unskilled', 'Semi-skilled', 'Skilled', 'Highly skilled'];
  const ENGAGE = ['On our rolls', 'Contract', 'Daily wage', 'Through a sub-contractor', 'Freelance'];
  const STATUS = [['available', 'Available'], ['deployed', 'Deployed'], ['leave', 'On leave'], ['inactive', 'Inactive']];
  const STATUS_PILL = { available: 'ok', deployed: '', leave: 'warn', inactive: 'bad' };
  const UNITS = [['DAY', 'Day'], ['HRS', 'Hour'], ['MON', 'Month']];
  const PV = ['Not done', 'Applied', 'Verified'];
  const TABS = [['members', 'Members'], ['deploy', 'Deployment'], ['skills', 'Skills'], ['papers', 'Papers'], ['att', 'Attendance'], ['work', 'Days Worked'], ['reports', 'Reports']];
  // Trades and skills offered while typing (anything else can be typed)
  const TRADES = ['Security Guard', 'Security Supervisor', 'Gunman', 'Housekeeping', 'Housekeeping Supervisor', 'Helper', 'Loader', 'Packer', 'Driver', 'Electrician', 'Plumber', 'Carpenter', 'Welder', 'Fitter', 'Mason', 'Painter', 'AC Technician',
    'Machine Operator', 'Forklift Operator', 'Data Entry Operator', 'Office Assistant', 'Receptionist', 'Cook', 'Gardener', 'Caretaker', 'Nurse', 'Site Supervisor', 'Storekeeper', 'Delivery Executive', 'Lift Operator'];
  const SOON_DAYS = 60;
  // The upload: the template's columns and the headings accepted for each field (letters only, lower case)
  const COLUMNS = ['Code', 'Name', 'Gender', 'Date of birth', 'Father / spouse', 'Phone', 'Trade', 'Category', 'Skills', 'Experience (years)', 'Education', 'Languages', 'Engagement', 'Joined', 'Status', 'Client', 'Site', 'Deployed from', 'Deployed till', 'Shift', 'Pay rate', 'Bill rate', 'Per', 'OT rate',
    'Aadhaar', 'PAN', 'UAN', 'ESI No', 'Bank', 'Account', 'IFSC', 'Police verification', 'Police verification till', 'Medical till', 'Engagement ends', 'Address', 'Emergency contact', 'Notes'];
  const HEADS = { code: ['code', 'membercode', 'empcode', 'employeeid', 'id'], name: ['name', 'fullname', 'member', 'membername'], gender: ['gender', 'sex'], dob: ['dateofbirth', 'dob', 'birthdate'], father: ['fatherspouse', 'father', 'fathersname', 'fathername', 'spouse', 'husband', 'fatherhusband'],
    phone: ['phone', 'mobile', 'mobilenumber', 'phonenumber'], trade: ['trade', 'designation', 'role', 'title', 'natureofemployment'], category: ['category', 'skillcategory', 'skilllevel'], skills: ['skills', 'skillset', 'skill'], experience: ['experienceyears', 'experience', 'exp', 'years'],
    education: ['education', 'qualification'], languages: ['languages', 'language'], engagement: ['engagement', 'engagementtype', 'type'], doj: ['joined', 'dateofjoining', 'doj', 'joiningdate', 'dateofcommencement'], status: ['status', 'availability'],
    client: ['client', 'customer', 'deployedat', 'principalemployer'], site: ['site', 'location', 'worksite'], from: ['deployedfrom', 'since', 'deployedsince'], till: ['deployedtill', 'till', 'deployedupto'], shift: ['shift'],
    payRate: ['payrate', 'pay', 'wage', 'wages'], billRate: ['billrate', 'bill', 'billingrate', 'rate'], unit: ['per', 'unit', 'rateper'], otRate: ['otrate', 'overtimerate'],
    aadhaar: ['aadhaar', 'aadhar'], pan: ['pan'], uan: ['uan', 'pfuan'], esiNo: ['esino', 'esinumber', 'ipnumber'], bankName: ['bank', 'bankname'], bankAccount: ['account', 'accountnumber', 'accountno', 'bankaccount'], bankIfsc: ['ifsc', 'ifsccode'],
    pv: ['policeverification', 'pv'], pvTill: ['policeverificationtill', 'pvtill', 'policeverificationvalidtill'], medicalTill: ['medicaltill', 'medical', 'medicalvalidtill'], endsOn: ['engagementends', 'contractends', 'contracttill'], address: ['address', 'permanentaddress'], emergency: ['emergencycontact', 'emergency'], notes: ['notes', 'remarks'] };
  const SAMPLE = [['MP001', 'Ravi Kumar', 'Male', '12/05/1994', 'Narayana Rao', '9876543210', 'Security Guard', 'Semi-skilled', 'Access control, CCTV monitoring, Fire safety', '6', '10th', 'Telugu, Hindi', 'On our rolls', '01/04/2026', 'Deployed', 'Apex Towers Pvt Ltd', 'Guntur', '01/10/2026', '', 'Night', '650', '800', 'Day', '120',
    '', '', '100123456789', '', 'SBI', '30012345678', 'SBIN0001234', 'Verified', '30/09/2027', '31/03/2027', '', '12 MG Road Vijayawada', 'Sita 9123456780', ''],
  ['MP002', 'Lakshmi Devi', 'Female', '', '', '9123456789', 'Housekeeping', 'Unskilled', 'Floor care, Pantry', '3', '', 'Telugu', 'Contract', '15/06/2026', 'Available', '', '', '', '', '', '500', '620', 'Day', '',
    '', '', '', '', '', '', '', 'Applied', '', '', '31/03/2027', '', '', '']];

  const lower = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const list = () => Store.list('manpower');
  const mayW = () => Companies.mayWrite('manpower');
  const statusOf = (m) => STATUS.some(s => s[0] === m.status) ? m.status : 'available';
  const statusName = (k) => (STATUS.find(s => s[0] === k) || STATUS[0])[1];
  const skillsOf = (m) => (Array.isArray(m.skills) ? m.skills : String(m.skills || '').split(/[,;\n]/)).map(s => String(s).trim()).filter(Boolean);
  const unitName = (u) => (UNITS.find(x => x[0] === u) || UNITS[0])[1].toLowerCase();
  const unitOf = (v) => { const t = lower(v); return /^(hr|hour)/.test(t) ? 'HRS' : /^mon/.test(t) ? 'MON' : 'DAY'; };
  const todayMs = () => U.dateMs(U.today());
  const daysTo = (date) => { const ms = U.dateMs(date); return ms ? Math.round((ms - todayMs()) / 86400000) : null; };
  const customers = () => Store.list('contacts').filter(c => (c.type || 'Customer') !== 'Supplier').map(c => String(c.name || '').split('\n')[0].trim()).filter(Boolean);
  const blank = () => ({ code: '', name: '', gender: '', dob: '', father: '', phone: '', address: '', emergency: '', trade: '', category: '', skills: [], experience: '', education: '', languages: '', certs: [], engagement: ENGAGE[0], doj: U.today(), endsOn: '',
    status: 'available', deploy: { client: '', site: '', from: '', till: '', shift: '' }, history: [], payRate: '', billRate: '', unit: 'DAY', otRate: '', aadhaar: '', pan: '', uan: '', esiNo: '', bankName: '', bankAccount: '', bankIfsc: '', pv: PV[0], pvTill: '', medicalTill: '', notes: '' });
  const full = (m) => { const o = Object.assign(blank(), m); o.deploy = Object.assign(blank().deploy, m && m.deploy); o.skills = skillsOf(o); o.certs = Array.isArray(o.certs) ? o.certs : []; o.history = Array.isArray(o.history) ? o.history : []; return o; };

  const Manpower = {
    CATS, ENGAGE, STATUS, COLUMNS,
    // Every member, by code then name; without the inactive ones unless asked
    members(all) { return list().map(full).filter(m => all || statusOf(m) !== 'inactive').sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }) || String(a.name).localeCompare(String(b.name))); },
    nextCode() { let max = 0; list().forEach(x => { const m = /(\d+)$/.exec(x.code || ''); if (m) max = Math.max(max, +m[1]); }); return 'MP' + String(max + 1).padStart(3, '0'); },
    skillsOf, statusOf,
    // Every skill and trade on the roster, as typed the first time
    allSkills() { const seen = new Map(); list().forEach(m => skillsOf(m).concat(m.trade ? [m.trade] : []).forEach(s => { if (!seen.has(lower(s))) seen.set(lower(s), s); })); return Array.from(seen.values()).sort((a, b) => a.localeCompare(b)); },
    /* What is wrong with the papers of a member: [{ what, when, state }] with state 'expired', 'soon' (within 60 days)
       or 'missing'. An inactive member is not chased. */
    papers(m) {
      const out = []; if (statusOf(m) === 'inactive') return out;
      const due = (what, date) => { const d = daysTo(date); if (d == null) return; if (d < 0) out.push({ what, when: date, state: 'expired' }); else if (d <= SOON_DAYS) out.push({ what, when: date, state: 'soon' }); };
      if (m.pv !== 'Verified') out.push({ what: 'Police verification ' + (m.pv === 'Applied' ? 'applied, not received' : 'not done'), when: '', state: 'missing' }); else due('Police verification', m.pvTill);
      due('Medical fitness', m.medicalTill); due('Engagement', m.endsOn);
      (m.certs || []).forEach(c => { if (c && c.name) due(c.name, c.till); });
      if (statusOf(m) === 'deployed') due('Deployment at ' + (m.deploy.client || m.deploy.site || 'the site'), m.deploy.till);
      if (!String(m.aadhaar || '').trim()) out.push({ what: 'Aadhaar not on record', when: '', state: 'missing' });
      if (!String(m.bankAccount || '').trim()) out.push({ what: 'Bank account not on record', when: '', state: 'missing' });
      return out;
    },
    // What the invoice's staff sheet takes for a name: the code, the trade, and the bill rate with its unit and the OT rate
    billing() { return this.members().filter(m => String(m.name).trim()).map(m => ({ id: m.id, name: String(m.name).trim(), empId: m.code || '', designation: m.trade || '', uqc: m.unit || 'DAY', rate: num(m.billRate) > 0 ? num(m.billRate) : '', otRate: num(m.otRate) > 0 ? num(m.otRate) : '', client: m.deploy.client || '', site: m.deploy.site || '', status: statusOf(m), category: m.category || '' })); },

    // ------------------------------------------------------------ the screen
    screen(p) {
      const tab = TABS.some(t => t[0] === p.tab) ? p.tab : 'members', w = mayW(), every = this.members(true);
      const staffingCo = U.isStaffingCo(Store.company());
      const body = { members: () => this.membersTab(p, every, w), deploy: () => this.deployTab(every, w), skills: () => this.skillsTab(every), papers: () => this.papersTab(every), att: () => this.attTab ? this.attTab(p, every, w) : '', work: () => this.workTab ? this.workTab(p, every, w) : '', reports: () => this.reportsTab ? this.reportsTab(p, every) : '' }[tab]();   // reportsTab: modreports.js
      const count = (k) => every.filter(m => statusOf(m) === k).length, flagged = every.filter(m => this.papers(m).some(x => x.state !== 'missing')).length;
      const stat = (k, v, cls, go) => '<div class="istat ' + cls + '"' + (go ? ' data-stat="' + go + '" style="cursor:pointer"' : '') + '><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
      const root = App.view(App.header('Manpower', '<div class="btnrow" style="margin:0">' + (w ? '<button class="btn sm green" id="mpAdd">+ Add Member</button><button class="btn sm outline" id="mpCsv">Upload CSV / Excel</button><button class="btn sm outline" id="mpTpl">Template</button><button class="btn sm outline" id="mpEmp" title="Copy the employees under HR onto the roster">From Employees</button>' : '') +
        '<button class="btn sm outline" id="mpXls">Export Excel</button><button class="btn sm outline" id="mpReg" title="The register of workmen, in the columns of Form XIII">Register</button></div>') +
        (staffingCo ? '' : '<div class="card white"><div class="bd"><div class="hint" style="margin:0">The Manpower tab is shown to a company whose line of activity is <b>Services</b> of the type <b>Manpower and Staffing Services</b> (Company Profile). You can still keep a roster here.</div></div></div>') +
        '<div class="istats">' + stat('Members', every.length, '', 'members:') + stat('Available', count('available'), 'ok', 'members:available') + stat('Deployed', count('deployed'), '', 'deploy:') + stat('On leave', count('leave'), 'warn', 'members:leave') + stat('Papers due', flagged, flagged ? 'bad' : '', 'papers:') + '</div>' +
        '<div class="btnrow" style="margin-bottom:12px">' + TABS.map(t => '<button class="btn sm ' + (t[0] === tab ? 'blue' : 'outline') + '" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' + body);
      App.wireBack(root);
      const again = () => App.go('manpower', Object.assign({}, p, { tab }));
      $$('[data-tab]', root).forEach(b => b.onclick = () => App.go('manpower', { tab: b.dataset.tab }));
      $$('[data-stat]', root).forEach(b => b.onclick = () => { const [t, show] = b.dataset.stat.split(':'); App.go('manpower', show ? { tab: t, show } : { tab: t }); });
      if (w) {
        $('#mpAdd').onclick = () => this.edit(null, again);
        $('#mpCsv').onclick = () => UI.pickSheet(rows => this.importRows(rows, again));
        $('#mpTpl').onclick = () => { UI.download('BlitzBook_Manpower_Template.csv', UI.csv([COLUMNS].concat(SAMPLE)) + '\n', 'text/csv'); UI.toast('Template downloaded'); };
        $('#mpEmp').onclick = () => this.fromEmployees(again);
      }
      $('#mpXls').onclick = () => this.exportXls(every);
      $('#mpReg').onclick = () => this.register(every);
      const find = (id) => full(Store.find('manpower', id) || {});
      $$('[data-m]', root).forEach(b => b.onclick = (ev) => { ev.preventDefault(); this.edit(find(b.dataset.m), again); });
      $$('[data-deploy]', root).forEach(b => b.onclick = () => this.deploy(find(b.dataset.deploy), again));
      $$('[data-release]', root).forEach(b => b.onclick = () => this.release(find(b.dataset.release), again));
      $$('[data-del]', root).forEach(b => b.onclick = () => { const m = find(b.dataset.del); UI.confirm('Delete Member', 'Delete ' + m.name + ' from the roster? Invoices that billed them stay as they are. To keep the record and only stop offering them, set the status to Inactive instead.', () => { Store.delete('manpower', m.id); UI.toast('Member deleted'); again(); }, 'Delete'); });
      $$('[data-skill]', root).forEach(b => b.onclick = (ev) => { ev.preventDefault(); App.go('manpower', { tab: 'members', skill: b.dataset.skill }); });
      $$('[data-cat]', root).forEach(b => b.onclick = (ev) => { ev.preventDefault(); App.go('manpower', { tab: 'members', cat: b.dataset.cat }); });
      $$('[data-show]', root).forEach(b => b.onclick = () => App.go('manpower', Object.assign({}, p, { tab: 'members', show: b.dataset.show })));
      if (tab === 'reports' && this.wireReports) this.wireReports(root, p);
      if (tab === 'work' && this.wireWork) this.wireWork(root, p);
      if (tab === 'att' && this.wireAtt) this.wireAtt(root, p);
      const q = $('#mpFind', root);
      if (q) {
        const run = () => { const t = q.value.trim().toLowerCase(); let n = 0; $$('#mpList tbody tr', root).forEach(tr => { const on = !t || (tr.dataset.f || '').includes(t); tr.style.display = on ? '' : 'none'; if (on) n++; }); if ($('#mpShown', root)) $('#mpShown', root).textContent = n + ' shown'; };
        q.addEventListener('input', run); run();
        $('#mpCat', root).onchange = (e) => App.go('manpower', Object.assign({}, p, { tab: 'members', cat: e.target.value }));
        $('#mpSkill', root).onchange = (e) => App.go('manpower', Object.assign({}, p, { tab: 'members', skill: e.target.value }));
      }
    },
    rateCell(m, k) { return num(m[k]) > 0 ? '<b>' + money(num(m[k])) + '</b><div class="small muted">per ' + unitName(m.unit) + '</div>' : '-'; },
    statusCell(m) { const st = statusOf(m), d = m.deploy; return '<span class="pill ' + STATUS_PILL[st] + '">' + statusName(st) + '</span>' + (st === 'deployed' && (d.client || d.site) ? '<div class="small muted">' + esc([d.client, d.site].filter(Boolean).join(' · ')) + '</div>' : ''); },
    papersCell(m) { const ps = this.papers(m), bad = ps.filter(x => x.state === 'expired').length, soon = ps.filter(x => x.state === 'soon').length, miss = ps.filter(x => x.state === 'missing').length; return !ps.length ? '<span class="pill ok">In order</span>' : (bad ? '<span class="pill bad">' + bad + ' expired</span> ' : '') + (soon ? '<span class="pill warn">' + soon + ' due</span> ' : '') + (miss ? '<span class="pill">' + miss + ' missing</span>' : ''); },
    actions(m, w) { if (!w) return ''; const st = statusOf(m); return (st === 'deployed' ? '<button class="btn sm outline" data-release="' + esc(m.id) + '" title="The deployment ends: it goes to the history and the member is available again">Release</button>' : st === 'inactive' ? '' : '<button class="btn sm blue" data-deploy="' + esc(m.id) + '" title="Send to a client\'s site">Deploy</button>'); },

    membersTab(p, every, w) {
      const show = STATUS.some(s => s[0] === p.show) ? p.show : '', cat = CATS.includes(p.cat) ? p.cat : '', skill = String(p.skill || '');
      const rows = every.filter(m => (!show || statusOf(m) === show) && (!cat || m.category === cat) && (!skill || skillsOf(m).concat([m.trade]).some(s => lower(s) === lower(skill))));
      const chip = (k, label, n) => '<button class="btn sm ' + (show === k ? '' : 'outline') + '" data-show="' + k + '">' + label + ' (' + n + ')</button>';
      return '<div class="btnrow">' + chip('', 'All', every.length) + STATUS.map(s => chip(s[0], s[1], every.filter(m => statusOf(m) === s[0]).length)).join('') + '</div>' +
        '<div class="qbar"><input id="mpFind" placeholder="Search name, code, trade, skill, phone, client or site">' + UI.select('mpCat', CATS, cat, { blank: 'Every category', attrs: ' style="max-width:190px"' }) + UI.select('mpSkill', this.allSkills(), skill, { blank: 'Every skill', attrs: ' style="max-width:210px"' }) + '<span class="hint" id="mpShown" style="white-space:nowrap"></span></div>' +
        '<div id="mpList">' + Ledger.listTable(['Code', 'Name', 'Status', 'Trade', 'Category', 'Skills', 'Experience', 'Phone', 'Engagement', '#Pay rate', '#Bill rate', 'Papers', ''], rows.map(m => {
          const sk = skillsOf(m), d = m.deploy;
          return '<tr data-f="' + esc([m.code, m.name, m.trade, m.category, sk.join(' '), m.phone, d.client, d.site, m.languages, m.education].join(' ').toLowerCase()) + '"' + (statusOf(m) === 'inactive' ? ' class="muted"' : '') + '>' +
            td('Code', '<b><a class="nolink" href="#" data-m="' + esc(m.id) + '" title="Open ' + esc(m.name) + '">' + esc(m.code || 'Open') + '</a></b>') + td('Name', '<b>' + esc(m.name) + '</b>' + (m.gender ? '<div class="small muted">' + esc(m.gender) + '</div>' : '')) + td('Status', this.statusCell(m)) + td('Trade', esc(m.trade || '-')) + td('Category', esc(m.category || '-')) +
            td('Skills', sk.length ? sk.slice(0, 4).map(s => '<span class="pill">' + esc(s) + '</span>').join(' ') + (sk.length > 4 ? ' <span class="small muted">+' + (sk.length - 4) + '</span>' : '') : '-') + td('Experience', num(m.experience) > 0 ? U.fmtQty(num(m.experience)) + ' yr' : '-') + td('Phone', esc(m.phone || '-')) + td('Engagement', esc(m.engagement || '-')) +
            td('Pay rate', this.rateCell(m, 'payRate'), 'num') + td('Bill rate', this.rateCell(m, 'billRate'), 'num') + td('Papers', this.papersCell(m)) +
            '<td class="actions">' + this.actions(m, w) + (w ? '<button class="btn sm outline" data-m="' + esc(m.id) + '">Edit</button><button class="btn sm red outline" data-del="' + esc(m.id) + '">Delete</button>' : '<button class="btn sm outline" data-m="' + esc(m.id) + '">View</button>') + '</td></tr>'; }),
          every.length ? 'Nobody matches these filters.' : 'No members yet. Add the people you send out: their skills, rates and papers are then at hand, and the invoice\'s staff sheet picks them from here.').replace('<div class="tablewrap">', '<div class="tablewrap pin">') + '</div>';
    },

    // Who is where: a card per client and site, then the bench
    deployTab(every, w) {
      const out = every.filter(m => statusOf(m) === 'deployed'), groups = new Map();
      out.forEach(m => { const k = lower(m.deploy.client) + '|' + lower(m.deploy.site); if (!groups.has(k)) groups.set(k, { client: m.deploy.client, site: m.deploy.site, ms: [] }); groups.get(k).ms.push(m); });
      const bench = every.filter(m => statusOf(m) === 'available'), away = every.filter(m => statusOf(m) === 'leave');
      // What a day of the people on a site bills, where the rates are per day
      const perDay = (ms) => ms.reduce((t, m) => t + (m.unit === 'DAY' ? num(m.billRate) : 0), 0);
      const table = (ms, cols) => Ledger.listTable(cols, ms.map(m => '<tr>' + td('Code', '<b><a class="nolink" href="#" data-m="' + esc(m.id) + '">' + esc(m.code || 'Open') + '</a></b>') + td('Name', '<b>' + esc(m.name) + '</b>') + td('Trade', esc(m.trade || '-')) + td('Category', esc(m.category || '-')) +
        (cols.includes('Since') ? td('Since', esc(m.deploy.from || '-')) + td('Till', esc(m.deploy.till || '-') + (daysTo(m.deploy.till) != null && daysTo(m.deploy.till) <= SOON_DAYS ? ' <span class="pill ' + (daysTo(m.deploy.till) < 0 ? 'bad">over' : 'warn">' + daysTo(m.deploy.till) + ' d') + '</span>' : '')) + td('Shift', esc(m.deploy.shift || '-')) : td('Skills', esc(skillsOf(m).join(', ') || '-')) + td('Phone', esc(m.phone || '-'))) +
        td('Bill rate', this.rateCell(m, 'billRate'), 'num') + '<td class="actions">' + this.actions(m, w) + '</td></tr>'), '');
      const cards = Array.from(groups.values()).sort((a, b) => b.ms.length - a.ms.length).map(g => { const trades = new Map(); g.ms.forEach(m => trades.set(m.trade || 'Other', (trades.get(m.trade || 'Other') || 0) + 1)); const day = perDay(g.ms);
        return '<div class="card"><div class="hd">' + esc(g.client || '(no client named)') + (g.site ? ' <span class="small muted">· ' + esc(g.site) + '</span>' : '') + ' <span class="inline"><span class="pill">' + g.ms.length + ' deployed</span></span></div><div class="bd" style="padding:8px">' +
          '<div class="hint" style="margin:2px 6px 8px">' + esc(Array.from(trades.entries()).map(([t, n]) => n + ' ' + t).join(', ')) + (day > 0 ? ' · bills about ' + money(day) + ' a day' : '') + '</div>' + table(g.ms, ['Code', 'Name', 'Trade', 'Category', 'Since', 'Till', 'Shift', '#Bill rate', '']) + '</div></div>'; }).join('');
      return (cards || '<div class="card white"><div class="bd"><div class="empty">Nobody is deployed. Deploy a member from the list (Deploy), or set the status to Deployed on the member.</div></div></div>') +
        '<div class="card"><div class="hd">Bench: available now <span class="inline"><span class="pill ok">' + bench.length + '</span></span></div><div class="bd" style="padding:8px">' + (bench.length ? table(bench, ['Code', 'Name', 'Trade', 'Category', 'Skills', 'Phone', '#Bill rate', '']) : '<div class="empty">Everybody is out on a site or away.</div>') + '</div></div>' +
        (away.length ? '<div class="card"><div class="hd">On leave <span class="inline"><span class="pill warn">' + away.length + '</span></span></div><div class="bd" style="padding:8px">' + table(away, ['Code', 'Name', 'Trade', 'Category', 'Skills', 'Phone', '#Bill rate', '']) + '</div></div>' : '');
    },

    // How many people of each skill and of each category, and how many of them are free
    skillsTab(every) {
      const act = every.filter(m => statusOf(m) !== 'inactive'), tally = (keyOf) => { const m = new Map(); act.forEach(x => keyOf(x).forEach(s => { const k = lower(s); if (!k) return; const r = m.get(k) || { name: s, total: 0, available: 0, deployed: 0, leave: 0 }; r.total++; r[statusOf(x)]++; m.set(k, r); })); return Array.from(m.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)); };
      const rows = (rs, attr) => rs.map(r => '<tr>' + td('Skill', '<b><a class="nolink" href="#" ' + attr + '="' + esc(r.name) + '">' + esc(r.name) + '</a></b>') + td('People', String(r.total), 'num') + td('Available', r.available ? '<span class="pill ok">' + r.available + '</span>' : '0', 'num') + td('Deployed', String(r.deployed), 'num') + td('On leave', String(r.leave), 'num') + '</tr>');
      const cats = tally(m => [m.category || 'Not set']).sort((a, b) => (CATS.indexOf(a.name) + 1 || 9) - (CATS.indexOf(b.name) + 1 || 9));
      return '<div class="grid2"><div class="card"><div class="hd">By skill and trade</div><div class="bd" style="padding:8px">' + Ledger.listTable(['Skill', '#People', '#Available', '#Deployed', '#On leave'], rows(tally(m => Array.from(new Map(skillsOf(m).concat(m.trade ? [m.trade] : []).map(s => [lower(s), s])).values())), 'data-skill'), 'No skills on record yet. Add them on the members.') + '</div></div>' +
        '<div class="card"><div class="hd">By skill category</div><div class="bd" style="padding:8px">' + Ledger.listTable(['Category', '#People', '#Available', '#Deployed', '#On leave'], rows(cats, 'data-cat'), 'No members yet.') +
        '<div class="hint" style="margin:8px 6px 0">The categories are those of the minimum wages notifications: the rate a member may not be paid below follows the category, the kind of work and the place. Tap a skill or a category for the people.</div></div></div></div>';
    },

    // Papers that are missing, have run out or run out within 60 days
    papersTab(every) {
      const order = { expired: 0, soon: 1, missing: 2 }, lines = [];
      every.forEach(m => this.papers(m).forEach(x => lines.push({ m, x })));
      lines.sort((a, b) => order[a.x.state] - order[b.x.state] || (U.dateMs(a.x.when) || 0) - (U.dateMs(b.x.when) || 0) || String(a.m.name).localeCompare(String(b.m.name)));
      const pill = (x) => x.state === 'expired' ? '<span class="pill bad">Expired' + (daysTo(x.when) != null ? ' ' + (-daysTo(x.when)) + ' d ago' : '') + '</span>' : x.state === 'soon' ? '<span class="pill warn">In ' + daysTo(x.when) + ' d</span>' : '<span class="pill">Missing</span>';
      return '<div class="card white"><div class="bd"><div class="hint" style="margin:0">What has run out, what runs out in the next ' + SOON_DAYS + ' days (police verification, medical fitness, licences and certificates, the engagement, a deployment) and what is not on record. Inactive members are left out.</div></div></div>' +
        Ledger.listTable(['Code', 'Name', 'Status', 'Paper', 'Valid till', 'State'], lines.map(({ m, x }) => '<tr>' + td('Code', '<b><a class="nolink" href="#" data-m="' + esc(m.id) + '">' + esc(m.code || 'Open') + '</a></b>') + td('Name', '<b>' + esc(m.name) + '</b>') + td('Status', this.statusCell(m)) + td('Paper', esc(x.what)) + td('Valid till', esc(x.when || '-')) + td('State', pill(x)) + '</tr>'), every.length ? 'Every paper is in order.' : 'No members yet.');
    },

    // ------------------------------------------------------------ a member
    certRow(c) { return '<tr><td><input data-c="name" list="mpCertDl" placeholder="Driving licence, PSARA training, ITI ..." value="' + esc(c.name || '') + '"></td><td><input data-c="no" placeholder="Number" value="' + esc(c.no || '') + '"></td><td><input type="date" data-c="till" value="' + esc(U.toIso(c.till || '')) + '"></td><td class="del"><button class="delbtn" type="button" title="Remove" data-crm>🗑</button></td></tr>'; },
    edit(m, done) {
      const fresh = !m || !m.id, w = mayW();
      m = full(m || {}); if (fresh && !m.code) m.code = this.nextCode();
      const n = (id, v, hint) => UI.input(id, v, { type: 'number', attrs: ' min="0" step="any"' + (hint || '') });
      const hist = m.history.length ? '<div class="field span"><label>Earlier deployments</label><div class="tablewrap"><table class="list" style="min-width:0"><thead><tr><th>Client</th><th>Site</th><th>From</th><th>To</th></tr></thead><tbody>' + m.history.slice().reverse().map(h => '<tr><td>' + esc(h.client || '-') + '</td><td>' + esc(h.site || '-') + '</td><td>' + esc(h.from || '-') + '</td><td>' + esc(h.to || '-') + '</td></tr>').join('') + '</tbody></table></div></div>' : '';
      const bg = UI.modal({ title: fresh ? 'New Member' : (w ? 'Edit Member' : 'Member'), wide: true, body: '<div class="grid2">' +
        UI.field('Member code', UI.input('mCode', m.code)) + UI.field('Full name', UI.input('mName', m.name), { req: true }) +
        UI.field('Gender', UI.select('mGender', ['Male', 'Female', 'Other'], m.gender, { blank: '— not set —' })) + UI.field('Date of birth', UI.dateInput('mDob', m.dob)) +
        UI.field('Father\'s / spouse\'s name', UI.input('mFather', m.father)) + UI.field('Mobile', UI.input('mPhone', m.phone, { type: 'tel', attrs: ' maxlength="10"' })) +
        UI.field('Address', '<textarea id="mAddr">' + esc(m.address) + '</textarea>', { span: true }) + UI.field('Emergency contact', UI.input('mEmerg', m.emergency, { placeholder: 'Name and number' }), { span: true }) +
        '<div class="field span"><label>Skill set</label></div>' +
        UI.field('Trade / designation', UI.input('mTrade', m.trade, { list: 'mpTradeDl', placeholder: 'Security Guard, Electrician ...' }) + UI.datalist('mpTradeDl', Array.from(new Set(TRADES.concat(this.allSkills())))), { hint: 'Printed as the designation on the invoice\'s staff sheet' }) +
        UI.field('Skill category', UI.select('mCat', CATS, m.category, { blank: '— not set —' }), { hint: 'As in the minimum wages notifications' }) +
        UI.field('Skills', UI.input('mSkills', m.skills.join(', '), { placeholder: 'CCTV monitoring, Fire safety, Forklift ...' }), { span: true, hint: 'Separated by commas: each becomes a tag the roster is searched and counted by' }) +
        UI.field('Experience (years)', n('mExp', m.experience)) + UI.field('Education', UI.input('mEdu', m.education, { placeholder: '10th, ITI Electrician, Diploma ...' })) +
        UI.field('Languages', UI.input('mLang', m.languages, { placeholder: 'Telugu, Hindi, English' }), { span: true }) +
        '<div class="field span"><label>Certificates and licences</label><div class="tablewrap"><table class="items" style="min-width:0"><thead><tr><th>Certificate / licence</th><th class="hsn">Number</th><th class="rate">Valid till</th><th class="del"></th></tr></thead><tbody id="mCerts">' + m.certs.map(c => this.certRow(c)).join('') + '</tbody></table></div>' +
        UI.datalist('mpCertDl', ['Driving licence (LMV)', 'Driving licence (HMV)', 'PSARA guard training', 'Arms licence', 'Electrician licence (wireman)', 'ITI certificate', 'Fire safety training', 'First aid', 'Forklift operator certificate', 'Food handler (FoSTaC)', 'Height work pass']) + '<div class="btnrow" style="margin:6px 0 0"><button class="btn sm" id="mCertAdd" type="button">+ Add certificate</button></div></div>' +
        '<div class="field span"><label>Engagement and deployment</label></div>' +
        UI.field('Engagement', UI.select('mEng', ENGAGE, m.engagement)) + UI.field('Joined on', UI.dateInput('mDoj', m.doj)) +
        UI.field('Engagement ends', UI.dateInput('mEnds', m.endsOn), { hint: 'Blank when open-ended' }) + UI.field('Status', UI.select('mStatus', STATUS, statusOf(m))) +
        '<div class="field span" id="mDepBox"><div class="grid2" style="margin:0">' + UI.field('Deployed at (client)', UI.input('mClient', m.deploy.client, { list: 'mpClientDl', placeholder: 'The customer' }) + UI.datalist('mpClientDl', customers())) + UI.field('Work site / location', UI.input('mSite', m.deploy.site)) +
        UI.field('Deployed from', UI.dateInput('mFrom', m.deploy.from)) + UI.field('Deployed till', UI.dateInput('mTill', m.deploy.till), { hint: 'Blank when open-ended' }) + UI.field('Shift', UI.input('mShift', m.deploy.shift, { list: 'mpShiftDl', placeholder: 'Day, Night, General, 8 hrs ...' }) + UI.datalist('mpShiftDl', ['General', 'Day', 'Night', 'Rotational', '8 hours', '12 hours'])) + '</div></div>' + hist +
        '<div class="field span"><label>Rates</label></div>' +
        UI.field('Pay rate ₹', n('mPay', m.payRate), { hint: 'What the member is paid' }) + UI.field('Bill rate ₹', n('mBill', m.billRate), { hint: 'What the client is charged: the rate the invoice\'s staff sheet starts with' }) +
        UI.field('Per', UI.select('mUnit', UNITS, m.unit)) + UI.field('Overtime rate ₹ / hour', n('mOt', m.otRate), { hint: 'Billed per overtime hour' }) +
        '<div class="field span"><div class="hint" id="mMargin" style="margin:0"></div></div>' +
        '<div class="field span"><label>Papers</label></div>' +
        UI.field('Aadhaar', UI.input('mAadhaar', m.aadhaar, { attrs: ' maxlength="12" inputmode="numeric"' })) + UI.field('PAN', UI.input('mPan', m.pan, { attrs: ' maxlength="10" style="text-transform:uppercase"' })) +
        UI.field('UAN (PF)', UI.input('mUan', m.uan, { attrs: ' maxlength="12" inputmode="numeric"' })) + UI.field('ESI number', UI.input('mEsi', m.esiNo)) +
        UI.field('Police verification', UI.select('mPv', PV, PV.includes(m.pv) ? m.pv : PV[0])) + UI.field('Police verification valid till', UI.dateInput('mPvTill', m.pvTill)) +
        UI.field('Medical fitness valid till', UI.dateInput('mMed', m.medicalTill)) + UI.field('Bank', UI.input('mBank', m.bankName)) +
        UI.field('Account number', UI.input('mAcc', m.bankAccount)) + UI.field('IFSC', UI.input('mIfsc', m.bankIfsc, { attrs: ' maxlength="11" style="text-transform:uppercase"' })) +
        UI.field('Notes', '<textarea id="mNotes" placeholder="Height, uniform size, preferred area, remarks from a client ...">' + esc(m.notes) + '</textarea>', { span: true }) + '</div>',
        buttons: !w ? [{ label: 'Close', cls: 'outline' }] : [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          $$('.err', bg).forEach(el => el.classList.remove('err'));
          const g = (id) => String(UI.val(id, bg)).trim(), was = Object.assign({}, m.deploy), wasStatus = statusOf(m);
          const o = Object.assign(m, { code: g('mCode'), name: g('mName'), gender: g('mGender'), dob: UI.dateVal('mDob', bg), father: g('mFather'), phone: g('mPhone').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''), address: g('mAddr'), emergency: g('mEmerg'),
            trade: g('mTrade'), category: g('mCat'), skills: skillsOf({ skills: g('mSkills') }).filter((s, i, a) => a.findIndex(x => lower(x) === lower(s)) === i), experience: g('mExp') === '' ? '' : num(g('mExp')), education: g('mEdu'), languages: g('mLang'),
            engagement: g('mEng'), doj: UI.dateVal('mDoj', bg), endsOn: UI.dateVal('mEnds', bg), status: g('mStatus'), payRate: g('mPay') === '' ? '' : num(g('mPay')), billRate: g('mBill') === '' ? '' : num(g('mBill')), unit: g('mUnit'), otRate: g('mOt') === '' ? '' : num(g('mOt')),
            aadhaar: g('mAadhaar').replace(/\s/g, ''), pan: g('mPan').toUpperCase(), uan: g('mUan'), esiNo: g('mEsi'), pv: g('mPv'), pvTill: UI.dateVal('mPvTill', bg), medicalTill: UI.dateVal('mMed', bg), bankName: g('mBank'), bankAccount: g('mAcc'), bankIfsc: g('mIfsc').toUpperCase(), notes: g('mNotes') });
          o.certs = $$('#mCerts tr', bg).map(tr => { const f = (k) => String(($('[data-c=' + k + ']', tr) || {}).value || '').trim(); return { name: f('name'), no: f('no'), till: U.fromIso(f('till')) }; }).filter(c => c.name);
          const dep = { client: g('mClient'), site: g('mSite'), from: UI.dateVal('mFrom', bg), till: UI.dateVal('mTill', bg), shift: g('mShift') };
          if (!o.name) { UI.mark('mName', true, bg); UI.toast('Enter the name'); return false; }
          if (o.phone && !/^[6-9][0-9]{9}$/.test(o.phone)) { UI.mark('mPhone', true, bg); UI.toast('Enter a valid 10-digit mobile number'); return false; }
          if (o.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(o.pan)) { UI.mark('mPan', true, bg); UI.toast('PAN is 10 characters, e.g. ABCDE1234F'); return false; }
          if (o.aadhaar && !/^\d{12}$/.test(o.aadhaar)) { UI.mark('mAadhaar', true, bg); UI.toast('Aadhaar is 12 digits'); return false; }
          const twin = list().find(x => x.id !== o.id && ((o.code && lower(x.code) === lower(o.code)) || lower(x.name) === lower(o.name)));
          if (twin) { UI.mark(lower(twin.code) === lower(o.code) && o.code ? 'mCode' : 'mName', true, bg); UI.toast((lower(twin.code) === lower(o.code) && o.code ? 'The code ' + o.code : o.name) + ' is already on the roster' + (lower(twin.name) === lower(o.name) ? ': add an initial or the father\'s name to tell two people of one name apart' : ''), 5000); return false; }
          if (o.status === 'deployed') {
            if (!dep.client && !dep.site) { UI.mark('mClient', true, bg); UI.toast('Say where ' + o.name + ' is deployed: the client or the site'); return false; }
            if (dep.from && dep.till && U.dateMs(dep.till) < U.dateMs(dep.from)) { UI.mark('mTill', true, bg); UI.toast('The deployment ends before it begins'); return false; }
            if (!dep.from) dep.from = U.today();
            // Moved to another client or site: the one before goes to the history
            if (wasStatus === 'deployed' && (was.client || was.site) && (lower(was.client) !== lower(dep.client) || lower(was.site) !== lower(dep.site))) o.history.push({ client: was.client, site: was.site, from: was.from, to: dep.from || U.today(), shift: was.shift });
            o.deploy = dep;
          } else {
            if (wasStatus === 'deployed' && (was.client || was.site)) o.history.push({ client: was.client, site: was.site, from: was.from, to: U.today(), shift: was.shift });
            o.deploy = blank().deploy;
          }
          if ((o.id ? Store.update('manpower', o) : Store.add('manpower', o)) === false) return false;
          UI.toast('Member saved'); if (done) done();
        } }] });
      if (!w) { $$('input, select, textarea, button.btn.sm, .delbtn', $('.mb', bg) || bg).forEach(el => { el.disabled = true; }); return; }
      const dep = () => { $('#mDepBox', bg).style.display = $('#mStatus', bg).value === 'deployed' ? '' : 'none'; };
      $('#mStatus', bg).addEventListener('change', dep); dep();
      const margin = () => { const pay = num($('#mPay', bg).value), bill = num($('#mBill', bg).value); $('#mMargin', bg).textContent = pay > 0 && bill > 0 ? 'Margin: ' + money(U.round2(bill - pay)) + ' per ' + unitName($('#mUnit', bg).value) + ' (' + U.round2((bill - pay) / bill * 100) + '% of the bill rate), before the employer PF / ESI the agency bears.' + (bill < pay ? ' The bill rate is below the pay rate.' : '') : 'The bill rate less the pay rate is the margin on this member.'; };
      ['mPay', 'mBill'].forEach(id => $('#' + id, bg).addEventListener('input', margin)); $('#mUnit', bg).addEventListener('change', margin); margin();
      const wire = () => $$('#mCerts [data-crm]', bg).forEach(b => b.onclick = () => b.closest('tr').remove());
      wire();
      $('#mCertAdd', bg).onclick = () => { $('#mCerts', bg).insertAdjacentHTML('beforeend', this.certRow({})); wire(); const last = $$('#mCerts tr', bg).pop(); if (last) $('[data-c=name]', last).focus(); };
    },

    // Deploy: the client, the site and the dates in one small dialog
    deploy(m, done) {
      UI.modal({ title: 'Deploy ' + m.name, body: '<div class="grid2">' + UI.field('Client', UI.input('dClient', '', { list: 'mpClientDl2', placeholder: 'The customer' }) + UI.datalist('mpClientDl2', customers()), { req: true }) + UI.field('Work site / location', UI.input('dSite', '')) +
        UI.field('From', UI.dateInput('dFrom', U.today())) + UI.field('Till', UI.dateInput('dTill', ''), { hint: 'Blank when open-ended' }) + UI.field('Shift', UI.input('dShift', '', { placeholder: 'Day, Night, General ...' })) + UI.field('Bill rate ₹ per ' + unitName(m.unit), UI.input('dBill', m.billRate, { type: 'number', attrs: ' min="0" step="any"' }), { hint: 'For this client; the pay rate stays ' + (num(m.payRate) > 0 ? money(num(m.payRate)) : 'as it is') }) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Deploy', cls: 'blue', onClick: (bg) => {
          const g = (id) => String(UI.val(id, bg)).trim(), dep = { client: g('dClient'), site: g('dSite'), from: UI.dateVal('dFrom', bg) || U.today(), till: UI.dateVal('dTill', bg), shift: g('dShift') };
          if (!dep.client && !dep.site) { UI.mark('dClient', true, bg); UI.toast('Enter the client or the site'); return false; }
          if (dep.till && U.dateMs(dep.till) < U.dateMs(dep.from)) { UI.mark('dTill', true, bg); UI.toast('The deployment ends before it begins'); return false; }
          m.deploy = dep; m.status = 'deployed'; if (g('dBill') !== '') m.billRate = num(g('dBill'));
          if (Store.update('manpower', m) === false) return false;
          UI.toast(m.name + ' is deployed at ' + (dep.client || dep.site)); if (done) done();
        } }] });
    },
    release(m, done) {
      const d = m.deploy, where = [d.client, d.site].filter(Boolean).join(' · ') || 'the site';
      UI.modal({ title: 'Release ' + m.name, body: '<p>The deployment at <b>' + esc(where) + '</b>' + (d.from ? ' since ' + esc(d.from) : '') + ' ends. It is kept in the member\'s history and ' + esc(m.name) + ' is available again.</p><div class="grid2">' + UI.field('Last day at the site', UI.dateInput('rTo', U.today())) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Release', cls: 'green', onClick: (bg) => {
          const to = UI.dateVal('rTo', bg) || U.today();
          if (d.from && U.dateMs(to) < U.dateMs(d.from)) { UI.mark('rTo', true, bg); UI.toast('The last day is before the deployment began (' + d.from + ')'); return false; }
          m.history.push({ client: d.client, site: d.site, from: d.from, to, shift: d.shift }); m.deploy = blank().deploy; m.status = 'available';
          if (Store.update('manpower', m) === false) return false;
          UI.toast(m.name + ' is available again'); if (done) done();
        } }] });
    },

    // ------------------------------------------------------------ in and out
    // The employees under HR, copied onto the roster (the ones not on it by code or name)
    fromEmployees(done) {
      const all = global.HR && HR.employees ? HR.employees() : Store.list('employees').filter(e => e.active !== false), have = list();
      const emps = all.filter(e => String(e.name || '').trim() && !have.some(m => (e.code && lower(m.code) === lower(e.code)) || lower(m.name) === lower(e.name)));
      if (!emps.length) { UI.alert('From Employees', all.length ? 'Every employee under HR is already on the roster.' : 'There are no employees under HR > Employees. Add members here directly: a member does not have to be on the payroll.'); return; }
      const bg = UI.modal({ title: 'Add members from Employees', focus: false,
        body: '<div class="hint">Copies the name, code, designation, mobile, joining date, Aadhaar, PAN, UAN, ESI number and bank account. Skills, rates and deployment are then filled in here; the salary is not copied.</div><div class="qbar"><input id="feFind" placeholder="Search name, code, designation or department"><label class="check" style="white-space:nowrap"><input type="checkbox" id="feAll"> All</label></div>' +
          '<div id="feList" style="max-height:48vh;overflow:auto">' + emps.map(e => '<label class="check" data-f="' + esc([e.name, e.code, e.designation, e.department].join(' ').toLowerCase()) + '" style="border-bottom:1px dashed var(--border)"><input type="checkbox" value="' + esc(e.id) + '"> <span><b>' + esc(e.name) + '</b><span class="muted"> ' + esc([e.code, e.designation, e.department].filter(Boolean).join(' · ')) + '</span></span></label>').join('') + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Add to roster', cls: 'green', onClick: (bg) => {
          const ids = new Set($$('#feList input:checked', bg).map(x => x.value));
          if (!ids.size) { UI.toast('Tick the employees to add'); return false; }
          const l = list();
          emps.filter(e => ids.has(String(e.id))).forEach(e => l.push(Object.assign(blank(), { id: U.uid(), createdAt: Date.now(), code: e.code || '', name: String(e.name).trim(), trade: e.designation || '', phone: e.phone || '', address: e.address || '', doj: e.doj || U.today(), aadhaar: e.aadhaar || '', pan: e.pan || '', uan: e.uan || '', esiNo: e.esiNo || '', bankName: e.bankName || '', bankAccount: e.bankAccount || '', bankIfsc: e.bankIfsc || '', empId: e.id })));
          if (Store.saveList('manpower', l) === false) return false;
          UI.toast(ids.size + ' member' + (ids.size === 1 ? '' : 's') + ' added. Fill in their skills and rates.', 4000, 'ok'); if (done) done();
        } }] });
      $('#feFind', bg).addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); $$('#feList label', bg).forEach(l => { l.style.display = !q || l.dataset.f.includes(q) ? '' : 'none'; }); });
      $('#feAll', bg).addEventListener('change', e => $$('#feList label', bg).filter(l => l.style.display !== 'none').forEach(l => { $('input', l).checked = e.target.checked; }));
    },
    importRows(rows, done) {
      const head = rows.length ? rows[0].map(c => String(c == null ? '' : c).trim().toLowerCase().replace(/[^a-z]/g, '')) : [];
      const at = {}; Object.keys(HEADS).forEach(k => { at[k] = head.findIndex(h => HEADS[k].includes(h)); });
      if (at.name < 0) { UI.alert('Upload Manpower', 'The first row has to carry the column headings, with at least Name. Download the template for the columns.'); return; }
      const cell = (r, k) => at[k] >= 0 && r[at[k]] != null ? String(r[at[k]]).trim() : '';
      const recs = [], bad = [];
      rows.slice(1).forEach((r, i) => {
        const name = cell(r, 'name'); if (!name) return;
        const f = { name }, dep = {}, given = (k, v) => { if (v !== '') f[k] = v; }, line = 'Row ' + (i + 2) + ' (' + name + ')';
        ['code', 'gender', 'father', 'trade', 'education', 'languages', 'address', 'emergency', 'notes', 'uan', 'esiNo', 'bankName', 'bankAccount'].forEach(k => given(k, cell(r, k)));
        given('phone', cell(r, 'phone').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')); given('pan', cell(r, 'pan').toUpperCase()); given('aadhaar', cell(r, 'aadhaar').replace(/\s/g, '')); given('bankIfsc', cell(r, 'bankIfsc').toUpperCase());
        ['dob', 'doj', 'pvTill', 'medicalTill', 'endsOn'].forEach(k => given(k, U.sheetDate(cell(r, k))));
        const cat = cell(r, 'category'); if (cat) { const c = CATS.find(x => lower(x).replace(/[^a-z]/g, '') === lower(cat).replace(/[^a-z]/g, '')); if (!c) { bad.push(line + ': the category is one of ' + CATS.join(', ')); return; } f.category = c; }
        const eng = cell(r, 'engagement'); if (eng) f.engagement = ENGAGE.find(x => lower(x) === lower(eng)) || eng;
        const sk = cell(r, 'skills'); if (sk) f.skills = skillsOf({ skills: sk });
        ['experience', 'payRate', 'billRate', 'otRate'].forEach(k => { const v = cell(r, k); if (v !== '') f[k] = num(v); });
        if (cell(r, 'unit')) f.unit = unitOf(cell(r, 'unit'));
        const pv = cell(r, 'pv'); if (pv) f.pv = /^(verified|done|yes|y)$/i.test(pv) ? 'Verified' : /^appl/i.test(pv) ? 'Applied' : 'Not done';
        ['client', 'site', 'shift'].forEach(k => { if (cell(r, k)) dep[k] = cell(r, k); }); ['from', 'till'].forEach(k => { if (cell(r, k)) dep[k] = U.sheetDate(cell(r, k)); });
        const st = cell(r, 'status'); if (st) { const s = STATUS.find(x => lower(x[1]) === lower(st) || x[0] === lower(st)); if (!s) { bad.push(line + ': the status is one of ' + STATUS.map(x => x[1]).join(', ')); return; } f.status = s[0]; } else if (dep.client || dep.site) f.status = 'deployed';
        if (Object.keys(dep).length) f.dep = dep;
        if (f.status === 'deployed' && !dep.client && !dep.site) { bad.push(line + ': a deployed member needs the client or the site'); return; }
        if (f.phone && !/^[6-9][0-9]{9}$/.test(f.phone)) { bad.push(line + ': the mobile number is not 10 digits'); return; }
        if (f.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(f.pan)) { bad.push(line + ': PAN is 10 characters, e.g. ABCDE1234F'); return; }
        recs.push(f);
      });
      if (!recs.length && !bad.length) { UI.alert('Upload Manpower', 'No members found in the file. The columns are ' + COLUMNS.join(', ') + ' (download the template).'); return; }
      const l = list(), match = (f) => (f.code && l.find(m => lower(m.code) === lower(f.code))) || l.find(m => lower(m.name) === lower(f.name)) || null;
      const known = recs.filter(f => match(f)).length;
      UI.modal({ title: 'Upload Manpower', focus: false, body: '<p>' + recs.length + ' member' + (recs.length === 1 ? '' : 's') + ' in the file: <b>' + (recs.length - known) + '</b> new, <b>' + known + '</b> already on the roster (by code or name).' + (bad.length ? ' <b>' + bad.length + '</b> row' + (bad.length === 1 ? '' : 's') + ' cannot be read and will be skipped.' : '') + '</p>' + UI.modeField('Members') +
          '<div class="hint">Upsert changes only the cells that are filled in; a blank cell leaves the value as it is.</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Upload', cls: 'green', onClick: (bg) => {
          const mode = UI.modeOf(bg), r = { inserted: 0, updated: 0, unchanged: 0, skipped: bad.length, lines: bad.slice() };
          let max = 0; l.forEach(x => { const m = /(\d+)$/.exec(x.code || ''); if (m) max = Math.max(max, +m[1]); });
          recs.forEach(f => {
            const dep = f.dep; delete f.dep;
            const ex = match(f);
            if (!ex) { const o = Object.assign(blank(), f, { id: U.uid(), createdAt: Date.now() }); if (dep && o.status === 'deployed') o.deploy = Object.assign(o.deploy, dep, { from: dep.from || U.today() }); if (!o.code) o.code = 'MP' + String(++max).padStart(3, '0'); l.push(o); r.inserted++; return; }
            if (mode === 'insert') { r.skipped++; r.lines.push(f.name + ': already on the roster, left as it is'); return; }
            if (lower(ex.name) === lower(f.name)) f.name = ex.name; // the name as it is written on the roster
            const before = JSON.stringify(full(ex)), o = Object.assign(full(ex), f);
            if (o.status === 'deployed') o.deploy = Object.assign(o.deploy, dep || {}, { from: (dep && dep.from) || o.deploy.from || U.today() }); else if (f.status) o.deploy = blank().deploy;
            if (JSON.stringify(o) === before) { r.unchanged++; return; }
            Object.assign(ex, o, { updatedAt: Date.now() }); r.updated++;
          });
          if (Store.saveList('manpower', l) === false) return false;
          UI.importResult('Manpower uploaded', r, done);
        } }] });
    },
    exportXls(every) {
      UI.xls('Manpower', COLUMNS, every.map(m => [m.code, m.name, m.gender, m.dob, m.father, m.phone, m.trade, m.category, skillsOf(m).join(', '), m.experience, m.education, m.languages, m.engagement, m.doj, statusName(statusOf(m)), m.deploy.client, m.deploy.site, m.deploy.from, m.deploy.till, m.deploy.shift, m.payRate, m.billRate, (UNITS.find(u => u[0] === m.unit) || UNITS[0])[1], m.otRate,
        m.aadhaar, m.pan, m.uan, m.esiNo, m.bankName, m.bankAccount, m.bankIfsc, m.pv, m.pvTill, m.medicalTill, m.endsOn, m.address, m.emergency, m.notes]));
    },
    // The register of workmen in the columns of Form XIII (Contract Labour Central Rules, rule 75), one line a member
    registerRows(every) { return every.map((m, i) => { const last = m.history[m.history.length - 1], gone = statusOf(m) === 'inactive'; return [i + 1, m.name, [num(U.dateMs(m.dob)) ? Math.floor((todayMs() - U.dateMs(m.dob)) / (365.25 * 86400000)) + ' yrs' : '', m.gender].filter(Boolean).join(' / '), m.father, m.trade, m.address, m.deploy.client || m.deploy.site ? [m.deploy.client, m.deploy.site].filter(Boolean).join(', ') : '', m.doj, gone ? (last && last.to) || m.endsOn || '' : '', gone ? m.notes : '']; }); },
    register(every) {
      if (!every.length) { UI.toast('No members on the roster yet'); return; }
      UI.pdf('Register of Workmen', 'Employed by the contractor · in the columns of Form XIII · ' + every.length + ' member' + (every.length === 1 ? '' : 's') + ' as on ' + U.today(), ['Sl', 'Name and surname', 'Age / sex', 'Father\'s / husband\'s name', 'Nature of employment / designation', 'Permanent home address', 'Deployed at (principal employer, site)', 'Date of commencement', 'Date of termination', 'Reasons / remarks'], this.registerRows(every), { widths: ['4%', '14%', '7%', '12%', '12%', '17%', '14%', '7%', '7%', '6%'] });
    }
  };

  App.routes.manpower = (p) => { p = p || {}; if (!p.tab) p.tab = 'members'; Manpower.screen(p); App.markNav('manpower', { tab: p.tab }); };
  global.Manpower = Manpower;
})(window);
