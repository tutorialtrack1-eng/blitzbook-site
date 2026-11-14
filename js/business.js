/* BlitzBook web portal - Businesses & Tabs (Company > Businesses & Tabs). A company may run more than one business:
   a hotel with its own restaurant, a retailer that also services what it sells, a staffing agency that also trades.
   The main line of activity stays in the Company Profile (it decides how the invoice looks); the others are ticked
   here or in the Company Profile (Other Lines of Activity), and here is also which menu groups the company is shown at all.

   Every group of the menu (Sales, Purchases, Hotel, Manpower, Inventory, Records, HR, Professionals) has a suggested
   state that follows the businesses: Hotel for a hotel or other accommodation, Manpower for a manpower and staffing
   agency, the rest always (a services business that keeps no stock turns Inventory off itself). The owner or an admin can turn a
   group on or off against the suggestion; only such a choice is kept (tabs: { group: true / false }), so a group
   follows the businesses again once the choice is cleared (Use suggested).

   A group that is off leaves the menu, the dashboard and the screens of everybody in the company, the owner
   included; Tab Access (companies.js) then narrows what each role sees of the groups that are on. The Dashboard
   and the Company group are never off.

   Kept in the books as one record, 'biz' (synced like the roles): { lines: [line], tabs: { group: bool }, hideTabs:
   [tab id] }. hideTabs is the menu entries of the groups that are off, written on every save for the Android app,
   which hides those tiles the way it hides the tabs of a role (MainActivity.myHiddenTabs). */
