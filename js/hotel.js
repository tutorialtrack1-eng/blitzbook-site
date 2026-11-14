/* BlitzBook web portal - Hotel: the front office of a hotel, resort, guest house, homestay, lodge, hostel or service
   apartment (line of activity Hotel and Accommodation, or that business ticked under Company > Businesses & Tabs).

   What it does, and the systems it was measured against: the front-office core that eZee Absolute, Hotelogix,
   Cloudbeds, IDS Next FortuneNext, Djubo and Oracle OPERA have in common, sized for an Indian property that keeps its
   books here:
     Front Desk       today at a glance: arrivals, in-house guests, departures, rooms free tonight, rooms to clean,
                      occupancy; check-in and check-out from the list (every PMS opens on this "dashboard / front desk")
     Room Chart       rooms down the side, the next fortnight across: who is in which room, and a click on a free night
                      books it (the tape chart / calendar view of eZee, Cloudbeds and Hotelogix)
     Reservations     each stay: guest, room type and room, dates, adults and children, extra beds, meal plan (EP, CP,
                      MAP, AP: the plans Indian hotels quote), rate a night, source (walk-in, phone, the OTAs, corporate),
                      status tentative / confirmed / checked in / checked out / cancelled / no-show; the folio of room
                      nights, extra charges (food, laundry, minibar, transfers) and payments (advance, deposit, settle)
     Rooms & Housekeeping   room types with their rack rate and occupancy, the rooms by number and floor, and the
                      housekeeping status of each (clean, dirty, inspected, out of order); a room goes dirty at check-out
     Guest Register   the register a hotel keeps for the police: name, address, nationality, identity document, arrived
                      from, purpose, check-in and check-out; foreign nationals with the passport and visa details Form C
                      asks for (Foreigners Order 1948, reported on the Bureau of Immigration's Form C portal within 24 hours)
     Reports          the daily report, revenue, collections, outstanding, guests and cancellations are in
                      modreports.js; here the occupancy report: occupancy %, ADR (average daily rate), RevPAR (revenue per available room) and average length
                      of stay over any period, night by night, by source and by room type: the STR / hotel-industry
                      measures every PMS reports
     Hotel Settings   kind of property, check-in and check-out times, the GST slabs, the reservation number, the sources

   GST (Notification 15/2025-Central Tax (Rate), from 22/09/2025): hotel accommodation of a value up to Rs 7,500 a
   unit a day is 5% without input tax credit, above it 18%, SAC 996311. The slab goes by what is charged for the room a
   night, extra beds included; the threshold and both rates are in Hotel Settings should the law move again. The place
   of supply of accommodation is where the property is (IGST Act s.12(3)), so the invoice is CGST + SGST whatever the
   guest's state. Check-out makes the tax invoice in Sales (invoice.js, the fromStay route): the room nights and
   every charge as lines, the guest as the buyer, the reservation number as the reference; it is saved there like any
   invoice and so reaches the books, the reports and the GST returns.

   Kept in the books: 'hotel' (settings, room types, rooms; the owner, an admin, an accountant), the collections
   'stays' (stay:<id>) and 'hk' (hk:<room id>, the housekeeping status), which the front desk (the Sales role, or a
   custom role with the Hotel front desk right) writes too. Portal only: the Android app opens these screens. */
