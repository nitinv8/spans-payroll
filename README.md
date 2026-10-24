# Spans Payroll

Password-protected payroll and employee database for Spans Envirotech. It replaces the
"FY2026-27 Spans Employees Details – Core Team Only" Google Sheet.

**Stack:** Next.js 14 (deployed on Vercel) and Supabase (Postgres plus Auth). Every table has row-level security, and only emails on the app's allowed list can read or write data.

## What it does

| Area | What you get |
|---|---|
| Employees | Current and past employees with every Master Employee Database field: KYC, bank, UAN/ESIC, sizes and Orgzit vendor IDs |
| Salary history | Each revision has an "effective from" date. A month always uses the revision that applied then, and old payslips never change |
| Monthly payroll | Pick a month. Everyone employed that month is added with their structure. Sundays are pre-filled as offs, OT incentives go into Incentive, and joining/leaving months get LOP days pre-filled. Edit the days and amounts in a grid, then **Finalize** to lock the month (the database refuses edits) |
| Outputs | **Salary slip PDFs** (one PDF or a ZIP of individual files), the **HDFC ENET CSV** (same format as your bank upload), the **Orgzit upload CSV**, a salary register CSV, and a PF/ESI/LWF summary by state |
| Formulas | Every rate and calculation can be edited at **Formulas**: a live preview against any employee, versions by effective month, and room for your own components |
| OT incentives | Log by month, with the calculator from the Salary Rules tab |
| Bonus | Bonus accrued from payroll vs bonus paid, per FY |

## How the calculation works (default formulas = your Google Sheet)

```
gross            = basic + hra + medical + conveyance + mobile + site + supervisor + overtime + arrears + incentive
ESI (0.75%/3.25%)= roundup(% × (gross − conveyance))            if ESI = Yes
PF  (12%/13%)    = % × min(basic + supervisor + arrears, 15000)  if PF = Yes
LWF              = min(0.2% × wage, 34) / min(0.4% × wage, 68)   if LWF = Yes and location contains "Haryana"
bonus accrual    = 8.33% × basic;  gratuity = 4.81% × basic
in hand          = gross − ESI − PF − LWF − PT + manual adjustment
CTC              = gross + employer ESI/PF/LWF + bonus + gratuity + ex-gratia
```
As a check, every April–September 2026 salary in the sheet (81 rows) was re-calculated, and all of them match to the rupee (`npm test`).

**LOP days** is an optional new field: it pro-rates the fixed earnings, so PF and ESI are worked out on what was actually earned. Leave it at 0 and use *Manual adjustment* to work exactly as the sheet does.

## Setup (about 15 minutes)

### 1. Supabase
1. Create a project at supabase.com (region: Mumbai `ap-south-1`).
2. **SQL Editor** → paste `supabase/migrations/001_init.sql` → Run.
3. **SQL Editor** → paste `supabase/seed.private.sql` (sent separately; it holds your employee data) → Run.
   This loads employees, salary structures, the formulas, the OT log and April–September 2026 as finalized months.
   It also allows logins for `nverma@spans.co.in` and `nitinv8@gmail.com`. Change these with `npm run seed -- a@x.com b@y.com`.
4. **Authentication → Providers → Email**: turn off "Allow new users to sign up".
5. **Authentication → Users → Add user**: create the login (email and password) for each allowed email.
6. **Project Settings → API**: copy the Project URL and the `anon` public key.

### 2. Vercel
1. Push this folder to a **private** GitHub repo. `.gitignore` already keeps out the files with personal data.
2. Vercel → New Project → import the repo.
3. Add environment variables `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then Deploy.
4. In Supabase → Authentication → URL Configuration, set Site URL to your Vercel URL (needed for password-reset emails).

### Local development
```
cp .env.example .env.local   # fill in the two values
npm install
npm run dev                  # http://localhost:3000
npm test                     # payroll engine vs the Google Sheet (needs data/sheet-import.ts)
```

## Monthly routine
1. **OT incentives**: log extra days and holiday incentives for the month.
2. **Monthly payroll → Start payroll**: choose the month and the bank transfer date.
3. Enter worked days, offs, leaves, incentives and adjustments (each row saves when you leave it). Check the warnings panel.
4. **Finalize & lock**.
5. Download the **salary slips**, **HDFC CSV** (upload on the HDFC ENET portal) and **Orgzit CSV**.

Salary change: Employees → person → **Salary history** → *Add a revision* with the effective month.
Statutory rate change (for example the PF wage ceiling): **Formulas** → *New version* → set "Applies from" → edit the parameter → Save.

## Formula language
Spreadsheet-style and safe: no code is executed. Operators: `+ - * / ^`, comparisons, `and/or/not`, `a ? b : c`, `12%`.
Functions: `if`, `min`, `max`, `round(x,d)`, `roundup`, `rounddown`, `ceil`, `floor`, `abs`, `contains(text,"part")`.
Formulas run top to bottom, and each can use the inputs listed in the editor plus any formula above it.
`gross`, `net_pay`, `ctc`, the ESI/PF/LWF keys, `bonus` and `gratuity` are required, because the slips, the bank file and the reports use them.

## Files
```
lib/formula.ts          formula parser/evaluator (sandboxed)
lib/payroll.ts          default formulas (= Google Sheet), engine, validation
lib/run-logic.ts        who is in a month, structure lookup, default days
lib/exports.ts          HDFC CSV, Orgzit CSV, register, compliance summary
lib/slip-pdf.ts         salary slip PDF (pdf-lib)
app/actions.ts          all writes (server actions)
supabase/migrations     schema, RLS, finalized-month lock
scripts/                seed generator, tests, sample outputs
```
