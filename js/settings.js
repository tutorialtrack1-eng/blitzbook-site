/* BlitzBook web portal - Settings (the gear at the top right of the bar).

   Everything that sets the portal up, as against the work done in it, is here in one place, each a section:
     All Settings        the sections as cards, and the way to the profile, the plan and the rest of the Company menu
     Invoice Fields      which fields of Other Details an invoice of this company shows
     Shortcuts           the login's own key combinations and buttons (shortcuts.js)
     Users & Roles       the people with a login in this company, their roles and the hierarchy (companies.js)
     Tab Access          which tabs of the menu each role is shown (companies.js, the screen it always was)
     Businesses & Tabs   the businesses of the company and the menu groups shown at all (business.js)
     Rental              what a rental business calls and keeps of its buildings, rooms, beds, furniture and tenants (rental.js)
     AI Access           the API keys of the MCP server and what each key may do (app.js, AiAccess)
   Tab Access, Businesses & Tabs and AI Access keep their own screens and addresses (#tabaccess, #business, #ai); they
   left the Company menu, and every screen of this family carries the same strip of sections under its heading
   (Settings.strip, called by App.view), so one moves between them as between the tabs of one screen.

   A login sees the sections it can use: a member who is not the owner or an admin gets no Tab Access or Businesses,
   an employee login only the general page. What may be changed in a section is the section's own rule.

   The company's settings are one record of the books, 'settings', synced like the roles and read by the Android app:
     { invFields: [key] }   the fields of Other Details that are shown; absent = the standard set of the business
   The keys are the app's (MainActivity, optField): destination, vehicle, vehicle_number, transporter, delivery_note,
   order_no, order_date, reference, other_info. Only the owner or an admin changes the record. */
