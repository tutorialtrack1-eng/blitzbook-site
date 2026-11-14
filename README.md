# BlitzBook Web Portal

Browser version of the BlitzBook GST invoice Android app (`VanyaGSTInvoice`). Same screens, same
calculations, same print layouts, responsive from phone to desktop. No build step: plain HTML, CSS and
JavaScript. With the sync server running (`server/`), the app and the portal show the same books; without
it the data lives in the browser's local storage.

## Run it

- `node server/server.js` and open <http://localhost:8080/> — the portal and the sync server together, or
- double-click `index.html`, or serve the folder with any static server / web host. The portal then works
  on its own, or syncs with the Supabase project built into `js/sync.js`.

Register with a mobile number, an email and a password (the email is where the OTP goes, so it is required). The OTP comes by email from Supabase Auth (see
`server/supabase/README.md`) or by SMS and email from the sync server (`server/README.md`, *OTP delivery*);
with neither, the OTP is shown on screen (test mode). Forgot / Reset Password works the same way: the OTP goes to the mobile
number and email of the account, so a password can be reset from any device. A 1-day trial starts on
first login, after which an activation code is needed. With sync on, the account made in the app logs in
here and vice versa, and the trial and activation are shared.
A login lasts 24 hours in the portal and in the app; after that the login page comes back (the books stay).

## What is inside

| File | Purpose |
|---|---|
| `index.html` | Entry page, loads the scripts below |
| `css/app.css` | Responsive styles: horizontal top navigation, gradient theme, tables that turn into cards on phones |
| `js/util.js` | Indian number format, amount in words, GSTIN / phone / email validation, invoice numbering, state list, UQC codes, HSN and bank lookups, Excel (.xlsx) reader |
| `js/store.js` | The books per user (parties, items, invoices, purchases, expenses, journal, notes, accounts) in IndexedDB, mirrored in memory so reads and writes stay synchronous; `Store.init()` loads them before the portal starts and moves what older versions kept in localStorage (5 to 10 MB cap) across once; falls back to localStorage where IndexedDB is missing |
| `js/appformat.js` | The app's table layout: converts every record to and from the app's rows, for sync and for backup files |
| `js/supabase.js` | Supabase as the backend: Supabase Auth for accounts and OTPs, the `books` table for the records; answers the same requests as the sync server |
| `js/sync.js` | Keeps this browser and the app on the same books through Supabase or the sync server |
| `js/subscription.js` | Trial, plans, UPI link, activation server and codes (same SHA-256 scheme as the app, so `tools/LicenceKeyGen.java` codes work) |
| `js/print.js` | Printable documents: Standard (BlitzBook) and Classic boxed (Tally style) invoices, delivery challan, envelopes, purchase record / quotation, credit and debit notes, receipt / payment vouchers. Pages carry their own margins so the browser adds no header or footer to the PDF; long item lists repeat the table heading on every page |
| `js/app.js` | Shell, login / register / reset (with the sync server when there is one), dashboard, top navigation, company profile, backup, subscription, sync dialogs |
| `js/invoice.js` | New Invoice editor, quick item picker, Save and Print / PDF, Print Settings (layout previews, paper, envelopes), e-way bill warning, Sales list, Credit / Debit notes |
| `js/ledger.js` | Books (Profit & Loss, Balance Sheet with party-wise receivables / payables, stock figures; a port of Ledger.java), Customers / Suppliers, Item master, Purchases & Quotations, Expenses, Journal, Stock in hand |
| `js/money.js` | Receipts & Payments (kept as journal vouchers), receipt / payment voucher printout, bank statement upload |
| `js/reports.js` | Sales report, Profit & Loss, Balance sheet, period picker, Excel export |
| `js/gst.js` | GST returns: fetches a return period from the books and writes the GSTR-1 and GSTR-3B JSON files for the GST portal's offline tool (yearly plan or longer). "File on GST portal" writes the file, opens the portal's login in a new tab and walks through upload, a review table the portal's summary must match, Submit and File (the portal has no free login / filing API and its captcha stops automation, so the login stays the user's; BlitzBook never sees it); the ticks and "filed on" are kept per period |
| `js/migrate.js` | Migrate to BlitzBook (Company > Migrate, a dashboard tile): a Tally XML export (ledgers under Sundry Debtors / Creditors with opening balances, stock items with HSN / GST / opening stock, Sales and Purchase vouchers) or a CSV / Excel sheet from SAP, Zoho Books, Vyapar, Busy, Marg, QuickBooks or any software, with the header row matched to BlitzBook's fields (SAP field names included) and a mapping step to correct it, a preview with warnings, then a bulk import; templates per record type; opening balances become one journal entry, opening stock one stock document; document numbers already in the books are never overwritten |
| `js/hr.js` | HR & payroll: employees (monthly or hourly), attendance, weekly timesheets with manager approval, reimbursements, monthly payroll with PF / ESI / professional tax / TDS, payslips, offer letters, statutory summaries, PF ECR sheet, bank advice, posting of a finalised month into the books; HR Settings |
| `js/companies.js` | Companies: several companies under one login (each in its own storage namespace with its own sync), company groups, members with roles (owner, admin, accountant, sales, viewer) and what each role may open and change, the company switcher, and Group Statements (consolidated Profit & Loss / Balance Sheet with inter-company eliminations). Roles in rank order: Owner › Admin › Manager › HR › Accountant › Sales › Employee › Viewer. Every employee gets a login of their own: **Give login** on the employee list adds their mobile or email to the company as **Employee** and shows the invitation link to copy or send on WhatsApp (the invite email carries it too): `#join?e=..&p=..&n=..&c=..&r=..` opens the portal on Register with the name, mobile and email filled in and the company named, or on Login when the identity already has an account, and switches to that company after signing in; an Employee login sees its own dashboard (Web Clock, My Timesheet, My Claims), clocks itself in and out, fills its timesheet and raises claims, sees only itself and the people who report to it, and approves their timesheets and claims — never its own, which go to the reporting manager (or a Manager, an Admin or the Owner). A steward or a cashier who also bills customers gets the Sales role instead; the chip shows the designation either way |
| `js/inventory.js` | Inventory management: stock as the sum of its movements (purchases and uploads in, invoices out, recipes / bills of materials using their ingredients when the dish is sold, adjustments, counts, transfers); locations; reorder level and shelf life per item; last-rate, weighted-average and FIFO valuation (Books.stock asks it, so the balance sheet follows); stock summary, valuation, ageing, fast and slow movers and expiry reports; the ivt: documents sync between portal devices |
| `js/manpower.js` | Manpower: the roster of a manpower and staffing agency (shown to a *Services* company of the type *Manpower and Staffing Services*): members with their trade, skill category, skills, certificates, engagement, pay and bill rates and papers; deploy and release with the history; the Deployment, Skills and Papers tabs; upload, export and the register of workmen; the `mpw:` records sync between portal devices |
| `js/procure.js` | Procurement: requisitions (REQ-), purchase orders (PO-, printed, Draft > Sent > Partly received > Received > Closed / Cancelled), goods receipts (GRN-) that turn into the purchase bill, Low Stock from the reorder levels and Compare Quotes over the quotations; the prc: documents sync between portal devices |
| `js/mail.js` | Send mail: the Email buttons compose an invoice, a receipt, a payment reminder, a purchase order or a requisition (text, and an HTML table for the server); Send goes through the server (the Supabase mail function or the sync server's /api/mail), else the mail app opens with the message ready |
| `js/aside.js` | The Recent panel on the right of every screen: the records touched last that the screen is about (recent products, invoices and customers on the invoice editor; purchases, items bought and suppliers on Purchases; stock entries and stock in hand on Stock, and so on), each a link that opens the record; hide / show, and a per-screen choice of sections and count |

## Screens

Everything the app has:

- Dashboard with greeting, company chips, subscription status, monthly stats, recent products and the
  tiles Invoice, Sales, Items, Customer, Supplier, Purchase, Expense, Journal, Reports. The top bar is
  Dashboard and six groups that drop down on hover (or a tap on a phone): Sales (New Invoice, Sales,
  Delivery Challans, Credit / Debit Notes, Customers, Sales Report, Outstanding & Ageing), Purchases
  (Purchases & Quotations, Suppliers, Expenses), Inventory (Overview, Items, Stock in Hand, Adjustments & Wastage, Stock Count,
  Transfers, Recipes / BoM, Movements, Reports), Records (Receipts & Payments,
  Journal, Party Ledger, Profit & Loss, Balance Sheet, Group Statements), HR (Employees, Attendance, Timesheets,
  Reimbursements, Payroll, HR Settings) and Company (Company Profile,
  Companies, GST Returns, Export / Import, AI Access, Subscription); the company chip, dark mode and Logout
  sit on the right. An invoice pack and a role in another company trim the groups to what they may open.
- Recent panel: a column on the right of every screen (`js/aside.js`) with what was touched last in the books the
  screen is about. On the invoice editor it is the recent products (a tap puts one on the open invoice, or adds
  one more of it; from any other screen a tap starts a new invoice with it), the last invoices, the customers
  billed last and the challans; Purchases gets the last bills, the items bought and the suppliers; Stock the
  stock entries, stock in hand and the items; Receipts & Payments, Journal, Expenses, Contacts, the reports and
  HR each get their own set. Every entry is a link that opens the record. The x hides the panel and the floating
  Recent button brings it back (this browser remembers the choice, like dark mode); the grid button chooses, per
  screen, which sections show and how many entries (5 / 8 / 12 / 20), kept with the account's books on this device.
  Under 1100px wide the panel is a drawer opened from the Recent button. Nothing of it prints.
- Every customer and supplier carries a number, CUST-0001 / SUPP-0001, given when it is made (and on the first visit to
  the list for the ones from before); it syncs with the contact (contact_no). The number is the link that opens the
  contact from every list, so the lists have no Edit button: the number (or the employee code) opens the entry, for
  purchases, expenses, journal entries, receipts and payments, notes, employees and procurement alike. Every list shows
  one fact per column (phone, email, department, narration ... each in its own column, nothing stacked under another
  value), and the Customer / Supplier lists have **Columns**: tick the standard columns to show and add own columns
  (Area, Credit days, Contact person ...), each a field on every contact of that kind, kept with the contact (extra).
- Thermal receipt: a third print layout for restaurant / POS roll printers (80 mm or 58 mm): the shop, the bill
  number, table, PAX and date, the items with quantity x rate, net total, GST, the gross amount, the amount in words,
  the steward and a thank-you line, in a monospaced face. A restaurant (Food and Beverages, type Restaurant) prints on it until Print
  Settings chooses another layout; the paper size offers the rolls. The app has the same third layout under Layout & Paper, with the same default for a restaurant. PAX (covers) joins the Table & Service card.
- Employees carry the assets they hold (laptop, phone, uniform, keys: name, tag / serial, issued on, returned on,
  notes) under Assets held on the employee; the list shows what is still held and the Assets button lists every
  asset of every employee, with Excel export.
- Inventory (its own group, the dashboard tile too): an overview with the stock value, items in stock, low and out of
  stock, lots expiring in 7 days and the month's wastage; Adjustments (ADJ-) in or out with a reason (wastage, damage,
  expired, theft, own use, sample, surplus, correction); Stock Count (CNT-) against the books, the differences posted
  as an adjustment; locations (Main, Kitchen, Bar, a second godown) and Transfers (TRF-) between them; Recipes for a
  restaurant and Bills of Materials for everyone else, each sale taking the ingredients out of stock, with the cost
  per portion and the food cost %; a movement ledger per item and location with the running balance; Reports (stock
  summary over a period, valuation by the three methods, ageing and dead stock, fast and slow movers with ABC class
  and days of cover, expiry by lot); Settings for the valuation method, the reorder level and the shelf life. The
  features follow what Zoho Inventory, Odoo Inventory, TallyPrime and Petpooja offer.
