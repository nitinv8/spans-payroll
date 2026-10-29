# Backlog

Items reviewed and deferred ("not now"). Numbers refer to the HR / UI-UX review of 25 Oct 2026.
Severity: Critical = wrong pay or legal exposure · High · Medium · Low. Effort: S / M / L.
Before changing any statutory figure, confirm it with the CA.

---

## D. Mobile & monthly flow  *(deferred 25 Oct 2026)*

### #13 Phone layout — High · M
Every page except Incentives and Settings scrolls sideways at 390px. The nav and sign-out block take about a quarter of the first screen. Header buttons ("Run payroll", "Reopen") get pushed off-screen. The payroll grid has 9+ inputs per row, and desktop overflows by about 34px on the month page.
**Change:** `min-width:0` on grid/flex children, let `.pagehead` wrap, use a compact top bar with a menu button or bottom tabs. Below 700px show the payroll grid as one card per employee (Worked / LOP / OT / deductions / remarks, sticky Save), with "Desktop view" as an option. Show the employee and payroll lists as cards.

### #22 Step bar and pre-finalize checks — Medium · M
**Change:** a step bar for the month — Attendance → OT/adjustments → Review checks → Finalize → Bank file → Orgzit → Slips → Challans — with a tick, who and when for each step. Before Finalize, require: no errors, no missing eligible employees, payment date set and on or before the 7th (Code on Wages), bank details present, and the ESI/min-wage warnings acknowledged. Flag "Structure changed since this month was started — recalculate?" per row.

### #15 Payslip contents (Form V, Wages (Central) Rules 2026) — Medium · S–M
**Missing:** payment date, ESIC IP number, father's name, rate vs earned columns, LOP deduction amount, OT hours/rate, leave balance, a reason for each deduction.
**Also:** show PF employer at 12% only; admin and EDLI are employer cost, not member credit. Keep it to one page.

---

## E. Statutory upload files

### #16 EPFO ECR, ESIC upload, client compliance pack — Medium (high value) · M
- **EPFO ECR text:** `UAN#~#Name#~#Gross#~#EPF wages#~#EPS wages#~#EDLI wages#~#EE#~#EPS#~#ER diff#~#NCP days#~#Refund`. The EPS/EPF/EDLI split is already calculated; NCP days come from LOP.
- **ESIC monthly upload** per state employer code: IP no., name, paid days, wages, reason code for zero days, last working day.
- **State returns:** Haryana LWF return, Karnataka PT summary.
- **Monthly compliance pack per client site** (principal employers ask for it): wage register, attendance, ECR + challan, ESIC challan, slips, bank proof.

---

## F. Wage rules

### #3 Labour-Code wage definition for PF — High · M
`pf_wage` = basic + supervisor + arrears. Under the Code on Social Security "wages" = all pay except the listed exclusions (HRA, conveyance, OT, bonus, commission…), plus the 50% add-back, so site, medical and mobile allowances count unless they're genuine reimbursements.
**Change:** a `code_wages` formula used for PF, gratuity and bonus; mark each structure component as "wage" or "excluded". None of the current structures breaks the 50% rule.

### #7 Overtime and holiday work at 2× — High · M
OT incentive is (salary ÷ days) × days, which is 1×. Holiday work (Independence Day, festivals) needs double wages or a substitute day off.
**Change:** rename to "OT / holiday work"; default rate 2 × (code wages ÷ 26 or days in month) with a configurable divisor; record OT hours and holiday dates for the slip and register; keep "incentive" as a separate non-OT earning.

### #8 Minimum wage table and checks — High · M
**Indicative only:** Karnataka skilled Zone I (Bengaluru) April 2026 ≈ ₹17,500–18,150; operators' code wages ≈ ₹16.1k. Haryana operators ₹16,781 vs Oct-2025 highly-skilled ≈ ₹16,220. VDA is revised twice a year.
**Change:** a `min_wages` table (state, zone, skill category, effective_from, monthly rate) plus a skill category on each employee. Warn on payroll creation and when saving a structure. Remind on 1 Apr / 1 Oct to load new VDA.

---

## G. Employee lifecycle

### #9 Full & final settlement — High · L
Wages are due within **2 working days** of resignation or removal (Code on Wages s.17(2)); gratuity within 30 days.
**Change:** an "Exit" action that records last working date, reason, notice pay or recovery, leave encashment, pro-rata bonus, gratuity (15/26 × last code wages × completed years, 6+ months rounded up) and loan recovery. It produces an F&F statement PDF and an off-cycle HDFC line, sets the employee Inactive, and sets ESIC/EPF exit reminders.

### #19 Mid-month salary revisions and arrears calculator — Medium · M
A revision effective on the 20th applies to the whole month, because the structure is looked up at month end. Back-dated increments need arrears worked out by hand, and arrears are added to the current month's PF wage before the ceiling.
**Change:** force effective dates to the 1st, or pro-rate by days. Add an arrears calculator that recomputes past finalized months and posts the difference with a PF/ESI split.

