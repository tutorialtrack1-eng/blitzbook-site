/* BlitzBook web portal - shortcuts of one's own.

   Every login keeps a list of shortcuts on this device: each one opens a screen of the menu (New Invoice, Sales,
   Party Ledger ...) or does a small thing (dark mode, switch company), by a key combination, by a button under
   "My shortcuts" in Settings (the gear), or both. The list starts with a standard set and is the user's to change
   under Settings > Shortcuts: press the keys wanted for a shortcut, add one
   for any screen, give it a name of one's own, pin it to Settings, remove it, or go back to the standard set.

   A combination needs Ctrl, Alt or the Command key in it (or is a function key), so typing in a box never sets one
   off; the few the browser keeps for itself (new tab, close tab ...) are refused. Shortcuts are not run while a
   dialog is open. Kept with the login (Store.poke), not with a company's books, and not synced. */
(function (global) {
  'use strict';
  const { esc } = U;
  const KEY = 'shortcuts';
  // What a shortcut may do besides opening a screen
  const ACTIONS = {
    theme: { t: 'Dark / light mode', run: () => Theme.toggle() },
    company: { t: 'Switch company', run: () => { if (Companies.canSwitch()) Companies.switcher(); else Company.edit(false); } },
    list: { t: 'Show my shortcuts', run: () => Shortcuts.help() }
  };
  // The standard set: [keys, target, pinned as a button in Settings]
  const STANDARD = [
    ['Alt+I', 'invoice', true], ['Alt+S', 'sales', true], ['Alt+P', 'purchases', true], ['Alt+X', 'expenses', false], ['Alt+R', 'money', true],
    ['Alt+J', 'journal', false], ['Alt+C', 'contacts{"type":"Customer"}', false], ['Alt+L', 'ledger', true], ['Alt+G', 'gst', false], ['Alt+H', 'dashboard', false],
    ['Alt+K', '@list', false], ['Alt+T', '@theme', false]
  ];
  // Combinations the browser does not hand to a page, or that would take a working key away from the user
  const RESERVED = ['Ctrl+T', 'Ctrl+N', 'Ctrl+W', 'Ctrl+Shift+T', 'Ctrl+Shift+N', 'Ctrl+Shift+W', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Alt+F4', 'Alt+Tab', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+R', 'Ctrl+L', 'Ctrl+F', 'Ctrl+P', 'F5', 'F11', 'F12',
    'Meta+T', 'Meta+N', 'Meta+W', 'Meta+Q', 'Meta+C', 'Meta+V', 'Meta+X', 'Meta+A', 'Meta+Z', 'Meta+R', 'Meta+L', 'Meta+F', 'Meta+P', 'Meta+Tab'];
  const NAMES = { Slash: '/', Backslash: '\\', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', Space: 'Space', Enter: 'Enter', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete' };
  // "Alt+I" from a key press: by the key's place on the keyboard, so Alt on a Mac (which types another letter) reads the same
  function combo(e) {
    const c = e.code || ''; let k = '';
    if (/^Key[A-Z]$/.test(c)) k = c.slice(3); else if (/^Digit\d$/.test(c)) k = c.slice(5); else if (/^Numpad\d$/.test(c)) k = 'Num' + c.slice(6); else if (/^F\d{1,2}$/.test(c)) k = c; else k = NAMES[c] || '';
    if (!k) return '';
    return (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.metaKey ? 'Meta+' : '') + k;
  }
  // Why a combination cannot be a shortcut ('' when it can)
  function refusal(keys) {
    if (!keys) return 'Press a letter, a number or a function key together with Ctrl or Alt';
    if (!/^(Ctrl|Alt|Meta)\+/.test(keys) && !/^(Shift\+)?F\d{1,2}$/.test(keys)) return 'Add Ctrl or Alt (or use a function key), so the shortcut is not set off while typing';
    if (RESERVED.includes(keys)) return keys.replace('Meta', 'Cmd') + ' belongs to the browser: choose another combination';
    return '';
  }
  const show = (keys) => String(keys || '').replace('Meta', /Mac|iPhone|iPad/.test(navigator.platform || '') ? 'Cmd' : 'Win');
  const kbd = (keys) => keys ? show(keys).split('+').map(k => '<kbd>' + esc(k) + '</kbd>').join('+') : '<span class="muted">no keys</span>';

  const Shortcuts = {
    // Every screen of the menu and every action, as a target: { id, t (name), run }
    targets() {
      const out = [];
      App.nav().forEach(g => (g.items || [g]).forEach(it => {
        const id = it.key + (it.params ? JSON.stringify(it.params) : '');
        if (!out.some(x => x.id === id)) out.push({ id, t: (g.items ? g.t + ' › ' : '') + it.t, short: it.t, route: it.key, params: it.params });
      }));
      Object.keys(ACTIONS).forEach(k => out.push({ id: '@' + k, t: ACTIONS[k].t, short: ACTIONS[k].t, action: k }));
      return out;
    },
    target(id) { return this.targets().find(x => x.id === id) || null; },
    // Whether this login may use a target here: its screen is in the menu it gets (the plan, the role, the company's tabs)
    allowed(t) { return !!t && (t.action ? true : !!App.routes[t.route] && App.menuHas(t.route, t.params)); },
    standard() { return STANDARD.map(s => ({ id: U.uid(), keys: s[0], target: s[1], name: '', pin: s[2] })); },
    list() {
      if (!App.user) return [];
      const l = Store.peek(App.user.id, KEY, null);
      return Array.isArray(l) ? l.filter(x => x && x.target).map(x => ({ id: x.id || U.uid(), keys: String(x.keys || ''), target: String(x.target), name: String(x.name || ''), pin: !!x.pin })) : this.standard();
    },
    save(list) { if (App.user) Store.poke(App.user.id, KEY, list); },
    label(s) { const t = this.target(s.target); return s.name || (t ? t.short : s.target); },
    run(s) {
      const t = this.target(s.target); if (!t) return UI.toast('This shortcut points to a screen that is no longer there');
      if (t.action) return ACTIONS[t.action].run();
      if (!this.allowed(t)) return UI.toast(t.short + ' is not in your menu here (the plan, your role or the tabs of this company)', 4500);
      App.go(t.route, t.params ? JSON.parse(JSON.stringify(t.params)) : undefined);
    },
    // A key press anywhere in the portal
    onKey(e) {
      if (!App.user || !$('#view') || e.repeat || this.capturing) return;
      if (e.getModifierState && e.getModifierState('AltGraph')) return;     // AltGr types letters on many keyboards
      if (!(e.ctrlKey || e.altKey || e.metaKey) && !/^F\d{1,2}$/.test(e.code || '')) return;
      const keys = combo(e); if (!keys) return;
      const s = this.list().find(x => x.keys === keys); if (!s) return;
      e.preventDefault(); e.stopPropagation();
      if ($('#dialogs').children.length) { UI.toast('Close the dialog first, then ' + show(keys) + ' opens ' + this.label(s), 3000); return; }
      this.run(s);
    },
    // ---- Settings > Shortcuts: the pinned ones as buttons, in a block of their own (settings.js)
    pinned() { return this.list().filter(s => s.pin && this.allowed(this.target(s.target))); },
    profileHtml() {
      const l = this.pinned();
      return '<label>My Shortcuts <span class="tilehint"><button type="button" class="link small" id="scEdit">Customize</button> · <button type="button" class="link small" id="scHelp">Show keys</button></span></label>' +
        (l.length ? '<div class="recent sc-row" id="scRow">' + l.map((s, i) => '<button type="button" data-sc="' + i + '" title="' + esc(this.label(s) + (s.keys ? ' (' + show(s.keys) + ')' : '')) + '">' + esc(this.label(s)) + (s.keys ? ' <span class="sc-k">' + esc(show(s.keys)) + '</span>' : '') + '</button>').join('') + '</div>'
          : '<div class="hint" style="margin:0 2px 8px">Nothing pinned yet: Customize adds the screens you use most, each with keys of your own.</div>') +
        '<div class="hint">Your own shortcuts on this device: a button here opens its screen, and so do its keys on every screen.</div>';
    },
    // box: the block in Settings; close: called before a shortcut opens its screen (nothing to shut there)
    profileWire(box, close) {
      if (!box) return;
      const draw = () => { box.innerHTML = this.profileHtml(); this.profileWire(box, close); };
      // By its place in the row: a list that was never changed has no ids of its own yet (standard() makes them anew)
      const l = this.pinned();
      $$('[data-sc]', box).forEach(b => b.onclick = () => { const s = l[+b.dataset.sc]; if (!s) return; if (close) close(); this.run(s); });
      if ($('#scEdit', box)) $('#scEdit', box).onclick = () => this.edit(draw);
      if ($('#scHelp', box)) $('#scHelp', box).onclick = () => this.help(draw);
    },
    // ---- the list of shortcuts with their keys
    help(onDone) {
      const l = this.list().filter(s => s.keys && this.allowed(this.target(s.target)));
      UI.modal({ title: 'My Shortcuts', body: l.length ? '<table class="list sc-help"><tbody>' + l.map(s => '<tr><td class="left">' + esc(this.label(s)) + '</td><td class="num">' + kbd(s.keys) + '</td></tr>').join('') + '</tbody></table>' : '<div class="empty">No shortcut has keys yet.</div>',
        buttons: [{ label: 'Customize', cls: 'outline', onClick: () => { setTimeout(() => this.edit(onDone), 0); } }, { label: 'Close' }] });
    },
    // Waits for a key combination; onKeys(keys) gets it, or '' to take the keys away
    capture(title, onKeys) {
      this.capturing = true;
      const bg = UI.modal({ title, cancelable: false, focus: false, body: '<p>Press the keys for this shortcut, for example <kbd>Alt</kbd>+<kbd>N</kbd> or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>1</kbd>.</p><div class="sc-cap" id="scCap">Waiting for keys…</div><div class="hint" id="scCapMsg"></div>',
        buttons: [{ label: 'Cancel', cls: 'outline', onClick: () => done() }, { label: 'No keys', cls: 'outline', onClick: () => { done(); onKeys(''); } }, { label: 'Use these keys', onClick: () => { if (!got || refusal(got)) return false; done(); onKeys(got); } }] });
      let got = '';
      const ok = $$('.mf .btn', bg)[2]; ok.disabled = true;
      const key = (e) => {
        if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        got = combo(e); const why = refusal(got);
        $('#scCap', bg).innerHTML = got ? kbd(got) : 'Waiting for keys…'; $('#scCapMsg', bg).textContent = why; $('#scCapMsg', bg).className = 'hint' + (why ? ' red' : ''); ok.disabled = !!why;
      };
      const done = () => { document.removeEventListener('keydown', key, true); this.capturing = false; };
      document.addEventListener('keydown', key, true);
    },
    // ---- the list, changed in place and saved as it changes (onDone: Settings draws its buttons again)
    edit(onDone) {
      let list = this.list();
      const targets = this.targets().filter(t => this.allowed(t));
      const bg = UI.modal({ title: 'Shortcuts', wide: true, focus: false,
        body: '<p class="hint" style="margin-top:0">Your own shortcuts on this device. Each one opens a screen by the keys you choose, by a button under My Shortcuts in Settings, or both. They work on every screen, except while a dialog is open.</p>' +
          '<div class="tablewrap"><table class="list sc-list" id="scList"><thead><tr><th>Opens</th><th>Name on the button</th><th>Keys</th><th>Button in Settings</th><th></th></tr></thead><tbody></tbody></table></div>' +
          '<div class="btnrow" style="margin-top:10px">' + UI.select('scAddT', targets.map(t => [t.id, t.t]), '', { blank: '— add a shortcut for —', attrs: ' style="min-height:36px;max-width:320px"' }) + '<button class="btn sm green" id="scAdd">Add</button><button class="btn sm outline" id="scStd">Standard shortcuts</button></div>',
        buttons: [{ label: 'Done', onClick: () => { if (typeof onDone === 'function') onDone(); } }] });
      const put = () => { this.save(list); draw(); };
      const draw = () => {
        $('#scList tbody', bg).innerHTML = list.length ? list.map((s, i) => { const t = this.target(s.target), off = !this.allowed(t);
          return '<tr data-i="' + i + '"' + (off ? ' class="muted"' : '') + '><td class="left">' + esc(t ? t.t : s.target) + (off ? ' <span class="pill warn">not in your menu here</span>' : '') + '</td>' +
            '<td><input class="scName" value="' + esc(s.name) + '" placeholder="' + esc(t ? t.short : '') + '" maxlength="30" style="min-width:150px"></td>' +
            '<td style="white-space:nowrap">' + kbd(s.keys) + ' <button class="btn sm outline scKeys" type="button">' + (s.keys ? 'Change' : 'Set keys') + '</button></td>' +
            '<td><label class="check"><input type="checkbox" class="scPin"' + (s.pin ? ' checked' : '') + '> Pin</label></td>' +
            '<td class="actions"><button class="btn sm outline scUp" type="button" title="Move up"' + (i ? '' : ' disabled') + '>↑</button> <button class="btn sm red outline scDel" type="button">Remove</button></td></tr>'; }).join('')
          : '<tr><td colspan="5"><div class="empty">No shortcuts. Add one below, or bring back the standard ones.</div></td></tr>';
        $$('#scList tbody tr[data-i]', bg).forEach(tr => {
          const i = +tr.dataset.i, s = list[i];
          $('.scName', tr).onchange = (e) => { s.name = e.target.value.trim(); this.save(list); };
          $('.scPin', tr).onchange = (e) => { s.pin = e.target.checked; this.save(list); };
          $('.scDel', tr).onclick = () => { list.splice(i, 1); put(); };
          $('.scUp', tr).onclick = () => { if (i) { list.splice(i - 1, 0, list.splice(i, 1)[0]); put(); } };
          $('.scKeys', tr).onclick = () => this.capture('Keys for ' + this.label(s), (keys) => {
            const other = keys ? list.find(x => x !== s && x.keys === keys) : null;
            if (other) { other.keys = ''; UI.toast(show(keys) + ' was taken from ' + this.label(other), 4000); }
            s.keys = keys; put();
          });
        });
      };
      draw();
      $('#scAdd', bg).onclick = () => { const id = UI.val('scAddT', bg); if (!id) return UI.toast('Choose the screen the shortcut opens'); list.push({ id: U.uid(), keys: '', target: id, name: '', pin: true }); put(); $('#scAddT', bg).value = ''; const last = $$('#scList tbody tr[data-i]', bg).pop(); if (last) last.scrollIntoView({ block: 'nearest' }); UI.toast('Added, with a button in Settings: Set keys gives it a key combination', 4000); };
      $('#scStd', bg).onclick = () => UI.confirm('Standard Shortcuts', 'Replace your shortcuts with the standard set? The ones you added or changed are removed.', () => { list = this.standard(); put(); UI.toast('Standard shortcuts restored'); }, 'Replace');
      return bg;
    }
  };
  document.addEventListener('keydown', (e) => Shortcuts.onKey(e), true);
  App.routes.shortcuts = () => Shortcuts.edit();
  global.Shortcuts = Shortcuts;
})(window);