- Procurement (Purchases group): requisitions of what is needed, by when and who asked (Low Stock fills one from the
  reorder level typed per item, and an item at or under its level is flagged with what is on order); purchase orders
  to a supplier with the expected delivery, rates, terms and a PURCHASE ORDER printout, made by hand, from a
  requisition or from Compare Quotes (the quotations recorded under Purchases, item by item, the cheapest marked and
  one draft order per supplier at the lowest rates); goods receipts against an order, line by line and in parts, the
  order going Draft > Sent > Partly received > Received > Closed / Cancelled; Make bill opens the purchase editor with
  the received items as stock, naming the order and the receipt. Nothing touches the books until the bill is saved.
- Email buttons: an invoice (its screen and the Sales list) to the buyer, a receipt to the customer, a payment
  reminder from Outstanding & Ageing (one customer, or Email all reminders to every customer with an email address),
  a purchase order to the supplier and a requisition to the company mailbox. The dialog shows the address (from the
  document or the contact), the subject and the message, all editable; Send asks the server to send it (the Supabase
  `mail` edge function, or the sync server's /api/mail, through the SMTP account that sends the OTPs), and when no
  server can send, the mail app opens with the message ready, which Open in mail app does straight away. The message
  carries the document as text; the PDF is printed from the portal.
- Invoice editor: number with step buttons and owner-defined format, date, payment mode, RCM for service
  businesses, buyer and consignee blocks with contact pick-list, other details (transporter, delivery note,
  buyer order no and date, reference, info), item rows with HSN (filled from the item master or the
  well-known HSN names), GST %, inclusive-of-tax toggle, quantity, UQC, rate, product sub-details, totals
  with CGST/SGST or IGST by state, rounding and amount in words.
- Save Draft keeps a half-done invoice or challan under its number in this browser without touching the books;
  Drafts (top of the editor) lists them to continue or delete, and saving the real document drops its draft.
  A saved invoice or challan opens locked (every field disabled, a bar saying so) so it is not changed by
  accident; Edit asks once and then unlocks it. Print, Duplicate, Challan, Receipt, Delete and Save Draft
  work on a locked invoice as they are.
- The invoice's extra fields follow the line of activity. A restaurant (Food and Beverages) gets a Table & Service
  card: the table number, the steward (picked from the employees; a new invoice names the employee the login
  belongs to) and other info, and none of the dispatch fields; both print on the Standard and Classic layouts and
  sync as table_no / steward (an app that does not know the columns leaves them as they are). A service business
  gets the reference, order / PO number and date and other info only. Retail, wholesale, manufacturing and general
  keep the dispatch details (destination, vehicle, transporter, delivery note ...), a transporter its consignment.
  The Classic printout's detail box follows the same choice.
- **Manpower and staffing invoices** (portal only): a *Services* company whose type is *Manpower and Staffing Services*
  (Company Profile) bills staff-wise. A new invoice opens on the **Staff Deployed** sheet instead of the item rows: the
  billing period (the month just ended up to the 10th, else the month running), the work site, the SAC (998519 unless
  changed; the other staffing, security and housekeeping codes are offered) and the GST rate of every line; then a
  person a row: **Name, Employee ID, Designation, Per (days / hours / months), Worked, Rate, OT hours, OT rate, Amount
  and Advance**. Amount = worked x rate + OT hours x OT rate. A name of an employee under HR fills in the code and the
  designation (never the salary as the rate); a name billed before also brings its unit and rates; **+ From
  Employees** ticks several employees onto the sheet at once. Under the rows: *Employer PF %* and *Employer ESI %* of
  the wages and a *Service Charge %* on the wages or on wages + PF & ESI; each becomes a line of the invoice worked out
  by itself. GST is charged on the full value (Section 15: wages, statutory contributions and the commission); the
  **advances** come off the invoice total after GST as *Less: Advances* and *Net Payable*, in the totals and on the
  printouts. The books keep the invoice at its full total: the advance is recorded as a receipt against the invoice,
  like any money received. The Standard and Classic printouts carry Name, Emp ID, Designation, Worked and Rate as
  columns, the overtime and the advance under the name, the period and the site in the details box. *Duplicate*
  copies the people, rates and charges for the next month with the advances cleared; a new sheet takes the SAC and
  the charges of the last one. The tick *Staff-wise billing* takes one invoice back to plain lines (a placement fee,
  say). How it is kept: every person is an invoice line (desc the name, qty the days or hours, uqc DAY / HRS / MON)
  with staff: { empId, designation, ot, otRate, advance }, the PF / ESI / service charge lines carry auto, and the
  sheet is staff on the invoice; they sync between portal devices as the staff column of the invoice row (JSON). The
  app shows such an invoice as plain lines and leaves the sheet as it is. The model follows the usual Indian
  manpower supply bill (wages statement, employer PF 13% and ESI 3.25%, service charge, GST 18%) and what Zoho Books,
  TallyPrime and the staffing billing of Keka / greytHR offer. Test: PLAYWRIGHT_CORE=... node tools/staffing.js.
- **Manpower tab** (portal only): a manpower and staffing agency keeps people rather than stock, so a *Services*
  company of the type *Manpower and Staffing Services* gets a **Manpower** group in the navigation, before Inventory
  (which stays), and a Manpower tile on the dashboard. It is a roster kept for reference: nothing in it runs attendance
  or payroll (that is HR), and a member does not have to be an employee. **Members**: code (MP001 ...), name, gender,
  date of birth, father's / spouse's name, mobile, address, emergency contact; the **skill set**: trade / designation,
  skill category (Unskilled, Semi-skilled, Skilled, Highly skilled), skills as tags, experience, education, languages,
  certificates and licences with number and validity; engagement (on our rolls, contract, daily wage, through a
  sub-contractor, freelance), joined on, engagement ends; status (Available, Deployed, On leave, Inactive); **pay rate**
  and **bill rate** per day / hour / month with the margin between them, overtime rate; Aadhaar, PAN, UAN, ESI number,
  bank account, police verification and medical fitness with their validity; notes. Search over name, code, trade,
  skill, phone, client and site, chips by status, filters by category and skill. *Deploy* sends a member to a client
  (a customer) and site with dates, shift and the bill rate for that client; *Release* ends it and keeps it in the
  member's history; changing the client on the member does the same. **Deployment**: a card per client and site with
  the headcount by trade and what a day bills, then the bench (available now) and who is on leave. **Skills**: the
  people of every skill and of every category, and how many are free; a skill opens its people. **Papers**: what has
  expired, what runs out within 60 days (police verification, medical fitness, licences, the engagement, a
  deployment) and what is missing (Aadhaar, bank account, police verification). *Upload CSV / Excel* (template,
  upsert or insert only), *Export Excel*, *From Employees* (copies the employees under HR, never the salary) and
  *Register* (the roster printed in the columns of Form XIII, the register of workmen employed by a contractor).
  The invoice's staff sheet reads the roster: a member's name fills in the code, the trade, the unit, the bill rate
  and the overtime rate; **+ From Manpower** lists the members (and the employees not on the roster), with the ones
  deployed at the buyer of the invoice first and ticked. How it is kept: the manpower collection, mpw:<id> on the
  server, in backups as the manpower table; the app leaves it alone. The owner, an admin and an accountant change it,
  a viewer reads it; the HR roles, sales and employee logins do not open it (the server gives the HR roles the HR
  records only, so nothing changes in companies.sql). Benchmarks the fields follow: the temp profile of Zoho Workerly
  (base pay rate, job rate, availability, the job a temp is on), the candidate record of staffing systems such as
  Bullhorn (skills, certifications, status), the education / occupation / skill type of e-Shram, and Form XIII of the
  Contract Labour Central Rules (name, sex, father's name, designation, address, commencement and termination).
  Test: PLAYWRIGHT_CORE=... node tools/manpower.js.
- Quick items: starter items for the line of activity plus the item master, with search, category chips
  (rename / remove), list or grid view, quantity steppers, per-invoice price and GST, add / customise /
  remove items. *Construction* starts with building materials, finishing, plumbing & electrical and the works
  contract and labour (SAC 9954); *Medical* with medicines, surgical items and consumables, devices and the exempt
  health services (SAC 9993). The starter prices and GST rates are only a start: Customise Item sets the real ones.
- Stock and sales: a sale takes a stock item out of stock (the sale of a dish with a recipe takes its ingredients).
  A stock item is one with stock coming in under the same name, whatever the capitals and the spaces. In a business
  that sells goods (not a restaurant, a service or a transport business), goods sold are stock even when nothing of
  them was taken in: an item of the item master, or an invoice line with an HSN code, that is not a service (SAC
  99...). Its stock then shows below nil, which says the purchase or the opening stock is still to be entered. The
  app works it out the same way (Inventory.java).
- Updates: the service worker asks the server for every page and script afresh (the browser's ten-minute copy used to
  hide an update), looks for a new version whenever the tab comes back into view, and a bar offers *Reload* once one
  has taken over.
- A restaurant's Menu: a new invoice of a restaurant opens on the menu before the invoice, laid out like a food
  ordering app: the categories down the side (a row of chips on a phone) with the number picked from each, the
  dishes of each category under its heading. Tapping a dish (or ADD) puts it on the invoice at once, ADD turns into
  − n +, and the bar at the foot counts what is on the invoice; Go to Invoice closes it. Search, + Add Dish, the
  price of a dish (for this invoice, or Customise Item) and renaming a category are there too. The invoice's own
  button is Menu instead of Quick Food Items, and Save moves on to the next invoice with the menu open again. Not
  on a saved invoice, a draft, a copy, a challan, or for a Food and Beverages trader or distributor.
- Printing: Save keeps the invoice and moves on to the next invoice number, Print / PDF prints straight away with the layout picked from previews under Print Settings (A4 unless changed); delivery challan for any invoice (also from the Challan button in Sales), envelopes
  (DL, C5, #10), purchase record / quotation, credit and debit notes; paper sizes A4 / A5 / Letter / Legal;
  e-way bill warning above ₹50,000 (₹1,00,000 in Maharashtra, Delhi, Tamil Nadu and Bihar). The browser's
  print dialog saves the PDF. Every printout ends with "Powered by BlitzBook", a link to <https://blitzbook.co.in>
  that the PDF keeps (the app's PDFs print the address beside it). While the print dialog is up the
  page title is the document number and date ("Invoice 0001 - 03/10/2026"), so a browser header line or the
  PDF's title shows that and not the portal's own title. On the Classic layout the last page fills the room
  above the totals with the item columns, so the totals, bank details and signature sit at the foot of the
  frame instead of a blank box following them.
- Terms & conditions and payment due date: the company profile holds the terms (one per line) and a credit
  period in days. Each invoice has *Include terms & conditions on the PDF* (on by default when terms exist)
  and a *Payment Due Date*; a Credit invoice gets the date filled in from the credit period until one is
  typed. Both layouts print the due date beside the payment mode and the numbered terms at the foot. The
  terms are kept with the invoice as saved (`due_date`, `terms` in the sync row; the app leaves them as they are).
- Duplicate (Sales list, and on an open invoice): a new invoice with the same buyer, consignee, goods, payment mode
  and terms under the next number and today's date, ready to check and Save; what belonged to the original
  consignment (delivery note, order, e-way bill / reference, vehicle, LR) is left blank and the due date follows the
  new date. The original invoice is not touched.
- Delivery challans (Sales > Delivery Challans): goods sent out before or without an invoice, numbered
  DC-0001 onwards in the same editor (no rate needed), printed as a challan, turned into a Credit invoice with
  Make Invoice (the invoice carries the challan number under Delivery Note and the challan shows which
  invoice it became; deleting that invoice reopens the challan). They sync with the app as `dc:<no>`.
- Upload PO (Sales): a CSV / Excel file of customer purchase orders in the BlitzBook template (one row per
  item, PO Number on each row; a blank PO Number continues the row above; Rate is the price before GST,
  blank takes the item master price). A preview shows what each PO will do, then every PO becomes one Credit
  invoice: a PO number already on an invoice updates that invoice, the rest are inserted; customers and items
  are upserted into the masters. Dates may be dd/mm/yyyy, ISO or Excel serials.
- Every upload (contacts, stock, purchase orders, bank statement) offers the same choice for rows already in
  the books, **Upsert** (new rows are added, the ones already here are brought up to date) or **Insert only**
  (new rows only, the rest are left as they are; remembered as `upload_mode`), and ends with a result dialog
  counting what was *inserted*, *updated*, *unchanged* (identical already) and *skipped*, with the reasons.
  Contacts match by name, stock items by name among the lines uploaded earlier (upsert sets the file's
  quantity and rate; purchase-bill stock is never touched), purchase orders by PO number, statement lines by
  date, amount and narration (upsert updates the party and the bill the voucher is against).
- Credit notes must name their invoice and cannot exceed what is left of its value; an invoice with credit
  notes against it cannot be deleted until they are.
- Customers / suppliers with TDS settings, CSV or Excel upload in the app's template, bulk delete.
- Item master with codes, categories, bulk category / GST / delete; items invoiced or bought as stock join
  it automatically; removed starter items stay hidden.
- Purchases and quotations (convert to purchase), reverse charge, GST-inclusive rates, TDS from the
  supplier's record, stock flag per item; stock in hand with CSV / Excel upload of opening stock, delete
  one stock item or many at once (optionally from the item master too).
- Expenses with GST (bill value or taxable value), vendor GSTIN, reverse charge.
- Receipts & Payments: money received from a customer (against an invoice, with the outstanding balance
  shown) or any other income, money paid to a supplier (against a purchase) or any other outgoing; cash or
  bank with UPI / cheque reference; printable receipt voucher. Upload a bank statement (CSV or Excel export
  of any bank, or the template) and every line becomes a receipt or payment: parties are matched from the
  narration (and remembered for next time), lines already recorded are spotted on a re-upload.
- Journal vouchers with any number of debit and credit lines, auto-balancing, account picker with
  natures, create party / account in place. Receipts and payments appear here too.
- Sales report, Profit & Loss and Balance Sheet with the same lines and figures as the app, Excel export.
  Receivables and payables are party-wise: credit sales, credit purchases, notes on account and receipts /
  payments net off per customer or supplier, and each outstanding party is listed.

## Company profile

- **Company Master Profile** is changed by the owner or an admin only. Every other role opens it with all the fields
  closed, a note saying so and no Save button; a save from such a role is refused as before, and by the server too.
- **Line of activity**: Food and Beverages, Retailer, Services, Manufacturing, Wholesale, Transporter, Construction,
  Medical or General; it decides the invoice's extra fields and the starter quick items. A *Services* company also says
  what it does: *General Services* or *Manpower and Staffing Services* (serviceType, synced as service_type; the app
  does not know it and leaves it alone), the second billing on the staff sheet (see Manpower and staffing invoices). A *Food and Beverages* company also chooses what it does: *Restaurant*, *Trading* or
  *Wholesale and Distribution* (`activitySub`, synced as `activity_sub`). Only a restaurant gets the Table & Service
  card, the recipes wording and the thermal receipt as its starting layout; a trader or distributor bills with the
  dispatch details like any goods business. A company saved before the choice existed counts as a restaurant.
- **Financial year**: asked for as *Financial Year Starts From* (the month, and the year typed in, not picked from a
  list) with *Financial Year Ends On* filled in beside it. April to March is the usual one; January to December or
  any other month works (`fyStart` the year, `fyMonth` the month; synced as `fy_start` / `fy_month`). `{FY}` in the
  invoice number reads 2026-27 or, for January to December, 2026, and "This financial year" in the reports follows
  it. GST returns stay on April to March.
- **Books Start From**: the day the books begin (`booksFrom`, dd/mm/yyyy, synced as `books_from`; empty = the first
  day of the financial year typed above, which the field follows until a day of its own is given). Entries dated
  before it are refused. An earlier day (1 April of last year, say) lets last year's bills, receipts and payments
  in; a day after the financial year ends is refused. Books that already hold earlier entries (migrated from Tally,
  SAP or other software, or restored from a backup) begin with the earliest of them: the profile saves and moves the
  date there by itself, and such entries can still be edited.
- **Opening balances of a financial year**: whatever is dated before a financial year is that year's opening
  balance. The **Balance Sheet** has two columns, *Opening* (the first day of the financial year the date falls in,
  or the day the books begin when that is later) and *As at*; `Books.balanceSheet(day, true)` is the position a day
  begins with. The **Party Ledger** opens on this financial year with *Opening balance brought forward* (All dates
  lists every entry); a party with nothing in the period still shows what was brought forward. **Journal > Opening
  Balances** (also on the Balance Sheet) is one voucher dated the day the books begin for what they begin with: debit
  cash, bank, the customers who owe, assets; credit the suppliers owed and loans; Capital takes the difference and
  lines without an amount are dropped. A voucher whose narration starts with "Opening balance" dated on that day
  counts as opening (the one a migration writes too), and stock uploaded on that day is the opening stock. The app
  has all of it under the same names. Test: `PLAYWRIGHT_CORE=... node tools/opening.js`.
- **Company logo**: *Attach Logo* in the profile. The logo takes the place of the BlitzBook mark in the top bar and
  prints at the head of invoices, challans, notes, vouchers, purchase orders and reports (`logo`, a data: URL, synced
  with the profile so the app prints it too).
- The top bar names the login in use beside the company chip (hover for the mobile number or email).

## Companies, groups and members

- **Companies** (top bar) lists every company the account owns or has been given a role in, grouped. *New
  company* makes another company owned by the account (its profile is then filled in under Company Profile);
  *Group / name* puts a company in a group; *Members* adds people by mobile number or email with a role and
  changes or removes them. Someone with a BlitzBook account gets the role at once and an email saying so; someone
  without one is **invited**: the server keeps the mobile number or email with the role, an email tells them who
  added them to which company in what role and asks them to register at blitzbook.co.in (or in the app) with that
  email, and the company is theirs to open the moment they do (the invitation is listed under Members until then
  and can be withdrawn; `server/supabase/functions/invite` sends the mail); *Delete* (owner) removes a company with all its books; *Leave*
  drops a company one was invited to. **A member who is removed** (Members > Remove, by the owner or an admin) loses
  the company at once: the server gives the login nothing of it, the company leaves its list, and the portal and the
  app wipe the books they had kept of it (a login working in it is taken back to its own books with a note). When
  that was the member's last company and the account keeps no books of its own (no invoices, purchases, parties or
  employees, no paid plan, licences, companies or members of its own), the login is **deactivated**: the portal and
  the app refuse it with "Login deactivated", offline too once the device knows, and the server gives it no books at
  all. It works again the moment a company adds the person as a member. Somebody who keeps books of their own only
  loses the company; leaving by oneself never deactivates. Needs `server/supabase/companies.sql` run again (until then
  nothing is deactivated). The company chip in the top bar (and *Switch company* on the dashboard)
  switches between companies; the chip shows the role in another owner's company. Someone invited into a company who
  keeps no books of their own (their first company was never set up) is not offered *Switch company* or that empty
  company: the chip opens the company profile for them instead.
- Roles: **Owner** everything, members, subscription, deleting the company; **Admin** everything in the books,
  the profile and the members; **Accountant** sales, purchases, stock and the accounts (every record of the books and
  the reports), not HR & payroll, the profile or members;
  **Sales** sales invoices, delivery challans, credit / debit notes and receipts for the customers assigned to them, and items; **Manager** the HR
  screens, and approves timesheets and reimbursements; **HR** the HR screens only (employees, attendance,
  timesheets, reimbursements, payroll, HR settings), approving only as somebody's reporting manager, and nothing
  of the books (the server shows an HR or manager login only those records, and refuses a decision on a timesheet
  or claim by anyone not entitled to it, one's own included);
  **Viewer** looks at everything, changes nothing. Screens and tiles a role cannot use are not offered; a save a role may not make
  is refused with a note, and the server refuses it as well.
- **A sales person and their customers.** A login with the Sales role (or a custom role that works like it) sees only
  the customers **assigned** to it and the ones it adds itself, with the invoices, delivery challans, credit / debit
  notes and receipts of those customers: the customer list, the sales list, the reports, the outstanding, the party
  ledger, the search and the Recent panel all show that part alone, and nothing of purchases and expenses. The
  owner, an admin or an accountant assigns a customer on the customer itself (*Assigned to (sales person)*, the
  members of the company) or several at once from the customer list (Select, *Assign to sales person*);
  `assignedTo` on the contact, the sales person's mobile number or email, synced as `assigned_to`. Document numbers
  still run over everybody's documents, and a number taken by a document the login does not see is refused. *Roles &
  hierarchy > Sales* has the tick *Sales people see only the customers assigned to them* (on unless unticked:
  `salesAll` on the roles record). It is done in `Store` (`scope`, `whole`): a list read gives the visible part, a
  save puts the hidden records back, sync and backups work on the whole lists. In the app such a login works in the
  portal's sales screens, opened inside the app. The server still lets a Sales member read the company's books: the
  limit is the portal's and the app's, like the rights of a role. Test: `PLAYWRIGHT_CORE=... node tools/access.js`.
- Custom roles and the hierarchy (**Roles & hierarchy** on the Companies screen and in the Members dialog, for the
  company that is open): the owner or an admin makes a role with a name of its own (Store Manager, Cashier,
  Steward) that *works like* one of the built-in roles, *reports to* another role and *sees* the modules ticked
  (Sales, Purchases, Inventory, Accounts & reports, HR & payroll, GST & data; only the ones the base role reaches
  are offered). The dialog shows every role in its reporting line; a built-in role can be given another role to
  report to. Members and invitations are given a custom role from the same list as the built-in ones. The roles are
  one record of the company's books (`roles`: the roles, who has which by account, mobile or email, and the
  reporting lines of the built-in roles), synced like the rest and read by the app too. **Edit** on a built-in role
  (Admin, Accountant, Sales, Manager, HR, Viewer) shows the same tick-boxes under *What this role can access*:
  whatever is unticked is hidden from every member with that role (`builtin: { role: { rights, modules } }` in the
  roles record; all ticked = no narrowing). Owner always has everything, and Employee has only its own clock,
  timesheet and claims, so neither has boxes.
- **Tab Access** (Company > Tab Access, and the button on the Companies screen; the owner and the admins): a grid of
  every tab of the menu against every role (the custom ones too). A tick shows the tab to the members with that role,
  an unticked tab leaves their menu and their dashboard, in the portal and in the app, and the screen is refused; a
  dash is a tab the role does not reach at all (its base role and its rights decide that, and the server). The owner
  always sees everything, and Dashboard, Company Profile, Companies, Licences and Subscription are never taken away.
  Kept as `hide: { role id: [tab ids] }` on the roles record; a tab id is the screen, with its first parameter where
  several entries share one (`notes:DN`, `contacts:Supplier`, `inventory:count`). `Companies.tabOff / routeOff /
  tileOff`; in the app `myHiddenTabs` and `tileTabs` (MainActivity). Test: `node tools/tabaccess.js`.
- **Every member is an employee** (other than an investor): whoever is added or invited under Companies > Members
  (Employee is the role offered first; a name can be typed for someone who has no account yet) is put on HR >
  Employees by themselves, found by mobile number or email, with the role of their login (`HR.addMembers`; the pay is
  filled in on the record afterwards). Members added earlier, or in the app, join when the Members dialog, the
  Employees screen or the Leave screen is next opened by someone who may change employees (`HR.syncMembers`). The
  role **Investor (Viewer)** in the Members dialog makes a custom role called Investor that works like Viewer: its
  members are not employees.
- **Read only or Read / Write**: beside each tick of *What this role can access* is a choice, *Read / Write* (the
  screen opens and saves) or *Read only* (it opens, nothing in it is saved); a report has none, and a Viewer only
  reads anyway. Kept as `ro: [rights]` on the role (custom or built-in); `Companies.mayWrite` refuses the save with
  the usual note, in the portal and the app (`allowsWrite`). Apps before 2.4 treat every ticked item as read / write. The server holds a member to
  the base role, so a custom role can only narrow what its base may do; the modules trim the menu, the tiles and
  the saves in the portal and the app.
- Each company has its own storage namespace in the browser and its own sync; the account's own first company
  is the one it always had. Making companies, grouping them and adding members come with the yearly plan and
  longer, and with the 30-day trial (the subscription of the company that is open; an invoice pack has none of
  it); the group statements need the paid yearly plan, the one thing the trial does not have; a company one was
  given a role in can always be opened. Everyone working in a company runs on its owner's subscription (shown under
  Subscription); AI Access belongs to the account and is offered in its own company only.
- **Group Statements** (top bar, Reports): choose a group or all companies, Profit & Loss for a period or
  Balance Sheet as at a date. The latest books of every company are fetched first; the table has a column per
  company, an Eliminations column when the companies dealt with each other (sales, purchases, credit / debit
  notes and balances between them, parties matched to companies by name) and the group total, with group
  ratios, Excel and PDF. Each company's GST stays its own.

## Licences (a seat per user)

Members used to hang on the plan of the company's owner: when the owner's 30-day trial or plan ended, every invited
login was locked. A **licence** is a seat of the member's own (`js/licences.js`, **Company > Licences**; in the app,
**Licences** in the side menu opens the same screen). The owner buys seats of a kind for a month or a year and the
owner or an admin assigns them, on the Licences screen, in the Members dialog (a Licence column, and a licence picked
with the invitation), or by **Give login** on the employee list, which takes a Self Service seat when one is free.
Someone invited takes the seat along on registering.

| Licence | For | Opens | Per user / month | Per user / year |
|---|---|---|---|---|
| **Self Service** | every employee | Web Clock in and out, own timesheet and claims, own payslips | Rs 49 | Rs 499 |
| **HR** | HR and payroll staff, managers | employees, attendance, timesheets, reimbursements, payroll, HR settings | Rs 199 | Rs 1,999 |
| **Accounts** | accountants, billing and sales staff | invoices, purchases, inventory, receipts and payments, journal, reports, GST | Rs 299 | Rs 2,499 |
| **Accounts + HR** | admins, people who do both | everything | Rs 449 | Rs 3,999 |
| **Professional** | accountants and tax professionals | everything, and the Professionals tab printed and exported | Rs 999 | Rs 9,999 |
| **Additional company** | one for each company after the first | the books of one more company under the same login | Rs 149 | Rs 1,499 |

The pricing follows the per-user editions of Salesforce (a price per user per month, lower when the year is paid at
once, a nominal seat for people who only use self-service), scaled to BlitzBook's own plans: an Accounts seat costs
what the monthly / yearly plan does. The prices are at the top of `js/licences.js` and in `LICENCES` of the cashfree
function (what is charged); change both together.

- A member with a licence that is running works in the company whatever the owner's plan or trial does (`Sub.lic`:
  `Sub.isActive`, `isFull`, `isYearlyPaid` and `statusText` answer from the licence). What opens is the role *and* the
  licence: a Self Service seat gives the employee's own screens whatever the role, an HR seat the HR screens, an
  Accounts seat everything but the HR screens; the Web Clock and My Payslips come with every kind
  (`Companies.licensed`).