### #20 Bonus eligibility, cap and leavers — Medium · S
**Statute:** eligible if wages are ₹21,000 or less; bonus is calculated on min(wages, max(₹7,000, minimum wage)); 8.33–20%; payable within 8 months of FY end. With about 15 staff the Act may not apply (20-employee threshold) — confirm; if it doesn't, call it a policy bonus.
**Change:** an eligibility formula and a "statutory vs policy" setting; FY picker; include leavers on the Bonus page.

### #21 Onboarding checklist and ID format checks — Medium · M
**Change:**
- Before Draft → Active, require: DOJ, salary structure, state, skill category, bank details entered twice.
- Validate IFSC (11 characters, 5th = '0'), PAN pattern, 12-digit UAN, 10-digit ESIC IP, 10-digit mobile.
- "KYC complete" badge: UAN/ESIC (ESIC within 10 days of joining), PAN, Aadhaar, nominee/Form 2, joining letter.
- Rehires: keep a history of joining and leaving dates instead of overwriting.

---

## H. Later items

### #17 Attendance, holidays and leave — Medium · M–L
Sundays are hard-coded as the weekly off; there are no holidays and no leave balance.
**Change:** weekly-off day per employee, state holiday calendar, simple leave ledger (accrual, e.g. 1 day per 20 worked, opening balance, taken, encashed), optional monthly attendance CSV import, attendance register (Form IX).

### #23 TDS on salary — Low today · S guard, L full
Highest salary is about ₹9 lakh a year, so tax is nil under the new regime. From Tax Year 2026-27 the Income-tax Act 2025 applies: s.392 (was 192), Form 130 (was 16), Form 138 (was 24Q), Form 124 (was 12BB).
**Change:** a yearly projection per employee that warns above about ₹12.75 lakh; add a TDS deduction row only when needed.

### #24 Gratuity liability report — Low · S
The 4.81% accrual understates the real liability.
**Change:** a report as at any date: code wages × 15/26 × years, capped at ₹20 lakh; fixed-term staff from 1 year.

---

## Deferred sub-items from batches A–C (built 25 Oct 2026)

- **Orgzit "Date"** is the 1st of the month, not the payment date. Confirm with accounts which they want.
- **Print codes** (C1, C2…) renumber when a row is removed, so slip file names can change between downloads. Consider fixed codes per employee.
- **Aadhaar storage:** currently masked on screen with a logged Reveal. Consider storing only the last 4 digits plus a document link, or encrypting with Supabase Vault.
- **Draft candidates' data retention:** purge Draft records N days after creation if they don't join (DPDP).
- **Employee privacy notice** (one page; DPDP s.7 legitimate use still needs notice and safeguards).
- **Supabase settings to confirm:** sign-ups off, backups / point-in-time recovery on.
- **September 2026 split month (EPF/EPS):** EPFO FAQs say 1–16 Sep uses the ₹15,000 ceiling and 17–30 Sep the ₹25,000 ceiling, in one ECR. September was finalized at ₹15,000 for the whole month (9 PF members, all above ₹15,000 PF wages). Decide with the CA whether to post the difference; the FAQs allow the employee share to be recovered in a later payroll. EPS is now on wages up to ₹25,000 from October (25 Oct 2026 decision).
- **EDLI wage ceiling:** set equal to the EPF ceiling (₹25,000); confirm.
- **ESIC wage treatment** of conveyance and HRA under the Code on Social Security: confirm.
- **Haryana LWF coverage:** confirm exclusions (managerial staff); LWF was switched on for all Haryana and Karnataka staff. Also confirm Jan–Apr 2026 arrears at ₹35/₹70, the current Karnataka LWF rate (₹50/₹100 assumed), and whether Delhi LWF applies.
- **Deduction limits:** a warning shows above 50% of wages. Add written-notice tracking for fines (Code on Wages).

## MCP connector follow-ups (29 Oct 2026)
- **Files through Claude:** slips, HDFC and Orgzit files are links that open in the browser (they need the app login). Consider signed, short-lived download links so Claude can hand over the file itself.
- **Two-step login + connector:** if two-step login is on and the connector says the login "isn't allowed", Supabase OAuth tokens may not carry the two-step level (aal2). Check with a test connection; the fix would be in `is_allowed()`.
- **Bulk attendance:** a tool to apply a whole month's attendance from a pasted table or sheet in one call.

## Staff app follow-ups (deferred 29 Oct 2026)
- **Sign-in with Google / email magic link:** most staff have no email on file. Collect personal Gmail IDs first; magic links need the company's own mail server (SMTP) set up in Supabase.
- **Requests HR approves:** change of bank / mobile / address (with proof), OT / site work claims (feed OT incentives), salary advance (feeds advance recovery).
- **Hindi** labels.
- **Leave balance and leave requests**, holiday calendar (see #17).
- **Attendance in the MCP connector:** tools to read the grid and mark days.
- **Login-attempt clean-up:** remove attempts older than 30 days (the table grows by a few rows a day).
- **If HR changes a mobile number:** today HR must set a new PIN; consider updating the login automatically.
