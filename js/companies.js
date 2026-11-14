/* BlitzBook web portal - companies, company groups, members with roles, and the group (consolidated) statements.

   One account can keep the books of several companies (server/supabase/companies.sql). The account's first company
   is the one it always had; further companies are made under Companies, and each may be put in a group ("Sharma
   Group") for the consolidated statements. Other accounts are given a role in a company (owner, admin, accountant,
   sales, viewer) and then see it in their own Companies list; the server enforces the role on every record, this
   file hides what a role cannot do.

   Every company has its own namespace in the browser's storage (Store.open), its own sync state and its own local
   copy of the books; switching company switches the namespace and restarts sync. The group statements pull the
   latest books of every company in the group into their namespaces and add the statements up, column by
   column, with an eliminations column for dealings between the companies of the group. */
(function (global) {
  'use strict';
  const { esc, money } = U;
  // In order of rank: who may do what for whom (approvals go up this line, never to oneself)
  const ROLES = ['owner', 'admin', 'manager', 'hr', 'accountant', 'sales', 'employee', 'viewer'];
  const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', accountant: 'Accountant', sales: 'Sales', manager: 'Manager', hr: 'HR', employee: 'Employee', viewer: 'Viewer' };
  const ROLE_HELP = {
    owner: 'Everything, including members, the subscription and deleting the company',
    admin: 'Everything in the books, the company profile and the members',
    accountant: 'The books: sales, purchases, stock, expenses, journal, receipts, payments, parties, items and the reports. Not HR & payroll, the company profile or members',
    sales: 'Invoices, challans, credit / debit notes and receipts for the customers assigned to them (and the ones they add), items; the Web Clock for themselves (a steward or a cashier)',
    employee: 'Their own login: clocks in and out, fills their timesheet, raises their claims; approves the timesheets and claims of the people who report to them; sees nothing else',
    manager: 'The HR screens, and approves timesheets and reimbursements; sees nothing of the books',
    hr: 'Employees, attendance, timesheets, reimbursements, payroll and HR settings; cannot approve; sees nothing of the books',
    viewer: 'Looks at everything, changes nothing'
  };
  // The collections a role may change (null = all); the server applies the same rule to every record
  const WRITES = { owner: null, admin: null, accountant: ['contacts', 'items', 'invoices', 'challans', 'purchases', 'procure', 'inventory', 'manpower', 'stays', 'hk', 'hotel', 'expenses', 'journal', 'notes', 'accounts', 'clock'], sales: ['invoices', 'challans', 'notes', 'contacts', 'items', 'journal', 'stays', 'hk'], employee: ['clock', 'timesheets', 'reimbursements'], manager: ['employees', 'attendance', 'clock', 'timesheets', 'reimbursements', 'payroll', 'hr'], hr: ['employees', 'attendance', 'clock', 'timesheets', 'reimbursements', 'payroll', 'hr'], viewer: [] };
  // The screens a role may open (null = all)
  const OPENS = { owner: null, admin: null,
    accountant: ['dashboard', 'hotel', 'invoice', 'sales', 'challans', 'notes', 'contacts', 'items', 'stock', 'inventory', 'manpower', 'purchases', 'procurement', 'expenses', 'journal', 'money', 'salesReport', 'aging', 'payables', 'ledger', 'pnl', 'balance', 'backup', 'gst', 'migrate', 'companies', 'group', 'sync', 'company', 'subscription', 'clock', 'payslips', 'pro', 'currency'],   // sales, purchases, stock and accounts; HR & payroll are the HR roles'
    manager: ['dashboard', 'payslips', 'employees', 'attendance', 'leave', 'clock', 'timesheets', 'reimbursements', 'payroll', 'hrsettings', 'companies', 'sync', 'company', 'subscription'],
    hr: ['dashboard', 'payslips', 'employees', 'attendance', 'leave', 'clock', 'timesheets', 'reimbursements', 'payroll', 'hrsettings', 'companies', 'sync', 'company', 'subscription'],
    employee: ['dashboard', 'payslips', 'clock', 'timesheets', 'reimbursements', 'leave', 'companies', 'sync', 'company', 'subscription'],
    // Every member may open the Web Clock to clock themselves in and out (the login on their employee record)
    sales: ['dashboard', 'payslips', 'hotel', 'invoice', 'sales', 'challans', 'notes', 'contacts', 'items', 'money', 'salesReport', 'aging', 'ledger', 'clock', 'companies', 'sync', 'company', 'subscription', 'currency'],
    viewer: ['dashboard', 'payslips', 'hotel', 'invoice', 'sales', 'challans', 'notes', 'contacts', 'items', 'stock', 'inventory', 'manpower', 'purchases', 'procurement', 'expenses', 'journal', 'money', 'salesReport', 'aging', 'payables', 'ledger', 'pnl', 'balance', 'clock', 'companies', 'group', 'sync', 'company', 'subscription', 'currency'] };
  // The dashboard tiles a role gets (null = all)
  const TILES_NOT = { accountant: ['hr', 'timesheets', 'reimbursements', 'leave'] };   // tiles a role does not get out of all of them
  const TILES = { owner: null, admin: null, accountant: null, sales: ['invoice', 'sales', 'hotel', 'clock', 'items', 'receipts', 'customers', 'reports'], manager: ['hr'], hr: ['hr'], employee: ['clock', 'timesheets', 'reimbursements', 'leave', 'payslips'], viewer: ['invoice', 'purchases', 'sales', 'hotel', 'items', 'manpower', 'expenses', 'receipts', 'payments', 'journal', 'customers', 'suppliers', 'reports'] };
  /* What a licence of a kind opens (licences.js; none assigned, or Accounts + HR: whatever the role does). Self Service
     is the employee's own screens, HR the HR screens, Accounts everything but the HR screens; the Web Clock and one's
     own payslips come with every kind. */
  const HR_ROUTES = ['employees', 'attendance', 'leave', 'timesheets', 'reimbursements', 'payroll', 'hrsettings'], HR_COLS = ['employees', 'attendance', 'timesheets', 'reimbursements', 'payroll', 'hr'];
  const COLLECTIONS = ['contacts', 'items', 'invoices', 'challans', 'purchases', 'procure', 'inventory', 'manpower', 'stays', 'hk', 'hotel', 'expenses', 'journal', 'notes', 'accounts', 'company', 'employees', 'attendance', 'clock', 'timesheets', 'reimbursements', 'payroll', 'hr'];
  /* Custom roles and the hierarchy. The books of a company carry one 'roles' record:
       { roles: [{ id, name, base, parent, modules, rights, ro }], assign: { 'u:<account id>' | 'p:<mobile, last ten digits>' | 'e:<email>': role id }, parents: { built-in role: the role it reports to },
         builtin: { built-in role: { rights, modules } } }
     A custom role works like its base role (the server holds the member to the base), with a name of its own, a
     place in the hierarchy and, when modules are ticked, only those parts of the portal. A built-in role (Admin,
     Accountant, Sales ...) can be narrowed the same way: the rights ticked for it under builtin are what its members
     get, everything the role reaches while none are ticked off. ro lists the rights that are read only: the screens
     open, nothing in them is saved (a right not in ro is read and write). */
  /* Super Admin: a role every company has, between the owner and the admins. It works like Admin as far as the
     server goes (a custom role on the admin base with a fixed id), reports to the owner, and Admin reports to it.
     What it has over a plain admin is the admins themselves: only the owner or a Super Admin makes someone an Admin
     or a Super Admin, changes or removes one, and changes what those two roles see (Roles & hierarchy, Tab Access). */
  const SUPER = { id: 'superadmin', name: 'Super Admin', base: 'admin', parent: 'owner', modules: null, rights: null, ro: [] };
  const DEFAULT_PARENT = { admin: 'superadmin', manager: 'admin', accountant: 'admin', hr: 'manager', sales: 'manager', employee: 'manager', viewer: 'accountant' };
  const MODULES = [
    { key: 'sales', t: 'Sales', routes: ['invoice', 'sales', 'challans', 'notes', 'salesReport', 'aging', 'contacts', 'money'], cols: ['invoices', 'challans', 'notes', 'contacts', 'items', 'journal'], tiles: ['invoice', 'sales', 'customers', 'receipts', 'reports'] },
    { key: 'purchases', t: 'Purchases', routes: ['purchases', 'procurement', 'expenses', 'payables', 'contacts', 'money'], cols: ['purchases', 'procure', 'expenses', 'contacts', 'journal'], tiles: ['purchases', 'expenses', 'suppliers', 'payments'] },
    { key: 'inventory', t: 'Inventory', routes: ['items', 'stock', 'inventory'], cols: ['items', 'inventory'], tiles: ['items'] },
    // What an accounts person works with: the vouchers (receipts, payments, journal, expenses) and the books' reports
    { key: 'accounts', t: 'Accounts & reports', routes: ['journal', 'money', 'expenses', 'ledger', 'pnl', 'balance', 'group', 'payables'], cols: ['journal', 'accounts', 'expenses'], tiles: ['journal', 'receipts', 'payments', 'expenses', 'reports'] },
    { key: 'hr', t: 'HR & payroll', routes: ['employees', 'attendance', 'leave', 'timesheets', 'reimbursements', 'payroll', 'hrsettings'], cols: ['employees', 'attendance', 'timesheets', 'reimbursements', 'payroll', 'hr'], tiles: ['hr', 'timesheets', 'reimbursements', 'leave'] },
    { key: 'gst', t: 'GST & data', routes: ['gst', 'backup', 'migrate'], cols: [], tiles: ['migrate'] }
  ];
  /* The rights an owner or admin ticks one by one for a custom role ({ rights: [keys] } on the role; none = everything
     its base reaches). Each names the screens it opens, the collections it may change and the dashboard tiles it
     brings; a screen, collection or tile that no right names is not narrowed. The app keeps the same keys
     (MainActivity, RIGHTS). A role saved before rights existed is still narrowed by its modules. */
  const R = (key, t, mod, routes, cols, tiles) => ({ key, t, mod, routes, cols, tiles });
  const RIGHTS = [
    R('invoice', 'Invoices', 'sales', ['invoice', 'sales'], ['invoices', 'contacts', 'items', 'journal'], ['invoice', 'sales']),
    R('challans', 'Delivery challans', 'sales', ['challans'], ['challans', 'contacts', 'items'], []),
    R('notes', 'Credit / debit notes', 'sales', ['notes'], ['notes', 'journal'], ['cnotes', 'dnotes']),
    R('customers', 'Customers', 'sales', ['contacts'], ['contacts'], ['customers']),
    R('receipts', 'Receipts', 'sales', ['money'], ['journal'], ['receipts']),
    R('salesReport', 'Sales Report', 'sales', ['salesReport'], [], ['reports']),
    R('aging', 'Outstanding & ageing', 'sales', ['aging'], [], ['reports']),
    // The front desk of a hotel (hotel.js): reservations, check-in and out, the folio and housekeeping; the rooms, rates and
    // settings record ('hotel') is the owner's, an admin's and an accountant's
    // (the tax invoice at check-out is made on the Invoices screen: the front desk needs the Invoices right as well)
    R('hotel', 'Hotel front desk', 'sales', ['hotel'], ['stays', 'hk'], ['hotel']),
    R('purchases', 'Purchases & quotations', 'purchases', ['purchases'], ['purchases', 'contacts', 'items', 'journal'], ['purchases']),
    R('procurement', 'Procurement', 'purchases', ['procurement'], ['procure'], []),
    R('suppliers', 'Suppliers', 'purchases', ['contacts'], ['contacts'], ['suppliers']),
    R('expenses', 'Expenses', 'purchases', ['expenses'], ['expenses', 'journal'], ['expenses']),
    R('payments', 'Payments', 'purchases', ['money'], ['journal'], ['payments']),
    R('payables', 'Supplier outstanding', 'purchases', ['payables'], [], ['reports']),
    R('items', 'Items', 'inventory', ['items'], ['items'], ['items']),
    R('stock', 'Stock & inventory', 'inventory', ['stock', 'inventory'], ['inventory', 'items'], ['items']),
    R('journal', 'Journal', 'accounts', ['journal'], ['journal', 'accounts'], ['journal']),
    R('ledger', 'Party Ledger', 'accounts', ['ledger'], [], ['reports']),
    R('pnl', 'Profit & Loss', 'accounts', ['pnl'], [], ['reports']),
    R('balance', 'Balance Sheet', 'accounts', ['balance'], [], ['reports']),
    R('group', 'Group statements', 'accounts', ['group'], [], ['reports']),
    R('employees', 'Employees', 'hr', ['employees'], ['employees'], ['hr']),
    R('attendance', 'Attendance', 'hr', ['attendance'], ['attendance'], ['hr']),
    R('timesheets', 'Timesheets', 'hr', ['timesheets'], ['timesheets'], ['timesheets', 'hr']),
    R('reimbursements', 'Reimbursements & leave requests', 'hr', ['reimbursements', 'leave'], ['reimbursements'], ['reimbursements', 'leave', 'hr']),
    R('payroll', 'Payroll', 'hr', ['payroll'], ['payroll'], ['hr']),
    R('hrsettings', 'HR settings', 'hr', ['hrsettings'], ['hr'], ['hr']),
    R('gst', 'GST returns', 'gst', ['gst'], [], []),
    R('backup', 'Export / import', 'gst', ['backup'], [], []),
    R('migrate', 'Migrate from Tally / SAP', 'gst', ['migrate'], [], ['migrate'])
  ];
  // The rights a base role can be given at all (the app's rightOffered is the same rule)
  const SALES_RIGHTS = ['hotel', 'invoice', 'challans', 'notes', 'customers', 'receipts', 'salesReport', 'aging', 'items', 'ledger'];
  const rightOffered = (base, r) => base === 'admin' || (base === 'accountant' && r.mod !== 'hr') || (base === 'viewer' && !['hr', 'gst'].includes(r.mod)) || (base === 'sales' && SALES_RIGHTS.includes(r.key)) || (['manager', 'hr'].includes(base) && r.mod === 'hr');
  // A role saved with modules only: the rights those modules held (Accounts also carried receipts, payments, expenses and supplier outstanding)
  const ACCOUNTS_EXTRA = ['receipts', 'payments', 'expenses', 'payables'];
  // Tabs that are never taken away (the way back into the company, the account and this very screen), and the menu
  // entries behind each dashboard tile
  const TAB_ALWAYS = ['dashboard', 'company', 'business', 'companies', 'tabaccess', 'subscription', 'sync', 'licences', 'ai'];
  const TILE_TABS = { hotel: ['hotel'], invoice: ['invoice'], sales: ['sales'], purchases: ['purchases', 'procurement'], manpower: ['manpower'], items: ['items', 'stock', 'inventory'], expenses: ['expenses'], receipts: ['money'], payments: ['money'], journal: ['journal'], customers: ['contacts:Customer'], suppliers: ['contacts:Supplier'],
    reports: ['salesReport', 'aging', 'ledger', 'pnl', 'balance', 'group'], hr: ['employees', 'attendance', 'leave', 'timesheets', 'reimbursements', 'payroll', 'hrsettings'], clock: ['clock'], migrate: ['migrate'], timesheets: ['timesheets'], reimbursements: ['reimbursements'], leave: ['leave'], payslips: ['payslips'], cnotes: ['notes:CN'], dnotes: ['notes:DN'] };
  const SUB_KEYS =['registered_at', 'valid_until', 'used_codes', 'inv_quota', 'inv_used', 'inv_until', 'yearly_until', 'full_until'];
  const lower = (s) => String(s == null ? '' : s).trim().toLowerCase();

  const Companies = {
    ROLES, ROLE_LABEL, ROLE_HELP, MODULES, RIGHTS, TILE_TABS,
    // ---- the account's companies, as last fetched (kept in the account's own namespace, so they are known offline)
    list() { return App.user ? (Store.peek(App.user.id, 'companies', []) || []) : []; },
    keep(list) { if (App.user) Store.poke(App.user.id, 'companies', list); },
    find(cid) { return this.list().find(c => c.id === cid) || null; },
    // The company whose books are open now
    current() { return Store.cid ? this.find(Store.cid) : (this.list().find(c => c.primary && c.role === 'owner') || null); },
    currentName() { const c = this.current(); return c && c.name ? c.name : Store.company().name; },
    isPrimary() { return !Store.cid; },
    /* Someone invited into a company who keeps no books of their own (their first company was never set up, and they
       own no other) is not offered that empty company: with one company to work in there is nothing to switch to. */
    ownSetUp() { const l = this.list(), own = l.find(c => c.primary && c.role === 'owner'); return !!(own && own.name) || l.some(c => c.role === 'owner' && !c.primary) || !!(App.user && (Store.peek(App.user.id, 'company', {}) || {}).name); },
    switchable() { const l = this.list(); return this.ownSetUp() ? l : l.filter(c => !(c.primary && c.role === 'owner')); },
    canSwitch() { return this.switchable().length > 1; },
    role() { if (!Store.cid) return 'owner'; const c = this.find(Store.cid); return c && ROLES.includes(c.role) ? c.role : 'viewer'; },
    roleLabel() { const c = this.myCustom(); return c ? c.name : ROLE_LABEL[this.role()]; },

    // ---- custom roles and the hierarchy (of the company that is open)
    rolesDoc() { const d0 = Store.get('roles', null) || {}, list = Array.isArray(d0.roles) ? d0.roles : [], d = Object.assign({}, d0, { roles: list.some(r => r && r.id === SUPER.id) ? list.map(r => r && r.id === SUPER.id ? Object.assign({}, r, { base: 'admin', parent: 'owner', name: String(r.name || '').trim() || SUPER.name }) : r) : [Object.assign({}, SUPER)].concat(list) }); return { roles: Array.isArray(d.roles) ? d.roles.filter(r => r && r.id && !ROLES.includes(r.id) && String(r.name || '').trim() && ROLES.includes(r.base) && r.base !== 'owner') : [], assign: d.assign && typeof d.assign === 'object' ? Object.assign({}, d.assign) : {}, parents: d.parents && typeof d.parents === 'object' ? Object.assign({}, d.parents) : {}, builtin: d.builtin && typeof d.builtin === 'object' ? Object.assign({}, d.builtin) : {}, hide: d.hide && typeof d.hide === 'object' ? Object.assign({}, d.hide) : {}, salesAll: d.salesAll === true }; },
    saveRolesDoc(d) { if (!d.parents.admin) d.parents.admin = SUPER.id; return Store.set('roles', { roles: d.roles, assign: d.assign, parents: d.parents, builtin: d.builtin || {}, hide: d.hide || {}, salesAll: d.salesAll === true }); },
    customRoles() { return this.rolesDoc().roles; },
    SUPER_ID: SUPER.id,
    // The owner, or a member who was made Super Admin: the ones who decide about the admins
    isSuper() { if (!Store.cid || this.role() === 'owner') return true; const c = this.myCustom(); return this.role() === 'admin' && !!c && c.id === SUPER.id; },
    // A role only the owner or a Super Admin gives, changes or takes away: Admin and Super Admin
    adminRole(id) { return id === 'admin' || id === SUPER.id || id === 'c:' + SUPER.id; },
    // The modules a base role reaches at all: what a custom role on that base may be narrowed to
    modulesOf(base) { const o = OPENS[base]; return MODULES.filter(m => !o || m.routes.some(r => o.includes(r))); },
    rightsOf(base) { return RIGHTS.filter(r => rightOffered(base, r)); },
    // The rights a role has: its own list, else what its modules held, else every right its base is offered
    rightsHeld(r) {
      const offered = this.rightsOf(r.base).map(x => x.key);
      if (Array.isArray(r.rights)) return offered.filter(k => r.rights.includes(k));
      if (!Array.isArray(r.modules)) return offered;
      return RIGHTS.filter(x => offered.includes(x.key) && (r.modules.includes(x.mod) || (r.modules.includes('accounts') && ACCOUNTS_EXTRA.includes(x.key)))).map(x => x.key);
    },
    allRoles() {
      const d = this.rolesDoc();
      const own = (r, k) => { const b = r === 'owner' ? null : d.builtin[r]; return b && Array.isArray(b[k]) ? b[k] : null; };
      return ROLES.map(r => ({ id: r, name: ROLE_LABEL[r], base: r, custom: false, parent: r === 'owner' ? '' : (d.parents[r] || DEFAULT_PARENT[r]), modules: own(r, 'modules'), rights: own(r, 'rights'), ro: own(r, 'ro') || [] }))
        .concat(d.roles.map(r => ({ id: r.id, name: String(r.name).trim(), base: r.base, custom: true, parent: r.parent || DEFAULT_PARENT[r.base] || 'owner', modules: Array.isArray(r.modules) ? r.modules : null, rights: Array.isArray(r.rights) ? r.rights : null, ro: Array.isArray(r.ro) ? r.ro : [] })));
    },
    // Every role in reporting order with its depth under the owner; a line that does not reach the owner hangs under the owner
    hierarchy() {
      const all = this.allRoles(), by = new Map(all.map(r => [r.id, r]));
      const reaches = (r) => { let p = r.parent; const seen = new Set([r.id]); while (p && p !== 'owner') { if (seen.has(p) || !by.has(p)) return false; seen.add(p); p = by.get(p).parent; } return p === 'owner'; };
      all.forEach(r => { if (r.id !== 'owner' && !reaches(r)) r.parent = 'owner'; });
      const out = [], walk = (id, depth) => { out.push(Object.assign({ depth }, by.get(id))); all.filter(x => x.parent === id).forEach(x => walk(x.id, depth + 1)); };
      walk('owner', 0);
      return out;
    },
    // The roles under a role, all the way down
    below(id) { const h = this.hierarchy(), at = h.findIndex(r => r.id === id), out = []; if (at < 0) return out; for (let i = at + 1; i < h.length && h[i].depth > h[at].depth; i++) out.push(h[i].id); return out; },
    assignKeys(m) { const out = []; if (m.user_id) out.push('u:' + m.user_id); const p = String(m.phone || '').replace(/\D/g, '').slice(-10); if (p.length === 10) out.push('p:' + p); const e = lower(m.email); if (e) out.push('e:' + e); return out; },
    // The custom role a member was given, while its base is still the role the server has for them
    customOf(m, role) { const d = this.rolesDoc(); if (!d.roles.length) return null; for (const k of this.assignKeys(m)) { const r = d.roles.find(x => x.id === d.assign[k]); if (r && (!role || r.base === role)) return r; } return null; },
    myCustom() { if (!Store.cid || !App.user) return null; if (!Store.get('roles', null)) return null; return this.customOf({ user_id: this.myUid(), phone: App.user.phone, email: App.user.email }, this.role()); },
    setCustom(m, id) { const d = this.rolesDoc(); this.assignKeys(m).forEach(k => { if (id) d.assign[k] = id; else delete d.assign[k]; }); return this.saveRolesDoc(d); },
    // What narrows the member: the custom role they were given, else the rights ticked for their built-in role (null: nothing does)
    myNarrow() {
      if (!Store.cid || !App.user || !Store.get('roles', null)) return null;
      const c = this.myCustom(); if (c) return c;
      const role = this.role(), b = role === 'owner' ? null : this.rolesDoc().builtin[role];
      return b && (Array.isArray(b.rights) || Array.isArray(b.modules) || (Array.isArray(b.ro) && b.ro.length)) ? b : null;
    },
    // A role with rights (or, saved before rights, modules) ticked sees only those parts (a screen, a collection or a tile outside every one of them is not narrowed)
    narrowed(kind, key) { return this.narrowedBy(this.myNarrow(), kind, key); },
    narrowedBy(c, kind, key) {
      if (!c) return true;
      // Saving needs a right that covers the collection and is not read only
      const ro = Array.isArray(c.ro) ? c.ro : [];
      if (Array.isArray(c.rights) || ro.length) { const rs = RIGHTS.filter(r => r[kind].includes(key)); return !rs.length || rs.some(r => (!Array.isArray(c.rights) || c.rights.includes(r.key)) && !(kind === 'cols' && ro.includes(r.key))); }
      if (!Array.isArray(c.modules)) return true;
      const mods = MODULES.filter(m => m[kind].includes(key)); return !mods.length || mods.some(m => c.modules.includes(m.key));
    },
    /* ---- Tab access: which tabs of the menu each role is shown (Company > Tab Access, the owner and the admins).
       hide on the roles record: { role id (built-in or custom): [tab ids] }. A tab id is the screen of the menu entry,
       with its first parameter when several entries share a screen ('notes:CN', 'contacts:Supplier', 'inventory:count').
       A tab that is hidden leaves the menu and the dashboard of every member with that role, in the portal and in the
       app, and the screen is refused when all its entries are hidden. It only takes away: what a role reaches at all is
       its own (and the server's) rule, and the owner always sees everything. */
    tabId(it) { const v = it && it.params ? Object.keys(it.params).map(k => it.params[k])[0] : ''; return it.key + (v ? ':' + v : ''); },
    // The tabs taken away from the login in the company that is open
    tabsHidden() {
      if (!Store.cid || !App.user || this.role() === 'owner') return [];
      const d = Store.get('roles', null); if (!d || !d.hide || typeof d.hide !== 'object') return [];
      const c = this.myCustom(), l = d.hide[c ? c.id : this.role()];
      return Array.isArray(l) ? l : [];
    },
    tabOff(it) { const h = this.tabsHidden(); return h.length > 0 && h.includes(this.tabId(it)); },
    // Every menu entry that is one of these screens ('manpower' matches 'manpower:members' too)
    tabIds(specs) { const out = []; (App.nav ? App.nav() : []).forEach(g => (g.items || [g]).forEach(it => { const id = this.tabId(it); if (specs.some(sp => id === sp || id.indexOf(sp + ':') === 0)) out.push(id); })); return out; },
    // A screen is shut when every menu entry that opens it is hidden (with params: the entry those params name)
    routeOff(route, params) {
      const h = this.tabsHidden(); if (!h.length || TAB_ALWAYS.includes(route)) return false;
      const v = params && typeof params === 'object' ? Object.keys(params).map(k => params[k])[0] : '';
      if (v && h.includes(route + ':' + v)) return true;
      const ids = this.tabIds([route]); return ids.length > 0 && ids.every(id => h.includes(id));
    },
    tileOff(key) { const h = this.tabsHidden(); if (!h.length || !TILE_TABS[key]) return false; const ids = this.tabIds(TILE_TABS[key]); return ids.length > 0 && ids.every(id => h.includes(id)); },
    // Whether a role (as allRoles gives it) reaches a screen at all: its base role, and the rights ticked for it
    roleReaches(r, route) { if (route === 'leave' || route === 'hrpolicy') return true; const o = OPENS[r.base]; return (!o || o.includes(route)) && this.narrowedBy(r.rights || r.modules || (r.ro && r.ro.length) ? r : null, 'routes', route); },
    tabsScreen() {
      const manage = ['owner', 'admin'].includes(this.role()) && this.yearly() && this.mayWrite('roles');
      const roles = this.hierarchy().filter(r => r.id !== 'owner'), d = this.rolesDoc(), sup = this.isSuper();
      // Only the groups the company's businesses show (business.js): a group that is off is off for every role
      const groups = (App.nav ? App.nav() : []).filter(g => !global.Business || !g.items || Business.shown(g.t)).map(g => ({ t: g.t, items: (g.items || []).filter(it => !TAB_ALWAYS.includes(it.key)) })).filter(g => g.items.length);
      const off = (r, id) => Array.isArray(d.hide[r.id]) && d.hide[r.id].includes(id);
      const cell = (r, it) => { const id = this.tabId(it); if (!this.roleReaches(r, it.key)) return '<td style="text-align:center" title="' + esc(r.name) + ' does not reach this tab at all (Roles & hierarchy decides what a role works with)"><span class="muted">&ndash;</span></td>';
        return '<td style="text-align:center"><input type="checkbox" class="taTick" data-role="' + esc(r.id) + '" data-tab="' + esc(id) + '"' + (off(r, id) ? '' : ' checked') + (manage && (sup || !this.adminRole(r.id)) ? '' : ' disabled') + ' title="' + esc(it.t + ' for ' + r.name) + '"></td>'; };
      const root = App.view(App.header('Tab Access', '<div class="btnrow" style="margin:0"><button class="btn sm outline" id="taRoles">Roles &amp; hierarchy</button>' + (manage ? '<button class="btn sm outline" id="taAll">Show all</button><button class="btn sm green" id="taSave">Save</button>' : '') + '</div>') +
        '<div class="hint" style="margin-bottom:10px">Tick the tabs each role is shown in <b>' + esc(this.currentName() || 'this company') + '</b>; an unticked tab leaves the menu and the dashboard of every member with that role, in the web portal and in the app. The owner always sees everything. A dash means the role does not reach that tab at all: what a role works with is set under Roles &amp; hierarchy.' + (manage ? '' : ' Only the owner or an admin can change this.') + '</div>' +
        '<div class="tablewrap pin"><table class="list" id="taTable"><thead><tr><th>Tab</th>' + roles.map(r => '<th style="text-align:center;white-space:nowrap">' + esc(r.name) + (manage ? '<div><input type="checkbox" class="taCol" data-role="' + esc(r.id) + '" title="Every tab for ' + esc(r.name) + '"></div>' : '') + '</th>').join('') + '</tr></thead><tbody>' +
        groups.map(g => '<tr class="grp"><td colspan="' + (roles.length + 1) + '"><b>' + esc(g.t) + '</b></td></tr>' + g.items.map(it => '<tr><td style="white-space:nowrap">' + esc(it.t) + '</td>' + roles.map(r => cell(r, it)).join('') + '</tr>').join('')).join('') + '</tbody></table></div>');
      App.wireBack(root);
      const ticks = () => $$('.taTick', root), cols = () => $$('.taCol', root).forEach(c => { const mine = ticks().filter(t => t.dataset.role === c.dataset.role); c.checked = mine.length > 0 && mine.every(t => t.checked); c.disabled = !mine.length || mine.every(t => t.disabled); });
      cols();
      ticks().forEach(t => t.onchange = cols);
      $$('.taCol', root).forEach(c => c.onchange = () => { ticks().filter(t => t.dataset.role === c.dataset.role && !t.disabled).forEach(t => { t.checked = c.checked; }); });
      $('#taRoles').onclick = () => { const rb = this.rolesDialog(); const mo = new MutationObserver(() => { if (!rb.isConnected) { mo.disconnect(); if (App.current && App.current.route === 'tabaccess') this.tabsScreen(); } }); mo.observe($('#dialogs'), { childList: true }); };
      if (!manage) return;
      $('#taAll').onclick = () => { ticks().forEach(t => { if (!t.disabled) t.checked = true; }); cols(); };
      $('#taSave').onclick = () => {
        const doc = this.rolesDoc(), hide = {};
        // What is unticked here; a tab hidden earlier that is not on this screen now (another kind of company) stays hidden
        const shown = new Set(ticks().map(t => t.dataset.role + '|' + t.dataset.tab));
        Object.keys(doc.hide).forEach(rid => { if (roles.some(r => r.id === rid)) (Array.isArray(doc.hide[rid]) ? doc.hide[rid] : []).forEach(id => { if (!shown.has(rid + '|' + id)) (hide[rid] = hide[rid] || []).push(id); }); });
        ticks().forEach(t => { if (!t.checked) (hide[t.dataset.role] = hide[t.dataset.role] || []).push(t.dataset.tab); });
        doc.hide = hide;
        if (this.saveRolesDoc(doc) === false) return;
        UI.toast('Tab access saved', 3000, 'ok'); App.refreshNav();
      };
    },
    isOpen(c) { return !!c && (Store.cid || '') === (c.primary && c.role === 'owner' ? '' : c.id); },
    seesText(r) { const ro = r.ro || []; if (r.base === 'owner' || (r.base === 'admin' && !r.modules && !r.rights && !ro.length)) return 'Everything'; if (r.base === 'employee') return 'Own clock, timesheet, claims, payslips';
      if (r.rights || ro.length) { const held = this.rightsHeld(r), out = [], name = (x) => x.t + (ro.includes(x.key) && x.cols.length ? ' - read only' : ''); MODULES.forEach(m => { const all = this.rightsOf(r.base).filter(x => x.mod === m.key), on = all.filter(x => held.includes(x.key)); if (on.length) out.push(on.length === all.length && !on.some(x => ro.includes(x.key)) ? m.t : on.length === all.length && on.every(x => ro.includes(x.key) || !x.cols.length) ? m.t + ' - read only' : m.t + ' (' + on.map(name).join(', ') + ')'); }); return (r.base === 'viewer' ? 'Read only: ' : '') + (out.join('; ') || '-'); }
      const mods = this.modulesOf(r.base).filter(m => !r.modules || r.modules.includes(m.key)); return (r.base === 'viewer' ? 'Read only: ' : '') + (mods.map(m => m.t).join(', ') || '-'); },
    rolesDialog() {
      const manage = ['owner', 'admin'].includes(this.role()) && this.yearly();
      const bg = UI.modal({ title: 'Roles & hierarchy', wide: true, focus: false, body: '<div id="rlList"></div>', buttons: [{ label: 'Close', cls: 'outline' }].concat(manage ? [{ label: '+ New role', cls: 'green', onClick: () => { this.editRole(null, draw); return false; } }] : []) });
      const draw = () => {
        if (!bg.isConnected) return;
        const h = this.hierarchy(), name = new Map(h.map(r => [r.id, r.name]));
        $('#rlList', bg).innerHTML = '<table class="list"><thead><tr><th>Role</th><th>Works like</th><th>Reports to</th><th>Sees</th>' + (manage ? '<th></th>' : '') + '</tr></thead><tbody>' + h.map(r => '<tr data-role-id="' + esc(r.id) + '"><td style="white-space:nowrap"><span style="display:inline-block;width:' + (r.depth * 20) + 'px"></span>' + (r.depth ? '<span class="muted">└ </span>' : '') + '<span class="pill ' + (r.id === 'owner' ? 'ok' : r.custom ? 'warn' : '') + '">' + esc(r.name) + '</span></td><td>' + (r.custom ? esc(ROLE_LABEL[r.base]) : '<span class="muted">Built in</span>') + '</td><td>' + esc(name.get(r.parent) || '-') + '</td><td>' + esc(this.seesText(r)) + '</td>' +
          (manage ? '<td class="actions">' + (r.id === 'owner' || (this.adminRole(r.id) && !this.isSuper()) ? '' : '<button class="btn sm outline" data-edit-role="' + esc(r.id) + '">Edit</button>') + (r.custom && r.id !== SUPER.id ? '<button class="btn sm red" data-del-role="' + esc(r.id) + '">Delete</button>' : '') + '</td>' : '') + '</tr>').join('') + '</tbody></table>';
        $$('[data-edit-role]', bg).forEach(b => b.onclick = () => this.editRole(this.hierarchy().find(r => r.id === b.dataset.editRole), draw));
        $$('[data-del-role]', bg).forEach(b => b.onclick = () => { const r = this.hierarchy().find(x => x.id === b.dataset.delRole); UI.confirm('Delete role', 'Delete the role ' + r.name + '? Its members keep working as ' + ROLE_LABEL[r.base] + '.', () => {
          const d = this.rolesDoc(); d.roles = d.roles.filter(x => x.id !== r.id); d.roles.forEach(x => { if (x.parent === r.id) x.parent = r.parent; }); Object.keys(d.parents).forEach(k => { if (d.parents[k] === r.id) d.parents[k] = r.parent; }); Object.keys(d.assign).forEach(k => { if (d.assign[k] === r.id) delete d.assign[k]; });
          if (this.saveRolesDoc(d) !== false) UI.toast('Role deleted'); draw(); App.refreshNav();
        }, 'Delete'); });
      };
      draw();
      return bg;
    },
    // A new custom role, a custom role's name / reporting line / rights, or the reporting line and the rights of a built-in role
    editRole(r, done) {
      const custom = !r || r.custom, all = this.hierarchy(), under = r ? this.below(r.id) : [];
      const parents = all.filter(x => !r || (x.id !== r.id && !under.includes(x.id))).map(x => [x.id, x.name]);
      // One tick per right, under its module's heading; a heading's own tick sets or clears all of it
      // Beside each tick: Read / Write or Read only, for the things that can be saved at all (a viewer only reads, a report is only read)
      const rw = (base, x, ro) => base === 'viewer' || !x.cols.length ? '' : '<select class="rlRw" data-key="' + x.key + '" title="Read / Write: open and save. Read only: open, nothing is saved." style="min-height:28px;padding:2px 6px;margin-left:6px;width:auto;font-size:12px"><option value="w">Read / Write</option><option value="r"' + (ro && ro.includes(x.key) ? ' selected' : '') + '>Read only</option></select>';
      const mods = (base, held, ro) => MODULES.map(m => { const rs = this.rightsOf(base).filter(x => x.mod === m.key); if (!rs.length) return ''; const on = rs.filter(x => !held || held.includes(x.key)).length;
        return '<div class="rlGrp" style="margin:6px 0 8px"><label class="check" style="font-weight:600"><input type="checkbox" class="rlAll" data-mod="' + m.key + '"' + (on === rs.length ? ' checked' : '') + '> ' + esc(m.t) + '</label><div style="padding-left:22px">' +
          rs.map(x => '<span style="margin:0 16px 4px 0;display:inline-flex;align-items:center"><label class="check" style="display:inline-flex"><input type="checkbox" class="rlMod" data-mod="' + m.key + '" value="' + x.key + '"' + (!held || held.includes(x.key) ? ' checked' : '') + '> ' + esc(x.t) + '</label>' + rw(base, x, ro) + '</span>').join('') + '</div></div>'; }).join('');
      const wire = (bg) => {
        const sync = () => $$('.rlRw', bg).forEach(s => { const c = $('.rlMod[value="' + s.dataset.key + '"]', bg); s.disabled = !c || !c.checked; });
        $$('.rlAll', bg).forEach(a => a.onchange = () => { $$('.rlMod[data-mod="' + a.dataset.mod + '"]', bg).forEach(c => { c.checked = a.checked; }); sync(); });
        $$('.rlMod', bg).forEach(c => c.onchange = () => { const all = $$('.rlMod[data-mod="' + c.dataset.mod + '"]', bg), a = $('.rlAll[data-mod="' + c.dataset.mod + '"]', bg); if (a) a.checked = all.every(x => x.checked); sync(); });
        sync();
      };
      // The rights set to Read only among the ones ticked
      const readOnly = (bg, ticked) => $$('.rlRw', bg).filter(s => s.value === 'r' && ticked.includes(s.dataset.key)).map(s => s.dataset.key);
      const base0 = r ? r.base : 'sales';
      const bg = UI.modal({ title: r ? 'Role: ' + r.name : 'New role', body: (custom ? UI.field('Role name', UI.input('rlName', r ? r.name : '', { placeholder: 'e.g. Store Manager, Cashier, Steward', attrs: ' maxlength="40"' }), { req: true }) +
          UI.field('Works like', UI.select('rlBase', ROLES.filter(x => x !== 'owner').map(x => [x, ROLE_LABEL[x]]), base0, r ? { attrs: ' disabled' } : {})) : '') +
          UI.field('Reports to', UI.select('rlParent', parents, r ? r.parent : 'admin')) +
          (this.rightsOf(base0).length || !r ? '<div class="field span"><label>What this role can access</label><div class="muted" style="font-size:12px;margin-bottom:4px">Tick what members with this role get, and choose Read / Write or Read only for each; anything left unticked is hidden from them in the portal and the app.' + (custom ? '' : ' ' + esc(ROLE_HELP[r.id]) + '.') + '</div><div id="rlMods">' + mods(base0, r ? this.rightsHeld(r) : null, r ? r.ro : null) + '</div></div>' :
            '<div class="field span"><label>What this role can access</label><div class="muted" style="font-size:12px">' + esc(ROLE_HELP[r.base]) + '.</div></div>') +
          (base0 === 'sales' || !r ? '<div class="field span" id="rlOwnBox"' + (base0 === 'sales' ? '' : ' style="display:none"') + '>' + UI.check('rlOwn', 'Sales people see only the customers assigned to them (and the ones they add), with their invoices and receipts', !this.rolesDoc().salesAll) + '<div class="muted" style="font-size:12px">A customer is assigned on the customer itself (Assigned to), or to several at once from the customer list. Untick to let every sales person see every customer. It applies to every role that works like Sales.</div></div>' : ''),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const d = this.rolesDoc(), parent = UI.val('rlParent', bg) || 'owner';
          if ($('#rlOwn', bg) && (r ? r.base : UI.val('rlBase', bg)) === 'sales') d.salesAll = !UI.val('rlOwn', bg);
          if (!custom) {
            // A built-in role keeps its name; the rights ticked off narrow it for every member who has it
            d.parents[r.id] = parent;
            const offered = this.rightsOf(r.id).map(x => x.key), ticked = $$('.rlMod', bg).filter(c => c.checked).map(c => c.value);
            if (offered.length && !ticked.length) { UI.toast('Tick at least one thing the role can access'); return false; }
            const ro = readOnly(bg, ticked), narrow = offered.length && ticked.length < offered.length;
            if (narrow || ro.length) d.builtin[r.id] = { rights: narrow ? ticked : null, modules: narrow ? MODULES.map(m => m.key).filter(k => RIGHTS.some(x => x.mod === k && ticked.includes(x.key))) : null, ro };
            else delete d.builtin[r.id];
          } else {
            const name = String(UI.val('rlName', bg)).trim().replace(/\s+/g, ' '), base = r ? r.base : UI.val('rlBase', bg);
            if (!name) { UI.mark('rlName', true, bg); UI.toast('Enter the role name'); return false; }
            if (this.allRoles().some(x => lower(x.name) === lower(name) && (!r || x.id !== r.id))) { UI.mark('rlName', true, bg); UI.toast('There is a role called ' + name + ' already'); return false; }
            const offered = this.rightsOf(base).map(x => x.key), ticked = $$('.rlMod', bg).filter(c => c.checked).map(c => c.value);
            if (offered.length && !ticked.length) { UI.toast('Tick at least one thing the role can access'); return false; }
            // Every right ticked: no narrowing. Else the rights, and the modules they touch for apps older than 1.27
            const rights = offered.length && ticked.length < offered.length ? ticked : null;
            const modules = rights ? MODULES.map(m => m.key).filter(k => RIGHTS.some(x => x.mod === k && rights.includes(x.key))) : null;
            const ro = readOnly(bg, ticked);
            if (r) Object.assign(d.roles.find(x => x.id === r.id), { name, parent, modules, rights, ro });
            else d.roles.push({ id: 'r' + U.uid(), name, base, parent, modules, rights, ro });
          }
          if (this.saveRolesDoc(d) === false) return false;
          UI.toast('Role saved'); App.refreshNav(); if (done) done();
        } }] });
      if ($('#rlBase', bg) && !r) $('#rlBase', bg).onchange = (e) => { $('#rlMods', bg).innerHTML = mods(e.target.value, null, null); wire(bg); if ($('#rlOwnBox', bg)) $('#rlOwnBox', bg).style.display = e.target.value === 'sales' ? '' : 'none'; };
      wire(bg);
      return bg;
    },
    // What the chip shows for a member: the designation on their employee record (Steward, Cashier), else the role
    memberLabel() { const e = global.HR && HR.myEmployee ? HR.myEmployee() : null; return e && e.designation && this.role() !== 'owner' ? e.designation : this.roleLabel(); },
    ownerOf(cid) { const c = cid ? this.find(cid) : null; return c ? c.owner_id : ''; },
    // Signed in to the Supabase project: a login with the server's token (sync may not have started yet, as on a reload that lands on this screen)
    available() { return !!global.Sync && Sync.isSupabase && Sync.isSupabase() && !!(Sync.user || (global.App && App.user)); },
    // Making companies, grouping them and managing members come with the yearly plan and longer, and with the 30-day
    // trial (the subscription of the company that is open: in another owner's company, the owner's). The group
    // statements need the paid yearly plan: they are the one thing the trial does not have. An invoice pack has none
    // of this. Opening a company one was invited to is always possible.
    // ... and with licences: an owner who has seats running manages members for them
    yearly() { return (Sub.isYearly() && !Sub.isLite()) || (!!global.Lic && Lic.seats() > 0); },
    groupAllowed() { return Sub.isYearlyPaid() && !Sub.isLite(); },
    lock() {
      UI.modal({ title: 'Yearly subscription required', body: '<div class="gstlock"><div class="big">🔒</div><div><p>Companies, groups, members and group statements come with the yearly plan and longer. ' + esc(Sub.statusText()) + '.</p></div></div>',
        buttons: [{ label: 'Close', cls: 'outline' }, { label: 'Buy yearly plan', cls: 'blue', onClick: () => { if (!Store.cid) Subscription.plans(); else if (Companies.canSwitch()) Companies.switcher(); else UI.toast('This company runs on the subscription of its owner: ask them to buy the yearly plan', 5000); } }] });
      return false;
    },
    // The account's own id on the server, from the token
    myUid() { try { const t = Sync.state().token; return JSON.parse(atob(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || ''; } catch (e) { return ''; } },

    /* ---- a sales person and the customers assigned to them. A login with the Sales role (or a custom role that works
       like it) sees only the customers assigned to it, by its mobile number or email on the customer (assignedTo),
       and the ones it adds itself; the invoices, challans, notes and receipts of those customers; nothing of the
       purchases and expenses. The owner or an admin can let the sales people see every customer instead (Roles &
       hierarchy > Sales: salesAll on the roles record). Store.scope applies it to every list read and saved. */
    myKeys() { const u = App.user || {}, p = String(u.phone || '').replace(/\D/g, '').slice(-10), e = lower(u.email); return [p.length === 10 ? p : '', e].filter(Boolean); },
    salesOwn() { if (!Store.cid || !App.user || this.role() !== 'sales') return false; return (Store.get('roles', null) || {}).salesAll !== true; },
    scopeOf(k) {
      if (!['contacts', 'invoices', 'challans', 'notes', 'journal', 'purchases', 'expenses'].includes(k) || !this.salesOwn()) return null;
      const me = this.myKeys(), mine = (r) => !!r && me.includes(lower(r.sp)), tag = (r) => { r.sp = me[0] || ''; };
      if (k === 'purchases' || k === 'expenses') return { visible: () => false, tag };
      const assigned = (c) => !!c && (mine(c) || (Array.isArray(c.assignedTo) && c.assignedTo.some(x => me.includes(lower(x)))));
      if (k === 'contacts') return { visible: assigned, tag: (r) => { r.sp = me[0] || ''; if (!Array.isArray(r.assignedTo) || !r.assignedTo.length) r.assignedTo = me.slice(0, 1); } };
      const names = new Set((Store.list('contacts') || []).filter(assigned).map(c => lower(c.name)));
      const party = k === 'notes' ? (r) => r.party : k === 'journal' ? (r) => (r.vtype === 'receipt' ? r.party : '\u0000') : (r) => String((r.buyer && r.buyer.name) || '').split('\n')[0];
      return { visible: (r) => mine(r) || names.has(lower(party(r))), tag };
    },
    // The people of the company a customer can be assigned to: [{ key, name, role }] as last fetched (kept for offline), and the fetch
    people() { return App.user ? (Store.peek(App.user.id, 'people:' + (Store.cid || 'own'), []) || []) : []; },
    async loadPeople() {
      if (!this.available()) return this.people();
      try {
        const cid = Store.cid || this.myUid(), l = this.checked(await this.rpc('list_members', { cid }), 'Members');
        const out = (Array.isArray(l) ? l : []).filter(m => m.role !== 'owner').map(m => ({ key: String(m.phone || '').replace(/\D/g, '').slice(-10) || lower(m.email), name: m.name || m.phone || m.email, role: m.role })).filter(p => p.key);
        Store.poke(App.user.id, 'people:' + (Store.cid || 'own'), out);
        return out;
      } catch (e) { return this.people(); }
    },
    personName(key) { const p = this.people().find(x => x.key === lower(key)); return p ? p.name : key; },

    // ---- permissions
    // The kind of licence the login was assigned in the company that is open ('' = none, or one's own company)
    licKind() { const c = Store.cid ? this.current() : null; return c && c.role !== 'owner' && ['self', 'hr', 'acc', 'full', 'pro'].includes(c.lic) ? c.lic : ''; },
    // A login on a Self Service licence, or with the Employee role: the dashboard of one's own clock, timesheet, claims and payslips
    selfService() { return this.role() === 'employee' || this.licKind() === 'self'; },
    licensed(kind, key) {
      const k = this.licKind();
      // The Professionals tab is the Professional licence's alone (the owner sees it as a preview without one)
      if (!k || k === 'pro') return true;
      if (kind === 'routes' && key === 'pro') return false;
      if (k === 'full') return true;
      if (k === 'self') return kind === 'routes' ? OPENS.employee.includes(key) : kind === 'cols' ? WRITES.employee.includes(key) : TILES.employee.includes(key);
      if (k === 'hr') return kind === 'routes' ? OPENS.hr.includes(key) : kind === 'cols' ? WRITES.hr.includes(key) : ['hr', 'clock', 'timesheets', 'reimbursements', 'leave', 'payslips'].includes(key);
      return kind === 'routes' ? !HR_ROUTES.includes(key) : kind === 'cols' ? !HR_COLS.includes(key) : !['hr', 'timesheets', 'reimbursements', 'leave'].includes(key);
    },
    // The web clock is open to every member for their own punches; the server holds the others to the HR roles
    // ... and so is leave: every member applies their own (hr.js mayApplyFor; the server holds a role that has no HR
    // access to leave requests of its own), so the collection of the requests is open to the roles and licences that
    // do not otherwise reach it; their only screen of it is Leave
    mayWrite(key) { if (!Store.cid || key === 'clock') return true; if (key === 'reimbursements' && this.leaveOnly()) return true; if (key === 'roles') return ['owner', 'admin'].includes(this.role()); if (!COLLECTIONS.includes(key)) return true; const w = WRITES[this.licKind() === 'self' ? 'employee' : this.role()]; return (!w || w.includes(key)) && this.narrowed('cols', key) && this.licensed('cols', key); },
    leaveOnly() { const role = this.licKind() === 'self' ? 'employee' : this.role(), w = WRITES[role]; return (!!w && !w.includes('reimbursements')) || !this.narrowed('cols', 'reimbursements') || !this.licensed('cols', 'reimbursements'); },
    mayOpen(route) { if (!Store.cid) return true; if (route === 'leave' || route === 'hrpolicy') return !this.routeOff(route); const o = OPENS[this.licKind() === 'self' ? 'employee' : this.role()]; return (!o || o.includes(route)) && this.narrowed('routes', route) && this.licensed('routes', route) && !this.routeOff(route); },
    tileAllowed(key) { if (!Store.cid) return true; const role = this.selfService() ? 'employee' : this.role(), t = TILES[role]; return (!t || t.includes(key)) && !(TILES_NOT[role] || []).includes(key) && this.narrowed('tiles', key) && this.licensed('tiles', key) && !this.tileOff(key); },
    readOnlyText(key) {
      const r = this.roleLabel();
      return key === 'company' ? 'Only the owner or an admin can change the company profile (your role here: ' + r + ')' : key === 'roles' ? 'Only the owner or an admin can change the roles' : this.role() === 'viewer' ? 'Read-only access: a viewer cannot save changes in this company' : 'Your role here (' + r + ') cannot change ' + (key === 'hr' ? 'the HR settings' : key);
    },

    // ---- server calls
    rpc(name, args) { return Sub.withToken((token) => Supabase.http('POST', '/rest/v1/rpc/' + name, args || {}, token)); },
    async load() {
      if (!this.available()) return this.list();
      const [r, st] = await Promise.all([this.rpc('my_companies'), this.status()]);
      if (st && st.active === false) { this.deactivated(st); return []; }
      const list = Array.isArray(r) ? r : [];
      const left = Array.isArray(r) ? this.dropGone(list) : null;
      this.keep(list);
      if (left) this.leave(left);
      return list;
    },
    /* ---- a member the owner or an admin removed
       Removed from a company: the company leaves the list and everything this browser kept of it is wiped (dropGone);
       if it was the one open, the login is taken back to its own books (leave). Removed from the last company, with
       no books of its own: the server deactivates the login (companies.sql deactivated_logins). Then nothing is shown,
       the login is refused here and stays refused offline (gate), until a company adds the person again. */
    // {"active": false, "company"} for a deactivated login, {"active": true} otherwise (also from a server that does not
    // have the question yet: 404); null when the server could not be asked
    async status() { try { const r = await this.rpc('account_status'); return r && typeof r === 'object' ? (r.active === false ? r : { active: true }) : null; } catch (e) { return e && e.status === 404 ? { active: true } : null; } },
    deactivatedText(st) { return 'This login has been deactivated: you were removed from ' + ((st && st.company) || 'the company') + '. It works again when a company adds you as a member.'; },
    // Asked before a login shows anything: what the server says, or what this browser already knows when it cannot be asked
    gate(u) {
      const known = Store.peek(u.id, 'deactivated', null), off = known ? { active: false, company: known.company || '' } : { active: true };
      if (!(global.Sync && Sync.isSupabase && Sync.isSupabase())) return Promise.resolve(off);
      if (!Sync.user) Sync.user = u;
      return Promise.race([this.status(), new Promise(res => setTimeout(() => res(null), known ? 8000 : 3000))]).then(st => {
        if (!st) return off;
        if (st.active !== false && known) Store.poke(u.id, 'deactivated', null);
        return st;
      });
    },
    deactivated(st) {
      const u = App.user; if (!u) return;
      if (global.Sync) Sync.stop();
      this.list().forEach(c => { if (c && c.id) Store.wipe(Store.ns(u.id, c.id)); });
      Store.poke(u.id, 'companies', []); Store.poke(u.id, 'last_cid', '');
      Store.poke(u.id, 'deactivated', { company: (st && st.company) || '', at: Date.now() });
      if (App.logout) { App.logout(); UI.alert('Login deactivated', this.deactivatedText(st)); }
    },
    // Wipes the companies that are in this browser's list and not in the fresh one; answers the one that was open, if any
    dropGone(list) {
      const u = App.user; if (!u) return null;
      const gone = this.list().filter(c => c && c.id && !list.some(x => x.id === c.id));
      gone.forEach(c => { if (c.id !== Store.cid) Store.wipe(Store.ns(u.id, c.id)); });
      return gone.find(c => c.id === Store.cid) || null;
    },
    leave(c) {
      const u = App.user; if (!u) return;
      if (global.Sync) Sync.stop();
      Store.wipe(Store.ns(u.id, c.id));
      this.enter(u, '');
      if (!App.shell) return;
      $('#dialogs').innerHTML = '';
      App.shell(); App.go('dashboard');
      UI.alert('Removed from ' + (c.name || 'the company'), 'You are no longer a member of ' + (c.name || 'this company') + ', so its books have been removed from this device. You are back in your own company.');
      Sync.start(u);
    },
    // Loads quietly in the background (after login): the switcher and the dashboard then know every company
    /* What the login may do in the company that is open, as one word: when a fresh list changes it (the owner gave,
       changed or took away the licence or the role, a Professional seat or a company licence came or went) the menu
       and the screen at hand are drawn again, so nothing is shown from the list this browser had kept. */
    accessKey() { const c = this.current(); return c ? [c.role, c.lic || '', (parseInt(c.lic_until, 10) || 0) > Date.now() ? 1 : 0, (parseInt(c.lic_pro, 10) || 0) > 0 ? 1 : 0, c.co_ok === false ? 0 : 1].join('|') : ''; },
    refresh() {
      if (!this.available()) return Promise.resolve([]);
      const was = this.accessKey();
      return this.load().then(l => {
        if (!App.user) return l;
        const changed = was !== this.accessKey();
        if (Store.cid || changed) App.checkSubscription();   // the licence of this login may have come or gone
        if (changed) { App.refreshNav(); if (!$('#dialogs').children.length && App.current && App.current.route !== 'invoice') App.refresh(); }
        else if (App.current && App.current.route === 'dashboard' && !$('#dialogs').children.length) App.refreshBar();
        return l;
      }, () => this.list());
    },
    checked(r, what) { if (!r || typeof r !== 'object') throw new Error(what + ' failed'); if (r.error) throw new Error(r.error); return r; },

    // ---- switching
    // Opens the books of a company: its own namespace, sync restarted there. '' opens the account's own company.
    async switchTo(cid) {
      const u = App.user; if (!u) return;
      cid = cid || '';
      if ((Store.cid || '') === cid) { App.go('dashboard'); return; }
      const c = cid ? this.find(cid) : null;
      if (cid && !c) { UI.toast('That company is not in your list any more'); return; }
      Sync.stop();
      this.enter(u, cid);
      App.shell();
      App.go('dashboard');
      UI.toast('Now in ' + (cid ? (c.name || 'the company') : 'your own company') + (cid ? ' as ' + (this.roleLabel() || ROLE_LABEL[c.role]) : ''), 3000);
      const first = Sync.start(u);
      first.then(() => { if (App.user === u && Store.cid === cid) { App.refresh(); App.checkSubscription(); } });
    },
    // Opens a company's namespace for the account (no sync, no screen change)
    enter(u, cid) {
      cid = cid || '';
      const c = cid ? this.find(cid) : null;
      Store.open(u.id, cid);
      Store.poke(u.id, 'last_cid', cid);
      // A company the account owns runs on the account's own subscription: start it from there, so nothing is
      // locked while the first sync round is on its way. Another owner's company gets the owner's subscription by sync.
      if (cid && c && c.role === 'owner' && !Store.get('registered_at', 0)) SUB_KEYS.forEach(k => { const v = Store.peek(u.id, k, null); if (v != null) Store.set(k, v, true); });
    },
    // The company this browser had open when the account last used it (restored on login)
    lastCid() { return App.user ? (Store.peek(App.user.id, 'last_cid', '') || '') : ''; },

    // ---- the chip in the top bar: switch company, company profile, manage companies
    switcher(fresh) {
      const list = this.switchable(), cur = Store.cid || '';
      const groups = this.grouped(list);
      const body = '<div class="menu-list">' + (list.length ? groups.map(g => '<div class="grp-h">' + esc(g.name || (g.items.some(c => c.primary) ? '' : 'No group')) + '</div>' + g.items.map(c => '<button data-cid="' + esc(c.primary && c.role === 'owner' ? '' : c.id) + '" class="' + ((c.primary && c.role === 'owner' ? '' : c.id) === cur ? 'sel' : '') + '">' + esc(c.name || 'Unnamed company') + '<span class="pill ' + (c.role === 'owner' ? 'ok' : c.role === 'viewer' ? '' : 'warn') + '" style="margin-left:8px">' + esc(ROLE_LABEL[c.role] || c.role) + '</span>' + (c.role !== 'owner' && c.owner_name ? '<span class="small muted" style="margin-left:6px">' + esc(c.owner_name) + '</span>' : '') + '</button>').join('')).join('') : '<div class="hint">Only your own company so far.</div>') + '</div>';
      const bg = UI.modal({ title: 'Companies', body, buttons: [{ label: 'Company Profile', cls: 'outline', onClick: () => { Company.edit(false); } }, { label: 'Manage', onClick: () => { App.go('companies'); } }] });
      $$('[data-cid]', bg).forEach(b => b.onclick = () => { bg.remove(); this.switchTo(b.dataset.cid); });
      // The list as last known is shown at once; a fresher one from the server replaces it (once)
      if (!fresh && this.available()) this.load().then((l) => { if (bg.isConnected && JSON.stringify(this.switchable()) !== JSON.stringify(list)) { bg.remove(); this.switcher(true); } }, () => { /* the list as last known */ });
    },
    grouped(list) {
      const m = new Map();
      list.forEach(c => { const k = lower(c.group_name); if (!m.has(k)) m.set(k, { name: String(c.group_name || '').trim(), items: [] }); m.get(k).items.push(c); });
      return Array.from(m.values()).sort((a, b) => (a.name ? 1 : 0) - (b.name ? 1 : 0) || a.name.localeCompare(b.name));
    },
    groupNames(list) { return Array.from(new Set((list || this.list()).map(c => String(c.group_name || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)); },

    // ---- Companies screen
    async screen() {
      const here = () => App.current && App.current.route === 'companies' && !!$('#coList');
      const root = App.view(App.header('Companies', '<div class="btnrow" style="margin:0"><button class="btn sm green" id="coNew">' + icon('plus') + ' New company</button><button class="btn sm outline" id="coGroup">Group statements</button></div>') +
        
        '<div id="coList"><div class="hint">Loading…</div></div>');
      App.wireBack(root);
      $('#coNew').onclick = () => this.yearly() ? this.create() : this.lock();
      $('#coGroup').onclick = () => App.go('group');
      if (!this.available()) { $('#coList').innerHTML = '<div class="empty">Companies live in your BlitzBook account on the server. This browser is not signed in to the server right now.</div>'; $('#coNew').disabled = true; return; }
      let list;
      try { list = await this.load(); }
      catch (e) { if (here()) $('#coList').innerHTML = '<div class="empty">' + esc(e.status === 404 ? 'Companies are not set up on the server yet (run server/supabase/companies.sql).' : 'The companies could not be loaded: ' + (e.message || 'no connection') + '.') + '</div>'; return; }
      if (!here()) return;
      const me = this.myUid(), cur = Store.cid || '', yearly = this.yearly();
      const pillOf = (role) => role === 'owner' ? 'ok' : role === 'viewer' ? '' : 'warn';
      const card = (g) => '<div class="card white"><div class="hd">' + esc(g.name || 'No group') + (g.name ? '<span class="small muted" style="margin-left:8px">' + g.items.length + ' compan' + (g.items.length === 1 ? 'y' : 'ies') + '</span>' : '') + '</div><div class="bd"><table class="list cards"><thead><tr><th>Company</th><th>Your role</th><th>Owner</th><th class="num">Members</th><th></th></tr></thead><tbody>' +
        g.items.map(c => { const key = c.primary && c.role === 'owner' ? '' : c.id, own = c.role === 'owner', mine = c.owner_id === me;
          return '<tr' + (key === cur ? ' class="grp"' : '') + '><td data-l="Company"><b>' + esc(c.name || 'Unnamed company') + '</b>' + (c.primary && mine ? '<div class="small muted">Your first company</div>' : '') + (parseInt(c.fy_start, 10) ? '<div class="small muted">Books begin in ' + parseInt(c.fy_start, 10) + '</div>' : '') + '</td><td data-l="Role"><span class="pill ' + (own ? 'ok' : c.role === 'viewer' ? '' : 'warn') + '">' + esc(ROLE_LABEL[c.role] || c.role) + '</span></td><td data-l="Owner">' + esc(mine ? 'You' : c.owner_name || '') + '</td><td class="num" data-l="Members">' + (1 + (parseInt(c.members, 10) || 0)) + '</td>' +
            '<td class="actions">' + (key === cur ? '<span class="pill ok">Open now</span>' : '<button class="btn sm" data-open="' + esc(key) + '">Open</button>') +
            '<button class="btn sm outline" data-members="' + esc(c.id) + '">Members</button>' + ((own || c.role === 'admin') && yearly ? '<button class="btn sm outline" data-edit="' + esc(c.id) + '">Group / name</button>' : '') +
            (own && !c.primary ? '<button class="btn sm red" data-del="' + esc(c.id) + '">Delete</button>' : '') + (!own ? '<button class="btn sm red" data-leave="' + esc(c.id) + '">Leave</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
      $('#coList').innerHTML = (yearly ? '' : '<div class="card white"><div class="bd gstlock"><div class="big">🔒</div><div><h3>Yearly subscription required</h3><p class="muted">Making companies, groups and members and the group statements come with the yearly plan and longer; a company you were given a role in can be opened. ' + esc(Sub.statusText()) + '.</p>' + (Store.cid ? '' : '<button class="btn blue" id="coBuy">Buy yearly plan</button>') + '</div></div></div>') + this.grouped(this.ownSetUp() ? list : list.filter(c => !(c.primary && c.role === 'owner'))).map(card).join('') +
        '<div class="card white"><div class="hd">Roles</div><div class="bd"><div class="btnrow" style="margin:0 0 10px"><button class="btn sm blue" id="coRoles">Roles & hierarchy</button><button class="btn sm blue" id="coTabs">Tab access</button></div><table class="list"><tbody>' + ROLES.map(r => '<tr><td style="white-space:nowrap"><span class="pill ' + (r === 'owner' ? 'ok' : r === 'viewer' ? '' : 'warn') + '">' + ROLE_LABEL[r] + '</span></td><td>' + esc(ROLE_HELP[r]) + '</td></tr>').join('') + '</tbody></table></div></div>';
      if ($('#coBuy')) $('#coBuy').onclick = () => Subscription.plans();
      if ($('#coRoles')) $('#coRoles').onclick = () => this.rolesDialog();
      if ($('#coTabs')) $('#coTabs').onclick = () => this.mayOpen('tabaccess') ? App.go('tabaccess') : UI.toast('Only the owner or an admin sets the tab access');
      $$('[data-open]', root).forEach(b => b.onclick = () => this.switchTo(b.dataset.open));
      $$('[data-members]', root).forEach(b => b.onclick = () => this.members(list.find(c => c.id === b.dataset.members)));
      $$('[data-edit]', root).forEach(b => b.onclick = () => this.edit(list.find(c => c.id === b.dataset.edit)));
      $$('[data-del]', root).forEach(b => b.onclick = () => { const c = list.find(x => x.id === b.dataset.del); UI.confirm('Delete Company', 'Delete "' + c.name + '" and all its books (invoices, parties, purchases, everything) for every member? This cannot be undone.\n\nTip: open the company and take an Export first.', async () => {
        try { this.checked(await this.rpc('delete_company', { cid: c.id }), 'Delete'); } catch (e) { UI.toast(e.message, 6000); return; }
        if (Store.cid === c.id) { await this.switchTo(''); }
        UI.toast('Company deleted'); if (here()) this.screen();
      }, 'Delete'); });
      $$('[data-leave]', root).forEach(b => b.onclick = () => { const c = list.find(x => x.id === b.dataset.leave); UI.confirm('Leave Company', 'Leave "' + c.name + '"? You will no longer see its books unless the owner adds you again, and they are removed from this device.', async () => {
        try { this.checked(await this.rpc('remove_member', { cid: c.id, member: me }), 'Leave'); } catch (e) { UI.toast(e.message, 6000); return; }
        if (Store.cid === c.id) { await this.switchTo(''); }
        UI.toast('You left ' + c.name); if (here()) this.screen();
      }, 'Leave'); });
    },
    create() {
      const nb = UI.modal({ title: 'New Company', body: '<div class="hint" style="margin-bottom:8px">Every company after your first needs an <b>Additional company</b> licence (Rs ' + (global.Lic ? Lic.kind('co').year : 1499) + ' a year, under Company &gt; Licences): buy it first, then create the company here.</div>' + UI.field('Company name', UI.input('ncName', '', { attrs: ' maxlength="120"' }), { req: true, hint: 'The full profile (GSTIN, address, bank) is filled in under Company Profile once the company is open.' }) +
          Company.fyFields('ncFy', U.fyFirstYear(new Date(), 4), 4, 'The financial year the books of this company begin from: entries dated before its first day are refused. Usually April to March; January to December works too. It can be changed in Company Profile.') +
          UI.field('Group', UI.input('ncGroup', '', { placeholder: 'e.g. Sharma Group', list: 'ncGroups', attrs: ' maxlength="80"' }), { hint: 'Companies in the same group appear together in the consolidated statements. Leave blank for none.' }) + UI.datalist('ncGroups', this.groupNames()),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Create', cls: 'green', onClick: async (bg) => {
          const name = UI.val('ncName', bg).trim(), group = UI.val('ncGroup', bg).trim(), fy = Company.fyValue('ncFy', bg);
          if (!name) { UI.toast('Enter the company name'); return false; }
          if (!fy.year) { UI.mark('ncFyY', true, bg); UI.toast('Enter the year the financial year starts in (for example ' + U.fyFirstYear(new Date(), fy.month) + ')'); return false; }
          let r;
          try { r = this.checked(await this.rpc('create_company', { name_in: name, group_in: group }), 'Create'); }
          catch (e) { UI.toast(e.status === 404 ? 'Companies are not set up on the server yet' : e.message, 8000); if (/Additional company licence/.test(e.message || '')) { bg.remove(); App.go('licences'); } return false; }
          // The financial year goes into the new company's profile record, which every device then reads
          let fySaved = true;
          try { await Sub.withToken((token) => Supabase.http('POST', '/rest/v1/books?on_conflict=user_id,k', [{ user_id: r.id, k: 'company', d: { company_name: r.name || name, fy_start: String(fy.year), fy_month: fy.month } }], token, { Prefer: 'resolution=merge-duplicates,return=minimal', 'X-Company': r.id })); }
          catch (e) { fySaved = false; }
          await this.load().catch(() => null);
          UI.toast(fySaved ? 'Company created' : 'Company created, but the financial year could not be saved: choose it in Company Profile', fySaved ? 2500 : 7000);
          UI.confirm('Open ' + name + '?', 'Open the new company now to set up its profile? You can switch back any time from the company chip in the top bar.', () => this.switchTo(r.id), 'Open');
          if (App.current && App.current.route === 'companies') this.screen();
          return true;
        } }] });
      Company.wireFy('ncFy', nb);
    },
    edit(c) {
      UI.modal({ title: 'Company Group / Name', body: UI.field('Company name', UI.input('ecName', c.name, { attrs: ' maxlength="120"', disabled: true }), { hint: 'The name comes from the company profile; change it there.' }) +
          UI.field('Group', UI.input('ecGroup', c.group_name, { placeholder: 'e.g. Sharma Group', list: 'ecGroups', attrs: ' maxlength="80"' }), { hint: 'Blank takes the company out of every group.' }) + UI.datalist('ecGroups', this.groupNames()),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: async (bg) => {
          try { this.checked(await this.rpc('update_company', { cid: c.id, name_in: c.name, group_in: UI.val('ecGroup', bg).trim() }), 'Save'); }
          catch (e) { UI.toast(e.message, 6000); return false; }
          await this.load().catch(() => null);
          UI.toast('Saved'); if (App.current && App.current.route === 'companies') this.screen();
          return true;
        } }] });
    },
    // The people with access to a company; the owner and admins add, change and remove them
    async members(c) {
      const manage = (c.role === 'owner' || c.role === 'admin') && this.yearly(), me = this.myUid(), open = this.isOpen(c);
      // The roles to pick from: the built-in ones, and the custom roles of the company when it is the one open
      // Employee first: whoever is added is an employee of the company unless another role is chosen. Investor is offered
      // as a role of its own (it works like Viewer and is made on first use): an investor is not put on the employee list.
      // Admin and Super Admin are given by the owner or a Super Admin only (in the company that is open: the roles record is its)
      const sup = c.role === 'owner' || (open && this.isSuper());
      const options = (all) => ROLES.filter(r => r !== 'owner').sort((a, b) => (a === 'employee' ? -1 : b === 'employee' ? 1 : 0)).map(r => [r, ROLE_LABEL[r]]).concat(open ? this.customRoles().map(r => ['c:' + r.id, r.id === SUPER.id ? r.name : r.name + ' (' + ROLE_LABEL[r.base] + ')']) : []).filter(o => all || sup || !this.adminRole(o[0])).concat(open && manage && !this.customRoles().some(r => this.isInvestorRole(r)) ? [['new:investor', 'Investor (Viewer)']] : []);
      const picked = (v) => {
        if (v === 'new:investor') { const d = this.rolesDoc(), r = { id: 'r' + U.uid(), name: 'Investor', base: 'viewer', parent: 'owner', modules: null, rights: null, ro: [] }; d.roles.push(r); if (this.saveRolesDoc(d) === false) throw new Error('The Investor role could not be made'); return { base: 'viewer', custom: r }; }
        const r = /^c:/.test(v) ? this.customRoles().find(x => x.id === v.slice(2)) : null; return { base: r ? r.base : v, custom: r }; };
      // Every member is an employee too (hr.js addMembers): the ones not on the employee list of the open company are put there
      const toEmployees = (list) => { if (!open || !global.HR || !HR.addMembers) return; const n = HR.addMembers(list); if (n) UI.toast(n + ' member' + (n === 1 ? '' : 's') + ' added to HR > Employees', 4000, 'ok'); };
      const licOpts = [['', 'No licence']].concat(global.Lic ? Lic.KINDS.map(k => [k.key, k.name + ' licence']) : []);
      const bg = UI.modal({ title: 'Members of ' + (c.name || 'the company'), wide: true, focus: false, body: '<div id="mbList"><div class="hint">Loading…</div></div>' +
          (manage ? '<div class="field span" style="margin-top:12px"><label>Add a member</label><div class="btnrow" style="margin:0"><input id="mbId" placeholder="Mobile number or email" style="flex:1;min-width:200px"><input id="mbName" placeholder="Name (optional)" maxlength="80" style="flex:1;min-width:140px">' + UI.select('mbRole', options(), 'employee') + UI.select('mbLic', licOpts, '', { attrs: ' title="The licence the member works on (Company > Licences)"' }) + '<button class="btn sm green" id="mbAdd">Add</button></div><div class="hint">Whoever is added (or invited by the link) is an employee of the company: they are put on HR &gt; Employees by themselves, with the role chosen here. An Investor is not.</div><div class="hint">A member with a licence keeps working whatever the trial or the plan of the account does; seats are bought under Company &gt; Licences.</div></div>' : ''),
        buttons: [{ label: 'Close', cls: 'outline' }].concat(open ? [{ label: 'Roles & hierarchy', onClick: () => { const rb = this.rolesDialog(); const mo = new MutationObserver(() => { if (!rb.isConnected) { mo.disconnect(); if (bg.isConnected) { if ($('#mbRole', bg)) $('#mbRole', bg).innerHTML = options().map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === 'employee' ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join(''); draw(); } } }); mo.observe($('#dialogs'), { childList: true }); return false; } }] : []) });
      const draw = async () => {
        let list;
        try { list = this.checked(await this.rpc('list_members', { cid: c.id }), 'Members'); } catch (e) { if (bg.isConnected) $('#mbList', bg).innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; return; }
        if (!bg.isConnected) return;
        list = Array.isArray(list) ? list : [];
        toEmployees(list);
        const cust = (m) => open && m.role !== 'owner' ? this.customOf(m, m.role) : null;
        // The licence column is there once the server knows licences (companies.sql)
        const hasLic = !!global.Lic && list.some(m => m.lic !== undefined);
        $('#mbList', bg).innerHTML = '<table class="list"><thead><tr><th>Name</th><th>Mobile</th><th>Email</th><th>Role</th>' + (hasLic ? '<th>Licence</th>' : '') + (manage ? '<th></th>' : '') + '</tr></thead><tbody>' + list.map((m, n) => '<tr' + (m.invited ? ' class="muted"' : '') + '><td><b>' + esc(m.name || (m.invited ? 'Invited' : '-')) + '</b>' + (m.user_id && m.user_id === me ? ' <span class="small muted">(you)</span>' : '') + (m.invited ? '<div class="small muted">Not registered yet</div>' : '') + '</td><td>' + esc(m.phone || '-') + '</td><td>' + esc(m.email || '-') + '</td><td>' +
          (manage && m.role !== 'owner' && (sup || m.role !== 'admin') ? UI.select('r_' + n, options(), cust(m) ? 'c:' + cust(m).id : m.role, { attrs: ' data-role="' + esc(m.user_id || '') + '" data-id="' + esc(m.phone || m.email) + '" data-n="' + n + '" style="min-height:34px;padding:4px 8px"' }) : '<span class="pill ' + (m.role === 'owner' ? 'ok' : 'warn') + '">' + esc(cust(m) ? cust(m).name : ROLE_LABEL[m.role] || m.role) + '</span>') + (m.invited ? ' <span class="pill">Invited</span>' : '') + '</td>' +
          (hasLic ? '<td>' + (m.role === 'owner' ? '<span class="small muted">Own plan</span>' : manage ? UI.select('l_' + n, licOpts, m.lic || '', { attrs: ' data-lic="' + n + '" style="min-height:34px;padding:4px 8px"' }) : '<span class="pill">' + esc(m.lic ? Lic.name(m.lic) : 'None') + '</span>') + '</td>' : '') +
          (manage ? '<td class="actions">' + (m.role !== 'owner' && (sup || m.role !== 'admin') ? '<button class="btn sm red"' + (m.invited ? ' data-uninvite="' + esc(m.phone || m.email) + '"' : ' data-rm="' + esc(m.user_id) + '"') + ' data-name="' + esc(m.name || m.phone || m.email) + '">' + (m.invited ? 'Withdraw' : 'Remove') + '</button>' : '') + '</td>' : '') + '</tr>').join('') + '</tbody></table>';
        $$('[data-role]', bg).forEach(s => s.onchange = async () => { const p = picked(s.value), m = list[+s.dataset.n]; if (!sup && (m.role === 'admin' || this.adminRole(s.value))) { UI.toast('Only the owner or a Super Admin changes an Admin'); draw(); return; } try { if (p.base !== m.role) this.checked(await this.rpc('set_member', { cid: c.id, identity: s.dataset.id, role_in: p.base }), 'Change role'); if (open && (p.custom || this.customOf(m))) this.setCustom(m, p.custom ? p.custom.id : ''); UI.toast('Role changed'); } catch (e) { UI.toast(e.message, 6000); } draw(); });
        $$('[data-lic]', bg).forEach(s => s.onchange = async () => { await Lic.assign(c.id, list[+s.dataset.lic], s.value); draw(); });
        $$('[data-rm]', bg).forEach(b => b.onclick = () => UI.confirm('Remove Member', 'Remove ' + (b.dataset.name || 'this member') + ' from ' + c.name + '? They lose the books of this company on every device. If they are in no other company and keep no books of their own, their login is deactivated until a company adds them again.', async () => { try { const r = this.checked(await this.rpc('remove_member', { cid: c.id, member: b.dataset.rm }), 'Remove'); UI.toast(r.deactivated ? 'Member removed. Their login is deactivated.' : 'Member removed', 4000); } catch (e) { UI.toast(e.message, 6000); } draw(); this.load().catch(() => null); }, 'Remove'));
        $$('[data-uninvite]', bg).forEach(b => b.onclick = () => UI.confirm('Withdraw Invitation', 'Withdraw the invitation of ' + b.dataset.uninvite + ' to ' + c.name + '? They can be invited again any time.', async () => { try { this.checked(await this.rpc('remove_invite', { cid: c.id, identity: b.dataset.uninvite }), 'Withdraw'); UI.toast('Invitation withdrawn'); } catch (e) { UI.toast(e.message, 6000); } draw(); }, 'Withdraw'));
      };
      if (manage) $('#mbAdd', bg).onclick = async () => {
        const id = UI.val('mbId', bg).trim(), nm = String(UI.val('mbName', bg) || '').trim().replace(/\s+/g, ' '); if (!id) { UI.toast('Enter the mobile number or email'); return; }
        $('#mbAdd', bg).disabled = true;
        if (!sup && this.adminRole(UI.val('mbRole', bg))) { UI.toast('Only the owner or a Super Admin makes someone an Admin'); return; }
        try { const p = picked(UI.val('mbRole', bg)), r = await this.invite(c.id, id, p.base); if (nm) this.inviteNames[lower(/@/.test(id) ? id : id.replace(/\D/g, '').slice(-10))] = nm; if (!r.name && nm) r.name = nm; if (open && p.custom) this.setCustom({ user_id: r.user_id || '', phone: /@/.test(id) ? (r.phone || '') : id, email: /@/.test(id) ? id : (r.email || '') }, p.custom.id); UI.toast(this.inviteText(r, id), 8000); const lk = UI.val('mbLic', bg); if (lk && global.Lic) await Lic.assign(c.id, { user_id: r.user_id || '', phone: /@/.test(id) ? '' : id, email: /@/.test(id) ? id.toLowerCase() : '', name: r.name || id }, lk); $('#mbId', bg).value = ''; $('#mbName', bg).value = ''; this.shareJoin({ e: /@/.test(id) ? id.toLowerCase() : String(r.email || '').toLowerCase(), p: /@/.test(id) ? String(r.phone || '') : id, n: r.name || '', c: c.name, r: r.role, by: (App.user && App.user.name) || '', mailed: !!r.mailed, hasAccount: !r.invited }); }
        catch (e) { UI.toast(e.message, 7000); }
        finally { if (bg.isConnected) $('#mbAdd', bg).disabled = false; }
        draw(); this.load().catch(() => null);
      };
      draw();
    },

    // The names typed while adding people who have no account yet, by mobile number or email (for their employee record)
    inviteNames: {},
    // The role an investor is given: a custom role called Investor (it works like Viewer). Its members are not employees.
    isInvestorRole(r) { return !!r && /investor/i.test(String(r.name || '')); },
    isInvestor(m) { return !!m && m.role !== 'owner' && this.isInvestorRole(this.customOf(m, m.role)); },
    // Adds a member or invites someone without an account, and has them emailed (the invite edge function,
    // server/supabase/functions/invite). A project without the function falls back to set_member alone: the member is
    // added or the invitation kept, and nobody is mailed.
    async invite(cid, identity, role) {
      let r;
      try {
        r = await Sub.withToken(async (token) => {
          const res = await fetch(Sync.serverUrl().replace(/\/+$/, '') + '/functions/v1/invite', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: Sync.supabaseKey(), Authorization: 'Bearer ' + token }, body: JSON.stringify({ cid, identity, role }) });
          const text = await res.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
          if (res.status === 404 || res.status === 503 || (res.status >= 500 && !(j && j.error))) return null;   // no such function on this project
          if (res.status === 401) { const e = new Error((j && j.error) || 'Signed out'); e.status = 401; throw e; }
          if (!res.ok && !(j && j.error)) throw new Error('Could not reach the server (' + res.status + ')');
          return j;
        });
      } catch (e) { if (e.status === 401) throw e; r = null; }
      if (!r) r = Object.assign({}, await this.rpc('set_member', { cid, identity, role_in: role }), { mailed: false, mail_error: 'Email is not available on this server' });
      return this.checked(r, 'Add');
    },
    // What to tell the person who added a member about what happened
    inviteText(r, id) {
      const who = r.name || r.identity || id, role = ROLE_LABEL[r.role] || r.role;
      if (r.invited) return who + ' has no BlitzBook account yet: invited as ' + role + '. ' + (r.mailed ? 'An email tells them to register with this address; the company is theirs to open the moment they do.' : 'They get the role on registering with this ' + (/@/.test(who) ? 'email' + (r.mail_error ? ' (no email sent: ' + r.mail_error + ')' : '') : 'mobile number') + '.');
      return who + ' added as ' + role + (r.mailed ? '; an email has told them' : r.mail_error ? ' (no email sent: ' + r.mail_error + ')' : '') + '.';
    },

    // ---- the invitation link: opens the portal on Register (or Login) with the person's details filled in and the company named
    joinLink(j) { const q = new URLSearchParams(); ['e', 'p', 'n', 'c', 'r'].forEach(k => { if (j[k]) q.set(k, j[k]); }); const base = /^https?:/.test(location.protocol) ? location.origin + location.pathname.replace(/[^/]*$/, '') : 'https://blitzbook.co.in/'; return base + '#join?' + q.toString(); },
    joinText(j) { return (j.by || 'The owner') + ' added you to ' + (j.c || 'the company') + ' on BlitzBook as ' + (ROLE_LABEL[j.r] || j.r || 'a member') + '. Open ' + this.joinLink(j) + ' and ' + (j.hasAccount ? 'log in' : 'register') + ' with ' + (j.e || j.p) + ' to ' + (j.r === 'employee' ? 'clock in and out, fill your timesheet and raise claims.' : 'open the books.'); },
    // After adding someone: the link to send them, to copy or to share on WhatsApp
    shareJoin(j) {
      const link = this.joinLink(j), text = this.joinText(j), wa = j.p && /^[6-9]\d{9}$/.test(j.p) ? 'https://wa.me/91' + j.p + '?text=' + encodeURIComponent(text) : '';
      const bg = UI.modal({ title: 'Login link for ' + (j.n || j.e || j.p), body: '<p>' + esc(j.mailed ? 'An email with this link has gone' + (j.e ? ' to ' + j.e : ' out') + '. You can send it yourself too:' : 'Send them this link' + (j.e ? ' (no email went out from the server)' : '') + ':') + '</p>' + UI.field('Link', UI.input('jnLink', link, { attrs: ' readonly' })) + UI.field('Message', '<textarea id="jnText" readonly style="min-height:120px">' + esc(text) + '</textarea>'),
        buttons: [{ label: 'Close', cls: 'outline' }, { label: 'Copy link', cls: 'outline', onClick: () => { const i = $('#jnLink', bg); i.select(); try { document.execCommand('copy'); } catch (e) { /* older browser */ } if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => { /* fine */ }); UI.toast('Link copied', 2500, 'ok'); return false; } }]
          .concat(wa ? [{ label: 'WhatsApp', cls: 'green', onClick: () => { window.open(wa, '_blank'); return false; } }] : []) });
      return bg;
    },

    // ---- a company's books in its own namespace, for the group statements
    within(ns, cid, fn) {
      const was = { uid: Store.uid, cid: Store.cid };
      Store.uid = ns; Store.cid = cid;
      try { return fn(); } finally { Store.uid = was.uid; Store.cid = was.cid; }
    },
    nsOf(c) { const own = c.primary && c.role === 'owner'; return { ns: Store.ns(App.user.id, own ? '' : c.id), cid: own ? '' : c.id }; },
    // Brings the local copy of a company's books up to date (one listening round of sync in that namespace).
    // A record edited here and not yet sent stays as it is, exactly as in a normal round.
    async pull(c) {
      const { ns, cid } = this.nsOf(c);
      const st = Object.assign({ token: '', epoch: '', since: 0, last: 0, base: {}, subSince: 0 }, Store.peek(ns, 'sync', {}) || {});
      const ask = () => Sub.withToken((token) => Supabase.call('sync', { token, epoch: st.epoch, since: st.since, changes: [], company: cid, owner: c.owner_id, sub_since: st.subSince }));
      let resp = await ask();
      if (resp.reset) { st.epoch = ''; st.since = 0; st.base = {}; st.subSince = 0; resp = await ask(); }
      this.within(ns, cid, () => {
        const now = AppFormat.snapshot();
        const todo = (resp.changes || []).filter(ch => ch.k === 'sub' || (now[ch.k] ? Sync.hash(now[ch.k]) : undefined) === st.base[ch.k]);
        Store.quiet = true;
        let applied = [];
        try { applied = AppFormat.apply(todo, (key) => key in st.base); } finally { Store.quiet = false; }
        const after = AppFormat.snapshot();
        applied.forEach(k => { if (after[k]) st.base[k] = Sync.hash(after[k]); else delete st.base[k]; });
        st.epoch = resp.epoch; st.since = resp.rev; st.subSince = resp.sub_rev || st.subSince; st.last = Date.now();
        Store.set('sync', st, true);
      });
    },

    // ---- consolidated statements
    /* Adds up the statements of the companies given, each read from its namespace. Dealings between the companies
       of the group (an invoice of A on B, a purchase of B from A, and what they owe each other) are shown in an
       Eliminations column and taken out of the group total, so the group's sales, purchases, receivables and
       payables only count business with outsiders. A party is matched to a group company by name. */
    consolidate(list, range, asAtMs, eliminate) {
      const names = new Set(list.map(c => lower(c.name)));
      const per = list.map(c => this.within(this.nsOf(c).ns, this.nsOf(c).cid, () => {
        const co = Store.company(); names.add(lower(co.name));
        return { c, name: co.name || c.name, gst: Biz.chargesGst() };
      }));
      const isGroup = (n) => names.has(lower(n)) && lower(n) !== '';
      per.forEach(p => this.within(this.nsOf(p.c).ns, this.nsOf(p.c).cid, () => {
        const mine = lower(Store.company().name || p.c.name);
        const other = (n) => isGroup(n) && lower(n) !== mine;
        p.pl = Books.profitLoss(range.a, range.b);
        p.bs = Books.balanceSheet(asAtMs);
        // What this company did with the other companies of the group, in the period / up to the date
        const e = { sales: 0, salesReturns: 0, purchases: 0, purchaseReturns: 0, receivables: 0, payables: 0, parties: [] };
        if (eliminate) {
          Store.list('invoices').forEach(i => { if (i.kind === 'invoice' && Books.inRange(i.date, range.a, range.b) && other(Books.partyName(i.buyer.name))) e.sales += U.num(i.totals.taxable); });
          Store.list('purchases').forEach(x => { if (x.kind === 'PUR' && Books.inRange(x.date, range.a, range.b) && other(x.supplier)) e.purchases += U.num(x.taxable); });
          Store.list('notes').forEach(n => { if (!Books.inRange(n.date, range.a, range.b) || !other(n.party)) return; if (n.kind === 'CN') e.salesReturns += U.num(n.taxable); else e.purchaseReturns += U.num(n.taxable); });
          p.bs.parties.forEach(x => { if (other(x[0])) { e.parties.push(x[0]); if (x[1] > 0) e.receivables += x[1]; else e.payables -= x[1]; } });
        }
        p.elim = e;
      }));
      const n = per.length, sum = (f) => per.reduce((s, p) => s + f(p), 0);
      const cols = per.map(p => p.name);
      const line = (label, style, f, elim) => ({ label, style, vals: per.map(p => f(p)), elim: elim || 0, total: sum(f) - (elim || 0) });
      const text = (label, style, total) => ({ label, style, vals: per.map(() => ''), elim: '', total, text: true });
      const head = (label) => ({ label, style: 2, vals: per.map(() => ''), elim: '', total: '' });
      // ---- profit & loss
      const P = [];
      const eSales = sum(p => p.elim.sales), eSalesRet = sum(p => p.elim.salesReturns), ePur = sum(p => p.elim.purchases), ePurRet = sum(p => p.elim.purchaseReturns);
      P.push(head('INCOME'));
      P.push(line('Sales (before GST)', 0, p => p.pl.sales, eSales));
      P.push(line('Less: Credit notes', 0, p => p.pl.salesReturns, eSalesRet));
      P.push(line('Other income (journal)', 0, p => p.pl.otherIncome));
      P.push(head('COST OF GOODS'));
      P.push(line('Purchases (before GST)', 0, p => p.pl.purchasesValue, ePur));
      P.push(line('Less: Debit notes', 0, p => p.pl.purchaseReturns, ePurRet));
      const eGross = eSales - eSalesRet - (ePur - ePurRet);
      P.push(line('Gross Profit', 1, p => p.pl.grossProfit, eGross));
      P.push(head('EXPENSES'));
      const cats = new Map(); per.forEach(p => p.pl.expensesByCategory.forEach((v, k) => cats.set(k, true)));
      Array.from(cats.keys()).sort((a, b) => a.localeCompare(b)).forEach(k => P.push(line(k, 0, p => p.pl.expensesByCategory.get(k) || 0)));
      if (!cats.size) P.push(line('No expenses recorded', 0, () => 0));
      P.push(line('Total Expenses', 1, p => p.pl.expenses));
      const net = line('Net Profit / (Loss)', 1, p => p.pl.netProfit, eGross); P.push(net);
      const tSales = sum(p => p.pl.sales) - eSales - (sum(p => p.pl.salesReturns) - eSalesRet);
      P.push(head('RATIOS (group, on sales less credit notes)'));
      P.push(text('Gross profit margin', 0, pct(sum(p => p.pl.grossProfit) - eGross, tSales)));
      P.push(text('Net profit margin', 0, pct(net.total, tSales)));
      P.push(text('Expenses to sales', 0, pct(sum(p => p.pl.expenses), tSales)));
      if (per.some(p => p.gst)) {
        P.push(head('GST (not part of profit; each company files its own returns)'));
        P.push(line('Total output GST on sales', 0, p => p.pl.outputGst));
        P.push(line('Total input GST on purchases', 0, p => p.pl.inputGst));
        P.push(line('GST payable under reverse charge', 0, p => p.pl.rcmGst));
        P.push(line('Net GST payable / (credit)', 1, p => p.pl.outputGst - p.pl.inputGst + p.pl.rcmGst));
      }
      // ---- balance sheet
      const B = [];
      const eRec = sum(p => p.elim.receivables), ePay = sum(p => p.elim.payables);
      B.push(head('ASSETS'));
      B.push(line('Cash in hand', 0, p => p.bs.cash));
      B.push(line('Bank (online & cheque)', 0, p => p.bs.bank));
      B.push(line('Receivables (credit sales & parties)', 0, p => p.bs.receivables, eRec));
      B.push(line('Stock in hand', 0, p => p.bs.stockValue));
      const assetNames = new Map(); per.forEach(p => p.bs.assets.forEach(x => assetNames.set(lower(x[0]), x[0])));
      Array.from(assetNames.values()).sort((a, b) => a.localeCompare(b)).forEach(nm => B.push(line(nm, 0, p => (p.bs.assets.find(x => lower(x[0]) === lower(nm)) || [nm, 0])[1])));
      if (per.some(p => p.gst)) B.push(line('Input GST (CGST + SGST + IGST)', 0, p => p.bs.inCgst + p.bs.inSgst + p.bs.inIgst));
      B.push(line('Total Assets', 1, p => p.bs.totalAssets, eRec));
      B.push(head('LIABILITIES & CAPITAL'));
      B.push(line('Payables (credit purchases, expenses & parties)', 0, p => p.bs.payables, ePay));
      const liabNames = new Map(); per.forEach(p => p.bs.liabilities.forEach(x => liabNames.set(lower(x[0]), x[0])));
      Array.from(liabNames.values()).sort((a, b) => a.localeCompare(b)).forEach(nm => B.push(line(nm, 0, p => (p.bs.liabilities.find(x => lower(x[0]) === lower(nm)) || [nm, 0])[1])));
      if (per.some(p => p.gst)) B.push(line('Output GST (CGST + SGST + IGST)', 0, p => p.bs.outCgst + p.bs.outSgst + p.bs.outIgst));
      B.push(line('GST payable under reverse charge', 0, p => p.bs.rcmPayable));
      B.push(line('TDS payable', 0, p => p.bs.tdsPayable));
      B.push(line("Owner's capital (accumulated profit / loss)", 0, p => p.bs.capital, eRec - ePay));
      B.push(line('Total Liabilities & Capital', 1, p => p.bs.totalLiabilities + p.bs.capital, ePay + (eRec - ePay)));
      const curA = sum(p => p.bs.cash + p.bs.bank + p.bs.receivables + p.bs.stockValue) - eRec, curL = sum(p => p.bs.payables + p.bs.rcmPayable + p.bs.tdsPayable) - ePay;
      B.push(head('RATIOS (group)'));
      B.push(text('Current ratio (current assets : current liabilities)', 0, ratio(curA, curL)));
      B.push(text('Working capital (current assets less current liabilities)', 0, money(curA - curL)));
      const eliminated = per.reduce((s, p) => s + p.elim.sales + p.elim.purchases + p.elim.receivables + p.elim.payables + p.elim.salesReturns + p.elim.purchaseReturns, 0) > 0.005;
      return { cols, pnl: P, bs: B, eliminated, parties: Array.from(new Set(per.reduce((a, p) => a.concat(p.elim.parties), []))) };
    },

    // ---- Group statements screen
    async groupScreen(p) {
      const here = () => App.current && App.current.route === 'group' && !!$('#gsBody');
      if (!this.groupAllowed()) {
        const root = App.view(App.header('Group Statements') + '<div class="card white"><div class="bd gstlock"><div class="big">🔒</div><div><h3>Yearly subscription required</h3><p class="muted">The consolidated Profit &amp; Loss and Balance Sheet of a group of companies come with the yearly plan and longer' + (Sub.isOnTrial() && Sub.isTimeActive() ? ' and are not part of the trial' : '') + '. ' + esc(Sub.statusText()) + '.</p>' + (Store.cid ? '' : '<button class="btn blue" id="gsBuy">Buy yearly plan</button>') + '</div></div></div>');
        App.wireBack(root); if ($('#gsBuy')) $('#gsBuy').onclick = () => Subscription.plans();
        return;
      }
      const list = this.list(), groups = this.groupNames(list);
      const group = p.group != null ? p.group : (groups[0] || '');
      const stmt = p.stmt === 'balance' ? 'balance' : 'pnl';
      const range = p.range || Reports.periodRange(3), asAt = p.asAt || U.today();
      const elim = p.elim !== '0' && p.elim !== false;
      const members = group === '*' ? list : list.filter(c => lower(c.group_name) === lower(group) && group);
      const ctl = '<div class="btnrow" style="margin:0">' + UI.select('gsGroup', [['*', 'All my companies']].concat(groups.map(g => [g, g])), group, { attrs: ' style="min-height:36px"' }) +
        '<button class="btn sm ' + (stmt === 'pnl' ? '' : 'outline') + '" id="gsPnl">Profit &amp; Loss</button><button class="btn sm ' + (stmt === 'balance' ? '' : 'outline') + '" id="gsBs">Balance Sheet</button>' +
        (stmt === 'pnl' ? '<button class="btn sm outline" id="gsPeriod">' + esc(range.label) + '</button>' : '<div class="inline"><label class="muted small" for="gsDate">as at</label>' + UI.input('gsDate', U.toIso(asAt), { type: 'date', attrs: ' style="width:170px;min-height:36px"' }) + '</div>') +
        UI.check('gsElim', 'Eliminate inter-company', elim) + '<button class="btn sm green" id="gsXls" disabled>Export Excel</button><button class="btn sm blue" id="gsPdf" disabled>PDF</button></div>';
      const root = App.view(App.header('Group Statements', ctl) +
        
        '<div id="gsBody"><div class="hint">' + (members.length ? 'Fetching the latest books…' : 'No companies here yet.') + '</div></div>');
      App.wireBack(root);
      const go = (q) => App.go('group', Object.assign({ group, stmt, range, asAt, elim: elim ? '1' : '0' }, q));
      $('#gsGroup').onchange = e => go({ group: e.target.value });
      $('#gsPnl').onclick = () => go({ stmt: 'pnl' }); $('#gsBs').onclick = () => go({ stmt: 'balance' });
      if ($('#gsPeriod')) $('#gsPeriod').onclick = () => Reports.pickPeriod('Group Profit & Loss', range, (rg) => go({ range: rg }));
      if ($('#gsDate')) $('#gsDate').onchange = e => { if (e.target.value) go({ asAt: U.fromIso(e.target.value) }); };
      $('#gsElim').onchange = e => go({ elim: e.target.checked ? '1' : '0' });
      if (!members.length) { $('#gsBody').innerHTML = '<div class="empty">' + (list.length > 1 ? 'Put two or more companies in the same group (Companies › Group / name) to see them together here, or choose "All my companies".' : 'Only one company so far. Make another under Companies, or ask an owner to add you to theirs.') + '</div>'; return; }
      if (this.available()) {
        for (const c of members) {
          if (!here()) return;
          $('#gsBody').innerHTML = '<div class="hint">Fetching the latest books of ' + esc(c.name || 'a company') + '…</div>';
          try { await this.pull(c); } catch (e) { if (here()) UI.toast('Could not fetch ' + (c.name || 'a company') + ': ' + (e.message || 'no connection') + '. Showing what this browser has.', 6000); }
        }
      }
      if (!here()) return;
      let r;
      try { r = this.consolidate(members, range, U.dateMs(asAt), elim); } catch (e) { $('#gsBody').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; return; }
      const lines = stmt === 'pnl' ? r.pnl : r.bs, showElim = elim && r.eliminated;
      const title = (stmt === 'pnl' ? 'Group Profit & Loss' : 'Group Balance Sheet') + ' - ' + (group === '*' ? 'All companies' : group);
      const subtitle = (stmt === 'pnl' ? 'Period: ' + range.from + ' to ' + range.to : 'As at ' + asAt) + (showElim ? '   ·   Inter-company dealings eliminated (' + r.parties.join(', ') + ')' : '');
      const headers = ['Particulars'].concat(r.cols).concat(showElim ? ['Eliminations'] : []).concat(['Group total']);
      const cell = (v, text) => text ? esc(v) : (typeof v === 'number' ? money(v) : esc(v));
      $('#gsBody').innerHTML = '<div class="card white"><div class="bd"><div class="muted small">' + esc(subtitle) + '</div></div></div><div class="tablewrap gs"><table class="list stmt"><thead><tr>' + headers.map((h, i) => '<th class="' + (i ? 'num' : '') + '">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
        lines.map(l => l.style === 2 ? '<tr class="grp"><td colspan="' + headers.length + '"><b>' + esc(l.label) + '</b></td></tr>' :
          '<tr class="' + (l.style === 1 ? 'total' : '') + '"><td class="left">' + esc(l.label) + '</td>' + l.vals.map(v => '<td class="num">' + cell(v, l.text) + '</td>').join('') + (showElim ? '<td class="num elim">' + (l.text || !l.elim ? '' : '(' + money(l.elim) + ')') + '</td>' : '') + '<td class="num"><b>' + cell(l.total, l.text) + '</b></td></tr>').join('') + '</tbody></table></div>';
      const flat = () => lines.map(l => [l.label].concat(l.style === 2 ? headers.slice(1).map(() => '') : l.vals.map(v => l.text ? v : U.indianNumber(v)).concat(showElim ? [l.text || !l.elim ? '' : '-' + U.indianNumber(l.elim)] : []).concat([l.text ? l.total : U.indianNumber(l.total)])));
      $('#gsXls').disabled = $('#gsPdf').disabled = false;
      $('#gsXls').onclick = () => UI.xls(stmt === 'pnl' ? 'Group_Profit_Loss' : 'Group_Balance_Sheet', headers, flat());
      $('#gsPdf').onclick = () => UI.pdf(title, subtitle, headers, flat(), { right: headers.map((h, i) => i).filter(i => i > 0), bold: lines.map((l, i) => l.style ? i : -1).filter(i => i >= 0) });
    }
  };
  const ratio = (a, b) => b > 0.005 ? (a / b).toFixed(2) + ' : 1' : 'n/a';
  const pct = (a, b) => b > 0.005 ? (a / b * 100).toFixed(1) + '%' : 'n/a';

  App.routes.companies = () => Companies.screen();
  App.routes.tabaccess = () => Companies.tabsScreen();
  App.routes.group = (p) => Companies.groupScreen(p || {});
  // Every list read and saved goes through the part of it the login sees (store.js)
  Store.scope = (k) => Companies.scopeOf(k);
  global.Companies = Companies;
})(window);