- **Every member needs a licence.** A member without one that is running is locked out of the company (the dialog
  says to ask the owner or an admin for one), whatever plan or trial the owner is on (`Lic.missing`, `Sub.noLic`).
  The owner works on their own plan (Subscription); an owner with seats running can add members even without the
  yearly plan. The rule starts once the server knows licences (the company list carries `lic`): before
  `companies.sql` has been run again, members keep working on the owner's plan as they did.
- **Many users, several kinds at once.** On the Licences screen the owner types the seats to buy beside each kind
  (12 Self Service, 2 HR, 3 Accounts ...) and pays for all of them in one order (`{ plan: 'lic', items: [{ kind,
  seats }], period }`; the function writes one `licences` row a kind). **Assign by role** then gives every member and
  invitation without a licence the kind their role works with (employee: Self Service; HR, manager: HR; accountant,
  sales, viewer: Accounts; admin: Accounts + HR) while seats are free, and says which seats are still missing. Any
  single licence can still be changed from the list.
- Seats are counted over all the companies of the owner. When seats lapse, the seats assigned first stay covered.
- The kind and its date come with the company list (`my_companies`: `lic`, `lic_until`, `lic_seats`), so they are
  known offline. Server: `licences`, `licence_seats`, `licence_summary`, `assign_licence` in
  `server/supabase/companies.sql`; a paid order writes the `licences` row (`functions/cashfree`). To give seats away,
  insert a row into `public.licences` (owner_id, kind, seats, valid_until) in the SQL Editor.