(function (global) {
  'use strict';
  const { esc } = U;
  const KEY = 'biz';
  // What can be ticked as a further business: the lines of activity, and a manpower and staffing agency
  const LINES = U.LINE_OF_ACTIVITIES.filter(a => a !== 'General').concat([U.STAFFING_SERVICE]);
  const LINE_HINT = {
    'Hotel and Accommodation': 'Rooms let by the night: the Hotel group (front desk, room chart, reservations, guest register, occupancy)',
    'Food and Beverages': 'A restaurant, cafe, canteen or food trade',
    [U.STAFFING_SERVICE]: 'People deployed at clients: the Manpower group (roster, deployment, papers)'
  };

  const Business = {
    LINES,
    doc() { const d = Store.get(KEY, null); const o = d && typeof d === 'object' ? d : {}; return { lines: Array.isArray(o.lines) ? o.lines.filter(l => LINES.includes(l)) : [], tabs: o.tabs && typeof o.tabs === 'object' ? o.tabs : {} }; },
    // The main line of activity (Company Profile); a Services company of the staffing type counts as a staffing agency
    main() { const c = Store.company(); if (U.isStaffingCo(c)) return U.STAFFING_SERVICE; const a = String(c.activity || ''); return a && !a.startsWith('Select') ? a : 'General'; },
    lines(d) { const out = [this.main()]; (d || this.doc()).lines.forEach(l => { if (!out.includes(l)) out.push(l); }); return out; },
    has(line) { return this.lines().includes(line); },
    hotel() { return this.has(U.HOTEL_ACTIVITY); },
    // The groups that can be turned off: those with entries, but not Company (the way back into everything)
    groups() { return (App.nav ? App.nav() : []).filter(g => g.items && g.t !== 'Company'); },
    suggested(t, lines) {
      lines = lines || this.lines();
      if (t === 'Hotel') return lines.includes(U.HOTEL_ACTIVITY);
      if (t === 'Manpower') return lines.includes(U.STAFFING_SERVICE);
      return true;
    },
    shown(t, d) { d = d || this.doc(); const v = d.tabs[t]; return typeof v === 'boolean' ? v : this.suggested(t, this.lines(d)); },
    // The menu entries (tab ids, Companies.tabId) of every group that is off
    hiddenIds(d) { d = d || this.doc(); const out = []; this.groups().forEach(g => { if (!this.shown(g.t, d)) g.items.forEach(it => out.push(Companies.tabId(it))); }); return out; },
    tabOff(it) { const h = this.hiddenIds(); return h.length > 0 && h.includes(Companies.tabId(it)); },
    // A screen is off when every menu entry that opens it is in a group that is off (with params: the entry they name)
    routeOff(route, params) {
      const h = this.hiddenIds(); if (!h.length) return false;
      const v = params && typeof params === 'object' ? Object.keys(params).map(k => params[k])[0] : '';
      if (v && h.includes(route + ':' + v)) return true;
      const ids = Companies.tabIds([route]); return ids.length > 0 && ids.every(id => h.includes(id));
    },
    tileOff(key) { const specs = (Companies.TILE_TABS || {})[key]; if (!specs) return false; const h = this.hiddenIds(); if (!h.length) return false; const ids = Companies.tabIds(specs); return ids.length > 0 && ids.every(id => h.includes(id)); },
    mayEdit() { return !Store.cid || ['owner', 'admin'].includes(Companies.role()); },
    save(d) {
      const out = { lines: d.lines.filter(l => LINES.includes(l) && l !== this.main()), tabs: {} };
      // Only a choice against the suggestion is kept, so a group follows the businesses again when it is cleared
      const lines = this.lines(out);
      Object.keys(d.tabs || {}).forEach(t => { if (typeof d.tabs[t] === 'boolean' && d.tabs[t] !== this.suggested(t, lines)) out.tabs[t] = d.tabs[t]; });
      out.hideTabs = this.hiddenIds(out);
      return Store.set(KEY, out);
    },

    screen() {
      const edit = this.mayEdit(), d = this.doc(), main = this.main();
      const work = { lines: d.lines.slice(), tabs: Object.assign({}, d.tabs) };
      const root = App.view(App.header('Businesses & Tabs', edit ? '<div class="btnrow" style="margin:0"><button class="btn sm outline" id="bzReset" title="Every group as the businesses suggest">Use suggested</button><button class="btn sm green" id="bzSave">Save</button></div>' : '') +
        '<div class="card white"><div class="bd"><div class="hint" style="margin:0">A company can run more than one business: a hotel with its own restaurant, a shop that also repairs, an agency that also trades. ' +
        'Tick every business of <b>' + esc(Store.company().name || 'this company') + '</b>, then the menu groups to show. A group that is off leaves the menu and the dashboard of everybody in the company, the owner included; ' +
        'what each role sees of the groups that are on is set under <a href="#" id="bzTabs">Tab Access</a>.</div></div></div>' +
        '<div class="section-title">Businesses</div>' +
        '<div class="card white"><div class="bd"><div class="kv" style="margin-bottom:8px"><b>Main line of activity:</b> ' + esc(U.activityText(Store.company())) + (edit ? ' <a href="#" id="bzProfile">change in Company Profile</a>' : '') + '</div>' +
        '<div class="grid2" id="bzLines">' + LINES.filter(l => l !== main).map(l => '<label class="check" title="' + esc(LINE_HINT[l] || '') + '"><input type="checkbox" class="bzLine" value="' + esc(l) + '"' + (work.lines.includes(l) ? ' checked' : '') + (edit ? '' : ' disabled') + '> ' + esc(l) + (LINE_HINT[l] ? '<div class="small muted" style="margin-left:24px">' + esc(LINE_HINT[l]) + '</div>' : '') + '</label>').join('') + '</div></div></div>' +
        '<div class="section-title">Tabs shown</div><div id="bzGroups"></div>');
      App.wireBack(root);
      $('#bzTabs').onclick = (e) => { e.preventDefault(); App.go('tabaccess'); };
      if ($('#bzProfile')) $('#bzProfile').onclick = (e) => { e.preventDefault(); App.go('company'); };
      const draw = () => {
        const lines = this.lines(work);
        $('#bzGroups').innerHTML = '<div class="tablewrap"><table class="list cards" id="bzTable"><thead><tr><th>Group</th><th>Tabs in it</th><th>Suggested</th><th style="text-align:center">Show</th></tr></thead><tbody>' +
          this.groups().map(g => { const sug = this.suggested(g.t, lines), on = typeof work.tabs[g.t] === 'boolean' ? work.tabs[g.t] : sug;
            return '<tr data-g="' + esc(g.t) + '"><td data-l="Group"><b>' + esc(g.t) + '</b>' + (on !== sug ? ' <span class="pill warn">your choice</span>' : '') + '</td><td class="left small" data-l="Tabs">' + esc(g.items.map(it => it.t).join(', ')) + '</td>' +
              '<td data-l="Suggested">' + (sug ? '<span class="pill ok">Show</span>' : '<span class="pill">Hide</span>') + '</td><td style="text-align:center" data-l="Show"><input type="checkbox" class="bzShow" data-g="' + esc(g.t) + '"' + (on ? ' checked' : '') + (edit ? '' : ' disabled') + '></td></tr>'; }).join('') +
          '</tbody></table></div><div class="hint" style="margin-top:8px">The Dashboard and the Company group are always shown. A group follows the businesses until it is turned on or off here; Use suggested clears those choices.</div>';
        $$('.bzShow', root).forEach(c => c.onchange = () => { work.tabs[c.dataset.g] = c.checked; draw(); });
      };
      draw();
      $$('.bzLine', root).forEach(c => c.onchange = () => { work.lines = $$('.bzLine', root).filter(x => x.checked).map(x => x.value); draw(); });
      if (!edit) return;
      $('#bzReset').onclick = () => { work.tabs = {}; draw(); };
      $('#bzSave').onclick = () => {
        if (this.save(work) === false) return;
        UI.toast('Businesses and tabs saved', 3000, 'ok'); App.refreshNav(); this.screen();
      };
    }
  };

  App.routes.business = () => Business.screen();
  global.Business = Business;
})(window);
