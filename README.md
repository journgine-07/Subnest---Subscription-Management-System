# Brightloop Subscription Management System

React + Vite frontend, Node/Express REST API, MongoDB (Mongoose), JWT + bcrypt auth. Built from the supplied
*Subscription Management System* brief. Currency defaults to INR. Payments are recorded manually (the brief does not ask for a gateway).

## Setup

Requirements: Node.js 20+, MongoDB running locally (or an Atlas URL).

```bash
npm install
npm run install:all
cp server/.env.example server/.env      # Windows PowerShell: Copy-Item server/.env.example server/.env
# edit server/.env: set JWT_SECRET to a long random string (32+ chars)
npm run seed                            # demo data; add  -- --reset  to wipe the database first
npm run dev                             # API :5000 + web app :5173
```

Open http://localhost:5173. Health check: http://localhost:5000/api/health.

| Role | Email | Password |
|---|---|---|
| Admin | admin@brightloop.local | Admin@12345 |
| Staff | staff@brightloop.local | Staff@12345 |
| Customer | asha@example.com (also ravi@, meera@) | Customer@12345 |

Change these and the JWT secret before any shared deployment. The demo-credentials box on the login screen only appears in development builds.

Other commands: `npm test` (unit tests for billing/discount/date logic), `npm run build` (production client build).
Production: `npm run build`, set `SERVE_CLIENT=true` in `server/.env`, then `npm start` (API + built app on one port).

## Email

Set `SMTP_HOST/PORT/USER/PASS/FROM` and `CLIENT_URL` in `server/.env` for password-reset and invoice emails.
Without SMTP, the reset link is **printed in the server console** (never returned by the API) and "Send invoice" reports that email is not configured.

## How it works

- **Roles (enforced in the API):** Admin = everything. Staff = customers, subscriptions, invoices, payments, billing runs, reports (cannot create products/plans/taxes/discounts/templates/staff, cannot see cost prices). Customer = only their own subscriptions, confirmed/paid invoices and payments. Only Admin creates Staff.
- **Subscriptions:** Draft → Quotation → Confirmed → Active → Closed (Active ⇄ Paused when the plan allows). Invalid transitions, expired quotations (auto-closed by the billing run), disabled pause/early-close/renew are rejected.
- **Billing:** each subscription has a billing anchor and a count of billed periods; period *n* starts at anchor + *n* × frequency (month-ends never drift). The daily 02:00 job and the **Run due billing** button use the same function. A unique `billingKey` (subscription + period start) makes re-runs and parallel runs idempotent; every missed period is created in order. Plans with auto-close stop billing at expiry; others keep billing.
- **Tax:** rate comes from the admin-defined tax rule on the product (copied onto the subscription line) and is charged on the discounted line amount.
- **Discounts (admin only):** fixed or percentage (≤100), minimum purchase/quantity, start/end (inclusive), max uses, whole-subscription or product-specific scope (only matching lines are discounted). *Auto-apply* rules (default) apply to every eligible subscription's next invoice; non-auto rules apply only when attached to a subscription. The best eligible rule wins (no stacking). Usage is reserved atomically, released if the invoice isn't created or is cancelled, and a discount never takes a line below zero.
- **Payments:** method, amount, date, note against a **Confirmed** invoice; partial payments allowed; overpayment rejected atomically; invoice becomes Paid at zero balance.
  *Outstanding* = Confirmed and not fully paid. *Overdue* = outstanding and past due date.
- **Dashboard/Reports:** active subscriptions, monthly recurring revenue (before tax/discounts), collected this month, outstanding, overdue, recent payments, 6-month chart; Reports adds from/to filters, by-month and by-method totals, invoice and subscription summaries.
- **Performance design:** indexes on every filter/sort used, all lists paginated (max 100/page), dashboard figures are indexed aggregates. The <2 s target is a design goal and is **not load-tested** — see limitations.

## Manual test checklist

1. **Sign-up rules:** register with `Short1!` (rejected), `alllowercase1!`, `NoSpecial123`, then `Valid#Pass1` (accepted). Re-use the same email → "already registered".
2. **Reset:** Forgot password → open the link printed in the server console → set a new password → old token rejected on reuse; login works.
3. **Roles:** as Staff, Users page has no "Add staff" form and `POST /api/catalog/products` returns 403; as Customer, the menu shows only Subscriptions/Invoices/Payments and `GET /api/billing/invoices` returns only your own non-draft invoices.
4. **Catalog (Admin):** create a product with variants `Standard:0, Odoo:560`; create plans (daily/weekly/monthly/yearly) with min quantity and availability dates. A subscription using the Odoo variant shows unit price = plan price + 560.
5. **Quote → subscription:** create a template (Admin) → Quotations → create from template for a customer → it appears as *Quotation* → Confirm → Activate. Try skipping a step (e.g. Draft → Active via API) → rejected. Confirm an expired quotation → rejected.
6. **Billing:** Invoices → **Run due billing**: invoices are created as Draft with lines, tax and totals. Run it again → "0 created, N already billed". Confirm one; Cancel another.
7. **Discounts:** Admin creates "10% off, min qty 5" → a 6-seat subscription's next invoice shows the discount automatically; product-specific discount only reduces matching lines; percentage > 100 is rejected; use a max-uses=1 rule and confirm the second invoice gets no discount.
8. **Payments:** pay part of a Confirmed invoice (stays Confirmed, outstanding drops); try paying more than the balance (rejected); pay the remainder (becomes Paid); Draft invoices are not payable.
9. **Overdue:** the seeded Confirmed invoices past their due date appear under *Invoices → Overdue* and on the dashboard.
10. **Reports:** change the From/To range; totals, chart and by-method table update; From after To is rejected.
11. **Pause/close/renew:** pause (blocked when plan disallows), resume, close, renew (blocked when plan disallows).

## Limitations

- Not load-tested; no benchmark is claimed. Before relying on the <2 s target, seed several thousand subscriptions/invoices and measure the dashboard and list endpoints.
- Verified in development only by syntax/bundle checks and unit tests of the pure logic (`npm test`); the API/DB flows above need to be exercised by you against MongoDB.
- Pipeline updates (atomic payments, `$round`) need MongoDB 4.2+. No multi-document transactions; atomic single-document updates plus unique indexes are used instead.
- Products, plans, discounts and tax rules can be created and archived through the API but there is no edit screen yet (PUT endpoints exist). Tax is snapshotted on the subscription line when it is created.
- One plan/billing frequency per subscription; template lines must share a frequency. Discounts do not stack. Invoices are emailed as plain text; printing uses the browser.
- Customer pickers load up to 200 customers (search is available on the Users page); rate limiting is in-memory (single server).