(function (global) {
  'use strict';
  const { esc } = U;
  const KEY = 'settings';
  const FAMILY = ['settings', 'tabaccess', 'business', 'ai'];
  // f = the field of inv.other, id = its input on the invoice screen (invoice.js); dispatch = left out by a business
  // that sends no goods; more = behind "Show additional details"
  const INV_FIELDS = [
    { key: 'destination', t: 'Destination', f: 'destination', id: 'oDest', dispatch: true },
    { key: 'vehicle', t: 'Vehicle Type', f: 'vehicleType', id: 'oVType', dispatch: true },
    { key: 'vehicle_number', t: 'Vehicle Number', f: 'vehicleNo', id: 'oVNo', dispatch: true },
    { key: 'transporter', t: 'Transporter', f: 'transporter', id: 'oTrans', dispatch: true, more: true },
    { key: 'delivery_note', t: 'Delivery Note', f: 'deliveryNote', id: 'oDN', dispatch: true, more: true },
    { key: 'order_no', t: 'Buyer Order No', f: 'orderNo', id: 'oOrd', more: true },
    { key: 'order_date', t: 'Buyer Order Date', f: 'orderDate', id: 'oOrdDt', more: true, date: true },
    { key: 'reference', t: 'Reference No', f: 'reference', id: 'oRef', more: true },
    { key: 'other_info', t: 'Other Info', f: 'info', id: 'oInfo', more: true }
  ];
  const card = (ic, t, d, attrs, pill) => '<button type="button" class="setcard" ' + attrs + '><span class="setic">' + global.icon(ic) + '</span><span class="settx"><b>' + esc(t) + (pill ? ' <span class="pill">' + esc(pill) + '</span>' : '') + '</b><span>' + esc(d) + '</span></span></button>';

  const Settings = {
    INV_FIELDS, FAMILY,
    has(route) { return FAMILY.includes(route); },
    doc() { const d = Store.get(KEY, null); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; },
    // Only the owner or an admin changes the company's settings (a member reads them)
    mayEdit() { return !Store.cid || ['owner', 'admin'].includes(Companies.role()); },
    // Writes the given keys over the record; a key given as undefined is taken out
    save(patch) {
      if (!this.mayEdit()) { UI.toast('Only the owner or an admin changes the settings of the company', 4000); return false; }
      const d = Object.assign({}, this.doc(), patch);
      Object.keys(d).forEach(k => { if (d[k] === undefined) delete d[k]; });
      return Store.set(KEY, d);
    },

    // ---- the fields of Other Details on an invoice
    // A business that sends no goods (services, a clinic, a school ...: invoice.js says which) starts without the dispatch fields
    invStandard(service) { return INV_FIELDS.filter(f => !service || !f.dispatch).map(f => f.key); },
    invChosen() { const l = this.doc().invFields; return Array.isArray(l) ? INV_FIELDS.map(f => f.key).filter(k => l.includes(k)) : null; },
    invShown(service) { return this.invChosen() || this.invStandard(service); },
    serviceLike() { return !!global.Biz && Biz.vertical && Biz.vertical() === 'service'; },
    invTicks(on, edit) { return '<div class="grid3" id="sfTicks">' + INV_FIELDS.map(f => '<label class="check"><input type="checkbox" class="sfTick" value="' + f.key + '"' + (on.includes(f.key) ? ' checked' : '') + (edit ? '' : ' disabled') + '> ' + esc(f.t) + '</label>').join('') + '</div>'; },
    // The same choice from the invoice screen, without leaving the invoice being typed
    invDialog(onSaved) {
      const edit = this.mayEdit(), service = this.serviceLike();
      const bg = UI.modal({ title: 'Fields on the invoice', body: '<p class="hint" style="margin-top:0">Tick the fields of Other Details that an invoice of <b>' + esc(Store.company().name || 'this company') + '</b> shows, here and in the app. A field that holds a value on an invoice is always shown.' + (edit ? '' : ' Only the owner or an admin can change this.') + '</p>' + this.invTicks(this.invShown(service), edit),
        buttons: [{ label: edit ? 'Cancel' : 'Close', cls: 'outline' }].concat(edit ? [{ label: 'Standard', cls: 'outline', onClick: () => { if (this.save({ invFields: undefined }) === false) return false; UI.toast('Standard fields for ' + U.activityText(Store.company())); if (onSaved) onSaved(); } },
          { label: 'Save', cls: 'green', onClick: (bg) => { if (this.save({ invFields: $$('.sfTick', bg).filter(c => c.checked).map(c => c.value) }) === false) return false; UI.toast('Fields saved', 2500, 'ok'); if (onSaved) onSaved(); } }] : []) });
      return bg;
    },

    // ---- the sections, in the order of the strip; ok = whether this login gets it here
    sections() {
      const self = Companies.selfService(), menu = (r, p) => App.menuHas(r, p);
      return [
        { id: 'general', t: 'All Settings', ic: 'gear', route: 'settings', ok: true },
        { id: 'invoice', t: 'Invoice Fields', ic: 'receipt', route: 'settings', ok: !self && menu('invoice'), d: 'Which fields of Other Details an invoice shows: destination, vehicle, transporter, order and reference. The same in the app.' },
        { id: 'shortcuts', t: 'Shortcuts', ic: 'bolt', route: 'settings', ok: !self && !!global.Shortcuts, d: 'Your own keys and buttons for the screens you use most.' },
        { id: 'users', t: 'Users & Roles', ic: 'users', route: 'settings', ok: !self && !Sub.isLite(), d: 'The people with a login in this company: add employees, give each a role, set who reports to whom.' },
        { id: 'tabaccess', t: 'Tab Access', ic: 'eye', route: 'tabaccess', ok: !self && menu('tabaccess') && this.mayEdit(), d: 'Which tabs of the menu each role is shown, in the portal and in the app.' },
        { id: 'business', t: 'Businesses & Tabs', ic: 'layers', route: 'business', ok: !self && menu('business') && this.mayEdit(), d: 'The businesses the company runs and the menu groups shown at all: Hotel, Rental, Manpower, Inventory, HR ...' },
        { id: 'rental', t: 'Rental', ic: 'key', route: 'settings', ok: !self && !!global.Rental && !!global.Business && Business.shown('Rental') && menu('rental'), d: 'What a rental business calls its buildings, rooms, beds, furniture and tenants, and the fields, lists and rent rules of its own.' },
        { id: 'ai', t: 'AI Access', ic: 'shield', route: 'ai', ok: !self && menu('ai'), d: 'API keys for ChatGPT, Claude, Gemini and other assistants, and what each key may see and do in the books.' }
      ].filter(s => s.ok);
    },
    go(s) { App.go(s.route, s.route === 'settings' ? { tab: s.id } : undefined); },
    // The strip of sections under the heading of every screen of the family (App.view)
    strip(view, route, params) {
      if (!this.has(route) || !view) return;
      const list = this.sections(), on = route === 'settings' ? ((params && params.tab) || 'general') : route;
      if (list.length < 2) return;
      const heads = $$('.page-h', view), after = heads[1] || heads[0]; if (!after) return;
      after.insertAdjacentHTML('afterend', '<div class="setnav" role="tablist" aria-label="Settings">' + list.map(s => '<button type="button" role="tab" class="' + (s.id === on ? 'sel' : '') + '" aria-selected="' + (s.id === on) + '" data-set="' + s.id + '">' + global.icon(s.ic) + '<span>' + esc(s.t) + '</span></button>').join('') + '</div>');
      $$('.setnav [data-set]', view).forEach(b => b.onclick = () => { const s = list.find(x => x.id === b.dataset.set); if (s) this.go(s); });
    },

    screen(p) {
      const list = this.sections(), tab = list.some(s => s.id === p.tab && s.route === 'settings') ? p.tab : 'general';
      if (App.current && App.current.route === 'settings') App.current.params = { tab };
      const body = this[tab + 'Tab']();
      const root = App.view(App.header('Settings') + body.html);
      App.wireBack(root);
      if (body.wire) body.wire(root, () => { if (App.current && App.current.route === 'settings') this.screen({ tab }); });
    },

    generalTab() {
      const list = this.sections().filter(s => s.id !== 'general'), menu = (r) => App.menuHas(r), co = Store.company().name || Companies.currentName() || 'this company';
      const more = [
        menu('company') ? card('building', 'Company Profile', 'Name, tax number, address, bank accounts, logo, signature, invoice number format, terms.', 'data-open="company"') : '',
        menu('companies') ? card('layers', 'Companies', 'The companies under this login, their groups and members.', 'data-open="companies"') : '',
        menu('currency') ? card('rupee', 'Currencies & Rates', 'The currencies an invoice can be shown in, with their rates.', 'data-open="currency"') : '',
        menu('licences') ? card('key', 'Licences', 'A seat for each user, and further companies.', 'data-open="licences"') : '',
        menu('subscription') ? card('star', 'Subscription', Sub.statusText(), 'data-open="subscription"') : '',
        menu('backup') ? card('download', 'Export / Import', 'A backup file of the books, and bringing one back.', 'data-open="backup"') : '',
        card(Theme.isDark() ? 'sun' : 'moon', Theme.isDark() ? 'Light mode' : 'Dark mode', 'The colours of the portal on this device.', 'data-theme-toggle')
      ].join('');
      return { html: '<div class="hint" style="margin-bottom:12px">How BlitzBook is set up for <b>' + esc(co) + '</b> and for your login. What is set here holds in the web portal and in the app.</div>' +
          (list.length ? '<div class="setgrid">' + list.map(s => card(s.ic, s.t, s.d, 'data-set="' + s.id + '"')).join('') + '</div>' : '') +
          '<div class="section-title">Company &amp; account</div><div class="setgrid">' + more + '</div>',
        wire: (root, again) => {
          $$('.setgrid [data-set]', root).forEach(b => b.onclick = () => { const s = list.find(x => x.id === b.dataset.set); if (s) this.go(s); });
          $$('[data-open]', root).forEach(b => b.onclick = () => App.go(b.dataset.open));
          $$('[data-theme-toggle]', root).forEach(b => b.onclick = () => { Theme.toggle(); again(); });
        } };
    },

    invoiceTab() {
      const edit = this.mayEdit(), service = this.serviceLike(), chosen = this.invChosen(), on = this.invShown(service);
      return { html: '<div class="card white"><div class="hd">Fields of Other Details on an invoice' + (chosen ? ' <span class="pill warn">your choice</span>' : ' <span class="pill ok">standard</span>') + '</div><div class="bd">' +
          '<p class="hint" style="margin-top:0">Not every business needs every field: a services business dispatches nothing. Tick the fields an invoice of <b>' + esc(Store.company().name || 'this company') + '</b> shows. The choice is kept with the company, so every user sees the same invoice, in the web portal and in the app.</p>' +
          this.invTicks(on, edit) +
          '<div class="hint">Until a choice is made, ' + (service ? 'a business of this kind starts without Destination, the vehicle, Transporter and Delivery Note.' : 'every field is shown.') + ' A field that holds a value on an invoice is always shown, so nothing typed is ever hidden. A transporter&#39;s invoice and a delivery challan keep every field; a restaurant bills by table and steward instead.</div>' +
          (edit ? '<div class="btnrow"><button class="btn green" id="sfSave">Save</button><button class="btn outline" id="sfStd" title="Back to the fields this kind of business starts with">Use standard</button></div>' : '<div class="hint">Only the owner or an admin can change this.</div>') + '</div></div>',
        wire: (root, again) => {
          if (!edit) return;
          $('#sfSave').onclick = () => { if (this.save({ invFields: $$('.sfTick', root).filter(c => c.checked).map(c => c.value) }) === false) return; UI.toast('Invoice fields saved', 3000, 'ok'); again(); };
          $('#sfStd').onclick = () => { if (this.save({ invFields: undefined }) === false) return; UI.toast('Standard fields for ' + U.activityText(Store.company()), 3000); again(); };
        } };
    },

    shortcutsTab() {
      return { html: '<div class="card white"><div class="hd">Shortcuts</div><div class="bd"><div class="field span" id="stScBox">' + Shortcuts.profileHtml() + '</div>' +
          '<div class="btnrow"><button class="btn green" id="stScEdit">Customize shortcuts</button><button class="btn outline" id="stScKeys">Show the keys</button></div></div></div>',
        wire: (root, again) => {
          Shortcuts.profileWire($('#stScBox', root), null);
          $('#stScEdit').onclick = () => Shortcuts.edit(again);
          $('#stScKeys').onclick = () => Shortcuts.help(again);
        } };
    },

    usersTab() {
      const c = Companies.current(), manage = !!c && (c.role === 'owner' || c.role === 'admin'), name = (c && c.name) || Store.company().name || 'this company';
      return { html: '<div class="card white"><div class="hd">Users of ' + esc(name) + '</div><div class="bd">' +
          '<p class="hint" style="margin-top:0">A user is someone with a login of their own in this company: an employee, an accountant, a sales person, an investor who only looks. ' + (manage ? 'Add them by mobile number or email, give each a role, and assign a licence.' : 'The owner or an admin adds users and gives them their roles.') + ' Whoever is added is put on HR &gt; Employees too.</p>' +
          '<div class="btnrow">' + (c ? '<button class="btn green" id="suMembers">' + global.icon('users') + ' ' + (manage ? 'Add / manage users' : 'See the users') + '</button>' : '') + '<button class="btn outline" id="suRoles">Roles &amp; hierarchy</button>' +
          (App.menuHas('tabaccess') && this.mayEdit() ? '<button class="btn outline" id="suTabs">Tab Access</button>' : '') + (App.menuHas('licences') ? '<button class="btn outline" id="suLic">Licences</button>' : '') + (App.menuHas('employees') ? '<button class="btn outline" id="suEmp">Employees (HR)</button>' : '') + '</div>' +
          '<div id="suList">' + (c ? '<div class="hint">Loading the users…</div>' : '<div class="empty">The users are kept in your BlitzBook account on the server. This browser is not signed in to the server right now.</div>') + '</div></div></div>' +
          '<div class="card white"><div class="hd">What each role does</div><div class="bd"><table class="list"><tbody>' + Companies.ROLES.map(r => '<tr><td style="white-space:nowrap"><span class="pill ' + (r === 'owner' ? 'ok' : r === 'viewer' ? '' : 'warn') + '">' + esc(Companies.ROLE_LABEL[r]) + '</span></td><td>' + esc(Companies.ROLE_HELP[r]) + '</td></tr>').join('') + '</tbody></table>' +
          '<div class="hint">Roles of your own (Store Manager, Cashier, Caretaker ...) are made under Roles &amp; hierarchy; what each role sees of the menu is set under Tab Access.</div></div></div>',
        wire: (root, again) => {
          const here = () => App.current && App.current.route === 'settings' && !!$('#suList');
          // The dialogs change the users and the roles: the list is read again when one closes
          const after = (bg) => { if (!bg) return; const mo = new MutationObserver(() => { if (!bg.isConnected) { mo.disconnect(); if (here()) again(); } }); mo.observe($('#dialogs'), { childList: true }); };
          if ($('#suMembers')) $('#suMembers').onclick = () => { Companies.members(c); after($('#dialogs').lastElementChild); };
          $('#suRoles').onclick = () => after(Companies.rolesDialog());
          if ($('#suTabs')) $('#suTabs').onclick = () => App.go('tabaccess');
          if ($('#suLic')) $('#suLic').onclick = () => App.go('licences');
          if ($('#suEmp')) $('#suEmp').onclick = () => App.go('employees');
          if (!c) return;
          if (!Companies.available()) { $('#suList').innerHTML = '<div class="empty">The users are kept in your BlitzBook account on the server. This browser is not signed in to the server right now.</div>'; return; }
          Companies.rpc('list_members', { cid: c.id }).then(l => {
            if (!here()) return;
            l = Array.isArray(l) ? l : [];
            const open = Companies.isOpen(c), roleOf = (m) => { const cu = open && m.role !== 'owner' ? Companies.customOf(m, m.role) : null; return cu ? cu.name : Companies.ROLE_LABEL[m.role] || m.role; };
            $('#suList').innerHTML = l.length ? '<div class="tablewrap"><table class="list cards"><thead><tr><th>Name</th><th>Mobile</th><th>Email</th><th>Role</th></tr></thead><tbody>' + l.map(m => '<tr' + (m.invited ? ' class="muted"' : '') + '><td data-l="Name"><b>' + esc(m.name || (m.invited ? 'Invited' : '-')) + '</b></td><td data-l="Mobile">' + esc(m.phone || '-') + '</td><td data-l="Email">' + esc(m.email || '-') + '</td><td data-l="Role"><span class="pill ' + (m.role === 'owner' ? 'ok' : 'warn') + '">' + esc(roleOf(m)) + '</span>' + (m.invited ? ' <span class="pill">Invited</span>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
              : '<div class="empty">Only you so far. Add the people who work in this company.</div>';
          }).catch(e => { if (here()) $('#suList').innerHTML = '<div class="empty">' + esc(e && e.status === 404 ? 'Users are not set up on the server yet.' : 'The users could not be loaded: ' + ((e && e.message) || 'no connection') + '.') + '</div>'; });
        } };
    },

    // The customisation of a rental business is the Rental module's own form (rental.js), shown here too
    rentalTab() {
      const p = global.Rental && Rental.settingsPanel ? Rental.settingsPanel() : null;
      if (!p) return { html: '<div class="card white"><div class="bd"><div class="empty">The Rental settings are not available.</div></div></div>' };
      return { html: '<div class="hint" style="margin-bottom:12px">The Rental tab is shown because one of the businesses of the company is Rental Services (Businesses &amp; Tabs turns it on or off, Tab Access says which roles see it). Below is what the business calls and keeps of its buildings, rooms, beds, furniture and tenants. <a href="#" id="srOpen">Open Rental</a></div>' + p.html,
        wire: (root, again) => { $('#srOpen').onclick = (e) => { e.preventDefault(); App.go('rental'); }; if (p.wire) p.wire(root, again); } };
    }
  };

  App.routes.settings = (p) => Settings.screen(p || {});
  global.Settings = Settings;
})(window);
