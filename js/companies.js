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
    accountant: 'Every record of the books: invoices, purchases, expenses, journal, receipts, payments, parties, items. Not the company profile or members',
    sales: 'Invoices, challans, credit / debit notes, receipts, customers, items; the Web Clock for themselves (a steward or a cashier)',
    employee: 'Their own login: clocks in and out, fills their timesheet, raises their claims; approves the timesheets and claims of the people who report to them; sees nothing else',
    manager: 'The HR screens, and approves timesheets and reimbursements; sees nothing of the books',
    hr: 'Employees, attendance, timesheets, reimbursements, payroll and HR settings; cannot approve; sees nothing of the books',
    viewer: 'Looks at everything, changes nothing'
  };
  // The collections a role may change (null = all); the server applies the same rule to every record
  const WRITES = { owner: null, admin: null, accountant: ['contacts', 'items', 'invoices', 'challans', 'purchases', 'procure', 'inventory', 'expenses', 'journal', 'notes', 'accounts', 'employees', 'attendance', 'clock', 'timesheets', 'reimbursements', 'payroll', 'hr'], sales: ['invoices', 'challans', 'notes', 'contacts', 'items', 'journal'], employee: ['clock', 'timesheets', 'reimbursements'], manager: ['employees', 'attendance', 'clock', 'timesheets', 'reimbursements', 'payroll', 'hr'], hr: ['employees', 'attendance', 'clock', 'timesheets', 'reimbursements', 'payroll', 'hr'], viewer: [] };
  // The screens a role may open (null = all)
  const OPENS = { owner: null, admin: null,
    accountant: ['dashboard', 'invoice', 'sales', 'challans', 'notes', 'contacts', 'items', 'stock', 'inventory', 'purchases', 'procurement', 'expenses', 'journal', 'money', 'salesReport', 'aging', 'payables', 'ledger', 'pnl', 'balance', 'backup', 'gst', 'migrate', 'companies', 'group', 'sync', 'company', 'subscription', 'employees', 'attendance', 'clock', 'timesheets', 'reimbursements', 'payroll', 'hrsettings'],
    manager: ['dashboard', 'employees', 'attendance', 'clock', 'timesheets', 'reimbursements', 'payroll', 'hrsettings', 'companies', 'sync', 'company', 'subscription'],
    hr: ['dashboard', 'employees', 'attendance', 'clock', 'timesheets', 'reimbursements', 'payroll', 'hrsettings', 'companies', 'sync', 'company', 'subscription'],
    employee: ['dashboard', 'clock', 'timesheets', 'reimbursements', 'companies', 'sync', 'company', 'subscription'],
    // Every member may open the Web Clock to clock themselves in and out (the login on their employee record)
    sales: ['dashboard', 'invoice', 'sales', 'challans', 'notes', 'contacts', 'items', 'money', 'salesReport', 'aging', 'ledger', 'clock', 'companies', 'sync', 'company', 'subscription'],
    viewer: ['dashboard', 'invoice', 'sales', 'challans', 'notes', 'contacts', 'items', 'stock', 'inventory', 'purchases', 'procurement', 'expenses', 'journal', 'money', 'salesReport', 'aging', 'payables', 'ledger', 'pnl', 'balance', 'clock', 'companies', 'group', 'sync', 'company', 'subscription'] };
  // The dashboard tiles a role gets (null = all)
  const TILES = { owner: null, admin: null, accountant: null, sales: ['invoice', 'sales', 'clock', 'items', 'receipts', 'customers', 'reports'], manager: ['hr'], hr: ['hr'], employee: ['clock', 'timesheets', 'reimbursements'], viewer: ['invoice', 'purchases', 'sales', 'items', 'expenses', 'receipts', 'payments', 'journal', 'customers', 'suppliers', 'reports'] };
  const COLLECTIONS = ['contacts', 'items', 'invoices', 'challans', 'purchases', 'procure', 'inventory', 'expenses', 'journal', 'notes', 'accounts', 'company', 'employees', 'attendance', 'clock', 'timesheets', 'reimbursements', 'payroll', 'hr'];
  /* Custom roles and the hierarchy. The books of a company carry one 'roles' record:
       { roles: [{ id, name, base, parent, modules }], assign: { 'u:<account id>' | 'p:<mobile, last ten digits>' | 'e:<email>': role id }, parents: { built-in role: the role it reports to } }
     A custom role works like its base role (the server holds the member to the base), with a name of its own, a
     place in the hierarchy and, when modules are ticked, only those parts of the portal. */
  const DEFAULT_PARENT = { admin: 'owner', manager: 'admin', accountant: 'admin', hr: 'manager', sales: 'manager', employee: 'manager', viewer: 'accountant' };
  const MODULES = [
    { key: 'sales', t: 'Sales', routes: ['invoice', 'sales', 'challans', 'notes', 'salesReport', 'aging', 'contacts', 'money'], cols: ['invoices', 'challans', 'notes', 'contacts', 'items', 'journal'], tiles: ['invoice', 'sales', 'customers', 'receipts', 'reports'] },
    { key: 'purchases', t: 'Purchases', routes: ['purchases', 'procurement', 'expenses', 'payables', 'contacts', 'money'], cols: ['purchases', 'procure', 'expenses', 'contacts', 'journal'], tiles: ['purchases', 'expenses', 'suppliers', 'payments'] },
    { key: 'inventory', t: 'Inventory', routes: ['items', 'stock', 'inventory'], cols: ['items', 'inventory'], tiles: ['items'] },
    { key: 'accounts', t: 'Accounts & reports', routes: ['journal', 'money', 'ledger', 'pnl', 'balance', 'group'], cols: ['journal', 'accounts'], tiles: ['journal', 'reports'] },
    { key: 'hr', t: 'HR & payroll', routes: ['employees', 'attendance', 'timesheets', 'reimbursements', 'payroll', 'hrsettings'], cols: ['employees', 'attendance', 'timesheets', 'reimbursements', 'payroll', 'hr'], tiles: ['hr', 'timesheets', 'reimbursements'] },
    { key: 'gst', t: 'GST & data', routes: ['gst', 'backup', 'migrate'], cols: [], tiles: ['migrate'] }
  ];
  const SUB_KEYS = ['registered_at', 'valid_until', 'used_codes', 'inv_quota', 'inv_used', 'inv_until', 'yearly_until', 'full_until'];
  const lower = (s) => String(s == null ? '' : s).trim().toLowerCase();

  const Companies = {
    ROLES, ROLE_LABEL, ROLE_HELP, MODULES,
    // ---- the account's companies, as last fetched (kept in the account's own namespace, so they are known offline)
    list() { return App.user ? (Store.peek(App.user.id, 'companies', []) || []) : []; },
    keep(list) { if (App.user) Store.poke(App.user.id, 'companies', list); },
    find(cid) { return this.list().find(c => c.id === cid) || null; },
    // The company whose books are open now
    current() { return Store.cid ? this.find(Store.cid) : (this.list().find(c => c.primary && c.role === 'owner') || null); },
    currentName() { const c = this.current(); return c && c.name ? c.name : Store.company().name; },
    isPrimary() { return !Store.cid; },
    role() { if (!Store.cid) return 'owner'; const c = this.find(Store.cid); return c && ROLES.includes(c.role) ? c.role : 'viewer'; },
    roleLabel() { const c = this.myCustom(); return c ? c.name : ROLE_LABEL[this.role()]; },

    // ---- custom roles and the hierarchy (of the company that is open)
    rolesDoc() { const d = Store.get('roles', null) || {}; return { roles: Array.isArray(d.roles) ? d.roles.filter(r => r && r.id && !ROLES.includes(r.id) && String(r.name || '').trim() && ROLES.includes(r.base) && r.base !== 'owner') : [], assign: d.assign && typeof d.assign === 'object' ? Object.assign({}, d.assign) : {}, parents: d.parents && typeof d.parents === 'object' ? Object.assign({}, d.parents) : {} }; },
    saveRolesDoc(d) { return Store.set('roles', { roles: d.roles, assign: d.assign, parents: d.parents }); },
    customRoles() { return this.rolesDoc().roles; },
    // The modules a base role reaches at all: what a custom role on that base may be narrowed to
    modulesOf(base) { const o = OPENS[base]; return MODULES.filter(m => !o || m.routes.some(r => o.includes(r))); },
    allRoles() {
      const d = this.rolesDoc();
      return ROLES.map(r => ({ id: r, name: ROLE_LABEL[r], base: r, custom: false, parent: r === 'owner' ? '' : (d.parents[r] || DEFAULT_PARENT[r]), modules: null }))
        .concat(d.roles.map(r => ({ id: r.id, name: String(r.name).trim(), base: r.base, custom: true, parent: r.parent || DEFAULT_PARENT[r.base] || 'owner', modules: Array.isArray(r.modules) ? r.modules : null })));
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
    // A custom role with modules ticked sees only those parts (a screen, a collection or a tile outside every module is not narrowed)
    narrowed(kind, key) { const c = this.myCustom(); if (!c || !Array.isArray(c.modules)) return true; const mods = MODULES.filter(m => m[kind].includes(key)); return !mods.length || mods.some(m => c.modules.includes(m.key)); },
    isOpen(c) { return !!c && (Store.cid || '') === (c.primary && c.role === 'owner' ? '' : c.id); },
    seesText(r) { if (r.base === 'owner' || (r.base === 'admin' && !r.modules)) return 'Everything'; if (r.base === 'employee' && !r.modules) return 'Own clock, timesheet, claims'; const mods = this.modulesOf(r.base).filter(m => !r.modules || r.modules.includes(m.key)); return (r.base === 'viewer' ? 'Read only: ' : '') + (mods.map(m => m.t).join(', ') || '-'); },
    rolesDialog() {
      const manage = ['owner', 'admin'].includes(this.role()) && this.yearly();
      const bg = UI.modal({ title: 'Roles & hierarchy', wide: true, focus: false, body: '<div id="rlList"></div>', buttons: [{ label: 'Close', cls: 'outline' }].concat(manage ? [{ label: '+ New role', cls: 'green', onClick: () => { this.editRole(null, draw); return false; } }] : []) });
      const draw = () => {
        if (!bg.isConnected) return;
        const h = this.hierarchy(), name = new Map(h.map(r => [r.id, r.name]));
        $('#rlList', bg).innerHTML = '<table class="list"><thead><tr><th>Role</th><th>Works like</th><th>Reports to</th><th>Sees</th>' + (manage ? '<th></th>' : '') + '</tr></thead><tbody>' + h.map(r => '<tr data-role-id="' + esc(r.id) + '"><td style="white-space:nowrap"><span style="display:inline-block;width:' + (r.depth * 20) + 'px"></span>' + (r.depth ? '<span class="muted">└ </span>' : '') + '<span class="pill ' + (r.id === 'owner' ? 'ok' : r.custom ? 'warn' : '') + '">' + esc(r.name) + '</span></td><td>' + (r.custom ? esc(ROLE_LABEL[r.base]) : '<span class="muted">Built in</span>') + '</td><td>' + esc(name.get(r.parent) || '-') + '</td><td>' + esc(this.seesText(r)) + '</td>' +
          (manage ? '<td class="actions">' + (r.id === 'owner' ? '' : '<button class="btn sm outline" data-edit-role="' + esc(r.id) + '">Edit</button>') + (r.custom ? '<button class="btn sm red" data-del-role="' + esc(r.id) + '">Delete</button>' : '') + '</td>' : '') + '</tr>').join('') + '</tbody></table>';
        $$('[data-edit-role]', bg).forEach(b => b.onclick = () => this.editRole(this.hierarchy().find(r => r.id === b.dataset.editRole), draw));
        $$('[data-del-role]', bg).forEach(b => b.onclick = () => { const r = this.hierarchy().find(x => x.id === b.dataset.delRole); UI.confirm('Delete role', 'Delete the role ' + r.name + '? Its members keep working as ' + ROLE_LABEL[r.base] + '.', () => {
          const d = this.rolesDoc(); d.roles = d.roles.filter(x => x.id !== r.id); d.roles.forEach(x => { if (x.parent === r.id) x.parent = r.parent; }); Object.keys(d.parents).forEach(k => { if (d.parents[k] === r.id) d.parents[k] = r.parent; }); Object.keys(d.assign).forEach(k => { if (d.assign[k] === r.id) delete d.assign[k]; });
          if (this.saveRolesDoc(d) !== false) UI.toast('Role deleted'); draw(); App.refreshNav();
        }, 'Delete'); });
      };
      draw();
      return bg;
    },
    // A new custom role, a custom role's name / reporting line / modules, or the reporting line of a built-in role
    editRole(r, done) {
      const custom = !r || r.custom, all = this.hierarchy(), under = r ? this.below(r.id) : [];
      const parents = all.filter(x => !r || (x.id !== r.id && !under.includes(x.id))).map(x => [x.id, x.name]);
      const mods = (base, on) => this.modulesOf(base).map(m => '<label class="check" style="margin-right:14px"><input type="checkbox" class="rlMod" value="' + m.key + '"' + (!on || on.includes(m.key) ? ' checked' : '') + '> ' + esc(m.t) + '</label>').join('');
      const base0 = r ? r.base : 'sales';
      const bg = UI.modal({ title: r ? 'Role: ' + r.name : 'New role', body: (custom ? UI.field('Role name', UI.input('rlName', r ? r.name : '', { placeholder: 'e.g. Store Manager, Cashier, Steward', attrs: ' maxlength="40"' }), { req: true }) +
          UI.field('Works like', UI.select('rlBase', ROLES.filter(x => x !== 'owner').map(x => [x, ROLE_LABEL[x]]), base0, r ? { attrs: ' disabled' } : {})) : '') +
          UI.field('Reports to', UI.select('rlParent', parents, r ? r.parent : 'admin')) +
          (custom ? '<div class="field span"><label>Sees</label><div id="rlMods">' + mods(base0, r ? r.modules : null) + '</div></div>' : ''),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Save', cls: 'green', onClick: (bg) => {
          const d = this.rolesDoc(), parent = UI.val('rlParent', bg) || 'owner';
          if (!custom) { d.parents[r.id] = parent; }
          else {
            const name = String(UI.val('rlName', bg)).trim().replace(/\s+/g, ' '), base = r ? r.base : UI.val('rlBase', bg);
            if (!name) { UI.mark('rlName', true, bg); UI.toast('Enter the role name'); return false; }
            if (this.allRoles().some(x => lower(x.name) === lower(name) && (!r || x.id !== r.id))) { UI.mark('rlName', true, bg); UI.toast('There is a role called ' + name + ' already'); return false; }
            const offered = this.modulesOf(base).map(m => m.key), ticked = $$('.rlMod', bg).filter(c => c.checked).map(c => c.value);
            if (offered.length && !ticked.length) { UI.toast('Tick at least one part the role sees'); return false; }
            const modules = offered.length && ticked.length < offered.length ? ticked : null;
            if (r) Object.assign(d.roles.find(x => x.id === r.id), { name, parent, modules });
            else d.roles.push({ id: 'r' + U.uid(), name, base, parent, modules });
          }
          if (this.saveRolesDoc(d) === false) return false;
          UI.toast('Role saved'); App.refreshNav(); if (done) done();
        } }] });
      if ($('#rlBase', bg) && !r) $('#rlBase', bg).onchange = (e) => { $('#rlMods', bg).innerHTML = mods(e.target.value, null); };
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
    yearly() { return Sub.isYearly() && !Sub.isLite(); },
    groupAllowed() { return Sub.isYearlyPaid() && !Sub.isLite(); },
    lock() {
      UI.modal({ title: 'Yearly subscription required', body: '<div class="gstlock"><div class="big">🔒</div><div><p>Companies, groups, members and group statements come with the yearly plan and longer. ' + esc(Sub.statusText()) + '.</p></div></div>',
        buttons: [{ label: 'Close', cls: 'outline' }, { label: 'Buy yearly plan', cls: 'blue', onClick: () => { if (Store.cid) Companies.switcher(); else Subscription.plans(); } }] });
      return false;
    },
    // The account's own id on the server, from the token
    myUid() { try { const t = Sync.state().token; return JSON.parse(atob(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || ''; } catch (e) { return ''; } },

    // ---- permissions
    // The web clock is open to every member for their own punches; the server holds the others to the HR roles
    mayWrite(key) { if (!Store.cid || key === 'clock') return true; if (key === 'roles') return ['owner', 'admin'].includes(this.role()); if (!COLLECTIONS.includes(key)) return true; const w = WRITES[this.role()]; return (!w || w.includes(key)) && this.narrowed('cols', key); },
    mayOpen(route) { if (!Store.cid) return true; const o = OPENS[this.role()]; return (!o || o.includes(route)) && this.narrowed('routes', route); },
    tileAllowed(key) { if (!Store.cid) return true; const t = TILES[this.role()]; return (!t || t.includes(key)) && this.narrowed('tiles', key); },
    readOnlyText(key) {
      const r = this.roleLabel();
      return key === 'company' ? 'Only the owner or an admin can change the company profile (your role here: ' + r + ')' : key === 'roles' ? 'Only the owner or an admin can change the roles' : this.role() === 'viewer' ? 'Read-only access: a viewer cannot save changes in this company' : 'Your role here (' + r + ') cannot change ' + (key === 'hr' ? 'the HR settings' : key);
    },

    // ---- server calls
    rpc(name, args) { return Sub.withToken((token) => Supabase.http('POST', '/rest/v1/rpc/' + name, args || {}, token)); },
    async load() {
      if (!this.available()) return this.list();
      const r = await this.rpc('my_companies');
      const list = Array.isArray(r) ? r : [];
      this.keep(list);
      return list;
    },
    // Loads quietly in the background (after login): the switcher and the dashboard then know every company
    refresh() { if (!this.available()) return Promise.resolve([]); return this.load().then(l => { if (App.user && App.current && App.current.route === 'dashboard' && !$('#dialogs').children.length) App.refreshBar(); return l; }, () => this.list()); },
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
      UI.toast('Now in ' + (cid ? (c.name || 'the company') : 'your own company') + (cid ? ' as ' + ROLE_LABEL[c.role] : ''), 3000);
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
      const list = this.list(), cur = Store.cid || '';
      const groups = this.grouped(list);
      const body = '<div class="menu-list">' + (list.length ? groups.map(g => '<div class="grp-h">' + esc(g.name || (g.items.some(c => c.primary) ? '' : 'No group')) + '</div>' + g.items.map(c => '<button data-cid="' + esc(c.primary && c.role === 'owner' ? '' : c.id) + '" class="' + ((c.primary && c.role === 'owner' ? '' : c.id) === cur ? 'sel' : '') + '">' + esc(c.name || 'Unnamed company') + '<span class="pill ' + (c.role === 'owner' ? 'ok' : c.role === 'viewer' ? '' : 'warn') + '" style="margin-left:8px">' + esc(ROLE_LABEL[c.role] || c.role) + '</span>' + (c.role !== 'owner' && c.owner_name ? '<span class="small muted" style="margin-left:6px">' + esc(c.owner_name) + '</span>' : '') + '</button>').join('')).join('') : '<div class="hint">Only your own company so far.</div>') + '</div>';
      const bg = UI.modal({ title: 'Companies', body, buttons: [{ label: 'Company Profile', cls: 'outline', onClick: () => { Company.edit(false); } }, { label: 'Manage', onClick: () => { App.go('companies'); } }] });
      $$('[data-cid]', bg).forEach(b => b.onclick = () => { bg.remove(); this.switchTo(b.dataset.cid); });
      // The list as last known is shown at once; a fresher one from the server replaces it (once)
      if (!fresh && this.available()) this.load().then((l) => { if (bg.isConnected && JSON.stringify(l) !== JSON.stringify(list)) { bg.remove(); this.switcher(true); } }, () => { /* the list as last known */ });
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
          return '<tr' + (key === cur ? ' class="grp"' : '') + '><td data-l="Company"><b>' + esc(c.name || 'Unnamed company') + '</b>' + (c.primary && mine ? '<div class="small muted">Your first company</div>' : '') + '</td><td data-l="Role"><span class="pill ' + (own ? 'ok' : c.role === 'viewer' ? '' : 'warn') + '">' + esc(ROLE_LABEL[c.role] || c.role) + '</span></td><td data-l="Owner">' + esc(mine ? 'You' : c.owner_name || '') + '</td><td class="num" data-l="Members">' + (1 + (parseInt(c.members, 10) || 0)) + '</td>' +
            '<td class="actions">' + (key === cur ? '<span class="pill ok">Open now</span>' : '<button class="btn sm" data-open="' + esc(key) + '">Open</button>') +
            '<button class="btn sm outline" data-members="' + esc(c.id) + '">Members</button>' + ((own || c.role === 'admin') && yearly ? '<button class="btn sm outline" data-edit="' + esc(c.id) + '">Group / name</button>' : '') +
            (own && !c.primary ? '<button class="btn sm red" data-del="' + esc(c.id) + '">Delete</button>' : '') + (!own ? '<button class="btn sm red" data-leave="' + esc(c.id) + '">Leave</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
      $('#coList').innerHTML = (yearly ? '' : '<div class="card white"><div class="bd gstlock"><div class="big">🔒</div><div><h3>Yearly subscription required</h3><p class="muted">Making companies, groups and members and the group statements come with the yearly plan and longer; a company you were given a role in can be opened. ' + esc(Sub.statusText()) + '.</p>' + (Store.cid ? '' : '<button class="btn blue" id="coBuy">Buy yearly plan</button>') + '</div></div></div>') + this.grouped(list).map(card).join('') +
        '<div class="card white"><div class="hd">Roles</div><div class="bd"><div class="btnrow" style="margin:0 0 10px"><button class="btn sm blue" id="coRoles">Roles & hierarchy</button></div><table class="list"><tbody>' + ROLES.map(r => '<tr><td style="white-space:nowrap"><span class="pill ' + (r === 'owner' ? 'ok' : r === 'viewer' ? '' : 'warn') + '">' + ROLE_LABEL[r] + '</span></td><td>' + esc(ROLE_HELP[r]) + '</td></tr>').join('') + '</tbody></table></div></div>';
      if ($('#coBuy')) $('#coBuy').onclick = () => Subscription.plans();
      if ($('#coRoles')) $('#coRoles').onclick = () => this.rolesDialog();
      $$('[data-open]', root).forEach(b => b.onclick = () => this.switchTo(b.dataset.open));
      $$('[data-members]', root).forEach(b => b.onclick = () => this.members(list.find(c => c.id === b.dataset.members)));
      $$('[data-edit]', root).forEach(b => b.onclick = () => this.edit(list.find(c => c.id === b.dataset.edit)));
      $$('[data-del]', root).forEach(b => b.onclick = () => { const c = list.find(x => x.id === b.dataset.del); UI.confirm('Delete Company', 'Delete "' + c.name + '" and all its books (invoices, parties, purchases, everything) for every member? This cannot be undone.\n\nTip: open the company and take an Export first.', async () => {
        try { this.checked(await this.rpc('delete_company', { cid: c.id }), 'Delete'); } catch (e) { UI.toast(e.message, 6000); return; }
        if (Store.cid === c.id) { await this.switchTo(''); }
        UI.toast('Company deleted'); if (here()) this.screen();
      }, 'Delete'); });
      $$('[data-leave]', root).forEach(b => b.onclick = () => { const c = list.find(x => x.id === b.dataset.leave); UI.confirm('Leave Company', 'Leave "' + c.name + '"? You will no longer see its books unless the owner adds you again.', async () => {
        try { this.checked(await this.rpc('remove_member', { cid: c.id, member: me }), 'Leave'); } catch (e) { UI.toast(e.message, 6000); return; }
        if (Store.cid === c.id) { await this.switchTo(''); }
        UI.toast('You left ' + c.name); if (here()) this.screen();
      }, 'Leave'); });
    },
    create() {
      UI.modal({ title: 'New Company', body: UI.field('Company name', UI.input('ncName', '', { attrs: ' maxlength="120"' }), { req: true, hint: 'The full profile (GSTIN, address, bank) is filled in under Company Profile once the company is open.' }) +
          UI.field('Group', UI.input('ncGroup', '', { placeholder: 'e.g. Sharma Group', list: 'ncGroups', attrs: ' maxlength="80"' }), { hint: 'Companies in the same group appear together in the consolidated statements. Leave blank for none.' }) + UI.datalist('ncGroups', this.groupNames()),
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Create', cls: 'green', onClick: async (bg) => {
          const name = UI.val('ncName', bg).trim(), group = UI.val('ncGroup', bg).trim();
          if (!name) { UI.toast('Enter the company name'); return false; }
          let r;
          try { r = this.checked(await this.rpc('create_company', { name_in: name, group_in: group }), 'Create'); }
          catch (e) { UI.toast(e.status === 404 ? 'Companies are not set up on the server yet' : e.message, 6000); return false; }
          await this.load().catch(() => null);
          UI.toast('Company created');
          UI.confirm('Open ' + name + '?', 'Open the new company now to set up its profile? You can switch back any time from the company chip in the top bar.', () => this.switchTo(r.id), 'Open');
          if (App.current && App.current.route === 'companies') this.screen();
          return true;
        } }] });
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
      const options = () => ROLES.filter(r => r !== 'owner').map(r => [r, ROLE_LABEL[r]]).concat(open ? this.customRoles().map(r => ['c:' + r.id, r.name + ' (' + ROLE_LABEL[r.base] + ')']) : []);
      const picked = (v) => { const r = /^c:/.test(v) ? this.customRoles().find(x => x.id === v.slice(2)) : null; return { base: r ? r.base : v, custom: r }; };
      const bg = UI.modal({ title: 'Members of ' + (c.name || 'the company'), wide: true, focus: false, body: '<div id="mbList"><div class="hint">Loading…</div></div>' +
          (manage ? '<div class="field span" style="margin-top:12px"><label>Add a member</label><div class="btnrow" style="margin:0"><input id="mbId" placeholder="Mobile number or email" style="flex:1;min-width:200px">' + UI.select('mbRole', options(), 'viewer') + '<button class="btn sm green" id="mbAdd">Add</button></div></div>' : ''),
        buttons: [{ label: 'Close', cls: 'outline' }].concat(open ? [{ label: 'Roles & hierarchy', onClick: () => { const rb = this.rolesDialog(); const mo = new MutationObserver(() => { if (!rb.isConnected) { mo.disconnect(); if (bg.isConnected) { if ($('#mbRole', bg)) $('#mbRole', bg).innerHTML = options().map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === 'viewer' ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join(''); draw(); } } }); mo.observe($('#dialogs'), { childList: true }); return false; } }] : []) });
      const draw = async () => {
        let list;
        try { list = this.checked(await this.rpc('list_members', { cid: c.id }), 'Members'); } catch (e) { if (bg.isConnected) $('#mbList', bg).innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; return; }
        if (!bg.isConnected) return;
        list = Array.isArray(list) ? list : [];
        const cust = (m) => open && m.role !== 'owner' ? this.customOf(m, m.role) : null;
        $('#mbList', bg).innerHTML = '<table class="list"><thead><tr><th>Name</th><th>Mobile</th><th>Email</th><th>Role</th>' + (manage ? '<th></th>' : '') + '</tr></thead><tbody>' + list.map((m, n) => '<tr' + (m.invited ? ' class="muted"' : '') + '><td><b>' + esc(m.name || (m.invited ? 'Invited' : '-')) + '</b>' + (m.user_id && m.user_id === me ? ' <span class="small muted">(you)</span>' : '') + (m.invited ? '<div class="small muted">Not registered yet</div>' : '') + '</td><td>' + esc(m.phone || '-') + '</td><td>' + esc(m.email || '-') + '</td><td>' +
          (manage && m.role !== 'owner' ? UI.select('r_' + n, options(), cust(m) ? 'c:' + cust(m).id : m.role, { attrs: ' data-role="' + esc(m.user_id || '') + '" data-id="' + esc(m.phone || m.email) + '" data-n="' + n + '" style="min-height:34px;padding:4px 8px"' }) : '<span class="pill ' + (m.role === 'owner' ? 'ok' : 'warn') + '">' + esc(cust(m) ? cust(m).name : ROLE_LABEL[m.role] || m.role) + '</span>') + (m.invited ? ' <span class="pill">Invited</span>' : '') + '</td>' +
          (manage ? '<td class="actions">' + (m.role !== 'owner' ? '<button class="btn sm red"' + (m.invited ? ' data-uninvite="' + esc(m.phone || m.email) + '"' : ' data-rm="' + esc(m.user_id) + '"') + ' data-name="' + esc(m.name || m.phone || m.email) + '">' + (m.invited ? 'Withdraw' : 'Remove') + '</button>' : '') + '</td>' : '') + '</tr>').join('') + '</tbody></table>';
        $$('[data-role]', bg).forEach(s => s.onchange = async () => { const p = picked(s.value), m = list[+s.dataset.n]; try { if (p.base !== m.role) this.checked(await this.rpc('set_member', { cid: c.id, identity: s.dataset.id, role_in: p.base }), 'Change role'); if (open && (p.custom || this.customOf(m))) this.setCustom(m, p.custom ? p.custom.id : ''); UI.toast('Role changed'); } catch (e) { UI.toast(e.message, 6000); } draw(); });
        $$('[data-rm]', bg).forEach(b => b.onclick = () => UI.confirm('Remove Member', 'Remove ' + (b.dataset.name || 'this member') + ' from ' + c.name + '?', async () => { try { this.checked(await this.rpc('remove_member', { cid: c.id, member: b.dataset.rm }), 'Remove'); UI.toast('Member removed'); } catch (e) { UI.toast(e.message, 6000); } draw(); this.load().catch(() => null); }, 'Remove'));
        $$('[data-uninvite]', bg).forEach(b => b.onclick = () => UI.confirm('Withdraw Invitation', 'Withdraw the invitation of ' + b.dataset.uninvite + ' to ' + c.name + '? They can be invited again any time.', async () => { try { this.checked(await this.rpc('remove_invite', { cid: c.id, identity: b.dataset.uninvite }), 'Withdraw'); UI.toast('Invitation withdrawn'); } catch (e) { UI.toast(e.message, 6000); } draw(); }, 'Withdraw'));
      };
      if (manage) $('#mbAdd', bg).onclick = async () => {
        const id = UI.val('mbId', bg).trim(); if (!id) { UI.toast('Enter the mobile number or email'); return; }
        $('#mbAdd', bg).disabled = true;
        try { const p = picked(UI.val('mbRole', bg)), r = await this.invite(c.id, id, p.base); if (open && p.custom) this.setCustom({ user_id: r.user_id || '', phone: /@/.test(id) ? (r.phone || '') : id, email: /@/.test(id) ? id : (r.email || '') }, p.custom.id); UI.toast(this.inviteText(r, id), 8000); $('#mbId', bg).value = ''; this.shareJoin({ e: /@/.test(id) ? id.toLowerCase() : String(r.email || '').toLowerCase(), p: /@/.test(id) ? String(r.phone || '') : id, n: r.name || '', c: c.name, r: r.role, by: (App.user && App.user.name) || '', mailed: !!r.mailed, hasAccount: !r.invited }); }
        catch (e) { UI.toast(e.message, 7000); }
        finally { if (bg.isConnected) $('#mbAdd', bg).disabled = false; }
        draw(); this.load().catch(() => null);
      };
      draw();
    },

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
  App.routes.group = (p) => Companies.groupScreen(p || {});
  global.Companies = Companies;
})(window);
