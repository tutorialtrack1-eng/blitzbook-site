# BlitzBook Web Portal

Browser version of the BlitzBook GST invoice Android app (`VanyaGSTInvoice`). Same screens, same
calculations, same print layouts, responsive from phone to desktop. No build step: plain HTML, CSS and
JavaScript. With the sync server running (`server/`), the app and the portal show the same books; without
it the data lives in the browser's local storage.

## Run it

- `node server/server.js` and open <http://localhost:8080/> — the portal and the sync server together, or
- double-click `index.html`, or serve the folder with any static server / web host. The portal then works
  on its own, or syncs with the Supabase project built into `js/sync.js`.

Register with a mobile number and password. The OTP comes by email from Supabase Auth (see
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
| `js/companies.js` | Companies: several companies under one login (each in its own storage namespace with its own sync), company groups, members with roles (owner, admin, accountant, sales, viewer) and what each role may open and change, the company switcher, and Group Statements (consolidated Profit & Loss / Balance Sheet with inter-company eliminations) |

## Screens

Everything the app has:

- Dashboard with greeting, company chips, subscription status, monthly stats, recent products and the
  tiles Invoice, Sales, Items, Customer, Supplier, Purchase, Expense, Journal, Reports. The top bar is
  Dashboard and six groups that drop down on hover (or a tap on a phone): Sales (New Invoice, Sales,
  Delivery Challans, Credit / Debit Notes, Customers, Sales Report, Outstanding & Ageing), Purchases
  (Purchases & Quotations, Suppliers, Expenses), Stock (Stock & Items, Stock in Hand), Records (Receipts & Payments,
  Journal, Party Ledger, Profit & Loss, Balance Sheet, Group Statements), HR (Employees, Attendance, Timesheets,
  Reimbursements, Payroll, HR Settings) and Company (Company Profile,
  Companies, GST Returns, Export / Import, AI Access, Subscription); the company chip, dark mode and Logout
  sit on the right. An invoice pack and a role in another company trim the groups to what they may open.
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
- Quick items: starter items for the line of activity plus the item master, with search, category chips
  (rename / remove), list or grid view, quantity steppers, per-invoice price and GST, add / customise /
  remove items.
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

## Companies, groups and members

- **Companies** (top bar) lists every company the account owns or has been given a role in, grouped. *New
  company* makes another company owned by the account (its profile is then filled in under Company Profile);
  *Group / name* puts a company in a group; *Members* adds people by mobile number or email with a role and
  changes or removes them. Someone with a BlitzBook account gets the role at once and an email saying so; someone
  without one is **invited**: the server keeps the mobile number or email with the role, an email tells them who
  added them to which company in what role and asks them to register at blitzbook.co.in (or in the app) with that
  email, and the company is theirs to open the moment they do (the invitation is listed under Members until then
  and can be withdrawn; `server/supabase/functions/invite` sends the mail); *Delete* (owner) removes a company with all its books; *Leave*
  drops a company one was invited to. The company chip in the top bar (and *Switch company* on the dashboard)
  switches between companies; the chip shows the role in another owner's company.
- Roles: **Owner** everything, members, subscription, deleting the company; **Admin** everything in the books,
  the profile and the members; **Accountant** every record of the books and HR, not the profile or members;
  **Sales** sales invoices, delivery challans, credit / debit notes, receipts, customers and items; **Manager** the HR
  screens, and approves timesheets and reimbursements; **HR** the HR screens only (employees, attendance,
  timesheets, reimbursements, payroll, HR settings), approving only as somebody's reporting manager, and nothing
  of the books (the server shows an HR or manager login only those records, and refuses a decision on a timesheet
  or claim by anyone not entitled to it, one's own included);
  **Viewer** looks at everything, changes nothing. Screens and tiles a role cannot use are not offered; a save a role may not make
  is refused with a note, and the server refuses it as well.
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
  every punch of the month with the shift, Late by and Early by.
- **Attendance**: a grid of the month, one cell per day: P present, A absent (loss of pay), L paid leave, HD half
  day, W weekly off, H holiday (weekly offs and holidays from HR Settings). Hours = hours per day worked plus the
  overtime hours typed for the month. Attendance locks once the month's payroll is finalised.
- **Payroll**: computed from the structure and the attendance: earned per paid day; overtime at gross / (26 x
  hours per day) x the multiplier (twice the wages under the labour codes); an hourly employee's hours at the rate
  with the weekly overtime at 1.5x; approved reimbursements; PF 12% of wages (basic + DA, at least half the pay)
  up to the 15,000 ceiling with the employer's 12% split
  8.33% EPS / 3.67% EPF plus EDLI and administration charges; ESI 0.75% / 3.25% when the gross is within 21,000;
  professional tax by the state's monthly slabs (or custom slabs); TDS as set on the employee; advances and other
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
Sales, Credit Notes, Debit Notes, Customer, Supplier, Sales Report), and a saved invoice or note is read-only
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