- **My Payslips** (HR menu, the employee dashboard, an HR tile in the app): the login's own payslips of the
  finalised months, for the employee record that carries its mobile number or email. A member cannot read the payroll
  records (they hold everybody's pay), so the rows come from `my_payslips(cid)`.
- Test: `PLAYWRIGHT_CORE=... node tools/licences.js`.

## More companies under one login (accountants and tax professionals)

An accountant or a tax professional keeps the books of several clients under one login: **Companies > New company**.
Every company after the account's first needs an **Additional company** licence (bought on the Licences screen like
the seats, any number at once; not assigned to anybody, the server counts the companies against the seats).
`create_company` refuses a new company while no such licence is free and the portal then opens Licences. Companies
made before the charge began (`company_charge_from` in `companies.sql`) stay free. When the licences lapse the oldest
companies stay covered; a company that is not is locked for its owner with a note to buy one (`co_ok` false in
`my_companies`, `Lic.companyUnpaid`), and opens again the moment it is paid for.

## Professionals (project report for a bank loan)

The **Professionals** group of the top bar (`js/professional.js`; **Professionals** in the app's menu opens the same
screen) makes the project report an accountant or a tax professional prepares for a bank loan, in the layout banks
are used to. The report of a small manufacturing unit served as the model, and `tools/professional.js` reproduces its
figures (cost of project 34.43 lacs, depreciation 0.65 / 0.56 / 0.49, turnover 84 / 96 / 102 lacs ...).