(function (global) {
  'use strict';
  const { esc, num, money } = U;
  const DAY = 86400000;
  const TABS = [['desk', 'Front Desk'], ['chart', 'Room Chart'], ['stays', 'Reservations'], ['rooms', 'Rooms & Housekeeping'], ['register', 'Guest Register'], ['reports', 'Reports'], ['settings', 'Settings']];
  const PROPERTY = ['Hotel', 'Resort', 'Guest House', 'Homestay', 'Lodge', 'Hostel', 'Service Apartment', 'Dharamshala'];
  const PLANS = [['EP', 'EP - room only'], ['CP', 'CP - with breakfast'], ['MAP', 'MAP - breakfast and one meal'], ['AP', 'AP - all meals']];
  const SOURCES = ['Walk-in', 'Phone', 'Website', 'Booking.com', 'MakeMyTrip', 'Goibibo', 'Agoda', 'Expedia', 'Airbnb', 'Corporate', 'Travel agent'];
  const STATUS = [['tentative', 'Tentative', 'warn'], ['confirmed', 'Confirmed', ''], ['in', 'Checked in', 'ok'], ['out', 'Checked out', ''], ['cancelled', 'Cancelled', 'bad'], ['noshow', 'No-show', 'bad']];
  const HK = [['clean', 'Clean', 'ok'], ['dirty', 'Dirty', 'warn'], ['inspected', 'Inspected', 'ok'], ['ooo', 'Out of order', 'bad']];
  const IDS = ['Aadhaar', 'Passport', 'Driving Licence', 'Voter ID', 'PAN', 'Other'];
  const PURPOSE = ['Leisure', 'Business', 'Pilgrimage', 'Medical', 'Education', 'Event', 'Other'];
  const MODES = ['Cash', 'UPI', 'Card', 'Bank transfer', 'Cheque', 'OTA collect'];
  const CHARGES = ['Food & beverages', 'Room service', 'Laundry', 'Minibar', 'Airport transfer', 'Extra bed', 'Late check-out', 'Early check-in', 'Telephone', 'Damages'];
  const DEF = { property: 'Hotel', checkIn: '12:00', checkOut: '11:00', threshold: 7500, low: '5', high: '18', sac: '996311', prefix: 'RES', sources: SOURCES, types: [], rooms: [] };

  const ms = (d) => U.dateMs(d);
  const plus = (d, n) => { const x = new Date(ms(d) || Date.now()); x.setDate(x.getDate() + n); return U.dmy(x); };
  const todayStr = () => U.today();
  const pick = (list, k) => list.find(x => x[0] === k) || list[0];
  const pill = (list, k) => { const s = pick(list, k); return '<span class="pill ' + s[2] + '">' + esc(s[1]) + '</span>'; };
  const sum = (a, f) => a.reduce((t, x) => t + num(f(x)), 0);
  const r2 = (v) => U.round2(v);
  const pct = (v) => (Math.round(v * 10) / 10).toFixed(1) + '%';
  const LIVE = (s) => s.status !== 'cancelled' && s.status !== 'noshow';

  const Hotel = {
    TABS, PLANS, STATUS,
    // ------------------------------------------------------------ the records
    settings() { const d = Store.get('hotel', null), o = Object.assign({}, DEF, d && typeof d === 'object' ? d : {}); o.types = Array.isArray(o.types) ? o.types : []; o.rooms = Array.isArray(o.rooms) ? o.rooms : []; o.sources = Array.isArray(o.sources) && o.sources.length ? o.sources : SOURCES; return o; },
    saveSettings(o) { return Store.set('hotel', o); },
    mayStays() { return Companies.mayWrite('stays'); },
    maySettings() { return Companies.mayWrite('hotel'); },
    mayHk() { return Companies.mayWrite('hk'); },
    type(id) { return this.settings().types.find(t => t.id === id) || null; },
    room(id) { return this.settings().rooms.find(r => r.id === id) || null; },
    rooms() { return this.settings().rooms.filter(r => r.active !== false).sort((a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true })); },
    roomName(id) { const r = this.room(id); if (!r) return '-'; const t = this.type(r.typeId); return r.no + (t ? ' · ' + t.name : ''); },
    hk(roomId) { const h = Store.find('hk', roomId); return h && HK.some(x => x[0] === h.status) ? h.status : 'clean'; },
    setHk(roomId, status, note) { const by = App.user ? (App.user.name || App.user.phone || App.user.email || '') : ''; Store.update('hk', { id: roomId, status, note: note || '', at: Date.now(), by }); },
    stays() { return Store.list('stays').map(s => this.full(s)); },
    full(s) { return Object.assign({ no: '', status: 'confirmed', from: todayStr(), to: plus(todayStr(), 1), typeId: '', roomId: '', adults: 2, children: 0, extraBeds: 0, extraBedRate: 0, rate: 0, plan: 'EP', source: 'Walk-in', notes: '', charges: [], payments: [], invoiceNo: '' }, s, { guest: Object.assign({ name: '', phone: '', email: '', address: '', state: '', gstin: '', company: '', nationality: 'Indian', idType: 'Aadhaar', idNo: '', passport: '', visa: '', arrivedFrom: '', goingTo: '', purpose: 'Leisure' }, s && s.guest) }); },
    nights(s) { return Math.max(0, Math.round((ms(s.to) - ms(s.from)) / DAY)); },
    // Nights of a stay between two dates (from inclusive, to exclusive), in ms
    nightsIn(s, a, b) { return Math.max(0, Math.round((Math.min(ms(s.to), b) - Math.max(ms(s.from), a)) / DAY)); },
    nextNo() { const p = this.settings().prefix || 'RES'; let max = 0; Store.list('stays').forEach(s => { const m = /(\d+)$/.exec(s.no || ''); if (m) max = Math.max(max, +m[1]); }); return p + '-' + String(max + 1).padStart(4, '0'); },
    // A room is taken on a night by any stay that is not cancelled or a no-show
    clash(roomId, from, to, exceptId) { const a = ms(from), b = ms(to); return this.stays().find(s => s.id !== exceptId && s.roomId === roomId && LIVE(s) && ms(s.from) < b && ms(s.to) > a) || null; },
    freeRooms(from, to, exceptId) { return this.rooms().filter(r => this.hk(r.id) !== 'ooo' && !this.clash(r.id, from, to, exceptId)); },
    // The GST rate of a room by what it is let at a night (extra beds included)
    slab(night) { const st = this.settings(); return num(night) <= num(st.threshold) ? String(st.low) : String(st.high); },
    nightly(s) { return r2(num(s.rate) + num(s.extraBeds) * num(s.extraBedRate)); },
    roomLine(s) { const t = this.type(s.typeId); return 'Room tariff - ' + (t ? t.name : 'Room') + ' (' + s.plan + ')'; },
    // The folio: room nights and the charges with their GST, the payments, what is due
    folio(s) {
      const st = this.settings(), n = this.nights(s), night = this.nightly(s);
      const lines = [{ desc: this.roomLine(s), detail: (this.room(s.roomId) ? 'Room ' + this.room(s.roomId).no + ': ' : '') + s.from + ' to ' + s.to + ', ' + n + ' night' + (n === 1 ? '' : 's') + (num(s.extraBeds) ? ', ' + num(s.extraBeds) + ' extra bed' + (num(s.extraBeds) === 1 ? '' : 's') : ''), date: s.from, qty: n, rate: night, gst: num(this.slab(night)), sac: st.sac, room: true }]
        .concat((s.charges || []).map((c, i) => ({ desc: c.desc, detail: '', date: c.date, qty: 1, rate: num(c.amount), gst: num(c.gst), sac: c.sac || '', i })));
      lines.forEach(l => { l.amount = r2(l.qty * l.rate); l.tax = r2(l.amount * l.gst / 100); });
      const taxable = r2(sum(lines, l => l.amount)), gst = r2(sum(lines, l => l.tax)), total = Math.round(taxable + gst), paid = r2(sum(s.payments || [], p => p.amount));
      return { lines, taxable, gst, total, paid, balance: r2(total - paid) };
    },

    // ------------------------------------------------------------ the screen
    screen(p) {
      const tab = TABS.some(t => t[0] === p.tab) ? p.tab : 'desk', st = this.settings();
      const today = todayStr(), t0 = ms(today), t1 = t0 + DAY, all = this.stays(), rooms = this.rooms();
      const inHouse = all.filter(s => s.status === 'in'), arrivals = all.filter(s => ['tentative', 'confirmed'].includes(s.status) && ms(s.from) <= t0);
      const departures = inHouse.filter(s => ms(s.to) <= t0), sold = rooms.filter(r => all.some(s => s.roomId === r.id && LIVE(s) && s.status !== 'out' && ms(s.from) <= t0 && ms(s.to) > t0)).length;
      const ooo = rooms.filter(r => this.hk(r.id) === 'ooo').length, dirty = rooms.filter(r => this.hk(r.id) === 'dirty').length, sellable = Math.max(0, rooms.length - ooo);
      const stat = (k, v, cls, go) => '<div class="istat ' + cls + '"' + (go ? ' data-go-tab="' + go + '" style="cursor:pointer"' : '') + '><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
      const body = { desk: () => this.deskTab(arrivals, inHouse, departures, t0), chart: () => this.chartTab(p, rooms, all), stays: () => this.staysTab(p, all), rooms: () => this.roomsTab(st, rooms, all, t0), register: () => this.registerTab(p, all), reports: () => this.reportsTab(p, all, rooms), settings: () => this.settingsTab(st) }[tab]();
      const root = App.view(App.header((st.property || 'Hotel') + (st.name ? ' · ' + st.name : ''), '<div class="btnrow" style="margin:0">' + (this.mayStays() && rooms.length ? '<button class="btn sm green" id="htNew">+ New Reservation</button><button class="btn sm outline" id="htWalk">Walk-in</button>' : '') + '</div>') +
        (rooms.length ? '' : '<div class="card white"><div class="bd"><div class="hint" style="margin:0">Start with the rooms: add the room types and rooms under <a href="#" data-go-tab="rooms">Rooms &amp; Housekeeping</a>' + (this.maySettings() ? '' : ' (the owner, an admin or an accountant does this)') + ', then the check-in and check-out times and the GST slabs under <a href="#" data-go-tab="settings">Settings</a>.</div></div></div>') +
        '<div class="istats">' + stat('Rooms', rooms.length, '', 'rooms') + stat('In house', inHouse.length, 'ok', 'desk') + stat('Arriving', arrivals.length, '', 'desk') + stat('Departing', departures.length, departures.length ? 'warn' : '', 'desk') +
        stat('Free tonight', Math.max(0, sellable - sold), '', 'chart') + stat('Occupancy', sellable ? pct(sold / sellable * 100) : '-', '', 'reports') + stat('To clean', dirty, dirty ? 'warn' : '', 'rooms') + (ooo ? stat('Out of order', ooo, 'bad', 'rooms') : '') + '</div>' +
        '<div class="btnrow" style="margin-bottom:12px">' + TABS.map(t => '<button class="btn sm ' + (t[0] === tab ? 'blue' : 'outline') + '" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' + body.html);
      App.wireBack(root);
      const again = () => App.go('hotel', Object.assign({}, p, { tab }));
      $$('[data-tab]', root).forEach(b => b.onclick = () => App.go('hotel', { tab: b.dataset.tab }));
      $$('[data-go-tab]', root).forEach(b => b.onclick = (e) => { e.preventDefault(); App.go('hotel', { tab: b.dataset.goTab }); });
      if ($('#htNew')) $('#htNew').onclick = () => this.edit(null, again);
      if ($('#htWalk')) $('#htWalk').onclick = () => this.edit({ from: today, to: plus(today, 1), status: 'confirmed', source: 'Walk-in', walkIn: true }, again);
      $$('[data-stay]', root).forEach(b => b.onclick = (e) => { e.preventDefault(); this.open(b.dataset.stay, again); });
      $$('[data-in]', root).forEach(b => b.onclick = () => this.checkIn(this.full(Store.find('stays', b.dataset.in)), again));
      $$('[data-out]', root).forEach(b => b.onclick = () => this.checkOut(this.full(Store.find('stays', b.dataset.out)), again));
      if (body.wire) body.wire(root, again);
    },

    // Today: who arrives (and who was due and has not come), who is in, who leaves
    deskTab(arrivals, inHouse, departures, t0) {
      const w = this.mayStays();
      const row = (s, act) => '<tr><td data-l="No"><a href="#" data-stay="' + s.id + '">' + esc(s.no) + '</a></td><td data-l="Guest"><b>' + esc(s.guest.name || '-') + '</b><div class="small muted">' + esc(s.guest.phone || '') + '</div></td><td data-l="Room">' + esc(this.roomName(s.roomId)) + '</td><td data-l="Stay">' + esc(s.from) + ' → ' + esc(s.to) + '<div class="small muted">' + this.nights(s) + ' night' + (this.nights(s) === 1 ? '' : 's') + ', ' + num(s.adults) + ' adult' + (num(s.adults) === 1 ? '' : 's') + (num(s.children) ? ' + ' + num(s.children) : '') + ', ' + esc(s.plan) + '</div></td><td data-l="Source">' + esc(s.source) + '</td><td class="num" data-l="Due">' + money(this.folio(s).balance) + '</td><td data-l="">' + (w ? act(s) : '') + '</td></tr>';
      const table = (title, list, act, empty) => '<div class="section-title">' + title + ' (' + list.length + ')</div>' + (list.length ? '<div class="tablewrap"><table class="list cards"><thead><tr><th>No</th><th>Guest</th><th>Room</th><th>Stay</th><th>Source</th><th class="num">Due</th><th></th></tr></thead><tbody>' + list.map(s => row(s, act)).join('') + '</tbody></table></div>' : '<div class="empty">' + empty + '</div>');
      const late = (s) => ms(s.from) < t0 ? ' <span class="pill bad" title="Due on ' + esc(s.from) + '">late</span>' : '';
      return { html: table('Arrivals', arrivals.sort((a, b) => ms(a.from) - ms(b.from)), s => '<button class="btn sm green" data-in="' + s.id + '">Check in</button>' + late(s), 'No arrival due today.') +
        table('Departures', departures, s => '<button class="btn sm red" data-out="' + s.id + '">Check out</button>', 'Nobody leaves today.') +
        table('In house', inHouse.sort((a, b) => String((this.room(a.roomId) || {}).no || '').localeCompare(String((this.room(b.roomId) || {}).no || ''), undefined, { numeric: true })), s => '<button class="btn sm outline" data-stay="' + s.id + '">Folio</button><button class="btn sm outline" data-out="' + s.id + '">Check out</button>', 'No guest in house.') };
    },

    // The tape chart: the rooms down the side, a fortnight across from p.from
    chartTab(p, rooms, all) {
      const start = ms(p.from) ? p.from : todayStr(), days = 14, a = ms(start), today = ms(todayStr());
      const dates = Array.from({ length: days }, (_, i) => plus(start, i));
      const dname = (d) => { const x = new Date(ms(d)); return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x.getDay()] + '<br>' + x.getDate(); };
      const cells = (r) => { let out = '', i = 0;
        while (i < days) {
          const d = ms(dates[i]), s = all.find(x => x.roomId === r.id && LIVE(x) && ms(x.from) <= d && ms(x.to) > d);
          if (s) { let span = 1; while (i + span < days && ms(s.to) > ms(dates[i + span])) span++;
            const col = s.status === 'in' ? '#16A34A' : s.status === 'out' ? '#64748B' : s.status === 'tentative' ? '#D97706' : '#2563EB';
            out += '<td colspan="' + span + '" style="padding:2px"><a href="#" data-stay="' + s.id + '" title="' + esc(s.no + ' · ' + s.guest.name + ' · ' + s.from + ' to ' + s.to + ' · ' + pick(STATUS, s.status)[1]) + '" style="display:block;background:' + col + ';color:#fff;border-radius:6px;padding:4px 6px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none">' + esc(s.guest.name || s.no) + '</a></td>'; i += span; }
          else { out += '<td style="padding:2px;text-align:center' + (d === today ? ';background:var(--tint, rgba(37,99,235,.06))' : '') + '">' + (this.mayStays() && d >= today && this.hk(r.id) !== 'ooo' ? '<button class="btn sm outline htFree" data-room="' + r.id + '" data-date="' + dates[i] + '" title="Book room ' + esc(r.no) + ' from ' + dates[i] + '" style="min-height:26px;padding:0 8px;opacity:.55">+</button>' : '') + '</td>'; i++; }
        } return out; };
      const html = '<div class="btnrow" style="align-items:center"><button class="btn sm outline" id="htPrev">◀ Week</button>' + UI.dateInput('htFrom', start, { attrs: ' style="width:auto;min-height:34px"' }) + '<button class="btn sm outline" id="htNext">Week ▶</button><button class="btn sm outline" id="htToday">Today</button>' +
        '<span class="small muted" style="margin-left:8px"><span style="color:#2563EB">■</span> confirmed <span style="color:#D97706">■</span> tentative <span style="color:#16A34A">■</span> in house <span style="color:#64748B">■</span> checked out</span></div>' +
        (rooms.length ? '<div class="tablewrap pin"><table class="list" style="table-layout:fixed;min-width:' + (140 + days * 64) + 'px"><thead><tr><th style="width:140px">Room</th>' + dates.map(d => '<th style="text-align:center;font-size:12px' + (ms(d) === today ? ';color:var(--accent, #2563EB)' : '') + '">' + dname(d) + '</th>').join('') + '</tr></thead><tbody>' +
          rooms.map(r => '<tr><td style="white-space:nowrap"><b>' + esc(r.no) + '</b> <span class="small muted">' + esc((this.type(r.typeId) || {}).name || '') + '</span> ' + (this.hk(r.id) === 'clean' ? '' : pill(HK, this.hk(r.id))) + '</td>' + cells(r) + '</tr>').join('') + '</tbody></table></div>' : '<div class="empty">No rooms yet.</div>');
      return { html, wire: (root) => {
        const go = (d) => App.go('hotel', { tab: 'chart', from: d });
        $('#htPrev').onclick = () => go(plus(start, -7)); $('#htNext').onclick = () => go(plus(start, 7)); $('#htToday').onclick = () => go(todayStr());
        $('#htFrom').onchange = () => { const d = UI.dateVal('htFrom'); if (d) go(d); };
        $$('.htFree', root).forEach(b => b.onclick = () => { const r = this.room(b.dataset.room); this.edit({ roomId: r.id, typeId: r.typeId, from: b.dataset.date, to: plus(b.dataset.date, 1) }, () => go(start)); });
      } };
    },

    staysTab(p, all) {
      const show = p.show || 'open', q = String(p.q || '');
      const shows = [['open', 'Upcoming & in house'], ['in', 'In house'], ['out', 'Checked out'], ['cancelled', 'Cancelled / no-show'], ['all', 'All']];
      const list = all.filter(s => show === 'all' || (show === 'open' ? ['tentative', 'confirmed', 'in'].includes(s.status) : show === 'cancelled' ? !LIVE(s) : s.status === show)).sort((a, b) => ms(b.from) - ms(a.from) || String(b.no).localeCompare(String(a.no), undefined, { numeric: true }));
      const html = '<div class="btnrow" style="align-items:center">' + shows.map(s => '<button class="btn sm ' + (s[0] === show ? 'blue' : 'outline') + '" data-show="' + s[0] + '">' + s[1] + '</button>').join('') + '<input id="htFind" placeholder="Search guest, phone, number, room" value="' + esc(q) + '" style="flex:1;min-width:200px;min-height:34px"><button class="btn sm outline" id="htXls">Export</button></div>' +
        (list.length ? '<div class="tablewrap"><table class="list cards" id="htList"><thead><tr><th>No</th><th>Guest</th><th>Room</th><th>Arrival</th><th>Departure</th><th class="num">Nights</th><th>Plan</th><th>Source</th><th>Status</th><th class="num">Total</th><th class="num">Due</th></tr></thead><tbody>' +
          list.map(s => { const f = this.folio(s); return '<tr data-f="' + esc([s.no, s.guest.name, s.guest.phone, s.guest.company, this.roomName(s.roomId)].join(' ').toLowerCase()) + '"><td data-l="No"><a href="#" data-stay="' + s.id + '">' + esc(s.no) + '</a></td><td data-l="Guest"><b>' + esc(s.guest.name || '-') + '</b><div class="small muted">' + esc([s.guest.phone, s.guest.company].filter(Boolean).join(' · ')) + '</div></td><td data-l="Room">' + esc(this.roomName(s.roomId)) + '</td><td data-l="Arrival">' + esc(s.from) + '</td><td data-l="Departure">' + esc(s.to) + '</td><td class="num" data-l="Nights">' + this.nights(s) + '</td><td data-l="Plan">' + esc(s.plan) + '</td><td data-l="Source">' + esc(s.source) + '</td><td data-l="Status">' + pill(STATUS, s.status) + (s.invoiceNo ? '<div class="small muted">Invoice ' + esc(s.invoiceNo) + '</div>' : '') + '</td><td class="num" data-l="Total">' + money(f.total) + '</td><td class="num" data-l="Due">' + (f.balance > 0 ? '<b>' + money(f.balance) + '</b>' : money(f.balance)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">No reservation here.</div>');
      return { html, wire: (root) => {
        $$('[data-show]', root).forEach(b => b.onclick = () => App.go('hotel', { tab: 'stays', show: b.dataset.show }));
        const f = $('#htFind', root), run = () => { const t = f.value.trim().toLowerCase(); $$('#htList tbody tr', root).forEach(tr => { tr.style.display = !t || tr.dataset.f.includes(t) ? '' : 'none'; }); };
        f.addEventListener('input', run); run();
        $('#htXls').onclick = () => { UI.download('Reservations.csv', UI.csv([['No', 'Guest', 'Phone', 'Email', 'Company', 'GSTIN', 'Room', 'Arrival', 'Departure', 'Nights', 'Adults', 'Children', 'Plan', 'Source', 'Status', 'Rate a night', 'Total', 'Paid', 'Due', 'Invoice']].concat(list.map(s => { const fo = this.folio(s); return [s.no, s.guest.name, s.guest.phone, s.guest.email, s.guest.company, s.guest.gstin, this.roomName(s.roomId), s.from, s.to, this.nights(s), s.adults, s.children, s.plan, s.source, pick(STATUS, s.status)[1], this.nightly(s), fo.total, fo.paid, fo.balance, s.invoiceNo]; }))) + '\n', 'text/csv'); };
      } };
    },

    roomsTab(st, rooms, all, t0) {
      const ws = this.maySettings(), wh = this.mayHk();
      const occ = (r) => all.find(s => s.roomId === r.id && s.status === 'in');
      const html = '<div class="section-title">Room types' + (ws ? '<span class="tilehint"><button class="btn sm green" id="htType">+ Room type</button></span>' : '') + '</div>' +
        (st.types.length ? '<div class="tablewrap"><table class="list cards"><thead><tr><th>Type</th><th class="num">Rate a night</th><th class="num">GST</th><th class="num">Adults</th><th class="num">Up to</th><th class="num">Extra bed</th><th class="num">Rooms</th><th></th></tr></thead><tbody>' +
          st.types.map(t => '<tr><td data-l="Type"><b>' + esc(t.name) + '</b><div class="small muted">' + esc(t.note || '') + '</div></td><td class="num" data-l="Rate">' + money(t.rate) + '</td><td class="num" data-l="GST">' + this.slab(t.rate) + '%</td><td class="num" data-l="Adults">' + num(t.adults || 2) + '</td><td class="num" data-l="Up to">' + num(t.max || t.adults || 2) + '</td><td class="num" data-l="Extra bed">' + (num(t.extraBed) ? money(t.extraBed) : '-') + '</td><td class="num" data-l="Rooms">' + rooms.filter(r => r.typeId === t.id).length + '</td><td>' + (ws ? '<button class="btn sm outline" data-type="' + t.id + '">Edit</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty">No room type yet: Standard, Deluxe, Suite ... each with its rate a night.</div>') +
        '<div class="section-title">Rooms &amp; housekeeping' + (ws && st.types.length ? '<span class="tilehint"><button class="btn sm green" id="htRooms">+ Rooms</button></span>' : '') + '</div>' +
        (rooms.length ? '<div class="tablewrap"><table class="list cards"><thead><tr><th>Room</th><th>Type</th><th>Floor</th><th>Now</th><th>Housekeeping</th><th></th></tr></thead><tbody>' +
          rooms.map(r => { const g = occ(r), h = Store.find('hk', r.id); return '<tr><td data-l="Room"><b>' + esc(r.no) + '</b></td><td data-l="Type">' + esc((this.type(r.typeId) || {}).name || '-') + '</td><td data-l="Floor">' + esc(r.floor || '-') + '</td><td data-l="Now">' + (g ? '<a href="#" data-stay="' + g.id + '">' + esc(g.guest.name || g.no) + '</a> till ' + esc(g.to) : '<span class="muted">vacant</span>') + '</td>' +
            '<td data-l="Housekeeping">' + pill(HK, this.hk(r.id)) + (h && h.note ? '<div class="small muted">' + esc(h.note) + '</div>' : '') + (h && h.at ? '<div class="small muted">' + esc(U.dmy(new Date(h.at))) + (h.by ? ' · ' + esc(h.by) : '') + '</div>' : '') + '</td>' +
            '<td data-l="">' + (wh ? HK.filter(x => x[0] !== this.hk(r.id)).map(x => '<button class="btn sm outline" data-hk="' + r.id + '" data-to="' + x[0] + '">' + esc(x[1]) + '</button>').join('') : '') + (ws ? '<button class="btn sm outline" data-room="' + r.id + '">Edit</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">No rooms yet.</div>');
      return { html, wire: (root, again) => {
        if ($('#htType')) $('#htType').onclick = () => this.editType(null, again);
        if ($('#htRooms')) $('#htRooms').onclick = () => this.addRooms(again);
        $$('[data-type]', root).forEach(b => b.onclick = () => this.editType(this.type(b.dataset.type), again));
        $$('button[data-room]', root).forEach(b => b.onclick = () => this.editRoom(this.room(b.dataset.room), again));
        $$('[data-hk]', root).forEach(b => b.onclick = () => {
          if (b.dataset.to !== 'ooo') { this.setHk(b.dataset.hk, b.dataset.to); again(); return; }
          UI.prompt('Out of order', 'Why is room ' + (this.room(b.dataset.hk) || {}).no + ' out of order?', '', (note) => { this.setHk(b.dataset.hk, 'ooo', note); again(); });
        });
      } };
    },
    editType(t, then) {
      const st = this.settings(), isNew = !t; t = Object.assign({ id: U.uid(), name: '', rate: '', adults: 2, max: 3, extraBed: '', note: '' }, t);
      const bg = UI.modal({ title: isNew ? 'New room type' : 'Room type ' + t.name, body: '<div class="grid2">' + UI.field('Name', UI.input('tyName', t.name, { placeholder: 'Deluxe' }), { req: true }) + UI.field('Rate a night ₹ (before GST)', UI.input('tyRate', t.rate, { type: 'number', attrs: ' min="0" step="any"' }), { hint: 'Up to ₹' + U.indianNumber(st.threshold) + ' a night: GST ' + st.low + '%, above: ' + st.high + '%' }) +
          UI.field('Adults included', UI.input('tyAd', t.adults, { type: 'number', attrs: ' min="1" step="1"' })) + UI.field('Most guests', UI.input('tyMax', t.max, { type: 'number', attrs: ' min="1" step="1"' })) +
          UI.field('Extra bed ₹ a night', UI.input('tyEb', t.extraBed, { type: 'number', attrs: ' min="0" step="any"' })) + UI.field('Note', UI.input('tyNote', t.note, { placeholder: 'King bed, sea view' })) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }].concat(isNew ? [] : [{ label: 'Delete', cls: 'red outline', onClick: () => { if (st.rooms.some(r => r.typeId === t.id)) { UI.toast('Rooms of this type are still there: move or remove them first'); return false; } st.types = st.types.filter(x => x.id !== t.id); this.saveSettings(st); then(); } }]).concat([{ label: 'Save', cls: 'green', onClick: (bg) => {
          const name = String(UI.val('tyName', bg)).trim(); if (!name) { UI.mark('tyName', true, bg); return false; }
          if (st.types.some(x => x.id !== t.id && x.name.toLowerCase() === name.toLowerCase())) { UI.toast('There is a room type of that name'); return false; }
          Object.assign(t, { name, rate: num(UI.val('tyRate', bg)), adults: Math.max(1, num(UI.val('tyAd', bg)) || 2), max: Math.max(1, num(UI.val('tyMax', bg)) || 2), extraBed: num(UI.val('tyEb', bg)), note: String(UI.val('tyNote', bg)).trim() });
          st.types = isNew ? st.types.concat([t]) : st.types.map(x => x.id === t.id ? t : x);
          if (this.saveSettings(st) === false) return false; UI.toast('Room type saved', 2500, 'ok'); then();
        } }]) });
      return bg;
    },
    // Several rooms at once: 101-110, or 101, 102, 205
    addRooms(then) {
      const st = this.settings();
      UI.modal({ title: 'Add rooms', body: '<div class="grid2">' + UI.field('Room numbers', UI.input('rmNos', '', { placeholder: '101-110, 201, 202' }), { span: true, hint: 'A range adds every number in it' }) + UI.field('Type', UI.select('rmType', st.types.map(t => [t.id, t.name]), (st.types[0] || {}).id)) + UI.field('Floor', UI.input('rmFloor', '', { placeholder: '1' })) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Add', cls: 'green', onClick: (bg) => {
          const nos = []; String(UI.val('rmNos', bg)).split(/[,\s]+/).filter(Boolean).forEach(part => { const m = /^(\d+)\s*-\s*(\d+)$/.exec(part); if (m && +m[2] >= +m[1] && +m[2] - +m[1] < 500) { for (let n = +m[1]; n <= +m[2]; n++) nos.push(String(n)); } else nos.push(part); });
          if (!nos.length) { UI.mark('rmNos', true, bg); return false; }
          const have = new Set(st.rooms.map(r => String(r.no).toLowerCase())), fresh = nos.filter(n => !have.has(n.toLowerCase()));
          st.rooms = st.rooms.concat(fresh.map(no => ({ id: U.uid(), no, typeId: UI.val('rmType', bg), floor: String(UI.val('rmFloor', bg)).trim(), active: true })));
          if (this.saveSettings(st) === false) return false;
          UI.toast(fresh.length + ' room' + (fresh.length === 1 ? '' : 's') + ' added' + (nos.length > fresh.length ? '; ' + (nos.length - fresh.length) + ' already there' : ''), 4000, 'ok'); then();
        } }] });
    },
    editRoom(r, then) {
      const st = this.settings();
      UI.modal({ title: 'Room ' + r.no, body: '<div class="grid2">' + UI.field('Number', UI.input('erNo', r.no)) + UI.field('Type', UI.select('erType', st.types.map(t => [t.id, t.name]), r.typeId)) + UI.field('Floor', UI.input('erFloor', r.floor || '')) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Remove', cls: 'red outline', onClick: () => { if (this.stays().some(s => s.roomId === r.id && ['tentative', 'confirmed', 'in'].includes(s.status))) { UI.toast('The room has reservations to come: move them first'); return false; } st.rooms = st.rooms.map(x => x.id === r.id ? Object.assign({}, x, { active: false }) : x); this.saveSettings(st); then(); } },
          { label: 'Save', cls: 'green', onClick: (bg) => { const no = String(UI.val('erNo', bg)).trim(); if (!no) return false; if (st.rooms.some(x => x.id !== r.id && x.active !== false && String(x.no).toLowerCase() === no.toLowerCase())) { UI.toast('There is a room ' + no); return false; }
            st.rooms = st.rooms.map(x => x.id === r.id ? Object.assign({}, x, { no, typeId: UI.val('erType', bg), floor: String(UI.val('erFloor', bg)).trim() }) : x); this.saveSettings(st); then(); } }] });
    },

    // The register a hotel keeps for the police, for any period; foreign nationals with what Form C asks for
    registerTab(p, all) {
      const from = ms(p.from) ? p.from : U.dmy(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to = ms(p.to) ? p.to : todayStr(), foreign = p.who === 'foreign';
      const a = ms(from), b = ms(to) + DAY;
      const list = all.filter(s => ['in', 'out'].includes(s.status) && ms(s.from) >= a && ms(s.from) < b && (!foreign || !/^indian?$/i.test(String(s.guest.nationality).trim()))).sort((x, y) => (x.checkedInAt || ms(x.from)) - (y.checkedInAt || ms(y.from)));
      const headers = foreign ? ['Sr', 'Name', 'Nationality', 'Passport', 'Visa', 'Arrived from', 'Going to', 'Room', 'Check-in', 'Check-out', 'Address'] : ['Sr', 'Name', 'Address', 'Phone', 'Nationality', 'Identity document', 'Arrived from', 'Purpose', 'Persons', 'Room', 'Check-in', 'Check-out'];
      const when = (t, d) => t ? U.dmy(new Date(t)) + ' ' + new Date(t).toTimeString().slice(0, 5) : d;
      const rows = list.map((s, i) => foreign ? [i + 1, s.guest.name, s.guest.nationality, s.guest.passport, s.guest.visa, s.guest.arrivedFrom, s.guest.goingTo, (this.room(s.roomId) || {}).no || '', when(s.checkedInAt, s.from), s.status === 'out' ? when(s.checkedOutAt, s.to) : '', s.guest.address]
        : [i + 1, s.guest.name, s.guest.address, s.guest.phone, s.guest.nationality, (s.guest.idType || '') + ' ' + (s.guest.idNo || ''), s.guest.arrivedFrom, s.guest.purpose, num(s.adults) + num(s.children), (this.room(s.roomId) || {}).no || '', when(s.checkedInAt, s.from), s.status === 'out' ? when(s.checkedOutAt, s.to) : 'in house']);
      const html = '<div class="btnrow" style="align-items:center">' + UI.dateInput('rgFrom', from, { attrs: ' style="width:auto;min-height:34px"' }) + '<span>to</span>' + UI.dateInput('rgTo', to, { attrs: ' style="width:auto;min-height:34px"' }) +
        '<button class="btn sm ' + (foreign ? 'outline' : 'blue') + '" data-who="all">All guests</button><button class="btn sm ' + (foreign ? 'blue' : 'outline') + '" data-who="foreign">Foreign nationals (Form C)</button><button class="btn sm outline" id="rgPrint">Print</button><button class="btn sm outline" id="rgCsv">Export</button></div>' +
        (foreign ? '<div class="hint" style="margin-bottom:8px">Foreign nationals are reported within 24 hours of arrival on the Bureau of Immigration\'s Form C portal (indianfrro.gov.in): these are the details it asks for.</div>' : '') +
        (rows.length ? '<div class="tablewrap"><table class="list"><thead><tr>' + headers.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r, i) => '<tr>' + r.map((v, j) => '<td>' + (j === 1 ? '<a href="#" data-stay="' + list[i].id + '">' + esc(v || '-') + '</a>' : esc(v == null || v === '' ? '-' : String(v))) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '<div class="empty">No guest checked in in this period.</div>');
      return { html, wire: (root) => {
        const go = (o) => App.go('hotel', Object.assign({ tab: 'register', from: UI.dateVal('rgFrom') || from, to: UI.dateVal('rgTo') || to, who: foreign ? 'foreign' : 'all' }, o));
        $('#rgFrom').onchange = () => go({}); $('#rgTo').onchange = () => go({});
        $$('[data-who]', root).forEach(b => b.onclick = () => go({ who: b.dataset.who }));
        $('#rgPrint').onclick = () => UI.pdf(foreign ? 'FOREIGN NATIONALS (FORM C DETAILS)' : 'GUEST REGISTER', from + ' to ' + to, headers, rows, {});
        $('#rgCsv').onclick = () => UI.download((foreign ? 'Form_C_' : 'Guest_Register_') + from.replace(/\//g, '-') + '.csv', UI.csv([headers].concat(rows)) + '\n', 'text/csv');
      } };
    },

    // Occupancy %, ADR and RevPAR over a period (the nights from 'from' up to and including 'to')
    measure(all, rooms, a, b) {
      const nights = Math.max(0, Math.round((b - a) / DAY)), available = rooms.length * nights;
      const live = all.filter(s => LIVE(s)), sold = sum(live, s => this.nightsIn(s, a, b)), rev = sum(live, s => this.nightsIn(s, a, b) * this.nightly(s));
      const arrived = live.filter(s => ms(s.from) >= a && ms(s.from) < b);
      return { nights, available, sold, rev: r2(rev), occ: available ? sold / available * 100 : 0, adr: sold ? rev / sold : 0, revpar: available ? rev / available : 0, alos: arrived.length ? sum(arrived, s => this.nights(s)) / arrived.length : 0, arrived: arrived.length,
        cancelled: all.filter(s => s.status === 'cancelled' && ms(s.from) >= a && ms(s.from) < b).length, noshow: all.filter(s => s.status === 'noshow' && ms(s.from) >= a && ms(s.from) < b).length };
    },
    reportsTab(p, all, rooms) {
      const d = new Date(), from = ms(p.from) ? p.from : U.dmy(new Date(d.getFullYear(), d.getMonth(), 1)), to = ms(p.to) ? p.to : U.dmy(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      const a = ms(from), b = ms(to) + DAY, m = this.measure(all, rooms, a, b);
      const kpi = (k, v, h) => '<div class="istat"><div class="v">' + v + '</div><div class="k" title="' + esc(h) + '">' + k + '</div></div>';
      const group = (key) => { const map = new Map(); all.filter(LIVE).forEach(s => { const n = this.nightsIn(s, a, b); if (!n) return; const k = key(s) || '-', o = map.get(k) || { n: 0, rev: 0, stays: 0 }; o.n += n; o.rev += n * this.nightly(s); o.stays++; map.set(k, o); }); return Array.from(map.entries()).sort((x, y) => y[1].rev - x[1].rev); };
      const gtable = (title, rows) => '<div class="section-title">' + title + '</div>' + (rows.length ? '<div class="tablewrap"><table class="list cards"><thead><tr><th>' + title.replace('By ', '') + '</th><th class="num">Stays</th><th class="num">Room nights</th><th class="num">Share</th><th class="num">Room revenue</th><th class="num">ADR</th></tr></thead><tbody>' +
        rows.map(([k, o]) => '<tr><td><b>' + esc(k) + '</b></td><td class="num">' + o.stays + '</td><td class="num">' + o.n + '</td><td class="num">' + pct(m.sold ? o.n / m.sold * 100 : 0) + '</td><td class="num">' + money(o.rev) + '</td><td class="num">' + money(o.n ? o.rev / o.n : 0) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty">Nothing sold in this period.</div>');
      const daily = Array.from({ length: Math.min(m.nights, 62) }, (_, i) => { const x = a + i * DAY, y = this.measure(all, rooms, x, x + DAY); return [U.dmy(new Date(x)), y.sold, pct(y.occ), money(y.adr), money(y.revpar), money(y.rev)]; });
      const html = '<div class="btnrow" style="align-items:center">' + UI.dateInput('rpFrom', from, { attrs: ' style="width:auto;min-height:34px"' }) + '<span>to</span>' + UI.dateInput('rpTo', to, { attrs: ' style="width:auto;min-height:34px"' }) + '<button class="btn sm outline" id="rpPrint">Print</button></div>' +
        '<div class="istats">' + kpi('Occupancy', pct(m.occ), 'Room nights sold ÷ room nights available') + kpi('ADR', money(m.adr), 'Average daily rate: room revenue ÷ room nights sold') + kpi('RevPAR', money(m.revpar), 'Revenue per available room: room revenue ÷ room nights available (= ADR × occupancy)') +
        kpi('Room revenue', money(m.rev), 'Before GST, room nights only') + kpi('Nights sold', m.sold + ' / ' + m.available, 'Room nights sold of those available') + kpi('Avg stay', m.alos.toFixed(1) + ' n', 'Average length of stay of the arrivals') + kpi('Cancelled', m.cancelled, '') + kpi('No-show', m.noshow, '') + '</div>' +
        gtable('By source', group(s => s.source)) + gtable('By room type', group(s => (this.type(s.typeId) || {}).name)) +
        '<div class="section-title">Night by night</div><div class="tablewrap"><table class="list"><thead><tr><th>Night</th><th class="num">Rooms sold</th><th class="num">Occupancy</th><th class="num">ADR</th><th class="num">RevPAR</th><th class="num">Revenue</th></tr></thead><tbody>' + daily.map(r => '<tr>' + r.map((v, i) => '<td' + (i ? ' class="num"' : '') + '>' + esc(String(v)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
      return { html, wire: () => {
        const go = () => App.go('hotel', { tab: 'reports', from: UI.dateVal('rpFrom') || from, to: UI.dateVal('rpTo') || to });
        $('#rpFrom').onchange = go; $('#rpTo').onchange = go;
        $('#rpPrint').onclick = () => UI.pdf('OCCUPANCY REPORT', from + ' to ' + to + ' · Occupancy ' + pct(m.occ) + ' · ADR ' + money(m.adr) + ' · RevPAR ' + money(m.revpar) + ' · Revenue ' + money(m.rev), ['Night', 'Rooms sold', 'Occupancy', 'ADR', 'RevPAR', 'Revenue'], daily, { right: [1, 2, 3, 4, 5] });
      } };
    },

    settingsTab(st) {
      const w = this.maySettings(), dis = w ? '' : ' disabled';
      const html = '<div class="card white"><div class="bd"><div class="grid2">' +
        UI.field('Kind of property', UI.select('hsProp', PROPERTY, st.property, { attrs: dis })) + UI.field('Name shown (optional)', UI.input('hsName', st.name || '', { placeholder: Store.company().name || '', attrs: dis })) +
        UI.field('Check-in time', UI.input('hsIn', st.checkIn, { type: 'time', attrs: dis })) + UI.field('Check-out time', UI.input('hsOut', st.checkOut, { type: 'time', attrs: dis })) +
        UI.field('Reservation number starts with', UI.input('hsPre', st.prefix, { attrs: dis })) + UI.field('SAC of room accommodation', UI.input('hsSac', st.sac, { attrs: dis })) +
        UI.field('GST slab: rate a night up to ₹', UI.input('hsTh', st.threshold, { type: 'number', attrs: ' min="0" step="any"' + dis })) + '<div class="field"><label>GST up to it / above it</label><div class="btnrow" style="margin:0;flex-wrap:nowrap">' + UI.input('hsLow', st.low, { type: 'number', attrs: ' min="0" step="any" style="max-width:110px"' + dis }) + UI.input('hsHigh', st.high, { type: 'number', attrs: ' min="0" step="any" style="max-width:110px"' + dis }) + '</div><div class="hint">From 22/09/2025: up to ₹7,500 a night 5% (no input tax credit), above 18%</div></div>' +
        UI.field('Booking sources', '<textarea id="hsSrc" rows="3"' + dis + '>' + esc(st.sources.join(', ')) + '</textarea>', { span: true, hint: 'Separated by commas: walk-in, phone, the OTAs, corporate accounts, travel agents' }) + '</div>' +
        (w ? '<div class="btnrow"><button class="btn green" id="hsSave">Save settings</button></div>' : '<div class="hint">Only the owner, an admin or an accountant changes these.</div>') + '</div></div>';
      return { html, wire: (root, again) => { if (!w) return; $('#hsSave').onclick = () => {
        const th = num(UI.val('hsTh')); if (th <= 0) { UI.mark('hsTh', true); return; }
        Object.assign(st, { property: UI.val('hsProp'), name: String(UI.val('hsName')).trim(), checkIn: UI.val('hsIn') || '12:00', checkOut: UI.val('hsOut') || '11:00', prefix: String(UI.val('hsPre')).trim().toUpperCase() || 'RES', sac: String(UI.val('hsSac')).trim() || '996311', threshold: th, low: String(num(UI.val('hsLow'))), high: String(num(UI.val('hsHigh'))),
          sources: String(UI.val('hsSrc')).split(',').map(x => x.trim()).filter(Boolean) });
        if (this.saveSettings(st) === false) return; UI.toast('Hotel settings saved', 2500, 'ok'); again();
      }; } };
    },

    // ------------------------------------------------------------ a reservation
    open(id, then) { const s = Store.find('stays', id); if (s) this.folioDialog(this.full(s), then); },
    edit(init, then) {
      const st = this.settings(), isNew = !(init && init.id), s = this.full(Object.assign({}, init));
      if (isNew) { s.no = ''; if (!s.typeId && st.types[0]) s.typeId = st.types[0].id; const t = this.type(s.typeId); if (!num(s.rate) && t) { s.rate = num(t.rate); s.adults = num(t.adults) || 2; s.extraBedRate = num(t.extraBed); } }
      if (!st.types.length || !st.rooms.length) { UI.toast('Add the room types and rooms first (Rooms & Housekeeping)', 5000); return; }
      const g = s.guest, foreign = () => !/^indian?$/i.test(String(UI.val('sgNat', bg)).trim());
      const roomOpts = () => { const from = UI.dateVal('ssFrom', bg), to = UI.dateVal('ssTo', bg), tid = UI.val('ssType', bg); const free = ms(from) && ms(to) > ms(from) ? this.freeRooms(from, to, s.id) : this.rooms();
        return [['', 'Assign later']].concat(free.filter(r => !tid || r.typeId === tid).map(r => [r.id, r.no + (this.hk(r.id) === 'dirty' ? ' (to clean)' : '')])); };
      const bg = UI.modal({ title: isNew ? (init && init.walkIn ? 'Walk-in' : 'New reservation') : 'Reservation ' + s.no, wide: true, focus: false, body:
        '<div class="section-title" style="margin-top:0">Guest</div><div class="grid3">' + UI.field('Name', UI.input('sgName', g.name), { req: true }) + UI.field('Mobile', UI.input('sgPhone', g.phone, { type: 'tel' })) + UI.field('Email', UI.input('sgEmail', g.email, { type: 'email' })) +
        UI.field('Address', UI.input('sgAddr', g.address), { span: true }) + UI.field('State', UI.select('sgState', U.STATES, g.state || '', { blank: 'Select' })) + UI.field('Company (to bill)', UI.input('sgCo', g.company)) + UI.field('Company GSTIN', UI.input('sgGstin', g.gstin, { attrs: ' maxlength="15" style="text-transform:uppercase"' })) +
        UI.field('Nationality', UI.input('sgNat', g.nationality)) + UI.field('Identity document', UI.select('sgIdT', IDS, g.idType)) + UI.field('Document number', UI.input('sgIdN', g.idNo)) + UI.field('Arrived from', UI.input('sgFrom', g.arrivedFrom, { placeholder: 'City' })) + UI.field('Purpose of visit', UI.select('sgPur', PURPOSE, g.purpose)) + '</div>' +
        '<div class="grid3" id="sgForeign"' + (/^indian?$/i.test(String(g.nationality).trim()) ? ' style="display:none"' : '') + '>' + UI.field('Passport number', UI.input('sgPass', g.passport)) + UI.field('Visa number and type', UI.input('sgVisa', g.visa)) + UI.field('Next destination', UI.input('sgTo', g.goingTo)) + '<div class="field span"><div class="hint">A foreign national is reported on Form C (indianfrro.gov.in) within 24 hours of arrival.</div></div></div>' +
        '<div class="section-title">Stay</div><div class="grid3">' + '<div class="field"><label>Arrival</label>' + UI.dateInput('ssFrom', s.from) + '</div>' + '<div class="field"><label>Departure</label>' + UI.dateInput('ssTo', s.to) + '<div class="hint" id="ssNights"></div></div>' +
        UI.field('Room type', UI.select('ssType', st.types.map(t => [t.id, t.name]), s.typeId)) + UI.field('Room', UI.select('ssRoom', [['', 'Assign later']], '')) +
        UI.field('Adults', UI.input('ssAd', s.adults, { type: 'number', attrs: ' min="1" step="1"' })) + UI.field('Children', UI.input('ssCh', s.children, { type: 'number', attrs: ' min="0" step="1"' })) +
        UI.field('Rate a night ₹ (before GST)', UI.input('ssRate', s.rate, { type: 'number', attrs: ' min="0" step="any"' })) + UI.field('Extra beds', UI.input('ssEb', s.extraBeds, { type: 'number', attrs: ' min="0" step="1"' })) + UI.field('Extra bed ₹ a night', UI.input('ssEbR', s.extraBedRate, { type: 'number', attrs: ' min="0" step="any"' })) +
        UI.field('Meal plan', UI.select('ssPlan', PLANS, s.plan)) + UI.field('Source', UI.select('ssSrc', st.sources.includes(s.source) ? st.sources : st.sources.concat([s.source]), s.source)) + UI.field('Status', UI.select('ssStat', s.status === 'in' || s.status === 'out' ? STATUS.filter(x => x[0] === s.status).map(x => [x[0], x[1]]) : [['confirmed', 'Confirmed'], ['tentative', 'Tentative']], s.status)) +
        UI.field('Notes', UI.input('ssNotes', s.notes, { placeholder: 'Early arrival, cot, anniversary ...' }), { span: true }) + '<div class="field span"><div class="kv" id="ssTotal"></div></div></div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: init && init.walkIn ? 'Save & check in' : 'Save', cls: 'green', onClick: (bg) => {
          const name = String(UI.val('sgName', bg)).trim(); if (!name) { UI.mark('sgName', true, bg); UI.toast('Enter the guest\'s name'); return false; }
          const phone = String(UI.val('sgPhone', bg)).trim(); if (phone && !U.isValidPhone(phone)) { UI.mark('sgPhone', true, bg); UI.toast('Enter a correct mobile number'); return false; }
          const gstin = String(UI.val('sgGstin', bg)).trim().toUpperCase(); if (gstin && !U.isValidGstin(gstin)) { UI.mark('sgGstin', true, bg); UI.toast('Enter a valid GSTIN (15 characters)'); return false; }
          const from = UI.dateVal('ssFrom', bg), to = UI.dateVal('ssTo', bg);
          if (!ms(from) || !ms(to) || ms(to) <= ms(from)) { UI.mark('ssTo', true, bg); UI.toast('The departure is after the arrival'); return false; }
          const roomId = UI.val('ssRoom', bg), c = roomId ? this.clash(roomId, from, to, s.id) : null;
          if (c) { UI.toast('Room ' + this.room(roomId).no + ' is taken by ' + c.no + ' (' + c.guest.name + ', ' + c.from + ' to ' + c.to + ')', 6000); return false; }
          const t = this.type(UI.val('ssType', bg)), guests = num(UI.val('ssAd', bg)) + num(UI.val('ssCh', bg));
          if (t && num(t.max) && guests > num(t.max) + num(UI.val('ssEb', bg))) { UI.toast(t.name + ' takes ' + num(t.max) + ' guests' + (num(UI.val('ssEb', bg)) ? ' and the extra beds' : '; add an extra bed'), 5000); return false; }
          Object.assign(g, { name, phone, email: String(UI.val('sgEmail', bg)).trim(), address: String(UI.val('sgAddr', bg)).trim(), state: UI.val('sgState', bg), company: String(UI.val('sgCo', bg)).trim(), gstin, nationality: String(UI.val('sgNat', bg)).trim() || 'Indian', idType: UI.val('sgIdT', bg), idNo: String(UI.val('sgIdN', bg)).trim(),
            arrivedFrom: String(UI.val('sgFrom', bg)).trim(), purpose: UI.val('sgPur', bg), passport: String(UI.val('sgPass', bg)).trim(), visa: String(UI.val('sgVisa', bg)).trim(), goingTo: String(UI.val('sgTo', bg)).trim() });
          Object.assign(s, { from, to, typeId: UI.val('ssType', bg), roomId, adults: Math.max(1, num(UI.val('ssAd', bg))), children: Math.max(0, num(UI.val('ssCh', bg))), rate: num(UI.val('ssRate', bg)), extraBeds: Math.max(0, num(UI.val('ssEb', bg))), extraBedRate: num(UI.val('ssEbR', bg)), plan: UI.val('ssPlan', bg), source: UI.val('ssSrc', bg), status: UI.val('ssStat', bg), notes: String(UI.val('ssNotes', bg)).trim(), guest: g });
          if (!s.no) s.no = this.nextNo();
          const saved = isNew ? Store.add('stays', s) : Store.update('stays', s);
          UI.toast('Reservation ' + s.no + ' saved', 3000, 'ok');
          if (init && init.walkIn) { setTimeout(() => this.checkIn(this.full(saved), then), 0); return; }
          then();
        } }] });
      const sync = () => {
        const from = UI.dateVal('ssFrom', bg), to = UI.dateVal('ssTo', bg), n = Math.max(0, Math.round((ms(to) - ms(from)) / DAY));
        $('#ssNights', bg).textContent = n ? n + ' night' + (n === 1 ? '' : 's') : 'After the arrival';
        const night = num(UI.val('ssRate', bg)) + num(UI.val('ssEb', bg)) * num(UI.val('ssEbR', bg)), gst = num(this.slab(night)), amt = night * n;
        $('#ssTotal', bg).innerHTML = n ? '<b>' + money(amt) + '</b> for ' + n + ' night' + (n === 1 ? '' : 's') + ' + GST ' + gst + '% ' + money(amt * gst / 100) + ' = <b>' + money(Math.round(amt * (1 + gst / 100))) + '</b>' : '';
      };
      const rooms = () => { const cur = UI.val('ssRoom', bg) || s.roomId; const o = roomOpts(); $('#ssRoom', bg).outerHTML = UI.select('ssRoom', o, o.some(x => x[0] === cur) ? cur : ''); };
      $('#ssType', bg).onchange = () => { const t = this.type(UI.val('ssType', bg)); if (t) { $('#ssRate', bg).value = num(t.rate); $('#ssEbR', bg).value = num(t.extraBed); } rooms(); sync(); };
      ['ssFrom', 'ssTo'].forEach(id => $('#' + id, bg).addEventListener('change', () => { if (id === 'ssFrom' && ms(UI.dateVal('ssTo', bg)) <= ms(UI.dateVal('ssFrom', bg))) $('#ssTo', bg).value = U.toIso(plus(UI.dateVal('ssFrom', bg), 1)); rooms(); sync(); }));
      ['ssRate', 'ssEb', 'ssEbR'].forEach(id => $('#' + id, bg).addEventListener('input', sync));
      $('#sgNat', bg).addEventListener('input', () => { $('#sgForeign', bg).style.display = foreign() ? '' : 'none'; if (foreign() && UI.val('sgIdT', bg) === 'Aadhaar') $('#sgIdT', bg).value = 'Passport'; });
      // A returning guest: the details of their last stay, by mobile number
      $('#sgPhone', bg).addEventListener('change', () => { const ph = String(UI.val('sgPhone', bg)).replace(/\D/g, '').slice(-10); if (!ph || String(UI.val('sgName', bg)).trim()) return;
        const last = this.stays().filter(x => String(x.guest.phone).replace(/\D/g, '').slice(-10) === ph).sort((a, b) => ms(b.from) - ms(a.from))[0]; if (!last) return;
        const lg = last.guest; [['sgName', lg.name], ['sgEmail', lg.email], ['sgAddr', lg.address], ['sgCo', lg.company], ['sgGstin', lg.gstin], ['sgNat', lg.nationality], ['sgIdN', lg.idNo], ['sgPass', lg.passport]].forEach(([id, v]) => { if ($('#' + id, bg) && v) $('#' + id, bg).value = v; });
        if (lg.state) $('#sgState', bg).value = lg.state; if (lg.idType) $('#sgIdT', bg).value = lg.idType; $('#sgForeign', bg).style.display = foreign() ? '' : 'none'; UI.toast('A returning guest: details of stay ' + last.no + ' filled in', 3000); });
      rooms(); if (s.roomId) $('#ssRoom', bg).value = s.roomId; sync();
      return bg;
    },
    // The folio: what the stay comes to, what was paid; check in, check out, the invoice
    folioDialog(s, then) {
      const w = this.mayStays(), f = this.folio(s), open = ['tentative', 'confirmed'].includes(s.status);
      const inv = s.invoiceNo ? Store.list('invoices').find(i => i.kind === 'invoice' && i.no === s.invoiceNo) : null;
      const bg = UI.modal({ title: s.no + ' · ' + (s.guest.name || 'Guest'), wide: true, focus: false, body:
        '<div class="kv" style="margin-bottom:8px">' + pill(STATUS, s.status) + ' <b>' + esc(this.roomName(s.roomId)) + '</b> · ' + esc(s.from) + ' → ' + esc(s.to) + ' · ' + this.nights(s) + ' night' + (this.nights(s) === 1 ? '' : 's') + ' · ' + num(s.adults) + ' adult' + (num(s.adults) === 1 ? '' : 's') + (num(s.children) ? ' + ' + num(s.children) + ' child' + (num(s.children) === 1 ? '' : 'ren') : '') + ' · ' + esc(s.plan) + ' · ' + esc(s.source) +
        (s.guest.phone ? ' · ' + esc(s.guest.phone) : '') + (s.guest.company ? ' · ' + esc(s.guest.company) + (s.guest.gstin ? ' (' + esc(s.guest.gstin) + ')' : '') : '') + (s.notes ? '<div class="small muted">' + esc(s.notes) + '</div>' : '') + '</div>' +
        '<div class="tablewrap"><table class="list"><thead><tr><th>Date</th><th>Particulars</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th class="num">GST</th><th></th></tr></thead><tbody>' +
        f.lines.map(l => '<tr><td>' + esc(l.date || '') + '</td><td><b>' + esc(l.desc) + '</b>' + (l.detail ? '<div class="small muted">' + esc(l.detail) + '</div>' : '') + '</td><td class="num">' + l.qty + '</td><td class="num">' + money(l.rate) + '</td><td class="num">' + money(l.amount) + '</td><td class="num">' + l.gst + '% ' + money(l.tax) + '</td><td>' + (w && !l.room && s.status !== 'out' ? '<button class="btn sm outline" data-delc="' + l.i + '" title="Remove">✕</button>' : '') + '</td></tr>').join('') +
        '<tr><td></td><td class="r"><b>Taxable / GST</b></td><td></td><td></td><td class="num"><b>' + money(f.taxable) + '</b></td><td class="num"><b>' + money(f.gst) + '</b></td><td></td></tr>' +
        '<tr><td></td><td class="r"><b>Total (rounded)</b></td><td></td><td></td><td class="num" colspan="2"><b>' + money(f.total) + '</b></td><td></td></tr>' +
        (s.payments || []).map((p, i) => '<tr><td>' + esc(p.date) + '</td><td>Paid · ' + esc(p.mode) + (p.ref ? ' · ' + esc(p.ref) : '') + '</td><td></td><td></td><td class="num" colspan="2">- ' + money(p.amount) + '</td><td>' + (w && s.status !== 'out' ? '<button class="btn sm outline" data-delp="' + i + '" title="Remove">✕</button>' : '') + '</td></tr>').join('') +
        '<tr><td></td><td class="r"><b>' + (f.balance >= 0 ? 'Balance due' : 'Refund due') + '</b></td><td></td><td></td><td class="num" colspan="2"><b>' + money(Math.abs(f.balance)) + '</b></td><td></td></tr></tbody></table></div>' +
        (s.invoiceNo ? '<div class="hint">Invoice ' + esc(s.invoiceNo) + (inv ? '' : ' (not found in Sales)') + '</div>' : ''),
        buttons: [{ label: 'Close', cls: 'outline' }, { label: 'Print folio', cls: 'outline', onClick: () => { this.printFolio(s); return false; } }]
          .concat(w && s.status !== 'out' && LIVE(s) ? [{ label: 'Edit', cls: 'outline', onClick: () => { this.edit(s, then); } }, { label: '+ Charge', cls: 'outline', onClick: () => { this.addCharge(s, () => { then(); this.open(s.id, then); }); } }, { label: '+ Payment', cls: 'outline', onClick: () => { this.addPayment(s, () => { then(); this.open(s.id, then); }); } }] : [])
          .concat(w && open ? [{ label: 'Cancel booking', cls: 'red outline', onClick: () => { this.cancel(s, then); } }, { label: 'Check in', cls: 'green', onClick: () => { this.checkIn(s, then); } }] : [])
          .concat(w && s.status === 'in' ? [{ label: 'Check out', cls: 'red', onClick: () => { this.checkOut(s, then); } }] : [])
          .concat(w && s.status === 'out' && !inv ? [{ label: 'Make invoice', cls: 'green', onClick: () => { App.go('invoice', { fromStay: s.id }); } }] : [])
          .concat(inv ? [{ label: 'Open invoice', cls: 'blue', onClick: () => { App.go('invoice', { id: inv.id }); } }] : []) });
      $$('[data-delc]', bg).forEach(b => b.onclick = () => { s.charges.splice(+b.dataset.delc, 1); Store.update('stays', s); bg.remove(); then(); this.open(s.id, then); });
      $$('[data-delp]', bg).forEach(b => b.onclick = () => { s.payments.splice(+b.dataset.delp, 1); Store.update('stays', s); bg.remove(); then(); this.open(s.id, then); });
      return bg;
    },
    addCharge(s, then) {
      UI.modal({ title: 'Charge to ' + s.no, body: '<div class="grid2">' + UI.field('Particulars', UI.input('chDesc', '', { list: 'chList' }) + UI.datalist('chList', CHARGES), { req: true }) + '<div class="field"><label>Date</label>' + UI.dateInput('chDate', ms(todayStr()) < ms(s.to) ? todayStr() : s.from) + '</div>' +
          UI.field('Amount ₹ (before GST)', UI.input('chAmt', '', { type: 'number', attrs: ' min="0" step="any"' })) + UI.field('GST %', UI.select('chGst', ['5', '18', '12', '0', '40'], '5'), { hint: 'Food served in the hotel: 5% where no room is let above ₹7,500 a night, else 18%' }) + UI.field('SAC / HSN', UI.input('chSac', '', { placeholder: '996331 food, 999712 laundry' })) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Add', cls: 'green', onClick: (bg) => {
          const desc = String(UI.val('chDesc', bg)).trim(), amount = num(UI.val('chAmt', bg)); if (!desc) { UI.mark('chDesc', true, bg); return false; } if (amount <= 0) { UI.mark('chAmt', true, bg); return false; }
          s.charges = (s.charges || []).concat([{ desc, date: UI.dateVal('chDate', bg) || todayStr(), amount, gst: UI.val('chGst', bg), sac: String(UI.val('chSac', bg)).trim() }]); Store.update('stays', s); then();
        } }] });
    },
    addPayment(s, then) {
      const due = this.folio(s).balance;
      UI.modal({ title: 'Payment for ' + s.no, body: '<div class="grid2">' + UI.field('Amount ₹', UI.input('pyAmt', due > 0 ? due : '', { type: 'number', attrs: ' min="0" step="any"' }), { hint: 'Due now ' + money(due) }) + UI.field('Mode', UI.select('pyMode', MODES, 'UPI')) + '<div class="field"><label>Date</label>' + UI.dateInput('pyDate', todayStr()) + '</div>' + UI.field('Reference', UI.input('pyRef', '', { placeholder: 'UPI ref, card slip, OTA booking ID' })) + '</div>',
        buttons: [{ label: 'Cancel', cls: 'outline' }, { label: 'Add', cls: 'green', onClick: (bg) => {
          const amount = num(UI.val('pyAmt', bg)); if (amount <= 0) { UI.mark('pyAmt', true, bg); return false; }
          s.payments = (s.payments || []).concat([{ date: UI.dateVal('pyDate', bg) || todayStr(), mode: UI.val('pyMode', bg), amount, ref: String(UI.val('pyRef', bg)).trim() }]); Store.update('stays', s); then();
        } }] });
    },
    checkIn(s, then) {
      if (!s.roomId) { UI.toast('Assign a room to ' + s.no + ' first (Edit)', 5000); this.edit(s, then); return; }
      if (!String(s.guest.idNo || s.guest.passport || '').trim()) { UI.toast('Note the guest\'s identity document before check-in: the register needs it', 5000); this.edit(s, then); return; }
      const c = this.clash(s.roomId, U.today(), plus(U.today(), 1), s.id); if (c && c.status === 'in') { UI.toast('Room ' + this.room(s.roomId).no + ' is still occupied by ' + c.guest.name + ' (' + c.no + ')', 6000); return; }
      const hk = this.hk(s.roomId), go = () => { if (ms(s.from) > ms(U.today())) { UI.toast('The stay begins on ' + s.from + ': change the arrival to check in today', 5000); return; }
        // An early arrival or a late one: the stay runs from today
        if (ms(s.from) !== ms(U.today())) s.from = U.today();
        if (ms(s.to) <= ms(s.from)) s.to = plus(s.from, 1);
        s.status = 'in'; s.checkedInAt = Date.now(); Store.update('stays', s); UI.toast(s.guest.name + ' checked in to room ' + this.room(s.roomId).no, 4000, 'ok');
        if (!/^indian?$/i.test(String(s.guest.nationality).trim())) UI.toast('A foreign national: report on Form C within 24 hours (Guest Register > Foreign nationals)', 7000);
        then(); };
      if (hk === 'dirty' || hk === 'ooo') UI.confirm('Room not ready', 'Room ' + this.room(s.roomId).no + ' is ' + pick(HK, hk)[1].toLowerCase() + '. Check in anyway?', go, 'Check in'); else go();
    },
    checkOut(s, then) {
      const today = U.today(), early = ms(s.to) > ms(today), late = ms(s.to) < ms(today);
      const f0 = this.folio(Object.assign({}, s, early ? { to: ms(today) > ms(s.from) ? today : plus(s.from, 1) } : {}));
      UI.confirm('Check out ' + s.guest.name, (early ? 'Leaving before ' + s.to + ': the stay is cut to ' + Math.max(1, Math.round((ms(today) - ms(s.from)) / DAY)) + ' night(s).\n' : late ? 'Due out on ' + s.to + ': the nights since are not charged unless the departure is changed (Edit) first.\n' : '') +
        'Total ' + money(f0.total) + ', paid ' + money(f0.paid) + ', ' + (f0.balance >= 0 ? 'due ' + money(f0.balance) : 'refund ' + money(-f0.balance)) + '.\n\nRoom ' + ((this.room(s.roomId) || {}).no || '') + ' goes to housekeeping (dirty). The tax invoice opens next.', () => {
        if (early) s.to = ms(today) > ms(s.from) ? today : plus(s.from, 1);
        s.status = 'out'; s.checkedOutAt = Date.now(); Store.update('stays', s);
        if (s.roomId) this.setHk(s.roomId, 'dirty');
        UI.toast(s.guest.name + ' checked out', 3000, 'ok');
        App.go('invoice', { fromStay: s.id });
      }, 'Check out');
    },
    cancel(s, then) {
      UI.modal({ title: 'Cancel ' + s.no, body: '<p>' + esc(s.guest.name) + ', ' + esc(s.from) + ' to ' + esc(s.to) + '. The room is freed.</p>' + UI.field('', UI.select('cxWhy', [['cancelled', 'Cancelled by the guest'], ['noshow', 'No-show']], ms(s.from) < ms(U.today()) ? 'noshow' : 'cancelled')) + '<div class="hint">A cancellation or no-show charge is added to the folio as a charge first (+ Charge), and invoiced from Sales.</div>',
        buttons: [{ label: 'Back', cls: 'outline' }, { label: 'Cancel booking', cls: 'red', onClick: (bg) => { s.status = UI.val('cxWhy', bg); s.cancelledAt = Date.now(); Store.update('stays', s); UI.toast(s.no + ' ' + pick(STATUS, s.status)[1].toLowerCase()); then(); } }] });
    },
    printFolio(s) {
      const f = this.folio(s), co = Store.company();
      UI.pdf('GUEST FOLIO ' + s.no, s.guest.name + (s.guest.company ? ' · ' + s.guest.company : '') + ' · Room ' + ((this.room(s.roomId) || {}).no || '-') + ' · ' + s.from + ' to ' + s.to + ' · ' + (co.name || ''),
        ['Date', 'Particulars', 'Qty', 'Rate', 'Amount', 'GST %', 'GST'],
        f.lines.map(l => [l.date, l.desc + (l.detail ? ' (' + l.detail + ')' : ''), l.qty, money(l.rate), money(l.amount), l.gst + '%', money(l.tax)])
          .concat([['', 'Total (rounded)', '', '', money(f.total), '', '']]).concat((s.payments || []).map(p => [p.date, 'Paid · ' + p.mode + (p.ref ? ' · ' + p.ref : ''), '', '', '- ' + money(p.amount), '', '']))
          .concat([['', f.balance >= 0 ? 'Balance due' : 'Refund due', '', '', money(Math.abs(f.balance)), '', '']]), { right: [2, 3, 4, 5, 6] });
    },

    // ------------------------------------------------------------ the tax invoice (invoice.js, route invoice?fromStay=<id>)
    invoiceFor(id, inv) {
      const s0 = Store.find('stays', id); if (!s0) return null;
      const s = this.full(s0), f = this.folio(s), g = s.guest;
      // The place of supply of accommodation is the property: CGST + SGST whatever the guest's state (IGST Act s.12(3))
      const own = inv.buyer.state;
      inv.buyer = { name: (g.company || g.name) + (g.company ? '\n' + g.name : '') + (g.address ? '\n' + g.address : '') + (g.state && g.state !== own ? '\n' + U.stateName(g.state) : ''), phone: g.phone || '', email: g.email || '', gstin: g.gstin || '', state: own };
      inv.sameShip = true; inv.consignee = JSON.parse(JSON.stringify(inv.buyer));
      inv.items = f.lines.map((l, n) => ({ sl: n + 1, desc: l.desc, hsn: l.sac || (l.room ? this.settings().sac : ''), gst: String(l.gst), inc: false, qty: l.qty, uqc: 'OTH', rate: l.rate, taxable: 0, totalIncl: 0, subSerial: '', subDesc: l.detail || '', subInfo: '' }));
      inv.other = Object.assign({}, inv.other, { reference: 'Reservation ' + s.no, info: 'Stay ' + s.from + ' to ' + s.to + ', room ' + ((this.room(s.roomId) || {}).no || '-') + ', ' + num(s.adults) + ' adult(s)' + (num(s.children) ? ', ' + num(s.children) + ' child(ren)' : '') + ', ' + s.plan });
      const last = (s.payments || []).slice(-1)[0], mode = last ? (/cash/i.test(last.mode) ? 'Cash' : /cheque/i.test(last.mode) ? 'Cheque' : 'Online') : 'Cash';
      inv.payment = f.balance > 0.5 ? 'Credit' : mode;
      inv.hotelStay = s.id;
      return inv;
    },
    // A saved invoice that was made for a stay: the stay names it
    invoiced(inv) { const s = Store.find('stays', inv.hotelStay); if (!s || s.invoiceNo === inv.no) return; s.invoiceNo = inv.no; Store.update('stays', s); }
  };

  App.routes.hotel = (p) => { p = p || {}; if (!p.tab) p.tab = 'desk'; Hotel.screen(p); App.markNav('hotel', { tab: p.tab }); };
  global.Hotel = Hotel;
})(window);
