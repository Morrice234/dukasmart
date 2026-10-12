# DukaSmart

Offline-first sales, expenses and deni tracker for small Kenyan businesses, with M-Pesa subscriptions and a free trial.

```
dukasmart/
  backend/   Express API + PostgreSQL (auth, sync, M-Pesa STK push, admin API)
  mobile/    React Native Expo app (expo-router, SQLite, auto sync)
  admin/     React + Vite admin panel
```

## 1. Backend

Requirements: Node 20+ and Docker Desktop (Postgres runs in Docker).

```bash
cd backend
cp .env.example .env          # set POSTGRES_PASSWORD (and the same password in DATABASE_URL), secrets, Daraja keys
npm install
npm run setup                 # starts Postgres in Docker, waits for it, creates tables
npm run create-admin -- you@example.com "StrongPass123" "Your Name"
npm run dev                   # http://localhost:4000/health
```

### M-Pesa (Daraja)

1. Create an app on https://developer.safaricom.co.ke and copy the consumer key and secret into `.env`.
2. Sandbox values for `MPESA_SHORTCODE` (174379) and `MPESA_PASSKEY` are already in `.env.example`.
3. Safaricom must reach your callback over public HTTPS. While developing run `ngrok http 4000` and set `PUBLIC_BASE_URL` to the ngrok URL.
4. Set `MPESA_CALLBACK_SECRET` to a long random string. The callback URL becomes `/api/mpesa/callback/<secret>`, so random people cannot post fake payments.
5. Going live: set `MPESA_ENV=production`, use your own paybill/till and the production passkey from Safaricom. For a till use `MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline`, `MPESA_SHORTCODE=<store number>` and `MPESA_PARTY_B=<till number>`.

If a callback never arrives (it happens), the app keeps polling `/subscriptions/payments/:id` and the server asks Safaricom directly with the STK query API, so the subscription still activates.

## 2. Mobile app

```bash
cd mobile
cp .env.example .env          # EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:4000
npm install
npx expo install --fix        # aligns package versions to your installed Expo SDK
npx expo start
```

Scan the QR code with Expo Go. For a real APK to install on shop owners' phones:

```bash
npm install -g eas-cli
eas build -p android --profile preview
```

## 3. Admin panel

```bash
cd admin
cp .env.example .env          # VITE_API_URL=http://localhost:4000
npm install
npm run dev                   # http://localhost:5173
```

Add the admin URL to `CORS_ORIGINS` in the backend `.env` when you deploy it.

From the admin panel you can see sign-ups, trial vs paying vs expired counts, revenue, search businesses, extend trials, record cash payments (activates a plan without M-Pesa), suspend accounts, view all payments and edit plan prices.

### Database commands

| Command | What it does |
| --- | --- |
| `npm run db:up` | Start the database container |
| `npm run db:down` | Stop it (data is kept) |
| `npm run db:logs` | Show database logs |
| `npm run db:psql` | Open a SQL prompt |
| `npm run db:backup` | Save a backup to `backend/backups` (keeps the newest 14) |
| `scripts\restore.bat <file>` | Replace the database with a backup |

Data lives in the Docker volume `dukasmart-pgdata`. It survives restarts and `docker compose down`. Only `docker compose down -v` or deleting the volume removes it, so never run that. To move to a VPS later, run `npm run db:backup`, copy the file across, and restore it there.

## How the pieces work

**Free trial.** Registering creates the business with `trial_ends_at = now + TRIAL_DAYS`. One trial per phone number because phone is unique.

**Subscription gating.** The server refuses sync pushes with HTTP 402 when the trial and subscription have both ended. The app checks the same dates locally, so even offline it stops new entries after expiry and sends the user to the Subscribe screen. Old records stay viewable and nothing is deleted.

**Offline storage.** Every record lives in SQLite on the phone first. IDs are UUIDs made on the phone, so nothing needs the server to be created.

**Sync.**
- Each write marks the row `dirty`. Pushing sends dirty rows and clears the flag only if the row was not edited again during the upload.
- Each server row gets a `version` from one Postgres sequence. Pulling asks for rows with `version > cursor`, so a second phone on the same account gets the changes.
- Conflicts: last write wins using the row's `updated_at`. A local unsynced edit that is newer than the server copy is kept.
- Deletes are soft (`deleted = true`) so they sync too.
- Sync runs on app start, 3 seconds after any write, when the internet comes back, when the app returns to the foreground, and every 60 seconds.

**Signing out** is blocked while there are records not yet uploaded, so an owner cannot lose a day's records by logging out offline.

## Referrals and bonuses

There are two kinds of referrers.

- **Businesses.** Every business gets an invite code (Account → Invite & earn) and can share it on WhatsApp. When a business they invited pays for the first time, the referrer automatically gets free days added to their subscription (30 by default).
- **Agents.** Friends or helpers who are not customers. Add them in the admin panel under Referrals → Agents and give them a code. When a business signs up with an agent's code and pays, the agent earns cash (KSh 100 by default). It shows under Referrals → Payouts. Send the money on M-Pesa, then click "Mark all paid" and enter the M-Pesa code so you have a record.