- **Project details** is the one page of inputs: the *Introduction* (name of the unit, constitution, address,
  correspondence address, proprietor / partners / directors, type of industry, classification, category, whether the
  item is reserved for SSI); the narrative (*brief history and promoters' background, land, investments, viability*,
  and the *manufacturing process* a step a line); the *cost of the project* asset by asset with what is existing
  (already owned) and what is proposed, the depreciation rate of each, other costs and the working capital
  requirement; the *means of financing* (capital existing and to be brought in, subsidy, unsecured loans, the term
  loan with its interest, period and moratorium, the cash credit limit); and the assumptions (Ist-year sales, the
  capacity utilization year by year or a growth rate, raw material, electricity, wages, selling and administration,
  repairs, other charges, the days of stock, debtors and creditors, income tax, drawings). Amounts are typed in
  rupees; the report prints them **in lacs** to two places (or in rupees). *Fill from the books* takes this
  financial year's sales and expenses from the books of the company.
- The annexures, each a tab and each headed with the unit and its address, the years as **Ist, IInd, IIIrd ...** (3 to
  10 of them): **Cost of project** and **Means of finance** (existing, proposed, total); **Calculation of interest
  and repayment schedule**, twice: the *summary, year-wise* (the year with its financial year, number of
  instalments, opening balance, repayment, interest, total outgo, closing balance, and a total) and the *schedule in
  detail*, month by month in rupees (the month, the instalment number or "Moratorium", opening balance, principal,
  interest, total payment, closing balance, a total for every year and for the loan). The interest of a month is on
  its opening balance, the moratorium pays interest only, and the summary and every statement take the totals of the
  months, so the two always agree; **Calculation of depreciation** (the years down the page, an asset a column: cost, depreciation,
  WDV); **Projected profitability statement** (capacity utilization, A. Income, B. Expenditure, C. Net profit before
  tax, D. Income tax, E. Profit after tax); **Calculation of working capital requirement**; **Balance sheet at the
  end of the year** (capital fund with opening balance, net profit and drawings; secured loans from bank; unsecured
  loans; current liabilities; fixed and current assets); **Funds flow statement** (ending on the increase in cash and
  bank balances); **Calculation of debt service coverage ratio** with the **average DSCR**; **Calculation of break
  even point** in the 3rd year of operation (variable and fixed parts, contribution); and **Ratios** (current ratio,
  net working capital, debt-equity, TOL / TNW, margins, interest cover). The balance sheet balances by the funds
  flow; a shortfall of cash or a gap between cost and means is flagged.
- **Worked as the model works it.** The *term loan* is repaid in equal amounts a year over its period (2 lacs over 5
  years: 0.40 a year), the Ist year in the instalments left after the moratorium (6 with 6 months of it) and 12 a year
  after, the interest of a year on the average of its opening and closing balance (0.23, 0.18, 0.13, 0.08, 0.03).
  *Stock*: raw material on the days of its consumption; **stock in process**, **finished stock**, **sundry debtors**,
  **sundry creditors**, **advances & securities** and **drawings** can be typed as amounts year by year (rupees,
  commas between, the last holds), as the model gives them; without them they are worked out from the days and the
  growth. With the model's inputs the report gives its figures: working capital requirement 10.37 / 11.42 / 11.69,
  profit before tax 4.22, tax 1.30, profit after tax 2.92, cash 0.75, DSCR 2.50 in the Ist year (the model has 4.24
  and 2.51: it charges the six months of moratorium half a year of interest less than the monthly schedule does).
- **The layout is chosen on Project details** (*The project report prints in*: Annexures, or Bank loan format;
  `layout` on the record) and **Project report PDF** follows the choice. The choice is kept the moment it is made (it
  used to wait for *Save and work out*, so the other layout never printed), and every statement has a *switch to ...*
  link beside the layout's name. The texts and lists of the bank loan format show on Project details when it is chosen.
- **Set in Calibri**, on the screen and in print: the statements as ruled tables under a dark heading row with the
  financial year under every year, heading rows tinted, totals bold; the cover in a double frame; every annexure
  numbered (Annexure - I ...) under the name and address of the unit; the unit and *Page x of y* at the foot.
- **The PDF can be printed, not copied.** *PDF* of a statement and *Project report PDF* lay the report out in A4 pages
  here (long tables carried over with their heading row), draw every page as a picture and hand the pictures to the
  print dialog: a PDF saved from it has no text to select or copy. A browser that will not give the picture back
  (Safari) prints the report as text, with a note. Excel export is unchanged. Calibri is taken from the device: where
  it is not installed (most phones) Carlito, Segoe UI or Arial take its place.
- **The second layout, the bank loan format**, after the usual outline of a project report for a bank loan: 1.
  Executive summary with *Project cost & source of finance* ((A) capital investment, (B) working capital, total,
  equity, bank loan); 2. Project description with *Product basic details* (raw material, market rate, finished goods,
  percentage, market rate); 3. Project plan with the **Cash flow statement** (a column for the construction period,
  then the years: source funds, disposition of funds, net surplus, closing balance; also a tab); 4. Market analysis; 5.
  Management team with the *Man power requirements* (designation, number, rate, salary, total a month and a year);
  6. Technical feasibility with *Plant & machinery*; 7. Financial projections: the profitability statement, the
  **projected balance sheet** in the order of the Schedule (equity and liabilities; non-current assets with gross
  block, depreciation and net block; current assets) and the DSCR; 8. Collateral & security; 9. Conclusion. Its texts
  and lists are typed under *For the bank loan format* on Project details; what is left blank is taken from the texts
  of the first layout.
- **Project report PDF** prints the whole document in that order: the cover (*PROJECT REPORT OF M/S ...*), 1.
  Introduction (A to I), the numbered narrative sections, the manufacturing process as a flow chart, the cost of the
  project and means of financing, turnover and purchase cost of goods sold year by year, then every annexure on a
  page of its own. Each tab also has Excel and PDF of its own. The report is one record of the books (`pro`), synced
  like the HR settings.
- **Licence**: printing, exporting and copying need the **Professional** licence: the owner with a Professional seat
  running (`lic_pro` in `my_companies`), a member assigned one. Without it (the trial included) the owner gets a
  **preview**: everything is worked out and shown, but the buttons are closed, nothing can be selected or copied, the
  right-click menu is off and the browser's own print leaves the report out. A member on another licence does not get
  the tab.
- Test: `PLAYWRIGHT_CORE=... node tools/professional.js`.

## Receipts knocked off against invoices

A receipt names the invoices it settles. The receipt form lists the customer's open credit invoices oldest
first with what is due on each; *Auto: oldest first* spreads the amount received over them in that order
(8,000 against 2,999 + 3,999 + 2,599 clears the first two and puts 1,002 on the third), and any line can be
typed by hand. What is not knocked off stays on account of the customer and shows under Outstanding & Ageing.
The receipt voucher lists the invoices with the amounts set against them and the balance still due. Credit
notes adjusted on account reduce the invoice they are against, so Outstanding, the dashboard and the party
ledger all show what is really due.

## HR & payroll

The HR screens come with the Full access plans (and the trial): on any other plan they show a *Full access
subscription required* lock with the plans. Members of a company run on the owner's plan.

- **Offer letter points**: HR Settings holds the points printed under *Terms of employment* on every offer letter, one
  a line, to change, add to or remove (`offerPoints`; *Put the standard points back* restores the five standard ones).
  Words in braces are filled in for the employee: `{name}` `{first_name}` `{designation}` `{department}` `{joining}`
  `{manager}` `{probation}` `{probation_notice}` `{notice}` `{hours}` `{leave}` `{gross}` `{ctc}` `{pay_basis}`
  `{company}`. The Offer letter dialog of an employee starts from those points and lets them be changed for that
  employee alone; the changed points and what was typed for the letter (probation, notice, hours, reporting to, other
  terms) are kept on the employee record (`offerPoints`, `offer`), so the letter prints the same the next time.
- **Role on the employee** (HR > Employees, on creating and on editing): *Role (what their login may do)*, Employee
  unless chosen, any built-in role or a custom role of the company (`role` on the employee record: `sales`, `hr`,
  `c:<custom role id>` ...), shown as a column of the list. **Give login** adds the employee to the company with that
  role (and its custom role), with the licence the role works with when a seat is free; changing the role of an
  employee whose mobile number or email already has a login changes the role of that login (`HR.applyRole`:
  `set_member`). The owner and admins choose it; everyone else sees it.
- **Employees**: code, designation, department, dates, reporting manager, PAN / Aadhaar / UAN / ESI number, bank
  account, the pay type (a monthly salary from the attendance, or a rate per hour from the weekly timesheets), the
  salary structure (basic, DA, HRA, conveyance, special), whether PF, ESI and PT apply, the monthly TDS and the
  paid leave a year. HRA is filled from basic (40% of basic, 50% with the metro tick, or the % in HR Settings)
  until typed. Under the Code on Wages basic + DA must be at least 50% of the pay: a structure below that gets a
  note, and payroll counts the shortfall as wages for PF. *Offer letter* prints a letter per employee (date,
  place, probation, notice period, working hours, reporting manager, extra terms) with the pay and CTC breakup.
- **Who approves**: a timesheet or a claim is approved by the employee's reporting manager (the employee record
  names one; the managers above in that line count too), by an admin, a manager or the owner; never by the
  employee themselves (the login whose mobile or email is on the employee record), the owner excepted. The server
  applies the same rule (`hr_relation` in companies.sql), so an HR login that is somebody's reporting manager can
  approve for their reports and nobody can approve their own.
- **Timesheets**: a week per screen (Monday to Sunday), hours worked a day per employee, total and overtime; the
  approver ticks *Approved*, which locks the hours (HR enters, the reporting manager approves). An
  hourly employee is paid from the timesheets: hours above the weekly limit (40) at 1.5x, holidays of the list on
  working days paid at the hours of a day; payroll flags the weeks of the month still to be approved. *Copy last
  week* fills the sheet from the previous week.
- **Reimbursements**: claims per employee (date, category, amount, description, bill number) as pending /
  approved / rejected / paid; the approver (above) approves or rejects, and the server holds everyone else to
  entering and editing pending claims. Approved claims are paid with the next payroll (on the payslip under
  Reimbursements, in the books as Staff Reimbursements); each payroll row lists the claims it pays, so a claim
  shows as paid once that month is finalised and is free again if the month is reopened.