Anyone who signs up with any valid code gets extra trial days (7 by default). All four amounts are editable in Referrals → Bonus rules. You can also pay agents a smaller amount on every renewal; it is off by default.

If an agent brought someone in but forgot to give the code, open the business in the admin panel and use "Link referrer". Rewards are tied to a specific payment, so the same payment can never earn twice. Agents cannot earn from signing up their own phone number.

## Branches and staff

- Every business starts with a "Main branch". Upgrading from the first version moves all existing records into it, on the server and on the phones.
- Owners add branches in Account → Branches. A switcher appears at the top of each screen once there is more than one branch. "All branches" shows combined totals plus a per-branch breakdown on the Today screen.
- Owners add staff in Account → Staff with the person's own phone number and a PIN. Staff sign in on their own phone exactly like the owner does.
- **Cashier:** works at one branch, records sales, expenses and deni, can fix their own entries, cannot delete anything, and only ever downloads their branch's data.
- **Manager:** one branch or all branches, can edit and delete.
- **Owner only:** subscription payments, branches, staff and invites.
- Every record is stamped with who entered it. Owners and managers see "Sales by staff" on the Today screen, which covers barber commissions.
- Branch and staff limits come from the plan: Basic 1 branch and 2 staff, Business 5 branches and 10 staff. Trials get the Business limits. You can change these in the admin Plans page.
- The server enforces every rule. If a phone tries something it is not allowed to do, the change is undone on the phone and the user sees a message.

## Stock

- **Products:** the Stock tab lists every product with its quantity, buying and selling price, and a "warn me at" level. Low and out-of-stock items are listed first, and the Today screen reminds you about them.
- **Product page actions:**
  - **Sell:** creates a sale and lowers the stock.
  - **Receive:** adds stock. It can also record what you paid as a "stock" expense, and it updates the buying price.
  - **Count:** you enter what is on the shelf and the app records the difference.
  - **Remove:** for damaged, expired or used stock.
- **Selling several items at once:** "Sell from stock" on the Stock tab, or "From stock" on the Sales tab, opens a cart. Quantities like 1.5 kg work. Deleting such a sale from the Sales list puts the items back.
- **Branches:** the product list is shared by all branches, but each branch has its own quantity. Cashiers see their branch's stock only. They can add products and record stock changes, but cannot delete.
- **How quantities are stored:** stock is never kept as one number that someone overwrites. Every change is saved as its own record and the quantity is the total of them. Two phones selling the same item offline then add up correctly when they sync.

## Leads

The admin Leads page is for shop owners who were interested but not ready.

- Record their details, interest level (hot, warm, cold), why they are not ready yet, which agent found them, and a follow-up date.
- Opening a lead lets you call or WhatsApp them, log what they said, and set the next date with +3, +7, +14 or +30 day buttons.
- The dashboard and Leads page show who is due or overdue for a follow-up.
- "Export CSV" downloads the current filtered list for bulk SMS or WhatsApp campaigns.
- When a lead later registers in the app with the same phone number, the lead is marked converted automatically.

## Free hosting (zero cost)

| Part | Free service | Address you get |
| --- | --- | --- |
| Backend | Render free web service (`render.yaml`) | `https://dukasmart-api.onrender.com` |
| Database | Neon free Postgres | connection string |
| Admin panel | Netlify free (`admin/netlify.toml`) | `https://<name>.netlify.app` |
| App builds | EAS free plan | APK download link |

- **Moving your existing data:** run `backend\scripts\move-to-cloud.bat "<Neon connection string>"` once, into an empty Neon database.
- **Backups:** put `CLOUD_DATABASE_URL=<Neon connection string>` in `backend\.env` and run `scripts\backup-cloud.bat` regularly.
- **Free plan limits to watch:**
  - Render: the server sleeps after 15 minutes with no traffic and takes about a minute to wake. There are 750 free hours a month and 5 GB of traffic a month. Point a free cron-job.org job at `/health` every 10 minutes to keep it awake.
  - Neon: 1 GB of storage and 100 compute hours a month. The database sleeps when idle, so quiet nights cost nothing.

## Deploying

- Backend: Railway, Render or a small VPS. Use a managed Postgres (Neon, Supabase, Railway) and set `DATABASE_SSL=true` if it needs SSL.
- Admin: build with `npm run build` and host `admin/dist` on Netlify, Vercel or the same server.
- Keep `JWT_SECRET`, `ADMIN_JWT_SECRET` and `MPESA_CALLBACK_SECRET` long and private.

## Next things worth adding

- Plan differences: everything is available on both plans right now. Gate extras like weekly/monthly reports or multiple phones by checking `subscription.planCode` in the app and `plan_code` on the server.
- Barber/salon mode: add a `staff` table and a `staff_id` on sales for commission tracking.
- SMS trial-ending reminders (Africa's Talking) from a daily job.
- PIN reset via SMS OTP.