- **Currencies and exchange rates** (`js/currency.js`; Company > Currencies & Rates, and the currency button at the top
  right). The books stay in rupees. The company keeps a table of the currencies it deals in, each with the rupees one
  unit is worth (typed, or *Get today's rates* from open.er-api.com; the `fx` record of the books, synced), and a
  converter. **Show amounts in**: a login picks a currency and every amount of the portal's screens carries its value
  in it beside the rupees, or instead of them (`U.money` reads `U.fx`; `U.inr` is rupees always: prints, the GST
  returns and emails use it). **An invoice in a currency**: *Invoice currency* and *Exchange rate* on the invoice
  (`inv.fx = { code, rate }`, the `fx` column of the synced row); it is entered and booked in rupees, shows its total
  in the currency and prints it with the rate under the amount in words. Test: `node tools/currency.js`.
- **HR Policy** (HR > HR Policy; *Leave Policy* under Manpower for a staffing agency; everyone reads it): the leave
  policy of the company in two groups, **Employees** and **Manpower (staff deployed at client sites)**, each with its
  kinds of leave (casual, sick, earned, and any other the company adds), the days of a year, the rule in words and the
  general rules (`LEAVE_POLICY` in hr.js is the standard; what the company changes is `leavePolicy` on the HR
  settings). The owner, an admin, a manager or HR change it, print it and *Send to the staff* (copy, WhatsApp or
  email to an employee). An employee is in the Manpower group when their record says so or they are on the Manpower
  roster (`HR.policyGroup`); a new employee gets the policy from the day they are added.
- **Leave is earned month by month** (`HR.leaveBalance`, `leaveMonths`): a twelfth of the year's days of each kind a
  month from April, never beyond the month that is running; someone who joins in the year earns from the date of
  joining, the month of joining in proportion to its days. The balance is by kind of leave (`types`: quota, accrued,
  used, left) and in total; a leave beyond the balance is flagged on the request. The employee record's *Leave policy*
  box replaces *Paid leave per year*; the settlement on leaving encashes what was earned and not taken.
- **The bell** (top right; `HR.notices`, `HR.bell`): the leave requests and reimbursement claims waiting for this
  login's approval; one's own request once it was approved or rejected (until the bell is opened); and, for an
  employee login, the leave policy until *I have read the leave policy* is pressed. A toast tells of a new one while
  the portal is open. The Android and iOS downloads beside it are icons only.
- **No leave below nothing** (`HR.leaveRoom`, `HR.fitLeave`): a request of paid leave may take what is left of its
  kind (earned so far, less taken or approved, less the other requests of that kind still waiting). A request for
  more is cut when it is saved: the working days the balance covers stay as asked and the days after them go in as a
  loss-of-pay request of their own (`lopFor` names the kind that was asked); with nothing left, or for a half day,
  the whole request is loss of pay. The balance is looked at again at the approval. A balance (`left`) is never
  below zero; what was marked L by hand beyond what was earned shows as `over`.
- **Super Admin** (`Companies.isSuper`, `adminRole`): a role every company has between the owner and the admins: the
  custom role with the fixed id `superadmin` on the admin base (so the server treats it as an admin), reporting to the
  owner, with Admin reporting to it. Only the owner or a Super Admin makes someone an Admin or a Super Admin, changes
  or removes one, and changes what those two roles see (Roles & hierarchy, the Admin and Super Admin columns of Tab
  Access). A plain admin keeps everything else. The app's Members dialog follows the same rule.
- **Businesses & Tabs** (`js/business.js`, Company > Businesses & Tabs, record `biz`): a company ticks every business it
  runs besides its main line of activity (a hotel with a restaurant, a shop that also repairs ...) and which menu
  groups it is shown. Each group has a suggestion from the businesses (Hotel for accommodation, Manpower for a staffing
  agency, the rest always); only a choice against it is kept, so *Use
  suggested* puts a group back on the businesses. A group that is off leaves the menu, the dashboard tiles and the
  screens of everybody in the company, the owner included; Tab Access then narrows by role among the groups that are
  on. `hideTabs` (the menu entries of those groups) is written for the app, which hides the same tiles. Owner and
  admins only; the server keeps `biz` from an accountant.
- **Hotel** (`js/hotel.js`, line of activity *Hotel and Accommodation* or that business ticked): Front Desk (arrivals,
  in house, departures, rooms free tonight, to clean, occupancy), Room Chart (a fortnight of rooms; a free night books
  that room), Reservations (guest with identity document and, for a foreign national, passport and visa; dates, room
  type and room with clash check, adults, children, extra beds, meal plan EP / CP / MAP / AP, rate, source, status;
  the folio of room nights, charges and payments), Rooms & Housekeeping (types with rack rate, rooms by range,
  clean / dirty / inspected / out of order), Guest Register (the police register; foreign nationals with the Form C
  details), Occupancy Reports (occupancy, ADR, RevPAR, average stay, by source, by room type, night by night) and
  Settings. Benchmarked on the front office of eZee Absolute, Hotelogix, Cloudbeds, IDS Next, Djubo and OPERA.
  GST: a room up to ₹7,500 a night 5%, above 18% (Notification 15/2025-CT(Rate), from 22/09/2025), SAC 996311, both
  in Settings. Check-out opens the tax invoice in Sales (`invoice?fromStay=`): CGST + SGST always, the place of supply
  of accommodation being the property (IGST Act s.12(3)); the saved invoice is named on the stay. Records `hotel`
  (settings, types, rooms: owner, admin, accountant), `stays` (`stay:`) and `hk` (`hk:`), which the Sales role (the
  front desk) also writes. A hotel is not billed like a restaurant. App 2.27: the Front Desk tile opens these screens.
- **Who applies leave for whom**: everyone applies their own; the owner, an admin, a manager and HR apply for any
  employee (*+ Apply leave*, *Apply for*), a reporting manager for the people under them; nobody else applies, edits
  or withdraws another person's leave (`HR.mayApplyFor`). A leave applied for somebody shows *Applied by*.
  **Every member applies their own leave**, whatever the role or the licence (accountant, sales and viewer too: HR >
  Leave opens as *My Leave*; `Companies.leaveOnly`, and `books_may_write` in companies.sql lets such a role write a
  leave request of its own). It is approved by whoever is above the employee: the reporting manager and the managers
  above (whatever their role), a manager, an admin or the owner, never by the employee (`HR.canApproveLeave`).
- **Leave requests** (HR > Leave; My Leave for an employee login): an employee asks for leave from a day to a
  day (casual, sick, earned, or loss of pay) and sees the paid leave left in the year; the approver (above)
  approves or rejects, the employee can withdraw a pending request, the approver can cancel an approved one. An
  approved request marks its working days on the attendance by itself, L (A for loss of pay), on days gone by and
  days to come alike. A request can be for half a day (first or second half, one day): it marks HL, half a day
  of paid leave with the other half worked, and takes half a day off the balance; half a day of loss of pay marks
  HD. Holidays and weekly offs inside a request are not counted, a mark made by hand on the grid still
  wins, and the days come off the leave balance. On a day still to come the grid takes leave only: present, absent
  and half day wait for the day itself. A request is kept with the claims (an `rb:` record with `kind: "leave"`),
  so the server's rule for claims (`books_may_write` in companies.sql) holds it with nothing to run again.
- **Numbers are links**: every document number in a list or report (sales list, challans, notes, purchases,
  expenses, journal, receipts and payments with the invoices they are against, the sales report, outstanding and
  supplier outstanding, the party ledger, the GST returns tables) is a link to `#open?no=<number>`, which opens the
  entry itself: an invoice or challan on its screen, anything else in its editor over its list.
- **Web Clock**: clock in and clock out from the browser. An employee whose login (mobile number or email) is on
  their employee record clocks themselves in and out; the HR roles and the accountant clock anyone. One record per
  employee and day holds the punches; the hours show in the attendance grid's tooltips and in a monthly table, and
  an hourly employee's day goes on the week's timesheet at clock-out (while it is not approved). Every clock-in is
  measured against the employee's **shift** (start and end on the employee record, else the company shift of HR
  Settings; a shift ending before it starts runs over midnight): the Today table shows the shift, the first
  clock-in with *Late by* (the delay after the shift start), the last clock-out with *Early by* (how long before
  the shift end), the hours and the status, with a Late / Left early pill once past the grace minutes. The month
  table adds the late days and the late minutes in all, the days left early and the early minutes in all, and a
  Day by day table lists each working day of one employee (a day without a clock-in says so). Export Excel lists
  every punch of the month with the shift, Late by and Early by. A punch never clocked out stops counting by itself
  at the shift end of that day (or hours-per-day after a clock-in that came after the shift end): the day is flagged
  **⚠ Not clocked out** on the Web Clock (the Today table, the month table's count, the Day by day row) and on the
  attendance grid, and one of the HR roles sets the clock-out from the Day by day row (Set, offered at the stop
  moment); a clock-out pressed after the stop moment closes the punch at the stop moment. An employee's own card
  shows the hours stopped once the moment is past.
- **Attendance**: a grid of the month, one cell per day: P present, A absent (loss of pay), L paid leave, HD half
  day, W weekly off, H holiday (weekly offs and holidays from HR Settings). With *From Web Clock: On* (the default;
  also under HR Settings) the days of an employee who clocks in that month are marked from the Web Clock: a past
  working day with a clock-in is present (a half day under half the hours of a day), one without a clock-in absent;
  today and the days to come stay present, an employee who never clocks in stays present, and a tap on a cell still
  overrides any day. Each cell shows the clocked hours and ⚠ for a day not clocked out. Hours = hours per day worked
  plus the overtime hours typed for the month. Attendance locks once the month's payroll is finalised.
- **Payroll**: computed from the structure and the attendance: earned per paid day; overtime at gross / (26 x
  hours per day) x the multiplier (twice the wages under the labour codes); an hourly employee's hours at the rate
  with the weekly overtime at 1.5x; approved reimbursements; PF 12% of wages (basic + DA, at least half the pay)
  up to the 15,000 ceiling with the employer's 12% split
  8.33% EPS / 3.67% EPF plus EDLI and administration charges; ESI 0.75% / 3.25% when the gross is within 21,000;
  professional tax by the state's monthly slabs (or custom slabs); TDS worked out by itself
  (`HR.tdsOf`: the new tax regime on the pay of the months worked in the financial year, spread over them) unless an
  amount is typed on the employee; the PF and ESI ticks on the employee follow the salary as it is typed
  (`HR.applies`); advances and other
  deductions typed per line. Payslips (one or all), the payroll register, the statutory summary with the PF ECR
  sheet, and a bank advice CSV. A payslip shows the employee's details on top, the earnings on the left and the
  deductions on the right, the net pay and its amount in words at the foot (no row count). *Finalise* locks the
  month and posts one journal voucher: Salaries & Wages, Staff Reimbursements and Employer PF & ESI as expenses, PF / ESI / Professional Tax / TDS Payable and Salary Payable as liabilities,
  Staff Advances for advances recovered; the salaries are then paid with a Payment voucher against Salary
  Payable. *Reopen* removes the voucher until the month is finalised again.
- **HR Settings**: the rates and ceilings, the PT state or custom slabs, the wages floor (50%) and the HRA % of
  basic with the metro tick, the company shift (start, end and the grace minutes), hours per day, the overtime multipliers (monthly and hourly), the weekly hours before
  overtime, weekly offs, paid leave, whether hourly employees are paid for holidays, and the holiday list. Figures are 2026 defaults and can be changed.
- Tests: `node tools/hr-calc.js` (the arithmetic and the posting) and
  `PLAYWRIGHT_CORE=... node tools/hr.js` (the screens and the receipt knock-off in Chromium).

## Sync with the app

The Supabase project URL and anon key are built into `js/sync.js` (`DEFAULT_SERVER_URL`, `SUPABASE_ANON_KEY`),
the same ones as in the app; a BlitzBook sync server address works there too. There is no sync screen or status
for users: it runs on its own. Log in with the account you use in the app
(or register here and log in there). Every entry, edit and
deletion on one side appears on the other within a few seconds while both are online; offline work is
sent when the connection returns. The status chip in the top bar shows Synced / Syncing / Offline /
This device only; clicking it opens the Sync dialog with the server address. See `server/README.md`.

## Data and backups

**Export / Import** writes and reads the same backup file as the app (Export / Import there), so a backup
taken here restores in the app and vice versa. Without sync the data is stored only in the browser you use,
so export regularly.

## Dashboard, ledger and search

- Every screen has its own address (`#sales`, `#invoice?id=...`, `#contacts?type=Supplier`,
  `#salesReport?from=01/10/2026&to=31/10/2026`): the back button walks back, a reload or a bookmark reopens
  the screen. Dialogs (Company Profile, Subscription) leave the address alone.

- The dashboard tiles (New Invoice, Purchases, Sales, Stock, Expense, Receipts, Payments, Journal, Customer,
  Supplier, Reports) can be dragged into any order: with a mouse straight away, on a touch screen after
  *Arrange* beside the heading. The order is kept per account in this browser (`tile_order`); *Reset order*
  brings the standard order back.
- **Party Ledger** (Reports menu, *Ledger* on a contact, *Supplier Ledger* under Purchases, *Party Ledger*
  under Receipts & Payments): every bill, note, receipt and payment with one supplier or customer in date
  order with a running balance, for a period or all dates, with Excel export, to reconcile with the party's
  own statement (`Books.partyLedger`).
- **Sales** has a search box: invoice number, date, party, phone, email, GSTIN, item name or amount; every
  word typed has to match.
- Every **Export Excel** has a **PDF** beside it (sales report, outstanding & ageing, party ledger, profit &
  loss, balance sheet): the same table laid out on pages by the print module and sent to the print dialog.
- Quick item and item master prices are the price the customer pays, GST included ("Unit Price (inclusive of
  tax)"); on the invoice the rate before GST is worked back out of it, so qty x rate x (1 + GST) lands on
  the price again. The same in the app.
- **Dark mode**: the moon / sun button in the top bar (and on the login page) switches the portal between
  light and dark; the choice is kept in the browser (`blitzbook.theme`) and, until one is made, the system
  setting decides. `index.html` applies it before the first paint. Printouts stay black on white.

## GST returns (GSTR-1 and GSTR-3B JSON)

**GST** in the top bar is shown to every account. It opens for accounts on a **yearly plan or longer** and during
the 30-day trial (`Sub.isYearly`: a plan of 365 days or more applied here, by code, by payment or by a sync that
stretched the validity by a year, is remembered as `yearly_until`; an account activated elsewhere still counts while
more than 300 days of validity remain; `Sub.isYearlyPaid` is the same without the trial, for the group statements);
everyone else gets a *Yearly subscription required* dialog with the plans.
A regular GST registration is needed (composition dealers file CMP-08 / GSTR-4).

Pick the return period (a month, or a quarter for quarterly filers; the month gone by is offered first). The
screen fetches the sales invoices, credit notes, purchases and expenses dated in it and shows the GSTR-1 and
GSTR-3B figures, the documents with the GSTR-1 table each lands in, and anything to check (an invalid buyer
GSTIN, missing HSN codes, B2C credit notes exceeding the sales). **GSTR-1 JSON** and **GSTR-3B JSON** download
`GSTR1_<GSTIN>_<MMYYYY>.json` and `GSTR3B_<GSTIN>_<MMYYYY>.json` in the layout of the GST portal's Returns
Offline Tool (open the file there, check and upload):

- GSTR-1, in the layout of the portal's own `returns_<date>_R1_<GSTIN>_offline_others_0.json` file: `gstin`,
  `fp`, `filing_typ` (M or Q), `gt` and `cur_gt` (turnover of the previous and the current financial year from
  the books), the supply tables, `doc_issue` with all twelve document types and `fil_dt`; then
  `b2b` (registered buyers, invoice by invoice, rate-wise lines, reverse charge flagged), `b2cl`
  (inter-state invoices above ₹1,00,000 to unregistered buyers), `b2cs` (every other sale summed by state and
  rate, net of the credit notes against such sales), `cdnr` (credit notes to registered buyers), `cdnur`
  (credit notes against B2CL invoices), `nil` (0% lines by supply type), `hsn` (table 12 by HSN, rate and
  unit) and `doc_issue` (invoices, credit notes and delivery challans issued). Nil-rated lines are left out of
  tables 4, 5 and 7, as the rules say.
- GSTR-3B: 3.1(a) outward taxable supplies net of credit notes (reverse-charge sales excluded, the buyer pays
  that tax), 3.1(c) nil-rated, 3.1(d) inward supplies under reverse charge (purchases and expenses marked
  RCM), 3.2 inter-state supplies to unregistered persons by state, 4(A)(3) ITC on reverse charge and 4(A)(5)
  all other ITC net of debit notes. Imports, ISD credit, reversals, interest and late fee are written as zero.

The figures come from what is in the books; always check the files in the offline tool before filing.

## Installing the portal as an app

`manifest.webmanifest`, `icons/` and the service worker `sw.js` make the portal installable: Chrome (Android and
desktop) offers *Install app*, and on iPhone / iPad Safari's *Share → Add to Home Screen* adds it to the home
screen, where it opens full screen with the same login and books. Once opened it works offline too (the books
are in the browser's storage; sync catches up when online). The **Android App** and **iOS App** buttons in the top bar
offer the APK and these iPhone / iPad steps. The native iPhone / iPad app (a shell around this portal) is in
`../ios/`; `js/native.js` is the bridge it uses for printing and downloads.

## Activation codes

The plans are a monthly plan (30 days, Rs 299), a yearly plan (365, Rs 2499), a 2 years plan (730, Rs 3999), a
5 years plan (1825, Rs 7999), invoice packs of 15 invoices (valid 3 months, Rs 99) and 40 invoices (valid 6 months,
Rs 199), and the **Full access** plans, which cover the accounts and HR & payroll together: monthly Rs 599, yearly
Rs 4999, 2 years Rs 7999 (priced against GST billing apps at about Rs 3000-3500 a year and payroll tools at Rs 50-100
per employee a month). A time plan opens every accounting feature; HR & payroll need a Full access plan
(`Sub.isFull`, from `full_until`, which such a plan sets and which syncs with the sub record; the 30-day trial has
it too so it can be tried). Full access is bought through Cashfree (a grant with `full` true) or entered as a
Full access code (`redeem_code_v2` answers `full` true, `server/supabase/activation.sql`); the other activation
codes cover the plain plans.
On an invoice pack every saved invoice, credit note or debit note uses one invoice, invoices not used by the pack's
date lapse, the portal then shows only invoicing (New Invoice,
Sales, Credit Notes, Debit Notes, Customer, Supplier, Sales Report); a saved invoice or note can be changed and saved
again (Edit, then Save: no further invoice of the pack is used) but not deleted
(`Sub.isLite`). Codes handed to customers are issued in Supabase and work once on any account:
`server/supabase/activation.sql` loads ten of each (listed in `server/supabase/activation-codes.txt`). A code tied to one login can also be
made offline, exactly as for the Android app:

```
java tools/LicenceKeyGen.java <mobile-or-email> <days>
```

Days can be 30, 365, 730 or 1825. The identity must be what the user registered with.

## Tests

- `node server/test.js` — sync protocol and data layout, no browser needed.
- `node server/supabase/test.js` — the Supabase backend against a stand-in for the Supabase API.
- `node server/supabase/mcp-test.js` — the MCP server (AI Access) against a stand-in for the database; what it saves is
  read back through `js/appformat.js`.
- `node tools/deploy-site.js` (in webportal/) publishes the portal: this repository is private and GitHub Pages is not
  available for it on the free plan, so the built portal (webportal/ without tools/ and node_modules/) is force-pushed as one
  commit to the public repository tutorialtrack1-eng/blitzbook-site, which Pages serves at https://blitzbook.co.in. The
  workflow .github/workflows/pages.yml does the same on every push to master once the secret SITE_DEPLOY_TOKEN is set
  (a fine-grained token with Contents read/write on blitzbook-site); until then run the script after pushing.
- `PLAYWRIGHT_CORE=/path/to/playwright-core node tools/po-challan.js` — purchase-order upload (upsert and
  insert only, result counts), delivery challans, their printing, sync records and backup, terms & conditions
  and the due date on the PDF, the GST lock and the GSTR-1 / GSTR-3B JSON, dark mode, in a portal opened as a file.
- `PLAYWRIGHT_CORE=/path/to/playwright-core node tools/tabaccess.js` — Tab Access (the grid, a member losing the tabs unticked for
  their role, a custom role's own column), members becoming employees, and who applies leave for whom.
- `PLAYWRIGHT_CORE=/path/to/playwright-core node tools/roles.js` — the Employee role: Give login on the employee list, the employee's own
  dashboard and screens limited to themselves and their reports, approvals up the reporting line and never of one's own
  (the server side of the same rules: `node server/supabase/companies-test.js`).
- `PLAYWRIGHT_CORE=/path/to/playwright-core node tools/mail.js` — the Email buttons: invoice, reminder (one and all), receipt,
  order and requisition messages, the mail-app fallback as a file and against the sync server without SMTP (/api/mail).
- `PLAYWRIGHT_CORE=/path/to/playwright-core node tools/inventory.js` — the Inventory group and tile, the three
  valuations on a worked example, adjustments, recipes, stock count, locations and transfers, reorder level, expiry,
  movements, the reports, open by number and the sync key.
- `PLAYWRIGHT_CORE=/path/to/playwright-core node tools/procure.js` — contact numbers as links and no Edit buttons, own
  columns, one fact per column on every list, the thermal receipt and the restaurant's default to it, employee assets,
  and procurement end to end (requisition, order, receipts, bill, low stock, compare quotes, sync key).
- `PLAYWRIGHT_CORE=/path/to/playwright-core node tools/restaurant-clock.js` — email required at registration; the Web
  Clock's stop moment, the not-clocked-out flag and the clock-out set by HR; attendance marked from the Web Clock; a
  restaurant's table and steward on the invoice, its printouts and its sync row; the Web Clock tile and the designation chip.
- `PLAYWRIGHT_CORE=/path/to/playwright-core node tools/menu.js` — the Construction and Medical lines of activity with
  their starter items, and a restaurant's Menu: opening before a new invoice, category > dish, a tap putting the dish on
  the invoice, ADD and the stepper, the jump to a category, search, a dish of one's own, a phone's width.
- `PLAYWRIGHT_CORE=/path/to/playwright-core node tools/aside.js` — the Recent panel: the sections each screen gets and
  their order, a tap on an invoice, purchase, customer or product row, hide and show, the drawer under 1100px, the
  per-screen choice of sections, and every screen drawing with the panel beside it.
- `PLAYWRIGHT_CORE=/path/to/playwright-core node tools/smoke.js` — drives the portal in Chromium through
  every screen, then a second browser signs in to the same account and both must stay in step.
- `node server/supabase/companies-test.js` — companies, groups, roles and the group statements against a stand-in
  for Supabase that applies the rules of `companies.sql` (`server/supabase/standin.js`).
- `PLAYWRIGHT_CORE=/path/to/playwright-core node tools/companies.js` — the Companies, switcher, members and Group
  Statements screens in Chromium, an owner and a member with changing roles, against the same stand-in.

## Customising

- Company colours: edit the `:root` variables at the top of `css/app.css`.
- Font: `index.html` loads Plus Jakarta Sans from Google Fonts. Offline, or if you remove that link, the
  portal uses the system font.
- Plans, prices, UPI ID, vendor phone and activation server: top of `js/subscription.js`.
- Supabase project URL and anon key, or the sync server address: top of `js/sync.js`.
- Invoice number format: Company Profile, for example `INV/{FY}/####`.

## HR: pay up to today, the 2026 PF / ESI rules, offboarding and letters (`js/hr.js`)

- **Pay period.** `HR.span(emp, month)` gives the days an employee is paid for in a month: from the 1st or the day of
  joining, to the last day or the last working day, and never past today. A month that is not over is therefore paid
  up to today (`run.upto`), the payroll screen says so, and a draft moves on by itself each day until it is finalised.
- **PF.** Ceiling 25,000 from 17 September 2026 (S.O. 5109(E)); `HR.pfCeilingFor(month)` keeps 15,000 for the months
  before and 19,667 for September 2026. Settings saved with the old 15,000 follow the new ceiling until HR Settings is
  saved again. Administration charges are at least 500 a month for the establishment.
- **Wages** (Code on Social Security): basic + DA + special allowance, and at least half of the pay; used for PF and
  for ESI. HR Settings can put ESI back on the gross with overtime.
- **ESI.** 0.75% + 3.25% on wages up to 21,000 (25,000 for a person with a disability, a tick on the employee);
  covered to the end of the contribution period once covered; no employee share on a daily wage up to 176.
- **Offboarding.** Employees are never deleted. Offboard on the list keeps the exit on the employee (`e.exit`): kind,
  reason, notice date, last working day, clearance, settlement figures. Save keeps them on notice (paid up to the
  last working day, off the payroll the day after, by `HR.sweepExits`); Complete & deactivate closes it and can take
  their login out of the company. Reactivate clears the date of leaving and files the exit under `e.exits`.
- **Letters.** Relieving letter, experience letter and termination letter from the employee's row, from standard
  words that can be changed per employee (`e.letters`); the full and final settlement prints from the exit dialog.
- **Settlement in the books.** Saving or completing an exit whose last working day has come posts one journal voucher
  dated that day (`HR.postSettlement`, `e.exit.voucherId`): leave encashment, gratuity, notice pay and bonus as
  expenses, the notice pay recovered as income, other recoveries against Staff Advances, the balance to Salary
  Payable (paid with a Payment voucher). The salary of the last month is not in it: the payroll of that month posts
  it. Saving again updates the same voucher; the tick on the dialog turns the posting off and takes the voucher out. When nobody
  has saved the exit by then, the settlement is posted by itself the day after the last working day (`HR.sweepExits`,
  once, by the first login that may write the journal), with the figures on the exit or, left blank, the paid leave
  not used and the gratuity the law gives.
- **Wide tables.** `UI.rails` puts a scroll bar drawn by the page under every table that is wider than its frame; it
  stays at the foot of the window. `.tablewrap.pin` keeps the first column and the actions in view.
- Checks: `node tools/hr-calc.js` (arithmetic), `node tools/hr.js` (the screens, with Playwright).
